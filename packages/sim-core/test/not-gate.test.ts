import { describe, expect, it } from 'vitest';
import { Simulator } from '../src/engine.js';
import { runVectors, type TestVector } from '../src/harness.js';
import { buildInverterLoop, buildNotGate } from './helpers/circuits.js';

const TRUTH_TABLE: TestVector[] = [
  { inputs: { in: 0 }, expect: { out: 1 } },
  { inputs: { in: 1 }, expect: { out: 0 } },
];

describe('RTL 非门（2 三极管 + 3 电阻，成本 7）', () => {
  it('新手科普模式：真值表正确', () => {
    const result = runVectors(buildNotGate(), TRUTH_TABLE, { mode: 'logic' });
    expect(result.rows.map((r) => r.actual.out)).toEqual([1, 0]);
    expect(result.pass).toBe(true);
    expect(result.unstable).toBe(false);
  });

  it('硬核工程模式：真值表同样正确', () => {
    const result = runVectors(buildNotGate(), TRUTH_TABLE, {
      mode: 'timing',
      defaultSettlePs: 100_000,
    });
    expect(result.pass).toBe(true);
  });

  it('硬核模式：输出是「强 1 / 弱 0」——强度语义真的被用上了', () => {
    const net = buildNotGate();
    const sim = new Simulator(net, { mode: 'timing' });
    sim.setInput('in', 0);
    sim.advanceTo(100_000);
    const out = net.ports.find((p) => p.name === 'out');
    expect(out).toBeDefined();
    const high = sim.signalOf(out!.node);
    expect(high >> 2).toBe(2); // 射极跟随器从 VCC 强拉高 → STRONG

    sim.setInput('in', 1);
    sim.advanceTo(sim.time + 100_000);
    const low = sim.signalOf(out!.node);
    expect(low >> 2).toBe(1); // 输出下拉电阻 → WEAK
  });

  it('硬核模式：IN 翻转后 2.5ns 输出才变化（0.5ns 电阻 + 1ns + 1ns 三极管）', () => {
    const net = buildNotGate();
    const sim = new Simulator(net, { mode: 'timing', trace: true });
    sim.setInput('in', 0);
    sim.advanceTo(100_000);
    const t0 = sim.time;
    expect(sim.readPort('out')).toBe(1);

    sim.setInput('in', 1);
    sim.advanceTo(t0 + 100_000);
    expect(sim.readPort('out')).toBe(0);

    const outNode = net.ports.find((p) => p.name === 'out')!.node;
    let lastChange = -1;
    const trace = sim.trace!;
    for (let i = 0; i < trace.times.length; i++) {
      if (trace.nodes[i] === outNode && (trace.times[i] as number) > t0) {
        lastChange = trace.times[i] as number;
      }
    }
    expect(lastChange - t0).toBe(2500);
  });

  it('未连接的输入引脚不会导致 X 泛滥，只报「基极悬空」警告', () => {
    const net = buildNotGate();
    const sim = new Simulator(net, { mode: 'logic' });
    sim.settle();
    expect(sim.readPort('out')).toBe(1); // 输入 Z → Q1 截止 → A 上拉为 1 → Q2 导通
    const floating = sim.allDiagnostics.filter((d) => d.kind === 'floating-input');
    expect(floating.length).toBeGreaterThan(0);
    expect(sim.allDiagnostics.some((d) => d.kind === 'drive-conflict')).toBe(false);
  });
});

describe('组合环 / 振荡检测', () => {
  it('反相器输出接回输入时，逻辑模式判定为不稳定并给出波动节点', () => {
    const sim = new Simulator(buildInverterLoop(), { mode: 'logic' });
    const converged = sim.settle();
    expect(converged).toBe(false);
    const unstable = sim.allDiagnostics.find((d) => d.kind === 'unstable');
    expect(unstable).toBeDefined();
    expect(unstable!.severity).toBe('error');
    expect(unstable!.message).toContain('节点');
  });
});
