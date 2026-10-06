import { contractOf } from '@lc/content';
import type { Level } from '@lc/schema';
import { useState } from 'react';
import { Modal } from './Modal';
import { SegmentTaskDiagram } from './SegmentDiagram';

export interface LevelCardProps {
  level: Level;
  /** 判定/仿真口径：逻辑版抹平延迟，因此不显示任何延迟数字（默认时序版） */
  mode?: 'logic' | 'timing';
  /** 当前电路成本（半单位） */
  costHalf: number;
}

const CELL: Record<string, string> = { 0: 'lo', 1: 'hi', X: 'bad', Z: 'dim' };

/** 左侧「任务卡」：直接说清任务（+ 图），高频参考；真值表/教学/提示放「任务详情」弹窗。
 * 不做场景话术（委托方/客户叙事一律不出现），任务表达 = 需求 + 图 + 约束。 */
export function LevelCard({ level, costHalf, mode = 'timing' }: LevelCardProps): React.JSX.Element {
  const [showTask, setShowTask] = useState(false);
  const contract = contractOf(level);
  const budget = level.budgetHalf;
  const ratio = budget > 0 ? Math.min(1, costHalf / budget) : 0;
  const over = costHalf > budget;
  const inputNames = [...new Set(level.vectors.flatMap((v) => Object.keys(v.inputs)))];
  const outputNames = [...new Set(level.vectors.flatMap((v) => Object.keys(v.expect ?? {})))];
  const widthOf = new Map(level.ports.map((p) => [p.name, p.width]));
  const showPort = (n: string): string =>
    (widthOf.get(n) ?? 1) > 1 ? `${n}[${(widthOf.get(n) ?? 1) - 1}:0]` : n;

  // 时序关的向量表会出现「同一组输入、输出却不同」的行（保持上一次），
  // 没有说明列就是自相矛盾的表 —— 所以只要有一条向量写了说明就补上这一列。
  const hasNotes = level.vectors.some((v) => v.note);
  const truthTable = (
    <table className="truth">
      <thead>
        <tr>
          {inputNames.map((n) => (
            <th key={n}>{showPort(n)}</th>
          ))}
          {outputNames.map((n) => (
            <th key={n} className="sep">
              {showPort(n)}
            </th>
          ))}
          {hasNotes && <th className="note-col">说明</th>}
        </tr>
      </thead>
      <tbody>
        {level.vectors.map((v, i) => (
          <tr
            // biome-ignore lint/suspicious/noArrayIndexKey: 静态只读向量表，时序关会出现完全相同的行，行号是唯一稳定标识
            key={i}
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
            {hasNotes && <td className="note-col">{v.note ?? ''}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <section className="panel level-card">
      <div className="task-head">
        <h3>任务 · {level.title}</h3>
        <button type="button" className="task-detail-btn" onClick={() => setShowTask(true)}>
          任务详情 ↗
        </button>
      </div>
      <p className="task-brief">{level.brief}</p>
      <SegmentTaskDiagram level={level} />
      {showTask && (
        <Modal title={`任务详情 · ${level.title}`} onClose={() => setShowTask(false)}>
          <div className="task-full">
            <h4>任务</h4>
            <p>{level.brief}</p>
            <SegmentTaskDiagram level={level} />
            {level.teaching && (
              <>
                <h4>教学说明</h4>
                <p>{level.teaching}</p>
              </>
            )}
            {level.hint && (
              <>
                <h4>提示</h4>
                <p>{level.hint}</p>
              </>
            )}
            {!level.classroom && (
              <>
                <h4>合同条款</h4>
                <p>
                  元件成本{' '}
                  {contract.costCap === null ? '按最省结算' : `≤ ${contract.costCap.toFixed(1)} 元`}
                  {mode !== 'logic' &&
                    contract.timingCap !== null &&
                    ` · 传播延迟 ≤ ${contract.timingCap.toFixed(1)} ns`}
                </p>
              </>
            )}
            {!level.classroom && (
              <>
                <h4>真值表</h4>
                {truthTable}
                {mode !== 'logic' && level.timingBudgetPs !== undefined && (
                  <p className="dim small">
                    交付还要求传播延迟 ≤ {(level.timingBudgetPs / 1000).toFixed(2)} ns
                  </p>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
      {!level.classroom && (
        <ul className="contract-list">
          <li>
            <span className="contract-key">元件成本</span>
            <strong className="contract-val">
              {contract.costCap === null ? '按最省结算' : `≤ ${contract.costCap.toFixed(1)} 元`}
            </strong>
          </li>
          {mode !== 'logic' && contract.timingCap !== null && (
            <li>
              <span className="contract-key">传播延迟</span>
              <strong className="contract-val">≤ {contract.timingCap.toFixed(1)} ns</strong>
            </li>
          )}
        </ul>
      )}
      {level.requiredUnits.length > 0 && (
        <p className="dim small required-units">
          本单要求：必须用{' '}
          {level.requiredUnits
            .map(
              (u) =>
                ({
                  npn: '三极管',
                  res: '电阻',
                  dio: '二极管',
                  cap: '电容',
                  nmos: 'N-MOS',
                  pmos: 'P-MOS',
                })[u] ?? u,
            )
            .join('、')}{' '}
          —— 它才是这关要教的主角
        </p>
      )}
      {level.guideSteps.length > 0 && (
        <div className="guide-steps">
          <div className="guide-title">🧭 动手搭 · 跟着做</div>
          <ol>
            {level.guideSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="budget">
        <div className="budget-bar">
          <span
            className={over ? 'budget-fill over' : 'budget-fill'}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <div className="budget-text">
          <span>
            材料费 <strong className={over ? 'bad' : 'hi'}>{costHalf / 2}</strong>
            {/* 知识卡片不接单：说「上限」而不是订单话术的「款项」 */}
            {level.classroom ? '，上限 ' : ' / 款项 '}
            {budget / 2}
          </span>
          <span className="dim">
            {level.classroom ? '参考解 ' : '对标 '}
            {level.optimalHalf / 2}
          </span>
        </div>
      </div>
    </section>
  );
}
