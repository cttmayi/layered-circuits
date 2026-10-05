// @vitest-environment node
/**
 * 迁移完成后的不变量：**主线关卡全部按真实时序判定**（2026-01 批次③ 收尾，27/27）。
 *
 * 这条测试的前身是「迁移护栏」：把逻辑口径的关卡强制放到时序模式下判定，确认参考解照样通过。
 * 当时全量实测过一遍：两种模式的 pass 完全一致，差别只在于时序模式**看得见毛刺**
 * （s1 各关单窗口最多抖 1~3 次、s3-bin2bcd 最多 26 次），所以"全面时序化"要额外决定
 * 采样时刻与毛刺政策 —— 这两件已经在试点定下并推广完成（见 timing-judging-rollout.test.ts）。
 *
 * 逻辑口径的关卡已经不剩，护栏完成使命，改为守下面这条：新加关卡不允许悄悄退回逻辑口径。
 */
import { ALL_LEVELS } from '@lc/content';
import { describe, expect, it } from 'vitest';

describe('判定口径：主线全部走真实时序', () => {
  it('没有主线关卡留在逻辑口径', () => {
    const logic = ALL_LEVELS.filter((l) => l.mode !== 'timing').map((l) => l.id);
    expect(logic).toEqual([]);
  });

  it('关卡数没有意外变化（27 关主线）', () => {
    expect(ALL_LEVELS.length).toBe(27);
  });
});
