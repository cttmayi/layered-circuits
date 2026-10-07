/**
 * 逻辑版门级快路：把关卡的测试向量跑在**门级引擎**上（7 个基础门当原子、不看强弱），
 * 产出与 runVectors 同形的结果，供 judgeDesign 直接使用。
 *
 * **口径（用户第 ⑲ 轮拍板走 A 路线）**：门级引擎已经**不是零延迟**，而是
 * **有界延迟 + 惯性语义**的事件驱动模型（`@lc/sim-core` 的 `gate-delay.ts`）：
 *   - 每个门/原子/时序器件按 `GATE_DELAY_PS` 的**实测传播延迟**（ps）排事件；
 *   - 惯性语义（短于延迟的毛刺被吃掉）——这是与元件引擎逐行一致的必要条件；
 *   - 每个向量推一个时间窗（`vector.settlePs`，缺省 1µs），撞事件上限即 capped/unstable。
 * 为什么必须带延迟：零延迟把"建立时间"抹掉了（如 s3-calc 靠 10 级反相器链把时钟沿推后
 * 15ns 让累加器数据先稳定），会把 29/67 行读成旧值；带延迟后与元件级逐行一致。
 *
 * 安全第一：**任何不满足条件的情况一律返回 null**，judge 静默回落到原来的元件级引擎。
 * 返回 null 的情形：
 *   - 顶层出现元件（unit）—— 门级快路只处理纯模块设计；
 *   - 某个模块在库里查不到；
 *   - 时序模块没被声明 SeqSpec（不知道哪个端口是时钟/数据）—— 宁可不快，不能算错。
 *
 * 注意：SeqSpec 表由**调用方传入**（apps/studio 里同时引 @lc/content 与 @lc/compiler），
 * 这样 packages/compiler 不必依赖 @lc/content（后者已经依赖前者，反向引会成环）。
 */
import type { Design, ModuleLibrary } from '@lc/schema';
import {
  evalGateVectorsDelayed,
  type GateSeqSpec,
  needsSeqSpec,
  type TestVector,
  type VectorRow,
} from '@lc/sim-core';

export interface GateFastResult {
  pass: boolean;
  /** 门级仍然不产出波形（时间轴是"有延迟"的，但波形面板用元件级波形）*/
  waveform?: undefined;
  rows: VectorRow[];
  diagnostics: never[];
  unstable: boolean;
}

/**
 * **门级引擎口径开关**（用户第 ⑲ 轮要求"保留可回退"）。
 *
 *   true  = 有界延迟 + 惯性（新口径，默认；`gate-delay.ts` 的事件驱动模型）
 *   false = 旧的零延迟求值（`settleGateSteps`，逐网逐行与历史结果完全相同）
 *
 * 切到 false 时判定回落到"零延迟门级"，仅用于对照与回归（`apps/studio/test/gate-delay-levels.test.ts`
 * 会把两档逐关比一遍，`packages/sim-core/test/gate-delay.test.ts` 会证明两档在零延迟下等价）。
 */
export const GATE_DELAYED_ENGINE = true;

/**
 * 门级快路**能不能跑这份设计**：能跑返回 null，不能跑返回**人类可读的原因**。
 *
 * 抽出来是为了让"哪些关吃不到快路、为什么"可被自动审计
 * （见 apps/studio/test/gate-fast-audit.test.ts），而不是靠人记。
 */
export const gateFastSupportReason = (
  design: Design,
  library: ModuleLibrary,
  seqSpecs: Readonly<Record<string, GateSeqSpec>>,
): string | null => {
  for (const inst of design.instances) {
    if (inst.kind === 'unit') return `顶层含元件 ${inst.id}（门级只处理纯模块设计）`;
    if (inst.kind !== 'module') continue;
    const mod = library.get(inst.module);
    if (!mod) return `库里找不到模块 ${inst.module}（实例 ${inst.id}）`;
    if (needsSeqSpec(mod as never) && !seqSpecs[mod.name])
      return `时序模块「${mod.name}」没有 SeqSpec（不知道该拿哪个脚当时钟）`;
  }
  return null;
};

/**
 * 跑门级快路。不适用时返回 null（调用方回落），绝不做"部分正确"的近似。
 *
 * 引擎口径由 `GATE_DELAYED_ENGINE` 决定（默认有界延迟 + 惯性），两档共用
 * `evalGateVectorsDelayed`（输入保持口径、行形状、null 约定都与本文件历史实现一致）。
 */
export const runGateVectors = (
  design: Design,
  library: ModuleLibrary,
  vectors: readonly TestVector[],
  widths: ReadonlyMap<string, number>,
  seqSpecs: Readonly<Record<string, GateSeqSpec>>,
): GateFastResult | null => {
  // ── 适用性：全部实例都得是能解析的模块，且时序模块都有 SeqSpec ──
  if (gateFastSupportReason(design, library, seqSpecs) !== null) return null;

  const run = evalGateVectorsDelayed(design, library, vectors, widths, seqSpecs, {
    zeroDelay: !GATE_DELAYED_ENGINE,
  });
  if (run === null) return null; // 引擎说不支持就回落，不硬凑

  return { pass: run.pass, rows: run.rows, diagnostics: [], unstable: run.unstable };
};
