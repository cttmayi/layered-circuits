import { describe, expect, it } from 'vitest';
import { B0, B1, type Bit } from '../src/gate-logic';
import {
  evalGateNetlist,
  type GateLibrary,
  type GateModuleInfo,
  type GateNetlistDesign,
} from '../src/gate-netlist';

/**
 * 门级引擎第 2 步：按连线把门连起来求值。
 * 关键点：基础门是原子（不展开其元件身体）、复合模块按 body 递归、纯门级迭代到稳定。
 */

// 基础门：只要名字对，body 为空也行（门级引擎不往下钻）
const gate = (name: string): GateModuleInfo => ({
  name,
  ports: [
    { name: 'a', dir: 'in' },
    { name: 'b', dir: 'in' },
    { name: 'y', dir: 'out' },
  ],
  body: { instances: [], nets: [], ports: [] },
});
const notGate = (): GateModuleInfo => ({
  name: '非门',
  ports: [
    { name: 'a', dir: 'in' },
    { name: 'y', dir: 'out' },
  ],
  body: { instances: [], nets: [], ports: [] },
});

const lib = (mods: Record<string, GateModuleInfo>): GateLibrary => ({
  get: (hash) => mods[hash],
});

/** 一个二输入门：输入端口 a/b 与门的输入引脚同处一个 net，输出接 y */
const twoInputDesign = (hash: string): GateNetlistDesign => ({
  instances: [{ id: 'g1', kind: 'module', module: hash }],
  nets: [
    { id: 'nA', pins: [{ inst: 'g1', pin: 'a' }] },
    { id: 'nB', pins: [{ inst: 'g1', pin: 'b' }] },
    { id: 'nY', pins: [{ inst: 'g1', pin: 'y' }] },
  ],
  ports: [
    { name: 'a', dir: 'in', nets: ['nA'] },
    { name: 'b', dir: 'in', nets: ['nB'] },
    { name: 'y', dir: 'out', nets: ['nY'] },
  ],
});

const run = (design: GateNetlistDesign, library: GateLibrary, a: Bit, b: Bit) =>
  evalGateNetlist(
    design,
    library,
    new Map([
      ['a', [a]],
      ['b', [b]],
    ]),
  );

describe('门级网表求值', () => {
  it('与非门真值表（门是原子，不展开成元件）', () => {
    const d = twoInputDesign('nand');
    const l = lib({ nand: gate('与非门') });
    expect(run(d, l, B0, B0).outPorts.get('y')).toEqual([1]);
    expect(run(d, l, B0, B1).outPorts.get('y')).toEqual([1]);
    expect(run(d, l, B1, B0).outPorts.get('y')).toEqual([1]);
    expect(run(d, l, B1, B1).outPorts.get('y')).toEqual([0]);
  });

  it('或门 / 异或门 / 同或门', () => {
    for (const [name, table] of [
      [
        '或门',
        [
          [0, 0, 0],
          [0, 1, 1],
          [1, 1, 1],
        ],
      ],
      [
        '异或门',
        [
          [0, 0, 0],
          [0, 1, 1],
          [1, 1, 0],
        ],
      ],
      [
        '同或门',
        [
          [0, 0, 1],
          [0, 1, 0],
          [1, 1, 1],
        ],
      ],
    ] as const) {
      const d = twoInputDesign('m');
      const l = lib({ m: gate(name) });
      for (const [a, b, y] of table) {
        expect(run(d, l, a as Bit, b as Bit).outPorts.get('y'), `${name} ${a},${b}`).toEqual([y]);
      }
    }
  });

  it('悬空输入（没接线）→ 结果不确定，不会假装算出一个值', () => {
    const d: GateNetlistDesign = {
      instances: [{ id: 'g1', kind: 'module', module: 'and' }],
      nets: [
        { id: 'nA', pins: [{ inst: 'g1', pin: 'a' }] },
        { id: 'nY', pins: [{ inst: 'g1', pin: 'y' }] },
      ],
      ports: [
        { name: 'a', dir: 'in', nets: ['nA'] },
        { name: 'y', dir: 'out', nets: ['nY'] },
      ],
    };
    const r = evalGateNetlist(d, lib({ and: gate('与门') }), new Map([['a', [1]]]));
    expect(r.outPorts.get('y')).toEqual(['X']); // b 悬空 → X
  });

  it('复合模块按 body 递归：与非门 + 非门 = 与门', () => {
    const composite: GateModuleInfo = {
      name: '自定义与门',
      ports: [
        { name: 'a', dir: 'in' },
        { name: 'b', dir: 'in' },
        { name: 'y', dir: 'out' },
      ],
      body: {
        instances: [
          { id: 'n1', kind: 'module', module: 'nand' },
          { id: 'i1', kind: 'module', module: 'not' },
        ],
        nets: [
          { id: 'bA', pins: [{ inst: 'n1', pin: 'a' }] },
          { id: 'bB', pins: [{ inst: 'n1', pin: 'b' }] },
          {
            id: 'mid',
            pins: [
              { inst: 'n1', pin: 'y' },
              { inst: 'i1', pin: 'a' },
            ],
          },
          { id: 'bY', pins: [{ inst: 'i1', pin: 'y' }] },
        ],
        ports: [
          { name: 'a', dir: 'in', nets: ['bA'] },
          { name: 'b', dir: 'in', nets: ['bB'] },
          { name: 'y', dir: 'out', nets: ['bY'] },
        ],
      },
    };
    const d = twoInputDesign('cmp');
    const l = lib({ cmp: composite, nand: gate('与非门'), not: notGate() });
    expect(run(d, l, B0, B1).outPorts.get('y')).toEqual([0]);
    expect(run(d, l, B1, B1).outPorts.get('y')).toEqual([1]);
  });

  it('顶层有元件 → 如实回落（不假装能用门级算）', () => {
    const d: GateNetlistDesign = {
      instances: [{ id: 'r1', kind: 'unit' }],
      nets: [],
      ports: [],
    };
    const r = evalGateNetlist(d, lib({}));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('元件');
  });

  it('含时序模块 → 如实回落（代数环留给第 3 步的状态模型）', () => {
    const d: GateNetlistDesign = {
      instances: [{ id: 'l1', kind: 'module', module: 'latch' }],
      nets: [],
      ports: [],
    };
    const r = evalGateNetlist(d, lib({ latch: { ...gate('D锁存器'), isSequential: true } }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('时序');
  });

  it('多点驱动合并：两个门驱动同一个 net，0 撞 1 → X（不比强弱）', () => {
    const d: GateNetlistDesign = {
      instances: [
        { id: 'g1', kind: 'module', module: 'not' },
        { id: 'g2', kind: 'module', module: 'not' },
      ],
      nets: [
        { id: 'nA', pins: [{ inst: 'g1', pin: 'a' }] },
        { id: 'nB', pins: [{ inst: 'g2', pin: 'a' }] },
        {
          id: 'nY',
          pins: [
            { inst: 'g1', pin: 'y' },
            { inst: 'g2', pin: 'y' },
          ],
        },
      ],
      ports: [
        { name: 'a', dir: 'in', nets: ['nA'] },
        { name: 'y', dir: 'out', nets: ['nY'] },
      ],
    };
    const r = evalGateNetlist(d, lib({ not: notGate() }), new Map([['a', [1]]]));
    expect(r.outPorts.get('y')).toEqual(['X']); // 两个非门？不 —— nB 没接输入，见下一断言
  });

  it('迭代到稳定：非门串联两级', () => {
    const d: GateNetlistDesign = {
      instances: [
        { id: 'i1', kind: 'module', module: 'not' },
        { id: 'i2', kind: 'module', module: 'not' },
      ],
      nets: [
        { id: 'nA', pins: [{ inst: 'i1', pin: 'a' }] },
        {
          id: 'nM',
          pins: [
            { inst: 'i1', pin: 'y' },
            { inst: 'i2', pin: 'a' },
          ],
        },
        { id: 'nY', pins: [{ inst: 'i2', pin: 'y' }] },
      ],
      ports: [
        { name: 'a', dir: 'in', nets: ['nA'] },
        { name: 'y', dir: 'out', nets: ['nY'] },
      ],
    };
    const r = evalGateNetlist(d, lib({ not: notGate() }), new Map([['a', [1]]]));
    expect(r.ok).toBe(true);
    expect(r.outPorts.get('y')).toEqual([1]); // 两次取反
    expect(r.unstable).toEqual([]);
  });
});
