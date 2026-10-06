import { describe, expect, it } from 'vitest';
import type { Bit } from '../src/gate-logic';
import type { GateLibrary, GateModuleInfo, GateNetlistDesign } from '../src/gate-netlist';
import { GateStateStore, settleGateSteps } from '../src/gate-seq';

/**
 * 用门搭的锁存器 = **反馈环**。零延迟下这种环可能有两个稳定解，迭代会来回振荡；
 * 标准做法是"**稳定不下来就保持上一次的值**"（没有有效激励时它不该改变）。
 * 这条语义正是 s2-sr-latch / s2-btn-latch / s2-d-latch 三关需要的东西。
 */

const nand: GateModuleInfo = {
  name: '与非门',
  ports: [
    { name: 'a', dir: 'in' },
    { name: 'b', dir: 'in' },
    { name: 'y', dir: 'out' },
  ],
  body: { instances: [], nets: [], ports: [] },
};

const lib: GateLibrary = { get: (h) => (h === 'nand' ? nand : undefined) };

/** 经典与非门锁存器：g1 = NAND(s, qb) → q；g2 = NAND(q, r) → qb */
const latchDesign: GateNetlistDesign = {
  instances: [
    { id: 'g1', kind: 'module', module: 'nand' },
    { id: 'g2', kind: 'module', module: 'nand' },
  ],
  nets: [
    { id: 'nS', pins: [{ inst: 'g1', pin: 'a' }] },
    { id: 'nR', pins: [{ inst: 'g2', pin: 'b' }] },
    {
      id: 'nQ',
      pins: [
        { inst: 'g1', pin: 'y' },
        { inst: 'g2', pin: 'a' },
      ],
    },
    {
      id: 'nQB',
      pins: [
        { inst: 'g2', pin: 'y' },
        { inst: 'g1', pin: 'b' },
      ],
    },
  ],
  ports: [
    { name: 's', dir: 'in', nets: ['nS'] },
    { name: 'r', dir: 'in', nets: ['nR'] },
    { name: 'q', dir: 'out', nets: ['nQ'] },
    { name: 'qb', dir: 'out', nets: ['nQB'] },
  ],
};

describe('反馈环锁存器：稳定不下来就保持上一次的值', () => {
  it('置位 → 保持 → 复位（三个动作都正确）', () => {
    const st = new GateStateStore();
    const step = (s: Bit, r: Bit) =>
      settleGateSteps(
        latchDesign,
        lib,
        new Map([
          ['s', [s]],
          ['r', [r]],
        ]),
        st,
      ).outPorts.get('q');

    expect(step(0, 1)).toEqual([1]); // s=0 置位 → q=1
    expect(step(1, 1)).toEqual([1]); // 都无效 → **保持 1**（环振荡 → 用上一次的值）
    expect(step(1, 0)).toEqual([0]); // r=0 复位 → q=0
    expect(step(1, 1)).toEqual([0]); // 再保持 0
  });

  it('环振荡会被如实标记（不假装收敛）', () => {
    const st = new GateStateStore();
    const r = settleGateSteps(
      latchDesign,
      lib,
      new Map([
        ['s', [1]],
        ['r', [1]],
      ]),
      st,
    );
    // 保持语义下输出仍然可用，但引擎要能说出"这轮没收敛"
    expect(r.ok).toBe(true);
    expect(r.outPorts.get('q')?.length).toBe(1);
  });
});
