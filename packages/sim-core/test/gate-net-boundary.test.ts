import { describe, expect, it } from 'vitest';
import type { Bit } from '../src/gate-logic';
import type { GateLibrary, GateModuleInfo, GateNetlistDesign } from '../src/gate-netlist';
import { evalGateNetlist } from '../src/gate-netlist';
import { GateStateStore, settleGateSteps } from '../src/gate-seq';

/**
 * **跨模块边界的 net 传播**（真 bug 的防复发凭据）。
 *
 * 立这条测试的起因：s3-calc 的门级读数里，【运算控制】输出的 `accClk` 网与
 * 【八位寄存器】的 `clk` 端口引脚**出现读数不一致**的嫌疑。而"一个引脚必须读到它所在的
 * net 的值"是引擎的基本不变量 —— 网是 1，接在这个网上的引脚就必须是 1。
 *
 * 本用例把这个不变量钉在**两层嵌套**上（模拟 运算控制 → 八位寄存器 这种关系）：
 *   top：输入 `a`/`one` →【与门 g】把 `accClk` 网驱动为 1；
 *   `accClk` 网同时接**子模块 r1（"寄存器"，第一层）** 的 `clk` 输入端口；
 *   r1 内部把该输入接到**子模块 leaf（第二层）** 的两个输入上；
 *   leaf 内部是【与门】，输出 = i & j = 输入本身。
 * 于是"顶层 q 读到 1"只有在**跨两层边界传播无损**时才成立。
 */
const andGate: GateModuleInfo = {
  name: '与门',
  ports: [
    { name: 'a', dir: 'in' },
    { name: 'b', dir: 'in' },
    { name: 'y', dir: 'out' },
  ],
  body: { instances: [], nets: [], ports: [] },
};

/** 第二层：leaf = 一个与门，两个输入都从端口来，输出直接引到端口 */
const leaf: GateModuleInfo = {
  name: '叶模块',
  ports: [
    { name: 'i', dir: 'in' },
    { name: 'j', dir: 'in' },
    { name: 'o', dir: 'out' },
  ],
  body: {
    instances: [{ id: 'g1', kind: 'module', module: 'and' }],
    nets: [
      { id: 'a2', pins: [{ inst: 'g1', pin: 'a' }] },
      { id: 'b2', pins: [{ inst: 'g1', pin: 'b' }] },
      { id: 'y2', pins: [{ inst: 'g1', pin: 'y' }] },
    ],
    ports: [
      { name: 'i', dir: 'in', nets: ['a2'] },
      { name: 'j', dir: 'in', nets: ['b2'] },
      { name: 'o', dir: 'out', nets: ['y2'] },
    ],
  },
};

/** 第一层：寄存器外壳 —— 把唯一输入端口同时接到 leaf 的两个输入（输出 = 输入）*/
const regShell: GateModuleInfo = {
  name: '寄存器外壳',
  ports: [
    { name: 'clk', dir: 'in' },
    { name: 'q', dir: 'out' },
  ],
  body: {
    instances: [{ id: 'm2', kind: 'module', module: 'leaf' }],
    nets: [
      // 关键：同一条内部 net 同时挂**两个**引脚（"一名多脚"在真实设计里是常态）
      {
        id: 'n_i',
        pins: [
          { inst: 'm2', pin: 'i' },
          { inst: 'm2', pin: 'j' },
        ],
      },
      { id: 'n_o', pins: [{ inst: 'm2', pin: 'o' }] },
    ],
    ports: [
      { name: 'clk', dir: 'in', nets: ['n_i'] },
      { name: 'q', dir: 'out', nets: ['n_o'] },
    ],
  },
};

const lib: GateLibrary = {
  get: (h) => (h === 'and' ? andGate : h === 'leaf' ? leaf : h === 'reg' ? regShell : undefined),
};

/** 顶层：与门把 accClk 驱动为 1，accClk 接子模块 r1 的 clk 端口 */
const top: GateNetlistDesign = {
  instances: [
    { id: 'g', kind: 'module', module: 'and' },
    { id: 'r1', kind: 'module', module: 'reg' },
  ],
  nets: [
    { id: 'drive', pins: [{ inst: 'g', pin: 'a' }] },
    { id: 'one', pins: [{ inst: 'g', pin: 'b' }] },
    // 同一条 net：既挂顶层与门的输出脚，又挂子模块的输入脚
    {
      id: 'accClk',
      pins: [
        { inst: 'g', pin: 'y' },
        { inst: 'r1', pin: 'clk' },
      ],
    },
    { id: 'qout', pins: [{ inst: 'r1', pin: 'q' }] },
  ],
  ports: [
    { name: 'a', dir: 'in', nets: ['drive'] },
    { name: 'one', dir: 'in', nets: ['one'] },
    { name: 'q', dir: 'out', nets: ['qout'] },
  ],
};

// Bit 是**数字** 0/1（'X'/'Z' 才是字符串）—— 见 gate-logic.ts
const inputs = (a: 0 | 1 | 'Z' | 'X') =>
  new Map<string, Bit[]>([
    ['a', [a]],
    ['one', [1]],
  ]);

describe('跨模块边界：顶层 net 驱动为 1，子模块（两层嵌套）必须读到 1', () => {
  it('组合求值：子模块读到的就是那条 net 的值', () => {
    // 不变量本身：网是 1，接在这个网上的引脚就必须读到 1
    const idx = evalGateNetlist(top, lib, inputs(1));
    expect(idx.ok).toBe(true);
    expect(idx.nets.get('accClk')).toBe(1);
    expect(idx.outPorts.get('q')).toEqual([1]);
  });

  it('驱动为 0 时子模块读到 0（不是恒 1，也不是 Z）', () => {
    const idx = evalGateNetlist(top, lib, inputs(0));
    expect(idx.nets.get('accClk')).toBe(0);
    expect(idx.outPorts.get('q')).toEqual([0]);
  });

  it('带状态的入口（settleGateSteps）同样把 1 传过两层边界', () => {
    const st = new GateStateStore();
    const out = settleGateSteps(top, lib, inputs(1), st);
    expect(out.ok).toBe(true);
    expect(out.outPorts.get('q')).toEqual([1]);
    // 顶层 accClk 网与"子模块 clk 引脚"必须同值 —— 这就是本用例要钉的不变量
    expect(out.nets.get('accClk')).toBe(1);
  });
});
