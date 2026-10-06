import { describe, expect, it } from 'vitest';
import type { Bit } from '../src/gate-logic';
import type { GateLibrary, GateModuleInfo, GateNetlistDesign } from '../src/gate-netlist';
import { GateStateStore, settleGateSteps, stepGateNetlist } from '../src/gate-seq';

/**
 * 逻辑版门级引擎第 3 步：时序器件 = 状态元件（零延迟逻辑仿真的标准模型）。
 * 锁存器/触发器在无延迟下是代数环，靠"输出读状态 + 时钟有效时写状态"解决。
 */

const latch = (mode: 'level' | 'rising'): GateModuleInfo => ({
  name: mode === 'level' ? 'D锁存器' : '主从D触发器',
  isSequential: true,
  seq: { clock: 'en', data: ['d'], mode },
  ports: [
    { name: 'd', dir: 'in' },
    { name: 'en', dir: 'in' },
    { name: 'q', dir: 'out' },
  ],
  body: { instances: [], nets: [], ports: [] },
});

const lib = (mods: Record<string, GateModuleInfo>): GateLibrary => ({ get: (h) => mods[h] });

const design = (hash: string): GateNetlistDesign => ({
  instances: [{ id: 'L1', kind: 'module', module: hash }],
  nets: [
    { id: 'nD', pins: [{ inst: 'L1', pin: 'd' }] },
    { id: 'nEn', pins: [{ inst: 'L1', pin: 'en' }] },
    { id: 'nQ', pins: [{ inst: 'L1', pin: 'q' }] },
  ],
  ports: [
    { name: 'd', dir: 'in', nets: ['nD'] },
    { name: 'en', dir: 'in', nets: ['nEn'] },
    { name: 'q', dir: 'out', nets: ['nQ'] },
  ],
});

const step = (
  l: GateLibrary,
  d: GateNetlistDesign,
  st: GateStateStore,
  dv: Bit,
  ev: Bit,
): Bit | undefined =>
  settleGateSteps(
    d,
    l,
    new Map([
      ['d', [dv]],
      ['en', [ev]],
    ]),
    st,
  ).outPorts.get('q')?.[0];

describe('时序器件 = 状态元件', () => {
  it('电平型锁存器：使能有效时透明，失效时保持', () => {
    const l = lib({ dl: latch('level') });
    const d = design('dl');
    const st = new GateStateStore();

    // 使能 0：不透明，上电未定 → Z（不假装是 0）
    expect(step(l, d, st, 1, 0)).toBe(0);

    // 使能 1、数据 1 → 透明，输出 1
    expect(step(l, d, st, 1, 1)).toBe(1);

    // 使能 0、数据 0 → **保持** 1（这就是锁存器的全部意义）
    expect(step(l, d, st, 0, 0)).toBe(1);

    // 再使能且数据 0 → 写入 0
    expect(step(l, d, st, 0, 1)).toBe(0);
    // 仍保持 0
    expect(step(l, d, st, 1, 0)).toBe(0);
  });

  it('上升沿型触发器：只在 0→1 那一刻写入，之后数据变化不影响输出', () => {
    const l = lib({ dff: latch('rising') });
    const d = design('dff');
    const st = new GateStateStore();

    expect(step(l, d, st, 1, 0)).toBe(0); // 还没来时沿
    expect(step(l, d, st, 1, 1)).toBe(1); // 上升沿，采到 1
    expect(step(l, d, st, 0, 1)).toBe(1); // 时钟仍为 1：**不采**（边沿型）
    expect(step(l, d, st, 0, 0)).toBe(1); // 掉到 0
    expect(step(l, d, st, 0, 1)).toBe(0); // 再来上升沿，采到 0
  });

  it('记录本次真正写入的状态（调试可见）', () => {
    const l = lib({ dl: latch('level') });
    const d = design('dl');
    const st = new GateStateStore();
    const r = stepGateNetlist(
      d,
      l,
      new Map([
        ['d', [1]],
        ['en', [1]],
      ]),
      st,
    );
    expect(r.clocked).toBe(true);
    expect(r.updates).toEqual(['L1/q#0=1']); // 状态按位记录，字符串带位号
    expect(st.get('L1', 'q', 0)).toBe(1);
    expect(st.snapshot()['L1/__clk']).toBe(1);
  });

  it('模块**内部**的时序器件也有自己的状态（状态穿透递归）', () => {
    const inner: GateModuleInfo = {
      name: '寄存器组',
      ports: [
        { name: 'd', dir: 'in' },
        { name: 'en', dir: 'in' },
        { name: 'q', dir: 'out' },
      ],
      body: {
        instances: [{ id: 'L9', kind: 'module', module: 'dl' }],
        nets: [
          { id: 'iD', pins: [{ inst: 'L9', pin: 'd' }] },
          { id: 'iEn', pins: [{ inst: 'L9', pin: 'en' }] },
          { id: 'iQ', pins: [{ inst: 'L9', pin: 'q' }] },
        ],
        ports: [
          { name: 'd', dir: 'in', nets: ['iD'] },
          { name: 'en', dir: 'in', nets: ['iEn'] },
          { name: 'q', dir: 'out', nets: ['iQ'] },
        ],
      },
    };
    const l = lib({ reg: inner, dl: latch('level') });
    const d = design('reg');
    const st = new GateStateStore();
    expect(step(l, d, st, 1, 1)).toBe(1); // 写入
    expect(step(l, d, st, 0, 0)).toBe(1); // 保持（内部状态没丢）
    expect(st.get('L1/L9', 'q', 0)).toBe(1); // 状态槽带实例路径前缀
  });

  it('时序模块没声明时钟/数据端口 → 如实回落，不猜端口', () => {
    const l = lib({ dl: { ...latch('level'), seq: undefined } });
    const r = stepGateNetlist(design('dl'), l, new Map(), new GateStateStore());
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('时钟/数据端口');
  });

  it('顶层有元件仍然回落（门级快路只处理纯模块设计）', () => {
    const r = stepGateNetlist(
      { instances: [{ id: 'r1', kind: 'unit' }], nets: [], ports: [] },
      lib({}),
      new Map(),
      new GateStateStore(),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('元件');
  });
});
