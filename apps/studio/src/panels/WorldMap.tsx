/**
 * 关卡地图（选关界面）：23 关按章节排成蛇形的「检修之路」。
 *
 * 连线画在 SVG 里，每个关卡节点是叠在上面的 <button>（可点击、可键盘、可禁用）：
 * 状态 🔒 未解锁 / 📄 新单 / 🔧 进行中 / ★ 已通关。前一关真通关才点亮下一关；
 * 点节点进入工作台（新单弹委托，进行中/已通关直接继续）。
 * 每章最多两行蛇形（6 个一行），坐标按关卡总数动态生成。
 */

import { ALL_LEVELS } from '@lc/content';
import { type Level, type LogicFamily, levelViewOf } from '@lc/schema';
import { isCleared, isLevelUnlocked, type Progress, rankOf } from '../level/progress';

export interface WorldMapProps {
  progress: Progress;
  /** 玩家契约：教学关按契约显示对应工艺内容（CMOS 契约显示「认识 MOS」等） */
  family: LogicFamily;
  currentLevelId: string;
  onPick: (levelId: string) => void;
  onBack: () => void;
}

/** 每行最多 6 个节点；行高 140，viewBox 高 760 容得下 4 行 */
const PER_ROW = 6;
const ROW_Y = [120, 260, 420, 580];

/** 蛇形坐标：每章内部从左上开始，偶数行从左到右、奇数行从右到左 */
function nodePositions(): Array<{ x: number; y: number }> {
  const pos: Array<{ x: number; y: number }> = [];
  const byStage = new Map<number, Level[]>();
  for (const level of ALL_LEVELS) {
    const list = byStage.get(level.stage);
    if (list) list.push(level);
    else byStage.set(level.stage, [level]);
  }
  let row = 0;
  let idx = 0;
  for (const levels of byStage.values()) {
    const rows = Math.ceil(levels.length / PER_ROW);
    for (let rr = 0; rr < rows; rr++) {
      const count = Math.min(PER_ROW, levels.length - rr * PER_ROW);
      const y = ROW_Y[row] ?? 120 + row * 140;
      for (let c = 0; c < count; c++) {
        const i = rr % 2 === 0 ? c : count - 1 - c; // 奇数行蛇形往回
        pos[idx] = { x: 120 + i * 156, y };
        idx++;
      }
      row++;
    }
  }
  return pos;
}

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
  family,
  currentLevelId,
  onPick,
  onBack,
}: WorldMapProps): React.JSX.Element {
  const NODE_POS = nodePositions();
  const rank = rankOf(progress);
  const cleared = ALL_LEVELS.filter((l) => isCleared(progress, l.id)).length;
  // 章节标题放在该章第一行的上方（第一章 11 关占 2 行，后两章各 1 行）
  const stageTitleY = (stage: number): number => {
    let row = 0;
    for (const s of [1, 2, 3]) {
      const count = ALL_LEVELS.filter((l) => l.stage === s).length;
      if (s === stage) return ROW_Y[row] - 60;
      row += Math.ceil(count / PER_ROW);
    }
    return 60;
  };
  return (
    <div className="screen screen-map">
      <header className="map-head">
        <button type="button" className="map-back" onClick={onBack}>
          ← 返回主菜单
        </button>
        <h1>关卡地图</h1>
        <span className="map-stats">
          已通关 {cleared}/{ALL_LEVELS.length} · 称号 {rank.title}
        </span>
      </header>
      <div className="map-stage">
        <svg className="map-svg" viewBox="0 0 960 760" role="img" aria-label="关卡连线">
          <text x={80} y={stageTitleY(1)} className="stage-title">
            第一章 · 元件入门与基础门电路
          </text>
          <text x={80} y={stageTitleY(2)} className="stage-title">
            第二章 · 时序电路
          </text>
          <text x={80} y={stageTitleY(3)} className="stage-title">
            第三章 · 算术与存储
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
          const view = levelViewOf(level, family); // 教学关按契约换显示内容（id 不变）
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
                top: `${((pos?.y ?? 0) / 760) * 100}%`,
              }}
              disabled={!unlocked}
              onClick={() => onPick(level.id)}
              title={`${view.title}（${STATE_LABEL[state]}）`}
            >
              <span className="node-num">{i + 1}</span>
              <span className="node-title">{view.title}</span>
              <span className="node-stars">
                {level.classroom && state === 'cleared'
                  ? '✓ 已掌握'
                  : stars > 0
                    ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`
                    : STATE_ICON[state]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
