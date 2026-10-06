/**
 * 逻辑版门级引擎第 2 步：**按连线把门连起来求值**（支持总线：按位）。
 *
 * 分工：`gate-logic.ts` 只管"一个门的一位算什么值"，这里管"值怎么在门之间流、总线怎么按位走"。
 *
 * 规矩（与 docs/design-gates.md 第 9 节一致）：
 *  - 只处理**纯模块**设计（顶层出现元件 `unit` 就回落，调用方走原来的元件级求值）；
 *  - 7 个基础门是原子：按名字用真值函数**逐位**算，**不展开它们的元件身体**；
 *  - 复合模块 = 它的 body 递归求值（body 里又只有门 → 递归到底还是 7 个门）；
 *  - **总线按位**：端口有 width，每个位各自绑一个 net（见 schema 的 Port.nets[i]）；
 *    基础门逐位算（同一位上取各输入端口该位的值），复合模块整组端口传下去；
 *  - 时序模块由 gate-seq.ts 处理（这里遇到就回落）；
 *  - 值为 4 值（0/1/X/Z），同节点多驱动用 mergeDrivers 合并，**不比强弱**；
 *  - 迭代到稳定为止；上限内仍在变化的节点判 X。
 *
 * 为了不把 sim-core 绑到 @lc/schema 上，这里只要求**结构兼容**的最小接口。
 */
import {
  type Bit,
  evalFullAdder,
  evalGate,
  evalMultiOr,
  isFunctionAtom,
  isGateName,
  mergeDrivers,
} from './gate-logic.js';

export interface GatePin {
  inst: string;
  pin: string;
  bit?: number;
}

export interface GateNet {
  id: string;
  pins: readonly GatePin[];
}

export interface GatePort {
  name: string;
  dir: 'in' | 'out';
  width?: number;
  nets: readonly string[];
}

export interface GateInstance {
  id: string;
  kind: string;
  /** kind === 'module' 时的模块内容哈希 */
  module?: string;
}

export interface GateNetlistDesign {
  instances: readonly GateInstance[];
  nets: readonly GateNet[];
  ports: readonly GatePort[];
}

/** 时序器件语义（见 gate-seq.ts 的 SeqSpec） */
export interface GateSeqSpec {
  clock: string;
  data: readonly string[];
  mode: 'level' | 'rising';
  /** 数据端口 → 输出端口（可多个；端口名带前导 `!` 表示反相输出，如 qn）*/
  map?: Readonly<Record<string, string | readonly string[]>>;
}

export interface GateModuleInfo {
  name: string;
  isSequential?: boolean;
  seq?: GateSeqSpec;
  /** width 缺省 1 */
  ports: readonly { name: string; dir: 'in' | 'out'; width?: number }[];
  /** 复合模块的内部电路；7 个基础门不需要（按真值函数算） */
  body?: GateNetlistDesign;
}

export interface GateLibrary {
  get(hash: string): GateModuleInfo | undefined;
}

export interface GateEvalOutcome {
  ok: boolean;
  reason?: string;
  nets: Map<string, Bit>;
  outPorts: Map<string, Bit[]>;
  rounds: number;
  unstable: string[];
}

const MAX_ROUNDS = 64;

export const pinKey = (inst: string, pin: string, bit = 0): string => `${inst}/${pin}/${bit}`;

/** 门槛：只有元件、缺模块、含时序模块才回落（时序是否可用由 gate-seq 决定） */
export const gateFastPathCheck = (
  design: GateNetlistDesign,
  library: GateLibrary,
): { ok: true } | { ok: false; reason: string } => {
  for (const inst of design.instances) {
    if (inst.kind === 'unit') {
      return { ok: false, reason: '设计里有元件（门级快路只处理纯模块设计）' };
    }
    if (inst.kind !== 'module') continue;
    const mod = inst.module ? library.get(inst.module) : undefined;
    if (!mod) return { ok: false, reason: `库里找不到模块 ${inst.module ?? '?'}` };
    if (mod.isSequential) return { ok: false, reason: `含时序模块【${mod.name}】` };
  }
  return { ok: true };
};

const widthOf = (p: { width?: number }): number => Math.max(1, p.width ?? 1);

/**
 * 功能原子的输出（全加器 / 多输入或门）：按真值函数算，**不展开元件身体**。
 * 返回按"输出端口顺序"排列的各位值；不是功能原子就返回 null（调用方去递归）。
 */
export const evalAtomOutputs = (
  modName: string,
  ins: readonly { name: string; width?: number }[],
  outs: readonly { name: string; width?: number }[],
  inBits: readonly Bit[][],
): Bit[][] | null => {
  const byName = (n: string): Bit[] | undefined => {
    const i = ins.findIndex((p) => p.name === n);
    return i >= 0 ? inBits[i] : undefined;
  };
  if (modName === '全加器') {
    const a = byName('a') ?? inBits[0] ?? [];
    const b = byName('b') ?? inBits[1] ?? [];
    const cin = byName('cin') ?? inBits[2] ?? [];
    const { s, cout } = evalFullAdder(a[0] ?? 'X', b[0] ?? 'X', cin[0] ?? 'X');
    return outs.map((p) => [p.name === 'cout' ? cout : s]);
  }
  if (modName === '多输入或门') {
    const inputs = inBits.map((v) => v[0] ?? 'X');
    return outs.map(() => [evalMultiOr(inputs)]);
  }
  return null;
};

/**
 * 这个时序模块是否**必须**由内容层声明 SeqSpec（时钟/数据端口）？
 *
 * 规则：只有"自己就是元件电路"的时序器件才需要 —— 因为门级引擎没法往下钻。
 *  · D 锁存器 / 主从 D 触发器：身体是 npn/res 元件电路 → **需要** SeqSpec（当状态元件处理）；
 *  · 八位寄存器 / 数字输入寄存器：身体是**模块**（主从D触发器 + 与门 + 非门）→ **不需要**，
 *    直接递归下钻到门/触发器即可 —— 这比"顶层再声明一遍"更忠实，也顺带把内部的移位/保持
 *    逻辑原样算对（数字输入寄存器的十位 = 旧个位 ∧ ¬fresh 就是这种）。
 */
export const needsSeqSpec = (mod: GateModuleInfo): boolean => {
  if (mod.isSequential !== true) return false;
  const body = mod.body;
  const moduleOnly =
    body !== undefined &&
    body.instances.length > 0 &&
    body.instances.every((i) => i.kind === 'module');
  return !moduleOnly;
};

/** 一份设计里 pin → net 的索引（**含位**）与按位读值 */
export interface GatePinIndex {
  pinToNet: Map<string, string>;
  netValues: Map<string, Bit>;
  readBit: (inst: string, pin: string, bit?: number) => Bit;
  readPort: (inst: string, port: { name: string; width?: number }) => Bit[];
  writeTo: (inst: string, port: { name: string; width?: number }, values: readonly Bit[]) => void;
}

export const makePinIndex = (design: GateNetlistDesign): GatePinIndex => {
  const pinToNet = new Map<string, string>();
  for (const net of design.nets) {
    for (const ref of net.pins) pinToNet.set(pinKey(ref.inst, ref.pin, ref.bit ?? 0), net.id);
  }
  const netValues = new Map<string, Bit>();
  const readBit = (inst: string, pin: string, bit = 0): Bit => {
    const netId = pinToNet.get(pinKey(inst, pin, bit));
    if (netId === undefined) return 'Z'; // 没接 → 悬空
    return netValues.get(netId) ?? 'Z';
  };
  const readPort = (inst: string, port: { name: string; width?: number }): Bit[] =>
    Array.from({ length: widthOf(port) }, (_, b) => readBit(inst, port.name, b));
  const writeTo = (
    inst: string,
    port: { name: string; width?: number },
    values: readonly Bit[],
  ): void => {
    Array.from({ length: widthOf(port) }, (_, b) => {
      const netId = pinToNet.get(pinKey(inst, port.name, b));
      if (netId !== undefined) netValues.set(netId, values[b] ?? 'X');
      return b;
    });
  };
  return { pinToNet, netValues, readBit, readPort, writeTo };
};

/** 把输入端口的值放进它们绑的 net（按位） */
export const bindInputs = (
  design: GateNetlistDesign,
  idx: GatePinIndex,
  inputs: ReadonlyMap<string, Bit[]>,
): void => {
  for (const port of design.ports) {
    if (port.dir !== 'in') continue;
    const vals = inputs.get(port.name) ?? [];
    for (const [i, netId] of port.nets.entries()) idx.netValues.set(netId, vals[i] ?? 'Z');
  }
};

/** 求一份设计的输出端口（按位） */
export const readOutPorts = (design: GateNetlistDesign, idx: GatePinIndex): Map<string, Bit[]> => {
  const out = new Map<string, Bit[]>();
  for (const port of design.ports) {
    if (port.dir !== 'out') continue;
    out.set(
      port.name,
      port.nets.map((netId) => idx.netValues.get(netId) ?? 'Z'),
    );
  }
  return out;
};

/**
 * 纯组合求值（含时序模块就回落）。
 * `inputs` 是端口名 → 各位的值（缺省按 Z）。
 */
export const evalGateNetlist = (
  design: GateNetlistDesign,
  library: GateLibrary,
  inputs: ReadonlyMap<string, Bit[]> = new Map(),
): GateEvalOutcome => {
  const gate = gateFastPathCheck(design, library);
  if (!gate.ok) {
    return {
      ok: false,
      reason: gate.reason,
      nets: new Map(),
      outPorts: new Map(),
      rounds: 0,
      unstable: [],
    };
  }
  const idx = makePinIndex(design);
  bindInputs(design, idx, inputs);

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
      if (!mod)
        return {
          ok: false,
          reason: '库里找不到模块',
          nets: idx.netValues,
          outPorts: new Map(),
          rounds,
          unstable: [],
        };
      const outs = mod.ports.filter((p) => p.dir === 'out');
      const ins = mod.ports.filter((p) => p.dir === 'in');
      const inBits = ins.map((p) => idx.readPort(inst.id, p));
      let outBits: Bit[][];
      const atomOut = isFunctionAtom(mod.name)
        ? evalAtomOutputs(mod.name, ins, outs, inBits)
        : null;

      if (atomOut) {
        // 功能原子（全加器 / 多输入或门）：按真值函数算，**不展开元件身体**

        outBits = atomOut;
      } else if (isGateName(mod.name)) {
        const gateName = mod.name; // 闭包里 narrowing 会失效，先固定成 const
        // 基础门：原子，逐位算（同一位上取各输入端口该位的值）
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
        if (!mod.body) {
          return {
            ok: false,
            reason: `复合模块【${mod.name}】没有内部电路`,
            nets: idx.netValues,
            outPorts: new Map(),
            rounds,
            unstable: [],
          };
        }
        const inMap = new Map<string, Bit[]>();
        ins.forEach((p, i) => {
          inMap.set(p.name, inBits[i] ?? []);
        });
        const inner = evalGateNetlist(mod.body, library, inMap);
        if (!inner.ok) return { ...inner, rounds, unstable: [] };
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
      if (list.length === 0) continue; // 输入端口自己的 net，保持
      const merged = mergeDrivers(list);
      const prev = idx.netValues.get(net.id) ?? 'Z';
      if (merged !== prev) {
        idx.netValues.set(net.id, merged);
        changed = true;
      }
    }
    settled = !changed;
  }

  const unstable: string[] = [];
  if (!settled) {
    for (const net of design.nets) {
      if (idx.netValues.has(net.id)) unstable.push(net.id);
    }
    for (const id of unstable) idx.netValues.set(id, 'X');
  }
  return { ok: true, nets: idx.netValues, outPorts: readOutPorts(design, idx), rounds, unstable };
};
