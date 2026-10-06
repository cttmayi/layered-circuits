/**
 * 关卡判定：玩家的电路能不能过关、能得几分。
 *
 * 唯一硬性通关条件（用户定稿 2025-10）：**功能断言全通过**。
 * 成本、关键路径/时序预算、空翻、建立/保持时间都只影响评分与星级（过预算 → 低分/无星，
 * 仍可交付）——「只要逻辑正确就能过关」，避免成本/延迟卡死玩家（含与非门的门版答案）。
 * 强度契约（TTL/CMOS 推挽输出）、端口、素材约束、组合性等结构/接口检查仍是硬性的。
 *
 * 判定用的仿真与编辑器所见完全一致（同一套 compileDesign + runVectors + analyzeTiming），
 * 所以「面板上看到的现象」就是「判定的依据」，不会出现两套真相。
 */

import type { Design, Level, LevelVector, ModuleLibrary, Unit } from '@lc/schema';
import { costHalfOf, FAMILY_CONTRACTS, type LogicFamily, scoreOf } from '@lc/schema';
import {
  type Logic,
  runVectors,
  S_STRONG,
  type SimMode,
  Simulator,
  transitionsIn,
  type Waveform,
} from '@lc/sim-core';
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
  /** 逻辑族契约；缺省用关卡声明的 family（再缺省 rtl） */
  family?: LogicFamily;
  /** 生效可用元件集（契约感知时由 familySpecOf 算出）；缺省 = level.allowedUnits */
  units?: readonly Unit[];
  /** 生效硬核时序预算（ps）；契约感知时由 familySpecOf 算出；缺省 = level.timingBudgetPs */
  timingBudgetPs?: number;
  /** 生效满分线（半分）；契约感知时由 familySpecOf 算出；缺省 = level.optimalHalf */
  optimalHalf?: number;
  /** 生效预算（半分）；契约感知时由 familySpecOf 算出；缺省 = level.budgetHalf */
  budgetHalf?: number;
  /** 生效已知最省（半分）；契约感知时由 familySpecOf 算出；缺省 = level.bestKnownHalf */
  bestKnownHalf?: number;
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
  /** 关卡给这一行的说明（时序关常有「保持上一次」这种同输入不同输出的行） */
  note?: string;
}

export interface JudgeTiming {
  clockPort: string | null;
  criticalPathPs: number;
  /** 每个输出端口的实测延迟（ps）；null = 没做时序分析 */
  portDelayPs: Record<string, number> | null;
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
  nmos: 'N-MOS',
  pmos: 'P-MOS',
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

/** 端口名 → 位宽（多 bit 端口名与向量键一致） */
export function portWidthsOf(level: Level): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of level.ports) map.set(p.name, p.width);
  return map;
}

/**
 * 把数值向量展开成逐位 lane 键（第三章总线）：
 * 端口位宽 W>1 时，值 n 拆成 a[0]..a[W-1]（小端：第 i 位 = n >> i & 1）。
 * 1 位端口保持原值不变（向后兼容既有关卡）。
 */
/** 展开后的向量：inputs/expect 全部是逐位 lane 值（0/1/X/Z），可直接喂仿真 */
export type ExpandedVector = Omit<LevelVector, 'inputs' | 'expect'> & {
  inputs: Record<string, 0 | 1 | 'X' | 'Z'>;
  expect?: Record<string, 0 | 1 | 'X' | 'Z'>;
};

export function expandVectors(
  vectors: readonly LevelVector[],
  widths: Map<string, number>,
): ExpandedVector[] {
  const expand = (
    rec: Record<string, number | 'X' | 'Z' | 0 | 1 | 2 | 3> | undefined,
  ): Record<string, 0 | 1 | 'X' | 'Z'> | undefined => {
    if (!rec) return undefined;
    const out: Record<string, 0 | 1 | 'X' | 'Z'> = {};
    for (const [name, value] of Object.entries(rec)) {
      const w = widths.get(name);
      if (w && w > 1) {
        const n = typeof value === 'number' ? value : value === 'X' || value === 'Z' ? 0 : value;
        for (let bit = 0; bit < w; bit++) out[`${name}[${bit}]`] = ((n >> bit) & 1) as 0 | 1;
      } else {
        out[name] = value as 0 | 1 | 'X' | 'Z';
      }
    }
    return out;
  };
  return vectors.map((v) => ({ ...v, inputs: expand(v.inputs) ?? {}, expect: expand(v.expect) }));
}

export function judgeDesign(design: Design, level: Level, options: JudgeOptions): JudgeResult {
  const mode: SimMode = options.mode ?? level.mode;
  /**
   * 逻辑版（玩家可在工具栏切换）：**不看任何时间量** ——
   *   · 不实测传播延迟（skipDelay）
   *   · 不评延迟档（结果里 timingBudgetPs 置 null → 评星只按成本，见 apps/studio 的 starsOf）
   *   · 不查毛刺上限（毛刺本身就是延迟差异造成的，逻辑口径下没有这个概念）
   *   · 不查建立/保持（把 hardcore 一并关掉）
   * 时序版（默认）仍是主线的硬核口径，行为一字未改。
   */
  const logicOnly = mode === 'logic';
  const hardcore = (options.hardcore ?? false) && !logicOnly;
  const errors: string[] = [];
  const warnings: string[] = [];
  /** 生效可用元件：契约感知时由 familySpecOf 算出的并集；缺省 = 关卡声明 */
  const allowedUnits: readonly Unit[] = options.units ?? level.allowedUnits;

  const { net, diagnostics: compileDiagnostics } = compileDesign(design, {
    library: options.library,
  });
  /** 生效硬核时序预算：契约感知时可能放宽（各契约速度标准不同） */
  const effectiveTimingBudgetPs: number | undefined =
    options.timingBudgetPs !== undefined ? options.timingBudgetPs : level.timingBudgetPs;
  /** 生效满分线/预算/已知最省：契约感知时由 familySpecOf 算出（各契约自己定自己的标准） */
  const effectiveOptimalHalf = options.optimalHalf ?? level.optimalHalf;
  const effectiveBudgetHalf = options.budgetHalf ?? level.budgetHalf;
  const effectiveBestKnownHalf =
    options.bestKnownHalf ?? level.bestKnownHalf ?? effectiveOptimalHalf;
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

  // 1.0) 位宽检查（第三章总线）：多 bit 端口的宽度必须与关卡声明一致
  const widthOf = portWidthsOf(level);
  let widthBad = false;
  for (const [name, width] of widthOf) {
    const found = design.ports.find((q) => q.name === name);
    if (found && found.width !== width) {
      errors.push(`端口 ${name} 的位宽不对：关卡要 ${width} 位，你接的是 ${found.width} 位`);
      widthBad = true;
    }
  }

  // 1.1) 素材约束（GDD 第 3 节 / 4.4 复古复用关）——约束必须由判定执行，光在 UI 上禁用是拦不住的
  const usedUnits = new Set<string>();
  for (const instance of design.instances) {
    if (instance.kind !== 'unit') continue;
    usedUnits.add(instance.unit);
    if (!allowedUnits.includes(instance.unit)) {
      errors.push(
        `本关不提供【${UNIT_LABELS[instance.unit] ?? instance.unit}】，请只用：${allowedUnits.join('、')}`,
      );
    }
  }
  // 1.1b) 教学关必用元件：防止用「一根导线」钻空子（直连也能满足真值表，但没学会元件）
  if (level.requiredUnits.length > 0) {
    for (const need of level.requiredUnits) {
      if (!usedUnits.has(need)) {
        errors.push(
          `本关要求用到【${UNIT_LABELS[need] ?? need}】——它才是这关要教的主角，别用导线绕过。`,
        );
      }
    }
  }
  // 1.1c) 三极管基极回路限流：把 b、e 看成同一个点（真实电路 b-e 导通时只有约 0.7V，
  //       相当于短路）。这个点上如果出现「VCC 强电源直连基极」+「发射极网直连 GND」，
  //       就是强信号直接怼 b-e 结 → 过流，打回。
  //       输入端口是「弱信号源」（像传感器/按键带上拉、带内阻），直连基极是日常常态，
  //       放行；经电阻的弱驱动 + GND 也合理（限流电阻把强驱动变弱）。
  if (usedUnits.has('npn')) {
    const unitOf = new Map(design.instances.map((i) => [i.id, i]));
    const netOf = (instId: string, pin: string) =>
      design.nets.find((n) => n.pins.some((p) => p.inst === instId && p.pin === pin));
    const hasVccDirect = (net: (typeof design.nets)[number] | undefined) =>
      !!net?.pins.some((p) => {
        const other = unitOf.get(p.inst);
        return other !== undefined && other.kind === 'vcc';
      });
    const hasGndDirect = (net: (typeof design.nets)[number] | undefined) =>
      !!net?.pins.some((p) => {
        const other = unitOf.get(p.inst);
        return other !== undefined && other.kind === 'gnd';
      });
    for (const instance of design.instances) {
      if (instance.kind !== 'unit' || instance.unit !== 'npn') continue;
      const netB = netOf(instance.id, 'b');
      const netE = netOf(instance.id, 'e');
      if (!netB || !netE) continue; // 基极/发射极悬空交给「浮空/缺连接」类检查
      if (hasVccDirect(netB) && hasGndDirect(netE)) {
        errors.push(
          `${instance.label || '三极管'} 的基极直接吃了 VCC 强电源：真实电路 b-e 只有约 0.7V，电源直怼基极会过流——请在基极串一个电阻限流（输入 a 这种弱信号源可以直接接）。`,
        );
      }
    }
  }
  const modulePolicy = checkModulePolicy(design, level, options.library);
  errors.push(...modulePolicy.errors);

  // 2) 功能断言（端口不全时不硬跑，免得报「找不到输入端口」这种内部错误）
  //    一律带 trace：时序关卡要数每个窗口里输出的跳变次数，顺便拿到波形给 UI 用。
  //    第三章总线：数值向量先按位宽展开成 lane 键（a: 5 → a[0..3]），再逐位比对。
  let rows: JudgeRow[] = [];
  let failedRows = 0;
  let waveform: ReturnType<typeof runVectors>['waveform'];
  const outputNodes = net.ports.filter((p) => p.dir === 'out').map((p) => p.node);
  if (missingInputs.length === 0 && missingOutputs.length === 0 && !widthBad) {
    const vectors = expandVectors(level.vectors, widthOf);
    const run = runVectors(net, vectors, {
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
        // 关卡给这一行的说明一起带上：时序关「同一组输入、输出不同」的行（保持上一次）
        // 在判定表里没有说明就会看起来自相矛盾
        note: vectors[row.index]?.note,
      };
    });
    failedRows = rows.filter((r) => !r.ok).length;
    if (failedRows > 0) errors.push(`${failedRows} 组输入的功能不符合要求（看真值表对比）`);
    if (run.unstable) errors.push('电路没有稳定下来（组合环/振荡），判定不可信');

    // 2.1) 逻辑族契约：输出强度硬约束（决策 3 的「关卡严格保证」）。
    //      推挽族（TTL/CMOS）的输出保证 = 高电平强 1（轨到轨）；用弱上拉电阻凑出的
    //      弱 1 在族内自洽但跨族级联会压不过二极管门输入 → 契约打回，并给出可操作的报错。
    const family = options.family ?? level.family;
    const contract = FAMILY_CONTRACTS[family];
    if (contract.output === 'strong') {
      // 强度审计只看直流电平，永远用 logic 模式（timing 模式没有 settle()）
      const sim = new Simulator(net, { mode: 'logic' });
      // 总线（位宽 > 1）按位展开成独立 FlatPort（bit 序号），只查第 0 位即可代表
      const outNodes = new Map<string, number>();
      for (const p of net.ports) {
        if (p.dir === 'out' && p.bit === 0 && !outNodes.has(p.name)) outNodes.set(p.name, p.node);
      }
      if (outNodes.size > 0) {
        for (const vector of vectors) {
          for (const [name, value] of Object.entries(vector.inputs)) sim.setInput(name, value);
          sim.settle();
          for (const [name, node] of outNodes) {
            const expect = vector.expect?.[name];
            if (expect !== 1) continue;
            const strength = sim.signalOf(node) >> 2;
            if (strength < S_STRONG) {
              errors.push(
                `${FAMILY_CONTRACTS[family].name} 契约要求推挽输出：${name} 在输入 ${JSON.stringify(vector.inputs)} 时应为强 1，实际是弱 1（多半靠上拉电阻凑的）。弱 1 压不过二极管门输入，级联会打架——改成互补对（CMOS）或射极跟随器输出级（TTL）。`,
              );
              break;
            }
          }
        }
      }
    }
  }

  // 3) 成本预算：成本挑战关（GDD 4.2）不设上限，只比谁更省 → 不算「超预算」；
  //    成本只影响评分/星级，不判失败——功能正确即可交付（用户定稿 2025-10）。
  const budgetEnforced = level.kind !== 'cost';
  const overBudget = budgetEnforced && costHalf > effectiveBudgetHalf;
  if (overBudget) {
    warnings.push(
      `成本超预算：${costHalf / 2} > ${effectiveBudgetHalf / 2}（功能正确仍可交付，只是评分/星级低）`,
    );
  }

  // 4) 结构与时序检查
  const wantsCombinational = (level.unlock?.kind ?? 'logic') === 'logic';
  const checks = level.checks;
  const needAnalysis =
    wantsCombinational ||
    (level.unlock?.kind ?? 'logic') === 'seq' ||
    effectiveTimingBudgetPs !== undefined ||
    level.kind === 'timing' ||
    checks.clockPort !== undefined ||
    checks.maxGlitches !== undefined;
  let isSequential = false;
  let criticalPathPs = 0;
  /** 每个输出端口的实测延迟（ps）；不做时序分析时为 null（纯成本判定） */
  let portDelayPs: Record<string, number> | null = null;
  if (needAnalysis) {
    // 不评延迟档（无 timingBudgetPs、非 timing 关、无 clock/maxGlitches 约束）时
    // 跳过传播延迟实测（输入数×2 次全仿真），只做「是否时序电路」判定。
    const skipDelay =
      logicOnly ||
      (effectiveTimingBudgetPs === undefined &&
        level.kind !== 'timing' &&
        checks.clockPort === undefined &&
        checks.maxGlitches === undefined);
    const analysis = analyzeTiming(net, { skipDelay });
    isSequential = analysis.isSequential;
    criticalPathPs = analysis.criticalPathPs;
    portDelayPs = analysis.portDelayPs;
    if (wantsCombinational && isSequential) {
      errors.push('判定为时序电路（输出依赖历史）：本关要的是纯组合逻辑');
    }
    // 组合关卡出现 X/振荡是真问题；时序电路上电状态本来就不确定，不当告警
    if (analysis.uncertain && wantsCombinational)
      warnings.push('时序分析存在不确定项（X / 振荡），结果仅供参考');
  }
  // 关键路径超预算 → 只降评分/星级，不判失败（用户定稿：延迟与成本一样是「性能指标」）
  const timingOk =
    effectiveTimingBudgetPs === undefined || criticalPathPs <= effectiveTimingBudgetPs;
  if (!timingOk) {
    warnings.push(
      `关键路径 ${(criticalPathPs / 1000).toFixed(2)}ns 超过硬核要求 ${((effectiveTimingBudgetPs ?? 0) / 1000).toFixed(2)}ns（功能正确仍可交付，只是星级低）`,
    );
  }

  // 4.1) 空翻 / 竞争冒险：数每个向量窗口里输出跳变了几次
  const notes: string[] = [];
  // 第 1 个向量包含上电建立过程，跳变次数天然不止一次，不计入空翻统计
  const glitchRows = rows.filter((r) => r.index > 0 && r.glitches > 1).map((r) => r.index);
  const totalGlitches = rows.reduce((sum, r) => sum + r.glitches, 0);
  if (!logicOnly && checks.maxGlitches !== undefined) {
    const max = checks.maxGlitches;
    const over = rows.filter((r) => r.index > 0 && r.glitches > max);
    if (over.length > 0) {
      const message = `输出在 ${over.length} 个向量里跳变超过 ${max} 次（第 ${over
        .map((r) => r.index + 1)
        .join('、')} 组）：时钟翻转期间输出跟着抖动，就是竞争冒险/空翻`;
      warnings.push(`${message}（只降星级，不影响交付）`);
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
      if (hardcore && measured.setupPs !== null) {
        const needed = criticalPathPs + measured.setupPs;
        if (freq && needed > period) {
          warnings.push(
            `跑不到 ${(freq / 1e6).toFixed(0)}MHz：数据路径 ${(criticalPathPs / 1000).toFixed(2)}ns + 建立时间 ${(measured.setupPs / 1000).toFixed(2)}ns > 时钟周期 ${(period / 1000).toFixed(2)}ns（只降星级，不影响交付）`,
          );
        } else if (freq) {
          notes.push(
            `${(freq / 1e6).toFixed(0)}MHz 下还有余量：需要 ${(needed / 1000).toFixed(2)}ns，周期 ${(period / 1000).toFixed(2)}ns`,
          );
        }
      }
      if (hardcore && measured.setupPs !== null && measured.holdPs !== null) {
        if (checks.setupBudgetPs !== undefined && measured.setupPs > checks.setupBudgetPs) {
          warnings.push(
            `建立时间超标：数据要提前 ${(measured.setupPs / 1000).toFixed(2)}ns 稳定，预算 ${(checks.setupBudgetPs / 1000).toFixed(2)}ns（只降星级，不影响交付）`,
          );
        }
        if (checks.holdBudgetPs !== undefined && measured.holdPs > checks.holdBudgetPs) {
          warnings.push(
            `保持时间超标：时钟沿后数据还要保持 ${(measured.holdPs / 1000).toFixed(2)}ns，预算 ${(checks.holdBudgetPs / 1000).toFixed(2)}ns（只降星级，不影响交付）`,
          );
        }
      }
    }
  }

  const bestKnown = effectiveBestKnownHalf;
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
    budgetHalf: effectiveBudgetHalf,
    optimalHalf: effectiveOptimalHalf,
    overBudget,
    timingOk,
    criticalPathPs,
    timingBudgetPs: logicOnly ? null : (effectiveTimingBudgetPs ?? null),
    isSequential,
    waveform: waveform ?? null,
    timing: {
      clockPort: checks.clockPort ?? null,
      criticalPathPs,
      portDelayPs,
      timingBudgetPs: logicOnly ? null : (effectiveTimingBudgetPs ?? null),
      timingOk,
      setupPs,
      holdPs,
      edgeTriggered,
      setupBudgetPs: logicOnly ? null : (checks.setupBudgetPs ?? null),
      holdBudgetPs: logicOnly ? null : (checks.holdBudgetPs ?? null),
      glitches: totalGlitches,
      maxGlitches: logicOnly ? null : (checks.maxGlitches ?? null),
      glitchRows,
      isSequential,
      notes,
    },
    score: scoreOf(
      { ...level, optimalHalf: effectiveOptimalHalf, budgetHalf: effectiveBudgetHalf },
      costHalf,
    ),
    portCheck: { missingInputs, missingOutputs, extraPorts },
    errors,
    warnings,
  };
}
