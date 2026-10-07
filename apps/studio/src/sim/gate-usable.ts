/**
 * 逻辑关（`level.judgeMode === 'logic'`，第 8 关起）里「我的模块」能不能列出来。
 *
 * ## 判据：把**门级判定自己叫起来跑一遍**，不是维护名单
 *
 * 用一个只摆这一个模块的探针设计，走判定在逻辑关用的那条门级入口
 * `runGateVectors()`（@lc/compiler，就是 `sim/handle.ts` 里 `gateSeqSpecs` 那条路）：
 * **它返回 null，就说明门级判定跑不了这个模块 → 不列**。
 *
 * 为什么不直接用 `gateFastSupportReason()`：它的门槛只看**顶层**（函数自己的注释就写着
 * "顶层出现元件（unit）"），而"模块**身体里**含元件"是门级引擎**递归展开**时才如实拒绝的
 * —— `packages/sim-core/src/gate-netlist.ts` 里那条注释记着实测事故：s3-calc 的显示链路
 * 就是这样被静默算错的。只查顶层会漏掉本功能要挡的那一批（第 1~7 关用元件搭的非门/与门…），
 * 所以这里用判定实际走的入口 `runGateVectors`：它 = `gateFastSupportReason`（顶层门槛）
 * + `settleGateSteps`（引擎递归门槛），两头都覆盖。
 *
 * 好处是**将来不用回来改**：新增模块、新增关卡、引擎放宽/收紧（例如以后认识"身体里含元件的
 * 模块"了），这个列表自动跟着变，和 `apps/studio/test/gate-fast-audit.test.ts` 的"实跑"口径同源。
 *
 * ## 不会被误伤的
 *
 * - **基础门 / 功能原子**（与门、或门、全加器…）：引擎按原子算 → 可用；
 * - **全由基础门搭的复合模块**：递归下去只有 module → 可用；
 * - **时序模块只要有 SeqSpec**（D锁存器 / 主从D触发器，见 @lc/content 的 `GATE_SEQ_SPECS`）
 *   → 门级时序引擎接得住 → 可用。**只有"门级确实算不了"的才返回 null**：
 *   顶层含元件、身体里含元件、缺 SeqSpec、库里查不到模块、身体里没有内部电路。
 * - 自由模式 / 时序关**根本不问这个问题**（调用方只在逻辑关过滤），行为逐字不变。
 */
import { runGateVectors } from '@lc/compiler';
import { GATE_SEQ_SPECS } from '@lc/content';
import { DesignSchema, InMemoryModuleLibrary, type ModuleTemplate } from '@lc/schema';
import type { StoredModule } from '../editor/model';

/**
 * 结论缓存：键 = 模块 hash。模板 hash 是**内容寻址**的（Merkle），同 hash 必然同结论，
 * 所以这张缓存不会因为画布改动而失效，也不会串味（换关卡/换库都不影响）。
 */
const verdicts = new Map<string, boolean>();

/** 把画布库（StoredModule[]）包成门级入口要的 ModuleLibrary（与 sim/handle.ts 建库口径一致） */
export const gateProbeLibrary = (library: readonly StoredModule[]): InMemoryModuleLibrary =>
  new InMemoryModuleLibrary(
    library
      .map((m) => m.template as ModuleTemplate | null | undefined)
      .filter((t): t is ModuleTemplate => Boolean(t && typeof t.hash === 'string')),
  );

/**
 * 这个模块在门级判定里能用吗？
 *
 * 做法是"问判定本人"：探针设计 = 世界上只有这一个模块实例的设计（没有端口、没有连线，
 * 输入全悬空 Z）—— 门级门槛在**展开模块**时就会拒绝，与输入值无关，所以探针不需要激励。
 * 抛出异常也按"用不了"处理（宁可不列，不能列出算不了的东西）。
 */
export function gateLevelUsable(mod: StoredModule, library: InMemoryModuleLibrary): boolean {
  const cached = verdicts.get(mod.hash);
  if (cached !== undefined) return cached;
  let usable = false;
  try {
    const probe = DesignSchema.parse({
      id: '__gate-probe__',
      name: '门级可用性探针',
      instances: [{ kind: 'module', id: '__probe__', module: mod.hash }],
    });
    const widths = new Map<string, number>();
    usable = runGateVectors(probe, library, [{ inputs: {} }], widths, GATE_SEQ_SPECS) !== null;
  } catch {
    usable = false;
  }
  verdicts.set(mod.hash, usable);
  return usable;
}
