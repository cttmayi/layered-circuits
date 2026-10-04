/**
 * 主菜单（开场）：启动先进这里，而不是直接掉进工作台。
 *
 * 四条路：继续上次（有进行中的单子）/ 关卡模式（进关卡地图）/ 知识卡片（认识元件图鉴，
 * 自由搭建（直接进沙盒）。模式在开场选定后不再在工作台里切换 —— 换模式必须回到这里。
 */

import { ALL_LEVELS, TEACH_LEVELS } from '@lc/content';
import { FAMILY_CONTRACTS } from '@lc/schema';
import type { Progress } from '../level/progress';
import { clearedCount, rankOf, reconCount, sideJobCount } from '../level/progress';

export interface MainMenuProps {
  progress: Progress;
  /** 上一会话落在某关且已开工/已通关 → 可以「继续」 */
  canResume: boolean;
  resumeLabel: string;
  onContinue: () => void;
  onLevelMode: () => void;
  onTeachMode: () => void;
  onFreeMode: () => void;
  /** 重头开始：清空存档回主菜单 */
  onNewGame: () => void;
}

export function MainMenu({
  progress,
  canResume,
  resumeLabel,
  onContinue,
  onLevelMode,
  onTeachMode,
  onFreeMode,
  onNewGame,
}: MainMenuProps): React.JSX.Element {
  const rank = rankOf(progress);
  const cleared = clearedCount(progress);
  const total = ALL_LEVELS.length;
  return (
    <div className="screen screen-menu">
      <div className="menu-card">
        <div className="menu-brand">
          <h1>逐层电路</h1>
          <p className="menu-tagline">接单 · 侦察 · 手搭 · 交付 —— 一层一层修出客户要的电路</p>
        </div>
        <div className="menu-actions">
          {canResume && (
            <button type="button" className="menu-btn primary" onClick={onContinue}>
              继续上次 <span className="menu-btn-note">{resumeLabel}</span>
            </button>
          )}
          <button type="button" className="menu-btn" onClick={onLevelMode}>
            关卡模式
            <span className="menu-btn-note">
              {ALL_LEVELS.length} 关委托，逐关解锁 · 元件成本与素材受限
            </span>
          </button>
          <button type="button" className="menu-btn" onClick={onTeachMode}>
            知识卡片
            <span className="menu-btn-note">
              {TEACH_LEVELS.length} 张元件卡片（三极管/二极管/MOS…），随时翻看、不计进度
            </span>
          </button>
          <button type="button" className="menu-btn" onClick={onFreeMode}>
            自由搭建
            <span className="menu-btn-note">沙盒：不限元件成本与素材，练手封装</span>
          </button>
          <button type="button" className="menu-btn new-game" onClick={onNewGame}>
            新游戏
            <span className="menu-btn-note">清空进度与组件库，从头开始</span>
          </button>
        </div>
        <div className="menu-stats">
          <span className="menu-family-stat">
            工艺契约 · {FAMILY_CONTRACTS[progress.family].name}
          </span>
          <span>
            已通关 {cleared}/{total}
          </span>
          <span>称号 · {rank.title}</span>
          <span>可用余额 {(progress.walletHalf - progress.spentHalf) / 2} 元</span>
          <span>自主测绘 {reconCount(progress)}</span>
          <span>支线 {sideJobCount(progress)}</span>
        </div>
      </div>
    </div>
  );
}
