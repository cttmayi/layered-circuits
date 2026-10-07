/**
 * 逻辑关（`level.judgeMode === 'logic'`，第 8 关起）里「我的模块」能不能列出来。
 *
 * ## 判据：把**门级判定自己叫起来跑一遍**，不是维护名单
 *
 * 用一个只摆这一个模块的探针设计，走判定在逻辑关用的那条门级入口
 * `runGateVectors()`（@lc/compiler，就是 `sim/handle.ts` 里 `gateSeqSpecs` 那条路）。返回 null
 * 就说明"门级口径下这个模块不成立" → 不列。
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
 * ## ⚠️ 名字不能当判据（用户实测 bug：上一关的「D 锁存器」被藏掉）
 *
 * 门级引擎认时序积木靠 `GATE_SEQ_SPECS`，而那张表**按模块名查**；玩家的模块名是自己起的
 * （手动封装时 `window.prompt` 的默认值就是「我的模块」，老版本还可能用关卡标题「D 锁存器」
 * 命名 —— 中间带空格）。名字对不上表，同一个电路就会得到完全相反的门级结论。实测（同一具身体、
 * 只改名字；这组数字由 `test/palette-logic-modules.test.tsx` 固化）：
 *
 * | 模块名 | 名字在 GATE_SEQ_SPECS 里 | runGateVectors |
 * | --- | --- | --- |
 * | `D锁存器`（关卡 unlock.name，自动封装） | 是 | 非 null（跑得动） |
 * | `D 锁存器`（带空格）/ `我的模块` / `D锁存器2` | **否** | **null（被误判成跑不动 → 藏掉）** |
 *
 * 而**判定本身**在这种情况下是正常工作的：`packages/compiler/src/judge.ts` 那条门级快路写着
 * "不适用（有元件 / 缺 SeqSpec / 库查不到）就返回 null，**静默回落到原引擎**" —— `null` ≠
 * "判定跑不了"，只是"门级快路不适用"。所以不能拿 `null` 去否认一个**形状就是本关要用的时序积木**
 * 的模块，否则就会把玩家上一关的成果（甚至和本关参考解同款的积木）藏掉：这就是用户报的 bug。
 *
 * 修法（最终口径见下面 `gateLevelUsable` 的文档）：**名字不参与判据**，改成
 * ① **端口形状**就是已声明的时序积木（`d/en/q`、`clk/d/q`…）→ 必列；
 * ② 其余（组合模块）才问门级探针。
 * 于是玩家给自己的 D 锁存器起什么名字都不影响它出现在「我的模块」里，而第 1~7 关那种含元件的
 * **组合**老模块（形状对不上任何声明、门级探针也跑不动）依旧隐藏。
 */
import { runGateVectors } from '@lc/compiler';
import { GATE_SEQ_SPECS } from '@lc/content';
import { DesignSchema, InMemoryModuleLibrary, type ModuleTemplate } from '@lc/schema';
import type { GateSeqSpec } from '@lc/sim-core';
import type { StoredModule } from '../editor/model';

/** 把画布库（StoredModule[]）包成门级入口要的 ModuleLibrary（与 sim/handle.ts 建库口径一致） */
export const gateProbeLibrary = (library: readonly StoredModule[]): InMemoryModuleLibrary =>
  new InMemoryModuleLibrary(
    library
      .map((m) => m.template as ModuleTemplate | null | undefined)
      .filter((t): t is ModuleTemplate => Boolean(t && typeof t.hash === 'string')),
  );

/**
 * 按**端口形状**从既有声明里认领一份 SeqSpec —— 不看名字，也不看 `isSequential`
 * （实测该标记不可靠：同样是元件版反相器，教学积木的身体包出来是 true、手搭的是 false）。
 *
 * 门槛：
 *   ① 声明的时钟端口（`en` / `clk`）必须在模块的输入端口里；
 *   ② 声明的数据端口（`d`）必须在输入端口里；
 *   ③ 声明的**正相**输出必须都在输出端口里 —— `!` 前缀的反相输出（`qn`）**可有可无**：
 *      第 10 关参考解那样的电路只有 `d/en/q`，同样要认出来（否则玩家的成果又会被藏）。
 */
export function specByShape(mod: StoredModule): GateSeqSpec | undefined {
  const ins = new Set(mod.ports.filter((p) => p.dir === 'in').map((p) => p.name));
  const outs = new Set(mod.ports.filter((p) => p.dir === 'out').map((p) => p.name));
  for (const spec of Object.values(GATE_SEQ_SPECS)) {
    if (!ins.has(spec.clock)) continue;
    if (!spec.data.every((d) => ins.has(d))) continue;
    const positives = Object.entries(spec.map ?? {})
      .flatMap(([, to]) => (Array.isArray(to) ? to : [to]))
      .filter((n) => !n.startsWith('!'));
    if (positives.length > 0 && !positives.every((n) => outs.has(n))) continue;
    return spec;
  }
  return undefined;
}

/**
 * 这个模块在逻辑关里列得出来吗？
 *
 * ## 口径（用户第 ⑬ 轮裁定："以判定真的跑得动为准，不能把玩家上一关的成果藏掉"）
 *
 * 1. **时序模块（`isSequential`）一律列** —— 判定一定接得住它：门级有声明（`GATE_SEQ_SPECS`）
 *    就按声明当原子块算，没有声明就**静默回落到元件引擎**（`judge.ts`：`fast ?? runVectors(...)`），
 *    结果照样正确。实测：把第 10 关的参考解（元件版锁存电路）封装成模块，`isSequential` 为真，
 *    判定跑得动 —— 这种"玩家上一关的成果"绝不能被藏。
 * 2. **组合模块**照旧问门级判定本人：拿探针设计（世界上只有这一个模块实例、没有端口没有连线，
 *    输入全悬空 Z —— 门级门槛在**展开模块**时就会拒绝，与输入值无关，所以不需要激励）走
 *    `runGateVectors()`；返回 null 就不列。这样第 1~7 关用元件搭的非门/与门这些**组合**老模块
 *    （用户明确要求保留隐藏）依旧不出现，全由基础门搭的复合模块依旧在。
 * 3. 自由模式 / 时序关**根本不问这个问题**（调用方只在逻辑关过滤），行为逐字不变。
 *
 * ## ⚠️ 为什么不拿名字当判据（用户实测 bug：上一关的「D 锁存器」被藏掉）
 *
 * 曾经的写法是"`runGateVectors` 返回 null 就隐藏"，而门级引擎**按模块名**查 `GATE_SEQ_SPECS`：
 * 玩家的模块名是自己起的（手动封装时 `window.prompt` 的默认值就是「我的模块」，老版本还会用
 * 关卡标题「D 锁存器」命名 —— 中间带空格）。名字对不上表，同一个电路就得到完全相反的门级结论。
 * 实测（同一具身体、只改名字，对照表由 test/palette-logic-modules.test.tsx 与
 * test/palette-module-visibility-audit.test.ts 固化）：
 *
 * | 模块名 | 名字在声明表里 | runGateVectors | 旧口径 | 现在 |
 * | --- | --- | --- | --- | --- |
 * | `D锁存器`（= 关卡 unlock.name，自动封装） | 是 | 非 null | 列 | 列 |
 * | `D 锁存器`（带空格）/ `我的模块` / `D锁存器2` | **否** | **null** | **误藏（bug）** | 列（按形状认领声明） |
 *
 * 另外：**不做跨调用缓存**。曾经按模板 hash 缓存结论，但结论同时取决于"模块名"（声明查表）和
 * "传进来的库"，而 `wrapModule` 的 hash **不含名字** —— 同形不同名的模块会撞 hash，先问谁就
 * 缓存谁，后问的拿错答案（实测：`runGateVectors` 当场返回 null，函数却因缓存返回 true）。
 * 结论只在 Palette 的 `useMemo` 里用一次，去掉缓存既安全也够快。
 */
export function gateLevelUsable(mod: StoredModule, library: InMemoryModuleLibrary): boolean {
  // ① 时序模块（`isSequential`：锁存器/触发器/寄存器这些"上一关的成果"）**必列** —— 判定一定接得住
  //    （门级有声明就用声明，没声明就静默回落元件引擎）。绝不把玩家自己搭出来的时序积木藏掉。
  //    实测：第 8/9/10/11 关的成果（SR锁存器 / 按钮锁存器 / D锁存器 / D触发器）在元件版下都是 true，
  //    而第 1~7 关的**组合**门电路（非门/与门/或非门…）都是 false —— 与用户要的隐藏范围一致。
  if (mod.isSequential) return true;
  // ② 端口形状就是某个已声明的时序积木（D 锁存器 d/en/q、主从 D 触发器 clk/d/q）→ 同理必列。
  //    这一步兜住"封装工具没标出时序、但电路就是那个积木"的情况（玩家电路 qn 悬空时也可能漏标）。
  if (specByShape(mod)) return true;
  // ③ 剩下的**组合**模块：问门级判定本人（全门/原子、递归无元件 → 非 null；
  //    含元件的组合老模块 → null → 不列，用户明确要求保留）。
  try {
    const probe = DesignSchema.parse({
      id: '__gate-probe__',
      name: '门级可用性探针',
      instances: [{ kind: 'module', id: '__probe__', module: mod.hash }],
    });
    const widths = new Map<string, number>();
    return runGateVectors(probe, library, [{ inputs: {} }], widths, GATE_SEQ_SPECS) !== null;
  } catch {
    return false;
  }
}
