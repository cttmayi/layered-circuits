import { judgeDesign } from '@lc/compiler';
import {
  ALL_LEVELS,
  auditGateFastEligibility,
  formatGateFastAudit,
  GATE_FAST_LEVELS,
  GATE_SEQ_SPECS,
  teachingModulesFor,
  teachingSolutionOf,
} from '@lc/content';
import { familySpecOf, InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';

/**
 * **白名单前置条件（常驻护栏）**：凡进了 `GATE_FAST_LEVELS` 的关卡，
 * 门级快路必须能在**门版参考解**上复现元件级的判定 —— `pass` 相同、且逐行数值相同。
 *
 * 为什么要有它：白名单是**唯一开关**（`apps/studio/src/sim/handle.ts` 只对白名单里的关卡
 * 传 `gateSeqSpecs`）。放错一关的后果不是"慢一点"，而是**玩家过不了关**：判定改用门级引擎后，
 * 连关卡自带参考答案都判不过。而 `judgeDesign` 在门级算不出来时会**静默回落**元件级，
 * 于是"两边一致"也可能是假的（见 docs/design-gates.md 10.3 那个假绿坑）。
 * 所以这条护栏**不信任**"看起来一致"，而是逐行核对，并且**要求门级真的给出了答案**。
 *
 * 判读：这里红了 = 白名单里有关卡的门级结论与元件级不同 = **立刻把它移出白名单**
 * （`packages/content/src/gate-seq-specs.ts`），宁可不快不能算错。
 *
 * 口径说明：`apps/studio/src/sim/handle.ts`（第 93 行）传的是**玩家当前视图模式**
 * （`mode: req.mode`），而 `judge.ts` 只在 `mode === 'logic'` 时才走门级快路
 * —— 所以快路**只在逻辑视图生效**；时序视图下即使在白名单里也仍旧走元件级（安全但不变快）。
 * 本用例因此按 `mode:'logic'`（快路真正生效的那一个口径）核对：这才是玩家会遇到的判定。
 */
type Row = { actual: Record<string, unknown>; expected?: Record<string, unknown>; ok: boolean };

const norm = (v: Record<string, unknown> | undefined): string =>
  JSON.stringify(Object.fromEntries(Object.entries(v ?? {}).map(([k, x]) => [k, String(x)])));

const runOne = (id: string, fast: boolean) => {
  const level = ALL_LEVELS.find((l) => l.id === id);
  if (!level) return { why: `找不到关卡 ${id}` } as const;
  const design = teachingSolutionOf(id, 'rtl');
  // 白名单里的关卡必须有门版参考解：没有它就无法验证"门级与元件级一致"这个前置条件
  if (!design) return { why: `${id} 没有门版参考解，无法验证前置条件` } as const;
  const spec = familySpecOf(level, 'rtl');
  const r = judgeDesign(design, level, {
    library: new InMemoryModuleLibrary([...teachingModulesFor('rtl')]),
    mode: 'logic', // ← 快路真正生效的口径（见文件头：时序视图下快路不执行）
    family: spec.family,
    units: spec.units,
    timingBudgetPs: spec.timingBudgetPs,
    optimalHalf: spec.optimalHalf,
    budgetHalf: spec.budgetHalf,
    ...(fast ? { gateSeqSpecs: GATE_SEQ_SPECS } : {}),
  }) as unknown as { pass?: boolean; rows?: Row[] };
  return { pass: r.pass, rows: r.rows ?? [] } as const;
};

describe('白名单前置条件：门级必须能复现元件级判定', () => {
  it('GATE_FAST_LEVELS 里每一关：pass 相同、逐行数值相同', () => {
    const problems: string[] = [];
    const lines: string[] = [`白名单 ${GATE_FAST_LEVELS.length} 关`];
    for (const id of GATE_FAST_LEVELS) {
      const slow = runOne(id, false);
      const fast = runOne(id, true);
      if ('why' in slow || 'why' in fast) {
        problems.push(String('why' in slow ? slow.why : (fast as { why: string }).why));
        continue;
      }
      const rows = slow.rows;
      const diff = rows.filter((r, i) => norm(r.actual) !== norm(fast.rows[i]?.actual)).length;
      const bad = rows.filter((r) => !r.ok).length;
      lines.push(
        `${id}: 元件级 pass=${String(slow.pass)} 门级 pass=${String(fast.pass)} 行差异 ${diff}/${rows.length} 元件级不通过 ${bad}`,
      );
      if (slow.pass !== fast.pass)
        problems.push(
          `${id}: pass 不同（元件级 ${String(slow.pass)} / 门级 ${String(fast.pass)}）`,
        );
      if (diff !== 0) problems.push(`${id}: 逐行数值差异 ${diff}/${rows.length}`);
      if (fast.rows.length !== rows.length)
        problems.push(`${id}: 行数不同（${rows.length} vs ${fast.rows.length}）`);
      if (slow.pass !== true)
        problems.push(`${id}: 门版参考解自己没通过（元件级 pass=${String(slow.pass)}）`);
    }
    console.log(`[白名单前置条件]\n${lines.join('\n')}`);
    // 每次跑（含每次 pnpm check）都**同时打印全表**：哪些 logic 关卡吃不到快路、为什么。
    // 于是"静默回落"不再是隐形的坑 —— 看 check 输出就知道边界在哪（实现见 @lc/content）。
    console.log(`\n${formatGateFastAudit(auditGateFastEligibility())}\n`);
    expect(problems).toEqual([]);
  }, 600_000);
});
