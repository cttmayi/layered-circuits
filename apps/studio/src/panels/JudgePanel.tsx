import type { JudgeResult } from '@lc/compiler';
import type { Level } from '@lc/schema';
import type { LevelRecord } from '../level/progress';
import { type BusValue, columnsFromKeys, groupBusRow, portLabel } from './busDisplay';

export interface JudgePanelProps {
  level: Level;
  result: JudgeResult | null;
  record: LevelRecord | undefined;
  attempts: number;
}

const CELL: Record<string, string> = { 0: 'lo', 1: 'hi', X: 'bad', Z: 'dim' };

/** 右侧「验收台」：逐行对比、错误原因（「交付验收」按钮在顶栏）。验收通过即自动封装并弹出结算 */
export function JudgePanel({
  level,
  result,
  record,
  attempts,
}: JudgePanelProps): React.JSX.Element {
  const outputNames = [...new Set(level.vectors.flatMap((v) => Object.keys(v.expect ?? {})))];
  const widthOf = new Map(level.ports.map((p) => [p.name, p.width]));
  const outCols = outputNames.map((name) => ({ name, width: widthOf.get(name) ?? 1 }));
  const inCols = columnsFromKeys(result?.rows[0]?.inputs);

  return (
    <section className="panel judge">
      {result?.pass && (
        <p className="dim small">
          验收通过，正在自动封装为【{level.unlock?.name ?? level.title}】并结算…
        </p>
      )}
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
              {!level.classroom && (
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
              )}
              {!level.classroom &&
                result.timing.portDelayPs !== null &&
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
                  {inCols.map((c) => (
                    <th key={c.name}>{portLabel(c.name, c.width)}</th>
                  ))}
                  {outCols.map((c) => (
                    <th key={c.name} className="sep">
                      要 {portLabel(c.name, c.width)}
                    </th>
                  ))}
                  {outCols.map((c) => (
                    <th key={`${c.name}-actual`} className="sep">
                      你 {portLabel(c.name, c.width)}
                    </th>
                  ))}
                  {result.timing.maxGlitches !== null && (
                    <th key="glitch" className="sep" title="本窗口内输出跳变次数（>1 = 毛刺/空翻）">
                      跳变
                    </th>
                  )}
                  {result.rows.some((row) => row.note) && <th className="sep">说明</th>}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => {
                  const ins = groupBusRow(row.inputs as Record<string, BusValue>, inCols);
                  const want = groupBusRow(row.expected as Record<string, BusValue>, outCols);
                  const got = groupBusRow(row.actual as Record<string, BusValue>, outCols);
                  return (
                    <tr key={row.index}>
                      <td className={row.ok ? 'hi' : 'bad'}>{row.ok ? '✓' : '✗'}</td>
                      {inCols.map((c) => (
                        <td key={c.name} className={CELL[ins[c.name]] ?? ''}>
                          {ins[c.name]}
                        </td>
                      ))}
                      {outCols.map((c) => (
                        <td key={c.name} className={`sep ${CELL[want[c.name]] ?? ''}`}>
                          {want[c.name]}
                        </td>
                      ))}
                      {outCols.map((c) => (
                        <td key={`${c.name}-actual`} className={`sep ${CELL[got[c.name]] ?? ''}`}>
                          {got[c.name]}
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
                      {result.rows.some((r) => r.note) && (
                        <td className="sep note-col">{row.note ?? ''}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
