/**
 * 逻辑版门级引擎第 3 步：**时序器件 = 状态元件**（零延迟逻辑仿真的标准模型），支持总线。
 *
 * 为什么必须这样：锁存器/触发器在门这一层是交叉耦合回路（Q = NOR(R, Qbar)，
 * Qbar = NOR(S, Q)，两条式子同时成立）。时序版靠**元件延迟**解开它；逻辑版把延迟抹平后
 * 就是代数环，从任意初值迭代只会每轮翻转、永不收敛。所以逻辑版把"延迟"换成了"状态"。
 *
 * 两阶段：①组合阶段（时序器件输出读**当前状态**，其余门迭代到稳定）
 *        ②更新阶段（电平型 clock=1 透明写入；上升沿型仅 0→1 那一步写入）
 * 单趟不够（电平型锁存器应当"当拍透明"），判定/仿真请用 settleGateSteps()。
 *
 * 状态**按位**保存，并**穿透复合模块递归**（模块内部的触发器用 `外层/内层` 前缀各自占槽）。
 */
import { type Bit, evalGate, isGateName, mergeDrivers } from './gate-logic.js';
import {
  bindInputs,
  type GateLibrary,
  type GateNetlistDesign,
  makePinIndex,
  pinKey,
  readOutPorts,
} from './gate-netlist.js';

export type { GateSeqSpec } from './gate-netlist.js';

const CLK_KEY = '__clk';

const widthOf = (p: { width?: number }): number => Math.max(1, p.width ?? 1);

/** 时序器件的状态：`实例路径/端口#位 → 值`，跨求值步保存 */
export class GateStateStore {
  private readonly values = new Map<string, Bit>();

  constructor(initial?: Readonly<Record<string, Bit>>) {
    for (const [k, v] of Object.entries(initial ?? {})) this.values.set(k, v);
  }

  private static key(instId: string, port: string, bit: number): string {
    return `${instId}/${port}#${bit}`;
  }

  get(instId: string, port: string, bit = 0): Bit | undefined {
    return this.values.get(GateStateStore.key(instId, port, bit));
  }

  set(instId: string, port: string, value: Bit, bit = 0): void {
    this.values.set(GateStateStore.key(instId, port, bit), value);
  }

  getPort(instId: string, port: { name: string; width?: number }): Bit[] {
    return Array.from({ length: widthOf(port) }, (_, b) => this.get(instId, port.name, b) ?? 'Z');
  }

  getClock(instId: string): Bit | undefined {
    return this.values.get(`${instId}/${CLK_KEY}`);
  }

  setClock(instId: string, value: Bit): void {
    this.values.set(`${instId}/${CLK_KEY}`, value);
  }

  snapshot(): Record<string, Bit> {
    return Object.fromEntries(this.values);
  }
}

export interface GateStepOutcome {
  ok: boolean;
  reason?: string;
  nets: Map<string, Bit>;
  outPorts: Map<string, Bit[]>;
  updates: string[];
  clocked: boolean;
}

export const stepGateNetlist = (
  design: GateNetlistDesign,
  library: GateLibrary,
  inputs: ReadonlyMap<string, Bit[]> = new Map(),
  state: GateStateStore = new GateStateStore(),
  /** 递归进复合模块时的实例路径前缀 */
  prefix = '',
): GateStepOutcome => {
  const fail = (reason: string, nets: Map<string, Bit> = new Map()): GateStepOutcome => ({
    ok: false,
    reason,
    nets,
    outPorts: new Map(),
    updates: [],
    clocked: false,
  });

  // 准入门槛：只有元件、缺模块、时序器件没声明 SeqSpec 才回落
  for (const inst of design.instances) {
    if (inst.kind === 'unit') return fail('设计里有元件（门级快路只处理纯模块设计）');
    if (inst.kind !== 'module') continue;
    const mod = inst.module ? library.get(inst.module) : undefined;
    if (!mod) return fail(`库里找不到模块 ${inst.module ?? '?'}`);
    if (mod.isSequential && !mod.seq) {
      return fail(`时序模块【${mod.name}】没有声明时钟/数据端口（SeqSpec）`);
    }
  }

  const idx = makePinIndex(design);
  bindInputs(design, idx, inputs);

  // ── ① 组合阶段 ──
  const MAX_ROUNDS = 64;
  let settled = false;
  for (let rounds = 0; rounds < MAX_ROUNDS && !settled; rounds++) {
    const drivers = new Map<string, Bit[]>();
    const push = (netId: string, v: Bit): void => {
      const list = drivers.get(netId);
      if (list) list.push(v);
      else drivers.set(netId, [v]);
    };
    for (const inst of design.instances) {
      if (inst.kind !== 'module') continue;
      const mod = inst.module ? library.get(inst.module) : undefined;
      if (!mod) return fail('库里找不到模块', idx.netValues);
      const outs = mod.ports.filter((p) => p.dir === 'out');
      if (mod.isSequential) {
        // 时序器件：输出 = 当前状态（没记录过就是 Z，即"上电未定"）
        outs.forEach((p) => {
          const bits = state.getPort(prefix + inst.id, p);
          for (let b = 0; b < widthOf(p); b++) {
            const netId = idx.pinToNet.get(pinKey(inst.id, p.name, b));
            if (netId !== undefined) push(netId, bits[b] ?? 'Z');
          }
        });
        continue;
      }
      const ins = mod.ports.filter((p) => p.dir === 'in');
      const inBits = ins.map((p) => idx.readPort(inst.id, p));
      let outBits: Bit[][];
      if (isGateName(mod.name)) {
        const gateName = mod.name; // 闭包里 narrowing 会失效，先固定成 const
        const w = Math.max(1, ...outs.map((p) => widthOf(p)));
        outBits = outs.map(() =>
          Array.from({ length: w }, (_, b) =>
            evalGate(
              gateName,
              inBits.map((v) => v[b] ?? 'X'),
            ),
          ),
        );
      } else {
        if (!mod.body) return fail(`复合模块【${mod.name}】没有内部电路`, idx.netValues);
        const inMap = new Map<string, Bit[]>();
        ins.forEach((p, i) => {
          inMap.set(p.name, inBits[i] ?? []);
        });
        const inner = stepGateNetlist(mod.body, library, inMap, state, `${prefix}${inst.id}/`);
        if (!inner.ok)
          return {
            ...inner,
            nets: idx.netValues,
            outPorts: new Map(),
            updates: [],
            clocked: false,
          };
        outBits = outs.map((p) => inner.outPorts.get(p.name) ?? []);
      }
      outs.forEach((p, i) => {
        for (let b = 0; b < widthOf(p); b++) {
          const netId = idx.pinToNet.get(pinKey(inst.id, p.name, b));
          if (netId !== undefined) push(netId, outBits[i]?.[b] ?? 'X');
        }
      });
    }

    let changed = false;
    for (const net of design.nets) {
      const list = drivers.get(net.id) ?? [];
      if (list.length === 0) continue;
      const merged = mergeDrivers(list);
      const prev = idx.netValues.get(net.id) ?? 'Z';
      if (merged !== prev) {
        idx.netValues.set(net.id, merged);
        changed = true;
      }
    }
    settled = !changed;
  }

  // ── ② 更新阶段 ──
  const updates: string[] = [];
  for (const inst of design.instances) {
    if (inst.kind !== 'module') continue;
    const mod = inst.module ? library.get(inst.module) : undefined;
    const spec = mod?.seq;
    if (!mod?.isSequential || !spec) continue;
    const clockNow = idx.readBit(inst.id, spec.clock, 0);
    const clockPrev = state.getClock(prefix + inst.id) ?? 'Z';
    const active = spec.mode === 'level' ? clockNow === 1 : clockPrev === 0 && clockNow === 1;
    if (active) {
      const outs = mod.ports.filter((p) => p.dir === 'out');
      const sole = spec.data.length === 1 && outs.length === 1 ? outs[0]?.name : undefined;
      for (const dataPort of spec.data) {
        const target = spec.map?.[dataPort] ?? sole ?? dataPort;
        // 关键：要拿**端口对象**读，才能带上位宽（只按名字读会默认 1 位，总线就会漏位）
        const srcPort: { name: string; width?: number } = mod.ports.find(
          (p) => p.name === dataPort,
        ) ?? { name: dataPort };
        const dstPort: { name: string; width?: number } = mod.ports.find(
          (p) => p.name === target,
        ) ?? { name: target };
        const src = idx.readPort(inst.id, srcPort);
        for (let b = 0; b < widthOf(dstPort); b++) {
          state.set(prefix + inst.id, target, src[b] ?? 'X', b);
          updates.push(
            `${prefix}${inst.id}/${target}#${b}=${String(state.get(prefix + inst.id, target, b))}`,
          );
        }
      }
    }
    state.setClock(prefix + inst.id, clockNow);
  }

  return {
    ok: true,
    nets: idx.netValues,
    outPorts: readOutPorts(design, idx),
    updates,
    clocked: updates.length > 0,
  };
};

/**
 * 反复推进到"输出不再变化"为止 —— 判定/仿真该用的入口。
 * 单趟不够：电平型锁存器在使能有效时应当**当拍透明**，而单趟要到下一趟才看得见新状态。
 * 边沿型在第二趟起因时钟未再跳变而不会重复写入。
 */
export const settleGateSteps = (
  design: GateNetlistDesign,
  library: GateLibrary,
  inputs: ReadonlyMap<string, Bit[]> = new Map(),
  state: GateStateStore = new GateStateStore(),
  maxPasses = 8,
): GateStepOutcome => {
  let out = stepGateNetlist(design, library, inputs, state);
  if (!out.ok) return out;
  const key = (o: GateStepOutcome): string =>
    [...o.outPorts.entries()].map(([k, v]) => `${k}:${v.map(String).join('')}`).join('|');
  let prev = key(out);
  for (let pass = 1; pass < maxPasses; pass++) {
    out = stepGateNetlist(design, library, inputs, state);
    if (!out.ok) return out;
    const now = key(out);
    if (now === prev) return out;
    prev = now;
  }
  return out;
};
