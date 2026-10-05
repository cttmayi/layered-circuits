// @vitest-environment node
/**
 * 时序判定推广护栏（批次① 起，后续批次自动被覆盖）。
 *
 * 把某关的 `mode` 从 logic 改成 timing 之后，必须同时满足两条底线：
 *   ① 参考解在关卡**自己声明的**口径下判定通过（玩家点「交付验收」走的就是这条路）；
 *   ② 对"没有时钟口"的关卡（电平型 / 组合型），换成逻辑口径判定，**逐行输出必须一模一样**
 *      —— 换口径只应该让人"看得更真"（毛刺从被抹平变成看得见），不能改变答案，
 *      否则玩家手里原来的正确答案会被判错。
 *
 * 并把试点定下的政策固化成断言：**没声明时钟口的关卡不设 `maxGlitches` 上限**。
 * 正确电路本身就有真实竞争（实测：段码关最坏 7 次跳变、bin2bcd 26 次），设上限会把
 * 正确答案判错；竞争改用「时序视图」呈现，判定面板只在声明了上限的关卡才给空翻结论。
 *
 * 新增批次时只需要往上加两处：`BATCHES` 里记一笔，以及该批次关卡的行为断言。
 */
import { type JudgeResult, judgeDesign } from '@lc/compiler';
import { ALL_LEVELS, findLevel, teachingModulesFor } from '@lc/content';
import { familySpecOf, InMemoryModuleLibrary, parseLevel } from '@lc/schema';
import { describe, expect, it } from 'vitest';

const library = new InMemoryModuleLibrary([...teachingModulesFor('rtl')] as never);

/** 按关卡自己声明的口径判定；传 mode 则强制用该口径（用于"换口径不改答案"对照） */
function judge(levelId: string, mode?: 'logic' | 'timing'): JudgeResult {
  const level = findLevel(levelId)!;
  const spec = familySpecOf(level, 'rtl');
  return judgeDesign(level.referenceSolution!, level, {
    library,
    ...(mode ? { mode } : {}),
    family: spec.family,
    units: spec.units,
    timingBudgetPs: spec.timingBudgetPs,
    optimalHalf: spec.optimalHalf,
    budgetHalf: spec.budgetHalf,
    bestKnownHalf: spec.bestKnownHalf,
  });
}

/** 已切到真实时序判定的关卡，按"什么时候切的"分组（新批次往上加一组） */
const BATCHES: Record<string, string[]> = {
  // 更早的改动里就切过去的（时钟型：靠 clockPort 定窗口；计算器链路：靠自身时序约定）
  先前: ['s2-dff', 's3-reg-8', 's3-digit-entry', 's3-calc'],
  试点: ['s2-sr-latch', 's3-display'],
  批次一_锁存器: ['s2-btn-latch', 's2-d-latch'],
};

const timingLevels = ALL_LEVELS.filter((l) => parseLevel(l).mode === 'timing');
/** 没有时钟口的时序关卡：判定语义与逻辑口径可比（电平型 / 组合型） */
const levelLikeTiming = timingLevels.filter((l) => !parseLevel(l).checks.clockPort);

describe('时序判定推广护栏', () => {
  it('批次里列出的关卡都已经是 timing，且总数与之一致', () => {
    const listed = Object.values(BATCHES).flat().sort();
    expect(listed).toEqual([...new Set(listed)].sort()); // 不重复登记
    expect(timingLevels.map((l) => l.id).sort()).toEqual(listed);
    for (const id of listed) expect(findLevel(id)!.mode, id).toBe('timing');
  });

  it('每关的参考解在它自己声明的口径下都判定通过', () => {
    const failed = timingLevels.filter((l) => !judge(l.id).pass).map((l) => l.id);
    expect(failed).toEqual([]);
  }, 300_000);

  it('电平型 / 组合型关卡：换成逻辑口径，逐行输出答案完全一致', () => {
    const mismatched: string[] = [];
    for (const l of levelLikeTiming) {
      const timing = judge(l.id).rows.map((r) => r.actual);
      const logic = judge(l.id, 'logic').rows.map((r) => r.actual);
      if (JSON.stringify(timing) !== JSON.stringify(logic)) mismatched.push(l.id);
    }
    expect(mismatched).toEqual([]);
  }, 300_000);

  it('政策：没声明时钟口的关卡不设毛刺上限（真实竞争不该被判错）', () => {
    const withLimit = levelLikeTiming.filter((l) => parseLevel(l).checks.maxGlitches !== undefined);
    expect(withLimit.map((l) => l.id)).toEqual([]);
  });
});

describe('批次①：两个锁存器（第 2 章收尾）', () => {
  it('按钮锁存：按下 / 复位那几行会抖，保持行整窗一次都不动', () => {
    const judged = judge('s2-btn-latch');
    const [, hold0, press, hold1, clear] = judged.rows;
    expect(judged.pass).toBe(true);
    expect(judged.isSequential).toBe(true); // 输出依赖历史
    // 保持行：时序下就是"整窗零跳变"——按钮松开后不能有任何抖动
    expect(hold0?.ok).toBe(true);
    expect(hold0?.glitches).toBe(0);
    expect(hold1?.ok).toBe(true);
    expect(hold1?.glitches).toBe(0);
    // 真在变化的那几行：确实抖了（真实竞争），但采样在停稳之后 → 答案正确
    expect(press?.glitches ?? 0).toBeGreaterThan(0);
    expect(clear?.glitches ?? 0).toBeGreaterThan(0);
    // 不设上限 → 判定面板不给"空翻超标"结论；关键路径 5.5ns 在 11ns 预算内
    expect(judged.timing.maxGlitches).toBeNull();
    expect(judged.timing.timingOk).toBe(true);
  });

  it('D 锁存器：透明行跟着 d 变，锁存行整窗不动', () => {
    const judged = judge('s2-d-latch');
    const [trans1, latch1, latchHeld, trans0, latch0] = judged.rows;
    expect(judged.pass).toBe(true);
    expect(judged.isSequential).toBe(true);
    // en=0 的三行（锁存）：d 怎么变都不许动
    expect(latch1?.glitches).toBe(0);
    expect(latchHeld?.glitches).toBe(0);
    expect(latch0?.glitches).toBe(0);
    // en=1 的两行（透明）：跟着 d 翻转，过程里有抖动
    expect(trans1?.glitches ?? 0).toBeGreaterThan(0);
    expect(trans0?.glitches ?? 0).toBeGreaterThan(0);
    expect(judged.timing.maxGlitches).toBeNull();
    expect(judged.timing.timingOk).toBe(true);
  });
});
