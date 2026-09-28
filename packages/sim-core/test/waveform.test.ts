/**
 * 波形层：把内核的跳变轨迹整理成阶梯曲线，并支持「在窗口里数跳变」——
 * 后者是 M2 判定竞争冒险 / 空翻的基础（翻转次数 > 1 就是毛刺）。
 */

import { describe, expect, it } from 'vitest';
import type { Trace } from '../src/engine.js';
import { NetlistBuilder, runVectors, signalAt, toWaveform, transitionsIn } from '../src/index.js';
import { logicValueOf, S_STRONG } from '../src/signal.js';
import { buildNotGate } from './helpers/circuits.js';

describe('波形', () => {
  it('把跳变轨迹整理成「每个网络一条曲线」，并从悬空态开始', () => {
    const net = buildNotGate();
    const result = runVectors(net, [{ inputs: { in: 1 } }, { inputs: { in: 0 } }], {
      mode: 'timing',
      trace: true,
      defaultSettlePs: 20_000,
    });
    const wave = result.waveform;
    expect(wave).toBeDefined();
    const outNode = net.ports.find((p) => p.name === 'out')?.node as number;
    const out = wave?.nets.find((n) => n.node === outNode);
    expect(out?.port?.name).toBe('out');
    expect(out?.steps[0]?.signal).toBe(0); // 0 时刻悬空
    // 输入 1 → 输出被拉低（弱 0：上拉电阻被三极管压住，但驱动方是弱通路）
    expect(signalAt(wave as never, outNode, 10_000)).toBe(4);
    expect(logicValueOf(signalAt(wave as never, outNode, 10_000))).toBe(0);
    // 输入 0 → 射极跟随器把 VCC 的强 1 送出来
    expect(signalAt(wave as never, outNode, 30_000)).toBe(9);
    expect(logicValueOf(signalAt(wave as never, outNode, 30_000))).toBe(1);
    // 激励落在窗口起点（20ns），所以 19.9ns 时输出还没变
    expect(logicValueOf(signalAt(wave as never, outNode, 19_900))).toBe(0);
    expect(wave?.nets.every((n) => n.steps.length > 0 && n.steps[0]?.timePs === 0)).toBe(true);
  });

  it('能数出窗口内的跳变次数（毛刺检测的基础）', () => {
    // 一个反相器级联两次：输入跳变会让中间节点与输出各跳一次
    const b = new NetlistBuilder();
    const vcc = b.node('vcc');
    const gnd = b.node('gnd');
    const a = b.node('a');
    const m = b.node('m');
    const y = b.node('y');
    b.power(vcc, 1);
    b.power(gnd, 0);
    b.res(vcc, a);
    b.res(a, m);
    b.npn(m, a, gnd);
    b.res(vcc, y);
    b.npn(y, m, gnd);
    b.input(a, 'in');
    b.output(y, 'out');
    const net = b.build();

    const result = runVectors(net, [{ inputs: { in: 1 } }], {
      mode: 'timing',
      trace: true,
      defaultSettlePs: 20_000,
    });
    const wave = result.waveform!;
    const mNode = net.nodeLabel.indexOf('m');
    const yNode = net.nodeLabel.indexOf('y');
    // 窗口 [0, 20000] 内：中间节点先动，输出后动，各一次
    expect(transitionsIn(wave, mNode, 0, 20_000)).toBeGreaterThanOrEqual(1);
    expect(transitionsIn(wave, yNode, 0, 20_000)).toBeGreaterThanOrEqual(1);
    // 空窗口自然没有跳变
    expect(transitionsIn(wave, yNode, 20_000, 40_000)).toBe(0);
    expect(wave.transitions).toBeGreaterThan(0);
    expect(wave.endPs).toBeGreaterThan(0);
  });

  it('可以只挑端口节点，也可以只挑指定节点', () => {
    const net = buildNotGate();
    const outNode = net.ports.find((p) => p.name === 'out')?.node as number;
    const inNode = net.ports.find((p) => p.name === 'in')?.node as number;
    // 合成一段轨迹：内部节点也变了，但只想要端口
    const internalNode = net.nodeLabel.indexOf('B1');
    const trace: Trace = {
      times: [1000, 2000, 3000],
      nodes: [inNode, outNode, internalNode],
      signals: [9, 8, 5],
    };
    const portsOnly = toWaveform(trace, net, { portOnly: true });
    expect(portsOnly.nets.map((n) => n.port?.name).sort()).toEqual(['in', 'out']);
    expect(transitionsIn(portsOnly, outNode, 0, 5000)).toBe(1);

    const justOut = toWaveform(trace, net, { nodes: [outNode] });
    expect(justOut.nets.length).toBe(1);
    expect(justOut.nets[0]?.label).toBe('OUT');
    expect(justOut.nets[0]?.steps.at(-1)?.signal).toBe(8);
    expect(S_STRONG).toBe(2);
  });
});
