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
  's3-encoder',
  's3-reg-8',
  's3-digit-entry',
  // 暂不放行（对照表里仍有差异，宁可不快不能算错）：
  //   s2-dff（个别向量差异）
  //   s3-calc（结论不一致 + 慢 100 倍以上）
  //   s3-or-chain（没有门版参考解）
];

export const gateFastEnabledFor = (levelId: string): boolean => GATE_FAST_LEVELS.includes(levelId);
