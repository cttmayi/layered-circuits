/**
 * 黑盒侦察：客户送来的图纸折了角 —— 输出那一列看不清。
 *
 * 玩法：拿测试仪去「测」每一组输入（真跑一遍参考电路，读出输出），
 * 自己把观测结果填进需求表，填完点「核对图纸」。
 * 全部对上才算「自主测绘」（图纸是你自己测出来的）；懒得测可以「直接看答案」，但会被记在账上。
 *
 * 目的：把原来「一眼看到真值表 → 抄写」变成「做实验 → 归纳」。
 */

import type { Level } from '@lc/schema';
import { useMemo, useState } from 'react';
import type { ReconState } from '../level/progress';

export interface ReconPanelProps {
  level: Level;
  state: ReconState | undefined;
  /** 工具铺的测试探针：点「测」时读数自动记进需求表 */
  hasProbe: boolean;
  onMeasured: () => void;
  onSkip: () => void;
}

type Bit = 0 | 1;

export function ReconPanel({
  level,
  state,
  hasProbe,
  onMeasured,
  onSkip,
}: ReconPanelProps): React.JSX.Element {
  const inputNames = useMemo(
    () => [...new Set(level.vectors.flatMap((v) => Object.keys(v.inputs)))],
    [level.vectors],
  );
  const outputNames = useMemo(
    () => [...new Set(level.vectors.flatMap((v) => Object.keys(v.expect ?? {})))],
    [level.vectors],
  );

  /** 测试仪已经测出来的读数（行号 → 端口 → 值） */
  const [readings, setReadings] = useState<Record<string, Bit>>({});
  /** 玩家自己填进需求表的记录 */
  const [recorded, setRecorded] = useState<Record<string, Bit>>({});
  const [wrong, setWrong] = useState<number[]>([]);
  const [probed, setProbed] = useState<number | null>(null);

  const key = (row: number, port: string): string => `${row}:${port}`;
  const rowKey = (row: number): string =>
    inputNames.map((name) => String(level.vectors[row]?.inputs[name])).join(',');

  /** 测试仪：把这一组输入送进去，读出输出（用关卡自己的参考结果当黑盒） */
  const probe = (row: number): void => {
    setProbed(row);
    const next = { ...readings };
    for (const port of outputNames) {
      const value = level.vectors[row]?.expect?.[port];
      if (value === 0 || value === 1) next[key(row, port)] = value;
    }
    setReadings(next);
    if (hasProbe) {
      const auto = { ...recorded };
      for (const port of outputNames) {
        const value = level.vectors[row]?.expect?.[port];
        if (value === 0 || value === 1) auto[key(row, port)] = value;
      }
      setRecorded(auto);
    }
  };

  const cycle = (row: number, port: string): void => {
    const current = recorded[key(row, port)];
    const next = current === undefined ? 0 : current === 0 ? 1 : undefined;
    const copy = { ...recorded };
    if (next === undefined) delete copy[key(row, port)];
    else copy[key(row, port)] = next;
    setRecorded(copy);
    setWrong([]);
  };

  const check = (): void => {
    const bad: number[] = [];
    level.vectors.forEach((vector, row) => {
      for (const port of outputNames) {
        const expect = vector.expect?.[port];
        if (recorded[key(row, port)] !== expect) {
          bad.push(row);
          return;
        }
      }
    });
    setWrong(bad);
    if (bad.length === 0) onMeasured();
  };

  if (state) {
    return (
      <section className="panel recon">
        <h3>需求表</h3>
        <p className="panel-note">
          {state === 'measured'
            ? '自主测绘完成 —— 这张图纸是你自己一格格测出来的。'
            : '这张图纸你选择了直接看答案（会被记在账上，但不影响交付）。'}
        </p>
      </section>
    );
  }

  const allRecorded = level.vectors.every((_, row) =>
    outputNames.every((port) => recorded[key(row, port)] !== undefined),
  );

  return (
    <section className="panel recon">
      <h3>黑盒侦察</h3>
      <p className="panel-note">
        客户把图纸折了个角：输出那一列看不清了。用测试仪测出每一组输入的结果，自己把需求表填出来。
      </p>

      <div className="probe">
        <span className="probe-lamp">
          {probed === null
            ? '—'
            : outputNames.map((p) => `${p}=${readings[key(probed, p)] ?? '?'}`).join(' ')}
        </span>
        <span className="dim small">
          {probed === null ? '还没测过' : `已测第 ${probed + 1} 组（${rowKey(probed)}）`}
        </span>
      </div>

      <table className="truth recon-table">
        <thead>
          <tr>
            {inputNames.map((n) => (
              <th key={n}>{n}</th>
            ))}
            <th className="sep">测</th>
            {outputNames.map((n) => (
              <th key={n} className="sep">
                记录 {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {level.vectors.map((vector, row) => (
            <tr key={rowKey(row)} className={wrong.includes(row) ? 'wrong' : ''}>
              {inputNames.map((n) => (
                <td key={n} className={CELL[String(vector.inputs[n])] ?? ''}>
                  {String(vector.inputs[n])}
                </td>
              ))}
              <td className="sep">
                <button type="button" className="probe-btn" onClick={() => probe(row)}>
                  测
                </button>
              </td>
              {outputNames.map((port) => (
                <td key={port} className="sep">
                  <button type="button" className="record-cell" onClick={() => cycle(row, port)}>
                    {recorded[key(row, port)] ?? '?'}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {wrong.length > 0 && (
        <p className="bad small">
          第 {wrong.map((r) => r + 1).join('、')} 组填错了，再测一遍看看。
        </p>
      )}

      <div className="group-row">
        <button type="button" className="primary" onClick={check} disabled={!allRecorded}>
          核对图纸
        </button>
        <button type="button" onClick={onSkip}>
          直接看答案
        </button>
        {hasProbe && <span className="dim small">测试探针已装备：测完自动记</span>}
      </div>
    </section>
  );
}

const CELL: Record<string, string> = { 0: 'lo', 1: 'hi', X: 'bad', Z: 'dim' };
