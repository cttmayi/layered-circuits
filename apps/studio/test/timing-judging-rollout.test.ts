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
function judge(levelId: string, mode?: 'logic' | 'timing', hardcore?: boolean): JudgeResult {
  const level = findLevel(levelId)!;
  const spec = familySpecOf(level, 'rtl');
  return judgeDesign(level.referenceSolution!, level, {
    library,
    ...(mode ? { mode } : {}),
    ...(hardcore !== undefined ? { hardcore } : {}),
    family: spec.family,
    units: spec.units,
    timingBudgetPs: spec.timingBudgetPs,
    optimalHalf: spec.optimalHalf,
    budgetHalf: spec.budgetHalf,
    bestKnownHalf: spec.bestKnownHalf,
  });
}

/** 批次③的 12 关（登记表引用它，该批次的行为断言也直接用它） */
const BATCH3_IDS = [
  's3-half-adder',
  's3-full-adder',
  's3-adder-4',
  's3-adder-8',
  's3-alu',
  's3-bcd2bin',
  's3-bin2bcd',
  's3-seg-de',
  's3-seg-fg',
  's3-display2',
  's3-or-chain',
  's3-encoder',
];

/** 已切到真实时序判定的关卡，按"什么时候切的"分组（新批次往上加一组） */
const BATCHES: Record<string, string[]> = {
  // 更早的改动里就切过去的（时钟型：靠 clockPort 定窗口；计算器链路：靠自身时序约定）
  先前: ['s2-dff', 's3-reg-8', 's3-digit-entry', 's3-calc'],
  试点: ['s2-sr-latch', 's3-display'],
  批次一_锁存器: ['s2-btn-latch', 's2-d-latch'],
  批次二_门级: ['s1-not', 's1-and', 's1-or', 's1-nand', 's1-nor', 's1-xor', 's1-xnor'],
  批次三_第3章组合与算术: BATCH3_IDS,
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

describe('批次②：第一章门级关（判定看得见门延迟）', () => {
  const GATES = ['s1-not', 's1-and', 's1-or', 's1-nand', 's1-nor', 's1-xor', 's1-xnor'];

  it('纯度：都是纯组合（没藏锁存器），关键路径非 0 且在预算内', () => {
    for (const id of GATES) {
      const judged = judge(id);
      expect(judged.pass, id).toBe(true);
      expect(judged.isSequential, id).toBe(false);
      expect(judged.timing.criticalPathPs ?? 0, id).toBeGreaterThan(0); // 延迟是真的
      expect(judged.timing.timingOk, id).toBe(true);
    }
  }, 120_000);

  it('门级关也会闪（真实竞争），但采样在停稳之后 → 仍全部答对，且不设毛刺上限', () => {
    let sawGlitch = false;
    for (const id of GATES) {
      const judged = judge(id);
      expect(judged.pass, id).toBe(true); // 闪不影响正确性：采样在停稳之后
      expect(judged.timing.maxGlitches, id).toBeNull(); // 未声明上限 → 不误报"空翻超标"
      if (Math.max(...judged.rows.map((r) => r.glitches)) > 1) sawGlitch = true;
    }
    // 防止这条测试空过：门级关确实存在 >1 次跳变（实测 1~3 次，见 timing-mode-parity 的实测记录）
    expect(sawGlitch).toBe(true);
  }, 120_000);
});

describe('批次③：第 3 章组合与算术（进位链与译码器）', () => {
  const BATCH3 = BATCH3_IDS;

  it('全部判定通过；有预算的关卡关键路径都在预算内', () => {
    for (const id of BATCH3) {
      const judged = judge(id);
      expect(judged.pass, id).toBe(true);
      expect(judged.timing.timingOk, id).toBe(true);
      const budget = findLevel(id)!.timingBudgetPs;
      if (budget !== undefined) {
        expect(judged.timing.criticalPathPs ?? 0, id).toBeLessThanOrEqual(budget);
        expect(judged.timing.criticalPathPs ?? 0, id).toBeGreaterThan(0); // 延迟统计真的算出来了
      }
    }
  }, 300_000);

  it('进位链/译码器的竞争看得见：最坏单窗口 >1 次跳变，但采样在停稳之后 → 仍答对', () => {
    let worst = 0;
    for (const id of BATCH3) {
      const judged = judge(id);
      expect(judged.pass, id).toBe(true);
      worst = Math.max(worst, ...judged.rows.map((r) => r.glitches));
    }
    expect(worst).toBeGreaterThan(4); // 太长进位链/译码器必然有多级竞争（实测最坏 26 次）
  }, 300_000);
});

describe('判定不受玩家开关影响（全面时序化的最后一条耦合）', () => {
  it('hardcore 开关（科普/硬核）不改变任何一关的判定结论', () => {
    // 背景：App 现在传 hardcore = 时序挑战关 || 「硬核模式」开关。实测这份开关对参考解的
    // 结论没有影响（含带时钟口的三关），所以判定彻底与它解耦是安全的 —— 这条测试守住这点。
    const mismatched: string[] = [];
    for (const l of timingLevels) {
      const on = judge(l.id, undefined, true);
      const off = judge(l.id, undefined, false);
      const same =
        on.pass === off.pass &&
        JSON.stringify(on.rows.map((r) => r.ok)) === JSON.stringify(off.rows.map((r) => r.ok)) &&
        JSON.stringify(on.rows.map((r) => r.actual)) ===
          JSON.stringify(off.rows.map((r) => r.actual));
      if (!same) mismatched.push(l.id);
    }
    expect(mismatched).toEqual([]);
  }, 600_000);
});
