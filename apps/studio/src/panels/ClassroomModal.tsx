/**
 * 教学关「元件课堂」概念卡：进教学关先讲课后搭电路。
 *
 * 与正式关的差别就在这里 —— 正式关直接给委托单干活；教学关先给
 * 元件示意图（SVG 原理图）+ 生活类比 + 要点，点「去搭一下试试」才进工作台（半成品）。
 */

import type { Level, LogicFamily } from '@lc/schema';
import { ComponentDiagram } from './ComponentDiagram';

export interface ClassroomModalProps {
  level: Level;
  /** 玩家契约：CMOS 契约下「认识三极管」显示 N-MOS 图、「认识二极管」显示 P-MOS 图 */
  family: LogicFamily;
  onStart: () => void;
}

export function ClassroomModal({
  level,
  family,
  onStart,
}: ClassroomModalProps): React.JSX.Element | null {
  const room = level.classroom;
  if (!room) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-label="元件课堂">
      <div className="modal-box classroom-box">
        <h2>元件课堂 · {room.title}</h2>
        <div className="classroom-diagram">
          <ComponentDiagram level={level} family={family} />
        </div>
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
