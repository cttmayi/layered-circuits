import { judgeDesign } from '@lc/compiler';
import { ALL_LEVELS, GATE_SEQ_SPECS, teachingModulesFor, teachingSolutionOf } from '@lc/content';
import { familySpecOf, InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';

/**
 * **门级快路对照表（常驻仪器）** —— 不是断言正确性的测试，而是"量进度"的仪表。
 *
 * 为什么要有它：门级引擎是**第二套仿真器**，语义与元件级不同（无强弱、有显式状态）。
 * 靠"一关一关试"永远说不清进度；必须先有一张全关卡对照表，才能区分
 * 「系统性口径差异」与「个别真 bug」。
 *
 * 每行含义：元件级 pass / 门级 pass / 逐行数值差异（已把数字与字符串归一化后再比，
 * 避免把"1 vs '1'"这种表示差异误报成不符）/ 两端耗时。
 *
 * 判读方式：
 *  · pass 相同 + 差异 0  → 这关可以进 GATE_FAST_LEVELS 白名单；
 *  · pass 不同         → **不许**进白名单（宁可不快不能算错），记入待修根因；
 *  · 门级耗时不比元件级小 → 说明缓存还没做（性能是独立问题）。
 */
type Row = { actual: Record<string, unknown>; ok: boolean };

const norm = (v: Record<string, unknown> | undefined): string =>
  JSON.stringify(Object.fromEntries(Object.entries(v ?? {}).map(([k, x]) => [k, String(x)])));

const judge = (id: string, fast: boolean) => {
  const level = ALL_LEVELS.find((l) => l.id === id);
  if (!level) return null;
  const spec = familySpecOf(level, 'rtl');
  const library = new InMemoryModuleLibrary([...teachingModulesFor('rtl')]);
  const design = teachingSolutionOf(id, 'rtl');
  if (!design) return null;
  const t0 = performance.now();
  const r = judgeDesign(design, level, {
    library,
    mode: 'logic',
    family: spec.family,
    units: spec.units,
    timingBudgetPs: spec.timingBudgetPs,
    optimalHalf: spec.optimalHalf,
    budgetHalf: spec.budgetHalf,
    ...(fast ? { gateSeqSpecs: GATE_SEQ_SPECS } : {}),
  }) as unknown as { pass?: boolean; rows?: Row[] };
  return { pass: r.pass, rows: r.rows ?? [], ms: performance.now() - t0 };
};

describe('门级快路 · 全关卡对照表（仪器）', () => {
  it('打印对照表（逻辑版关卡全跑一遍）', () => {
    const ids = ALL_LEVELS.filter((l) => (l as { judgeMode?: string }).judgeMode === 'logic').map(
      (l) => l.id,
    );
    const lines: string[] = [`逻辑版关卡 ${ids.length} 个`];
    let same = 0;
    let total = 0;
    for (const id of ids) {
      const slow = judge(id, false);
      const fast = judge(id, true);
      if (!slow || !fast) {
        lines.push(`${id}: （无门版参考解）`);
        continue;
      }
      const diff = slow.rows.filter((r, i) => norm(r.actual) !== norm(fast.rows[i]?.actual)).length;
      total++;
      const ok = slow.pass === fast.pass && diff === 0;
      if (ok) same++;
      lines.push(
        `${id}: 元件级 pass=${String(slow.pass)} ${slow.ms.toFixed(0)}ms / 门级 pass=${String(fast.pass)} ` +
          `${fast.ms.toFixed(0)}ms / 差异 ${diff}/${slow.rows.length} ${ok ? '✅' : '❌'}`,
      );
    }
    lines.push(`完全一致：${same}/${total}`);
    console.log(`\n${lines.join('\n')}\n`);
    expect(total).toBeGreaterThan(0);
  }, 600_000);
});
