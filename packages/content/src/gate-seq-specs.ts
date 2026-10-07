/**
 * 逻辑版门级引擎的**时序器件声明**（SeqSpec）：哪个端口是时钟、哪个是数据、电平型还是边沿型。
 *
 * 端口名是**实测**出来的（packages/content/src/teachings.ts 里各积木的 DesignBuilder 端口声明），
 * 不是猜的：
 *   - D 锁存器：    d / en / q / qn   → 电平型（en 为 1 时透明）
 *   - 主从 D 触发器：d / clk / q / qn  → 上升沿型（只在 clk 0→1 时采）
 *   - 按钮锁存器：  btn / rst / q     → 没有时钟，靠按钮/复位（模式 pending，见下）
 *   - SR 锁存器：   sn / rn / q / qn  → 没有时钟，靠置位/复位（模式 pending）
 *
 * `qn` 是**反相输出**：用前导 `!` 表示（map: { d: ['q', '!qn'] }），引擎按 notBit 算。
 *
 * 还没声明的积木（八位寄存器 / 数字输入寄存器 / 数字输入寄存器的端口还没实测到）：
 * 门级快路对**缺声明**的时序模块**如实回落**到原引擎，不会算错、也不会假装支持。
 */
import type { GateSeqSpec } from '@lc/sim-core';

export const GATE_SEQ_SPECS: Readonly<Record<string, GateSeqSpec>> = {
  D锁存器: {
    clock: 'en',
    data: ['d'],
    mode: 'level',
    initial: '1', // 实测：元件级里交叉耦合锁存电路收敛到 Q=1
    map: { d: ['q', '!qn'] },
  },
  主从D触发器: {
    clock: 'clk',
    data: ['d'],
    mode: 'rising',
    initial: '1', // 同上：主从 D 触发器上电也是 Q=1
    map: { d: ['q', '!qn'] },
  },
};

/** 有声明就能走门级时序引擎；没有就回落（见文件头）*/
export const seqSpecOf = (moduleName: string): GateSeqSpec | undefined =>
  GATE_SEQ_SPECS[moduleName];

/**
 * 门级快路的**开关白名单**：只有在这里列出的关卡才会走门级引擎，其它一律回落原引擎。
 *
 * 为什么需要白名单（而不是"条件满足就走"）：实测发现条件满足 ≠ 结论正确。
 * apps/studio/test/gate-fast-judge.test.ts 的护栏量到：
 *   · s3-half-adder：元件级 2ms(pass=true) / 带快路 1ms(pass=true) → 一致，可以启用；
 *   · s3-calc     ：元件级 108ms(pass=true) / 带快路 4928ms(**pass=false**) → **结论不一致**，
 *     而且慢 45 倍。在查清原因并修好之前，它**不许**走快路 —— 宁可不快，不能算错。
 *
 * ⚠️ 第 ⑲ 轮（用户拍板走 A 路线）之后，**门级引擎本身已换成"有界延迟 + 惯性"**
 * （`packages/sim-core/src/gate-delay.ts`），所以上表名单是按**新口径**逐关复算过的：
 * `apps/studio/test/gate-delay-levels.test.ts` 把 20 关的 pass/错行/行数/得分钉住，
 * 并逐关与元件级比对（18 关逐行 0 差异；s3-calc 66/67，仅"待命"那一行的上电态不同）。
 */
export const GATE_FAST_LEVELS: readonly string[] = [
  // 下面这些关已由 apps/studio/test/gate-fast-report.test.ts（对照表）实测：
  // 门级与元件级**判定结论相同、逐行数值也完全相同**（在各自的门版参考解上）。
  's3-half-adder',
  's3-full-adder',
  's3-adder-4',
  's3-adder-8',
  's3-alu',
  's3-bcd2bin',
  's3-bin2bcd',
  's3-display',
  's3-seg-de',
  's3-seg-fg',
  's3-display2',
  's2-sr-latch',
  's2-btn-latch',
  's2-d-latch',
  's2-dff',
  's3-encoder',
  's3-reg-8',
  's3-digit-entry',
  // 暂不放行（对照表里仍有差异，宁可不快不能算错）：
  //   s3-calc：**根因已查清，并已随第 ⑲ 轮"有界延迟门级"口径改动更新（全部实测）**：
  //     · 全项目口径已从"零延迟门级"改成**有界延迟 + 惯性语义**的事件驱动模型
  //       （packages/sim-core/src/gate-delay.ts，延迟取自各门 rtl 身体电路的 criticalPathPs 实测值）。
  //       **零延迟把"建立时间"抹掉了**：本关 67 行里 **29 行**读到旧值（左位 disp_t 滞后），
  //       因为【运算控制】里 `clk1 = op∨eq∨c` 要经 **10 级反相器链**（≈15ns）才推出 accClk，
  //       这 15ns 是**功能**——保证 op/eq/c 沿上 accD 已稳定，八位寄存器靠它的**沿**写入。
  //       （`teachings.ts:1105/1128-1137`、`references-calc.ts:331/380-392`）
  //     ⚠️ 早前记录里"延迟链构成的**环形振荡器**"是**误名**，已实测纠正：clk1 只由按钮输入驱动、
  //       **没有反馈回路**（原型自检"自环单元 0"）；元件时序口径下 accClk 只在**上电瞬态**里跳变
  //       12 次（500ps…17500ps）然后停在 0，逐微秒推进 2~6µs 新增 **0** 次；有延迟门级同样只在
  //       [0,1e6] 跳 16 次、之后 `[1e6,1e7]`/`[1e7,1e8]` 新增 **0** 次（瞬态，不是持续振荡）。
  //     · **有延迟门级下本关 67 行里有 66 行与元件级逐位相同**，只剩 **第 0 行「待命（上电先按 C 清零）」**：
  //       两台上电收敛到不同的数码管态（元件 0x6f/0x6f vs 门级 0x4f/0x4f，差在 e 段）。
  //       该行**没有期望值**（关卡本来要求先按 C），两台引擎都 pass=true，结论不受影响。
  //     · 所以本关**仍然不放行**：审计判据是"逐行数值全等"，这一行不全等 → 放行会让审计第 ② 道闸红。
  //       要放行只有两条路（**都需先拍板**）：把"无期望值的行"定义成 don't-care，或改关卡内容。
  //     · 判定今天仍走元件引擎：实测 pass=true、67 行全对、得分 100（与放行前逐项一致）。
  //     · 顺带：有延迟门级在本关比零延迟门级**快得多**（原型 12~15ms vs 官方零延迟 507.7ms/67 行）。
  //     ⚠️ 曾经的误判（已用实测纠正）：① "网是 1 而引脚读到 0" **不存在** —— 真设计上逐轮
  //     逐脚核对不变量得到 **0 处真不一致**（唯一"不一致"是 net 尚未赋值 'Z' 按约定读 0）；
  //     ② "组合环 64 轮不收敛、accClk 反复横跳" 也是仪器假象（在赋值前打印 settled）。
  //     ⚠️ 另一个坑：`mode:'timing'` 下 judge 里的门级快路**不会执行**（只在 mode==='logic'），
  //     会静默回落元件级 —— 所以"timing 口径下门级 0/67、完全一致"是**假读数**（元件级跑了两遍）。
  //     详见 docs/design-gates.md 第 10 节；可执行凭据见
  //     apps/studio/test/gate-calc-delay-clock.test.ts、apps/studio/test/gate-delay-levels.test.ts 与
  //     packages/sim-core/test/gate-delay.test.ts。
  //     ⚠️ 前置条件是**自动**守住的：apps/studio/test/gate-fast-whitelist-precondition.test.ts
  //     会遍历本名单逐关核对"门级 pass 与元件级相同、且逐行数值相同"，把 s3-calc 加进来它必红。
  //   s3-or-chain（没有门版参考解）
];

export const gateFastEnabledFor = (levelId: string): boolean => GATE_FAST_LEVELS.includes(levelId);
