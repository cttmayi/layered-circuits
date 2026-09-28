/**
 * 掩码空间的最短路径搜索（求解器的「穷举」部分）。
 *
 * 关键洞察：两输入组合逻辑一共只有 2^4 = 16 种函数。把门目录里的每个门当成一条
 * 「成本 = 门成本」的边，在 16 个掩码节点上松弛到不动点，就得到**成本最优**的组装方式 ——
 * 而且是穷举的：任何「把门目录里的门组合成树」的电路都在搜索空间内。
 *
 * 于是最优性有明确边界：**在门目录的组合空间内最优**（不是「任意电路空间最优」）。
 * 构造出的电路仍要过真仿真验证（见 solver.ts），因为成本模型不体现驱动能力衰减。
 */

import { applyMask, type Gate, MASK_A, MASK_B, MASK_ONE, MASK_ZERO, type Mask } from './catalog.js';

export type Build =
  | { kind: 'input'; port: 'a' | 'b' }
  | { kind: 'const'; value: 0 | 1 }
  | { kind: 'gate'; gate: Gate; args: Build[] };

export interface Plan {
  mask: Mask;
  costHalf: number;
  build: Build;
}

export interface SearchOptions {
  /** 最多允许串联几级门（防止搜出又深又慢的电路；默认 4） */
  maxDepth?: number;
  /** 禁止使用的门 id（验证失败时用来换结构） */
  forbiddenGates?: readonly string[];
  /** 可用的「源头」信号（默认 a / b / 常量 0 / 常量 1）；单输入关卡不要给 b */
  sources?: readonly SourceSignal[];
}

export interface SourceSignal {
  mask: Mask;
  build: Build;
}

export const DEFAULT_SOURCES: readonly SourceSignal[] = [
  { mask: MASK_A, build: { kind: 'input', port: 'a' } },
  { mask: MASK_B, build: { kind: 'input', port: 'b' } },
  { mask: MASK_ZERO, build: { kind: 'const', value: 0 } },
  { mask: MASK_ONE, build: { kind: 'const', value: 1 } },
];

function depthOf(build: Build): number {
  if (build.kind !== 'gate') return 0;
  return 1 + Math.max(...build.args.map(depthOf));
}

/** 在掩码空间上松弛到不动点，返回「每个函数的最省构造」 */
export function searchPlans(gates: readonly Gate[], options: SearchOptions = {}): Map<Mask, Plan> {
  const maxDepth = options.maxDepth ?? 4;
  const forbidden = new Set(options.forbiddenGates ?? []);
  const usable = gates.filter((g) => !forbidden.has(g.id));

  const best = new Map<Mask, Plan>();
  const improve = (mask: Mask, costHalf: number, build: Build): boolean => {
    if (depthOf(build) > maxDepth) return false;
    const current = best.get(mask);
    if (current && current.costHalf <= costHalf) return false;
    best.set(mask, { mask, costHalf, build });
    return true;
  };

  for (const source of options.sources ?? DEFAULT_SOURCES) {
    improve(source.mask, 0, source.build);
  }

  let changed = true;
  let rounds = 0;
  while (changed && rounds < 64) {
    changed = false;
    rounds++;
    const entries = [...best.values()];
    for (const gate of usable) {
      for (const left of entries) {
        const rights = gate.arity === 1 ? [left] : entries;
        for (const right of rights) {
          const mask = applyMask(gate.mask, left.mask, right.mask);
          const costHalf = left.costHalf + right.costHalf + gate.costHalf;
          const args: Build[] = gate.arity === 1 ? [left.build] : [left.build, right.build];
          if (improve(mask, costHalf, { kind: 'gate', gate, args })) changed = true;
        }
      }
    }
  }

  return best;
}

/** 前 k 个省钱方案（同一函数的不同结构），验证失败时换下一条 */
export function searchAlternatives(
  gates: readonly Gate[],
  target: Mask,
  options: SearchOptions & { limit?: number } = {},
): Plan[] {
  const plans: Plan[] = [];
  const forbidden = new Set<string>();
  const limit = options.limit ?? 4;
  for (let i = 0; i < limit; i++) {
    const plan = searchPlans(
      gates,
      forbidden.size === 0 ? options : { ...options, forbiddenGates: [...forbidden] },
    ).get(target);
    if (!plan) break;
    plans.push(plan);
    const flat: Array<{ kind: 'gate'; gate: Gate; args: Build[] }> = [];
    const walk = (build: Build): void => {
      if (build.kind !== 'gate') return;
      flat.push(build);
      for (const arg of build.args) walk(arg);
    };
    walk(plan.build);
    flat.sort((a, b) => b.gate.costHalf - a.gate.costHalf);
    const worst = flat[0];
    if (!worst) break;
    forbidden.add(worst.gate.id);
  }
  return plans;
}

/** 统计构造树里的门数（报告用） */
export function gateCount(build: Build): number {
  if (build.kind !== 'gate') return 0;
  return 1 + build.args.reduce((sum, arg) => sum + gateCount(arg), 0);
}
