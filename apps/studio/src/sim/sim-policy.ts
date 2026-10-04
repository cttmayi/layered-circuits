import type { Level } from '@lc/schema';
import type { GameMode } from '../level/session';

/**
 * 是否在连续仿真间复用上次终态（prevNodeSignals）。
 *
 * 时序关卡（锁存器/寄存器：mode='timing' 或 unlock.kind='seq'）必须复用，才能在
 * 多次仿真之间保持状态（点按钮、换输入时锁存器不丢位）。
 *
 * 组合关卡**选择不复用**：每次从冷启动全量重算，点一下输入就是一次独立求值 ——
 * 确定性最好，也不会把上一次的瞬态带进新结果。这是"要不要带状态"的玩法语义选择，
 * 不是正确性补丁：复用路径本身已经安全（快照携带全节点电平，恢复后从自洽初值重收敛，
 * 见 SimulatorOptions.initialNodeSignals）。历史上这里确实是在绕一个 bug ——
 * 早期快照只含顶层网、模块内部节点不恢复，"部分恢复 + 输入变化再收敛"会让深组合链
 * 收敛到错误状态（「数码管改值后显示不更新」的根因）；那个根因已经修掉，所以现在
 * 组合关即使复用也能得到正确结果（差分测试：复用 vs 不复用逐次一致）。
 *
 * 沙盒未知是否含时序电路，按「可能有」处理（保住玩家搭的锁存器跨点击状态）。
 */
export function shouldReuseSimState(level: Level | null, gameMode: GameMode): boolean {
  if (gameMode === 'free') return true;
  if (!level) return true;
  return level.mode === 'timing' || level.unlock?.kind === 'seq';
}
