/**
 * 知识卡片：元件图鉴（认识各个元件）。
 *
 * 与关卡模式并列：TEACH_LEVELS 里的内容（三极管/二极管/悬空与默认电平/CMOS 反相器/
 * CMOS 与非门）以卡片墙展示——概念卡标题、类比、要点摘要。
 * 点卡片进引导搭建（enterLevel → gameMode 'teach'）：**不算关卡、不计进度与成绩**，
 * 也不参与关卡解锁链；对上了只给一句反馈，没有结算页、没有星。
 */

import { TEACH_LEVELS } from '@lc/content';
import { type LogicFamily, levelViewOf } from '@lc/schema';
import { ComponentDiagram } from './ComponentDiagram';

export interface TeachPanelProps {
  /** 玩家契约：卡片按契约显示对应工艺内容（CMOS 契约显示「认识 MOS」等） */
  family: LogicFamily;
  currentLevelId: string;
  onPick: (levelId: string) => void;
  onBack: () => void;
}

export function TeachPanel({
  family,
  currentLevelId,
  onPick,
  onBack,
}: TeachPanelProps): React.JSX.Element {
  return (
    <div className="screen screen-map">
      <header className="map-head">
        <button type="button" className="map-back" onClick={onBack}>
          ← 返回主菜单
        </button>
        <h1>知识卡片 · 认识元件</h1>
        <span className="map-stats">
          {TEACH_LEVELS.length} 张卡片 · 随时翻看，不算关卡、不计进度与成绩
        </span>
      </header>
      <div className="teach-stage">
        <div className="teach-grid">
          {TEACH_LEVELS.map((level) => {
            const view = levelViewOf(level, family); // 契约变体（CMOS 契约显示「认识 MOS」等）
            const card = level.classroom;
            return (
              <button
                key={level.id}
                type="button"
                className={`teach-card${currentLevelId === level.id ? ' current' : ''}`}
                onClick={() => onPick(level.id)}
              >
                <ComponentDiagram level={view} family={family} compact />
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
                <span className="teach-card-state">点开动手试试</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
