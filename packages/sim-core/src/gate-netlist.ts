/**
 * 逻辑版门级引擎第 2 步：**按连线把门连起来求值**。
 *
 * 分工：`gate-logic.ts` 只管"一个门算什么值"，这里管"值怎么在门之间流"。
 *
 * 规矩（与 docs/design-gates.md 第 9 节一致）：
 *  - 只处理**纯模块**设计（顶层出现元件 `unit` 就直接回落，调用方走原来的元件级求值）；
 *  - 7 个基础门是原子：按名字用真值函数算，**不展开它们的元件身体**；
 *  - 复合模块 = 它的 body 递归求值（body 也是 Design，里面又只有门 → 递归到底还是 7 个门）；
 *  - 时序模块（锁存器/DFF/寄存器）在无延迟下是代数环，这一层**不支持**，如实回落
 *    （第 3 步会加「状态 + 时钟沿」模型）；
 *  - 值为 4 值（0/1/X/Z），同节点多驱动用 mergeDrivers 合并，**不比强弱**；
 *  - 迭代到稳定为止；迭代上限内仍在变化的节点判 X（振荡），并给出说明。
 *
 * 为了不把 sim-core 绑到 @lc/schema 上，这里只要求**结构兼容**的最小接口；
 * 真实的 Design / ModuleLibrary 天然满足（见 apps/studio 的接线）。
 */
import { type Bit, evalGate, isGateName, mergeDrivers } from './gate-logic.js';

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

export interface GateModuleInfo {
  name: string;
  isSequential?: boolean;
  ports: readonly { name: string; dir: 'in' | 'out' }[];
  /** 复合模块的内部电路；7 个基础门不需要（按真值函数算） */
  body?: GateNetlistDesign;
}

export interface GateLibrary {
  get(hash: string): GateModuleInfo | undefined;
}

export interface GateEvalOutcome {
  ok: boolean;
  /** ok === false 时说明为什么回落 */
  reason?: string;
  /** net id → 值 */
  nets: Map<string, Bit>;
  /** 端口名 → 每一位的值 */
  outPorts: Map<string, Bit[]>;
  /** 迭代到稳定的轮数 */
  rounds: number;
  /** 振荡被判 X 的 net id */
  unstable: string[];
}

const MAX_ROUNDS = 64;

const pinKey = (inst: string, pin: string, bit = 0): string => `${inst}/${pin}/${bit}`;

/** 门级快路能不能处理这份设计；不能则给出人话原因 */
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

/**
 * 求值。`inputs` 是端口名 → 各位的值（缺省按 Z）。
 * 端口按 Design.ports[].nets 定位到 net，所以不需要端口元件。
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

  // pin → net，net → 驱动它的 (实例, 输出引脚)
  const pinToNet = new Map<string, string>();
  for (const net of design.nets) {
    for (const ref of net.pins) pinToNet.set(pinKey(ref.inst, ref.pin), net.id);
  }
  const netValues = new Map<string, Bit>();
  // 输入端口：值放进它绑的 net
  for (const port of design.ports) {
    if (port.dir !== 'in') continue;
    const vals = inputs.get(port.name) ?? [];
    port.nets.forEach((netId, i) => {
      netValues.set(netId, vals[i] ?? 'Z');
    });
  }

  const readNet = (inst: string, pin: string): Bit => {
    const netId = pinToNet.get(pinKey(inst, pin));
    if (netId === undefined) return 'Z'; // 没连 → 悬空
    return netValues.get(netId) ?? 'Z';
  };

  let rounds = 0;
  let settled = false;
  for (; rounds < MAX_ROUNDS; rounds++) {
    // 本轮每个 net 上的全部驱动（含各模块的输出引脚）
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
          nets: netValues,
          outPorts: new Map(),
          rounds,
          unstable: [],
        };
      const inVals = mod.ports.filter((p) => p.dir === 'in').map((p) => readNet(inst.id, p.name));
      let outVals: Bit[];
      if (isGateName(mod.name)) {
        outVals = [evalGate(mod.name, inVals)]; // 基础门：原子，不展开
      } else {
        if (!mod.body)
          return {
            ok: false,
            reason: `复合模块【${mod.name}】没有内部电路`,
            nets: netValues,
            outPorts: new Map(),
            rounds,
            unstable: [],
          };
        const inMap = new Map<string, Bit[]>();
        mod.ports
          .filter((p) => p.dir === 'in')
          .forEach((p, i) => {
            inMap.set(p.name, [inVals[i] ?? 'X']);
          });
        const inner = evalGateNetlist(mod.body, library, inMap);
        if (!inner.ok) return { ...inner, rounds, unstable: [] };
        const outs = mod.ports.filter((p) => p.dir === 'out');
        outVals = outs.map((p) => inner.outPorts.get(p.name)?.[0] ?? 'X');
      }
      mod.ports
        .filter((p) => p.dir === 'out')
        .forEach((p, i) => {
          const netId = pinToNet.get(pinKey(inst.id, p.name));
          if (netId !== undefined) push(netId, outVals[i] ?? 'X');
        });
    }

    let changed = false;
    for (const net of design.nets) {
      const merged = mergeDrivers(drivers.get(net.id) ?? []);
      const prev = netValues.get(net.id) ?? 'Z';
      // 没有任何驱动的 net 保持原值（输入端口就是这种情况）
      const next = (drivers.get(net.id) ?? []).length === 0 ? prev : merged;
      if (next !== prev) {
        netValues.set(net.id, next);
        changed = true;
      }
    }
    if (!changed) {
      settled = true;
      break;
    }
  }

  const unstable: string[] = [];
  if (!settled) {
    // 迭代上限内还在动 → 这些 net 判 X（振荡），如实标注
    for (const net of design.nets) {
      if (netValues.has(net.id)) unstable.push(net.id);
    }
    for (const id of unstable) netValues.set(id, 'X');
  }

  const outPorts = new Map<string, Bit[]>();
  for (const port of design.ports) {
    if (port.dir !== 'out') continue;
    outPorts.set(
      port.name,
      port.nets.map((netId) => netValues.get(netId) ?? 'Z'),
    );
  }
  return { ok: true, nets: netValues, outPorts, rounds, unstable };
};
