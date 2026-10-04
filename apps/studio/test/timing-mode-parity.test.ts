// @vitest-environment node
/**
 * 迁移护栏：把"逻辑模式"的关卡强制放到时序模式下判定，参考解必须照样通过。
 *
 * 用途：将来若把某些关卡改成 timing（"全面真实时序"方向），这就是底线 ——
 * 判定结论不能因为换了仿真模式而变化，否则玩家手里原来的正确答案会被判错。
 *
 * 实测（2026-01 全量跑过一遍 32 关参考解）：两种模式的 pass 完全一致；
 * 差别只在于时序模式**看得见毛刺**（逻辑模式把翻转瞬态抹平了）：
 * s1 各关单窗口内输出最多抖 1~3 次，s3-bin2bcd 最多 26 次（真实竞争冒险）。
 * 所以"全面时序化"要额外决定：玩家看到的闪烁算正常现象还是错误、以及在哪一刻采样。
 */
import { judgeDesign } from '@lc/compiler';
import { ALL_LEVELS, teachingModulesFor } from '@lc/content';
import { familySpecOf, InMemoryModuleLibrary, parseLevel } from '@lc/schema';
import { describe, expect, it } from 'vitest';

describe('时序模式迁移护栏', () => {
  it('声明为逻辑模式的关卡，参考解在时序模式下同样通过', () => {
    const library = new InMemoryModuleLibrary([...teachingModulesFor('rtl')] as never);
    const mismatched: string[] = [];
    for (const raw of ALL_LEVELS) {
      const level = parseLevel(raw);
      if (level.mode !== 'logic' || !level.referenceSolution) continue;
      const spec = familySpecOf(level, 'rtl');
      const judged = judgeDesign(level.referenceSolution, level, {
        library,
        mode: 'timing',
        family: spec.family,
        units: spec.units,
        timingBudgetPs: spec.timingBudgetPs,
        optimalHalf: spec.optimalHalf,
        budgetHalf: spec.budgetHalf,
        bestKnownHalf: spec.bestKnownHalf,
      });
      if (!judged.pass) mismatched.push(level.id);
    }
    expect(mismatched).toEqual([]);
  }, 300_000);
});
