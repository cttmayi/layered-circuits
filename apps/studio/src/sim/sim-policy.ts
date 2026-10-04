import type { GameMode } from '../level/session';

/**
 * 是否在连续仿真间复用上次终态（prevNodeSignals）。
 *
 * 这里有**两个互不相干的轴**，别混在一起：
 *
 * - **判定口径**（关卡声明的 level.mode）：判定取"瞬时收敛答案"还是"真实时序窗口末端"的值。
 *   它是关卡设计的一部分，跟玩家怎么看画布无关。
 * - **画布看法**（simMode：稳定值看法 / 时序看法）：玩家点一下输入时，看到的是
 *   "一次独立求值的结果"，还是"真实时序跑一段之后的结果"。
 *
 * 复用属于**看法**这一轴：
 * - 时序看法必须复用，否则锁存器/寄存器一点输入就丢位（"保持"无从谈起）；
 * - 稳定值看法**选择不复用**：每次从冷启动全量重算，点一下就是一次独立求值 ——
 *   确定性最好，也不会把上一次的瞬态带进新结果。这是玩法语义选择，不是正确性补丁：
 *   复用路径本身已经安全（快照携带全节点电平，恢复后从自洽初值重收敛，
 *   见 SimulatorOptions.initialNodeSignals），实测同一电路"复用 vs 不复用"逐次一致。
 *   历史上这里确实绕过 bug（早期快照只含顶层网、模块内部节点不恢复），根因已修。
 *
 * 沙盒未知是否含时序电路，按「可能有」处理（保住玩家搭的锁存器跨点击状态）。
 */
export function shouldReuseSimState(gameMode: GameMode, simMode: 'logic' | 'timing'): boolean {
  if (gameMode === 'free') return true;
  return simMode === 'timing';
}
