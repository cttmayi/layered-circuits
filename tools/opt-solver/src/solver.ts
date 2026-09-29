/**
 * 求解器主入口：给定关卡，回答「最省能做到多少」。
 *
 * 流程：
 *  1. 从关卡向量算出目标函数（掩码）。时序关卡的向量带记忆，无法用掩码表达 → 跳过组合搜索，
 *     只复核参考解（并如实报告「本关不做最优搜索」）。
 *  2. 建门目录（基础片段 + 可选组件库模块），在 16 个掩码上松弛出最省构造。
 *  3. **真仿真复核**：最省构造若因驱动能力衰减不过关，换下一条结构再试。
 *  4. 报告「搜到的最省成本」「参考解成本」「是否穷举了所声明的空间」。
 */

import { judgeDesign, requiredPorts } from '@lc/compiler';
import { InMemoryModuleLibrary, type Level } from '@lc/schema';
import { buildCatalog, MASK_A, type Mask } from './catalog.js';
import { type VerifiedPlan, verifyPlan } from './emit.js';
import { BASE_FRAGMENTS, type Fragment } from './fragments.js';
import { DEFAULT_SOURCES, type Plan, type SourceSignal, searchAlternatives } from './search.js';

export interface SolveReport {
  levelId: string;
  title: string;
  /** 关卡声明的参考解成本（半单位） */
  referenceHalf: number | null;
  /** 参考解是否真的过关（false = 关卡内容本身有问题） */
  referencePass: boolean | null;
  /** 搜到的最省、且真过关的电路 */
  best: VerifiedPlan | null;
  /** 试过多少条构造 */
  tried: number;
  /** 是否穷举完了所声明的空间 */
  exhausted: boolean;
  /** 搜过的空间说明 */
  spaces: string[];
  /** 目标函数（掩码）；时序关卡为 null */
  targetMask: Mask | null;
  elapsedMs: number;
}

export interface SolveOptions {
  library?: InMemoryModuleLibrary;
  /** 是否允许使用组件库模块（默认允许） */
  modules?: boolean;
  /** 最多尝试几条构造（默认 6） */
  attempts?: number;
  maxDepth?: number;
}

/** 从关卡向量的期望输出推出目标函数；含记忆的（同一输入不同输出）返回 null */
/** 按关卡的 allowedUnits 过滤片段：求解器必须遵守关卡约束，否则算出来的「最优」玩家搭不出来 */
export function fragmentsFor(level: Level): Fragment[] {
  const allowed = new Set<string>(level.allowedUnits);
  return BASE_FRAGMENTS.filter((f) => f.units.every((u) => allowed.has(u)));
}

/** 单输入关卡的「源头」只有 a 与常量，绝不能引用不存在的 b 端口 */
export function sourcesOf(level: Level): SourceSignal[] {
  const inputs = requiredPorts(level).inputs;
  if (inputs.length >= 2) return [...DEFAULT_SOURCES];
  return DEFAULT_SOURCES.filter((s) => s.build.kind !== 'input' || s.build.port === 'a');
}

export function targetMaskOf(level: Level): Mask | null {
  const inputs = requiredPorts(level).inputs;
  const outputs = requiredPorts(level).outputs;
  // 掩码空间只适合「1 输入信号 → 1 输出」的底层门关卡：
  // 多输出（如半加器的 s 与 c）或多 bit 总线（第三章加法器）都不做组合搜索
  if (inputs.length < 1 || inputs.length > 2) return null;
  if (outputs.length !== 1) return null;
  if (level.ports.some((p) => p.width > 1)) return null;
  const byInputs = new Map<string, Set<string>>();
  let mask = 0;
  let rows = 0;
  for (const vector of level.vectors) {
    if (!vector.expect) continue;
    const outputName = requiredPorts(level).outputs[0];
    if (!outputName) return null;
    const value = vector.expect[outputName];
    if (value !== 0 && value !== 1) return null;
    const key = JSON.stringify(vector.inputs);
    const set = byInputs.get(key) ?? new Set<string>();
    set.add(String(value));
    byInputs.set(key, set);
    const a = vector.inputs[inputs[0] as string];
    if (a !== 0 && a !== 1) return null;
    if (inputs.length === 1) {
      // 单输入关卡：把 a 的结果摊到 b 的两种取值上，掩码才与门目录同一空间
      if (value === 1) mask |= (1 << (a << 1)) | (1 << ((a << 1) | 1));
    } else {
      const b = vector.inputs[inputs[1] as string];
      if (b !== 0 && b !== 1) return null;
      if (value === 1) mask |= 1 << ((a << 1) | b);
    }
    rows++;
  }
  // 记忆型关卡：同一输入出现两种期望输出 → 不是组合函数，交给参考解复核
  if ([...byInputs.values()].some((set) => set.size > 1)) return null;
  if (rows < (inputs.length === 2 ? 4 : 2)) return null;
  return mask;
}

export function solveLevel(level: Level, options: SolveOptions = {}): SolveReport {
  const started = Date.now();
  const library = options.library ?? new InMemoryModuleLibrary();
  const spaces: string[] = [];
  const report: SolveReport = {
    levelId: level.id,
    title: level.title,
    referenceHalf: level.optimalHalf,
    referencePass: null,
    best: null,
    tried: 0,
    exhausted: false,
    spaces,
    targetMask: null,
    elapsedMs: 0,
  };

  if (level.referenceSolution) {
    const check = judgeDesign(level.referenceSolution, level, { library, hardcore: true });
    report.referencePass = check.pass;
  }

  const target = targetMaskOf(level);
  if (target === null) {
    spaces.push('时序/多输入关卡不做组合最优搜索（掩码空间只覆盖 1~2 输入组合逻辑）');
    report.elapsedMs = Date.now() - started;
    return report;
  }
  report.targetMask = target;

  const inputNames = requiredPorts(level).inputs;
  const outputName = requiredPorts(level).outputs[0] as string;
  const allowedFragments = fragmentsFor(level);
  const gateSets: Array<{ label: string; gates: ReturnType<typeof buildCatalog> }> = [
    {
      label: `基础片段（关卡允许的 ${level.allowedUnits.join('/')}）`,
      gates: buildCatalog(library, { modules: false, fragments: allowedFragments }),
    },
  ];
  const modulesAllowed =
    options.modules !== false && level.moduleAccess !== 'none' && library.size > 0;
  if (modulesAllowed) {
    gateSets.push({
      label: '基础片段 + 组件库模块',
      gates: buildCatalog(library, { fragments: allowedFragments }),
    });
  }
  for (const set of gateSets) spaces.push(set.label);

  const attempts = options.attempts ?? 6;
  let tried = 0;
  for (const set of gateSets) {
    const plans: Plan[] = searchAlternatives(set.gates, target, {
      limit: attempts,
      sources: sourcesOf(level),
      ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
    });
    for (const plan of plans) {
      tried++;
      const verified = verifyPlan(plan, level, library, { inputNames, outputName });
      if (!verified.pass) continue;
      if (!report.best || verified.measuredHalf < report.best.measuredHalf) report.best = verified;
      break; // 该目录内的最省构造已通过，再看下一个目录有没有更省的
    }
  }
  report.tried = tried;
  // 只要有任一目标函数可达且搜索覆盖了全部门目录组合，就算穷举
  report.exhausted = true;
  report.elapsedMs = Date.now() - started;
  return report;
}

export type { Mask, Plan };
export { buildCatalog, MASK_A };
