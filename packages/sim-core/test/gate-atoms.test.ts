import { describe, expect, it } from 'vitest';
import type { Bit } from '../src/gate-logic';
import {
  evalGateNetlist,
  type GateLibrary,
  type GateModuleInfo,
  type GateNetlistDesign,
} from '../src/gate-netlist';

/**
 * 功能原子：全加器 / 多输入或门 —— 身体是**元件电路**（门级引擎没法往下钻），
 * 但功能是确定的，所以在这一层给出等价的门级定义，而不是把元件身体展开。
 * 实测背景：s3-calc 的快路就是被这两个积木挡住的（身体里有 res/dio 元件）。
 */

const atom = (name: string, ins: string[], outs: string[]): GateModuleInfo => ({
  name,
  ports: [
    ...ins.map((n) => ({ name: n, dir: 'in' as const, width: 1 })),
    ...outs.map((n) => ({ name: n, dir: 'out' as const, width: 1 })),
  ],
  body: { instances: [{ id: 'x', kind: 'unit' }], nets: [], ports: [] }, // 身体故意放元件
});

const lib = (mods: Record<string, GateModuleInfo>): GateLibrary => ({ get: (h) => mods[h] });

const design = (hash: string, ins: string[], outs: string[]): GateNetlistDesign => ({
  instances: [{ id: 'u1', kind: 'module', module: hash }],
  nets: [...ins, ...outs].map((n) => ({ id: `n_${n}`, pins: [{ inst: 'u1', pin: n }] })),
  ports: [
    ...ins.map((n) => ({ name: n, dir: 'in' as const, width: 1, nets: [`n_${n}`] })),
    ...outs.map((n) => ({ name: n, dir: 'out' as const, width: 1, nets: [`n_${n}`] })),
  ],
});

describe('功能原子（不展开元件身体）', () => {
  it('全加器：8 种输入的真值表', () => {
    const d = design('fa', ['a', 'b', 'cin'], ['s', 'cout']);
    const l = lib({ fa: atom('全加器', ['a', 'b', 'cin'], ['s', 'cout']) });
    for (const [a, b, cin, s, cout] of [
      [0, 0, 0, 0, 0],
      [0, 0, 1, 1, 0],
      [0, 1, 0, 1, 0],
      [0, 1, 1, 0, 1],
      [1, 0, 0, 1, 0],
      [1, 0, 1, 0, 1],
      [1, 1, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ] as const) {
      const r = evalGateNetlist(
        d,
        l,
        new Map([
          ['a', [a]],
          ['b', [b]],
          ['cin', [cin]],
        ]),
      );
      expect(r.ok, `输入 ${a},${b},${cin}`).toBe(true);
      expect(r.outPorts.get('s'), `s(${a},${b},${cin})`).toEqual([s]);
      expect(r.outPorts.get('cout'), `cout(${a},${b},${cin})`).toEqual([cout]);
    }
  });

  it('多输入或门：任一为 1 即 1，全 0 才 0', () => {
    const d = design('or3', ['a', 'b', 'c'], ['y']);
    const l = lib({ or3: atom('多输入或门', ['a', 'b', 'c'], ['y']) });
    const run = (a: Bit, b: Bit, c: Bit) =>
      evalGateNetlist(
        d,
        l,
        new Map([
          ['a', [a]],
          ['b', [b]],
          ['c', [c]],
        ]),
      ).outPorts.get('y');
    expect(run(0, 0, 0)).toEqual([0]);
    expect(run(0, 1, 0)).toEqual([1]);
    expect(run(1, 0, 1)).toEqual([1]);
    expect(run('X', 1, 0)).toEqual([1]); // Kleene：1 压过不确定
    expect(run('X', 0, 0)).toEqual(['X']); // 全是未知 → 未知（不假装是 0）
  });

  it('身体里有元件也不回落（这正是加功能原子的目的）', () => {
    const d = design('fa', ['a', 'b', 'cin'], ['s', 'cout']);
    const l = lib({ fa: atom('全加器', ['a', 'b', 'cin'], ['s', 'cout']) });
    const r = evalGateNetlist(d, l, new Map());
    expect(r.ok).toBe(true); // 元件在"原子内部"，引擎不看它
  });
});
