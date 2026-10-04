/**
 * 结算页：交付通过之后的那一下「仪式感」。
 *
 * 这一屏承担三件事：
 *  1. 把验收结果翻译成客户语言（能用了 / 便宜 / 快），而不是工程报告；
 *  2. 算出这一单的钱（款项 − 材料费 = 利润）与钱包余额；
 *  3. 给评级（S/A/B/C）与破纪录提示 —— 免费试错的压力就来自这里。
 */

import type { JudgeResult } from '@lc/compiler';
import type { Level } from '@lc/schema';
import { gradeOf, profitOf } from '../level/progress';
import { Modal } from './Modal';

export interface SettlementPanelProps {
  level: Level;
  /** 本次交付拿到的星数（0~3） */
  stars: number;
  levelName: string;
  result: JudgeResult;
  /** 上一次通关的分数（判断是否破纪录）；首次通关传 null */
  previousScore: number | null;
  walletHalf: number;
  onNextLevel: () => void;
  /** 关掉结算但留在本关（继续重挑战追星） */
  onDismiss: () => void;
  nextLevelTitle?: string;
}

export function SettlementPanel({
  level,
  stars,
  levelName,
  result,
  previousScore,
  walletHalf,
  onNextLevel,
  onDismiss,
  nextLevelTitle,
}: SettlementPanelProps): React.JSX.Element {
  const profit = profitOf(level, result.costHalf);
  const payment = profit + result.costHalf;
  const grade = gradeOf(result.score);
  const brokeRecord = previousScore !== null && result.score > previousScore;

  return (
    <Modal
      title={`验收报告 · ${level.title}`}
      onClose={onDismiss}
      footer={
        <button
          type="button"
          className="primary"
          onClick={onNextLevel}
          disabled={!nextLevelTitle && !level.classroom}
        >
          {level.classroom
            ? '回到教学模式'
            : nextLevelTitle
              ? `接着做下一单：${nextLevelTitle}`
              : '主线全部完成'}
        </button>
      }
    >
      <section className="panel settlement">
        <p className="settle-client">
          「{result.pass ? '东西能用，做得好。' : '这版还不行，麻烦师傅再改改。'}」
        </p>

        {!level.classroom && (
          <div className={`grade grade-${grade.toLowerCase()}`}>
            <span className="grade-letter">{grade}</span>
            <span className="grade-text">
              <strong>{result.score} 分</strong>
              <em>
                功能 {result.failedRows === 0 ? '✓' : '✗'} · 用料 {result.overBudget ? '超支' : '✓'}{' '}
                · 时序 {result.timingBudgetPs === null || result.timingOk ? '✓' : '✗'}
              </em>
            </span>
          </div>
        )}

        <table className="kv">
          <tbody>
            <tr>
              <td>款项</td>
              <td className="num">{payment / 2} 元</td>
            </tr>
            <tr>
              <td>材料费</td>
              <td className="num">− {result.costHalf / 2} 元</td>
            </tr>
            <tr>
              <td>本单利润</td>
              <td className="num">
                <strong className={profit < 0 ? 'bad' : 'hi'}>
                  {profit < 0 ? '' : '+'}
                  {profit / 2} 元
                </strong>
              </td>
            </tr>
            <tr>
              <td>钱包余额</td>
              <td className="num">{walletHalf / 2} 元</td>
            </tr>
            <tr>
              <td>传播延迟</td>
              <td className="num">
                {(result.criticalPathPs / 1000).toFixed(2)} ns
                {result.timingBudgetPs !== null && (
                  <span className={result.timingOk ? 'dim' : 'bad'}>
                    {' '}
                    / ≤{(result.timingBudgetPs / 1000).toFixed(2)}
                  </span>
                )}
              </td>
            </tr>
            {result.timing.portDelayPs !== null &&
              Object.keys(result.timing.portDelayPs).length > 0 && (
                <tr>
                  <td>各输出传播延迟</td>
                  <td className="num">
                    {Object.entries(result.timing.portDelayPs)
                      .map(([name, ps]) => `${name} ${(ps / 1000).toFixed(2)}ns`)
                      .join(' · ')}
                  </td>
                </tr>
              )}
          </tbody>
        </table>

        {level.classroom ? (
          <p className="teaching-done">
            ✓ 教学关完成 —— 元件已学会，本单不评星、不设元件成本与传播延迟要求，也不封装模块
          </p>
        ) : (
          <>
            <p className={`stars stars-${stars}`}>
              {'★'.repeat(stars)}
              {'☆'.repeat(3 - stars)}
              <em>
                {stars >= 3
                  ? '三星：元件成本与传播延迟都压到 0.5×线'
                  : stars === 2
                    ? '还差一颗星：元件成本或传播延迟压到 0.75×线以内'
                    : '先做到功能 + 元件成本线内，再压传播延迟'}
              </em>
            </p>

            {brokeRecord && (
              <p className="record">破纪录！比上次多得 {result.score - (previousScore ?? 0)} 分</p>
            )}
            {result.score >= 100 && (
              <p className="record">已达满分线（0.5×元件成本线）—— 这是行家做法。</p>
            )}
          </>
        )}

        <p className="panel-note">
          {level.classroom
            ? `教学关 ${level.id} · 元件已学会（教学关不产出积木模块，不占组件库）`
            : `委托 ${level.id} · 交付物【${levelName}】已进组件库`}
          {level.kind === 'cost' ? ' · 元件成本挑战关：不限元件成本，按满分线结算' : ''}
        </p>
      </section>
    </Modal>
  );
}
