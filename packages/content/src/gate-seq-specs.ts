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
    map: { d: ['q', '!qn'] },
  },
  主从D触发器: {
    clock: 'clk',
    data: ['d'],
    mode: 'rising',
    map: { d: ['q', '!qn'] },
  },
};

/** 有声明就能走门级时序引擎；没有就回落（见文件头）*/
export const seqSpecOf = (moduleName: string): GateSeqSpec | undefined =>
  GATE_SEQ_SPECS[moduleName];
