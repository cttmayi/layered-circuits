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

export type UnitKind = 'npn' | 'res' | 'dio' | 'cap';
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
  costHalf: number;
  isSequential: boolean;
  ports: StoredPort[];
  /** 完整模板（可结构化克隆的纯 JSON），回传给 worker 建库 */
  template: unknown;
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
  label: string;
  /** 关卡内建模块（不可删除/编辑的库元件）标记 */
  locked?: boolean;
}

export interface Wire {
  id: string;
  a: PinRef;
  b: PinRef;
}

export interface Doc {
  id: string;
  name: string;
  syms: Sym[];
  wires: Wire[];
  library: StoredModule[];
}

/** 画布上「待放置」的元件类型（左侧组件库 → 画布） */
export type PlaceKind =
  | { kind: 'unit'; unit: UnitKind }
  | { kind: 'vcc' }
  | { kind: 'gnd' }
  | { kind: 'input' }
  | { kind: 'output' }
  | { kind: 'module'; hash: string };

export const UNIT_LABEL: Record<UnitKind, string> = {
  npn: '三极管',
  res: '电阻',
  dio: '二极管',
  cap: '电容',
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
const MODULE_HALF_WIDTH = 46;

export function symKindKey(sym: Sym): string {
  return sym.kind === 'unit' ? (sym.unit as string) : sym.kind;
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

/** 引脚偏移（世界坐标，未加符号位置） */
export function pinOffsets(
  sym: Sym,
  library: StoredModule[] = [],
): Array<{ name: string; x: number; y: number }> {
  if (sym.kind !== 'module') {
    const base = PIN_OFFSETS[symKindKey(sym)] ?? [];
    return base.map((p) => {
      const r = rotate(p.x, p.y, sym.rot);
      return { name: p.name, x: r.x, y: r.y };
    });
  }
  const stored = library.find((m) => m.hash === sym.module);
  if (!stored) return [];
  const ins = stored.ports.filter((p) => p.dir === 'in');
  const outs = stored.ports.filter((p) => p.dir === 'out');
  const rows = Math.max(ins.length, outs.length, 1);
  const height = (rows - 1) * MODULE_PORT_SPACING;
  const inPins = ins.map((port, i) => ({
    name: port.name,
    x: -MODULE_HALF_WIDTH,
    y: i * MODULE_PORT_SPACING - height / 2,
  }));
  const outPins = outs.map((port, i) => ({
    name: port.name,
    x: MODULE_HALF_WIDTH,
    y: i * MODULE_PORT_SPACING - height / 2,
  }));
  return [...inPins, ...outPins];
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
): { x: number; y: number } | null {
  const off = pinOffsets(sym, library).find((p) => p.name === pin);
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
    const pin: PinRef = { inst: sym.id, pin: 'p', bit: 0 };
    parent.set(pinKey(pin), pinKey(pin));
    portsPins.push(pin);
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
    for (const name of pinNames(sym, doc.library)) {
      const pin: PinRef = { inst: sym.id, pin: name, bit: 0 };
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
    const netId = netOf.get(pinKey({ inst: sym.id, pin: 'p', bit: 0 }));
    if (!netId) continue;
    ports.push({
      id: sym.id,
      name: sym.label,
      dir: sym.kind === 'input' ? 'in' : 'out',
      width: 1,
      nets: [netId],
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
    if (sym.kind === 'input') out[sym.label] = sym.value ?? 0;
  }
  return out;
}
