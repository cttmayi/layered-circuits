import { describe, expect, it } from 'vitest';
import { Simulator } from '../src/engine.js';
import { allInputCombinations, runVectors } from '../src/harness.js';
import { NetlistBuilder } from '../src/ir.js';

/** CMOS 反相器：上 pMOS 下 nMOS，栅并接输入，无电阻、轨到轨推挽输出 */
function buildCmosInverter(): FlatNetLike {
  const b = new NetlistBuilder();
  const y = b.node('y');
  const a = b.node('a');
  const vcc = b.node('vcc');
  const gnd = b.node('gnd');
  b.power(vcc, 1);
  b.power(gnd, 0);
  b.pmos(y, a, vcc, 'P1');
  b.nmos(y, a, gnd, 'N1');
  b.input(a, 'a', 'a');
  b.output(y, 'y', 'y');
  return b.build();
}

/** CMOS 与非门：上 pMOS 并联、下 nMOS 串联 */
function buildCmosNand(): FlatNetLike {
  const b = new NetlistBuilder();
  const y = b.node('y');
  const a = b.node('a');
  const c = b.node('c');
  const vcc = b.node('vcc');
  const gnd = b.node('gnd');
  const m = b.node('m');
  b.power(vcc, 1);
  b.power(gnd, 0);
  b.pmos(y, a, vcc, 'P1');
  b.pmos(y, c, vcc, 'P2');
  b.nmos(m, a, gnd, 'N1');
  b.nmos(y, c, m, 'N2');
  b.input(a, 'a', 'a');
  b.input(c, 'c', 'c');
  b.output(y, 'y', 'y');
  return b.build();
}

type FlatNetLike = ReturnType<NetlistBuilder['build']>;

describe('CMOS 反相器（2 MOS 无电阻，轨到轨推挽）', () => {
  it('真值表全通过：a → ¬y', () => {
    const result = runVectors(
      buildCmosInverter(),
      [
        { inputs: { a: 0 }, expect: { y: 1 } },
        { inputs: { a: 1 }, expect: { y: 0 } },
      ],
      { mode: 'logic' },
    );
    expect(result.pass).toBe(true);
    expect(result.rows.map((r) => r.actual.y)).toEqual([1, 0]);
  });

  it('输出是强驱动（推挽）：a=1 时 y 被 nMOS 拉到强 0，a=0 时被 pMOS 拉到强 1', () => {
    const sim = new Simulator(buildCmosInverter(), { mode: 'logic' });
    sim.setInput('a', 0);
    sim.settle();
    expect(sim.readPort('y')).toBe(1);
    sim.setInput('a', 1);
    sim.settle();
    expect(sim.readPort('y')).toBe(0);
  });
});

describe('CMOS 与非门（4 MOS 无电阻）', () => {
  it('真值表全通过：双高才拉低', () => {
    const result = runVectors(
      buildCmosNand(),
      allInputCombinations(['a', 'c']).map((inputs) => ({
        inputs,
        expect: { y: inputs.a === 1 && inputs.c === 1 ? 0 : 1 },
      })),
      { mode: 'logic' },
    );
    expect(result.pass).toBe(true);
    expect(result.rows.map((r) => r.actual.y)).toEqual([1, 1, 1, 0]);
  });
});

describe('P-MOS / N-MOS 开关语义', () => {
  it('pMOS 栅极悬空不导通（高阻），栅极高电平截止', () => {
    const b = new NetlistBuilder();
    const y = b.node('y');
    const a = b.node('a');
    const vcc = b.node('vcc');
    b.power(vcc, 1);
    b.pmos(y, a, vcc, 'P1'); // 只有 pMOS 上拉
    b.input(a, 'a', 'a');
    b.output(y, 'y', 'y');
    const sim = new Simulator(b.build(), { mode: 'logic' });
    sim.setInput('a', 1); // pMOS 栅高 → 截止 → y 悬空
    sim.settle();
    expect(sim.readPort('y')).toBe('Z');
    sim.setInput('a', 0); // pMOS 栅低 → 导通 → y = 强 1
    sim.settle();
    expect(sim.readPort('y')).toBe(1);
  });

  it('nMOS 栅极高电平导通，栅低截止', () => {
    const b = new NetlistBuilder();
    const y = b.node('y');
    const a = b.node('a');
    const gnd = b.node('gnd');
    const vcc = b.node('vcc');
    b.power(vcc, 1);
    b.power(gnd, 0);
    b.res(vcc, y, 'R'); // 弱上拉：nMOS 截止时 y = 弱 1
    b.nmos(y, a, gnd, 'N1');
    b.input(a, 'a', 'a');
    b.output(y, 'y', 'y');
    const sim = new Simulator(b.build(), { mode: 'logic' });
    sim.setInput('a', 1); // nMOS 导通 → y = 强 0（压过弱上拉）
    sim.settle();
    expect(sim.readPort('y')).toBe(0);
    sim.setInput('a', 0); // nMOS 截止 → y = 弱 1
    sim.settle();
    expect(sim.readPort('y')).toBe(1);
  });
});
