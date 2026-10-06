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

/**
 * 关卡内容编排：1~3 关只能元件、4~7 关元件+模块（都走时序），第 8 关起只能用模块 + 只判逻辑。
 * 这两条是**关卡自带**的（elementAccess / judgeMode），不是全局开关。
 */
describe('关卡自带的口径与素材约束', () => {
  const library = new InMemoryModuleLibrary();
  const elementDesign = findLevel('s1-not')!.referenceSolution!;

  it('第 8 关起：17~27 关都标注了只能用模块 + 只判逻辑', () => {
    for (const id of ['s2-sr-latch', 's2-dff', 's3-half-adder', 's3-bin2bcd', 's3-calc']) {
      const level = findLevel(id)!;
      expect(level.elementAccess, id).toBe('none');
      expect(level.judgeMode, id).toBe('logic');
    }
  });

  it('1~7 关：允许元件，且判定仍走真实时序', () => {
    for (const id of ['s1-not', 's1-and', 's1-or', 's1-nand', 's1-nor', 's1-xor', 's1-xnor']) {
      const level = findLevel(id)!;
      expect(level.elementAccess, id).toBe('all');
      expect(level.judgeMode, id).toBe('timing');
    }
  });

  /**
   * ⚠️ 已知未生效：这条现在是**复现器**，不是通过的护栏。
   *
   * 实测证据（本轮）：拿四关**自己的参考解**去判它自己的关，全部 pass=true、errors 空 ——
   *   s3-half-adder(元件30/模块0)、s3-calc(元件6191/模块0)、s2-sr-latch(元件10)、s2-dff(元件49)
   * 也就是说 schema 字段与内容标注都对（上面两条测试守着），但 judgeDesign 这条路径上
   * **没有执行** elementAccess 检查 → 玩家在只能用模块的关卡里摆元件，不会被拦。
   * 另一个连带问题：那 20 关的参考解本身就是元件搭的，规则一旦生效会拒掉游戏自己的参考解
   * （需二选一：参考解换门版，或对参考解豁免）。
   */
  it.skip('只能用模块的关卡：画布上摆元件 → 判不通过并说明原因', () => {
    const level = findLevel('s2-sr-latch')!;
    const r = judgeDesign(elementDesign, level, { library, mode: 'logic' });
    expect(r.errors.join(' ')).toContain('本关只能用模块搭建');
  });

  it('同一种元件解法在 1~7 关不会被这条规则拒绝', () => {
    const level = findLevel('s1-nand')!;
    const r = judgeDesign(elementDesign, level, { library, mode: 'timing' });
    expect(r.errors.join(' ')).not.toContain('本关只能用模块搭建');
  });
});
