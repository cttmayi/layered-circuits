/**
 * 关卡判定：玩家的电路能不能过关、能得几分。
 *
 * 唯一硬性通关条件（GDD 2.2.3）：功能断言全通过 **且** 成本 ≤ 预算。
 * 硬核工程模式再加一条：关键路径 ≤ 关卡时序预算（双难度设计的落点）。
 *
 * 判定用的仿真与编辑器所见完全一致（同一套 compileDesign + runVectors + analyzeTiming），
 * 所以「面板上看到的现象」就是「判定的依据」，不会出现两套真相。
 */

import type { Design, Level, ModuleLibrary } from '@lc/schema';
import { costHalfOf, scoreOf } from '@lc/schema';
import { type Logic, runVectors, type SimMode } from '@lc/sim-core';
import { computeCosts } from './cost.js';
import { compileDesign } from './flatten.js';
import { analyzeTiming } from './timing.js';

export interface JudgeOptions {
  library: ModuleLibrary;
  /** 仿真模式；缺省用关卡声明的模式 */
  mode?: SimMode;
  /** 硬核工程模式：额外检查时序预算 */
  hardcore?: boolean;
}

export interface JudgeRow {
  index: number;
  inputs: Record<string, Logic>;
  expected: Record<string, Logic>;
  actual: Record<string, Logic>;
  ok: boolean;
  mismatches: Array<{ port: string; expected: Logic; actual: Logic }>;
}

export interface JudgeResult {
  pass: boolean;
  /** 逐向量结果：玩家能直接看到「哪一行错了」 */
  rows: JudgeRow[];
  failedRows: number;
  costHalf: number;
  budgetHalf: number;
  optimalHalf: number;
  overBudget: boolean;
  timingOk: boolean;
  criticalPathPs: number;
  timingBudgetPs: number | null;
  isSequential: boolean;
  /** 0~100：成本越接近理论最优越高 */
  score: number;
  portCheck: {
    /** 关卡要求的输入端口里，玩家电路缺少的 */
    missingInputs: string[];
    missingOutputs: string[];
    /** 玩家多出来的端口（不致命，只提示） */
    extraPorts: string[];
  };
  errors: string[];
  warnings: string[];
}

/** 从向量推导关卡要求的端口集合（向量就是关卡的功能规格） */
export function requiredPorts(level: Level): { inputs: string[]; outputs: string[] } {
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  for (const vector of level.vectors) {
    for (const name of Object.keys(vector.inputs)) inputs.add(name);
    for (const name of Object.keys(vector.expect ?? {})) outputs.add(name);
  }
  return { inputs: [...inputs], outputs: [...outputs] };
}

export function judgeDesign(design: Design, level: Level, options: JudgeOptions): JudgeResult {
  const mode: SimMode = options.mode ?? level.mode;
  const errors: string[] = [];
  const warnings: string[] = [];

  const { net, diagnostics: compileDiagnostics } = compileDesign(design, {
    library: options.library,
  });
  const { counts } = computeCosts(design, options.library);
  const costHalf = costHalfOf(counts);

  for (const diag of compileDiagnostics) {
    if (diag.severity === 'error') errors.push(diag.message);
    else if (diag.severity === 'warning') warnings.push(diag.message);
  }

  // 1) 端口检查：关卡靠端口名识别功能
  const want = requiredPorts(level);
  const have = new Map(design.ports.map((p) => [`${p.name}:${p.dir}`, p]));
  const missingInputs = want.inputs.filter((name) => !have.has(`${name}:in`));
  const missingOutputs = want.outputs.filter((name) => !have.has(`${name}:out`));
  if (missingInputs.length > 0)
    errors.push(`缺少输入端口：${missingInputs.join('、')}（关卡用端口名识别功能）`);
  if (missingOutputs.length > 0) errors.push(`缺少输出端口：${missingOutputs.join('、')}`);
  const requiredNames = new Set([...want.inputs, ...want.outputs]);
  const extraPorts = design.ports.filter((p) => !requiredNames.has(p.name)).map((p) => p.name);

  // 2) 功能断言（端口不全时不硬跑，免得报「找不到输入端口」这种内部错误）
  let rows: JudgeRow[] = [];
  let failedRows = 0;
  if (missingInputs.length === 0 && missingOutputs.length === 0) {
    const run = runVectors(net, level.vectors, { mode, defaultSettlePs: 1_000_000 });
    rows = run.rows.map((row) => ({
      index: row.index,
      inputs: row.inputs,
      expected: row.expected,
      actual: row.actual,
      ok: row.ok,
      mismatches: row.mismatches,
    }));
    failedRows = rows.filter((r) => !r.ok).length;
    if (failedRows > 0) errors.push(`${failedRows} 组输入的功能不符合要求（看真值表对比）`);
    if (run.unstable) errors.push('电路没有稳定下来（组合环/振荡），判定不可信');
  }

  // 3) 成本预算
  const overBudget = costHalf > level.budgetHalf;
  if (overBudget) {
    errors.push(`成本超预算：${costHalf / 2} > ${level.budgetHalf / 2}`);
  }

  // 4) 结构检查：逻辑门关卡不该做成有记忆的电路
  let isSequential = false;
  let criticalPathPs = 0;
  const needTimingAnalysis = level.timingBudgetPs !== undefined || level.kind === 'timing';
  const wantsCombinational = (level.unlock?.kind ?? 'logic') === 'logic';
  if (needTimingAnalysis || wantsCombinational) {
    const analysis = analyzeTiming(net);
    isSequential = analysis.isSequential;
    criticalPathPs = analysis.criticalPathPs;
    if (wantsCombinational && isSequential) {
      errors.push('判定为时序电路（输出依赖历史）：本关要的是纯组合逻辑');
    }
    if (analysis.uncertain) warnings.push('时序分析存在不确定项（X / 振荡），结果仅供参考');
  }
  if (level.timingBudgetPs !== undefined && criticalPathPs > level.timingBudgetPs) {
    warnings.push(
      `关键路径 ${(criticalPathPs / 1000).toFixed(2)}ns 超过硬核要求 ${(level.timingBudgetPs / 1000).toFixed(2)}ns（科普模式仍可通过）`,
    );
  }

  const timingOk =
    !options.hardcore ||
    level.timingBudgetPs === undefined ||
    criticalPathPs <= level.timingBudgetPs;
  if (!timingOk) {
    errors.push(
      `硬核模式时序不达标：${(criticalPathPs / 1000).toFixed(2)}ns > ${((level.timingBudgetPs ?? 0) / 1000).toFixed(2)}ns`,
    );
  }

  const pass = errors.length === 0;
  return {
    pass,
    rows,
    failedRows,
    costHalf,
    budgetHalf: level.budgetHalf,
    optimalHalf: level.optimalHalf,
    overBudget,
    timingOk,
    criticalPathPs,
    timingBudgetPs: level.timingBudgetPs ?? null,
    isSequential,
    score: pass ? scoreOf(level, costHalf) : Math.max(0, scoreOf(level, costHalf)),
    portCheck: { missingInputs, missingOutputs, extraPorts },
    errors,
    warnings,
  };
}
