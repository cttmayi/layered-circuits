/**
 * 门级引擎的**组合模块求值缓存**（性能，不改语义）。
 *
 * 为什么需要它：门级复合模块求值是"每个外层迭代轮次都整棵递归一遍"，
 * 于是同一份子电路在一次求值里被算几十次（实测：门级 s3-calc 945ms / s3-digit-entry 379ms，
 * 反而比元件级慢）。**纯组合模块的输出是输入的纯函数**，算过一次就能直接复用。
 *
 * 安全边界（宁可不快，不能算错）：
 *  1. 只缓存**纯组合模块** —— 递归下去不含任何时序器件（`isSequential` 的模块、
 *     或含时序后代的复合模块）才叫纯。**有状态的身体绝对不缓存**：它的输出还取决于
 *     上一向量留下的状态，缓存会把上一向量的结果算错。
 *  2. 缓存键 = **模块内容哈希 + 该次调用的输入位**（按端口顺序拼串）。
 *     输入变 → 键就变，绝不会拿旧值顶替新值。
 *  3. **按库隔离**：缓存挂在"库对象"这个作用域上（见本文件底部那张表），
 *     换一个库就换一份缓存 → 不同设计/不同库不会串味（判定快路每次都新建包装库）。
 *  4. **按批清空**：每个顶层求值调用（evalGateNetlist / stepGateNetlist / settleGateSteps）
 *     开始新的一批，上一批的条目**与"不可缓存"判定**一起作废。
 *     批内设计不会变，"模块哈希 → 身体"才有保证；跨批不靠上一批的结论。
 *  5. 同一个哈希被判为不可缓存（含时序器件 / 含元件 / 库查不到）时，
 *     **顺手清掉它已有的条目**，旧条目绝不会再被读到。
 *
 * 命中只影响"快不快"，不影响"算什么"：命中写回的就是当初那次递归算出来的同一组输出位。
 */
import type { Bit } from './gate-logic.js';
import type { GateLibrary } from './gate-netlist.js';

/** 缓存命中/未命中的计数器（单元测试用来确认"真的命中了"/"时序模块真的没被缓存"） */
export interface GateCacheStats {
  hits: number;
  misses: number;
  stores: number;
  /** 因为模块不纯（含时序器件 / 含元件 / 未知）而拒绝缓存的次数 */
  skipped: number;
  /** 因为递归求值不稳定（组合环）而放弃缓存的次数 */
  unstable: number;
}

const emptyStats = (): GateCacheStats => ({
  hits: 0,
  misses: 0,
  stores: 0,
  skipped: 0,
  unstable: 0,
});

/**
 * 输入位的紧凑编码：位之间不需要分隔符 —— 每个位只可能是
 * 单字符的 `0` / `1` / `X` / `Z`（Bit 的定义）。
 */
const encodeBits = (bits: readonly Bit[]): string => bits.map(String).join('');

/** 拼缓存键：模块哈希 + 各输入端口（按顺序）的各位 */
export const gateCacheKey = (modHash: string, inBits: readonly (readonly Bit[])[]): string => {
  let key = modHash;
  for (const bits of inBits) key += `|${encodeBits(bits)}`;
  return key;
};

/**
 * 一个"库作用域"里的缓存：`模块哈希 → (输入位键 → 输出位)`。
 * 用实例是因为要在批开始/结束时整批作废（Map.clear），比记代次更省内存。
 */
export class GateEvalCache {
  private readonly entries = new Map<string, Map<string, Bit[][]>>();
  /** 已确认**不可缓存**的哈希（含时序器件 / 含元件 / 库查不到）—— 同样按批作废 */
  private readonly blocked = new Set<string>();
  private counters: GateCacheStats = emptyStats();

  /**
   * 开始新的一批：上一批的条目与"不可缓存"判定**全部作废**。
   *
   * 为什么判定也要作废（不是只清条目就够）：条目按"批"清掉已经能防止读到旧值，
   * 但"这个哈希不可缓存"如果留着，但凡库对象被复用到别的设计上，就会一直不再缓存它；
   * 更要紧的是**判定本身也可能因为复用而失真**。每批重新判定一次，宁可多花这点时间。
   */
  beginBatch(): void {
    this.entries.clear();
    this.blocked.clear();
  }

  stats(): GateCacheStats {
    return { ...this.counters };
  }

  /** 这个哈希已经被判定为不可缓存（含时序器件 / 含元件 / 未知）？ */
  isBlocked(modHash: string): boolean {
    return this.blocked.has(modHash);
  }

  /** 标记为不可缓存：**同时清掉已有条目**，旧条目绝不会再被读到 */
  block(modHash: string): void {
    this.blocked.add(modHash);
    this.entries.delete(modHash);
    this.counters.skipped++;
  }

  lookup(modHash: string, key: string): Bit[][] | undefined {
    const hit = this.entries.get(modHash)?.get(key);
    if (hit === undefined) this.counters.misses++;
    else this.counters.hits++;
    return hit;
  }

  /** `stable=false`（组合环没收敛）时不缓存 —— 稳定与否也是"这一批"的性质，不留到别处 */
  store(modHash: string, key: string, outBits: Bit[][], stable: boolean): void {
    if (!stable) {
      this.counters.unstable++;
      return;
    }
    let m = this.entries.get(modHash);
    if (!m) {
      m = new Map();
      this.entries.set(modHash, m);
    }
    m.set(key, outBits);
    this.counters.stores++;
  }
}

/**
 * 门级模块求值缓存的**按库作用域表**：`库对象 → 缓存`。
 * 同一个库对象在多次调用间复用同一份缓存；换了库对象（不同设计/不同库）就是另一份。
 */
const perLibrary = new WeakMap<GateLibrary, GateEvalCache>();

/** 取这个库的缓存，并**开始新的一批**（顶层求值入口调用；递归调用不再调它） */
export const beginGateCacheBatch = (library: GateLibrary): GateEvalCache => {
  let cache = perLibrary.get(library);
  if (!cache) {
    cache = new GateEvalCache();
    perLibrary.set(library, cache);
  }
  cache.beginBatch();
  return cache;
};
