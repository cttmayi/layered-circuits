/**
 * 波形面板（M2）：把仿真 trace 画成阶梯图，让「传播延迟」「毛刺」「空翻」看得见。
 *
 * 画法很直白：每个端口一行，横轴是时间（ns），阶梯线表示电平变化；
 * 竖向虚线是判定向量（激励）的时刻 —— 设备一个个打在窗口起点上（内核 setInputAt 保证）。
 */

import type { JudgeResult } from '@lc/compiler';
import { logicValueOf, strengthOf } from '@lc/sim-core';

export interface WaveformPanelProps {
  result: JudgeResult;
  portNames: string[];
}

const ROW_H = 26;
const LABEL_W = 46;
const PAD_R = 8;

/** 强 1 用实心高电平、弱 1 用半高显示：RTL 电路里「弱 1」是很重要的信息 */
function levelOf(signal: number): { high: boolean; weak: boolean; unknown: boolean } {
  const value = logicValueOf(signal);
  return {
    high: value === 1,
    weak: signal !== 0 && strengthOf(signal) === 1,
    unknown: value === 2 || signal === 0,
  };
}

export function WaveformPanel({ result, portNames }: WaveformPanelProps): React.JSX.Element {
  const wave = result.waveform;
  if (!wave || wave.nets.length === 0) {
    return (
      <section className="panel wave">
        <h3>波形</h3>
        <p className="dim small">先运行一次校验（硬核模式才有传播延迟与毛刺）。</p>
      </section>
    );
  }

  const endPs = Math.max(wave.endPs, 1);
  const rows = portNames
    .map((name) => ({
      name,
      net: wave.nets.find((n) => n.port?.name === name),
    }))
    .filter((r): r is { name: string; net: NonNullable<typeof r.net> } => Boolean(r.net));

  const height = rows.length * ROW_H + 24;
  const width = 520;
  const plotW = width - LABEL_W - PAD_R;
  const x = (ps: number) => LABEL_W + (ps / endPs) * plotW;

  return (
    <section className="panel wave">
      <h3>
        波形 <span className="dim small">（每格 {fmtPs(endPs / 4)}，竖线 = 向量施加时刻）</span>
      </h3>
      <svg
        className="wave-svg"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="端口波形"
      >
        {result.rows.map((row) => (
          <line
            key={`w${row.index}`}
            x1={x(row.window.fromPs)}
            y1={8}
            x2={x(row.window.fromPs)}
            y2={height - 12}
            className="vline"
          />
        ))}
        {rows.map((row, index) => {
          const top = 12 + index * ROW_H;
          const low = top + 16;
          const high = top + 4;
          const segments: React.JSX.Element[] = [];
          let prevY = low;
          let prevX = x(0);
          const steps = row.net.steps;
          // 起点
          segments.push(
            <text key={`lbl-${row.name}`} x={2} y={top + 14} className="wlabel">
              {row.name}
            </text>,
          );
          steps.forEach((step) => {
            const cx = x(step.timePs);
            const { high: isHigh, weak, unknown } = levelOf(step.signal);
            const y = unknown ? (low + high) / 2 : isHigh ? high : low;
            segments.push(
              <line
                key={`${row.name}-s${step.timePs}-${step.signal}`}
                x1={prevX}
                y1={prevY}
                x2={cx}
                y2={prevY}
                className={unknown ? 'unknown' : weak ? 'weak' : 'strong'}
              />,
            );
            if (y !== prevY) {
              segments.push(
                <line
                  key={`${row.name}-t${step.timePs}-${step.signal}-${prevY}`}
                  x1={cx}
                  y1={prevY}
                  x2={cx}
                  y2={y}
                  className={unknown ? 'unknown' : weak ? 'weak' : 'strong'}
                />,
              );
            }
            prevY = y;
            prevX = cx;
          });
          segments.push(
            <line key="end" x1={prevX} y1={prevY} x2={x(endPs)} y2={prevY} className="strong" />,
          );
          return segments;
        })}
      </svg>
    </section>
  );
}

function fmtPs(ps: number): string {
  if (ps >= 1_000_000) return `${(ps / 1_000_000).toFixed(1)}µs`;
  if (ps >= 1000) return `${(ps / 1000).toFixed(1)}ns`;
  return `${Math.round(ps)}ps`;
}
