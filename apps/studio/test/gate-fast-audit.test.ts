import { auditGateFastEligibility, formatGateFastAudit } from '@lc/content';
import { describe, expect, it } from 'vitest';

/**
 * **门级快路审计（可读输出 + 两道自动闸）**
 *
 * 表本身由 `@lc/content` 的 `auditGateFastEligibility()` 生成（同一份实现，另两个出口是
 * `pnpm lc-expect --audit` 与 `gate-fast-whitelist-precondition.test.ts`，
 * 避免三处各写一遍然后各自漂移）。
 *
 * 判据是**实测**：门级跑出来的 pass 与逐行数值是否与元件级完全相同。
 * 两道自动闸：
 *  ① **回落必须给得出根因**：吃不到快路的关卡若在 `GATE_FAST_BLOCKED_CAUSES` 里没有记录 → 红
 *     （于是将来新增关卡一旦掉进"回落"就会自动暴露，必须有人把"为什么"写清楚）；
 *  ② **不许漏放行**：门级明明能复现元件级（pass 相同、逐行 0 差异）却不在 `GATE_FAST_LEVELS` → 红。
 *
 * 硬规定（见 docs/design-gates.md §10.5）：**新增 logic 关卡要吃快路，必须通过前置条件护栏
 * （门级 pass 相同 + 逐行数值相同 + 行数相同 + 门版参考解自身通过）；不通过就回落元件级，
 * 不许为了加速去改期望值。**
 */
describe('门级快路审计：哪些 logic 关卡吃不到快路、为什么', () => {
  it('打印全表；回落必须有已记录的根因；能复现却不放行 → 红', () => {
    const rows = auditGateFastEligibility();
    console.log(`\n${formatGateFastAudit(rows)}\n`);

    expect(rows.length).toBeGreaterThan(0);

    // ① 回落元件级的关卡必须记录根因（新关卡漏记 → 这里红）
    const undocumented = rows.filter((r) => !r.whitelisted && !r.documented).map((r) => r.id);
    expect(undocumented, `这些关卡吃不到快路却没记录根因：${undocumented.join('、')}`).toEqual([]);

    // ② 能复现却不放行 → 红（少赚加速也要被发现）
    const missed = rows.filter((r) => !r.whitelisted && r.reproducible).map((r) => r.id);
    expect(missed, `这些关门级能复现元件级却没进白名单：${missed.join('、')}`).toEqual([]);

    // ③ 反向：放行了就必须真能复现（与前置条件护栏同向，双保险）
    const wrong = rows.filter((r) => r.whitelisted && !r.reproducible).map((r) => r.id);
    expect(wrong, `这些关在白名单里但门级复现不了元件级：${wrong.join('、')}`).toEqual([]);
  }, 900_000);
});
