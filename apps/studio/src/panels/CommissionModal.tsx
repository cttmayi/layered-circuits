/**
 * 接单对话框：进关时把委托单顶到画面中央 —— 客户、需求、合同、支线一目了然。
 */

import { commissionOf, contractOf } from '@lc/content';
import type { Level } from '@lc/schema';
import { useState } from 'react';
import { sideJobsOf } from '../level/sideJobs';
import { Modal } from './Modal';

export interface CommissionModalProps {
  level: Level;
  /** 开工：把「接不接支线」的决定带出去（null = 只做主线） */
  onStart: (sideJobKey: string | null) => void;
}

export function CommissionModal({ level, onStart }: CommissionModalProps): React.JSX.Element {
  const commission = commissionOf(level);
  const contract = contractOf(level);
  const jobs = sideJobsOf(level);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <Modal
      title="新委托"
      onClose={() => onStart(null)}
      footer={
        <button
          type="button"
          className="primary"
          onClick={() => onStart(selected)}
          disabled={selected !== null && !jobs.some((job) => job.key === selected)}
        >
          开工{selected ? `（接：${jobs.find((j) => j.key === selected)?.title}）` : ''}
        </button>
      }
    >
      <p className="commission-client">
        <span className="client-tag">委托方</span>
        {commission.client}
      </p>
      <p className="commission-note">「{commission.note}」</p>
      <dl className="contract">
        <div>
          <dt>款项</dt>
          <dd>{contract.pay}</dd>
        </div>
        <div>
          <dt>交期</dt>
          <dd>{contract.deadline}</dd>
        </div>
        <div>
          <dt>禁忌</dt>
          <dd>{contract.taboo}</dd>
        </div>
      </dl>
      <div className="modal-jobs">
        <strong>支线单（可选，接了更赚，也判得更严）</strong>
        <ul>
          {jobs.map((job) => {
            const active = selected === job.key;
            return (
              <li key={job.key}>
                <button
                  type="button"
                  className={active ? 'job-option active' : 'job-option'}
                  onClick={() => setSelected(active ? null : job.key)}
                >
                  <span className="job-option-head">
                    {job.title}（+{job.bonusHalf / 2} 元）
                    {active && <b>已接</b>}
                  </span>
                  <span className="job-option-note">{job.note}</span>
                </button>
              </li>
            );
          })}
          {selected === null && (
            <li className="dim small">不接支线，只做主线（预算按委托单上的来）。</li>
          )}
        </ul>
      </div>
      <p className="dim small">
        开工后直接开搭；图纸没解开时，左侧图纸卡上有「黑盒侦察」按钮，想测图纸随时点。
      </p>
    </Modal>
  );
}
