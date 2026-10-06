import { describe, expect, it } from 'vitest';
import type { Bit } from '../src/gate-logic';
import {
  evalGateNetlist,
  type GateLibrary,
  type GateModuleInfo,
  type GateNetlistDesign,
} from '../src/gate-netlist';
import { GateStateStore, settleGateSteps } from '../src/gate-seq';

/**
 * 总线支持：端口有 width，每个位各自绑一个 net —— 门级引擎必须**按位**算，
 * 否则 4 位加法器 / 8 位寄存器 / 7 段数码管这类关会算错（不是慢，是错）。
 */

const gate = (name: string, width: number): GateModuleInfo => ({
  name,
  ports: [
    { name: 'a', dir: 'in', width },
    { name: 'y', dir: 'out', width },
  ],
  body: { instances: [], nets: [], ports: [] },
});

const lib = (mods: Record<string, GateModuleInfo>): GateLibrary => ({ get: (h) => mods[h] });

/** 2 位非门：a0/a1 两个 net 进，y0/y1 两个 net 出 */
const notDesign = (): GateNetlistDesign => ({
  instances: [{ id: 'n1', kind: 'module', module: 'not2' }],
  nets: [
    { id: 'a0', pins: [{ inst: 'n1', pin: 'a', bit: 0 }] },
    { id: 'a1', pins: [{ inst: 'n1', pin: 'a', bit: 1 }] },
    { id: 'y0', pins: [{ inst: 'n1', pin: 'y', bit: 0 }] },
    { id: 'y1', pins: [{ inst: 'n1', pin: 'y', bit: 1 }] },
  ],
  ports: [
    { name: 'a', dir: 'in', width: 2, nets: ['a0', 'a1'] },
    { name: 'y', dir: 'out', width: 2, nets: ['y0', 'y1'] },
  ],
});

describe('门级引擎的总线（按位）支持', () => {
  it('2 位非门：逐位取反，不会把两个位当成一个', () => {
    const r = evalGateNetlist(
      notDesign(),
      lib({ not2: gate('非门', 2) }),
      new Map([['a', [1, 0]]]),
    );
    expect(r.ok).toBe(true);
    expect(r.outPorts.get('y')).toEqual([0, 1]);
  });

  it('2 位异或门：按位异或', () => {
    const d: GateNetlistDesign = {
      instances: [{ id: 'x1', kind: 'module', module: 'xor2' }],
      nets: [
        { id: 'a0', pins: [{ inst: 'x1', pin: 'a', bit: 0 }] },
        { id: 'a1', pins: [{ inst: 'x1', pin: 'a', bit: 1 }] },
        { id: 'b0', pins: [{ inst: 'x1', pin: 'b', bit: 0 }] },
        { id: 'b1', pins: [{ inst: 'x1', pin: 'b', bit: 1 }] },
        { id: 'y0', pins: [{ inst: 'x1', pin: 'y', bit: 0 }] },
        { id: 'y1', pins: [{ inst: 'x1', pin: 'y', bit: 1 }] },
      ],
      ports: [
        { name: 'a', dir: 'in', width: 2, nets: ['a0', 'a1'] },
        { name: 'b', dir: 'in', width: 2, nets: ['b0', 'b1'] },
        { name: 'y', dir: 'out', width: 2, nets: ['y0', 'y1'] },
      ],
    };
    const m: GateModuleInfo = {
      name: '异或门',
      ports: [
        { name: 'a', dir: 'in', width: 2 },
        { name: 'b', dir: 'in', width: 2 },
        { name: 'y', dir: 'out', width: 2 },
      ],
      body: { instances: [], nets: [], ports: [] },
    };
    const r = evalGateNetlist(
      d,
      lib({ xor2: m }),
      new Map([
        ['a', [1, 0]],
        ['b', [1, 1]],
      ]),
    );
    expect(r.outPorts.get('y')).toEqual([0, 1]);
  });

  it('2 位锁存器：整组一起透明 / 一起保持', () => {
    const dl: GateModuleInfo = {
      name: 'D锁存器',
      isSequential: true,
      seq: { clock: 'en', data: ['d'], mode: 'level' },
      ports: [
        { name: 'd', dir: 'in', width: 2 },
        { name: 'en', dir: 'in' },
        { name: 'q', dir: 'out', width: 2 },
      ],
      body: { instances: [], nets: [], ports: [] },
    };
    const d: GateNetlistDesign = {
      instances: [{ id: 'L1', kind: 'module', module: 'dl2' }],
      nets: [
        { id: 'd0', pins: [{ inst: 'L1', pin: 'd', bit: 0 }] },
        { id: 'd1', pins: [{ inst: 'L1', pin: 'd', bit: 1 }] },
        { id: 'en', pins: [{ inst: 'L1', pin: 'en' }] },
        { id: 'q0', pins: [{ inst: 'L1', pin: 'q', bit: 0 }] },
        { id: 'q1', pins: [{ inst: 'L1', pin: 'q', bit: 1 }] },
      ],
      ports: [
        { name: 'd', dir: 'in', width: 2, nets: ['d0', 'd1'] },
        { name: 'en', dir: 'in', nets: ['en'] },
        { name: 'q', dir: 'out', width: 2, nets: ['q0', 'q1'] },
      ],
    };
    const l = lib({ dl2: dl });
    const st = new GateStateStore();
    const run = (dv: Bit[], ev: Bit): Bit[] | undefined =>
      settleGateSteps(
        d,
        l,
        new Map([
          ['d', dv],
          ['en', [ev]],
        ]),
        st,
      ).outPorts.get('q');

    expect(run([1, 0], 1)).toEqual([1, 0]); // 透明写入
    expect(run([0, 1], 0)).toEqual([1, 0]); // 保持住刚才的 2 位
    expect(run([0, 1], 1)).toEqual([0, 1]); // 再写入
    expect(st.get('L1', 'q', 1)).toBe(1); // 状态按位保存
  });
});
