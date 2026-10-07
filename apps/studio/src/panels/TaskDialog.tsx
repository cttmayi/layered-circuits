import { contractOf } from '@lc/content';
import type { Level } from '@lc/schema';
import { Modal } from './Modal';
import { SegmentTaskDiagram } from './SegmentDiagram';

export interface LevelTaskDialogProps {
  level: Level;
  /** 判定/仿真口径：逻辑版抹平延迟，因此不显示任何延迟数字（默认时序版） */
  mode?: 'logic' | 'timing';
  /** 进关**首次**自动弹的那次：主按钮是「开始干活」；从顶栏「任务详情」打开时是「知道了」 */
  intro?: boolean;
  onClose: () => void;
}

const CELL: Record<string, string> = { 0: 'lo', 1: 'hi', X: 'bad', Z: 'dim' };

/**
 * 任务说明 / 任务详情对话框：把「这关要做什么」讲清楚。
 *
 * 两个入口共用这一份内容：
 *  1. **进关首次**自动弹一次（「首次」的持久化标记由 App 管，见 App.tsx 的 lc-ui-task-seen-*）；
 *  2. 顶栏「任务 · 关卡名」那块上的「详情」按钮随时打开。
 *
 * 内容 = 大白话任务 + 端口图 + 必用元件 + 动手步骤 + 教学说明/提示 + 合同条款 + 真值表。
 * **不含**实时材料费/成本表：右侧验收面板整块移除后（用户要求），实时成本不再常驻显示；
 * 结算页仍会给材料费与利润（见 SettlementPanel）。
 * 不做场景话术（委托方/客户叙事一律不出现），任务表达 = 需求 + 图 + 约束。
 */
export function LevelTaskDialog({
  level,
  mode = 'timing',
  intro = false,
  onClose,
}: LevelTaskDialogProps): React.JSX.Element {
  const contract = contractOf(level);
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
    <Modal
      title={`${intro ? '本关任务' : '任务详情'} · ${level.title}`}
      onClose={onClose}
      footer={
        <button type="button" className="primary" onClick={onClose}>
          {intro ? '开始干活 →' : '知道了'}
        </button>
      }
    >
      <div className="task-full">
        <h4>任务</h4>
        <p className="task-brief">{level.brief}</p>
        <SegmentTaskDiagram level={level} />
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
  );
}
