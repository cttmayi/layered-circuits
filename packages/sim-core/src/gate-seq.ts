/**
 * 逻辑版门级引擎第 3 步：**时序器件 = 状态元件**（零延迟逻辑仿真的标准模型）。
 *
 * 为什么必须这样：锁存器/触发器在门这一层是交叉耦合的回路（Q = NOR(R, Qbar)，
 * Qbar = NOR(S, Q)，两条式子同时成立）。时序版靠**元件延迟**解开它（Q 的变化过一会儿才
 * 回到 Qbar），逻辑版把延迟抹平了 → 代数环 → 从任意初值迭代只会每轮翻转，永远不收敛。
 * 所以逻辑版把"延迟"换成了"状态"：**输出读状态，只在时钟有效时把数据写进状态**。
 *
 * 两阶段求值（判定时按测试向量一步步推进）：
 *   ① 组合阶段：所有门的输出按当前输入 + 时序器件的**当前状态**求出（时序器件输出不再回落）；
 *   ② 更新阶段：读回时序器件的数据/时钟输入，满足条件就写入新状态。
 * 状态跨步保存（GateStateStore），所以锁存器能"记住"上一次的值。
 *
 * 时序语义由**调用方**按模块端口给出（SeqSpec），因为"哪个端口是时钟、哪个是数据、是电平型
 * 还是上升沿型"属于内容层的知识，不该硬编码在 sim-core 里。
 */
import { type Bit, evalGate, isGateName, mergeDrivers } from './gate-logic.js';
import type { GateLibrary, GateNetlistDesign, GatePin } from './gate-netlist.js';

/** 时序器件的语义：由调用方按模块端口声明 */
export interface SeqSpec {
  /** 时钟 / 使能端口名 */
  clock: string;
  /** 数据端口名（有效时写入输出） */
  data: readonly string[];
  /** level = 电平型（锁存器，clock 为 1 时透明）；rising = 上升沿型（触发器） */
  mode: 'level' | 'rising';
  /** 数据端口 → 输出端口 的对应；缺省同名 */
  map?: Readonly<Record<string, string>>;
}

const CLK_KEY = '__clk';

/** 时序器件的状态：`实例/端口 → 值`，跨求值步保存 */
export class GateStateStore {
  private readonly values = new Map<string, Bit>();

  constructor(initial?: Readonly<Record<string, Bit>>) {
    for (const [k, v] of Object.entries(initial ?? {})) this.values.set(k, v);
  }

  get(instId: string, port: string): Bit | undefined {
    return this.values.get(`${instId}/${port}`);
  }

  set(instId: string, port: string, value: Bit): void {
    this.values.set(`${instId}/${port}`, value);
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
  /** net id → 值（组合阶段的结果） */
  nets: Map<string, Bit>;
  /** 端口名 → 各位的值 */
  outPorts: Map<string, Bit[]>;
  /** 本次真正被写入的状态（调试/断言用，形如 `inst/port=1`） */
  updates: string[];
  /** 本轮是否发生了状态写入（时钟沿/使能命中） */
  clocked: boolean;
}

const pinKey = (inst: string, pin: string, bit = 0): string => `${inst}/${pin}/${bit}`;

interface Prepared {
  pinToNet: Map<string, string>;
  netValues: Map<string, Bit>;
  read: (inst: string, pin: string) => Bit;
}

const prepare = (design: GateNetlistDesign, inputs: ReadonlyMap<string, Bit[]>): Prepared => {
  const pinToNet = new Map<string, string>();
  for (const net of design.nets) {
    for (const ref of net.pins as readonly GatePin[])
      pinToNet.set(pinKey(ref.inst, ref.pin), net.id);
  }
  const netValues = new Map<string, Bit>();
  for (const port of design.ports) {
    if (port.dir !== 'in') continue;
    const vals = inputs.get(port.name) ?? [];
    for (const [i, netId] of port.nets.entries()) netValues.set(netId, vals[i] ?? 'Z');
  }
  const read = (inst: string, pin: string): Bit => {
    const netId = pinToNet.get(pinKey(inst, pin));
    if (netId === undefined) return 'Z';
    return netValues.get(netId) ?? 'Z';
  };
  return { pinToNet, netValues, read };
};

/**
 * 一步求值：组合阶段 + 状态更新阶段。
 * `state` 会被就地更新（同一个 store 传进来，锁存器才能"记住"）。
 */
export const stepGateNetlist = (
  design: GateNetlistDesign,
  library: GateLibrary,
  inputs: ReadonlyMap<string, Bit[]> = new Map(),
  state: GateStateStore = new GateStateStore(),
  /** 递归进复合模块时的实例路径前缀：让模块**内部**的时序器件也有自己的状态槽 */
  prefix = '',
): GateStepOutcome => {
  // 注意：这里**不能**用 gate-netlist 的 gateFastPathCheck —— 那是组合快路的准入检查，
  // 它会把时序模块判成"不支持"。门级时序引擎的准入门槛只有两条：有元件、或库里缺模块。
  for (const inst of design.instances) {
    if (inst.kind === 'unit') {
      return {
        ok: false,
        reason: '设计里有元件（门级快路只处理纯模块设计）',
        nets: new Map(),
        outPorts: new Map(),
        updates: [],
        clocked: false,
      };
    }
    if (inst.kind === 'module' && !(inst.module && library.get(inst.module))) {
      return {
        ok: false,
        reason: `库里找不到模块 ${inst.module ?? '?'}`,
        nets: new Map(),
        outPorts: new Map(),
        updates: [],
        clocked: false,
      };
    }
  }

  const { pinToNet, netValues, read } = prepare(design, inputs);
  // 时序器件若没声明 SeqSpec，就是内容层的遗漏 —— 如实回落，不猜端口
  for (const inst of design.instances) {
    if (inst.kind !== 'module') continue;
    const mod = inst.module ? library.get(inst.module) : undefined;
    if (mod?.isSequential && !mod.seq) {
      return {
        ok: false,
        reason: `时序模块【${mod.name}】没有声明时钟/数据端口（SeqSpec）`,
        nets: netValues,
        outPorts: new Map(),
        updates: [],
        clocked: false,
      };
    }
  }

  // ── ① 组合阶段：迭代到稳定（时序器件输出读"当前状态"）──
  const MAX_ROUNDS = 64;
  let settled = false;
  let rounds = 0;
  for (; rounds < MAX_ROUNDS && !settled; rounds++) {
    const drivers = new Map<string, Bit[]>();
    const push = (netId: string, v: Bit): void => {
      const list = drivers.get(netId);
      if (list) list.push(v);
      else drivers.set(netId, [v]);
    };

    for (const inst of design.instances) {
      if (inst.kind !== 'module') continue;
      const mod = inst.module ? library.get(inst.module) : undefined;
      if (!mod) {
        return {
          ok: false,
          reason: '库里找不到模块',
          nets: netValues,
          outPorts: new Map(),
          updates: [],
          clocked: false,
        };
      }
      const outs = mod.ports.filter((p) => p.dir === 'out');
      if (mod.isSequential) {
        // 时序器件：输出 = 当前状态（没记录过就是 Z，即"上电未定"）
        for (const p of outs) {
          const netId = pinToNet.get(pinKey(inst.id, p.name));
          if (netId !== undefined) push(netId, state.get(prefix + inst.id, p.name) ?? 'Z');
        }
        continue;
      }
      const inVals = mod.ports.filter((p) => p.dir === 'in').map((p) => read(inst.id, p.name));
      let outVals: Bit[];
      if (isGateName(mod.name)) {
        outVals = [evalGate(mod.name, inVals)];
      } else {
        if (!mod.body) {
          return {
            ok: false,
            reason: `复合模块【${mod.name}】没有内部电路`,
            nets: netValues,
            outPorts: new Map(),
            updates: [],
            clocked: false,
          };
        }
        const inMap = new Map<string, Bit[]>();
        mod.ports
          .filter((p) => p.dir === 'in')
          .forEach((p, i) => {
            inMap.set(p.name, [inVals[i] ?? 'X']);
          });
        const inner = stepGateNetlist(mod.body, library, inMap, state, `${prefix}${inst.id}/`);
        if (!inner.ok) {
          return { ...inner, nets: netValues, outPorts: new Map(), updates: [], clocked: false };
        }
        outVals = mod.ports
          .filter((p) => p.dir === 'out')
          .map((p) => inner.outPorts.get(p.name)?.[0] ?? 'X');
      }
      outs.forEach((p, i) => {
        const netId = pinToNet.get(pinKey(inst.id, p.name));
        if (netId !== undefined) push(netId, outVals[i] ?? 'X');
      });
    }

    let changed = false;
    for (const net of design.nets) {
      const list = drivers.get(net.id) ?? [];
      if (list.length === 0) continue; // 输入端口自己的 net，保持
      const merged = mergeDrivers(list);
      const prev = netValues.get(net.id) ?? 'Z';
      if (merged !== prev) {
        netValues.set(net.id, merged);
        changed = true;
      }
    }
    settled = !changed;
  }

  // ── ② 更新阶段：满足时钟条件才写状态 ──
  const updates: string[] = [];
  for (const inst of design.instances) {
    if (inst.kind !== 'module') continue;
    const mod = inst.module ? library.get(inst.module) : undefined;
    const spec = mod?.seq;
    if (!mod?.isSequential || !spec) continue;
    const clockNow = read(inst.id, spec.clock);
    const clockPrev = state.getClock(prefix + inst.id) ?? 'Z';
    const active = spec.mode === 'level' ? clockNow === 1 : clockPrev === 0 && clockNow === 1;
    if (active) {
      // 数据端口 → 输出端口：map 显式指定优先；只有一个数据端口 + 一个输出端口时
      // 直接配对（D 锁存器的 d → q 就是这种情况）；否则只能靠 map，不瞎猜。
      const outPorts = mod.ports.filter((p) => p.dir === 'out');
      const sole = spec.data.length === 1 && outPorts.length === 1 ? outPorts[0]?.name : undefined;
      for (const dataPort of spec.data) {
        const target = spec.map?.[dataPort] ?? sole ?? dataPort;
        state.set(prefix + inst.id, target, read(inst.id, dataPort));
        updates.push(
          `${prefix}${inst.id}/${target}=${String(state.get(prefix + inst.id, target))}`,
        );
      }
    }
    state.setClock(prefix + inst.id, clockNow);
  }

  const outPorts = new Map<string, Bit[]>();
  for (const port of design.ports) {
    if (port.dir !== 'out') continue;
    outPorts.set(
      port.name,
      port.nets.map((netId) => netValues.get(netId) ?? 'Z'),
    );
  }
  return { ok: true, nets: netValues, outPorts, updates, clocked: updates.length > 0 };
};

/**
 * 反复推进到"输出不再变化"为止 —— 判定/仿真该用的入口。
 *
 * 为什么单趟不够：电平型锁存器在使能有效时应当**当拍透明**（en=1 时输出就是 d），
 * 而单趟是「先算组合、再写状态」，新状态要到下一趟才看得见。反复推进等价于
 * "求值 → 更新状态 → 再求值"，直到不动 —— 这就是零延迟仿真的标准收敛做法。
 * 边沿型器件在第二趟起因为"时钟没再跳变"而不会重复写入，所以不会被多写。
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
