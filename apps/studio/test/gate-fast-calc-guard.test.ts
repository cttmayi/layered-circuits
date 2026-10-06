import { judgeDesign } from '@lc/compiler';
import { ALL_LEVELS, GATE_SEQ_SPECS, teachingModulesFor, teachingSolutionOf } from '@lc/content';
import { familySpecOf, InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';

/**
 * **s3-calc 的门级快路护栏（常驻）** —— 记录"分歧到底有多少、卡在哪"。
 *
 * 为什么要有它：s3-calc 是唯一还没转正的大关（也是最快的那条路最想覆盖的一关）。
 * 只靠人肉跑对照表，改一次元件级/门级的口径就不知道有没有变好；这里把**判定口径
 * （`mode: 'logic'`，正是 judge.ts 里门级快路生效的那个口径）**下的逐行差异钉住。
 *
 * 现状（实测，2026-10）：
 * - 元件级 logic：pass=true，row0 显示 0x6f，C 清屏后归 0x3f；
 * - 门级   logic：pass=false，**一直是 0x6f**（"99"），差异 **58/67**；
 * - 根因定位：门级顶层 `运算控制` 的 `accClk` 网读数是 1，但八位寄存器的 `clk` 引脚读到 0，
 *   ACC 的从锁存器永远等不到上升沿（状态槽 mod8/NN/mod3/q 恒 0、updates 里没有 ACC 写入）；
 *   而元件级 logic 是**无延迟定点求解**，交叉耦合锁存器收敛到的不动点与门级的
 *   「状态 + 时钟沿」模型不同（同一设计元件级 logic=0x3f、元件级 timing=0x6f）。
 *   详见 docs/design-gates.md 第 10 节。
 *
 * ⚠️ 这一条**故意**断言现状（pass 不同 + 差异 > 0）：等哪天把逻辑版口径对齐、
 * s3-calc 转正进白名单时，它会红 —— 那时请把断言改成「差异 0」，并把
 * `GATE_FAST_LEVELS` 里的 `s3-calc` 打开。
 */
describe('s3-calc：门级快路护栏（未转正）', () => {
  const id = 's3-calc';
  const level = ALL_LEVELS.find((l) => l.id === id);
  if (!level) throw new Error(`找不到关卡 ${id}`);

  const run = (fast: boolean) => {
    const spec = familySpecOf(level, 'rtl');
    const library = new InMemoryModuleLibrary([...teachingModulesFor('rtl')]);
    const design = teachingSolutionOf(id, 'rtl');
    if (!design) throw new Error(`${id} 没有门版参考解`);
    return judgeDesign(design, level, {
      library,
      mode: 'logic',
      family: spec.family,
      units: spec.units,
      timingBudgetPs: spec.timingBudgetPs,
      optimalHalf: spec.optimalHalf,
      budgetHalf: spec.budgetHalf,
      ...(fast ? { gateSeqSpecs: GATE_SEQ_SPECS } : {}),
    }) as unknown as { pass?: boolean; rows?: { actual: Record<string, unknown>; ok: boolean }[] };
  };

  const norm = (v: Record<string, unknown> | undefined): string =>
    JSON.stringify(Object.fromEntries(Object.entries(v ?? {}).map(([k, x]) => [k, String(x)])));

  it('元件级判定通过；门级判定仍与元件级不一致（放行前不许进白名单）', () => {
    const slow = run(false);
    const fast = run(true);
    const rows = slow.rows ?? [];
    const diff = rows.filter((r, i) => norm(r.actual) !== norm(fast.rows?.[i]?.actual)).length;

    // 元件级是权威口径：s3-calc 的参考解必须过
    expect(slow.pass).toBe(true);
    expect(rows.length).toBe(67);

    // 现状：门级结论不一致、逐行数值也有差异 → 白名单继续不放行
    expect(fast.pass).toBe(false);
    expect(diff).toBeGreaterThan(0);
  }, 600_000);
});
