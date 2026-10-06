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

import { beginGateCacheBatch, type GateEvalCache, gateCacheKey } from './gate-cache.js';
import {
  B0,
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
  /**
   * 时序器件的**上电初值**（缺省 '0'）。
   * 实测：元件级引擎里交叉耦合的锁存电路会**收敛到 Q=1**（双极锁存电路的固有偏置），
   * 所以 D 锁存器 / 主从 D 触发器这种"元件电路"的时序积木要声明 '1'，
   * 否则首个向量就会与元件级口径不符（s2-dff / s3-reg-8 / s2-d-latch 都栽在这里）。
   */
  initial?: '0' | '1';
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

/**
 * 这个门级模块是否**纯组合**（递归下去没有任何时序器件）？—— 求值缓存的准入条件。
 *
 * 判定刻意保守，**不靠 `isSequential` 一个字段**：实测（本文件上方 probes）库里
 * 「八位寄存器 / 数字输入寄存器」这种"模块搭的时序积木"的 `isSequential` 是 **false**，
 * 可它们内部全是主从 D 触发器 —— 只看标记就会把它们当成纯组合缓存起来，
 * 那是直接把上一向量的状态算错。所以还有一条**结构性**的判据（见下）。
 *
 * 判据（任一命中就不纯，不缓存）：
 *  · 标了 `isSequential`（元件级时序积木，如 D 锁存器 / 主从 D 触发器）；
 *  · 带了 `seq` 声明（SeqSpec —— 引擎明确知道它是状态元件）；
 *  · **身体里嵌着带 SeqSpec 的子模块**（结构性地抓到上面那两个漏网之鱼）；
 *  · 身体里含**元件**（`unit`）且这个模块不是门级原子 —— 那种身体门级引擎本来就"如实拒绝"；
 *  · 库里查不到的子模块（不知道里面是什么，不敢缓存）。
 *
 * 反过来，`isGateName` / `isFunctionAtom` 的模块**算纯**：门级引擎遇到它们是
 * **按真值函数算原子、根本不展开身体**的（教学库里异或门/与门/全加器这些"积木"的身体
 * 恰恰是一堆 npn/res/dio），输出当然是输入的函数。
 *
 * `seen` 按哈希去重：库是 Merkle 结构本该无环，真出现环也不会转不出来。
 */
export const isPureCombinational = (
  mod: GateModuleInfo,
  library: GateLibrary,
  seen: Set<string> = new Set(),
): boolean => {
  if (mod.isSequential === true) return false;
  if (mod.seq !== undefined) return false;
  if (needsSeqSpec(mod)) return false; // 兜底：要 SeqSpec 的必然是时序器件
  if (isFunctionAtom(mod.name) || isGateName(mod.name)) return true; // 门级原子：按真值算，不展开
  const body = mod.body;
  if (!body || body.instances.length === 0) return false;
  // 走到这里 = 这个模块要**递归展开**求值 → 身体里有元件就根本算不了（不纯）
  if (body.instances.some((inst) => inst.kind === 'unit')) return false;
  for (const inst of body.instances) {
    if (inst.kind !== 'module') continue;
    const hash = inst.module;
    if (!hash || seen.has(hash)) continue;
    const sub = library.get(hash);
    if (!sub) return false;
    // 结构性判据：子模块自己带了 SeqSpec ⇒ 这个身体里嵌着状态元件 ⇒ 输出不是纯函数
    if (sub.seq !== undefined || sub.isSequential === true) return false;
    seen.add(hash);
    if (!isPureCombinational(sub, library, seen)) return false;
  }
  return true;
};

/**
 * 复合模块实例是否可缓存：库里有、且被判定为纯组合。
 * 判定结果按**哈希**记在缓存里（同一批里库不会变，哈希就是内容身份），
 * 所以每个模块的递归纯度检查只做一次；一旦判定不可缓存，缓存里这个哈希的旧条目会被清掉。
 */
const cacheableModuleOf = (
  cache: GateEvalCache,
  library: GateLibrary,
  hash: string,
  mod: GateModuleInfo,
): boolean => {
  if (cache.isBlocked(hash)) return false;
  const pure = isPureCombinational(mod, library);
  if (!pure) {
    cache.block(hash);
    return false;
  }
  return true;
};

/** 一份设计里 pin → net 的索引（**含位**）与按位读值 */
export interface GatePinIndex {
  /**
   * pin → **它接到的所有 net**（一个引脚可以同时接多条不同的网名）。
   *
   * 为什么必须是一对多：元件级编译（flatten）把同一个引脚上的各条网名**并成同一个节点**
   * ——电气上它们就是一根线。门级如果只认一条（Map.set 后写覆盖前写），别的网名就永远没有驱动、
   * 读出来恒 0。实测（s3-calc）：八位寄存器 `q0..q7` 与顶层 `acc0..acc7`、数字输入寄存器
   * `q0..q7` 与 `er0..er7`、ALU 的各段总线都是这种"同脚多名"接线，于是门级读数与元件级整片相反
   * （元件级上电 Q=1，门级读成 0），差异 58/67。修成一对多之后差异 0/67。
   */
  netsPinTo: Map<string, string[]>;
  /** 兼容旧口径：pin → **第一条** net（读值请用 readBit/readPort，它们会合并多条 net）*/
  pinToNet: Map<string, string>;
  netValues: Map<string, Bit>;
  readBit: (inst: string, pin: string, bit?: number) => Bit;
  readPort: (inst: string, port: { name: string; width?: number }) => Bit[];
  writeTo: (inst: string, port: { name: string; width?: number }, values: readonly Bit[]) => void;
}

export const makePinIndex = (design: GateNetlistDesign): GatePinIndex => {
  const netsPinTo = new Map<string, string[]>();
  for (const net of design.nets) {
    for (const ref of net.pins) {
      const key = pinKey(ref.inst, ref.pin, ref.bit ?? 0);
      const list = netsPinTo.get(key);
      if (list) {
        if (!list.includes(net.id)) list.push(net.id);
      } else netsPinTo.set(key, [net.id]);
    }
  }
  const pinToNet = new Map<string, string>();
  for (const [key, list] of netsPinTo) if (list[0] !== undefined) pinToNet.set(key, list[0]);
  const netValues = new Map<string, Bit>();
  const readBit = (inst: string, pin: string, bit = 0): Bit => {
    const netIds = netsPinTo.get(pinKey(inst, pin, bit));
    // 没接到任何 net、或该 net 没人驱动 → 按 **0** 处理（不是 Z）。
    // 实测依据：同一份门版设计上，元件级引擎给出的 y[0]=0，而按 Z 处理会变成 X 导致判定不符；
    // 元件级对未定节点就是按 0 走的，两套引擎的口径必须一致。
    if (netIds === undefined || netIds.length === 0) return B0;
    if (netIds.length === 1) return netValues.get(netIds[0] as string) ?? B0;
    // 一个脚接多条网名 = 同一个节点，取各条 net 的合并值（同值则同值，冲突判 X）
    return mergeDrivers(netIds.map((id) => netValues.get(id) ?? B0));
  };
  const readPort = (inst: string, port: { name: string; width?: number }): Bit[] =>
    Array.from({ length: widthOf(port) }, (_, b) => readBit(inst, port.name, b));
  const writeTo = (
    inst: string,
    port: { name: string; width?: number },
    values: readonly Bit[],
  ): void => {
    Array.from({ length: widthOf(port) }, (_, b) => {
      for (const netId of netsPinTo.get(pinKey(inst, port.name, b)) ?? [])
        netValues.set(netId, values[b] ?? 'X');
      return b;
    });
  };
  return { netsPinTo, pinToNet, netValues, readBit, readPort, writeTo };
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
      port.nets.map((netId) => idx.netValues.get(netId) ?? B0),
    );
  }
  return out;
};

/**
 * 纯组合求值（含时序模块就回落）。
 * `inputs` 是端口名 → 各位的值（缺省按 Z）。
 *
 * `cache` 只在**递归**时由本函数自己传进去（顶层不给 = 开新的一批缓存，见 gate-cache.ts）。
 */
export const evalGateNetlist = (
  design: GateNetlistDesign,
  library: GateLibrary,
  inputs: ReadonlyMap<string, Bit[]> = new Map(),
  cache: GateEvalCache = beginGateCacheBatch(library),
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
      let outBits: Bit[][] | undefined;
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
        // 身体里含**元件**的模块：门级引擎算不了 → **如实拒绝**（宁可不快，不能算错）。
        // 实测：顶层查了元件，但递归里漏了 —— s3-calc 的显示链路就是这样被静默算错的。
        if (mod.body.instances.some((ci) => ci.kind === 'unit')) {
          return {
            ok: false,
            reason: `模块【${mod.name}】身体里含元件（门级快路只处理纯门/模块电路）`,
            nets: idx.netValues,
            outPorts: new Map(),
            rounds,
            unstable: [],
          };
        }
        // ── 组合模块求值缓存 ──
        // 纯组合模块的输出是输入的纯函数（见 isPureCombinational），命中就直接写回，
        // 不再递归 —— 同一份子电路在同一批求值里会被算几十次，这是门级引擎最大的重复开销。
        // 键 = 模块哈希 + 这次调用的输入位；含时序器件的身体走不到这里（一律不缓存）。
        const hash = inst.module;
        const cacheable = hash !== undefined && cacheableModuleOf(cache, library, hash, mod);
        const key = cacheable ? gateCacheKey(hash, inBits) : '';
        const hit = cacheable ? cache.lookup(hash, key) : undefined;
        if (hit) {
          outBits = hit;
        } else {
          const inner = evalGateNetlist(mod.body, library, inMap, cache);
          if (!inner.ok) return { ...inner, rounds, unstable: [] };
          outBits = outs.map((p) => inner.outPorts.get(p.name) ?? []);
          if (cacheable) cache.store(hash, key, outBits, inner.unstable.length === 0);
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
