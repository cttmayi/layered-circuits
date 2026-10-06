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
  //   s3-calc：**根因已查清（实测，不是推断）**，是"这一关的时钟靠延迟振荡"这个建模缺口，
  //     不是接线/引脚 bug：
  //       · 门级 67 行里 **29 行读到旧值/错值**（左位 disp_t 明显滞后，disp_u 常还是对的），
  //         元件级 67 行全对；典型行：按 C 清屏（期望 3f,3f）门级读 6f,6f。
  //         （pin↔net 多网名那个真 bug 早前已修掉，读数不再整片相反。）
  //       · 本关时钟**不是外部时钟口**：是【运算控制】内部一条**延迟链构成的环形振荡器**。
  //         元件级时序口径实测：上电窗口里 accClk 跳变 **12 次**（500ps 一跳 1→0→1→0…），
  //         按 C 再补一个沿（112400ps=1）—— 八位寄存器就是靠这些**沿**写入的。
  //       · 门级是**零延迟**求值：同一条环路代数上**收敛到静态电平**（实测每个向量
  //         unstable=false，accClk 稳定在 0 或 1），"振荡"消失 → 寄存器要么一直保持
  //         （clk 停在 1）要么一直透明（clk 停在 0），两者都不是设计意图 → 29 行错。
  //       · 关卡按键向量都带 **settlePs: 1_000_000**：这一关本来就按时序口径设计。
  //       · 顺带：本关门级比元件级**还慢 6 倍**（553ms vs 87ms），放行连"快"都换不到。
  //     ⚠️ 曾经的误判（已用实测纠正）：① "网是 1 而引脚读到 0" **不存在** —— 真设计上逐轮
  //     逐脚核对不变量得到 **0 处真不一致**（唯一"不一致"是 net 尚未赋值 'Z' 按约定读 0）；
  //     ② "组合环 64 轮不收敛、accClk 反复横跳" 也是仪器假象（在赋值前打印 settled）。
  //     ⚠️ 另一个坑：`mode:'timing'` 下 judge 里的门级快路**不会执行**（只在 mode==='logic'），
  //     会静默回落元件级 —— 所以"timing 口径下门级 0/67、完全一致"是**假读数**（元件级跑了两遍）。
  //     详见 docs/design-gates.md 第 10 节；可执行凭据见
  //     apps/studio/test/gate-calc-delay-clock.test.ts 与 packages/sim-core/test/gate-net-boundary.test.ts。
  //     ⚠️ 前置条件是**自动**守住的：apps/studio/test/gate-fast-whitelist-precondition.test.ts
  //     会遍历本名单逐关核对"门级 pass 与元件级相同、且逐行数值相同"，把 s3-calc 加进来它必红。
  //   s3-or-chain（没有门版参考解）
];

export const gateFastEnabledFor = (levelId: string): boolean => GATE_FAST_LEVELS.includes(levelId);
