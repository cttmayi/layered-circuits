# 开发者接手文档（docs/README.md）

> 本文是**重启新对话时的上下文包**：读完它 + 下述关键文件，即可继续开发。
> 玩家向文档见根目录 `README.md`；架构细节见 `docs/architecture.md`；
> 设计依据见 `docs/《逐层电路：自造计算机》游戏设计文档（GDD）.md` 与 `docs/技术方案与开发路线（Tech-Plan）.md`；
> 仿真语义的**唯一权威定义**是 `docs/sim-semantics.md`（改语义必须先改它 + 补测试）。

---

## 1. 项目一句话与现状

纯数字电路递进设计沙盒：玩家从三极管搭起，逐层封装复用，最终拼出两位数加法计算器。
**TypeScript 全栈 Web 应用**（Vite + React 19 + 自研 Canvas + Web Worker 仿真），pnpm monorepo。

**当前完成度（2025-10 状态）**：

- ✅ M0 内核（sim-core / compiler / schema）、M1 阶段 1 闭环、M2 时序、M3 内容基建（求解器/关卡编辑器/组件库版本/存档）
- ✅ **契约系统**：新游戏选 RTL/DTL/TTL/CMOS，判定按契约换元件集/满分线/预算/输出强度检查；教学关按契约换内容（教什么用什么）
- ✅ **阶段 3 内容**：半加器/全加器/4·8 位加法器/简易 ALU/BCD↔二进制/八位寄存器/**简易计算器**（27 关全可玩）
- ✅ **门版教学积木**（一键出答案）：每个关卡按玩家工艺给"用其他门搭"的门级参考解，元件版仅在更省/更快时作为更优解弹窗；`lenient` 判定保证门版答案可交付
- ✅ **门模块形象**：中文门名为主（居中，按长度自动缩字号），右上角小字标 IEC 符号（& / ≥1 / =1 / 1），反相门输出侧带气泡；**双击模块展开详情**（内部电路图 + 递归成本明细树，Inspector 也有按钮）
- ✅ 结算/评星/钱包/称号/工具铺/黑盒侦察/存档导入导出
- ⏳ 待办：蓝图 4 关（s1-mux2/s2-gated-sr/s3-adder-2/s3-sub-4）仅设计未实现；低成本版计算器优化；延迟线补全；GUI 视觉自动验证；阶段 4+（寄存器组/ALU/RAM/CPU）

**质量基线**：`pnpm check` 全绿 = 218 个测试 / 36 个测试文件。

---

## 2. 快速命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动游戏（http://localhost:5273/，Vite HMR） |
| `pnpm check` | typecheck（根 + studio）+ biome lint/format 检查 + 全部测试（提交前必跑） |
| `pnpm test` / `pnpm test:watch` | 只跑测试 |
| `pnpm build` | 产出单文件 `apps/studio/dist/index.html`（离线可玩） |
| `pnpm solve` | 求解器对照表：声明最优 vs 求解器结论 |
| `pnpm lc-level <spec.json> [out.ts]` | 关卡编辑器：spec → 已验收关卡源码 |

> 沙箱环境若 `pnpm install` 报无法写 `$HOME`：把 `.npmrc.example` 复制为 `.npmrc` 并改成工作区内绝对路径。

---

## 3. 仓库结构（改动高频区加 ★）

```
apps/studio/            # 游戏本体（React + Canvas + Worker）
  src/App.tsx           # ★主应用：路由/模式/一键出答案/交付结算/存档
  src/editor/model.ts   # ★Doc（画布文档）↔ Design 互转（fromDesign/toDesign）
  src/editor/render.ts  # Canvas 渲染（sprite/引脚/布线）
  src/sim/              # ★仿真通道：protocol.ts（请求协议）+ runner.ts（Worker/主线程回退）+ handle.ts（纯函数处理器）+ worker.ts
  src/level/            # progress.ts（存档/评星/款项/利润）+ session.ts（草稿存储）+ library.ts（模块库）+ equipment.ts（工具铺）
  src/panels/           # 面板：Palette/Inspector/JudgePanel/LibraryPanel/SettlementPanel/WaveformPanel/LevelMap/ClassroomModal/FamilyPicker...
  test/                 # 17 个测试文件（UI 级，含 debug-mode / fromDesign / calc-sim）
packages/
  schema/src/           # ★数据模型（Zod）：design.ts（Design/Doc 核心 DTO）+ module.ts（模块模板/库）+ level.ts（关卡 + familySpecOf + scoreOf）+ family.ts（FAMILY_CONTRACTS）+ units.ts（UNIT_COST_HALF）+ builder.ts（DesignBuilder）
  sim-core/src/         # ★仿真内核（零 DOM）：ir.ts（FlatNet）+ engine.ts（事件驱动 DES）+ signal.ts（4值×2强度）+ harness.ts（测试驱动）+ waveform.ts
  compiler/src/         # ★编译与判定：flatten.ts（Design→FlatNet）+ cost.ts（递归成本）+ wrap.ts（封装/hash/环检测）+ timing.ts（延迟实测/反馈环）+ judge.ts（judgeDesign）+ sha256.ts
  content/src/          # ★关卡内容包：levels.ts（第1章+教学关）+ levels-seq.ts（第2章）+ levels-ari.ts（第3章+计算器）+ references*.ts（参考解）+ teachings.ts（★门版教学积木/FAMILY_GATES）+ commissions.ts（委托文案）
tools/
  opt-solver/           # 离线最优解求解器（预算源头；只覆盖 1~2 输入组合逻辑）
  level-editor/         # spec → 已验收关卡（README 见 tools/level-editor/README.md）
docs/
  README.md             # ← 本文（开发者接手）
  architecture.md       # 架构详解
  sim-semantics.md      # ★仿真语义唯一权威
  Tech-Plan / GDD       # 设计文档
```

**包依赖方向**（铁律）：`sim-core` 与 `compiler` **零 DOM / 零框架依赖**（Worker、Node 校验、CI 三处复用同一份代码）。`schema` 被所有包依赖；`content` 依赖 schema + compiler；`studio` 依赖全部。

---

## 4. 核心概念速查（全部有对应代码）

### 4.1 信号与元件（sim-core + sim-semantics §2–3）

- 信号编码：`signal = (strength << 2) | value`；`0` 表示高阻 Z；逻辑值 `0/1/X`，强度 `WEAK(1)/STRONG(2)`。
- 归约：强驱动胜；多强驱动冲突 → X（短路）；多弱驱动对拉 → X（分压不确定）。
- **通路元件只向"外部驱动更弱"的一侧传电平**（避免浮空孤岛伪稳态——RTL 与非门中点锁死问题，Tech-Plan §0 修正 1）。
- 元件延迟：三极管 1.0ns、电阻 0.5ns、二极管 0.8ns（皮秒整数，禁浮点判逻辑）；电容不参与仿真只计成本。
- 元件成本（**半分**记账，展示时折半）：`UNIT_COST_HALF` = npn 4 / res 4 / dio 2 / cap 8 / nmos 2 / pmos 2（units.ts）。显示元 = 半分 ÷ 2。

### 4.2 契约系统（schema/family.ts + level.ts `familySpecOf`）

- `FAMILY_CONTRACTS`：rtl/dtl/ttl/cmos，每族定义默认元件集 `units`、输出规范 `output`（`weak-high` | `strong`）、文案。
  - **rtl/dtl = weak-high**（高电平允许弱 1）；**ttl/cmos = strong**（推挽，高必须强 1）。
- **新游戏时玩家选契约，整个存档固定**（`progress.family`；FamilyPicker 默认勾 cmos）。
- `familySpecOf(level, family)`（level.ts）：
  - **教学关**（`classroom` 存在）：按 `familyRefs[family]` 全套换内容/元件/参考解/满分线（教什么用什么）；无该族条目 → 用关卡默认。
  - **正式关**：`familyRefs[family]` 存在 → `units = allowedUnits + 契约units`、`reference = 契约参考解`、`family = 该契约`、`budgetHalf = optimalHalf × 2`；
  - **无 familyRefs** → 回退 `{ family: 'rtl', reference: level.referenceSolution }`（判定不查强度，RTL 积木即可）。
- **强度检查**（judge.ts）：契约 `output === 'strong'` 时，对输出端口期望=1 的向量查 S_STRONG；弱 1 报错
  （如「TTL 推挽输出 契约要求推挽输出：y … 实际是弱 1（多半靠上拉电阻凑的）…」）。
- **familyRefs 覆盖现状**：TTL 只 s1-not/and/or/nand/nor（5 基础门）；CMOS 覆盖 s1 全部（含 xor/xnor/xor-retro + 教学关）；
  **s2/s3 无 familyRefs** → TTL/CMOS 契约下回退 RTL 判定，门版仍用 RTL 积木即可。
- 教学关（classroom）：s1-npn / s1-dio / s1-float / s1-cmos-inv / s1-cmos-nand。**不评星、不设预算与延迟标准**（App 里 `classroom ? 0 : starsOf(...)`）。

### 4.3 关卡定义（schema/level.ts + content/levels*.ts）

```ts
// 关键字段（levels.ts 用 gateLevel/seqLevel/ariLevel 工厂生成）
id / title / stage(1|2|3) / kind('main'|'cost'|'timing'|'retro')
fn(a,b) -> 真值表函数（向量由此生成）
inputs / ports（支持 width>1 总线、button 瞬时键、display:'segment' 数码管）
optimalHalf（满分线=参考解成本，半分）/ budgetHalf（= optimalHalf×2，预算线）
timingBudgetPs（硬核时序预算）/ clock（{freqHz}）/ mode('logic'|'timing')
allowedUnits / requiredUnits / moduleAccess('none'|'all'|'listed') + allowedModules/bannedModules
unlockName（通关解锁的模块名）/ reference（空库可编译的参考解）/ familyRefs / classroom / seedDoc / guideSteps
```

- **moduleAccess 语义**：`none`（禁模块，只能手搭）→ s1-not/and/or、教学关；`all` → s1-nand/nor、s2/s3；
  `listed`（限定 allowedModules）→ s1-xor（非门/与非门）、s1-xnor（非门/与非门/异或门）、s1-xor-retro（非门/与门/或门，banned 与非门）。
- **关卡数据即规格**：判定与 UI 从同一份数据派生，**改关卡不用改代码**。

### 4.4 参考解与门版（content/references*.ts + teachings.ts）

- **参考解**（`reference`/`familyRefs[].reference`）：纯底层元件的 Design，**空库即可编译**（CI 保证每关可通关、成本=满分线）。
  - references.ts（RTL 门级）：notGateRef / andGateRef / orGateRef / nandGateRef / norFastRef / xorGateRef / xnorGateRef / cmosInvRef / cmosNandRef …
  - references-family.ts：ttlNotRef / ttlNandRef / ttlNorRef / ttlAndRef / ttlOrRef + cmosNorRef / cmosAndRef / cmosOrRef / cmosXorRef / cmosXnorRef
  - references-seq.ts / references-ari.ts / references-calc.ts：锁存器/触发器/加法器/计算器链
- **门版教学积木**（teachings.ts，`teachingSolutionOf(levelId, family)`）：
  - `FAMILY_GATES` 表：每门给 rtl/ttl/cmos 三套工艺积木参考解（缺失回退 rtl）；`hashOf(name, family)` 取哈希；`gateTemplateFor` 带缓存。
  - **门版必须"用其他门搭，不自引用、无循环依赖"**（用户硬性要求，wrap.ts `findDependencyCycle` 检测）：
    - s1-nand = 【与门】+【非门】；s1-nor = 【或门】+【非门】（仅这些关如此，且全契约都给）
    - s1-xor = 4×【与非门】；s1-xnor = 【异或门】+【非门】；半加器 = 异或+与；全加器 = 9×与非门；加法器 = N×全加器；计算器链 = bcd2bin/bin2bcd/寄存器/全加器拼装
  - **一键出答案原则（用户拍板）**：**门版是默认答案**；元件版仅在相对门版占优（成本更低 `'cost'` / 延迟更短 `'delay'`，见 `elementEdgeOf`）时作为弹窗选项并标注；两者都无 → 元件版兜底。
  - 门版判定走 **`lenient`**（只查功能+强度契约，不卡玩家成本/时序预算——成本超了只降评分，见 §4.6）。

### 4.5 编辑器模型与存档（studio/editor/model.ts + level/progress.ts + session.ts）

- **Doc**（画布文档：syms/wires/nets/library）↔ **Design**（作者态 DTO）互转：`fromDesign(design, baseDoc)`（一键出答案/布局）、`toDesign(doc)`（交付/仿真）。
- 存档键：进度 `lc-studio-progress-v1`（family/cleared/attempts/library/walletHalf/recon/equipment…）；关卡草稿 `lc-studio-level-<id>-v1`；自由模式 `lc-studio-doc-v1`。
- 结算：`paymentOf` = 款项（budgetHalf；成本挑战关用 optimalHalf）；`profitOf` = 款项 − 材料费（可负）；`gradeOf`（S/A/B/C）；`starsOf`（成本/延迟各四档 0.5/0.75/1 倍预算线，取较差，教学关 0）。

### 4.6 判定管道（compiler/judge.ts）

`judgeDesign(design, level, { library, family, units, optimalHalf, budgetHalf, timingBudgetPs, hardcore, lenient })`：

1. 编译（flatten：模块展开/端口绑定/unknown-module/depth-exceeded 报错）
2. 功能：逐向量仿真对比（`fn` 生成的全组合真值表）
3. 结构：逻辑门关要求组合逻辑（`wantsCombinational`，有反馈环 → fail）；强度契约检查（§4.2）
4. 成本：`costHalf ≤ budgetHalf` 才 pass（**lenient 时不判死**，只降评分）
5. 时序（hardcore）：关键路径 ≤ timingBudgetPs；空翻次数；建立/保持时间
6. 评分：`scoreOf`（成本 ≤ optimalHalf = 100，线性降到 budgetHalf = 0）+ 延迟分；评星见 §4.5

**lenient 语义**：一键出答案门版搭出后，App 用 `lastGateDocRef`（引用跟踪）记住"画布没被玩家改过"→ 交付时传 `lenient: true`（协议 `StudioRequest` 增加字段）；玩家动过画布 → 照常从严。**门版答案超玩家标准（如 TTL 拼两门 44 > 预算 40）也能交付，只是低分**——这是"门版是默认答案"的技术保障。

### 4.7 仿真通道（studio/sim/）

App 40ms 防抖 → `runner.send(req)`（优先 Web Worker，file:// 自动回退主线程）→ `handleRequest`（**纯函数、无 DOM**）→ 按 `type` 分发：`simulate`（compileDesign + Simulator，`prevSignals` 保持状态）/ `judge` / `wrap` / `solve`。协议见 protocol.ts。

---

## 5. 改东西的具体流程

### 5.1 加一个关卡

1. 在 `packages/content/src/levels-*.ts` 用工厂（`gateLevel`/`seqLevel`/`ariLevel`）加定义：真值表 `fn`、端口、`optimalHalf`（= 参考解成本）、`timingBudgetPs`、`moduleAccess`、`reference`。
2. 写参考解到 `references-*.ts`（纯元件 Design，用 DesignBuilder），成本必须 = optimalHalf（测试断言）。
3. 有门版 → 在 `teachings.ts` 加组装函数 + `teachingSolutionOf` case（**用其他门拼，别自引用**；元件版更优时 `elementEdgeOf` 自然返回 'cost'/'delay'）。
4. 委托文案加到 `commissions.ts`（可选）。
5. 测试：`packages/content/test/levels-*.test.ts` 断言"参考解判定通过且满分、门版判定通过、成本=满分线"。
6. `pnpm check`。

### 5.2 加契约（如新逻辑族）

1. `schema/family.ts` 加 `FAMILY_CONTRACTS[family]`（元件集/输出规范/文案）+ `FAMILIES`。
2. 目标关卡 `familyRefs[family]` 加条目（reference/optimalHalf/timingBudgetPs）；缺省回退 rtl（判定不查强度）。
3. 门版：`FAMILY_GATES` 表给工艺积木；`teachingSolutionOf` 传 family 即可复用。
4. 测试：`content/test/family-refs.test.ts` + `studio/test/fromDesign.test.ts`（契约判定 + elementEdgeOf）。

### 5.3 改判定/仿真语义

先改 `docs/sim-semantics.md`，再改 `sim-core`，**同步补黄金测试**（`packages/sim-core/test/*`）。

### 5.4 用关卡编辑器

```bash
pnpm lc-level tools/level-editor/specs/s1-majority.json        # 看结论（满分线/预算/路径）
pnpm lc-level tools/level-editor/specs/s1-majority.json /tmp/x.ts  # 生成关卡源码
```

---

## 6. 测试策略（34 文件 / 211 测试）

| 测试文件 | 覆盖 |
|---|---|
| `sim-core/test/*` | 信号归约/非门/与非门/锁存器/二极管/MOS/波形（语义黄金测试） |
| `compiler/test/design-compile.test.ts` | 编译/成本递归/MOS 成本回写/内容哈希 |
| `compiler/test/wrap-cycle.test.ts` | **模块循环依赖检测**（与非门↔与门互相引用成环） |
| `compiler/test/timing.test.ts` | 延迟实测/反馈环 |
| `content/test/levels*.test.ts` | 每关参考解判定满分 + 门版判定 + 反例（错误电路必须判失败） |
| `content/test/family-refs.test.ts` | 契约规格/强度检查 |
| `studio/test/fromDesign.test.ts` | 一键出答案往返 + 契约门版 lenient 判定 + 布局快照 + **无循环依赖断言** |
| `studio/test/debug-mode.test.tsx` | 一键出答案 UI（含计算器门版 60s） |
| `studio/test/calc-sim.test.ts` | 计算器链仿真 |

跑法：`pnpm exec vitest run <file>` 单文件；`pnpm check` 全量。

---

## 7. 已知限制与待办（接手时从这里继续）

1. **蓝图 4 关未实现**：`docs/关卡循序渐进设计蓝图（待审核）.md` 里的 s1-mux2 / s2-gated-sr / s3-adder-2 / s3-sub-4（仅设计文档，未做关卡）。
2. **门版答案规模违规**：`docs/关卡设计规范（规模与积木复用）.md` 规定门版答案顶层盒数 ≤ 15，当前 s3-bin2bcd（190）、s3-calc（239）、s3-reg-8（17）超限（加3单元/D触发器没封装复用），s1-xor-retro 无门版。修复预案见该规范 §五。
3. **低成本版计算器**：当前计算器链是"高成本完整链"（bcd2bin + 加法 + bin2bcd + 寄存器，optimalHalf 15200）；用户已确认后续做"低成本版"优化（复用求解器找更省结构）。
4. **延迟线未补**：reg-8 / calc 暂不评延迟档（starsOf 对 timingBudgetPs 为 null 的关只按成本评星）；部分关未给时序预算。
5. **GUI 视觉未自动验证**：画布 Canvas 渲染无截图回归（曾用 headless Chrome + CDP 人工验证；vision 后端会话内有限流）。
6. **求解器覆盖窄**：只做 1~2 输入组合逻辑；时序/算术关只复核参考解不做最优搜索；3 输入以上参考解用 SOP 兜底（成本偏高）。
7. **阶段 4+ 未开始**：寄存器组 / ALU / RAM / 总线 / CPU（Tech-Plan M4–M6）。
8. **fromDesign 布局**：`studio/test/fromDesign.test.ts` 有"紧凑网格 ≤10 个/列"快照，改布局要同步更新。

---

## 8. 开发约定与常见坑

**约定**
- commit 消息用**中文**，格式 `类型+主题：一句话`（如 `修复门版循环引用：…`），可带要点列表。
- 提交前必跑 `pnpm check`（typecheck + biome + 211 测试全绿）；改动后 `pnpm build` 验证单文件产物。
- 新概念先在 `docs/sim-semantics.md`（仿真）或本文件/architecture.md（机制）留痕，再写代码。

**坑（都是真实踩过、已修/已绕过的）**
1. **通路元件传递规则**：无条件双向传递会伪造假稳态（RTL 与非门中点锁死 0）——必须"只向更弱侧传"。
2. **时序分析不能用编译期图论**：双向通路产生伪环，改用"同一套时序仿真逐输入翻转实测"（Tech-Plan §0 修正 2）。
3. **模块成本回写漏 MOS**：`cost.ts` 的 `addCounts` 回写曾漏 `nmos/pmos`（CMOS 积木成本恒 0）——已修并有测试钉住（`design-compile.test.ts`「CMOS 模块成本固化」）。
4. **hash 往返不一致**：`hashDesign(fromDesign(toDesign))` 不保证相等（fromDesign 还原会重排/改名）——所以 lenient 识别**不能用 hash 比较**，用 App 侧 `lastGateDocRef` 引用跟踪。
5. **门版不能自引用**：s1-nand 答案用「与非门积木」= 答案=题目（用户否决）；必须"用其他门搭"，且 wrap 时 `findDependencyCycle` 检出互相引用成环。
6. **TTL/CMOS 契约门版成本**：TTL 拼两门 = 44 > 预算 40（满分线是单门成本）——**不要为门版放宽预算/时序**（用户明确"不用管门版超标准"），用 lenient 判定承接。
7. **moduleAccess ≠ 门版有无**：s1-not/and/or 是 `none`（无门版，禁模块）；s1-nand/nor 是 `all`（有门版但用其他门拼）；s1-xor/xnor 是 `listed`（限定积木拼）。改门版前先看关的 moduleAccess。
8. **结算语义**：页面文案用「款项」（= 客户按成本线付的固定总价），利润 = 款项 − 材料费；契约关的款项/对标/委托卡按玩家契约显示（修过"契约关结算亏钱"）。
9. **教学关不评星不设预算**：`classroom` 关直接 `starsOf → 0`，别给它加预算断言。

---

## 9. 最近提交历史（按时间倒序，帮助理解演进）

```
5cdc2f8 门版是默认答案：全契约出门版（TTL/CMOS 拼两门也行），判定走宽松通道，元件版作为更优解弹窗
bb798f6 修复门版循环引用：与非门答案改用与门+非门，封装时检出模块循环依赖
62841c9 TTL/CMOS 契约也出门版：按玩家工艺给强输出教学积木，修复 MOS 模块成本漏算
c33c302 恢复一键出答案原则：计算器链 4 关补逻辑门版（优先门版、不弹元件版）
ef2384a 修复关卡地图：27 关全部可滚动查看，主菜单关卡数动态显示
aa6f2d6 实现简易计算器链：BCD↔二进制转换、八位寄存器、计算器关（高成本版）
2c77ffc 修复契约关结算亏钱：款项/对标/委托卡按玩家契约显示
e727498 修复评星 BUG：契约参考解一键出答案不再是 0 星
a9acf76 指标定稿：元件成本 / 传播延迟
b044091 完全按契约：各功能关按契约给参考解/满分线/预算，一键答案按玩家工艺
791b351 支持 CMOS 工艺：MOS 元件、新游戏固定契约、模块标注契约，成本按工业实际重调
```

---

## 10. 30 秒自检（改完代码问自己）

- [ ] `pnpm check` 全绿（211/34）
- [ ] 新参考解/门版成本 = optimalHalf？门版无循环依赖？
- [ ] 契约关强度检查过了吗（TTL/CMOS 输出强 1）？
- [ ] 结算款项/利润按玩家契约显示？评星不被教学关拖累？
- [ ] 语义改动同步了 sim-semantics.md + 黄金测试？
- [ ] commit 中文、描述清楚"为什么"
