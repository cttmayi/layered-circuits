import { gateFastSupportReason, judgeDesign } from '@lc/compiler';
import {
  ALL_LEVELS,
  GATE_FAST_LEVELS,
  GATE_SEQ_SPECS,
  teachingModulesFor,
  teachingSolutionOf,
} from '@lc/content';
import { familySpecOf, InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';

/**
 * **门级快路审计**：遍历所有"判定口径 = logic"的关卡，报告**谁能吃快路、谁不能、为什么**。
 *
 * 为什么要它：门级快路只在 `mode === 'logic'` 下生效（生产上 handle.ts 传的是玩家当前视图模式），
 * 而 judge 对"不适用"的关卡是**静默回落元件级** —— 回落本身是安全的（判定仍走元件级、结果正确），
 * 但**没人知道有哪些关在被静默回落**。这个测试把清单打出来，并顺手防两种漏网：
 *   ① 明明门级能算对、却忘了加进 `GATE_FAST_LEVELS` 的关卡（少赚了加速）→ 判成红色；
 *   ② 吃不到快路的关卡必须给出**非空原因**，不允许"不知道为什么就是不行"。
 *
 * 当前清单（实测输出见本测试的 console.log）：
 *   · s3-calc —— 时钟来自【运算控制】内部的**延迟链（环形振荡器）**，零延迟求值会把它塌成静态电平，
 *     门级 29/67 行读旧值 → 自动回落元件级。可执行证据见 gate-calc-delay-clock.test.ts。
 *   · s3-or-chain（以及第 1、2 章的元件级关卡）—— **没有门版参考解**（`teachingSolutionOf(id,'rtl')` 为空），
 *     无从比较，自然也不放行。
 */
/** 与 gate-fast-report / 白名单前置条件两个仪器**同一口径**：只比每行的读数（actual），
 *  并把数字与字符串归一化，避免"1 vs '1'"这种表示差异误报成不符。*/
const normActual = (v: Record<string, unknown> | undefined): string =>
  JSON.stringify(Object.fromEntries(Object.entries(v ?? {}).map(([k, x]) => [k, String(x)])));

describe('门级快路审计：哪些 logic 关卡吃不到快路、为什么', () => {
  it('遍历全部 logic 关卡，报告清单并拦住"该放行却漏掉"的', () => {
    const library = new InMemoryModuleLibrary([...teachingModulesFor('rtl')]);
    const logicLevels = ALL_LEVELS.filter(
      (l) => (l as { judgeMode?: string }).judgeMode === 'logic',
    );
    expect(logicLevels.length).toBeGreaterThan(0);

    /** 分类：能吃 / 吃不到（含原因）*/
    type Row = {
      id: string;
      whitelisted: boolean;
      elementPass: boolean | undefined;
      gatePass: boolean | undefined;
      diff: number;
      rows: number;
      reason: string;
    };
    const audit: Row[] = [];

    for (const level of logicLevels) {
      const spec = familySpecOf(level, 'rtl');
      const design = teachingSolutionOf(level.id, 'rtl');
      const whitelisted = GATE_FAST_LEVELS.includes(level.id);
      const common = {
        library,
        family: spec.family,
        units: spec.units,
        timingBudgetPs: spec.timingBudgetPs,
        optimalHalf: spec.optimalHalf,
        budgetHalf: spec.budgetHalf,
      };
      if (!design) {
        audit.push({
          id: level.id,
          whitelisted,
          elementPass: undefined,
          gatePass: undefined,
          diff: 0,
          rows: 0,
          reason: '没有门版参考解（无从比较，也就无从放行）',
        });
        continue;
      }
      // ① 门级引擎本身能不能吃这份设计（含元件 / 缺 SeqSpec / 库缺模块）
      const unsupported = gateFastSupportReason(design, library, GATE_SEQ_SPECS);
      const element = judgeDesign(design, level, { ...common, mode: 'logic' }) as unknown as {
        pass?: boolean;
        rows?: { ok: boolean; actual?: Record<string, unknown> }[];
      };
      if (unsupported !== null) {
        audit.push({
          id: level.id,
          whitelisted,
          elementPass: element.pass,
          gatePass: undefined,
          diff: 0,
          rows: element.rows?.length ?? 0,
          reason: `门级引擎不适用：${unsupported}`,
        });
        continue;
      }
      // ② 真的把门级跑起来（mode:'logic' + gateSeqSpecs 才会走门级，别用 timing 量 —— 那是假绿）
      const gate = judgeDesign(design, level, {
        ...common,
        mode: 'logic',
        gateSeqSpecs: GATE_SEQ_SPECS,
      }) as unknown as { pass?: boolean; rows?: { actual?: Record<string, unknown> }[] };
      const er = element.rows ?? [];
      const gr = gate.rows ?? [];
      const diff = er.filter((r, i) => normActual(r.actual) !== normActual(gr[i]?.actual)).length;
      const same = element.pass === gate.pass && diff === 0 && er.length === gr.length;
      audit.push({
        id: level.id,
        whitelisted,
        elementPass: element.pass,
        gatePass: gate.pass,
        diff,
        rows: er.length,
        reason: same
          ? ''
          : `门级结论与元件级不同（pass ${String(element.pass)}→${String(gate.pass)}，逐行数值差异 ${diff}/${er.length}）`,
      });
    }

    const blocked = audit.filter((r) => !r.whitelisted);
    console.log(
      `[门级快路审计] logic 关卡 ${audit.length} 个：能吃到 ${audit.length - blocked.length} 个`,
    );
    for (const r of audit) {
      const tag = r.whitelisted ? '✅ 已放行' : '⛔ 回落元件级';
      console.log(
        `  ${tag} ${r.id}：${r.whitelisted ? `门级与元件级一致（${r.rows} 行）` : r.reason}`,
      );
    }

    // 吃不到快路的关卡必须给得出原因（不允许"不知道为什么就是不行"）
    for (const r of blocked) expect(r.reason.length, `${r.id} 没给出原因`).toBeGreaterThan(0);

    // 防漏网：门级明明能算对（pass 相同、逐行相同）却没进白名单 → 立刻红，提示去放行
    const missed = blocked.filter(
      (r) =>
        r.reason === '' &&
        r.elementPass === r.gatePass &&
        r.diff === 0 &&
        r.rows > 0 &&
        // 没有门版参考解、或门级引擎不适用的不算"漏网"（已经用 reason 区分）
        !r.reason.startsWith('没有门版参考解'),
    );
    expect(missed.map((r) => r.id)).toEqual([]);
  }, 900_000);
});
