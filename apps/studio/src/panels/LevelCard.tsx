import { commissionOf, contractOf } from '@lc/content';
import type { Level } from '@lc/schema';
import { useState } from 'react';
import { sideJobsOf } from '../level/sideJobs';

export interface LevelCardProps {
  level: Level;
  /** 当前电路成本（半单位） */
  costHalf: number;
  /** 黑盒侦察是否已完成（未完成时图纸的输出列是看不清的） */
  reconDone: boolean;
  /** 当前接的支线单（null = 只做主线） */
  sideJob: string | null;
  /** 打开黑盒侦察对话框（图纸还没测出来时的入口） */
  onOpenRecon: () => void;
  /** 已完成的支线单 key 列表 */
  doneSideJobs: string[];
  onPickSideJob: (key: string | null) => void;
  onShowHint: () => void;
}

const CELL: Record<string, string> = { 0: 'lo', 1: 'hi', X: 'bad', Z: 'dim' };

/** 左侧「图纸卡」：图纸（真值表）+ 合同摘要 + 用料进度 —— 搭建时的高频参考。
 * 客户/需求/原理等叙事内容只在「新委托」弹窗里出现，开工后不再占用侧栏。 */
export function LevelCard({
  level,
  costHalf,
  reconDone,
  sideJob,
  doneSideJobs,
  onOpenRecon,
  onPickSideJob,
  onShowHint,
}: LevelCardProps): React.JSX.Element {
  const [showTeaching, setShowTeaching] = useState(false);
  const contract = contractOf(level);
  const commission = commissionOf(level);
  const jobs = sideJobsOf(level);
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
      <p className="commission-client">
        <span className="client-tag">委托方</span>
        <span>{commission.client}</span> —— 「{commission.note}」
      </p>
      <p className="contract-summary">
        款项 {contract.pay} · 交期 {contract.deadline} · 禁忌 {contract.taboo}
      </p>
      {level.requiredUnits.length > 0 && (
        <p className="dim small required-units">
          本单要求：必须用{' '}
          {level.requiredUnits
            .map((u) => ({ npn: '三极管', res: '电阻', dio: '二极管', cap: '电容' })[u] ?? u)
            .join('、')}{' '}
          —— 它才是这关要教的主角
        </p>
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

      {!reconDone && (
        <p className="dim small">图纸折角了：输出列看不清 —— 去下面的「黑盒侦察」自己测出来。</p>
      )}
      <table className="truth" key={reconDone ? 'open' : 'masked'}>
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
                <td
                  key={n}
                  className={reconDone ? `sep ${CELL[String(v.expect?.[n])] ?? ''}` : 'sep dim'}
                >
                  {reconDone ? String(v.expect?.[n]) : '?'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="side-jobs">
        {sideJob ? (
          <p className="dim small side-job-state">
            已接支线：{jobs.find((j) => j.key === sideJob)?.title}（验收按支线条件判）·{' '}
            <button type="button" className="link" onClick={() => onPickSideJob(null)}>
              点此取消
            </button>
            {doneSideJobs.includes(sideJob) && <b className="side-job-done">已完成</b>}
          </p>
        ) : (
          <div className="side-jobs-options">
            <span className="dim small">支线单（可选，接了更赚、判得更严）：</span>
            {jobs.map((job) => (
              <button
                key={job.key}
                type="button"
                className="link"
                onClick={() => onPickSideJob(job.key)}
              >
                {job.title} +{job.bonusHalf / 2}元
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="group-row">
        {!reconDone && (
          <button type="button" className="primary recon-entry" onClick={onOpenRecon}>
            黑盒侦察（测图纸）
          </button>
        )}
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
