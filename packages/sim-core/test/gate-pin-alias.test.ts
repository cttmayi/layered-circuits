import { compileDesign } from '@lc/compiler';
import { GATE_SEQ_SPECS, hashOf, teachingModulesFor } from '@lc/content';
import { InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { Simulator } from '../src/engine';
import {
  evalGateNetlist,
  type GateLibrary,
  type GateModuleInfo,
  GateStateStore,
  settleGateSteps,
} from '../src/index';

/**
 * **同一引脚接多条网名**（s3-calc 门级/元件级差异 58/67 的根因之一）。
 *
 * 门版参考解里一个引脚同时挂多条网名是常态（八位寄存器的 `q0..q7` 同时挂在顶层
 * `acc0..acc7` 上、数字输入寄存器的 `q0..q7` 挂在 `er0..er7` 上…）。
 * 元件级编译（flatten）会把同一引脚上的各条网名**并成同一个节点**——电气上就是一根线；
 * 门级如果只认一条（Map.set 后写覆盖前写），别的网名就永远没有驱动、读出来恒 0，
 * 于是门级读数与元件级整片相反。
 *
 * 这里手搭最小用例：A 门的输出脚 y 同时接 `mid` 与 `out` 两条网，A 输出 1；
 * `mid` 必须也读到 1（修之前它是 0 —— 被 `out` 顶掉了）。
 */
const notGate = (): GateModuleInfo => ({
  name: '非门',
  ports: [
    { name: 'a', dir: 'in' },
    { name: 'y', dir: 'out' },
  ],
  body: { instances: [], nets: [], ports: [] },
});

const lib = (mods: Record<string, GateModuleInfo>): GateLibrary => ({ get: (h) => mods[h] });

describe('门级引擎：同一引脚接多条网名（网名别名）', () => {
  it('一个输出脚挂两条网：两条都要拿到同一个驱动', () => {
    const design = {
      id: 'pin-alias',
      name: '引脚别名',
      schemaVersion: 1,
      instances: [{ id: 'A', kind: 'module', module: 'not1' }],
      nets: [
        { id: 'in', pins: [{ inst: 'A', pin: 'a' }] },
        { id: 'mid', pins: [{ inst: 'A', pin: 'y' }] },
        { id: 'out', pins: [{ inst: 'A', pin: 'y' }] },
      ],
      ports: [
        { id: 'a', name: 'a', dir: 'in', width: 1, nets: ['in'] },
        { id: 'out', name: 'out', dir: 'out', width: 1, nets: ['out'] },
        { id: 'mid', name: 'mid', dir: 'out', width: 1, nets: ['mid'] },
      ],
    };
    // a=0 → 非门输出 1：out 与 mid 都必须读到 1
    const r = evalGateNetlist(design as never, lib({ not1: notGate() }), new Map([['a', [0]]]));
    expect(r.ok).toBe(true);
    expect(r.outPorts.get('out')).toEqual([1]);
    expect(r.outPorts.get('mid')).toEqual([1]);
    expect(r.nets.get('out')).toBe(1);
    expect(r.nets.get('mid')).toBe(1);

    // a=1 → 输出 0：两条网也都必须是 0（这一半在修之前"恰好"是对的，
    // 因为被顶掉的那条 net 默认就是 0 —— 所以只测 1 的那半才抓得住 bug）
    const r0 = evalGateNetlist(design as never, lib({ not1: notGate() }), new Map([['a', [1]]]));
    expect(r0.outPorts.get('out')).toEqual([0]);
    expect(r0.outPorts.get('mid')).toEqual([0]);

    // 输入侧同理：一个输入脚挂两条网名时，读值取两条的合并（同值同值）
    const inAlias = {
      ...design,
      instances: [{ id: 'B', kind: 'module', module: 'not1' }],
      nets: [
        { id: 'w1', pins: [{ inst: 'B', pin: 'a' }] },
        { id: 'w2', pins: [{ inst: 'B', pin: 'a' }] },
        { id: 'out2', pins: [{ inst: 'B', pin: 'y' }] },
      ],
      ports: [{ id: 'out2', name: 'out2', dir: 'out', width: 1, nets: ['out2'] }],
    };
    const rIn = evalGateNetlist(inAlias as never, lib({ not1: notGate() }), new Map());
    expect(rIn.ok).toBe(true);
    // 两个网名都没驱动 → 按 0 处理 → 非门输出 1（不会因为"只认一条"而读出 X/0）
    expect(rIn.outPorts.get('out2')).toEqual([1]);
  });
});

/**
 * **最小复现（与 s3-calc 的真实接线同形）**：寄存器包 1 个主从 D 触发器，
 * 触发器输出脚 `q` 在顶层分**两条网名**（`rq` 与 `rq2`）。
 *
 * 这是 s3-calc 差异 58/67 的那条接线的缩小版：八位寄存器的 `q[i]` 在顶层同时是
 * `acc{i}` 与 `sum{i}`/比较用的网名，数字输入寄存器同理（`q[i]` ↔ `er{i}`）。
 * 元件级 flatten 把它们并成**同一个节点**（电气上一根线），门级只认一条时，
 * **被顶掉的那条网名永远读 0** —— 于是「元件级上电 Q=1」在门级读成 0，读数整片相反。
 *
 * 这条用例是防复发的主要凭据：把 `makePinIndex` 改回 `Map<pinKey, netId>`（单条），
 * 第二条网名立刻读出 0，本用例即红。
 */
describe('门级引擎：寄存器 q/qn 分两条网名（s3-calc 根因缩小版）', () => {
  const lib = new InMemoryModuleLibrary([...teachingModulesFor('rtl')]);
  const gateLib: GateLibrary = {
    get: (h) => {
      const m = lib.get(h);
      if (!m) return undefined;
      return {
        name: m.name,
        isSequential: m.isSequential,
        seq: GATE_SEQ_SPECS[m.name],
        ports: m.ports.map((p) => ({ name: p.name, dir: p.dir, width: p.width })),
        body: m.body as GateModuleInfo['body'],
      } satisfies GateModuleInfo;
    },
  };

  /** 顶层：R1 = 八位寄存器；第 0 位拉到两条网名上（`q0` 进下游与门，`q0b` 另作别名） */
  const design = {
    id: 'reg-q-alias',
    name: '寄存器 q 两条网名',
    schemaVersion: 1,
    instances: [
      { id: 'R1', kind: 'module', module: hashOf('八位寄存器', 'rtl') },
      { id: 'A1', kind: 'module', module: hashOf('与门', 'rtl') },
    ],
    nets: [
      { id: 'd0', pins: [{ inst: 'R1', pin: 'd', bit: 0 }] },
      { id: 'clk', pins: [{ inst: 'R1', pin: 'clk' }] },
      // 与 s3-calc 同形：寄存器输出脚 q[0] → 两条网名，两条各自还接着别的负载
      {
        id: 'q0',
        pins: [
          { inst: 'R1', pin: 'q', bit: 0 },
          { inst: 'A1', pin: 'a' },
        ],
      },
      { id: 'q0b', pins: [{ inst: 'R1', pin: 'q', bit: 0 }] },
      { id: 'one', pins: [{ inst: 'A1', pin: 'b' }] },
      { id: 'y', pins: [{ inst: 'A1', pin: 'y' }] },
    ],
    ports: [
      { id: 'd', name: 'd', dir: 'in', width: 8, nets: ['d0'] },
      { id: 'clk', name: 'clk', dir: 'in', width: 1, nets: ['clk'] },
      { id: 'one', name: 'one', dir: 'in', width: 1, nets: ['one'] },
      { id: 'q', name: 'q', dir: 'out', width: 1, nets: ['q0'] },
      { id: 'qb', name: 'qb', dir: 'out', width: 1, nets: ['q0b'] },
      { id: 'y', name: 'y', dir: 'out', width: 1, nets: ['y'] },
    ],
  } as const;

  it('寄存器输出脚的两条网名是同一条线：q/qb 都读 1，下游与门也拿到 1', () => {
    const inputs = new Map([
      ['d[0]', [0] as const],
      ['clk', [0] as const],
      ['one', [1] as const],
    ]);
    // ── 门级：d=0、clk=0（保持）→ 上电初值 Q=1
    const st = new GateStateStore();
    const r = settleGateSteps(design as never, gateLib, inputs as never, st);
    expect(r.ok).toBe(true);
    const q = r.outPorts.get('q')?.[0];
    const qb = r.outPorts.get('qb')?.[0];
    // 关键断言：**第二条网名**（后写的那条，也就是被老代码顶掉的）必须拿到驱动
    expect(String(q)).toBe('1');
    expect(String(qb)).toBe('1');
    // 两条网名指着同一个引脚 → 值必须相同（电气上就是一根线）
    expect(qb).toBe(q);
    // 别名网名必须参与真实逻辑：下游与门的 a 端接的就是这条网名，它也得是 1
    expect(String(r.outPorts.get('y')?.[0])).toBe('1');
    expect(String(r.nets.get('q0'))).toBe('1');
    expect(String(r.nets.get('q0b'))).toBe('1');

    // ── 元件级（权威口径）：同一份设计、同一个激励，两个引擎结论必须一致
    const { net } = compileDesign(design as never, { library: lib });
    const sim = new Simulator(net, { mode: 'logic' });
    for (const p of net.ports) if (p.dir === 'in') sim.setInput(p.id, 0);
    sim.setInput('one', 1);
    sim.settle();
    expect(String(sim.readPort('q'))).toBe('1');
    expect(String(sim.readPort('y'))).toBe(String(r.outPorts.get('y')?.[0]));
  });
});
