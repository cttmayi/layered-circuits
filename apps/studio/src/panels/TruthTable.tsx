import type { SimSnapshot } from '../sim/protocol';
import { type BusValue, columnsFromKeys, groupBusRow, portLabel } from './busDisplay';

export interface TruthTableProps {
  snapshot: SimSnapshot | null;
}

const CELL: Record<string, string> = { 0: 'lo', 1: 'hi', X: 'bad', Z: 'dim' };

/** 真值表：穷举所有输入组合，逐行跑仿真（这就是 M0 的验收判据在 UI 上的样子） */
export function TruthTable({ snapshot }: TruthTableProps): React.JSX.Element {
  const rows = snapshot?.truth ?? null;
  if (!rows) {
    return (
      <section className="panel">
        <h3>真值表</h3>
        <p className="dim small">
          {snapshot?.portValues && Object.keys(snapshot.inputs).length === 0
            ? '先放一个「输入引脚」并接线，就会自动穷举真值表。'
            : '暂不可用（输入引脚超过 6 个时不做穷举）。'}
        </p>
      </section>
    );
  }
  const inCols = columnsFromKeys(rows[0]?.inputs);
  const outCols = columnsFromKeys(rows[0]?.outputs);

  return (
    <section className="panel">
      <h3>真值表（{rows.length} 行）</h3>
      <table className="truth">
        <thead>
          <tr>
            {inCols.map((c) => (
              <th key={c.name}>{portLabel(c.name, c.width)}</th>
            ))}
            {outCols.map((c) => (
              <th key={c.name} className="sep">
                {portLabel(c.name, c.width)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const ins = groupBusRow(row.inputs as Record<string, BusValue>, inCols);
            const outs = groupBusRow(row.outputs as Record<string, BusValue>, outCols);
            return (
              <tr
                key={
                  inCols.map((c) => ins[c.name]).join('') +
                  outCols.map((c) => outs[c.name]).join('')
                }
              >
                {inCols.map((c) => (
                  <td key={c.name} className={CELL[ins[c.name]] ?? ''}>
                    {ins[c.name]}
                  </td>
                ))}
                {outCols.map((c) => (
                  <td key={c.name} className={`sep ${CELL[outs[c.name]] ?? ''}`}>
                    {outs[c.name]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
