# tools/ —— 一次性脚本与护具

| 目录 | 作用 | 跑法 |
| --- | --- | --- |
| `level-expect/` | **关卡期望值生成/校验器**（改关卡后期望值必须由它再生成一遍） | `pnpm lc-expect <关卡id> [--write]` |
| ↑ 同上 | **门级快路审计**：哪些 logic 关卡吃不到快路、为什么 | `pnpm lc-expect --audit` |
| `level-editor/` | 关卡编辑器 CLI | `pnpm lc-level` |
| `opt-solver/` | 成本最优解求解器 CLI | `pnpm solve` |

跑审计的另外两个出口（同一份实现，见 `packages/content/src/gate-fast-audit.ts`）：
`npx vitest run apps/studio/test/gate-fast-audit.test.ts`，以及每次 `pnpm check` 都会打印全表的
`apps/studio/test/gate-fast-whitelist-precondition.test.ts`。

## 期望值生成器为什么必须存在

门级引擎是**第二套仿真器**（7 个基础门当原子、无强弱、时序器件用「状态 + 时钟沿」），
它的读数与元件级引擎**时序口径**一致，也可能与元件级**逻辑口径**不一致
（逻辑口径是无延迟定点求解，交叉耦合回路的不动点未必唯一）。

所以**关卡 `vectors[].expect` 一律按门级口径生成/校验**，绝不手写：

```
pnpm lc-expect s3-calc          # 只校验：逐向量比对，有差异退出码 1 并打印清单
pnpm lc-expect s3-calc --write  # 差异时才改写关卡源文件里的 expect 字面量
```

边界：只写 `expect`（输入、note、顺序、条数、settlePs 一律不动）；原本没有 `expect` 的
"松开"向量保持不检查；`expect` 里没列的端口保持不检查。

⚠️ **改关卡（改电路 / 改向量 / 改答案）之后必须重跑它**，否则期望值会与引擎口径脱钩，
下一轮排查就没人说得清谁对。详细背景与实例（s3-calc 的 29 处差异）见
`docs/design-gates.md` 第 10 节。

## ⚠️ 假绿坑：**不要用 timing 口径量门级快路**

`judge.ts` 里的门级快路**只在 `mode === 'logic'` 时执行**；传 `mode:'timing'` 时
judge 会**静默回落到元件级引擎**——读数看起来"和元件级完全一致"，其实门级**根本没跑**。
实测同一关（s3-calc）：

```
门级真实结论（mode='logic' + gateSeqSpecs）：pass=false，逐行数值差异 58/67
强行按 timing 口径量：                      "0 差异、完全一致"   ← 假绿（元件级跑了两遍）
```

**规矩**：

1. 比较两个引擎时，必须确认门级那一遍**真的执行了**（耗时差异、或直接用
   `runGateVectors` / `gateFastSupportReason` 复核对不对得上），否则仪器会给假绿。
2. `pnpm lc-expect` **只接受 logic 口径**：传 `--mode=timing` 会被直接拒绝并退出（退出码 2），
   免得拿元件级读数冒充门级期望值；关卡若门级引擎吃不下（含元件 / 缺 SeqSpec），也会报错退出。
3. 谁吃不到快路、为什么，看下面这张表。

## 谁吃不到门级快路（可读审计）

```
pnpm lc-expect --audit     # 打印全表：每关 → 能否吃快路 / 原因
```

当前：**18 关 ✅ 已放行 / `s3-calc`（时钟来自【运算控制】内部的**建立时间延迟链**（10 级反相链，
       **不是环振**，见 docs/design-gates.md 10.2 的命名纠正）—— 有延迟口径已经修好"读旧值"，
       只剩「待命」那一行的上电态差异；
向量还带 `settlePs`）/ `s3-or-chain`（无门版参考解）**。这张表由 `packages/content/src/gate-fast-audit.ts` 生成，
命令行、审计测试、白名单前置条件护栏（每次 `pnpm check`）三个出口共用。

**硬规定**：新增 logic 关卡要吃门级快路，**必须通过前置条件护栏**
（门级 `pass` 相同 + 逐行数值相同 + 行数相同 + 门版参考解自身通过）——
不通过就只能回落元件级（判定仍正确、只是不加速），**不许为了加速改期望值**。
详见 `docs/design-gates.md` §10.5。