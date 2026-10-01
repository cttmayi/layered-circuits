/**
 * 递归成本系统 —— GDD 2.2 的工程实现。
 *
 * GDD 说「成本 = 递归拆解到最底层 4 种元件再累加」。语义上确实是递归，
 * 但**递归发生在封装那一刻**：wrapModule() 时把子模块已算好的 UnitCounts 加总，
 * 存进 ModuleTemplate.costs。于是结算 / 实时预览 / 溯源全部是 O(1) 查表 + 点积，
 * 与 GDD 6.2「仿真阶段不递归」一致，而语义完全等价。
 */

import {
  addCounts,
  costHalfOf,
  type Design,
  emptyCounts,
  type ModuleLibrary,
  type UnitCounts,
} from '@lc/schema';
import type { CompileDiagnostic } from './flatten.js';

export interface CostResult {
  counts: UnitCounts;
  costHalf: number;
  diagnostics: CompileDiagnostic[];
}

/**
 * 计算一个电路的底层元件构成。
 * 模块实例直接取模板里缓存的 costs（不展开内部电路）。
 */
export function computeCosts(design: Design, library: ModuleLibrary): CostResult {
  const counts = emptyCounts();
  const diagnostics: CompileDiagnostic[] = [];
  let depth = 0;

  const walk = (d: Design): void => {
    if (depth > 64) return;
    depth++;
    for (const inst of d.instances) {
      switch (inst.kind) {
        case 'unit':
          counts[inst.unit] += 1;
          break;
        case 'vcc':
        case 'gnd':
          // 电源轨是免费端口（GDD 的 4 种计费元件里没有电源）
          break;
        case 'module': {
          const tpl = library.get(inst.module);
          if (!tpl) {
            diagnostics.push({
              kind: 'unknown-module',
              severity: 'error',
              message: `模块实例 ${inst.id} 引用了组件库中不存在的模块：${inst.module}`,
              instanceId: inst.id,
            });
            break;
          }
          const merged = addCounts(counts, tpl.costs);
          counts.npn = merged.npn;
          counts.res = merged.res;
          counts.dio = merged.dio;
          counts.cap = merged.cap;
          counts.nmos = merged.nmos;
          counts.pmos = merged.pmos;
          break;
        }
      }
    }
    depth--;
  };

  walk(design);

  return { counts, costHalf: costHalfOfCounts(counts), diagnostics };
}

/** 成本（半分整数）：唯一权威口径在 @lc/schema（UNIT_COST_HALF），这里只转发，避免两套账 */
function costHalfOfCounts(c: UnitCounts): number {
  return costHalfOf(c);
}

export interface CostTree {
  label: string;
  kind: 'design' | 'unit' | 'module';
  counts: UnitCounts;
  costHalf: number;
  /** 该实例自身引入的成本（模块实例 = 其递归成本） */
  ownCostHalf: number;
  children: CostTree[];
}

/**
 * 溯源树（GDD 2.4 的「点击模块展开树状结构查看成本明细」）。
 * 这是唯一会真正展开 DAG 的地方，只用于 UI 展示，不在仿真热路径上。
 */
export function buildCostTree(
  design: Design,
  library: ModuleLibrary,
  label = design.name,
  depthLimit = 6,
): CostTree {
  const children: CostTree[] = [];
  const counts = emptyCounts();

  for (const inst of design.instances) {
    let child: CostTree | null = null;
    if (inst.kind === 'unit') {
      const unitCounts = { ...emptyCounts(), [inst.unit]: 1 } as UnitCounts;
      child = {
        label: inst.label ?? `${inst.unit} ${inst.id}`,
        kind: 'unit',
        counts: unitCounts,
        costHalf: costHalfOfCounts(unitCounts),
        ownCostHalf: costHalfOfCounts(unitCounts),
        children: [],
      };
    } else if (inst.kind === 'module') {
      const tpl = library.get(inst.module);
      if (!tpl) continue;
      const inner =
        depthLimit > 0
          ? buildCostTree(tpl.body, library, `${tpl.name} ${inst.id}`, depthLimit - 1)
          : {
              label: tpl.name,
              kind: 'design' as const,
              counts: tpl.costs,
              costHalf: costHalfOfCounts(tpl.costs),
              ownCostHalf: costHalfOfCounts(tpl.costs),
              children: [],
            };
      child = {
        label: inst.label ?? `${tpl.name} ${inst.id}`,
        kind: 'module',
        counts: tpl.costs,
        costHalf: costHalfOfCounts(tpl.costs),
        ownCostHalf: costHalfOfCounts(tpl.costs),
        children: inner.children.length > 0 ? [inner] : [],
      };
    }
    if (!child) continue;
    children.push(child);
    const merged = addCounts(counts, child.counts);
    counts.npn = merged.npn;
    counts.res = merged.res;
    counts.dio = merged.dio;
    counts.cap = merged.cap;
  }

  return {
    label,
    kind: 'design',
    counts,
    costHalf: costHalfOfCounts(counts),
    ownCostHalf: 0,
    children,
  };
}
