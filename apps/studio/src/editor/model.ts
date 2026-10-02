/**
 * 编辑器作者态模型（apps/studio）。
 *
 * 与 @lc/schema 的 DTO 的区别：DTO 用 Net（一条网络挂多个引脚）表达连接，
 * 而画布上玩家点出来的是「导线 W‑W」；这里保存导线，导出时用并查集合并成 Net。
 * 这样撤销/重做、拖动、命中测试都只需要处理最简单的局部数据结构。
 *
 * 本文件是纯数据 + 纯函数：不依赖 DOM，可以直接被测试（apps/studio/test）。
 */

import type { Design, Instance, PinRef, Port } from '@lc/schema';

export type UnitKind = 'npn' | 'res' | 'dio' | 'cap' | 'nmos' | 'pmos';
/** 输出端口的显示形态（画布把输出端口画成对应图形） */
export type SymDisplay = 'segment';
export type SymKind = 'unit' | 'vcc' | 'gnd' | 'input' | 'output' | 'module';
export type Rot = 0 | 1 | 2 | 3;
/** 输入符号的驱动：0/1 = 高低，2 = X，3 = Z（与 sim-core 的 elemParam 一致） */
export type InputDrive = 0 | 1 | 2 | 3;

export interface StoredPort {
  id: string;
  name: string;
  dir: 'in' | 'out';
  width: number;
}

/** 玩家封装出来的模块（模板本体在 worker 侧是完整 ModuleTemplate，这里只留 UI 需要的字段） */
export interface StoredModule {
  hash: string;
  name: string;
  /** 组件库版本管理（M3）：同名模块再次封装时 minor +1，老版本留在库里（复古复用关要用） */
  version: string;
  /** 产出这一版时的阶段（阶段 3 的层级复用会按阶段过滤） */
  stage: number;
  costHalf: number;
  isSequential: boolean;
  ports: StoredPort[];
  /** 完整模板（可结构化克隆的纯 JSON），回传给 worker 建库 */
  template: unknown;
  /** 溯源：这一版是在哪一关产出的 */
  levelId?: string;
  /** 溯源树的子节点：封装时用到的下层模块哈希 */
  sources: string[];
  createdAt: number;
}

export interface Sym {
  id: string;
  kind: SymKind;
  unit?: UnitKind;
  /** kind === 'module'：引用 StoredModule.hash */
  module?: string;
  x: number;
  y: number;
  rot: Rot;
  /** kind === 'input' 的当前驱动 */
  value?: InputDrive;
  /** 端口位宽（input/output；缺省 1 位，第三章总线可 >1） */
  width?: number;
  label: string;
  /** 关卡内建模块（不可删除/编辑的库元件）标记 */
  locked?: boolean;
  /**
   * 教学关实物图标：input 端口画成按钮（按下=1）、output 画成灯泡/铃铛/门
   * （由信号驱动状态：亮/响/开=1）。普通关卡没有 sprite，维持抽象端口。
   */
  sprite?: 'button' | 'lamp' | 'bell' | 'door' | 'battery';
  /** input 端口瞬时按键：点击 = 电平 1，自动弹回 0（画成按钮 sprite） */
  button?: boolean;
  /** output 端口显示形态：画成七段数码管（按端口值 BCD 0-9 点亮段） */
  display?: SymDisplay;
}

export interface Wire {
  id: string;
  a: PinRef;
  b: PinRef;
}

export type BackdropKind = 'wall' | 'doorFrame';

/** 教学关场景背景（装饰，不参与电路）：墙 / 门洞，画在元件与导线之下 */
export interface BackdropItem {
  kind: BackdropKind;
  /** 左上角世界坐标（与元件同一坐标系） */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Doc {
  id: string;
  name: string;
  syms: Sym[];
  wires: Wire[];
  library: StoredModule[];
  /** 教学关场景背景（普通关卡没有） */
  backdrop?: BackdropItem[];
}

/** 画布上「待放置」的元件类型（左侧组件库 → 画布） */
export type PlaceKind =
  | { kind: 'unit'; unit: UnitKind }
  | { kind: 'vcc' }
  | { kind: 'gnd' }
  | { kind: 'input' }
  | { kind: 'output' }
  | { kind: 'button' }
  | { kind: 'segment' }
  | { kind: 'module'; hash: string };

export const UNIT_LABEL: Record<UnitKind, string> = {
  npn: '三极管',
  res: '电阻',
  dio: '二极管',
  cap: '电容',
  nmos: 'N-MOS',
  pmos: 'P-MOS',
};

export const EMPTY_DOC: Doc = {
  id: 'scratch',
  name: '未命名电路',
  syms: [],
  wires: [],
  library: [],
};

/** 引脚相对符号中心的偏移（旋转 0 时） */
const PIN_OFFSETS: Record<string, Array<{ name: string; x: number; y: number }>> = {
  npn: [
    { name: 'c', x: 0, y: -26 },
    { name: 'b', x: -26, y: 0 },
    { name: 'e', x: 0, y: 26 },
  ],
  nmos: [
    { name: 'd', x: 0, y: -26 },
    { name: 'g', x: -26, y: 0 },
    { name: 's', x: 0, y: 26 },
  ],
  pmos: [
    { name: 'd', x: 0, y: -26 },
    { name: 'g', x: -26, y: 0 },
    { name: 's', x: 0, y: 26 },
  ],
  res: [
    { name: 'a', x: 0, y: -22 },
    { name: 'b', x: 0, y: 22 },
  ],
  dio: [
    { name: 'a', x: -22, y: 0 },
    { name: 'k', x: 22, y: 0 },
  ],
  cap: [
    { name: 'a', x: -14, y: 0 },
    { name: 'b', x: 14, y: 0 },
  ],
  vcc: [{ name: 'p', x: 0, y: 14 }],
  gnd: [{ name: 'p', x: 0, y: -14 }],
  input: [{ name: 'p', x: 26, y: 0 }],
  output: [{ name: 'p', x: -26, y: 0 }],
};

const MODULE_PORT_SPACING = 24;
/** 模块方框半宽（绘制引线起点用） */
export const MODULE_HALF_WIDTH = 46;
/** 模块引脚从方框边缘向外引出的长度（导线接在引线外端） */
export const MODULE_PIN_LEAD = 12;
/** 多 bit 端口每个 lane 的纵向间距（8 位 ≈ 7×14 = 98px 高） */
const LANE_PITCH = 14;

export function symKindKey(sym: Sym): string {
  return sym.kind === 'unit' ? (sym.unit as string) : sym.kind;
}

/** 端口/模块端口的位宽（input/output 看 sym.width；模块看模板端口，最宽的那个） */
export function symWidth(sym: Sym, library: StoredModule[] = []): number {
  if (sym.kind === 'input' || sym.kind === 'output') return sym.width ?? 1;
  if (sym.kind === 'module') {
    const stored = library.find((m) => m.hash === sym.module);
    return stored ? Math.max(1, ...stored.ports.map((p) => p.width)) : 1;
  }
  return 1;
}

/** 该符号的引脚名列表（模块按模板端口展开，M0 只支持 1 位端口） */
export function pinNames(sym: Sym, library: StoredModule[] = []): string[] {
  if (sym.kind === 'module') {
    const stored = library.find((m) => m.hash === sym.module);
    return stored ? stored.ports.map((p) => p.name) : [];
  }
  return (PIN_OFFSETS[symKindKey(sym)] ?? []).map((p) => p.name);
}

function rotate(x: number, y: number, rot: Rot): { x: number; y: number } {
  switch (rot) {
    case 1:
      return { x: -y, y: x };
    case 2:
      return { x: -x, y: -y };
    case 3:
      return { x: y, y: -x };
    default:
      return { x, y };
  }
}

/** 引脚偏移（世界坐标，未加符号位置）。多 bit 端口按位展开：同名引脚、bit 区分 */
export function pinOffsets(
  sym: Sym,
  library: StoredModule[] = [],
): Array<{ name: string; x: number; y: number; bit?: number }> {
  if (sym.kind === 'input' || sym.kind === 'output') {
    const width = sym.width ?? 1;
    const base = PIN_OFFSETS[symKindKey(sym)] ?? [];
    const out: Array<{ name: string; x: number; y: number; bit?: number }> = [];
    for (const p of base) {
      if (width <= 1) {
        const r = rotate(p.x, p.y, sym.rot);
        out.push({ name: p.name, x: r.x, y: r.y, bit: 0 });
      } else {
        for (let bit = 0; bit < width; bit++) {
          const laneY = (bit - (width - 1) / 2) * LANE_PITCH;
          const r = rotate(p.x, laneY, sym.rot);
          out.push({ name: p.name, x: r.x, y: r.y, bit });
        }
      }
    }
    // 教学关的灯（output + lamp 图标）是「真两脚器件」：p 接输出信号、g 接公共地，
    // 让高中生直接看到「回路」（半成品会预置一根 g→GND 的地线）。判定只看 p 的电平，
    // g 是地端、通常接 GND；接不接都不影响判定，但默认布局会接好。
    if (sym.kind === 'output' && sym.sprite === 'lamp') {
      const r = rotate(0, 26, sym.rot);
      out.push({ name: 'g', x: r.x, y: r.y, bit: 0 });
    }
    return out;
  }
  if (sym.kind !== 'module') {
    const base = PIN_OFFSETS[symKindKey(sym)] ?? [];
    return base.map((p) => {
      const r = rotate(p.x, p.y, sym.rot);
      return { name: p.name, x: r.x, y: r.y, bit: 0 };
    });
  }
  const stored = library.find((m) => m.hash === sym.module);
  if (!stored) return [];
  const ins = stored.ports.filter((p) => p.dir === 'in');
  const outs = stored.ports.filter((p) => p.dir === 'out');
  const rows = Math.max(ins.length, outs.length, 1);
  const height = (rows - 1) * MODULE_PORT_SPACING;
  const lane = (port: {
    name: string;
    width: number;
  }): Array<{ name: string; x: number; y: number; bit: number }> => {
    const count = Math.max(1, port.width);
    const out: Array<{ name: string; x: number; y: number; bit: number }> = [];
    for (let bit = 0; bit < count; bit++) {
      out.push({
        name: port.name,
        x: 0,
        y: (bit - (count - 1) / 2) * LANE_PITCH,
        bit,
      });
    }
    return out;
  };
  // 模块引脚从方框边缘向外引出（导线接引线外端），并随 sym.rot 旋转 ——
  // 与 input/output/unit 分支一致（绘制侧统一走 rot:0 + ctx.rotate，见 render.ts）。
  const inPins = ins.flatMap((port, i) =>
    lane(port).map((p) => ({
      ...p,
      x: -(MODULE_HALF_WIDTH + MODULE_PIN_LEAD),
      y: p.y + i * MODULE_PORT_SPACING - height / 2,
    })),
  );
  const outPins = outs.flatMap((port, i) =>
    lane(port).map((p) => ({
      ...p,
      x: MODULE_HALF_WIDTH + MODULE_PIN_LEAD,
      y: p.y + i * MODULE_PORT_SPACING - height / 2,
    })),
  );
  return [...inPins, ...outPins].map((p) => {
    const r = rotate(p.x, p.y, sym.rot);
    return { ...p, x: r.x, y: r.y };
  });
}

export function moduleBox(sym: Sym, library: StoredModule[] = []): { w: number; h: number } {
  const stored = library.find((m) => m.hash === sym.module);
  const rows = stored
    ? Math.max(
        stored.ports.filter((p) => p.dir === 'in').length,
        stored.ports.filter((p) => p.dir === 'out').length,
        2,
      )
    : 2;
  return { w: MODULE_HALF_WIDTH * 2, h: Math.max(56, (rows - 1) * MODULE_PORT_SPACING + 40) };
}

export function pinPos(
  sym: Sym,
  pin: string,
  library: StoredModule[] = [],
  bit = 0,
): { x: number; y: number } | null {
  const off = pinOffsets(sym, library).find((p) => p.name === pin && (p.bit ?? 0) === bit);
  if (!off) return null;
  return { x: sym.x + off.x, y: sym.y + off.y };
}

export function pinKey(p: PinRef): string {
  return `${p.inst}.${p.pin}[${p.bit}]`;
}

export function samePin(a: PinRef, b: PinRef): boolean {
  return a.inst === b.inst && a.pin === b.pin && (a.bit ?? 0) === (b.bit ?? 0);
}

export function findSym(doc: Doc, id: string): Sym | undefined {
  return doc.syms.find((s) => s.id === id);
}

/** 判断某引脚是否已经有导线（用来提示「这个引脚还没接线」） */
export function isPinConnected(doc: Doc, pin: PinRef): boolean {
  return doc.wires.some((w) => samePin(w.a, pin) || samePin(w.b, pin));
}

/** 生成不与现有符号冲突的 id：npn1 / res2 / vcc3 ... */
export function nextId(doc: Doc, prefix: string): string {
  let n = 1;
  const used = new Set(doc.syms.map((s) => s.id));
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

const PREFIX: Record<string, string> = {
  npn: 'q',
  res: 'r',
  dio: 'd',
  cap: 'c',
  nmos: 'm',
  pmos: 'm',
  vcc: 'vcc',
  gnd: 'gnd',
  input: 'in',
  output: 'out',
  module: 'u',
};

export function createSym(
  doc: Doc,
  kind: SymKind,
  unit: UnitKind | undefined,
  x: number,
  y: number,
  module?: string,
): Sym {
  const key = kind === 'unit' ? (unit as string) : kind;
  const id = nextId(doc, PREFIX[key] ?? 'x');
  const label =
    kind === 'input' || kind === 'output'
      ? id
      : `${(PREFIX[key] ?? 'x').toUpperCase()}${id.replace(/\D/g, '')}`;
  const sym: Sym = { id, kind, x, y, rot: 0, label };
  if (unit) sym.unit = unit;
  if (module) {
    sym.module = module;
    const stored = doc.library.find((m) => m.hash === module);
    if (stored) sym.label = stored.name;
  }
  if (kind === 'input') sym.value = 0;
  return sym;
}

/** 器件专用编号：端口名（label）就是导出后的端口名，必须全局唯一（btn1/btn2…、seg1/seg2…） */
function nextDeviceLabel(doc: Doc, prefix: string): string {
  const used = new Set(doc.syms.map((s) => s.label));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/**
 * 放置「按钮」/「七段数码管」器件：
 * - 按钮 = 输入端口 + button 标志 + sprite 'button'（点击 = 电平 1，400ms 自动弹回 0）；
 * - 数码管 = 输出端口 + display 'segment' + 4 位位宽（按端口值 BCD 0-9 点亮段）。
 * 与关卡锁定端口同构（同一个 Sym 字段），导出后就是普通端口，判定侧零改动。
 */
export function createDeviceSym(doc: Doc, kind: 'button' | 'segment', x: number, y: number): Sym {
  if (kind === 'button') {
    const sym = createSym(doc, 'input', undefined, x, y);
    return { ...sym, label: nextDeviceLabel(doc, 'btn'), button: true, sprite: 'button' };
  }
  const sym = createSym(doc, 'output', undefined, x, y);
  return { ...sym, label: nextDeviceLabel(doc, 'seg'), display: 'segment', width: 4 };
}

/**
 * 导出成 @lc/schema 的 Design。
 * 只把「已连线的引脚」和「端口符号的引脚」纳入网络：
 * 单独悬空的引脚不建网络，编译器才能如实报出 unconnected-pin 警告（教学反馈）。
 */
export function toDesign(doc: Doc, options: { id?: string; name?: string } = {}): Design {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    let cur = k;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) as string;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const portsPins: PinRef[] = [];
  for (const sym of doc.syms) {
    if (sym.kind !== 'input' && sym.kind !== 'output') continue;
    const width = sym.width ?? 1;
    for (let bit = 0; bit < width; bit++) {
      const pin: PinRef = { inst: sym.id, pin: 'p', bit };
      parent.set(pinKey(pin), pinKey(pin));
      portsPins.push(pin);
    }
  }
  for (const wire of doc.wires) {
    // 不能无条件 parent.set(a, a)：那会把「同一引脚的后续导线」已建立的合并关系清掉
    // （例如 q1.c 同时连 R2 和 Q2 时，先连的那条会被孤立成单独网络）。
    union(pinKey(wire.a), pinKey(wire.b));
  }

  // 按出现顺序分组，保证导出结果稳定（同一份画布永远得到同一个内容哈希）
  const groups = new Map<string, PinRef[]>();
  const order: string[] = [];
  for (const sym of doc.syms) {
    for (const off of pinOffsets(sym, doc.library)) {
      const pin: PinRef = { inst: sym.id, pin: off.name, bit: off.bit ?? 0 };
      const key = pinKey(pin);
      if (!parent.has(key)) continue;
      const root = find(key);
      if (!groups.has(root)) {
        groups.set(root, []);
        order.push(root);
      }
      (groups.get(root) as PinRef[]).push(pin);
    }
  }

  const netOf = new Map<string, string>();
  const nets: Array<{ id: string; pins: PinRef[] }> = [];
  order.forEach((root, index) => {
    const netId = `n${index + 1}`;
    const pins = groups.get(root) as PinRef[];
    nets.push({
      id: netId,
      pins: pins.map((p) => ({ inst: p.inst, pin: p.pin, bit: p.bit ?? 0 })),
    });
    for (const p of pins) netOf.set(pinKey(p), netId);
  });

  const instances: Instance[] = [];
  for (const sym of doc.syms) {
    if (sym.kind === 'unit' && sym.unit) {
      instances.push({
        kind: 'unit',
        id: sym.id,
        unit: sym.unit,
        label: sym.label,
        pos: { x: sym.x, y: sym.y },
      });
    } else if (sym.kind === 'vcc') {
      instances.push({ kind: 'vcc', id: sym.id, label: sym.label, pos: { x: sym.x, y: sym.y } });
    } else if (sym.kind === 'gnd') {
      instances.push({ kind: 'gnd', id: sym.id, label: sym.label, pos: { x: sym.x, y: sym.y } });
    } else if (sym.kind === 'module' && sym.module) {
      instances.push({
        kind: 'module',
        id: sym.id,
        module: sym.module,
        label: sym.label,
        pos: { x: sym.x, y: sym.y },
      });
    }
  }

  const ports: Port[] = [];
  for (const sym of doc.syms) {
    if (sym.kind !== 'input' && sym.kind !== 'output') continue;
    const width = sym.width ?? 1;
    const nets: string[] = [];
    for (let bit = 0; bit < width; bit++) {
      const netId = netOf.get(pinKey({ inst: sym.id, pin: 'p', bit }));
      if (!netId) {
        nets.length = 0;
        break;
      }
      nets.push(netId);
    }
    if (nets.length !== width) continue;
    ports.push({
      id: sym.id,
      name: sym.label,
      dir: sym.kind === 'input' ? 'in' : 'out',
      width,
      nets,
    });
  }

  return {
    schemaVersion: 1,
    id: options.id ?? doc.id,
    name: options.name ?? doc.name,
    instances,
    nets,
    ports,
  };
}

/** 关卡输入引脚 → 仿真输入（0/1/X/Z） */
export function inputValues(doc: Doc): Record<string, 0 | 1 | 2 | 3> {
  const out: Record<string, 0 | 1 | 2 | 3> = {};
  for (const sym of doc.syms) {
    if (sym.kind !== 'input') continue;
    const width = sym.width ?? 1;
    if (width <= 1) {
      out[sym.label] = sym.value ?? 0;
    } else {
      // 多 bit 输入端口：整个端口共用一个驱动值，展开成逐位 lane 键（与编译器命名一致）
      for (let bit = 0; bit < width; bit++) out[`${sym.label}[${bit}]`] = sym.value ?? 0;
    }
  }
  return out;
}

/** 元件的「输入引脚」名单（用于信号流分层；模块按模板端口，模板缺失时当作全输入）。
 *  npn 把集电极 c 也算输入：共射电路里 c 接上拉电阻，深度计算才能把
 *  电阻排在三极管上游（VCC→R→Q→GND 顺流而下），否则同层按字母序会排反，
 *  一键答案变成 S 形绕线。 */
const UNIT_INPUT_PINS: Record<string, string[]> = {
  npn: ['b', 'c'],
  res: ['a'],
  dio: ['a'],
  nmos: ['g', 'd'],
  pmos: ['g', 'd'],
  cap: ['a'],
};

/**
 * 把 Design（网表）还原成画布 Doc ——「一键出答案」等调试功能用。
 *
 * - 端口沿用 baseDoc（docForLevel）里预置的 input/output（含位宽与锁定），按端口名匹配；
 * - 元件按「信号流深度」自动分列排布（输入在左、输出在右），VCC 摆顶行、GND 摆底行；
 * - 每个 Net 的多个引脚按链式两两连线（与 toDesign 的并查集合并互为逆操作）。
 *
 * 注意 syms 的**顺序**：必须端口按 design.ports 序、实例按 design.instances 原序
 * （只影响画布位置，不影响导出）。因为 flatten 的节点编号跟着「端口序 + 实例序」走，
 * 反馈电路（锁存器）的收敛结果对评估顺序敏感 —— 顺序乱了，同一个电路会判成另一个状态。
 */
export function fromDesign(design: Design, baseDoc: Doc): Doc {
  // 1) 端口：保留 baseDoc 的 input/output sym（按 label 匹配设计端口），去掉 rail（参考解自带电源实例）
  const portByLabel = new Map<string, Sym>();
  for (const s of baseDoc.syms) {
    if (s.kind === 'input' || s.kind === 'output') portByLabel.set(s.label, s);
  }

  const netById = new Map(design.nets.map((n) => [n.id, n]));
  const instById = new Map(design.instances.map((i) => [i.id, i]));

  // 各实例的「输出侧引脚」：模块 out 端口；npn/nmos/pmos 的集电极/漏极；电源 p。
  // 电阻/二极管/电容是过流元件（信号穿过），两端都算可传播深度的驱动方。
  const outPinsCache = new Map<string, Set<string>>();
  const outputPinsOf = (inst: Instance): Set<string> => {
    let s = outPinsCache.get(inst.id);
    if (s) return s;
    if (inst.kind === 'module') {
      s = new Set(
        (baseDoc.library
          .find((m) => m.hash === inst.module)
          ?.ports.filter((p) => p.dir === 'out')
          .map((p) => p.name) ?? []),
      );
    } else if (inst.kind === 'unit') {
      s = new Set(
        inst.unit === 'npn' ? ['c'] : inst.unit === 'nmos' || inst.unit === 'pmos' ? ['d'] : ['a', 'b'],
      );
    } else {
      s = new Set(['p']); // vcc / gnd
    }
    outPinsCache.set(inst.id, s);
    return s;
  };
  /** 实例在网 N 上是否有输出侧引脚（即 N 是否由它驱动） */
  const drivesNet = (instId: string, net: { pins: Array<{ inst: string; pin: string }> }): boolean => {
    const inst = instById.get(instId);
    if (!inst) return false;
    const outs = outputPinsOf(inst);
    return net.pins.some((p) => p.inst === instId && outs.has(p.pin));
  };

  // 2) 信号流深度：端口与电源（depth 0）出发松弛；含反馈环的电路最多迭代 128 轮。
  //    关键约束：**深度必须封顶**（MAX_DEPTH）——carry 链这类共享网/回环会让"最长路径"
  //    在 128 轮内链式暴涨到几千层，画布会拉成一条横向长龙。封顶后它只是一个布局分组依据，
  //    不追求精确最长路径。用上一轮快照（雅可比）推进，避免同轮内链式暴涨。
  const MAX_DEPTH = 16;
  const depthOf = new Map<string, number>();
  for (const inst of design.instances) {
    // 显式初始化：电源 0、其余 1 ——「真实深度 1」不能和「未知」混为一个值
    depthOf.set(inst.id, inst.kind === 'vcc' || inst.kind === 'gnd' ? 0 : 1);
  }
  const portFedNets = new Set<string>(design.ports.flatMap((p) => p.nets));
  const inputNetsOf = (inst: Instance): string[] => {
    const inputPins = new Set<string>(
      inst.kind === 'module'
        ? (baseDoc.library
            .find((m) => m.hash === inst.module)
            ?.ports.filter((p) => p.dir === 'in')
            .map((p) => p.name) ?? [])
        : (UNIT_INPUT_PINS[inst.kind === 'unit' ? inst.unit : ''] ?? []),
    );
    const out: string[] = [];
    for (const net of design.nets) {
      if (net.pins.some((pin) => pin.inst === inst.id && inputPins.has(pin.pin))) out.push(net.id);
    }
    return out;
  };
  let prev = new Map(depthOf);
  for (let pass = 0; pass < 128; pass++) {
    let changed = false;
    for (const inst of design.instances) {
      if (inst.kind === 'vcc' || inst.kind === 'gnd') continue;
      let d = prev.get(inst.id) ?? 1;
      for (const netId of inputNetsOf(inst)) {
        if (portFedNets.has(netId)) {
          // 端口直连：深度至少 1；但输出端口网往往同时被元件驱动（如 y 网既有
          // out-y 端口又有上拉电阻），不能 continue 跳过，否则电阻的深度传不到
          // 三极管，一键答案会把 R/Q 排反（S 形绕线）。
          if (d < 1) d = 1;
        }
        const net = netById.get(netId);
        if (!net) continue;
        for (const pin of net.pins) {
          if (pin.inst === inst.id) continue;
          // 端口直连网（如 ALU 的 op 共享网）上可能有多个「同吃一个输入」的消费方
          // （模块输入脚、基极），它们不驱动这个网——跳过，否则共享输入会让整条链
          // 虚涨到封顶深度（反馈假象），把没有反馈的电路也排成一列。
          // 电阻等过流元件与真正的输出侧引脚（集电极/漏极/模块 out 端口）仍计入，
          // 与上面的 R/Q 约定保持一致。
          if (portFedNets.has(netId) && !drivesNet(pin.inst, net)) continue;
          const other = prev.get(pin.inst);
          if (other !== undefined) d = Math.max(d, Math.min(other + 1, MAX_DEPTH));
        }
      }
      if (d !== prev.get(inst.id)) {
        depthOf.set(inst.id, d);
        changed = true;
      }
    }
    prev = new Map(depthOf);
    if (!changed) break;
  }

  // 3) 布局（只算坐标，syms 顺序另行决定）：**同深度同列**——深度相同的实例
  //    放同一列，列从左到右 = 从浅到深（输入在左输出在右）。单列超过 MAX_ROWS
  //    （≈ 一屏）时，把超深的深度组**拆成多列并尽量均分**（每列 ≤ MAX_ROWS），
  //    避免大电路排成一条竖长龙；拆分/合并不改变左→右的深度单调性。
  //    注意：深度只作分组依据，不追求精确最长路径（封顶 MAX_DEPTH，见上）。
  const MAX_ROWS = 10;
  const sorted = [...design.instances].sort((a, b) => {
    const da = depthOf.get(a.id) ?? 0;
    const db = depthOf.get(b.id) ?? 0;
    return da !== db ? da - db : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  // 按深度分组（保持组内 id 序）；同深度组 = 一列（或拆成几列）
  const columns: Instance[][] = [];
  let lastDepth = Number.NaN;
  for (const inst of sorted) {
    if (inst.kind === 'vcc' || inst.kind === 'gnd') continue; // 电源单独排
    const d = depthOf.get(inst.id) ?? 0;
    if (d !== lastDepth) {
      columns.push([]);
      lastDepth = d;
    }
    columns[columns.length - 1]!.push(inst);
  }
  // 超一屏的深度组：拆成 k 列、尽量均分（每列 ≤ MAX_ROWS）
  const balanced: Instance[][] = [];
  for (const g of columns) {
    if (g.length <= MAX_ROWS) {
      balanced.push(g);
      continue;
    }
    const k = Math.ceil(g.length / MAX_ROWS);
    const base = Math.ceil(g.length / k);
    for (let i = 0; i < k; i++) {
      const slice = g.slice(i * base, Math.min((i + 1) * base, g.length));
      if (slice.length) balanced.push(slice);
    }
  }
  // 元件区列起点：把整个元件带（balanced.length 列）居中在左右端口之间，
  // 而不是挤在最左列导致输出端的长线横跨整幅画布。
  const portXs = baseDoc.syms
    .filter((s) => s.kind === 'input' || s.kind === 'output')
    .map((s) => s.x);
  const midX = portXs.length ? (Math.min(...portXs) + Math.max(...portXs)) / 2 : 320;
  const bandW = (balanced.length - 1) * 130 + 92;
  const col0x = Math.round(midX - bandW / 2);
  const posOf = new Map<string, { x: number; y: number }>();
  let bottomY = 0;
  balanced.forEach((col, ci) => {
    col.forEach((inst, ri) => {
      const y = 90 + ri * 92;
      bottomY = Math.max(bottomY, y);
      posOf.set(inst.id, { x: col0x + ci * 130, y });
    });
  });
  // 电源轨：VCC 顶行、GND 底行，横排；多了就分行（每行 MAX_RAIL 个）
  const MAX_RAIL = 10;
  const rails = sorted.filter((i) => i.kind === 'vcc' || i.kind === 'gnd');
  let vccI = 0;
  let gndI = 0;
  for (const inst of rails) {
    const idx = inst.kind === 'vcc' ? vccI++ : gndI++;
    const row = Math.floor(idx / MAX_RAIL);
    const col = idx % MAX_RAIL;
    posOf.set(inst.id, {
      x: col0x + col * 130,
      y: inst.kind === 'vcc' ? 30 + row * 60 : bottomY + 80 + row * 60,
    });
  }

  // 4) syms：先端口（按 design.ports 序），再实例（按 design.instances 原序）——
  //    顺序决定 flatten 的节点编号，反馈电路必须保持原序才能复现参考解的行为。
  const syms: Sym[] = [];
  const matchedPorts = new Set<string>();
  for (const p of design.ports) {
    const sym = portByLabel.get(p.name);
    if (sym) {
      syms.push(sym);
      matchedPorts.add(p.name);
    }
  }
  // 参考解没有的端口（如空设计）回退保留关卡预置端口，画布不至于空掉
  for (const [name, sym] of portByLabel) {
    if (!matchedPorts.has(name)) syms.push(sym);
  }
  for (const inst of design.instances) {
    const pos = posOf.get(inst.id) ?? { x: 120, y: 90 };
    const sym: Sym = {
      id: inst.id,
      kind: inst.kind,
      x: pos.x,
      y: pos.y,
      rot: 0,
      label: inst.label ?? '',
    };
    if (inst.kind === 'unit') {
      sym.unit = inst.unit;
      sym.label = sym.label || UNIT_LABEL[inst.unit];
    } else if (inst.kind === 'module') {
      sym.module = inst.module;
      const stored = baseDoc.library.find((m) => m.hash === inst.module);
      // 参考解的模块实例 label 常是自动编号（G1/G2…），门名才是玩家认得的，优先用门名
      sym.label = stored?.name || sym.label || '模块';
    } else {
      sym.label = inst.kind === 'vcc' ? 'VCC' : 'GND';
    }
    syms.push(sym);
  }

  // 4) Net → 链式导线（端口引脚引用端口 sym id；未知实例的引脚跳过）
  //    Design 里端口靠 port.nets 按名挂网络（网络 pins 不含端口），
  //    画布上端口必须有一条导线接入，否则 toDesign 会把端口导出成孤立网络。
  const portPinByNet = new Map<string, PinRef[]>();
  for (const p of design.ports) {
    const sym = portByLabel.get(p.name);
    if (!sym) continue;
    p.nets.forEach((netId, bit) => {
      const list = portPinByNet.get(netId) ?? [];
      list.push({ inst: sym.id, pin: 'p', bit });
      portPinByNet.set(netId, list);
    });
  }
  const wires: Wire[] = [];
  let wireN = 0;
  for (const net of design.nets) {
    const pins: PinRef[] = [
      ...(portPinByNet.get(net.id) ?? []),
      ...net.pins
        .map((p) => ({ inst: p.inst, pin: p.pin, bit: p.bit ?? 0 }))
        .filter((p) => syms.some((s) => s.id === p.inst)),
    ];
    for (let i = 0; i + 1 < pins.length; i++) {
      wires.push({ id: `w${++wireN}`, a: pins[i] as PinRef, b: pins[i + 1] as PinRef });
    }
  }

  return { ...baseDoc, syms, wires };
}
