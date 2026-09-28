import type { JudgeResult } from '@lc/compiler';
import type { Level } from '@lc/schema';
import type { LevelRecord } from '../level/progress';

export interface JudgePanelProps {
  level: Level;
  result: JudgeResult | null;
  busy: boolean;
  record: LevelRecord | undefined;
  attempts: number;
  onJudge: () => void;
  onClear: () => void;
}

const CELL: Record<string, string> = { 0: 'lo', 1: 'hi', X: 'bad', Z: 'dim' };

/** 右侧「本关校验」面板：逐行对比、错误原因、通关封装按钮 */
export function JudgePanel({
  level,
  result,
  busy,
  record,
  attempts,
  onJudge,
  onClear,
}: JudgePanelProps): React.JSX.Element {
  const outputNames = [...new Set(level.vectors.flatMap((v) => Object.keys(v.expect ?? {})))];

  return (
    <section className="panel judge">
      <h3>本关校验</h3>
      <div className="group-row">
        <button type="button" className="primary" onClick={onJudge} disabled={busy}>
          {busy ? '校验中…' : '运行校验'}
        </button>
        {result?.pass && (
          <button type="button" onClick={onClear}>
            通关并封装为【{level.unlock?.name ?? level.title}】
          </button>
        )}
      </div>
      {record && record.clearedAt > 0 && (
        <p className="dim small">
          历史最好：{record.score} 分 · 最低成本 {record.bestCostHalf / 2} · 已尝试 {attempts} 次
        </p>
      )}

      {result && (
        <>
          <p className={result.pass ? 'verdict pass' : 'verdict fail'}>
            {result.pass ? `通过！得分 ${result.score}` : '还没通过'}
          </p>
          <table className="kv">
            <tbody>
              <tr>
                <td>功能</td>
                <td className="num">
                  {result.failedRows === 0 ? (
                    <span className="hi">全部符合</span>
                  ) : (
                    <span className="bad">{result.failedRows} 行不符</span>
                  )}
                </td>
              </tr>
              <tr>
                <td>成本</td>
                <td className="num">
                  {result.costHalf / 2} / {result.budgetHalf / 2}
                  {result.overBudget && <span className="bad"> 超预算</span>}
                </td>
              </tr>
              <tr>
                <td>关键路径</td>
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
              {result.isSequential && (
                <tr>
                  <td>结构</td>
                  <td className="num bad">含记忆（时序电路）</td>
                </tr>
              )}
            </tbody>
          </table>

          {result.errors.length > 0 && (
            <ul className="diags">
              {result.errors.map((message) => (
                <li key={message} className="error">
                  {message}
                </li>
              ))}
            </ul>
          )}
          {result.warnings.length > 0 && (
            <ul className="diags">
              {result.warnings.map((message) => (
                <li key={message} className="warning">
                  {message}
                </li>
              ))}
            </ul>
          )}

          {result.rows.length > 0 && (
            <table className="truth">
              <thead>
                <tr>
                  <th />
                  {Object.keys(result.rows[0]?.inputs ?? {}).map((n) => (
                    <th key={n}>{n}</th>
                  ))}
                  {outputNames.map((n) => (
                    <th key={n} className="sep">
                      要 {n}
                    </th>
                  ))}
                  {outputNames.map((n) => (
                    <th key={`${n}-actual`} className="sep">
                      你 {n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.index}>
                    <td className={row.ok ? 'hi' : 'bad'}>{row.ok ? '✓' : '✗'}</td>
                    {Object.keys(row.inputs).map((n) => (
                      <td key={n} className={CELL[String(row.inputs[n])] ?? ''}>
                        {String(row.inputs[n])}
                      </td>
                    ))}
                    {outputNames.map((n) => (
                      <td key={n} className={`sep ${CELL[String(row.expected[n])] ?? ''}`}>
                        {String(row.expected[n])}
                      </td>
                    ))}
                    {outputNames.map((n) => (
                      <td
                        key={`${n}-actual`}
                        className={`sep ${CELL[String(row.actual[n])] ?? ''}`}
                      >
                        {String(row.actual[n])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
