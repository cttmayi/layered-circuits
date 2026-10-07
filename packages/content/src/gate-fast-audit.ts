/**
 * **门级快路审计**：哪些"判定口径 = logic"的关卡吃不到门级快路、为什么。
 *
 * 为什么要做成**可读输出**而不是只靠护栏红绿：
 *   judge 对"门级不适用"的关卡是**静默回落元件级** —— 回落本身安全（判定仍走元件级、结果正确），
 *   但如果不主动报告，就没人知道**有哪些关在被静默回落、为什么**，将来新增关卡也会悄悄掉进来。
 *   所以这里把清单做成一张表，三个出口共用同一份实现（避免三处各写一遍再各自漂移）：
 *     · `pnpm lc-expect --audit`                ← 命令行随时看
 *     · `apps/studio/test/gate-fast-audit.test.ts`         ← 跑测试时看，并自动拦住两种异常
 *     · `apps/studio/test/gate-fast-whitelist-precondition.test.ts` ← 每次 pnpm check 都会打印
 *
 * 判定"能不能吃快路"的**唯一**标准是实测：门级跑出来的 pass 与逐行数值是否与元件级完全相同
 * （不是"看起来像"、更不是靠人记）。**不许为了加速去改关卡期望值** —— 见 docs/design-gates.md §10.5。
 */
import { judgeDesign } from '@lc/compiler';
import { familySpecOf, InMemoryModuleLibrary } from '@lc/schema';
import { GATE_FAST_LEVELS, GATE_SEQ_SPECS } from './gate-seq-specs.js';
import { ALL_LEVELS } from './levels.js';
import { teachingModulesFor, teachingSolutionOf } from './teachings.js';

/**
 * 吃不到快路的关卡 → **人类可读的根因**（必须写清"为什么"，不是"就是不行"）。
 *
 * 硬规定：审计**要求每个回落关卡都在这里有记录**（见 auditGateFastEligibility 的
 * documented 字段与测试断言）—— 于是将来新增的"吃不到快路"的关卡会**自动暴露**，
 * 必须有人来把根因写清楚，而不是靠人记。
 */
export const GATE_FAST_BLOCKED_CAUSES: Readonly<Record<string, string>> = {
  's3-calc':
    '第 0 行「待命（上电先按 C 清零）」上电态不同：元件级收敛到 0x6f/0x6f，有延迟门级收敛到 0x4f/0x4f（差 e 段），' +
    '其余 66/67 行逐位相同。该行**没有期望值**（关卡要求玩家先按 C），两台上 pass=true —— 但审计判据是"逐行数值全等"，' +
    '所以本关仍不放行。注：零延迟口径下本关曾是 29/67 行读旧值（已随"有界延迟+惯性"口径修好，见 gate-seq-specs.ts 注释）。' +
    '要放行只有两条路（需拍板）：把无期望值的行定义成 不必比对（don’t-care），或改关卡内容。',
  's3-or-chain':
    '没有门版参考解（teachingSolutionOf(id, "rtl") 返回空）→ 门级结论无从比较，也就无从放行',
};

export interface GateFastAuditRow {
  id: string;
  /** 是否在白名单里（能在生产上吃到快路）*/
  whitelisted: boolean;
  /** 门级与元件级是否可以互相复现（实测）*/
  reproducible: boolean;
  elementPass: boolean | undefined;
  gatePass: boolean | undefined;
  /** 逐行**数值**差异数（只比每行读数 actual，数字与字符串归一化，与 gate-fast-report 同口径）*/
  diff: number;
  /** 向量行数 */
  rows: number;
  /** 回落原因（放行时为 ''）*/
  reason: string;
  /** 支撑原因的证据（放行时为 ''）*/
  evidence: string;
  /** 回落原因是否已在 GATE_FAST_BLOCKED_CAUSES 里记录（新关卡漏记 → false）*/
  documented: boolean;
}

/** 只比每行读数（actual），并把数字与字符串归一化 —— 与 gate-fast-report 的口径一致 */
const normActual = (v: Record<string, unknown> | undefined): string =>
  JSON.stringify(Object.fromEntries(Object.entries(v ?? {}).map(([k, x]) => [k, String(x)])));

/** 跑一遍全量审计（20 关约 2~3 秒）*/
export const auditGateFastEligibility = (): GateFastAuditRow[] => {
  const library = new InMemoryModuleLibrary([...teachingModulesFor('rtl')]);
  const logicLevels = ALL_LEVELS.filter((l) => (l as { judgeMode?: string }).judgeMode === 'logic');
  const out: GateFastAuditRow[] = [];
  for (const level of logicLevels) {
    const listed = GATE_FAST_LEVELS.includes(level.id);
    const spec = familySpecOf(level, 'rtl');
    const design = teachingSolutionOf(level.id, 'rtl');
    const common = {
      library,
      family: spec.family,
      units: spec.units,
      timingBudgetPs: spec.timingBudgetPs,
      optimalHalf: spec.optimalHalf,
      budgetHalf: spec.budgetHalf,
    };
    if (!design) {
      out.push({
        id: level.id,
        whitelisted: listed,
        reproducible: false,
        elementPass: undefined,
        gatePass: undefined,
        diff: 0,
        rows: 0,
        reason: GATE_FAST_BLOCKED_CAUSES[level.id] ?? '没有门版参考解（无从比较）',
        evidence: 'teachingSolutionOf(id, "rtl") 为空',
        documented: level.id in GATE_FAST_BLOCKED_CAUSES,
      });
      continue;
    }
    const element = judgeDesign(design, level, { ...common, mode: 'logic' }) as unknown as {
      pass?: boolean;
      rows?: { actual?: Record<string, unknown> }[];
    };
    const gate = judgeDesign(design, level, {
      ...common,
      mode: 'logic',
      gateSeqSpecs: GATE_SEQ_SPECS,
    }) as unknown as { pass?: boolean; rows?: { actual?: Record<string, unknown> }[] };
    const er = element.rows ?? [];
    const gr = gate.rows ?? [];
    const diff = er.filter((r, i) => normActual(r.actual) !== normActual(gr[i]?.actual)).length;
    const reproducible = element.pass === gate.pass && diff === 0 && er.length === gr.length;
    out.push({
      id: level.id,
      whitelisted: listed,
      reproducible,
      elementPass: element.pass,
      gatePass: gate.pass,
      diff,
      rows: er.length,
      reason: reproducible
        ? ''
        : (GATE_FAST_BLOCKED_CAUSES[level.id] ?? '门级结论与元件级不同（原因尚未记录）'),
      evidence: reproducible
        ? ''
        : `实测：门级 pass=${String(element.pass)}→${String(gate.pass)}，逐行数值差异 ${diff}/${er.length}`,
      documented: reproducible ? true : level.id in GATE_FAST_BLOCKED_CAUSES,
    });
  }
  return out;
};

/** 把审计结果渲染成**可读一张表**（三个出口共用）*/
export const formatGateFastAudit = (rows: readonly GateFastAuditRow[]): string => {
  const ok = rows.filter((r) => r.whitelisted);
  const blocked = rows.filter((r) => !r.whitelisted);
  const lines = [
    `[门级快路审计] 判定口径 = logic 的关卡 ${rows.length} 个：能吃到快路 ${ok.length} 个 / 回落元件级 ${blocked.length} 个`,
    '',
    `✅ 已放行（${ok.length} 关，门级 pass 与逐行数值都与元件级一致）：`,
  ];
  for (const r of ok) lines.push(`   ${r.id}（${r.rows} 行）`);
  lines.push('', `⛔ 回落元件级（${blocked.length} 关，判定仍正确、只是不加速）：`);
  for (const r of blocked) {
    lines.push(`   ${r.id}：${r.reason}`);
    if (r.evidence) lines.push(`        证据｜${r.evidence}`);
    if (!r.documented) lines.push('        ⚠️ 根因未记录 —— 请在 GATE_FAST_BLOCKED_CAUSES 里补上');
  }
  return lines.join('\n');
};
