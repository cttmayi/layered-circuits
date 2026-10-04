// @vitest-environment node
/**
 * 时序判定试点（第一批两关）：s2-sr-latch 与 s3-display。
 *
 * 这两关的 `mode` 从 logic 改成 timing —— 判定不再取"瞬时收敛答案"，
 * 而是按真实时序跑到窗口末端再采样。定下来的两条政策：
 *
 * ① **采样时刻** = 向量窗口的末端（judge 的 defaultSettle = max(100µs, 2×时钟周期)）。
 *    两级门的关键路径只有 4~12.5ns，「停稳之后」与「窗口末端」是同一个值，所以判定结论不变。
 * ② **毛刺只记录、不设上限**：正确电路本身就有真实竞争（段码关参考解最坏 7 次跳变），
 *    设 maxGlitches 会把正确答案判错。竞争改用「时序视图」给玩家看。
 *    （判定面板只在声明了上限的关卡才显示"空翻"结论，所以未设上限就不会误报。）
 */
import { type JudgeResult, judgeDesign } from '@lc/compiler';
import { findLevel, teachingModulesFor } from '@lc/content';
import { familySpecOf, InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';

/** 按关卡**自己声明的**口径判定（不传 mode）—— 这条路就是玩家点「交付验收」走的路 */
function judgeOwnWay(levelId: string): JudgeResult {
  const level = findLevel(levelId)!;
  const spec = familySpecOf(level, 'rtl');
  return judgeDesign(level.referenceSolution!, level, {
    library: new InMemoryModuleLibrary([...teachingModulesFor('rtl')] as never),
    family: spec.family,
    units: spec.units,
    timingBudgetPs: spec.timingBudgetPs,
    optimalHalf: spec.optimalHalf,
    budgetHalf: spec.budgetHalf,
    bestKnownHalf: spec.bestKnownHalf,
  });
}

describe('时序判定试点', () => {
  it('两关的判定口径已切到真实时序', () => {
    expect(findLevel('s2-sr-latch')!.mode).toBe('timing');
    expect(findLevel('s3-display')!.mode).toBe('timing');
    // 顺带确认它们不是"时序挑战关"（kind 仍是主线）：强制硬核是另一条轴，没被这次试点改动
    expect(findLevel('s2-sr-latch')!.kind).toBe('main');
    expect(findLevel('s3-display')!.kind).toBe('main');
  });

  it('参考解按关卡自己的口径（时序）判定通过', () => {
    const latch = judgeOwnWay('s2-sr-latch');
    expect(latch.pass).toBe(true);
    expect(latch.isSequential).toBe(true); // 锁存器：输出依赖历史
    const display = judgeOwnWay('s3-display');
    expect(display.pass).toBe(true);
    expect(display.isSequential).toBe(false); // 段码关：纯组合
  });

  it('SR 锁存器：保持行 = 输出一次都没动，置位/复位行才翻转', () => {
    const judged = judgeOwnWay('s2-sr-latch');
    const [set, hold1, reset, hold2] = judged.rows;
    // 保持：沿用上一次的 q —— 时序下就是"整窗零跳变"
    expect(hold1?.ok).toBe(true);
    expect(hold1?.glitches).toBe(0);
    expect(hold2?.ok).toBe(true);
    expect(hold2?.glitches).toBe(0);
    // 置位/复位：真的翻转了（至少一次跳变），且结果正确
    expect(set?.ok).toBe(true);
    expect(set?.glitches ?? 0).toBeGreaterThan(0);
    expect(reset?.ok).toBe(true);
    expect(reset?.glitches ?? 0).toBeGreaterThan(0);
  });

  it('段码关：竞争真实存在（抖 >1 次），但只记录不设上限，所以不会判错', () => {
    const level = findLevel('s3-display')!;
    // 政策断言：不设毛刺上限 —— 否则正确电路（真实竞争）会被判错
    expect(level.checks.maxGlitches).toBeUndefined();
    const judged = judgeOwnWay('s3-display');
    const worst = Math.max(...judged.rows.map((r) => r.glitches));
    expect(worst).toBeGreaterThan(1); // 停稳之前确实抖了好几下（竞争冒险）
    expect(judged.pass).toBe(true); // 但采样在停稳之后 → 全部答对
    expect(judged.timing.maxGlitches).toBeNull(); // 判定面板因此不会给出"空翻超标"结论
  });

  it('判定结论与逻辑模式一致（换口径不改答案，只是看得更真）', () => {
    const level = findLevel('s3-display')!;
    const spec = familySpecOf(level, 'rtl');
    const logic = judgeDesign(level.referenceSolution!, level, {
      library: new InMemoryModuleLibrary([...teachingModulesFor('rtl')] as never),
      mode: 'logic',
      family: spec.family,
      units: spec.units,
      timingBudgetPs: spec.timingBudgetPs,
      optimalHalf: spec.optimalHalf,
      budgetHalf: spec.budgetHalf,
      bestKnownHalf: spec.bestKnownHalf,
    });
    const timing = judgeOwnWay('s3-display');
    expect(logic.pass).toBe(true);
    expect(timing.rows.map((r) => r.actual)).toEqual(logic.rows.map((r) => r.actual));
  });
});
