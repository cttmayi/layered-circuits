import { UNIT_COST } from '@lc/schema';
import type { StoredModule, UnitKind } from '../editor/model';
import type { SimSnapshot } from '../sim/protocol';

export interface InspectorProps {
  snapshot: SimSnapshot | null;
  units: Array<[UnitKind, number]>;
  selectionLabel: string | null;
  /** 单选中的模块（有则显示「展开内部电路」入口） */
  selectedModule?: StoredModule | null;
  onExpandModule?: () => void;
}

const UNIT_NAME: Record<UnitKind, string> = {
  npn: '三极管',
  res: '电阻',
  dio: '二极管',
  cap: '电容',
  nmos: 'N-MOS',
  pmos: 'P-MOS',
};

/** 右侧检查器：材料费 / 诊断 / 时序 */
export function Inspector({ snapshot, units }: InspectorProps): React.JSX.Element {
  const timing = snapshot?.timing ?? null;
  const simErrors = snapshot?.simDiagnostics ?? [];
  const compileDiags = snapshot?.compileDiagnostics ?? [];

  return (
    <section className="panel">
      <h3>材料费</h3>
      {snapshot ? (
        <table className="kv">
          <tbody>
            {units
              .filter(([, count]) => count > 0)
              .map(([unit, count]) => (
                <tr key={unit}>
                  <td>{UNIT_NAME[unit]}</td>
                  <td className="num">{count}</td>
                  {/* 单价必须取自 schema 的价目表：写死在面板里会跟成本模型脱节
                      （旧表 res 1 / dio 1.5 / cap 3，且没有 MOS，CMOS 契约下会显示 NaN） */}
                  <td className="num dim">{(count * UNIT_COST[unit]).toFixed(1)}</td>
                </tr>
              ))}
            <tr className="total">
              <td>合计</td>
              <td className="num" />
              <td className="num">{snapshot.cost.half / 2}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="dim small">等待仿真…</p>
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
