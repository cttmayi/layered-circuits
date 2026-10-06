/**
 * 关卡地图（选关界面）：32 关按章节排成一条连续蛇形的「检修之路」。
 *
 * 连线画在 SVG 里，每个关卡节点是叠在上面的 <button>（可点击、可键盘、可禁用）：
 * 状态 🔒 未解锁 / 📄 新单 / 🔧 进行中 / ★ 已通关。前一关真通关才点亮下一关；
 * 点节点进入工作台（新单弹委托，进行中/已通关直接继续）。
 * 全表一条蛇形（桌面/横屏每行 6 个节点），保证任意相邻关卡（含跨章）都水平或垂直
 * 相邻 —— 不会出现横穿整幅地图的对角折线；章节标题浮动在各章首关上方。
 * SVG 高度按总行数动态生成，超出屏幕时地图区上下滚动。
 *
 * 竖屏手机（窄屏 + 高 ≥ 宽）排 3 列（见 PORTRAIT_PER_ROW）：容器只有 360~430px 宽，
 * 6 列会被压到 0.4 倍、列距只剩约 63px < 96px 的节点 —— 节点互相压住，而且必须横向滚动。
 * 3 列配 480 单位的画布宽度 → 缩放 0.75~0.9，列距 117~140px、行距 105~126px，都大于
 * 96px 节点：整幅地图放进屏宽（不横滑），纵向变长交给地图区自己上下滚动。
 */

import { ALL_LEVELS } from '@lc/content';
import { type Level, type LogicFamily, levelViewOf } from '@lc/schema';
import { usePortraitNarrow } from '../layout/viewport';
import { isCleared, isLevelUnlocked, type Progress, rankOf } from '../level/progress';

export interface WorldMapProps {
  progress: Progress;
  /** 玩家契约：教学关按契约显示对应工艺内容（CMOS 契约显示「认识 MOS」等） */
  family: LogicFamily;
  currentLevelId: string;
  onPick: (levelId: string) => void;
  onBack: () => void;
}

/** 桌面 / 横屏手机每行最多 6 个节点：画布宽 960（viewBox 单位）、首列 x=120、列距 156 */
const PER_ROW = 6;
const VIEW_W = 960;
const X0 = 120;
const COL_GAP = 156;
/** 竖屏：3 列 + 480 单位的画布宽度（账见文件头注释） */
const PORTRAIT_PER_ROW = 3;
const PORTRAIT_VIEW_W = 480;
/** 行高 140；首行 y=120，底部留白 40 */
const ROW_TOP = 120;
const ROW_GAP = 140;
const BOTTOM_PAD = 40;

/** 按每行节点数算出总行数（一条蛇形） */
function totalRows(perRow: number): number {
  return Math.ceil(ALL_LEVELS.length / perRow);
}

/** 蛇形坐标：全部关卡一条连续蛇形，偶数行从左到右、奇数行从右到左。
 *  相邻关卡（含跨章）必定水平或垂直相邻 —— 不断线。
 *  6 列沿用最早的 `X0 + i * COL_GAP`（桌面一个像素都不动）；3 列改成按画布宽度居中，
 *  否则整条蛇形会偏在左边、右边空出一大块。 */
function nodePositions(perRow: number, viewW: number): Array<{ x: number; y: number }> {
  const pos: Array<{ x: number; y: number }> = [];
  const rows = totalRows(perRow);
  for (let rr = 0; rr < rows; rr++) {
    const count = Math.min(perRow, ALL_LEVELS.length - rr * perRow);
    const y = ROW_TOP + rr * ROW_GAP;
    for (let c = 0; c < count; c++) {
      const i = rr % 2 === 0 ? c : count - 1 - c; // 奇数行蛇形往回
      const x =
        perRow === PER_ROW ? X0 + i * COL_GAP : viewW / 2 + (i - (perRow - 1) / 2) * COL_GAP;
      pos[rr * perRow + c] = { x, y };
    }
  }
  return pos;
}

/** 章节标题位置：浮动到该章首关节点的左上方 */
function stageTitlePos(
  stage: number,
  NODE_POS: Array<{ x: number; y: number }>,
): { x: number; y: number } {
  const idx = ALL_LEVELS.findIndex((l) => l.stage === stage);
  const p = NODE_POS[idx];
  return p ? { x: p.x - 40, y: p.y - 60 } : { x: 80, y: 60 };
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
  // 竖屏窄屏排 3 列、画布宽 480；桌面与横屏手机排 6 列、画布宽 960（数值与视口一样逐字不变）
  const portrait = usePortraitNarrow();
  const perRow = portrait ? PORTRAIT_PER_ROW : PER_ROW;
  const viewW = portrait ? PORTRAIT_VIEW_W : VIEW_W;
  const NODE_POS = nodePositions(perRow, viewW);
  const VIEW_H = ROW_TOP + totalRows(perRow) * ROW_GAP + BOTTOM_PAD;
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
          已通关 {cleared}/{ALL_LEVELS.length} · 称号 {rank.title}
        </span>
      </header>
      <div className="map-stage">
        <div className="map-canvas">
          <svg
            className="map-svg"
            viewBox={`0 0 ${viewW} ${VIEW_H}`}
            style={{ aspectRatio: `${viewW} / ${VIEW_H}` }}
            role="img"
            aria-label="关卡连线"
          >
            {([1, 2, 3] as const).map((st) => {
              const p = stageTitlePos(st, NODE_POS);
              return (
                <text key={st} x={p.x} y={p.y} className="stage-title">
                  {st === 1
                    ? '第一章 · 元件入门与基础门电路'
                    : st === 2
                      ? '第二章 · 时序电路'
                      : '第三章 · 算术与存储'}
                </text>
              );
            })}
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
                  left: `${((pos?.x ?? 0) / viewW) * 100}%`,
                  top: `${((pos?.y ?? 0) / VIEW_H) * 100}%`,
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
    </div>
  );
}
