/**
 * 教学关「元件课堂」概念卡：进教学关先讲课后搭电路。
 *
 * 与正式关的差别就在这里 —— 正式关直接给委托单干活；教学关先给
 * 元件图 + 生活类比 + 要点，点「去搭一下试试」才进工作台（半成品）。
 */

import type { Level } from '@lc/schema';

export interface ClassroomModalProps {
  level: Level;
  onStart: () => void;
}

/** 元件示意图：用字符拼一张小图，避免引入图片资源（高中生友好、离线可用） */
function unitArt(level: Level): string {
  if (level.id === 's1-npn') {
    return [
      '    VCC(集电极 c)',
      '        │',
      '  b(基极)─┤ NPN ┤',
      '        │',
      '    GND(发射极 e)',
    ].join('\n');
  }
  if (level.id === 's1-dio') {
    return ['  a(阳极) ──▶|── k(阴极)', '   只许电流往右走'].join('\n');
  }
  return ['  VCC ──(电阻)── y(输出)', '  没人驱动时默认 1'].join('\n');
}

export function ClassroomModal({ level, onStart }: ClassroomModalProps): React.JSX.Element {
  const room = level.classroom;
  if (!room) return <></>;
  return (
    <div className="modal-backdrop" role="dialog" aria-label="元件课堂">
      <div className="modal-box classroom-box">
        <h2>元件课堂 · {room.title}</h2>
        <pre className="classroom-art">{unitArt(level)}</pre>
        <p className="classroom-analogy">{room.analogy}</p>
        <ul className="classroom-points">
          {room.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" className="primary" onClick={onStart}>
            去搭一下试试 →
          </button>
        </div>
      </div>
    </div>
  );
}
