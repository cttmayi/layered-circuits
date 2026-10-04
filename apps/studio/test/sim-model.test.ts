// @vitest-environment node
/**
 * 计算模型说明书（用测试钉住）。
 *
 * 两个模式不是"同一套算法跑不同步长"，而是两种不同的算法：
 *
 * - 逻辑模式：**没有时间**。所有元素进 FIFO，谁被唤醒就重算自己对所在网的贡献，
 *   网的值 = 所有贡献按强度仲裁的结果；某个网的值变了 → 把读它的元件再排进 FIFO。
 *   队列空 = 收敛 = 答案（组合电路的稳定值就是这套更新的不动点）。
 *   延迟在这条路径上完全不参与 —— 所以 12 个元素的电路只要几十次求值，t 恒为 0。
 *
 * - 时序模式：**离散事件**，不是"每 X ps 走一步"。元件被唤醒时不是立刻求值，而是
 *   排在 `变化时刻 + 自己的延迟` 上（三极管 1000 ps、电阻 500 ps…）；队列按时刻推进，
 *   没有事件的时间段直接跳过。关键路径 = 实测的"输出什么时候不再变"，
 *   你那个两级串联模块的 2.00 ns 就是这么量出来的。
 */
import { compileDesign } from '@lc/compiler';
import { findLevel, teachingModulesFor } from '@lc/content';
import { InMemoryModuleLibrary } from '@lc/schema';
import { Simulator } from '@lc/sim-core';
import { describe, expect, it } from 'vitest';
import { createSym, type Doc, type StoredModule, toDesign } from '../src/editor/model';
import { docForLevel } from '../src/level/progress';
import { handleRequest } from '../src/sim/handle';

const stored: StoredModule[] = teachingModulesFor('rtl').map((m) => ({
  hash: m.hash,
  name: m.name,
  version: m.version,
  stage: m.stage,
  costHalf: m.costHalf,
  isSequential: m.isSequential,
  ports: m.ports,
  template: m,
  sources: [] as string[],
  createdAt: 0,
}));

/** 两级三极管串联反相器（16 半单位 / 2.0 ns）：信号要经内部中间节点中转两级 */
const stackedDesign = {
  schemaVersion: 1 as const,
  id: 'stack-not',
  name: '非门',
  instances: [
    { kind: 'vcc' as const, id: 'vcc1' },
    { kind: 'gnd' as const, id: 'gnd1' },
    { kind: 'unit' as const, id: 'q1', unit: 'npn' as const },
    { kind: 'unit' as const, id: 'q2', unit: 'npn' as const },
    { kind: 'unit' as const, id: 'r1', unit: 'res' as const },
    { kind: 'unit' as const, id: 'r2', unit: 'res' as const },
  ],
  nets: [
    { id: 'na', pins: [{ inst: 'q1', pin: 'b', bit: 0 }] },
    {
      id: 'ng',
      pins: [
        { inst: 'gnd1', pin: 'p', bit: 0 },
        { inst: 'q1', pin: 'e', bit: 0 },
      ],
    },
    {
      id: 'nm',
      pins: [
        { inst: 'q1', pin: 'c', bit: 0 },
        { inst: 'q2', pin: 'e', bit: 0 },
      ],
    },
    {
      id: 'nv',
      pins: [
        { inst: 'vcc1', pin: 'p', bit: 0 },
        { inst: 'q2', pin: 'b', bit: 0 },
        { inst: 'r1', pin: 'a', bit: 0 },
        { inst: 'r2', pin: 'a', bit: 0 },
      ],
    },
    {
      id: 'ny',
      pins: [
        { inst: 'q2', pin: 'c', bit: 0 },
        { inst: 'r1', pin: 'b', bit: 0 },
        { inst: 'r2', pin: 'b', bit: 0 },
      ],
    },
  ],
  ports: [
    { id: 'a', name: 'a', dir: 'in' as const, width: 1, nets: ['na'] },
    { id: 'y', name: 'y', dir: 'out' as const, width: 1, nets: ['ny'] },
  ],
};

/** 把关卡画布接成 sn → 模块.a、模块.y → q，并编译成平面网 */
function srCanvasWithModule(): {
  net: ReturnType<typeof compileDesign>['net'];
  sim: (mode: 'logic' | 'timing') => Simulator;
} {
  const wrapped = handleRequest({
    id: 1,
    type: 'wrap',
    library: [],
    name: '非门',
    stage: 1,
    design: stackedDesign,
  }).wrapped!;
  const mod: StoredModule = {
    hash: wrapped.hash,
    name: '非门',
    version: '1.0',
    stage: 1,
    costHalf: wrapped.costHalf,
    isSequential: false,
    ports: wrapped.ports,
    template: wrapped.template as StoredModule['template'],
    sources: [] as string[],
    createdAt: 0,
  };
  const library = [...stored, mod];
  const level = findLevel('s2-sr-latch')!;
  const base = docForLevel(level, library);
  const u1 = createSym(base, 'module', undefined, 300, 320, wrapped.hash);
  const doc: Doc = {
    ...base,
    syms: [...base.syms, u1],
    wires: [
      { id: 'w1', a: { inst: 'in-sn', pin: 'p', bit: 0 }, b: { inst: u1.id, pin: 'a', bit: 0 } },
      { id: 'w2', a: { inst: u1.id, pin: 'y', bit: 0 }, b: { inst: 'out-q', pin: 'p', bit: 0 } },
    ],
  };
  const lib = new InMemoryModuleLibrary(library.map((m) => m.template) as never);
  const { net } = compileDesign(toDesign(doc), { library: lib });
  return { net, sim: (mode) => new Simulator(net, { mode }) };
}

const text = (s: number): string =>
  s === 0 ? 'Z' : `${['0', '1', 'X'][s & 3]}${['', '·弱', '·强', '·供电'][s >> 2]}`;

describe('计算模型', () => {
  it('逻辑模式：没有时间，迭代到收敛即为答案（几十次求值，不是几千次）', () => {
    const { net, sim: make } = srCanvasWithModule();
    const q = net.ports.find((p) => p.name === 'q')!;
    const sim = make('logic');
    sim.setInput('sn', 1);
    sim.setInput('rn', 0);
    const first = sim.stats.evaluations;
    expect(text(sim.signalOf(q.node))).toBe('0·强');
    sim.setInput('sn', 0);
    expect(text(sim.signalOf(q.node))).toBe('1·弱');
    // 求值次数是"元素数 × 几遍"，不是时间步数；时间概念在逻辑模式下恒为 0
    expect(first).toBeLessThanOrEqual(net.elemCount * 5);
    expect(sim.stats.evaluations - first).toBeLessThanOrEqual(net.elemCount * 5);
    expect(sim.time).toBe(0);
  });

  it('时序模式：事件驱动的到达时间轴，队列在 2.00 ns 排空（= 关键路径）', () => {
    const { net, sim: make } = srCanvasWithModule();
    const q = net.ports.find((p) => p.name === 'q')!;
    const sim = make('timing');
    sim.setInput('sn', 1);
    sim.setInput('rn', 0);
    sim.advanceTo(3000);
    expect(text(sim.signalOf(q.node))).toBe('0·强');
    sim.setInput('sn', 0);
    // 500 ps：输入已经变了，但事件还在路上（没有"空转重算"）
    sim.advanceTo(3500);
    expect(sim.isQuiescent).toBe(false);
    // 1000 ps：q 已经翻到 1·弱，但还有后续事件（第二级在 2000 ps 才收尾）
    sim.advanceTo(4000);
    expect(text(sim.signalOf(q.node))).toBe('1·弱');
    expect(sim.isQuiescent).toBe(false);
    // 2000 ps：队列排空 —— 这就是模块实测的 2.00 ns 关键路径
    sim.advanceTo(5000);
    expect(sim.isQuiescent).toBe(true);
    expect(text(sim.signalOf(q.node))).toBe('1·弱');
  });
});
