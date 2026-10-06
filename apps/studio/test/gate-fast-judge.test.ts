import { judgeDesign } from '@lc/compiler';
import { ALL_LEVELS, GATE_SEQ_SPECS, teachingModulesFor, teachingSolutionOf } from '@lc/content';
import { familySpecOf, InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';

/**
 * 第 6 步：门级快路的**实测 + 一致性护栏**。
 *
 * 同一个设计跑两遍判定：
 *   A. 不带 gateSeqSpecs → 走原来的**元件级**引擎；
 *   B. 带 gateSeqSpecs   → 逻辑版 + 纯模块设计会走**门级**引擎。
 * 两者结论必须一致（pass 相同），并且把耗时打出来 —— 这是"快了多少"的唯一凭据。
 *
 * 注意：若某个关因为"有元件 / 时序积木缺声明"而回落，两遍其实都在元件级跑，
 * 结论仍然一致、而耗时也几乎一样 —— 这本身就是有用的信息（说明快路没覆盖到它）。
 */

const levelById = (id: string) => {
  const level = ALL_LEVELS.find((l) => l.id === id);
  if (!level) throw new Error(`找不到关卡 ${id}`);
  return level;
};

const run = (id: string, withFast: boolean) => {
  const level = levelById(id);
  const family = 'rtl';
  const spec = familySpecOf(level, family);
  const library = new InMemoryModuleLibrary([...teachingModulesFor(family)]);
  const design = teachingSolutionOf(id, family);
  if (!design) throw new Error(`${id} 没有门版参考解`);
  const t0 = performance.now();
  const result = judgeDesign(design, level, {
    library,
    mode: 'logic',
    family: spec.family,
    units: spec.units,
    timingBudgetPs: spec.timingBudgetPs,
    optimalHalf: spec.optimalHalf,
    budgetHalf: spec.budgetHalf,
    ...(withFast ? { gateSeqSpecs: GATE_SEQ_SPECS } : {}),
  }) as unknown as { pass?: boolean; errors?: string[]; stars?: number };
  const ms = performance.now() - t0;
  return { pass: result.pass, errors: result.errors ?? [], stars: result.stars, ms };
};

describe('第 6 步：门级快路实测与一致性', () => {
  // s3-half-adder：已启用的关（白名单）→ 必须严格一致
  for (const id of ['s3-half-adder']) {
    it(`${id}：带快路与不带快路结论一致，并报出耗时`, () => {
      const slow = run(id, false);
      const fast = run(id, true);
      console.log(
        `[快路实测] ${id}: 元件级 ${slow.ms.toFixed(0)}ms (pass=${String(slow.pass)}) / ` +
          `带快路 ${fast.ms.toFixed(0)}ms (pass=${String(fast.pass)})`,
      );
      expect(fast.pass).toBe(slow.pass);
    }, 120_000);
  }
});

describe('已知缺陷（护栏盯着，修好前不许启快路）', () => {
  it.skip('s3-calc：门级快路结论与元件级不一致，而且更慢（实测 pass=false / 4928ms）', () => {
    // 实测（本机）：元件级 108ms(pass=true) / 带快路 4928ms(**pass=false**)。
    // 现象：走上门级之后既**算错**（pass=false）又**慢 45 倍**。
    // 因此 s3-calc 不在 GATE_FAST_LEVELS 白名单里，生产路径上仍走元件级。
    // 待查：① 结论为何不一致（功能原子口径？数字输入寄存器递归？lane 键？）
    //       ② 为什么慢（每个向量从头求值、复合模块无缓存）
    // 修好后把这一条改成真断言，并把 s3-calc 加进白名单。
    const slow = run('s3-calc', false);
    const fast = run('s3-calc', true);
    expect(fast.pass).toBe(slow.pass);
  }, 120_000);
});
