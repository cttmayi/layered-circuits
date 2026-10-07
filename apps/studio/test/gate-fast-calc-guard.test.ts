import { judgeDesign } from '@lc/compiler';
import { ALL_LEVELS, GATE_SEQ_SPECS, teachingModulesFor, teachingSolutionOf } from '@lc/content';
import { familySpecOf, InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';

/**
 * **s3-calc 的门级快路护栏（常驻）** —— 记录"分歧到底有多少、卡在哪"。
 *
 * 为什么要有它：s3-calc 是唯一还没转正的大关（也是最快的那条路最想覆盖的一关）。
 * 只靠人肉跑对照表，改一次元件级/门级的口径就不知道有没有变好；这里把**判定真用口径
 * （`judgeMode`；judge.ts 里门级快路只在这个口径下生效）**下的逐行差异钉住。
 *
 * ⚠️ 别再用 `mode:'timing'` 去量门级：那条路的门级快路**不会执行**，会静默回落元件级，
 * 于是"两边完全一致"其实是元件级跑了两遍的**假绿**（曾经据此误判过一次，见
 * docs/design-gates.md 10.3）。本用例只用生效口径，并断言"门级确实不一致"这一现状。
 *
 * 现状（实测，第 ⑲ 轮改口径后 = 有界延迟 + 惯性）：
 * - 元件级 logic：pass=true，row0 显示 0x6f，C 清屏后归 0x3f；
 * - 门级   logic：pass=true，**只剩 row0 的上电态不同**（0x4f），差异 **1/67**；
 *   （历史：零延迟门级 pass=false、差异 58/67 —— 那是"把建立时间抹掉"造成的，现已修好）
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

  it('元件级判定通过；门级（有延迟口径）只剩「待命」那一行的上电态不同 → 仍不放行（审计判据=逐行全等）', () => {
    const slow = run(false);
    expect(slow.pass).toBe(true);
    const rows = slow.rows ?? [];
    expect(rows.length).toBe(67);

    // 第 ⑲ 轮改口径后（有界延迟 + 惯性）：门级与元件级只剩第 0 行「待命（上电先按 C 清零）」不同
    // （元件收敛到 0x6f/0x6f、门级收敛到 0x4f/0x4f，差 e 段；该行没有期望值，两台上 pass=true）。
    // 审计判据是"逐行数值全等"，所以白名单**继续不放行**；"门级一直 0x6f、差 58/67"已成历史。
    const fast = run(true);
    const diff = rows.filter((r, i) => norm(r.actual) !== norm(fast.rows?.[i]?.actual)).length;
    console.log(
      `  元件级 ${rows.length} 行 pass=${String(slow.pass)}｜门级（有延迟）pass=${String(fast.pass)} 差异 ${diff} 行 → 白名单继续不放行`,
    );
    expect(diff).toBe(1);
    expect(Object.keys(rows[0]?.actual ?? {}).length).toBeGreaterThan(0);
  }, 600_000);
});
