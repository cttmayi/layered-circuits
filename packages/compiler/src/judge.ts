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
import { type Logic, runVectors, type SimMode, transitionsIn, type Waveform } from '@lc/sim-core';
import { computeCosts } from './cost.js';
import { compileDesign } from './flatten.js';
import { measureSetupHold } from './setup-hold.js';
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
  /** 本窗口内输出端口的跳变次数（> 1 通常意味着毛刺/空翻） */
  glitches: number;
  /** 本行采样的时间窗口（ps） */
  window: { fromPs: number; toPs: number };
}

export interface JudgeTiming {
  clockPort: string | null;
  criticalPathPs: number;
  timingBudgetPs: number | null;
  timingOk: boolean;
  /** 实测建立/保持时间（ps）；null = 电路不是边沿触发或无法测量 */
  setupPs: number | null;
  holdPs: number | null;
  edgeTriggered: boolean | null;
  setupBudgetPs: number | null;
  holdBudgetPs: number | null;
  /** 输出端口跳变次数合计与允许上限 */
  glitches: number;
  maxGlitches: number | null;
  /** 跳变超标的向量下标 */
  glitchRows: number[];
  isSequential: boolean;
  notes: string[];
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
  /** 波形（只含端口网络）：UI 直接画阶梯图，判定用的就是它 */
  waveform: Waveform | null;
  timing: JudgeTiming;
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

const UNIT_LABELS: Record<string, string> = {
  npn: '三极管',
  res: '电阻',
  dio: '二极管',
  cap: '电容',
};

/**
 * 模块使用策略：none = 只能用底层元件；listed = 仅白名单；all = 全部。
 * `bannedModules` 用于复古复用关（GDD 4.4：只许用早期版本的模块）。
 */
function checkModulePolicy(
  design: Design,
  level: Level,
  library: ModuleLibrary,
): { errors: string[] } {
  const errors: string[] = [];
  const used = design.instances.filter((i) => i.kind === 'module');
  if (used.length === 0) return { errors };
  const nameOf = (hash: string): string => library.get(hash)?.name ?? hash.slice(0, 8);
  if (level.moduleAccess === 'none') {
    errors.push('本关只能用底层元件手搭，不能用组件库模块');
    return { errors };
  }
  for (const instance of used) {
    if (instance.kind !== 'module') continue;
    const template = library.get(instance.module);
    const name = nameOf(instance.module);
    if (level.moduleAccess === 'listed' && level.allowedModules.length > 0) {
      if (!level.allowedModules.includes(name)) {
        errors.push(`本关只允许使用【${level.allowedModules.join('、')}】，不能用【${name}】`);
      }
    }
    if (level.bannedModules.includes(name) || level.bannedModules.includes(instance.module)) {
      errors.push(`复古复用关禁用【${name}】（只许用早期版本的模块）`);
    }
    if (level.kind === 'retro' && template && template.version !== '1.0') {
      errors.push(`复古复用关只许用 1.0 版模块，【${name}】是 v${template.version}`);
    }
  }
  return { errors };
}

/** 时序关卡的默认采样等待：跟着时钟周期走，至少 100ns */
function defaultSettle(level: Level): number {
  return Math.max(100_000, clockPeriodPsOf(level) * 2);
}

/** 时钟周期（ps）：优先由 clock.freqHz 推算，否则按 1MHz 兜底（给分立电路足够时间） */
export function clockPeriodPsOf(level: Level): number {
  const freq = level.clock?.freqHz;
  if (freq && freq > 0) return Math.round(1e12 / freq);
  return 1_000_000;
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

  // 1.1) 素材约束（GDD 第 3 节 / 4.4 复古复用关）——约束必须由判定执行，光在 UI 上禁用是拦不住的
  for (const instance of design.instances) {
    if (instance.kind !== 'unit') continue;
    if (!level.allowedUnits.includes(instance.unit)) {
      errors.push(
        `本关不提供【${UNIT_LABELS[instance.unit] ?? instance.unit}】，请只用：${level.allowedUnits.join('、')}`,
      );
    }
  }
  const modulePolicy = checkModulePolicy(design, level, options.library);
  errors.push(...modulePolicy.errors);

  // 2) 功能断言（端口不全时不硬跑，免得报「找不到输入端口」这种内部错误）
  //    一律带 trace：时序关卡要数每个窗口里输出的跳变次数，顺便拿到波形给 UI 用。
  let rows: JudgeRow[] = [];
  let failedRows = 0;
  let waveform: ReturnType<typeof runVectors>['waveform'];
  const outputNodes = net.ports.filter((p) => p.dir === 'out').map((p) => p.node);
  if (missingInputs.length === 0 && missingOutputs.length === 0) {
    const run = runVectors(net, level.vectors, {
      mode,
      defaultSettlePs: defaultSettle(level),
      trace: true,
      tracePortsOnly: true,
    });
    waveform = run.waveform;
    rows = run.rows.map((row) => {
      // 跳变次数按「单个输出端口」计数：q 与 qn 各跳一次不算毛刺
      let glitches = 0;
      if (waveform && mode === 'timing') {
        for (const node of outputNodes) {
          glitches = Math.max(
            glitches,
            transitionsIn(waveform, node, row.window.fromPs, row.window.toPs),
          );
        }
      }
      return {
        index: row.index,
        inputs: row.inputs,
        expected: row.expected,
        actual: row.actual,
        ok: row.ok,
        mismatches: row.mismatches,
        glitches,
        window: row.window,
      };
    });
    failedRows = rows.filter((r) => !r.ok).length;
    if (failedRows > 0) errors.push(`${failedRows} 组输入的功能不符合要求（看真值表对比）`);
    if (run.unstable) errors.push('电路没有稳定下来（组合环/振荡），判定不可信');
  }

  // 3) 成本预算：成本挑战关（GDD 4.2）不设上限，只比谁更省 → 不算「超预算」
  const budgetEnforced = level.kind !== 'cost';
  const overBudget = budgetEnforced && costHalf > level.budgetHalf;
  if (overBudget) {
    errors.push(`成本超预算：${costHalf / 2} > ${level.budgetHalf / 2}`);
  }

  // 4) 结构与时序检查
  const wantsCombinational = (level.unlock?.kind ?? 'logic') === 'logic';
  const checks = level.checks;
  const needAnalysis =
    wantsCombinational ||
    (level.unlock?.kind ?? 'logic') === 'seq' ||
    level.timingBudgetPs !== undefined ||
    level.kind === 'timing' ||
    checks.clockPort !== undefined ||
    checks.maxGlitches !== undefined;
  let isSequential = false;
  let criticalPathPs = 0;
  if (needAnalysis) {
    const analysis = analyzeTiming(net);
    isSequential = analysis.isSequential;
    criticalPathPs = analysis.criticalPathPs;
    if (wantsCombinational && isSequential) {
      errors.push('判定为时序电路（输出依赖历史）：本关要的是纯组合逻辑');
    }
    // 组合关卡出现 X/振荡是真问题；时序电路上电状态本来就不确定，不当告警
    if (analysis.uncertain && wantsCombinational)
      warnings.push('时序分析存在不确定项（X / 振荡），结果仅供参考');
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

  // 4.1) 空翻 / 竞争冒险：数每个向量窗口里输出跳变了几次
  const notes: string[] = [];
  // 第 1 个向量包含上电建立过程，跳变次数天然不止一次，不计入空翻统计
  const glitchRows = rows.filter((r) => r.index > 0 && r.glitches > 1).map((r) => r.index);
  const totalGlitches = rows.reduce((sum, r) => sum + r.glitches, 0);
  if (checks.maxGlitches !== undefined) {
    const max = checks.maxGlitches;
    const over = rows.filter((r) => r.index > 0 && r.glitches > max);
    if (over.length > 0) {
      const message = `输出在 ${over.length} 个向量里跳变超过 ${max} 次（第 ${over
        .map((r) => r.index + 1)
        .join('、')} 组）：时钟翻转期间输出跟着抖动，就是竞争冒险/空翻`;
      if (mode === 'timing') errors.push(message);
      else warnings.push(`${message}（科普模式忽略延迟，切硬核模式才判定）`);
    } else if (mode === 'timing') {
      notes.push('所有向量的输出跳变都不超过预算，没有空翻');
    }
  }

  // 4.2) 建立/保持时间：拿真仿真扫出来（硬核模式才判是否达标）
  let setupPs: number | null = null;
  let holdPs: number | null = null;
  let edgeTriggered: boolean | null = null;
  if (checks.clockPort && checks.dataPort && mode === 'timing') {
    const outputName = requiredPorts(level).outputs[0];
    if (outputName) {
      const period = clockPeriodPsOf(level);
      const measured = measureSetupHold(net, {
        clock: checks.clockPort,
        data: checks.dataPort,
        output: outputName,
        clockPeriodPs: period,
        // 采样点：时钟沿之后 2 倍数据路径时间（最短 20ns），且不晚于一个时钟周期 ——
        // 「输出必须在本周期内稳定」才是建立时间的物理含义
        capturePs: Math.min(period, Math.max(criticalPathPs * 2, 20_000)),
      });
      setupPs = measured.setupPs;
      holdPs = measured.holdPs;
      edgeTriggered = measured.edgeTriggered;
      for (const note of measured.notes) notes.push(note);
      const freq = level.clock?.freqHz;
      if (options.hardcore && measured.setupPs !== null) {
        const needed = criticalPathPs + measured.setupPs;
        if (freq && needed > period) {
          errors.push(
            `跑不到 ${(freq / 1e6).toFixed(0)}MHz：数据路径 ${(criticalPathPs / 1000).toFixed(2)}ns + 建立时间 ${(measured.setupPs / 1000).toFixed(2)}ns > 时钟周期 ${(period / 1000).toFixed(2)}ns`,
          );
        } else if (freq) {
          notes.push(
            `${(freq / 1e6).toFixed(0)}MHz 下还有余量：需要 ${(needed / 1000).toFixed(2)}ns，周期 ${(period / 1000).toFixed(2)}ns`,
          );
        }
      }
      if (options.hardcore && measured.setupPs !== null && measured.holdPs !== null) {
        if (checks.setupBudgetPs !== undefined && measured.setupPs > checks.setupBudgetPs) {
          errors.push(
            `建立时间超标：数据要提前 ${(measured.setupPs / 1000).toFixed(2)}ns 稳定，预算 ${(checks.setupBudgetPs / 1000).toFixed(2)}ns`,
          );
        }
        if (checks.holdBudgetPs !== undefined && measured.holdPs > checks.holdBudgetPs) {
          errors.push(
            `保持时间超标：时钟沿后数据还要保持 ${(measured.holdPs / 1000).toFixed(2)}ns，预算 ${(checks.holdBudgetPs / 1000).toFixed(2)}ns`,
          );
        }
      }
    }
  }

  const bestKnown = level.bestKnownHalf ?? level.optimalHalf;
  if (level.kind === 'cost' && costHalf > bestKnown) {
    warnings.push(
      `成本挑战关：还能更省 —— 目前 ${costHalf / 2}，已知最省 ${bestKnown / 2}（成绩会记进重挑战榜）`,
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
    waveform: waveform ?? null,
    timing: {
      clockPort: checks.clockPort ?? null,
      criticalPathPs,
      timingBudgetPs: level.timingBudgetPs ?? null,
      timingOk,
      setupPs,
      holdPs,
      edgeTriggered,
      setupBudgetPs: checks.setupBudgetPs ?? null,
      holdBudgetPs: checks.holdBudgetPs ?? null,
      glitches: totalGlitches,
      maxGlitches: checks.maxGlitches ?? null,
      glitchRows,
      isSequential,
      notes,
    },
    score: pass ? scoreOf(level, costHalf) : Math.max(0, scoreOf(level, costHalf)),
    portCheck: { missingInputs, missingOutputs, extraPorts },
    errors,
    warnings,
  };
}
