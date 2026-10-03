/**
 * 7 段数码管任务图：用图直接表达「BCD → 哪几根段线亮」，
 * 替代「委托方/场景」话术——段码关（s3-display / s3-seg-de / s3-seg-fg）的
 * 输入输出一眼可读：0-9 每个数字下，本关的段线谁亮谁灭。
 */

import type { Level } from '@lc/schema';

const SEGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;

/** 段位坐标（viewBox 0 0 100 160） */
const BOX: Record<string, { x: number; y: number; w: number; h: number }> = {
  a: { x: 26, y: 6, w: 48, h: 10 },
  b: { x: 74, y: 12, w: 10, h: 40 },
  c: { x: 74, y: 108, w: 10, h: 40 },
  d: { x: 26, y: 144, w: 48, h: 10 },
  e: { x: 16, y: 108, w: 10, h: 40 },
  f: { x: 16, y: 12, w: 10, h: 40 },
  g: { x: 26, y: 70, w: 48, h: 10 },
};

/** 段线中心（放字母标注用） */
const LABEL_AT: Record<string, { x: number; y: number; anchor: 'middle' | 'end' | 'start' }> = {
  a: { x: 50, y: 15, anchor: 'middle' },
  b: { x: 88, y: 35, anchor: 'start' },
  c: { x: 88, y: 131, anchor: 'start' },
  d: { x: 50, y: 154, anchor: 'middle' },
  e: { x: 12, y: 131, anchor: 'end' },
  f: { x: 12, y: 35, anchor: 'end' },
  g: { x: 50, y: 80, anchor: 'middle' },
};

const ON = '#ffb454';
const OFF = '#2a3642';

/** 单个 7 段数码管（SVG）。
 * 默认只画 `lit`（+`labels`）里的段线——数字格只出现本关的输出段，亮灭对比无歧义；
 * `full` 时画完整 7 段轮廓（供图例标注段位）。 */
export function SegmentGlyph({
  lit,
  size = 44,
  labels,
  full = false,
}: {
  lit: Record<string, boolean>;
  size?: number;
  labels?: string[];
  full?: boolean;
}): React.JSX.Element {
  const keys = full ? SEGS : [...new Set([...Object.keys(lit), ...(labels ?? [])])];
  return (
    <svg width={size} height={size * 1.6} viewBox="0 0 100 160" aria-hidden="true">
      {keys.map((s) => (
        <rect
          key={s}
          x={BOX[s].x}
          y={BOX[s].y}
          width={BOX[s].w}
          height={BOX[s].h}
          rx={2.5}
          fill={lit[s] ? ON : OFF}
        />
      ))}
      {(labels ?? []).map((s) => (
        <text
          key={s}
          x={LABEL_AT[s].x}
          y={LABEL_AT[s].y}
          textAnchor={LABEL_AT[s].anchor}
          fontSize={13}
          fontWeight={600}
          fill="#d9a95c"
        >
          {s}
        </text>
      ))}
    </svg>
  );
}

/** 本关输出的段线（单 bit 端口 a-g） */
function outputSegs(level: Level): string[] {
  return SEGS.filter((s) => level.ports.some((p) => p.name === s && p.dir === 'out'));
}

/**
 * 段码任务图：段位标注 + 0-9 数字各自点亮的段线。
 * 只画本关的输出段线（未输出的段不画），未点亮用暗色描边区分。
 */
export function SegmentTaskDiagram({ level }: { level: Level }): React.JSX.Element | null {
  const segs = outputSegs(level);
  if (segs.length === 0) return null;
  const rows = level.vectors
    .map((v) => {
      const b = (k: string): number => Number(v.inputs[k] ?? 0);
      const digit = b('bcd0') | (b('bcd1') << 1) | (b('bcd2') << 2) | (b('bcd3') << 3);
      if (!Number.isFinite(digit)) return null;
      const lit: Record<string, boolean> = {};
      for (const s of segs) lit[s] = (v.expect?.[s] ?? 0) === 1;
      return { digit, lit };
    })
    .filter((r): r is { digit: number; lit: Record<string, boolean> } => r !== null)
    .sort((a, b) => a.digit - b.digit);
  const posText = segs
    .map(
      (s) =>
        ({ a: '顶横', b: '右上竖', c: '右下竖', d: '底横', e: '左下竖', f: '左上竖', g: '中横' })[
          s
        ],
    )
    .join(' · ');
  return (
    <div className="seg-task">
      <div className="seg-task-title">
        目标：4 位 BCD → 段线亮灭
        <span className="seg-task-pos">{posText}</span>
      </div>
      <div className="seg-row">
        {rows.map((r) => (
          <div key={r.digit} className="seg-cell" title={`数字 ${r.digit}`}>
            <SegmentGlyph lit={r.lit} size={26} />
            <span className="seg-digit">{r.digit}</span>
          </div>
        ))}
      </div>
      <div className="seg-legend">
        <SegmentGlyph lit={{}} size={30} labels={segs} full />
        <span className="seg-legend-text">
          段位 {segs.join('·')}（本关要搭的 {segs.length} 条段线）
        </span>
      </div>
    </div>
  );
}
