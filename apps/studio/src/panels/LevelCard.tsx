import { commissionOf, contractOf } from '@lc/content';
import type { Level } from '@lc/schema';
import { useState } from 'react';
import { Modal } from './Modal';

export interface LevelCardProps {
  level: Level;
  /** 当前电路成本（半单位） */
  costHalf: number;
}

const CELL: Record<string, string> = { 0: 'lo', 1: 'hi', X: 'bad', Z: 'dim' };

/** 左侧「图纸卡」：图纸（真值表）+ 合同摘要 + 用料进度 —— 搭建时的高频参考。
 * 需求真值表完全展示（不做黑盒隐藏）；委托方/需求正文在卡片上只压 2 行，
 * 点「委托单」弹窗可看完整需求、教学说明与提示。 */
export function LevelCard({ level, costHalf }: LevelCardProps): React.JSX.Element {
  const [showCommission, setShowCommission] = useState(false);
  const contract = contractOf(level);
  const commission = commissionOf(level);
  const budget = level.budgetHalf;
  const ratio = budget > 0 ? Math.min(1, costHalf / budget) : 0;
  const over = costHalf > budget;
  const inputNames = [...new Set(level.vectors.flatMap((v) => Object.keys(v.inputs)))];
  const outputNames = [...new Set(level.vectors.flatMap((v) => Object.keys(v.expect ?? {})))];
  const widthOf = new Map(level.ports.map((p) => [p.name, p.width]));
  const showPort = (n: string): string =>
    (widthOf.get(n) ?? 1) > 1 ? `${n}[${(widthOf.get(n) ?? 1) - 1}:0]` : n;

  return (
    <section className="panel level-card">
      <h3>委托单 · {level.title}</h3>
      <button
        type="button"
        className="commission-toggle"
        onClick={() => setShowCommission(true)}
        aria-label={`查看委托详情 · ${level.title}`}
      >
        <span className="commission-client">
          <span className="client-tag">委托方</span>
          <span className="commission-note">
            {commission.client} —— 「{commission.note}」
          </span>
          <span className="commission-more">查看全文 ↗</span>
        </span>
      </button>
      {showCommission && (
        <Modal title={`委托详情 · ${level.title}`} onClose={() => setShowCommission(false)}>
          <div className="commission-full">
            <p className="commission-full-client">
              <span className="client-tag">委托方</span>
              <strong>{commission.client}</strong>
            </p>
            <h4>需求</h4>
            <p>{commission.note}</p>
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
                  {contract.timingCap !== null &&
                    ` · 传播延迟 ≤ ${contract.timingCap.toFixed(1)} ns`}
                </p>
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
          {contract.timingCap !== null && (
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
            材料费 <strong className={over ? 'bad' : 'hi'}>{costHalf / 2}</strong> / 款项{' '}
            {budget / 2}
          </span>
          <span className="dim">对标 {level.optimalHalf / 2}</span>
        </div>
      </div>

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

      {!level.classroom && level.timingBudgetPs !== undefined && (
        <p className="dim small">
          硬核模式还要求传播延迟 ≤ {(level.timingBudgetPs / 1000).toFixed(2)} ns
        </p>
      )}
    </section>
  );
}
