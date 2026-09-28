import { describe, expect, it } from 'vitest';
import { Simulator } from '../src/engine.js';
import { allInputCombinations, runVectors } from '../src/harness.js';
import { ElementKind, NetlistBuilder } from '../src/ir.js';
import { buildNandGate, buildSRLatch } from './helpers/circuits.js';

describe('RTL 与非门（2 三极管串联 + 3 电阻）', () => {
  const truthTable = allInputCombinations(['a', 'b']).map((inputs) => ({
    inputs,
    expect: { y: (inputs.a === 1 && inputs.b === 1 ? 0 : 1) as 0 | 1 },
  }));

  it('新手模式下真值表全通过（含双高时串联导通拉低）', () => {
    const result = runVectors(buildNandGate(), truthTable, { mode: 'logic' });
    expect(result.rows.map((r) => r.actual.y)).toEqual([1, 1, 1, 0]);
    expect(result.pass).toBe(true);
  });

  it('硬核模式下真值表全通过', () => {
    const result = runVectors(buildNandGate(), truthTable, { mode: 'timing' });
    expect(result.pass).toBe(true);
  });
});

describe('SR 锁存器（两个与非门交叉耦合）', () => {
  it('置位 → 保持 → 复位 → 保持', () => {
    const net = buildSRLatch();
    const sim = new Simulator(net, { mode: 'logic' });

    sim.setInputs({ s: 0, r: 1 }); // 低有效置位
    expect(sim.readPort('q')).toBe(1);
    expect(sim.readPort('qn')).toBe(0);

    sim.setInputs({ s: 1, r: 1 }); // 保持
    expect(sim.readPort('q')).toBe(1);
    expect(sim.readPort('qn')).toBe(0);

    sim.setInputs({ s: 1, r: 0 }); // 低有效复位
    expect(sim.readPort('q')).toBe(0);
    expect(sim.readPort('qn')).toBe(1);

    sim.setInputs({ s: 1, r: 1 }); // 再次保持
    expect(sim.readPort('q')).toBe(0);
    expect(sim.readPort('qn')).toBe(1);
  });

  it('时序模式下同样是「有记忆」的', () => {
    const sim = new Simulator(buildSRLatch(), { mode: 'timing' });
    sim.setInputs({ s: 0, r: 1 });
    sim.advanceTo(sim.time + 200_000);
    expect(sim.readPort('q')).toBe(1);
    sim.setInputs({ s: 1, r: 1 });
    sim.advanceTo(sim.time + 200_000);
    expect(sim.readPort('q')).toBe(1);
  });
});

describe('节点归约规则', () => {
  it('两个强驱动冲突 → X + drive-conflict 错误', () => {
    const b = new NetlistBuilder();
    const n = b.node('N');
    b.power(n, 1);
    b.power(n, 0);
    b.output(n, 'y');
    const sim = new Simulator(b.build(), { mode: 'logic' });
    sim.settle();
    expect(sim.readPort('y')).toBe('X');
    const diag = sim.allDiagnostics.find((d) => d.kind === 'drive-conflict');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('error');
  });

  it('两个弱驱动对拉（电阻分压）→ X + resistive-tie 警告', () => {
    const b = new NetlistBuilder();
    const vcc = b.node('VCC');
    const gnd = b.node('GND');
    const mid = b.node('MID');
    b.power(vcc, 1);
    b.power(gnd, 0);
    b.res(vcc, mid, 'R1');
    b.res(mid, gnd, 'R2');
    b.output(mid, 'y');
    const sim = new Simulator(b.build(), { mode: 'logic' });
    sim.settle();
    expect(sim.readPort('y')).toBe('X');
    expect(sim.allDiagnostics.some((d) => d.kind === 'resistive-tie')).toBe(true);
  });

  it('强驱动压过弱驱动（这是 RTL 上拉/下拉能工作的前提）', () => {
    const b = new NetlistBuilder();
    const vcc = b.node('VCC');
    const gnd = b.node('GND');
    const inNode = b.node('IN');
    const mid = b.node('MID');
    b.power(vcc, 1);
    b.power(gnd, 0);
    b.res(vcc, mid, 'R1'); // 弱 1 上拉
    b.input(inNode, 'in'); // 强驱动
    b.res(inNode, mid, 'R2'); // 无论输入如何，只经电阻 → 依然弱
    b.output(mid, 'y');
    const sim = new Simulator(b.build(), { mode: 'logic' });
    sim.setInput('in', 0);
    // 上拉 R1（弱 1）与经 R2 传来的弱 0 对拉 → X（分压不确定，符合文档约定）
    expect(sim.readPort('y')).toBe('X');

    // 换成三极管强拉低：强驱动胜出
    const b2 = new NetlistBuilder();
    const vcc2 = b2.node('VCC');
    const gnd2 = b2.node('GND');
    const in2 = b2.node('IN');
    const base = b2.node('BASE');
    const out2 = b2.node('OUT');
    b2.power(vcc2, 1);
    b2.power(gnd2, 0);
    b2.res(vcc2, out2, 'R1');
    b2.res(in2, base, 'R2');
    b2.npn(out2, base, gnd2, 'Q1');
    b2.input(in2, 'in');
    b2.output(out2, 'y');
    const sim2 = new Simulator(b2.build(), { mode: 'logic' });
    sim2.setInput('in', 1);
    expect(sim2.readPort('y')).toBe(0);
  });
});

describe('IR 装配器', () => {
  it('CSR 邻接表覆盖所有驱动/读取关系', () => {
    const b = new NetlistBuilder();
    const a = b.node('A');
    const c = b.node('C');
    const e = b.res(a, c);
    const net = b.build();
    expect(net.elemCount).toBe(1);
    expect(net.elemKind[e]).toBe(ElementKind.RES);
    expect(net.watchStart[a]).toBe(0);
    expect(net.watchStart[c]).toBe(1);
    expect(net.driveStart[c + 1]).toBe(2);
  });
});
