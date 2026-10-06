import { judgeDesign } from '@lc/compiler';
import { InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { findLevel } from '../src/index';

/**
 * 「逻辑版」判定口径的契约：**不看任何时间量**。
 *
 * 玩家可在工具栏切换：时序版（默认）= 主线硬核口径，按真实元件延迟判定；
 * 逻辑版 = 抹平延迟，只看逻辑对不对 —— 不实测延迟、不评延迟档（结果里
 * timingBudgetPs 置 null，于是评星只按成本）、不查毛刺、不查建立/保持。
 */
describe('逻辑版判定口径', () => {
  const level = findLevel('s1-not')!;
  const library = new InMemoryModuleLibrary();
  // 故意显式传一个延迟预算：时序版要照常评，逻辑版必须「无视」它
  const base = { library, timingBudgetPs: 999_999, hardcore: true };

  it('时序版：照常实测传播延迟，并保留延迟预算', () => {
    const r = judgeDesign(level.referenceSolution!, level, { ...base, mode: 'timing' });
    expect(r.pass).toBe(true);
    expect(r.criticalPathPs).toBeGreaterThan(0);
    expect(r.timingBudgetPs).toBe(999_999);
  });

  it('逻辑版：无视已声明的延迟预算，不测延迟、延迟档置空', () => {
    const r = judgeDesign(level.referenceSolution!, level, { ...base, mode: 'logic' });
    expect(r.pass).toBe(true);
    // 置空 → apps/studio 的 starsOf 把延迟档视为达标，只按成本评星
    expect(r.timingBudgetPs).toBeNull();
    expect(r.criticalPathPs).toBe(0);
  });

  it('逻辑版：毛刺与建立/保持都不查（hardcore 一并关掉）', () => {
    const r = judgeDesign(level.referenceSolution!, level, { ...base, mode: 'logic' });
    expect(r.timing.maxGlitches).toBeNull();
    expect(r.timing.setupBudgetPs).toBeNull();
    expect(r.timing.holdBudgetPs).toBeNull();
  });
});
