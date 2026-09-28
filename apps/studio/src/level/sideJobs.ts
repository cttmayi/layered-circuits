/**
 * 支线单：同一关追加的可选委托 —— 给「重挑战」一个理由，也给钱包多一个来源。
 *
 * 两条支线都由关卡现有字段推导，且**全部由真判定执行**（改判定用的关卡副本）：
 *  - 加急单：交期压到 75%（关键路径必须更快）
 *  - 手工单：这单不许用组件库模块（早期关卡本来就不给用，则换成「省料单」要求做到对标成本）
 */

import type { Level } from '@lc/schema';

export interface SideJob {
  key: string;
  title: string;
  note: string;
  /** 奖金（半单位口径，1 元 = 2） */
  bonusHalf: number;
}

export function sideJobsOf(level: Level): SideJob[] {
  const jobs: SideJob[] = [];
  if (level.timingBudgetPs !== undefined) {
    jobs.push({
      key: 'rush',
      title: '加急单',
      note: `客户等不及：关键路径要压到 ${((level.timingBudgetPs * 0.75) / 1000).toFixed(2)} ns 以内。`,
      bonusHalf: 4,
    });
  }
  if (level.moduleAccess === 'none') {
    jobs.push({
      key: 'lean',
      title: '省料单',
      note: `本关本来就不给用积木，那就比省：材料费要做到对标成本 ${level.optimalHalf / 2} 元。`,
      bonusHalf: 6,
    });
  } else {
    jobs.push({
      key: 'manual',
      title: '手工单',
      note: '客户不放心积木：这一单不许用组件库模块，全靠底层元件手搭。',
      bonusHalf: 6,
    });
  }
  return jobs;
}

export function findSideJob(level: Level | null | undefined, key: string | null): SideJob | null {
  if (!level) return null;
  if (!key) return null;
  return sideJobsOf(level).find((job) => job.key === key) ?? null;
}

/** 把支线约束套到关卡上（判定与验收都用这份副本，规则与主线完全同源） */
export function applySideJob(level: Level, job: SideJob): Level {
  if (job.key === 'rush') {
    return { ...level, timingBudgetPs: Math.floor((level.timingBudgetPs ?? 0) * 0.75) };
  }
  if (job.key === 'lean') {
    return { ...level, budgetHalf: level.optimalHalf };
  }
  // 手工单：不允许任何组件库模块
  return { ...level, moduleAccess: 'none', allowedModules: [], bannedModules: [] };
}
