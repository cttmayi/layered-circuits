/**
 * 关卡地图（选关界面）：13 关排成一条蛇形的「检修之路」。
 *
 * 连线画在 SVG 里，每个关卡节点是叠在上面的 <button>（可点击、可键盘、可禁用）：
 * 状态 🔒 未解锁 / 📄 新单 / 🔧 进行中 / ★ 已通关。前一关真通关才点亮下一关；
 * 点节点进入工作台（新单弹委托，进行中/已通关直接继续）。
 */

import { ALL_LEVELS } from '@lc/content';
import type { Level } from '@lc/schema';
import { isCleared, isLevelUnlocked, type Progress, rankOf, reconCount } from '../level/progress';

export interface WorldMapProps {
  progress: Progress;
  currentLevelId: string;
  onPick: (levelId: string) => void;
  onBack: () => void;
}

/** 13 个节点的蛇形坐标（viewBox 960×560） */
const NODE_POS: Array<{ x: number; y: number }> = [
  { x: 120, y: 120 },
  { x: 320, y: 120 },
  { x: 520, y: 120 },
  { x: 720, y: 120 },
  { x: 900, y: 120 },
  { x: 900, y: 300 },
  { x: 720, y: 300 },
  { x: 520, y: 300 },
  { x: 320, y: 300 },
  { x: 120, y: 300 },
  { x: 120, y: 470 },
  { x: 320, y: 470 },
  { x: 520, y: 470 },
];

function stateOf(progress: Progress, level: Level): 'locked' | 'new' | 'working' | 'cleared' {
  if (isCleared(progress, level.id)) return 'cleared';
  if (!isLevelUnlocked(progress, level.id)) return 'locked';
  if (progress.started?.[level.id]) return 'working';
  return 'new';
}

const STATE_LABEL: Record<string, string> = {
  locked: '未解锁',
  new: '新单',
  working: '进行中',
  cleared: '已通关',
};

const STATE_ICON: Record<string, string> = { locked: '🔒', new: '📄', working: '🔧', cleared: '★' };

/** 折线路径：连相邻两个节点（蛇形拐弯处直接走直角） */
function pathBetween(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const mx = (a.x + b.x) / 2;
  return `M ${a.x} ${a.y} L ${mx} ${a.y} L ${mx} ${b.y} L ${b.x} ${b.y}`;
}

export function WorldMap({
  progress,
  currentLevelId,
  onPick,
  onBack,
}: WorldMapProps): React.JSX.Element {
  const rank = rankOf(progress);
  const cleared = ALL_LEVELS.filter((l) => isCleared(progress, l.id)).length;
  return (
    <div className="screen screen-map">
      <header className="map-head">
        <button type="button" className="map-back" onClick={onBack}>
          ← 返回主菜单
        </button>
        <h1>关卡地图</h1>
        <span className="map-stats">
          已通关 {cleared}/{ALL_LEVELS.length} · 称号 {rank.title} · 自主测绘 {reconCount(progress)}
        </span>
      </header>
      <div className="map-stage">
        <svg className="map-svg" viewBox="0 0 960 560" role="img" aria-label="关卡连线">
          <text x={80} y={60} className="stage-title">
            第一章 · 基础门电路
          </text>
          <text x={80} y={240} className="stage-title">
            第二章 · 时序电路
          </text>
          {ALL_LEVELS.slice(1).map((level, i) => {
            const from = NODE_POS[i];
            const to = NODE_POS[i + 1];
            const unlocked = isLevelUnlocked(progress, (ALL_LEVELS[i] as Level).id);
            return (
              <path
                key={`edge-${level.id}`}
                d={pathBetween(from as { x: number; y: number }, to as { x: number; y: number })}
                className={unlocked ? 'map-edge on' : 'map-edge'}
              />
            );
          })}
        </svg>
        {ALL_LEVELS.map((level, i) => {
          const pos = NODE_POS[i];
          const state = stateOf(progress, level);
          const unlocked = state !== 'locked';
          const stars = progress.cleared[level.id]?.stars ?? 0;
          return (
            <button
              key={level.id}
              type="button"
              className={`map-node-btn ${state}${currentLevelId === level.id ? ' current' : ''}`}
              style={{
                left: `${((pos?.x ?? 0) / 960) * 100}%`,
                top: `${((pos?.y ?? 0) / 560) * 100}%`,
              }}
              disabled={!unlocked}
              onClick={() => onPick(level.id)}
              title={`${level.title}（${STATE_LABEL[state]}）`}
            >
              <span className="node-num">{i + 1}</span>
              <span className="node-title">{level.title}</span>
              <span className="node-stars">
                {stars > 0 ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}` : STATE_ICON[state]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
