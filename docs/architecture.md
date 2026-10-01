# 架构详解（docs/architecture.md）

> 面向要深入改代码的人。快速上手看 `docs/README.md`；仿真语义权威定义是 `docs/sim-semantics.md`。
> 本文回答三个问题：**数据长什么样、数据怎么流、改哪里动哪里**。

---

## 1. 分层总览

```
┌────────────────────────── apps/studio（游戏本体，唯一 UI 层）──────────────────────────┐
│  React 面板 / 自研 Canvas 渲染 / 存档 / 结算 / 委托叙事                                      │
│  Doc（画布文档） ──toDesign──▶ Design ──fromDesign──▶ Doc                                     │
│        │                                                                                      │
│        ▼  runner.send（40ms 防抖；优先 Web Worker，file:// 回退主线程）                       │
│  ┌─── sim/handle.ts（纯函数请求处理器，两条路径共用同一份）───────────────────┐             │
│  │   simulate → compileDesign + Simulator；judge → judgeDesign；wrap → wrapModule             │
│  └───────────────────────────────────────────────────────────────────────────┘             │
└──────────────────────────────────────────────────────────────────────────────────────┘
                          │ 仅经包导出（零 DOM）
                          ▼
┌── packages（纯 TS 内核，零 DOM/框架依赖，可在 Worker / Node / CI 三处复用）──┐
│  schema    数据模型（Design/Module/Level 的 Zod schema + DesignBuilder + 契约表 + 成本表）  │
│  sim-core  仿真内核（FlatNet IR + 开关级事件驱动 DES + 信号归约 + 波形）                    │
│  compiler  编译与判定（Design→FlatNet；递归成本；模块封装/内容哈希/环检测；时序实测；judge） │
│  content   关卡数据 + 参考解 + 门版教学积木 + 委托文案（数据即规格）                         │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**三条架构铁律**（Tech-Plan §1）：

1. 仿真/编译内核是纯函数式纯 TS 包，零 DOM、零 React、零引擎依赖。
2. 三极管层用「开关级 + strength 语义」，不做 SPICE。
3. 封装模块 = 内容寻址的不可变模板（Merkle hash），编译一次、实例化多次。

---

## 2. 核心数据结构

### 2.1 三层电路表示

| 层 | 类型 | 位置 | 说明 |
|---|---|---|---|
| **Doc**（画布） | `Doc`（syms/wires/nets/library） | `studio/src/editor/model.ts` | 编辑态：符号坐标、连线、库引用；可序列化进 localStorage |
| **Design**（作者态 DTO） | `Design`（instances/ports/nets） | `schema/src/design.ts` | 结构态：元件/模块实例 + 端口 + 网络；是存档/协议/判定的统一载体 |
| **FlatNet**（仿真 IR） | `FlatNet`（SoA 数组） | `sim-core/src/ir.ts` | 运行态：展开后的节点/元件/事件队列，直接喂 Simulator |

互转：`toDesign(doc)` / `fromDesign(design, baseDoc)`（studio/editor/model.ts）；`compileDesign(design, {library})`（compiler/flatten.ts）→ FlatNet。

### 2.2 模块模板与内容寻址

- 玩家封装：`wrapModule({name, ports, body: Design}, library)` → `ModuleTemplate`（不可变：hash/ports/body/costs/costHalf/delayPs/criticalPathPs/isSequential）。
- **hash = SHA256(稳定序列化的 ports + body 结构)**；标签/画布坐标不参与哈希（挪动元件不产生新模块）。
- 成本在**封装那一刻**递归固化（`tpl.costs`，含 nmos/pmos——见坑 §4），实例化 N 次 = N 倍，O(1) 查表。
- `InMemoryModuleLibrary`（schema/module.ts）：hash → 模板；`add()` 覆盖同 hash。
- **环检测**：`findDependencyCycle(body, library)`（compiler/wrap.ts）DFS 模块依赖图，visiting 中再遇 = 环；
  `wrapModule` 把环写成「模块循环依赖：X → Y → X」错误诊断（替代模糊的 depth-exceeded）。

---

## 3. 数据流：一键出答案（最重要的一条用户链路）

```
solveOneKey（App.tsx）
  ├─ familySpecOf(currentLevel, progress.family)        # 玩家契约 → 生效规格（family/units/参考解/满分线/预算）
  ├─ teachingSolutionOf(levelId, spec.family)           # 该契约的门版（null = 无门版）
  ├─ elementEdgeOf(level, spec.family)                  # 元件版相对门版是否占优：'cost'/'delay'/null
  └─ candidates 组装（门版默认在前，元件版占优排后并标注）：
       有门版 → {kind:'gate'}；元件版占优 → 追加 {kind:'element', note:'造价更低'/'延迟更短'}；无门版 → {kind:'element'}

applyAnswer(kind)
  ├─ gate  → teachingSolutionOf(...)（引用教学积木，需带 TEACHING_MODULES/FAMILY_GATES 建库）
  │          extra = teachingStoredFor(family) 并入画布库（门积木进左侧「我的模块」）
  ├─ element → spec.reference（契约工艺答案）
  ├─ next = fromDesign(ref, docForLevel(level, library))；loadDoc(next)
  └─ lastGateDocRef.current = kind==='gate' ? nextDoc : null   # lenient 判定依据

交付（runJudge）
  ├─ design = toDesign(doc)
  ├─ lenient = lastGateDocRef.current !== null && doc === lastGateDocRef.current（引用相等 = 画布未被玩家改过）
  └─ runner.send({type:'judge', design, lenient, …}) → handle.ts → judgeDesign(...)
       · lenient=true：不卡成本/时序预算（成本超了只降评分），功能/强度/元件集照常
       · pass → wrapAndSettle（自动封装 + 结算：款项−材料费=利润、S/A/B/C、三星）
```

门版判定库 = `new InMemoryModuleLibrary([...teachingModulesFor(spec.family)])`；
参考解判定库 = 空库（`referenceSolution` 必须空库可编译，CI 保证）。

---

## 4. 判定管道详解（compiler/judge.ts）

```
judgeDesign(design, level, options)
  1 编译     compileDesign（unknown-module / depth-exceeded / 端口绑定）
  2 向量     fn 生成全组合真值表 → 仿真逐组比对（多 bit 端口按位宽展开 lane）
  3 强度契约 FAMILY_CONTRACTS[family].output === 'strong' → 输出端口期望 1 的向量必须 S_STRONG
  4 组合性   wantsCombinational（unlock.kind==='logic'）且 isSequential → 报错「这是时序电路」
  5 成本     costHalf ≤ budgetHalf（lenient 跳过；cost 挑战关 level.kind==='cost' 不设上限）
  6 时序     hardcore：关键路径 ≤ timingBudgetPs；空翻 ≤ maxGlitches；setup/hold（真仿真扫描）
  7 评分     scoreOf(costHalf, optimalHalf, budgetHalf)（≤满分线=100，线性到预算线=0）；延迟分同理
  8 结果     pass = errors.length===0；rows（逐向量对比表）/waveform/timing/stars 供 UI
```

评星（studio/level/progress.ts `starsOf`）：成本与延迟各按基准线四档
（≤0.5×→3 星，≤0.75×→2 星，≤1×→1 星，超→0 星），取较差；教学关 0 星；成本挑战关不设成本线。

---

## 5. 内容包结构（content）

```
content/src/
  levels.ts           第 1 章 + 教学关（gateLevel 工厂；classroom/seedDoc/guideSteps/familyRefs）
  levels-seq.ts       第 2 章 时序（seqLevel 工厂；mode:'timing'、clock、空翻/建立保持断言）
  levels-ari.ts       第 3 章 算术 + 计算器链（ariLevel 工厂；bus 端口、button、display:'segment'）
  references.ts       门级参考解（RTL + cmosInv/cmosNand）
  references-family.ts  TTL/CMOS 工艺参考解（ttl*Ref / cmos*Ref）
  references-seq.ts / references-ari.ts / references-calc.ts  锁存器/触发器/加法器/计算器链
  teachings.ts        ★门版教学积木：FAMILY_GATES（每门 rtl/ttl/cmos 工艺积木）+ hashOf/gateTemplateFor/
                      teachingModulesFor + 组装函数（*ByModules）+ teachingSolutionOf + elementEdgeOf
  commissions.ts      委托文案（不进 Level schema，纯叙事包装）
```

**门版与参考解的关系**：参考解 = 纯元件（空库可编译，进 `reference`/`familyRefs`）；门版 = 引用教学积木 hash 的 Design
（必须带积木库才能编译，**不能**进 referenceSolution，只给一键出答案）。两者同构时成本相同；
`elementEdgeOf` 用 `familySpecOf` 的 spec 比较二者成本/延迟，元件版占优才非 null。

---

## 6. 包边界与依赖方向

```
studio ──▶ content ──▶ compiler ──▶ schema
   │           │            │
   │           └──▶ schema   └──▶ sim-core ──▶ (无依赖，纯 TS)
   └──▶ sim-core ──▶ 无
```

- `sim-core`：零依赖（唯一"最底层"）；`compiler` 依赖 schema + sim-core；`content` 依赖 schema + compiler；`studio` 依赖全部。
- 跨包引用一律走各包 `src/index.ts` 导出（`@lc/schema` / `@lc/sim-core` / `@lc/compiler` / `@lc/content`）。
- `tsconfig` 用 paths 映射到 `packages/*/src/index.ts`（源码直连，无需先 build）。

---

## 7. 仿真通道细节（studio/sim/）

| 文件 | 职责 |
|---|---|
| `protocol.ts` | `StudioRequest`/`StudioResponse` 联合类型（simulate/judge/wrap/solve；judge 带 lenient） |
| `runner.ts` | `createRunner()`：优先 `new Worker(worker.ts)`；Worker 不可用（file:// 等）回退主线程直调 `handleRequest` |
| `handle.ts` | **纯函数处理器**：buildLibrary → 按 type 分发；`simulate` 时 `compileDesign` + `Simulator`（`prevSignals` 保持输入状态，供按钮/时钟）；`judge` 时 `familySpecOf` → `judgeDesign`；`wrap` 时 `wrapModule` |
| `worker.ts` | 消息桥接 |

App 侧：`runner.send` 40ms 防抖合并仿真请求；面板订阅 `SimSnapshot`（电平/波形/成本）。

---

## 8. 改一个机制时该动哪些文件（速查）

| 想改什么 | 文件 |
|---|---|
| 元件成本/单价 | `schema/src/units.ts`（UNIT_COST_HALF）+ 展示口径 `costHalfOf/formatCost` |
| 信号语义/归约/元件模型 | `sim-core/src/signal.ts` + `engine.ts` + **先改 `docs/sim-semantics.md`** |
| 判定规则（强度/成本/时序/评分） | `compiler/src/judge.ts` + `schema/src/level.ts`（scoreOf/familySpecOf） |
| 契约（新逻辑族/强度规范） | `schema/src/family.ts` + `level.ts`（familySpecOf）+ `content`（familyRefs） |
| 关卡内容 | `content/src/levels*.ts` + `references*.ts` + `teachings.ts`（门版） |
| 一键出答案逻辑/弹窗 | `studio/src/App.tsx`（solveOneKey/applyAnswer/runJudge）+ `content/src/teachings.ts` |
| 结算/评星/钱包 | `studio/src/level/progress.ts` + `App.tsx`（wrapAndSettle） |
| 存档结构 | `studio/src/level/progress.ts`（PROGRESS_KEY）+ `session.ts`（草稿键）+ 存档校验测试 |
| 画布渲染 | `studio/src/editor/render.ts`（sprite/端口/布线/数码管） |
| 仿真通道 | `studio/src/sim/*`（protocol/runner/handle/worker） |

---

## 9. 已知的架构级权衡（接手时别踩）

1. **判定与门版两套库**：参考解空库编译、门版带积木库——`elementEdgeOf`/`applyAnswer` 必须按 spec.family 取对应库，混用会 unknown-module。
2. **lenient 用引用跟踪而非 hash**：`fromDesign→toDesign` 往返 hash 不保证一致（见坑），所以识别"画布=门版"用 `lastGateDocRef` 引用相等；玩家任何修改都会产生新 Doc 引用 → 自动从严。
3. **预算语义**：契约关 `budgetHalf = optimalHalf × 2`（比主线宽）；**不为门版再放宽**（门版超标准由 lenient 承接，用户定调）。
4. **moduleAccess 与门版有无是两回事**：`none` 关无门版；`all`/`listed` 关按 `teachingSolutionOf` case 决定；`listed` 关的门版必须只用 `allowedModules` 里的积木（判定会查）。
5. **内容寻址 hash 的防环性质**：模块 hash 含子模块 hash，正常流程（依赖先入库）构造不出环；`findDependencyCycle` 兜住"重封装引入环"与内容错误。
