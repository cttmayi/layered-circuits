/**
 * 合同条款：元件成本上限 / 传播延迟上限 —— 全部由关卡现有字段推导。
 *
 * 注：早期版本有「委托方/叙事文案」数据（街道维修铺世界观），
 * 任务表达改为「直接说任务 + 图 + 约束」后已全部移除（见 git 历史）。
 */

import type { Level } from '@lc/schema';

export interface ContractTerms {
  /** 元件成本上限（元）；null = 不限元件成本 */
  costCap: number | null;
  /** 传播延迟上限（ns）；null = 不设时限 */
  timingCap: number | null;
}

export function contractOf(level: Level): ContractTerms {
  const costCap = level.kind === 'cost' ? null : level.budgetHalf / 2;
  const timingCap = level.timingBudgetPs !== undefined ? level.timingBudgetPs / 1000 : null;
  return { costCap, timingCap };
}
