/**
 * 信号编码：把「逻辑值」与「驱动强度」打包进一个整数。
 *
 *   信号 = 0                       → 高阻 Z（该节点当前没有任何驱动）
 *   信号 = (强度 << 2) | 逻辑值     → 有驱动
 *
 *   逻辑值：0 = 逻辑低，1 = 逻辑高，2 = X（冲突 / 未知）
 *   强度：  1 = WEAK（电阻等弱驱动），2 = STRONG（三极管导通、电源轨、关卡输入引脚）
 *
 * 之所以强度和逻辑值分开编码，是因为《逐层电路》的 RTL 玩法依赖「强驱动压过弱驱动」：
 * 上拉电阻给出 WEAK 1，导通的三极管给出 STRONG 0，最终节点为 0（真实 RTL 行为）。
 * 详见 docs/sim-semantics.md。
 */

/** 逻辑值：低 */
export const V0 = 0;
/** 逻辑值：高 */
export const V1 = 1;
/** 逻辑值：未知 / 冲突 */
export const VX = 2;

/** 强度：无驱动 */
export const S_NONE = 0;
/** 强度：弱驱动（电阻） */
export const S_WEAK = 1;
/** 强度：强驱动（三极管导通 / 电源轨 / 输入引脚） */
export const S_STRONG = 2;

/** 高阻：节点没有任何驱动 */
export const SIG_Z = 0;

/** 打包一个「有驱动」的信号 */
export function sig(strength: number, value: number): number {
  return (strength << 2) | value;
}

export const SIG_WEAK_0 = sig(S_WEAK, V0);
export const SIG_WEAK_1 = sig(S_WEAK, V1);
export const SIG_WEAK_X = sig(S_WEAK, VX);
export const SIG_STRONG_0 = sig(S_STRONG, V0);
export const SIG_STRONG_1 = sig(S_STRONG, V1);
export const SIG_STRONG_X = sig(S_STRONG, VX);

/** 取驱动强度（0 = 无驱动） */
export function strengthOf(s: number): number {
  return s >> 2;
}

/** 取逻辑值 */
export function logicValueOf(s: number): number {
  return s & 3;
}

/** 读逻辑值：Z 表示悬空，X 表示不确定 */
export type Logic = 0 | 1 | 'X' | 'Z';

export function toLogic(s: number): Logic {
  if (s === SIG_Z) return 'Z';
  const v = s & 3;
  if (v === V0) return 0;
  if (v === V1) return 1;
  return 'X';
}

export function logicToSignal(l: Logic, strength = S_STRONG): number {
  if (l === 'Z') return SIG_Z;
  if (l === 'X') return sig(strength, VX);
  return sig(strength, l);
}

export function signalName(s: number): string {
  const logic = toLogic(s);
  if (logic === 'Z') return 'Z';
  return `${logic}${strengthOf(s) === S_STRONG ? '' : '(weak)'}`;
}

/** 节点归约：把该节点上所有驱动贡献合并成唯一信号 */
export function resolveContributions(contribs: readonly number[]): {
  signal: number;
  conflict: boolean;
  tie: boolean;
} {
  let strongMask = 0;
  let weakMask = 0;
  for (const c of contribs) {
    if (c === SIG_Z) continue;
    const bit = 1 << (c & 3);
    if (c >> 2 === S_STRONG) strongMask |= bit;
    else weakMask |= bit;
  }
  if (strongMask !== 0) {
    // 恰好一个比特：强驱动一致；多个比特：强驱动互相冲突 → X
    const single = strongMask !== 0 && (strongMask & (strongMask - 1)) === 0;
    return {
      signal: single ? sig(S_STRONG, maskToValue(strongMask)) : SIG_STRONG_X,
      conflict: !single,
      tie: false,
    };
  }
  if (weakMask !== 0) {
    const single = (weakMask & (weakMask - 1)) === 0;
    return {
      signal: single ? sig(S_WEAK, maskToValue(weakMask)) : SIG_WEAK_X,
      conflict: false,
      tie: !single,
    };
  }
  return { signal: SIG_Z, conflict: false, tie: false };
}

function maskToValue(mask: number): number {
  if (mask & (1 << V0)) return V0;
  if (mask & (1 << V1)) return V1;
  return VX;
}
