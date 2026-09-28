# 逐层电路：自造计算机（Layered Circuits）

从三极管开始，逐层搭出逻辑门、触发器、寄存器、存储器和 CPU 的**纯数字电路递进设计沙盒**。
设计文档见 `docs/《逐层电路：自造计算机》游戏设计文档（GDD）.md`，
技术方案见 `docs/技术方案与开发路线（Tech-Plan）.md`，
仿真语义（权威定义）见 `docs/sim-semantics.md`。

## 当前进度（M0：可运行内核）

- [x] pnpm monorepo 工程化（TypeScript strict / Vitest / Biome / 同构纯 TS 内核）
- [x] `@lc/sim-core`：开关级仿真内核（4 值 × 2 强度、通路元件、事件驱动 DES、双模式调度、诊断、波形 trace）
- [x] `@lc/compiler`：Design → FlatNet 编译、递归成本、模块封装与内容哈希（Merkle）、时序分析
- [x] `@lc/schema`：原理图/模块/关卡 DTO（Zod 校验）+ DesignBuilder
- [x] 参考电路自证：RTL 非门（2 三极管 + 3 电阻 = 成本 7）、与非门、SR 锁存器、二极管与/或门、二极管 ROM 单元
- [ ] `apps/studio`：无限画布编辑器 + 波形图 + 组件库面板（下一步）
- [ ] 关卡内容与最优解求解器（`tools/opt-solver`）

## 快速开始

```bash
pnpm install
pnpm check        # typecheck + lint + 全部测试
pnpm test         # 只跑测试
pnpm typecheck
pnpm lint
```

> 若 `pnpm install` 报无法写入 `$HOME`（沙箱环境），把 `.npmrc.example` 复制为 `.npmrc`
> 并改成工作区内的绝对路径，即可把 pnpm store 与 npm cache 放在项目内。

## 目录结构

```
packages/
  schema/     # DTO + Zod 校验 + DesignBuilder（作者态数据模型）
  sim-core/   # ★纯 TS 仿真内核：开关级求值 + 事件驱动调度（零 DOM 依赖）
  compiler/   # ★编译：Design → FlatNet；递归成本；模块封装/内容哈希；时序分析
docs/
  《逐层电路：自造计算机》游戏设计文档（GDD）.md
  技术方案与开发路线（Tech-Plan）.md
  sim-semantics.md            # ★仿真语义权威定义（改动前必读）
```

**架构铁律**：`sim-core` / `compiler` 不得引入任何 DOM / 框架依赖，
以便同一份内核跑在 Web Worker（不卡 UI）、Node（排行榜可信校验）与 CI（回归测试）里。

## 一段代码看懂内核

```ts
import { NetlistBuilder, Simulator } from '@lc/sim-core';

const b = new NetlistBuilder();
const IN = b.node('IN'), VCC = b.node('VCC'), GND = b.node('GND');
const B1 = b.node('B1'), A = b.node('A'), OUT = b.node('OUT');
b.power(VCC, 1); b.power(GND, 0);
b.res(IN, B1, 'R1');      // 输入限流
b.npn(A, B1, GND, 'Q1');  // 共射反相级
b.res(VCC, A, 'R2');      // 上拉
b.npn(VCC, A, OUT, 'Q2'); // 射极跟随器输出级
b.res(OUT, GND, 'R3');    // 输出下拉
b.input(IN, 'in'); b.output(OUT, 'out');
const net = b.build();    // 2 三极管 + 3 电阻 = 成本 7

const sim = new Simulator(net, { mode: 'logic' });  // 或 mode: 'timing'（1ns/0.5ns/0.8ns 延迟）
sim.setInput('in', 1);
console.log(sim.readPort('out')); // 0
```

## 语义速查

| 规则 | 内容 |
|---|---|
| 信号 | `0` = 悬空 Z；否则 `(强度 << 2) \| 逻辑值`，逻辑值 0/1/X，强度 WEAK(1)/STRONG(2) |
| 归约 | 强驱动胜；多个强驱动冲突 → X（短路错误）；多个弱驱动对拉 → X（分压不确定） |
| 通路元件 | 电阻/三极管/二极管只向**外部驱动更弱的一侧**传递电平（避免浮空孤岛伪稳态） |
| 三极管 | 基极 1 = 导通（双向），0 = 截止，Z = 截止 + 警告，X = 注入弱 X |
| 二极管 | 阳极确定为 1 且阴极不为 1 时导通，**单向**（逻辑隔离） |
| 电容 | 只计成成本，不参与逻辑仿真 |
| 模式 | `logic` 忽略延迟、迭代到收敛（不收敛 = 组合环/振荡）；`timing` 按 ps 整数延迟做事件驱动 |
