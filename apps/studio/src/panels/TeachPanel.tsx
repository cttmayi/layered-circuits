/**
 * 教学模式：元件图鉴（认识各个元件）。
 *
 * 与关卡模式并列：TEACH_LEVELS 里的教学关（三极管/二极管/悬空与默认电平/CMOS 反相器/
 * CMOS 与非门）以卡片墙展示——概念卡标题、类比、要点摘要 + 「已掌握」标记。
 * 点卡片进引导搭建（enterLevel → gameMode 'teach'）；不评星、不参与关卡解锁链。
 */

import { TEACH_LEVELS } from '@lc/content';
import { type LogicFamily, levelViewOf } from '@lc/schema';
import { isCleared, type Progress } from '../level/progress';

export interface TeachPanelProps {
  progress: Progress;
  /** 玩家契约：教学关按契约显示对应工艺内容（CMOS 契约显示「认识 MOS」等） */
  family: LogicFamily;
  currentLevelId: string;
  onPick: (levelId: string) => void;
  onBack: () => void;
}

export function TeachPanel({
  progress,
  family,
  currentLevelId,
  onPick,
  onBack,
}: TeachPanelProps): React.JSX.Element {
  const mastered = TEACH_LEVELS.filter((level) => isCleared(progress, level.id)).length;
  return (
    <div className="screen screen-map">
      <header className="map-head">
        <button type="button" className="map-back" onClick={onBack}>
          ← 返回主菜单
        </button>
        <h1>教学模式 · 认识元件</h1>
        <span className="map-stats">
          已掌握 {mastered}/{TEACH_LEVELS.length} · 与关卡模式并列，不评星、不占关卡进度
        </span>
      </header>
      <div className="teach-stage">
        <div className="teach-grid">
          {TEACH_LEVELS.map((level) => {
            const view = levelViewOf(level, family); // 契约变体（CMOS 契约显示「认识 MOS」等）
            const card = level.classroom;
            const masteredNow = isCleared(progress, level.id);
            return (
              <button
                key={level.id}
                type="button"
                className={`teach-card${masteredNow ? ' mastered' : ''}${
                  currentLevelId === level.id ? ' current' : ''
                }`}
                onClick={() => onPick(level.id)}
              >
                <span className="teach-card-title">{view.title}</span>
                {card && (
                  <>
                    <span className="teach-card-analogy">{card.analogy}</span>
                    <ul className="teach-card-points">
                      {card.points.slice(0, 2).map((point, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: 概念卡要点是静态只读展示列表（无增删/排序），用内容做 key 反而会因重复文案触发 React 警告
                        <li key={i}>{point}</li>
                      ))}
                    </ul>
                  </>
                )}
                <span className="teach-card-state">
                  {masteredNow ? '✓ 已掌握' : '点开动手试试'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
