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

/** 右侧「验收台」：逐行对比、错误原因、交付与封装按钮（客户不会看你的真值表，但你自己得看） */
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
      <h3>验收台</h3>
      <div className="group-row">
        <button type="button" className="primary" onClick={onJudge} disabled={busy}>
          {busy ? '验收中…' : '交付验收'}
        </button>
        {result?.pass && (
          <button type="button" onClick={onClear}>
            交付并封装为【{level.unlock?.name ?? level.title}】
          </button>
        )}
      </div>
      {record && record.clearedAt > 0 && (
        <p className="dim small">
          历史最好：{record.score} 分 · 最低材料费 {record.bestCostHalf / 2} · 已尝试 {attempts} 次
        </p>
      )}

      {result && (
        <>
          <p className={result.pass ? 'verdict pass' : 'verdict fail'}>
            {result.pass
              ? `客户验收通过！${result.score} 分`
              : result.errors.length > 0
                ? '客户打回了，看下面的问题清单'
                : '还没验收'}
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
                <td>材料费</td>
                <td className="num">
                  {result.costHalf / 2} / 款项 {result.budgetHalf / 2}
                  {result.overBudget && <span className="bad"> 超支</span>}
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
              <tr>
                <td>结构</td>
                <td className="num">
                  {result.isSequential ? (
                    <span className="dim">含记忆（时序电路）</span>
                  ) : (
                    <span className="dim">纯组合逻辑</span>
                  )}
                </td>
              </tr>
              {result.timing.maxGlitches !== null && (
                <tr>
                  <td>空翻/毛刺</td>
                  <td className="num">
                    {result.timing.glitches} 次跳变
                    {result.timing.glitchRows.length > 0 ? (
                      <span className="bad">
                        {' '}
                        第 {result.timing.glitchRows.map((i) => i + 1).join('、')} 组超标
                      </span>
                    ) : (
                      <span className="hi"> 无空翻</span>
                    )}
                  </td>
                </tr>
              )}
              {result.timing.setupPs !== null && (
                <tr>
                  <td>建立/保持</td>
                  <td className="num">
                    {(result.timing.setupPs / 1000).toFixed(1)}ns /{' '}
                    {result.timing.holdPs === null
                      ? '—'
                      : `${(result.timing.holdPs / 1000).toFixed(1)}ns`}
                    {result.timing.edgeTriggered === false && (
                      <span className="bad"> 非边沿触发</span>
                    )}
                  </td>
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
          {(result.timing.notes.length > 0 || result.timing.setupPs !== null) && (
            <ul className="diags">
              {result.timing.setupPs !== null && (
                <li className="info">
                  建立/保持时间是仿真扫描实测（步长 0.5ns）：数值越小说明电路越快
                </li>
              )}
              {result.timing.notes.map((message) => (
                <li key={message} className="info">
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
                  {result.timing.maxGlitches !== null && (
                    <th key="glitch" className="sep" title="本窗口内输出跳变次数（>1 = 毛刺/空翻）">
                      跳变
                    </th>
                  )}
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
                    {result.timing.maxGlitches !== null && (
                      <td
                        key="glitch"
                        className={`sep ${row.glitches > 1 && row.index > 0 ? 'bad' : 'dim'}`}
                        title="本窗口内输出跳变次数"
                      >
                        {row.index === 0 ? '上电' : row.glitches}
                      </td>
                    )}
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
