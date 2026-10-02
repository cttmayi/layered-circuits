import type { Level } from '@lc/schema';
import type { GameMode } from '../level/session';

/**
 * 是否在连续仿真间复用上次终态（prevSignals/prevContribs）。
 *
 * 时序关卡（锁存器/寄存器：mode='timing' 或 unlock.kind='seq'）必须复用，才能在
 * 多次仿真之间保持状态（点按钮、换输入时锁存器不丢位）。
 *
 * 组合关卡没有记忆，复用反而有害：快照只含顶层网（模块内部节点不恢复），
 * 「部分恢复 + 输入变化再收敛」时，深组合链会收敛到错误状态——这是
 * 「数码管改值后显示不更新」的根因。组合关直接每次全量重算（上电默认起步），
 * 结果确定且正确。
 *
 * 沙盒未知是否含时序电路，按「可能有」处理（保住玩家搭的锁存器跨点击状态）。
 */
export function shouldReuseSimState(level: Level | null, gameMode: GameMode): boolean {
  if (gameMode !== 'level') return true;
  if (!level) return true;
  return level.mode === 'timing' || level.unlock?.kind === 'seq';
}
