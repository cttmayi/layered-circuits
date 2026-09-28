/**
 * 接单对话框：进关时把委托单顶到画面中央 —— 客户、需求、合同、支线一目了然。
 */

import { commissionOf, contractOf } from '@lc/content';
import type { Level } from '@lc/schema';
import { sideJobsOf } from '../level/sideJobs';
import { Modal } from './Modal';

export interface CommissionModalProps {
  level: Level;
  onStart: () => void;
}

export function CommissionModal({ level, onStart }: CommissionModalProps): React.JSX.Element {
  const commission = commissionOf(level);
  const contract = contractOf(level);
  const jobs = sideJobsOf(level);
  return (
    <Modal
      title="新委托"
      onClose={onStart}
      footer={
        <button type="button" className="primary" onClick={onStart}>
          开工
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
        <strong>支线单（可选）</strong>
        <ul>
          {jobs.map((job) => (
            <li key={job.key}>
              {job.title}（+{job.bonusHalf / 2} 元）：{job.note}
            </li>
          ))}
        </ul>
      </div>
      <p className="dim small">开工后：左侧委托单随时可看，图纸折角了要用黑盒侦察测出来。</p>
    </Modal>
  );
}
