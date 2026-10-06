import { describe, expect, it } from 'vitest';
import { beginGateCacheBatch, type GateCacheStats } from '../src/gate-cache';
import type { Bit } from '../src/gate-logic';
import {
  evalGateNetlist,
  type GateLibrary,
  type GateModuleInfo,
  type GateNetlistDesign,
  type GatePort,
  isPureCombinational,
} from '../src/gate-netlist';
import { GateStateStore, settleGateSteps, stepGateNetlist } from '../src/gate-seq';

/**
 * 组合模块求值缓存的护栏。
 *
 * 两条底线：
 *  · **命中之后结果必须一模一样** —— 缓存只影响快不快，不影响算什么；
 *  · **含时序器件的身体绝不能复用缓存** —— 它的输出还取决于上一向量留下的状态，
 *    缓存会把上一向量的结果算错（这正是"宁可不快，不能算错"最容易踩的一脚）。
 *
 * 注：判断"时序器件"**不能只看 `isSequential`** —— 实测教学库里
 * 「八位寄存器 / 数字输入寄存器」的 `isSequential` 是 false，但内部全是主从 D 触发器。
 * 所以这里专门造了这种"标记漏网"的模块来验纯度判定（见 isPureCombinational 的判据）。
 *
 * 接线口径按真实设计来：**一个端口可以带多个 net**（每个 net 接不同实例的引脚），
 * 但一个输出端口只该有一个 net —— 两个 net 都有人驱动就成了多驱动，会按 X 合并。
 */

// ── 测试用门级库 ──
const gateMod = (name: string, ins: string[], out = 'y'): GateModuleInfo => ({
  name,
  ports: [...ins.map((n) => ({ name: n, dir: 'in' as const })), { name: out, dir: 'out' as const }],
  body: { instances: [], nets: [], ports: [] },
});

const lib = (mods: Record<string, GateModuleInfo>): GateLibrary => ({ get: (h) => mods[h] });

/**
 * 测试用复合模块 = **缓存积木**：g1 = a ∧ b，再经 g2 缓冲（与门两输入并接）。
 * 名字**故意不叫「与门 / 异或门」**：那样会被 `isGateName` 当成门级原子
 * （按真值函数算、根本不展开身体），缓存也就没机会生效 —— 这里要验的正是
 * "复合模块递归求值"这条路径。结构只有两级，方便手算核对。
 */
const andBody: GateNetlistDesign = {
  instances: [
    { id: 'g1', kind: 'module', module: 'and' },
    { id: 'g2', kind: 'module', module: 'and' },
  ],
  nets: [
    { id: 'nA', pins: [{ inst: 'g1', pin: 'a' }] },
    { id: 'nB', pins: [{ inst: 'g1', pin: 'b' }] },
    // nC：g1 的输出 + g2 的两个输入（缓冲）
    {
      id: 'nC',
      pins: [
        { inst: 'g1', pin: 'y' },
        { inst: 'g2', pin: 'a' },
        { inst: 'g2', pin: 'b' },
      ],
    },
    { id: 'nY', pins: [{ inst: 'g2', pin: 'y' }] },
  ],
  ports: [
    { name: 'a', dir: 'in', nets: ['nA'] },
    { name: 'b', dir: 'in', nets: ['nB'] },
    { name: 'y', dir: 'out', nets: ['nY'] },
  ],
};

const andMod: GateModuleInfo = {
  name: '测试缓存积木',
  ports: [
    { name: 'a', dir: 'in' },
    { name: 'b', dir: 'in' },
    { name: 'y', dir: 'out' },
  ],
  body: andBody,
};

/** 顶层设计：N 个【测试缓存积木】实例，每个实例各接**自己的端口**（各自一个 net）*/
const andTop = (copies: number): GateNetlistDesign => {
  const instances = Array.from({ length: copies }, (_, i) => ({
    id: `m${i}`,
    kind: 'module',
    module: 'andmod',
  }));
  const nets = instances.flatMap((inst, i) => [
    { id: `nA${i}`, pins: [{ inst: inst.id, pin: 'a' }] },
    { id: `nB${i}`, pins: [{ inst: inst.id, pin: 'b' }] },
    { id: `nY${i}`, pins: [{ inst: inst.id, pin: 'y' }] },
  ]);
  const ports: GatePort[] = instances.flatMap((_v, i) => [
    { name: `a${i}`, dir: 'in' as const, nets: [`nA${i}`] },
    { name: `b${i}`, dir: 'in' as const, nets: [`nB${i}`] },
    { name: `y${i}`, dir: 'out' as const, nets: [`nY${i}`] },
  ]);
  return { instances, nets, ports };
};

/** 顶层设计：1 个【寄存器组】实例（内部是主从 D 触发器）*/
const regTop = (): GateNetlistDesign => ({
  instances: [{ id: 'R1', kind: 'module', module: 'reg' }],
  nets: [
    { id: 'nD', pins: [{ inst: 'R1', pin: 'd' }] },
    { id: 'nC', pins: [{ inst: 'R1', pin: 'clk' }] },
    { id: 'nY', pins: [{ inst: 'R1', pin: 'q' }] },
  ],
  ports: [
    { name: 'd', dir: 'in', nets: ['nD'] },
    { name: 'clk', dir: 'in', nets: ['nC'] },
    { name: 'y', dir: 'out', nets: ['nY'] },
  ],
});

/** 主从 D 触发器（元件级时序积木）：带 SeqSpec，引擎把它当状态元件 */
const dffMod: GateModuleInfo = {
  name: '主从D触发器',
  isSequential: true,
  seq: { clock: 'clk', data: ['d'], mode: 'rising' },
  ports: [
    { name: 'd', dir: 'in' },
    { name: 'clk', dir: 'in' },
    { name: 'q', dir: 'out' },
  ],
  body: { instances: [], nets: [], ports: [] },
};

/** 寄存器组：身体**全是模块**（触发器）→ needsSeqSpec=false，isSequential 也可能漏标 */
const regMod = (isSequential?: boolean): GateModuleInfo => ({
  name: '寄存器组',
  ...(isSequential !== undefined ? { isSequential } : {}),
  ports: [
    { name: 'd', dir: 'in' },
    { name: 'clk', dir: 'in' },
    { name: 'q', dir: 'out' },
  ],
  body: {
    instances: [{ id: 'F1', kind: 'module', module: 'dff' }],
    nets: [
      { id: 'rD', pins: [{ inst: 'F1', pin: 'd' }] },
      { id: 'rC', pins: [{ inst: 'F1', pin: 'clk' }] },
      { id: 'rQ', pins: [{ inst: 'F1', pin: 'q' }] },
    ],
    ports: [
      { name: 'd', dir: 'in', nets: ['rD'] },
      { name: 'clk', dir: 'in', nets: ['rC'] },
      { name: 'q', dir: 'out', nets: ['rQ'] },
    ],
  },
});

const baseLib = (extra: Record<string, GateModuleInfo> = {}): GateLibrary =>
  lib({ and: gateMod('与门', ['a', 'b']), andmod: andMod, dff: dffMod, reg: regMod(), ...extra });

/** 求值一份顶层设计；`cache` 缺省 = 新的一批（与顶层调用口径一致）*/
const evalTop = (
  library: GateLibrary,
  design: GateNetlistDesign,
  bits: Record<string, Bit[]>,
  cache?: ReturnType<typeof beginGateCacheBatch>,
): { ys: (Bit | undefined)[]; nets: [string, Bit][] } => {
  const out = evalGateNetlist(design, library, new Map(Object.entries(bits)), cache);
  const ys = design.ports
    .filter((p) => p.dir === 'out')
    .flatMap((p) => out.outPorts.get(p.name) ?? []);
  return { ys, nets: [...out.nets.entries()] };
};

describe('组合模块求值缓存', () => {
  it('纯模块：命中缓存的输出与不命中时逐位相同（四种输入都验一遍）', () => {
    const want = (a: Bit, b: Bit): Bit => (a === 1 && b === 1 ? 1 : 0);
    // 1) 逐个求值（每次新库 = 每次冷缓存），结果必须与手算一致
    for (const a of [0, 1] as Bit[]) {
      for (const b of [0, 1] as Bit[]) {
        expect(evalTop(baseLib(), andTop(1), { a0: [a], b0: [b] }).ys).toEqual([want(a, b)]);
      }
    }

    // 2) 同一批里"冷 → 热"两次：输出位必须逐位相同
    const library = baseLib();
    const design = andTop(1);
    const cache = beginGateCacheBatch(library);
    const bits = { a0: [1] as Bit[], b0: [1] as Bit[] };
    const cold = evalTop(library, design, bits, cache);
    const warm = evalTop(library, design, bits, cache);
    expect(cold.ys).toEqual([1]);
    expect(warm.ys).toEqual(cold.ys);
    expect(warm.nets).toEqual(cold.nets);

    // 3) 同一次求值里两个实例（输入位相同 → 缓存键相同）：第二个必然命中缓存，输出必须一样
    expect(evalTop(library, andTop(2), { a0: [1], a1: [1], b0: [1], b1: [1] }).ys).toEqual([1, 1]);

    // 4) 输入一变就是另一个键：绝不许拿旧值顶替新值
    expect(evalTop(library, andTop(2), { a0: [1], a1: [0], b0: [0], b1: [1] }).ys).toEqual([0, 0]);
    expect(evalTop(library, andTop(2), { a0: [0], a1: [1], b0: [1], b1: [1] }).ys).toEqual([0, 1]);
  });

  it('纯模块：确实写进了缓存，且命中时不改变任何数值', () => {
    // 缓存作用域挂在"库对象"上（见 gate-cache.ts）：同一个库对象里连续求值
    // = 模拟 settle 的多趟推进，第二次必然命中。
    const library = baseLib();
    const design = andTop(1);
    const inputs = new Map<string, Bit[]>([
      ['a0', [1]],
      ['b0', [1]],
    ]);
    const cache = beginGateCacheBatch(library);

    const cold = stepGateNetlist(design, library, inputs, new GateStateStore(), '', cache);
    expect(cold.ok).toBe(true);
    const coldStats = cache.stats();
    expect(coldStats.stores).toBeGreaterThan(0); // 缓存确实写进去了
    expect(cache.isBlocked('andmod')).toBe(false); // 纯组合模块不该被拉黑

    // 同一批内再求一次：必然命中，而且输出位与上一次**逐位相同**
    const warm = stepGateNetlist(design, library, inputs, new GateStateStore(), '', cache);
    expect(warm.ok).toBe(true);
    expect(cache.stats().hits).toBeGreaterThan(coldStats.hits);
    expect(warm.outPorts.get('y0')).toEqual(cold.outPorts.get('y0'));
    expect([...warm.nets.entries()]).toEqual([...cold.nets.entries()]);
  });

  it('含时序器件时不得复用缓存：纯度判定不靠 isSequential 一个字段', () => {
    // ① 标了 isSequential 的时序器件 → 不纯
    expect(isPureCombinational(dffMod, baseLib())).toBe(false);
    // ② 身体全是模块、isSequential 漏标为 false → **仍然**不纯（结构里嵌着带 SeqSpec 的触发器）
    expect(isPureCombinational(regMod(false), baseLib())).toBe(false);
    expect(isPureCombinational(regMod(), baseLib())).toBe(false);
    // ③ 纯组合的复合模块 → 纯
    expect(isPureCombinational(andMod, baseLib())).toBe(true);
    // ④ 门级原子（身体是元件电路，但门级引擎按真值算、不展开）→ 纯；
    //    身体含元件的**非原子**模块 → 不纯（门级引擎本来就拒绝求值）
    expect(isPureCombinational(gateMod('或门', ['a', 'b']), baseLib())).toBe(true);
    expect(
      isPureCombinational(
        {
          name: '自造模块',
          ports: [{ name: 'y', dir: 'out' }],
          body: {
            instances: [{ id: 'u1', kind: 'unit' }],
            nets: [],
            ports: [{ name: 'y', dir: 'out', nets: [] }],
          },
        },
        baseLib(),
      ),
    ).toBe(false);

    // ⑤ 组合求值里，含时序后代的身体**一个字节都不许进缓存**
    //    （组合版对"身体全是模块"的时序积木会如实回落，所以这里只看缓存有没有被写）
    const library = baseLib();
    const cache = beginGateCacheBatch(library);
    evalGateNetlist(regTop(), library, new Map(), cache);
    expect(cache.isBlocked('reg')).toBe(true); // 被判定为不可缓存
    expect(cache.stats().stores).toBe(0);
    expect(cache.stats().hits).toBe(0);
  });

  it('含时序器件的身体：输入相同也要按状态推进（缓存不得吃掉状态更新）', () => {
    const library = baseLib();
    const design = regTop();
    const st = new GateStateStore();
    const step = (d: Bit, clock: Bit): Bit | undefined =>
      settleGateSteps(
        design,
        library,
        new Map<string, Bit[]>([
          ['d', [d]],
          ['clk', [clock]],
        ]),
        st,
      ).outPorts.get('y')?.[0];

    expect(step(1, 0)).toBe(0); // 还没来上升沿（没记录过的时序状态按 0）
    expect(step(1, 1)).toBe(1); // 上升沿采到 1
    expect(step(1, 1)).toBe(1); // **同一组输入再来一次**：边沿型不采（缓存吃掉状态更新的话这里就会错）
    expect(step(0, 1)).toBe(1); // 时钟仍为 1：不采，保持 1
    expect(step(0, 0)).toBe(1); // 掉沿保持
    expect(step(0, 1)).toBe(0); // 第二次上升沿采到 0 —— 状态确实在推进
    expect(step(0, 1)).toBe(0); // 再重复一次仍然不采
  });

  it('缓存按库与批次隔离：换库不串味，换批作废旧条目', () => {
    const libA = baseLib();
    const libB = baseLib(); // 内容相同但是另一个对象
    expect(libA).not.toBe(libB);

    expect(evalTop(libA, andTop(1), { a0: [1], b0: [1] }).ys).toEqual([1]);
    expect(evalTop(libB, andTop(1), { a0: [1], b0: [1] }).ys).toEqual([1]);

    // 批次：同一个库对象，每批开始都作废旧条目（重算出来的值仍必须正确）
    const design = andTop(1);
    const inputs = new Map<string, Bit[]>([
      ['a0', [0]],
      ['b0', [1]],
    ]);
    const batch = (): { y: (Bit | undefined)[]; stats: GateCacheStats } => {
      const cache = beginGateCacheBatch(libA);
      const out = stepGateNetlist(design, libA, inputs, new GateStateStore(), '', cache);
      return { y: out.outPorts.get('y0') ?? [], stats: cache.stats() };
    };

    const first = batch();
    expect(first.y).toEqual([0]); // 0∧1 = 0
    expect(first.stats.stores).toBeGreaterThan(0); // 写进了缓存
    expect(first.stats.hits).toBeGreaterThan(0); // 同一趟里第二个与非门就命中了

    // 新的一批：旧条目作废 → 这一趟必须**重新算 + 重新写**（store 数不比上一趟少）
    const second = batch();
    expect(second.y).toEqual([0]);
    expect(second.stats.stores).toBeGreaterThan(first.stats.stores);
  });
});
