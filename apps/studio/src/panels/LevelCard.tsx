import type { Level } from '@lc/schema';
import { useState } from 'react';

export interface LevelCardProps {
  level: Level;
  /** 当前电路成本（半单位） */
  costHalf: number;
  onShowHint: () => void;
}

const CELL: Record<string, string> = { 0: 'lo', 1: 'hi', X: 'bad', Z: 'dim' };

/** 左侧「本关目标」卡片：目标说明 + 教学点 + 目标真值表 + 预算进度 */
export function LevelCard({ level, costHalf, onShowHint }: LevelCardProps): React.JSX.Element {
  const [showTeaching, setShowTeaching] = useState(false);
  const budget = level.budgetHalf;
  const ratio = budget > 0 ? Math.min(1, costHalf / budget) : 0;
  const over = costHalf > budget;
  const inputNames = [...new Set(level.vectors.flatMap((v) => Object.keys(v.inputs)))];
  const outputNames = [...new Set(level.vectors.flatMap((v) => Object.keys(v.expect ?? {})))];

  return (
    <section className="panel level-card">
      <h3>第 1 阶段 · {level.title}</h3>
      <p className="small">{level.brief}</p>

      <div className="budget">
        <div className="budget-bar">
          <span
            className={over ? 'budget-fill over' : 'budget-fill'}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <div className="budget-text">
          <span>
            成本 <strong className={over ? 'bad' : 'hi'}>{costHalf / 2}</strong> / 预算 {budget / 2}
          </span>
          <span className="dim">最优 {level.optimalHalf / 2}</span>
        </div>
      </div>

      <table className="truth">
        <thead>
          <tr>
            {inputNames.map((n) => (
              <th key={n}>{n}</th>
            ))}
            {outputNames.map((n) => (
              <th key={n} className="sep">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {level.vectors.map((v) => (
            <tr
              key={`${inputNames.map((n) => String(v.inputs[n])).join('')}-${outputNames.map((n) => String(v.expect?.[n])).join('')}`}
            >
              {inputNames.map((n) => (
                <td key={n} className={CELL[String(v.inputs[n])] ?? ''}>
                  {String(v.inputs[n])}
                </td>
              ))}
              {outputNames.map((n) => (
                <td key={n} className={`sep ${CELL[String(v.expect?.[n])] ?? ''}`}>
                  {String(v.expect?.[n])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="group-row">
        <button type="button" onClick={() => setShowTeaching((v) => !v)}>
          {showTeaching ? '收起原理' : '原理讲解'}
        </button>
        <button type="button" onClick={onShowHint}>
          提示
        </button>
      </div>
      {showTeaching && <p className="small teaching">{level.teaching}</p>}
      {level.timingBudgetPs !== undefined && (
        <p className="dim small">
          硬核模式还要求关键路径 ≤ {(level.timingBudgetPs / 1000).toFixed(2)} ns
        </p>
      )}
    </section>
  );
}
