/**
 * 波形（信号跳变轨迹）—— M2 的时序可视化与竞争冒险检查都建立在这上面。
 *
 * 内核在仿真时记录「某个时刻、某个节点、变成了什么信号」（Trace 平行数组），
 * 这里把它整理成「每个网络一条阶梯曲线」的形态，UI 直接画，检查器直接数跳变。
 */

import type { Trace } from './engine.js';
import type { FlatNet } from './ir.js';
import { SIG_Z } from './signal.js';

export interface WaveStep {
  timePs: number;
  /** 信号编码（strength << 2 | value），与内核一致 */
  signal: number;
}

export interface WaveNet {
  node: number;
  label: string;
  /** 该节点对应的端口（如果有） */
  port?: { id: string; name: string; dir: 'in' | 'out' };
  steps: WaveStep[];
}

export interface Waveform {
  startPs: number;
  /** 最后一步延伸到的时刻（采样终点） */
  endPs: number;
  nets: WaveNet[];
  transitions: number;
}

export interface WaveformOptions {
  /** 只保留这些节点（缺省：全部） */
  nodes?: readonly number[];
  /** 只保留挂端口的节点 */
  portOnly?: boolean;
}

/** 把内核 trace 整理成波形；没有任何变化的节点会得到「全程悬空」的一条直线 */
export function toWaveform(trace: Trace, net: FlatNet, options: WaveformOptions = {}): Waveform {
  const portByNode = new Map<number, { id: string; name: string; dir: 'in' | 'out' }>();
  for (const port of net.ports) {
    portByNode.set(port.node, { id: port.id, name: port.name, dir: port.dir });
  }

  const wanted = new Set<number>();
  if (options.nodes) for (const n of options.nodes) wanted.add(n);
  if (options.portOnly) for (const port of net.ports) wanted.add(port.node);
  if (!options.nodes && !options.portOnly) {
    for (let i = 0; i < net.nodeCount; i++) wanted.add(i);
  }

  const byNode = new Map<number, WaveStep[]>();
  for (const node of wanted) byNode.set(node, []);
  let endPs = 0;
  let transitions = 0;

  for (let i = 0; i < trace.times.length; i++) {
    const node = trace.nodes[i] as number;
    const timePs = trace.times[i] as number;
    if (!byNode.has(node)) continue;
    (byNode.get(node) as WaveStep[]).push({ timePs, signal: trace.signals[i] as number });
    if (timePs > endPs) endPs = timePs;
    transitions++;
  }

  const nets: WaveNet[] = [];
  for (const [node, steps] of [...byNode].sort((a, b) => a[0] - b[0])) {
    // 每条曲线都从 0 时刻的悬空态开始，UI 不必特殊处理「第一段」
    const full: WaveStep[] =
      steps.length > 0 &&
      (steps[0] as WaveStep).timePs === 0 &&
      (steps[0] as WaveStep).signal === SIG_Z
        ? steps
        : [{ timePs: 0, signal: SIG_Z }, ...steps];
    const entry: WaveNet = { node, label: net.nodeLabel[node] ?? `n${node}`, steps: full };
    const port = portByNode.get(node);
    if (port) entry.port = port;
    nets.push(entry);
  }

  return { startPs: 0, endPs: Math.max(endPs, 1), nets, transitions };
}

/** 某个网络在时间窗口内发生了几次跳变（用来数竞争冒险/空翻） */
export function transitionsIn(wave: Waveform, node: number, fromPs: number, toPs: number): number {
  const entry = wave.nets.find((n) => n.node === node);
  if (!entry) return 0;
  let count = 0;
  for (const step of entry.steps) {
    if (step.timePs > fromPs && step.timePs <= toPs) count++;
  }
  return count;
}

/** 某个网络在给定时刻的信号（阶梯采样） */
export function signalAt(wave: Waveform, node: number, timePs: number): number {
  const entry = wave.nets.find((n) => n.node === node);
  if (!entry) return SIG_Z;
  let signal = SIG_Z;
  for (const step of entry.steps) {
    if (step.timePs > timePs) break;
    signal = step.signal;
  }
  return signal;
}

export function nodeOfPort(net: FlatNet, portName: string): number | undefined {
  return net.ports.find((p) => p.name === portName)?.node;
}
