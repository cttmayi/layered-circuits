import type { UnitKind } from '../editor/model';
import type { SimSnapshot } from '../sim/protocol';

export interface InspectorProps {
  snapshot: SimSnapshot | null;
  units: Array<[UnitKind, number]>;
  selectionLabel: string | null;
  pinTable: Array<{ pin: string; text: string }>;
}

const UNIT_NAME: Record<UnitKind, string> = {
  npn: '三极管',
  res: '电阻',
  dio: '二极管',
  cap: '电容',
  nmos: 'N-MOS',
  pmos: 'P-MOS',
};

/** 右侧检查器：材料费 / 端口电平 / 诊断 / 时序 */
export function Inspector({
  snapshot,
  units,
  selectionLabel,
  pinTable,
}: InspectorProps): React.JSX.Element {
  const timing = snapshot?.timing ?? null;
  const simErrors = snapshot?.simDiagnostics ?? [];
  const compileDiags = snapshot?.compileDiagnostics ?? [];

  return (
    <section className="panel">
      <h3>材料费</h3>
      {snapshot ? (
        <>
          <table className="kv">
            <tbody>
              {units.map(([unit, count]) => (
                <tr key={unit}>
                  <td>{UNIT_NAME[unit]}</td>
                  <td className="num">{count}</td>
                  <td className="num dim">
                    {(
                      count *
                      ({ npn: 2, res: 1, dio: 1.5, cap: 3 } as Record<UnitKind, number>)[unit]
                    ).toFixed(1)}
                  </td>
                </tr>
              ))}
              <tr className="total">
                <td>合计</td>
                <td className="num" />
                <td className="num">{snapshot.cost.half / 2}</td>
              </tr>
            </tbody>
          </table>
          <p className="dim small">
            半单位：{snapshot.cost.half}（内核全部用整数半单位算，避免浮点误差）
          </p>
        </>
      ) : (
        <p className="dim small">等待仿真…</p>
      )}

      {snapshot && (
        <>
          <h3>端口电平</h3>
          <table className="kv">
            <tbody>
              {Object.entries(snapshot.portValues).map(([name, value]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className={`num ${value === 1 ? 'hi' : value === 0 ? 'lo' : 'bad'}`}>
                    {String(value)}
                  </td>
                </tr>
              ))}
              {Object.keys(snapshot.portValues).length === 0 && (
                <tr>
                  <td className="dim">还没有输出引脚</td>
                </tr>
              )}
            </tbody>
          </table>

          <h3>仿真状态</h3>
          <p className="small">
            {snapshot.nodeCount} 节点 · {snapshot.elemCount} 元件 · {snapshot.evaluations} 次求值 ·
            最后事件 {snapshot.timePs} ps
          </p>
        </>
      )}

      {selectionLabel && (
        <>
          <h3>选中</h3>
          <p className="small">{selectionLabel}</p>
          {pinTable.length > 0 && (
            <table className="kv">
              <tbody>
                {pinTable.map((row) => (
                  <tr key={row.pin}>
                    <td className="mono">{row.pin}</td>
                    <td className="num small">{row.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {timing && (
        <>
          <h3>时序</h3>
          <p className="small">
            传播延迟 {(timing.criticalPathPs / 1000).toFixed(2)} ns ·{' '}
            {timing.isSequential ? (
              <strong className="warn">时序电路（有记忆）</strong>
            ) : (
              '组合电路'
            )}
            {timing.uncertain && <span className="warn"> · 结果不确定（有 X/振荡）</span>}
          </p>
          <table className="kv">
            <tbody>
              {Object.entries(timing.portDelayPs).map(([name, ps]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="num">{(ps / 1000).toFixed(2)} ns</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {compileDiags.length > 0 && (
        <>
          <h3>接线检查</h3>
          <ul className="diags">
            {compileDiags.slice(0, 12).map((d) => (
              <li key={`${d.kind}-${d.message}`} className={d.severity}>
                {d.message}
              </li>
            ))}
          </ul>
        </>
      )}

      {simErrors.length > 0 && (
        <>
          <h3>仿真诊断</h3>
          <ul className="diags">
            {simErrors.slice(0, 12).map((d) => (
              <li key={`${d.kind}-${d.message}`} className={d.severity}>
                {d.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
