import type { SimSnapshot } from '../sim/protocol';

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
  const inputNames = Object.keys(rows[0]?.inputs ?? {});
  const outputNames = Object.keys(rows[0]?.outputs ?? {});

  return (
    <section className="panel">
      <h3>真值表（{rows.length} 行）</h3>
      <table className="truth">
        <thead>
          <tr>
            {inputNames.map((n) => (
              <th key={n}>{n}</th>
            ))}
            {outputNames.map((n) => (
              <th key={n} className="sep">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={
                inputNames.map((n) => String(row.inputs[n])).join('') +
                outputNames.map((n) => String(row.outputs[n])).join('')
              }
            >
              {inputNames.map((n) => (
                <td key={n} className={CELL[String(row.inputs[n])] ?? ''}>
                  {String(row.inputs[n])}
                </td>
              ))}
              {outputNames.map((n) => (
                <td key={n} className={`sep ${CELL[String(row.outputs[n])] ?? ''}`}>
                  {String(row.outputs[n])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
