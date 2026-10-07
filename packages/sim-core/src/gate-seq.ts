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

import { beginGateCacheBatch, type GateEvalCache, gateCacheKey } from './gate-cache.js';
import {
  B0,
  B1,
  type Bit,
  evalGate,
  isFunctionAtom,
  isGateName,
  mergeDrivers,
  notBit,
} from './gate-logic.js';
import {
  bindInputs,
  evalAtomOutputs,
  type GateLibrary,
  type GateNetlistDesign,
  isPureCombinational,
  makePinIndex,
  needsSeqSpec,
  pinKey,
  readOutPorts,
} from './gate-netlist.js';

export type { GateSeqSpec } from './gate-netlist.js';

const CLK_KEY = '__clk';

const widthOf = (p: { width?: number }): number => Math.max(1, p.width ?? 1);

/** 时序器件的状态：`实例路径/端口#位 → 值`，跨求值步保存 */
export class GateStateStore {
  private readonly values = new Map<string, Bit>();
  private readonly nets = new Map<string, Map<string, Bit>>();

  constructor(initial?: Readonly<Record<string, Bit>>) {
    for (const [k, v] of Object.entries(initial ?? {})) this.values.set(k, v);
  }

  private static key(instId: string, port: string, bit: number): string {
    return `${instId}/${port}#${bit}`;
  }

  /**
   * 清空全部状态（时序器件的值 + 内部网表）。
   *
   * 用途只有一个但很关键：「**上电重来**」——有延迟门级引擎遇到对称自振的环（延迟完全相同的
   * 交叉耦合锁存器）时会按确定性顺序把上电过程重跑一遍（`powerUp:'settle'`）。如果那次重跑
   * 还带着**上一次失败尝试**写进去的中间态，重跑就不是"上电"，而是"接着振"：实测
   * `s2-d-latch` 冷启动（d=1,en=0）在脏状态上重跑收敛到 q=0，在干净状态上是 q=1 —— 同一个
   * 输入两种答案，画布与直调引擎因此对不上。所以重跑前必须 `clear()`。
   */
  clear(): void {
    this.values.clear();
    this.nets.clear();
  }

  get(instId: string, port: string, bit = 0): Bit | undefined {
    return this.values.get(GateStateStore.key(instId, port, bit));
  }

  set(instId: string, port: string, value: Bit, bit = 0): void {
    this.values.set(GateStateStore.key(instId, port, bit), value);
  }

  getPort(instId: string, port: { name: string; width?: number }): Bit[] {
    return Array.from({ length: widthOf(port) }, (_, b) => this.get(instId, port.name, b) ?? B0);
  }

  getClock(instId: string): Bit | undefined {
    return this.values.get(`${instId}/${CLK_KEY}`);
  }

  setClock(instId: string, value: Bit): void {
    this.values.set(`${instId}/${CLK_KEY}`, value);
  }

  /**
   * 按**实例路径**隔离的 net 值表：`路径 → (netId → 值)`。
   * 为什么必须隔离：递归进复合模块时如果用同一张全局表、又按 `prefix + id` 回写，
   * 前缀会层层叠加 → key 无限增长 → Map maximum size exceeded（上一版就是这样炸的）。
   * 这里每层只碰**自己那份**，键不会再叠加。
   */
  netsOf(path: string): Map<string, Bit> {
    let m = this.nets.get(path);
    if (!m) {
      m = new Map();
      this.nets.set(path, m);
    }
    return m;
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
  /** 组合阶段在迭代上限内没稳定下来（组合环/振荡）→ 判定不可信 */
  unstable?: boolean;
}

export const stepGateNetlist = (
  design: GateNetlistDesign,
  library: GateLibrary,
  inputs: ReadonlyMap<string, Bit[]> = new Map(),
  state: GateStateStore = new GateStateStore(),
  /** 递归进复合模块时的实例路径前缀 */
  prefix = '',
  /**
   * 组合模块求值缓存。**只有 settleGateSteps 的递归才会传进来** →
   * 一次 settle 的 8 趟推进共用一个批次（省掉整棵子电路的重复递归，见 gate-cache.ts）；
   * 直接调用本函数则是新的一批（上一批条目作废，不会跨调用串味）。
   */
  cache?: GateEvalCache,
): GateStepOutcome => {
  const evalCache = cache ?? beginGateCacheBatch(library);
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
    if (needsSeqSpec(mod) && !mod.seq) {
      return fail(`时序模块【${mod.name}】没有声明时钟/数据端口（SeqSpec）`);
    }
  }

  const idx = makePinIndex(design);
  // 本层自己的 net 底稿（上一次的值）——**只碰本层**，不碰别的模块
  const prevNets = state.netsOf(prefix);
  for (const [id, v] of prevNets) idx.netValues.set(id, v);
  bindInputs(design, idx, inputs); // 输入端口覆盖自己绑的 net

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
      if (needsSeqSpec(mod)) {
        // 元件级时序器件（D 锁存器 / 主从 D 触发器）：输出 = 当前状态（没记录过就是 Z）
        // 注意：身体是**模块**的时序积木（八位寄存器 / 数字输入寄存器）不走这条路 ——
        // 它们直接递归下钻，所以内部状态、移位、保持逻辑都按电路原样算。
        const base: Bit = mod.seq?.initial === '1' ? B1 : B0;
        const invertedTargets = new Set<string>();
        for (const targets of Object.values(mod.seq?.map ?? {})) {
          for (const t of Array.isArray(targets) ? targets : [targets]) {
            if (t.startsWith('!')) invertedTargets.add(t.slice(1));
          }
        }
        outs.forEach((p) => {
          // **反相输出口**（如 qn）的上电初值必须是初值的互补 ——
          // 实测：s2-dff 首个向量元件级给 qn=0，我原先给 1（与 q 同值）而多出 1 行差异。
          const init: Bit = invertedTargets.has(p.name) ? (base === B1 ? B0 : B1) : base;
          const bits = state
            .getPort(prefix + inst.id, p)
            .map((_v, b) => state.get(prefix + inst.id, p.name, b) ?? init);
          for (let b = 0; b < widthOf(p); b++) {
            // 一个输出脚可以接多条网名（元件级里它们是同一个节点）→ 每条都要拿到驱动
            for (const netId of idx.netsPinTo.get(pinKey(inst.id, p.name, b)) ?? [])
              push(netId, bits[b] ?? 'Z');
          }
        });
        continue;
      }
      const ins = mod.ports.filter((p) => p.dir === 'in');
      const inBits = ins.map((p) => idx.readPort(inst.id, p));
      let outBits: Bit[][] | undefined;
      const atomOut = isFunctionAtom(mod.name)
        ? evalAtomOutputs(mod.name, ins, outs, inBits)
        : null;

      if (atomOut) {
        // 功能原子（全加器 / 多输入或门）：按真值函数算，**不展开元件身体**

        outBits = atomOut;
      } else if (isGateName(mod.name)) {
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
        // 身体里含**元件**的模块 → 门级引擎算不了，如实拒绝（与 gate-netlist 同一口径）
        if (mod.body.instances.some((ci) => ci.kind === 'unit')) {
          return {
            ok: false,
            reason: `模块【${mod.name}】身体里含元件（门级快路只处理纯门/模块电路）`,
          } as GateStepOutcome;
        }
        // ── 组合模块求值缓存（与 gate-netlist 同一口径）──
        // **只对纯组合模块**生效：含时序后代的身体（八位寄存器 / 数字输入寄存器）一律不缓存，
        // 那种身体的输出还取决于上一向量留下的状态，缓存会把上一向量的结果算错。
        const hash = inst.module;
        const pure = hash !== undefined && isPureCombinational(mod, library);
        const key = pure ? gateCacheKey(hash, inBits) : '';
        const hit = pure ? evalCache.lookup(hash, key) : undefined;
        if (hit) {
          outBits = hit;
        } else {
          const inner = stepGateNetlist(
            mod.body,
            library,
            inMap,
            state,
            `${prefix}${inst.id}/`,
            evalCache,
          );
          if (!inner.ok)
            return {
              ...inner,
              nets: idx.netValues,
              outPorts: new Map(),
              updates: [],
              clocked: false,
            };
          outBits = outs.map((p) => inner.outPorts.get(p.name) ?? []);
          // 它自己也递归出组合环（不稳定）时不缓存，与 gate-netlist 保持一致
          if (pure) evalCache.store(hash, key, outBits, inner.unstable !== true);
        }
      }
      outs.forEach((p, i) => {
        for (let b = 0; b < widthOf(p); b++) {
          // 一个输出脚可以接多条网名（元件级里它们是同一个节点）→ 每条都要拿到驱动
          for (const netId of idx.netsPinTo.get(pinKey(inst.id, p.name, b)) ?? [])
            push(netId, outBits?.[i]?.[b] ?? 'X');
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

  // 组合环在迭代上限内没稳定 → **保持上一次的状态**（零延迟仿真的标准做法）。
  // 用门搭的锁存器就是这种情况：没有有效激励时它不该改变，只有回路收敛时才接受新值。
  if (!settled) {
    for (const net of design.nets) {
      const prev = prevNets.get(net.id);
      if (prev !== undefined) idx.netValues.set(net.id, prev);
    }
  }

  // ── ② 更新阶段 ──
  const updates: string[] = [];
  for (const inst of design.instances) {
    if (inst.kind !== 'module') continue;
    const mod = inst.module ? library.get(inst.module) : undefined;
    const spec = mod?.seq;
    if (!mod || !needsSeqSpec(mod) || !spec) continue;
    const clockNow = idx.readBit(inst.id, spec.clock, 0);
    const clockPrev = state.getClock(prefix + inst.id) ?? 'Z';
    const active = spec.mode === 'level' ? clockNow === 1 : clockPrev === 0 && clockNow === 1;
    if (active) {
      const outs = mod.ports.filter((p) => p.dir === 'out');
      const sole = spec.data.length === 1 && outs.length === 1 ? outs[0]?.name : undefined;
      for (const dataPort of spec.data) {
        // 关键：要拿**端口对象**读，才能带上位宽（只按名字读会默认 1 位，总线就会漏位）
        const srcPort: { name: string; width?: number } = mod.ports.find(
          (p) => p.name === dataPort,
        ) ?? { name: dataPort };
        const src = idx.readPort(inst.id, srcPort);
        const mapped = spec.map?.[dataPort];
        const targets =
          mapped === undefined ? [sole ?? dataPort] : Array.isArray(mapped) ? mapped : [mapped];
        for (const raw of targets) {
          const invert = raw.startsWith('!'); // qn 这类反相输出
          const target = invert ? raw.slice(1) : raw;
          const dstPort: { name: string; width?: number } = mod.ports.find(
            (p) => p.name === target,
          ) ?? { name: target };
          for (let b = 0; b < widthOf(dstPort); b++) {
            const v = src[b] ?? 'X';
            state.set(prefix + inst.id, target, invert ? notBit(v) : v, b);
            updates.push(
              `${prefix}${inst.id}/${target}#${b}=${String(state.get(prefix + inst.id, target, b))}`,
            );
          }
        }
      }
    }
    state.setClock(prefix + inst.id, clockNow);
  }

  for (const net of design.nets) {
    const v = idx.netValues.get(net.id);
    if (v !== undefined) prevNets.set(net.id, v);
  }
  return {
    ok: true,
    nets: idx.netValues,
    outPorts: readOutPorts(design, idx),
    unstable: !settled,
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
  // 一次 settle = **一批**缓存：8 趟推进共用（顶层模块纯组合时，输入没变就直接命中，
  // 不再整棵树重算一遍）。批次在 settle 开始时开，结束即作废，不会跨调用串味。
  const cache = beginGateCacheBatch(library);
  let out = stepGateNetlist(design, library, inputs, state, '', cache);
  if (!out.ok) return out;
  const key = (o: GateStepOutcome): string =>
    [...o.outPorts.entries()].map(([k, v]) => `${k}:${v.map(String).join('')}`).join('|');
  let prev = key(out);
  for (let pass = 1; pass < maxPasses; pass++) {
    out = stepGateNetlist(design, library, inputs, state, '', cache);
    if (!out.ok) return out;
    const now = key(out);
    if (now === prev) return out;
    prev = now;
  }
  return out;
};
