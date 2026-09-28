/**
 * 仿真 IR（扁平网表）。
 *
 * 设计原则（对应 Tech-Plan 铁律 2/3）：
 * - 全程 TypedArray + CSR 邻接表，不用对象图，避免 GC 抖动；
 * - 时间单位统一用「皮秒整数」(ps)，禁用浮点参与逻辑判定，保证仿真确定性；
 * - 元素引脚固定 stride = 3，未使用的引脚写 -1。
 *
 * 注意：本文件属于 sim-core，禁止引入任何 DOM / 框架依赖。
 */

export const ElementKind = {
  /** NPN 三极管：pins = [collector, base, emitter] */
  NPN: 0,
  /** 电阻：pins = [a, b] */
  RES: 1,
  /** 二极管：pins = [anode, cathode]，单向导通 */
  DIO: 2,
  /** 电容：pins = [a, b]，M0 不参与逻辑仿真（仅计入成本） */
  CAP: 3,
  /** 电源轨：pins = [node]，level 存在 elemParam（0 或 1） */
  POWER: 4,
  /** 关卡输入引脚：pins = [node]，值存在 elemParam（0/1/2=X/3=Z） */
  INPUT: 5,
  /** 关卡输出引脚（只观察，不驱动）：pins = [node] */
  OUTPUT: 6,
} as const;

export type ElementKind = (typeof ElementKind)[keyof typeof ElementKind];

export const PIN_STRIDE = 3;

export const ELEMENT_LABEL: Record<number, string> = {
  [ElementKind.NPN]: 'NPN三极管',
  [ElementKind.RES]: '电阻',
  [ElementKind.DIO]: '二极管',
  [ElementKind.CAP]: '电容',
  [ElementKind.POWER]: '电源',
  [ElementKind.INPUT]: '输入引脚',
  [ElementKind.OUTPUT]: '输出引脚',
};

/** 该元素的哪些引脚槽位会「驱动」节点（其余引脚是只读的） */
export function driveSlotsOf(kind: number): readonly number[] {
  switch (kind) {
    case ElementKind.NPN:
      // 基极只读；导通时集电极与发射极互为导向通
      return [0, 2];
    case ElementKind.RES:
      return [0, 1];
    case ElementKind.DIO:
      return [0, 1];
    case ElementKind.CAP:
      return [];
    case ElementKind.POWER:
    case ElementKind.INPUT:
      return [0];
    default:
      return [];
  }
}

/** 该元素的哪些引脚槽位会「读取」节点（节点变化时需要唤醒它） */
export function readSlotsOf(kind: number): readonly number[] {
  switch (kind) {
    case ElementKind.NPN:
      return [0, 1, 2];
    case ElementKind.RES:
    case ElementKind.DIO:
    case ElementKind.CAP:
      return [0, 1];
    case ElementKind.OUTPUT:
      return [0];
    default:
      return [];
  }
}

/** 基础元件是否属于「无源/直通」元素（用于静态时序分析的分组） */
export function isPassiveElement(kind: number): boolean {
  return kind === ElementKind.RES || kind === ElementKind.DIO || kind === ElementKind.NPN;
}

export interface FlatPort {
  /** 端口稳定 id（关卡断言、波形图都用它） */
  id: string;
  name: string;
  dir: 'in' | 'out';
  /** 位序号（总线位宽 > 1 时按位展开） */
  bit: number;
  node: number;
  /** 绑定到的元素下标（INPUT / OUTPUT 元素） */
  elem: number;
}

export interface FlatNet {
  nodeCount: number;
  nodeLabel: string[];
  elemCount: number;
  elemKind: Uint8Array;
  /** 长度 = elemCount * PIN_STRIDE */
  elemPin: Int32Array;
  elemDelayPs: Int32Array;
  /** POWER: 0/1；INPUT: 0/1/2=X/3=Z */
  elemParam: Uint8Array;
  elemLabel: string[];
  /** 节点 → 读取它的元素列表（CSR） */
  watchStart: Int32Array;
  watchElem: Int32Array;
  /** 节点 → 驱动它的 (元素, 引脚槽位) 列表（CSR） */
  driveStart: Int32Array;
  driveElem: Int32Array;
  driveSlot: Uint8Array;
  ports: FlatPort[];
}

export interface RawElement {
  kind: number;
  /** 引脚节点 id（长度 ≤ PIN_STRIDE，缺位补 -1） */
  pins: number[];
  delayPs: number;
  param: number;
  label: string;
}

/** 由原始元素表装配 CSR 结构，生成可仿真网表 */
export function assembleFlatNet(
  nodeLabels: string[],
  elements: readonly RawElement[],
  ports: FlatPort[],
): FlatNet {
  const nodeCount = nodeLabels.length;
  const elemCount = elements.length;
  const elemKind = new Uint8Array(elemCount);
  const elemPin = new Int32Array(elemCount * PIN_STRIDE);
  const elemDelayPs = new Int32Array(elemCount);
  const elemParam = new Uint8Array(elemCount);
  const elemLabel: string[] = new Array(elemCount);

  const watchCount = new Int32Array(nodeCount + 1);
  const driveCount = new Int32Array(nodeCount + 1);

  for (let e = 0; e < elemCount; e++) {
    const raw = elements[e] as RawElement;
    const kind = raw.kind;
    elemKind[e] = kind;
    elemDelayPs[e] = raw.delayPs;
    elemParam[e] = raw.param;
    elemLabel[e] = raw.label;
    for (let k = 0; k < PIN_STRIDE; k++) elemPin[e * PIN_STRIDE + k] = raw.pins[k] ?? -1;
    for (const slot of readSlotsOf(kind)) {
      const n = elemPin[e * PIN_STRIDE + slot] as number;
      if (n >= 0) watchCount[n] = (watchCount[n] as number) + 1;
    }
    for (const slot of driveSlotsOf(kind)) {
      const n = elemPin[e * PIN_STRIDE + slot] as number;
      if (n >= 0) driveCount[n] = (driveCount[n] as number) + 1;
    }
  }

  const watchStart = prefixSum(watchCount);
  const driveStart = prefixSum(driveCount);
  const watchElem = new Int32Array(watchStart[nodeCount] as number);
  const driveElem = new Int32Array(driveStart[nodeCount] as number);
  const driveSlot = new Uint8Array(driveStart[nodeCount] as number);
  const watchCursor = watchStart.slice();
  const driveCursor = driveStart.slice();

  for (let e = 0; e < elemCount; e++) {
    const kind = elemKind[e] as number;
    const p = e * PIN_STRIDE;
    for (const slot of readSlotsOf(kind)) {
      const n = elemPin[p + slot] as number;
      if (n < 0) continue;
      const at = watchCursor[n] as number;
      watchElem[at] = e;
      watchCursor[n] = at + 1;
    }
    for (const slot of driveSlotsOf(kind)) {
      const n = elemPin[p + slot] as number;
      if (n < 0) continue;
      const at = driveCursor[n] as number;
      driveElem[at] = e;
      driveSlot[at] = slot;
      driveCursor[n] = at + 1;
    }
  }

  return {
    nodeCount,
    nodeLabel: nodeLabels,
    elemCount,
    elemKind,
    elemPin,
    elemDelayPs,
    elemParam,
    elemLabel,
    watchStart,
    watchElem,
    driveStart,
    driveElem,
    driveSlot,
    ports,
  };
}

/**
 * 网表装配器：给编译器与测试使用的低层 API。
 * 调用方先 node() 声明节点，再 add() 添加元素，最后 build()。
 */
export class FlatNetAssembler {
  readonly nodeLabels: string[] = [];
  readonly elements: RawElement[] = [];
  readonly portList: FlatPort[] = [];

  node(label: string): number {
    this.nodeLabels.push(label);
    return this.nodeLabels.length - 1;
  }

  add(kind: number, pins: readonly number[], delayPs: number, label: string, param = 0): number {
    this.elements.push({ kind, pins: [...pins], delayPs, param, label });
    return this.elements.length - 1;
  }

  port(port: FlatPort): void {
    this.portList.push(port);
  }

  get elementCount(): number {
    return this.elements.length;
  }

  build(): FlatNet {
    return assembleFlatNet(this.nodeLabels, this.elements, this.portList);
  }
}

/** 便捷装配器：面向手写测试电路（npn/res/dio/power/input/output 一行一个元件） */
export class NetlistBuilder extends FlatNetAssembler {
  npn(collector: number, base: number, emitter: number, label = 'Q', delayPs = 1000): number {
    return this.add(ElementKind.NPN, [collector, base, emitter], delayPs, label);
  }

  res(a: number, b: number, label = 'R', delayPs = 500): number {
    return this.add(ElementKind.RES, [a, b], delayPs, label);
  }

  dio(anode: number, cathode: number, label = 'D', delayPs = 800): number {
    return this.add(ElementKind.DIO, [anode, cathode], delayPs, label);
  }

  cap(a: number, b: number, label = 'C'): number {
    return this.add(ElementKind.CAP, [a, b], 0, label);
  }

  power(node: number, level: 0 | 1, label = level === 1 ? 'VCC' : 'GND'): number {
    return this.add(ElementKind.POWER, [node], 0, label, level);
  }

  input(node: number, id: string, name = id, bit = 0): number {
    const elem = this.add(ElementKind.INPUT, [node], 0, name, 3 /* Z */);
    this.port({ id, name, dir: 'in', bit, node, elem });
    return elem;
  }

  output(node: number, id: string, name = id, bit = 0): number {
    const elem = this.add(ElementKind.OUTPUT, [node], 0, name);
    this.port({ id, name, dir: 'out', bit, node, elem });
    return elem;
  }
}

function prefixSum(counts: Int32Array): Int32Array {
  const out = new Int32Array(counts.length);
  let acc = 0;
  for (let i = 0; i < counts.length; i++) {
    out[i] = acc;
    acc += counts[i] as number;
  }
  out[counts.length - 1] = acc;
  return out;
}
