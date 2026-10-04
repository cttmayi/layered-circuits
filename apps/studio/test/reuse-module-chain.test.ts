// @vitest-environment node
/**
 * 回归：seq 关卡（跨仿真复用状态）里，**内部有中间节点的模块**不能被冻住。
 *
 * 玩家报告：自己在 SR 锁存器关放了个封装好的「非门」（两级三极管串联，成本 16 半、
 * 2.0 ns），sn 接它的 a、y 接 q —— 点 sn，q 一动不动；同一个模块放到「同或门」关
 * 却完全正常。差别在两关的仿真策略：SR 是 seq 关，复用上一次仿真状态；同或门是组合关，
 * 每次全量重算。
 *
 * 根因：旧的状态恢复只按「顶层网 id」还原，而模块内部的节点没有名字、还原不到 ——
 * 恢复后顶层是上次终态、模块内部停在上电态；随后点输入只重算受影响的下游，内部节点的
 * 贡献没变 → 事件不再往下传 → 输出冻住。单管反相器的输出脚直接挂在被点的网上，所以看不见；
 * 两级串联中间多一个内部节点就中招。
 *
 * 修法：快照带上**全节点电平**（含模块内部节点），恢复后从自洽初值重收敛一次。
 */
import { findLevel, teachingModulesFor } from '@lc/content';
import { describe, expect, it } from 'vitest';
import { createSym, type Doc, type StoredModule, toDesign } from '../src/editor/model';
import { docForLevel } from '../src/level/progress';
import { handleRequest } from '../src/sim/handle';
import { probeModule } from '../src/sim/probe';
import type { DriveValue } from '../src/sim/protocol';
import { shouldReuseSimState } from '../src/sim/sim-policy';

type Req = Parameters<typeof handleRequest>[0];
type Design = Extract<Req, { type: 'simulate' }>['design'];

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

/** 玩家那种「两级三极管串联」反相器：q1 直接吃输入、q2 基极接 VCC 恒通、y 上拉 */
function stackedInverter(): Design {
  return {
    schemaVersion: 1,
    id: 'stack-not',
    name: '非门',
    instances: [
      { kind: 'vcc', id: 'vcc1' },
      { kind: 'gnd', id: 'gnd1' },
      { kind: 'unit', id: 'q1', unit: 'npn' },
      { kind: 'unit', id: 'q2', unit: 'npn' },
      { kind: 'unit', id: 'r1', unit: 'res' },
      { kind: 'unit', id: 'r2', unit: 'res' },
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
      { id: 'a', name: 'a', dir: 'in', width: 1, nets: ['na'] },
      { id: 'y', name: 'y', dir: 'out', width: 1, nets: ['ny'] },
    ],
  };
}

/** 逻辑值 + 强度，例："0·强" / "1·弱" / "Z" */
function text(signal: number | undefined): string {
  if (signal === undefined) return '—';
  if (signal === 0) return 'Z';
  return `${['0', '1', 'X'][signal & 3]}${['', '·弱', '·强', '·供电'][signal >> 2]}`;
}

/** 在 SR 关画布上放一个模块，接 sn → a、y → q，按点击顺序读 q */
function clicksInSr(moduleHash: string, values: Array<0 | 1>, library: StoredModule[]): string[] {
  const level = findLevel('s2-sr-latch')!;
  let doc: Doc = docForLevel(level, library);
  const u1 = createSym(doc, 'module', undefined, 300, 320, moduleHash);
  doc = {
    ...doc,
    syms: [...doc.syms, u1],
    wires: [
      { id: 'w1', a: { inst: 'in-sn', pin: 'p', bit: 0 }, b: { inst: u1.id, pin: 'a', bit: 0 } },
      { id: 'w2', a: { inst: u1.id, pin: 'y', bit: 0 }, b: { inst: 'out-q', pin: 'p', bit: 0 } },
    ],
  };
  const design = toDesign(doc);
  const designKey = JSON.stringify(design);
  const qNet = design.nets.find((n) => n.pins.some((p) => p.inst === 'out-q'))!;
  const reuse = shouldReuseSimState(level, 'level'); // seq 关 → true
  expect(reuse).toBe(true);

  let prev: { key: string; nodes: number[] } | null = null;
  const out: string[] = [];
  for (const value of values) {
    const syms = doc.syms.map((s) => (s.id === 'in-sn' ? { ...s, value: value as DriveValue } : s));
    const reuseNow = prev !== null && prev.key === designKey && reuse;
    const response = handleRequest({
      id: 1,
      type: 'simulate',
      design: toDesign({ ...doc, syms }),
      library: library.map((m) => m.template),
      mode: 'logic',
      inputs: { sn: value, rn: 0 },
      buttonPorts: [],
      prevNodeSignals: reuseNow ? (prev as { nodes: number[] }).nodes : undefined,
    });
    out.push(text(new Map(response.snapshot?.netSignals ?? []).get(qNet.id)));
    prev = response.snapshot ? { key: designKey, nodes: response.snapshot.nodeSignals } : null;
  }
  return out;
}

describe('seq 关卡里复用状态不能冻住模块（两级串联反相器）', () => {
  const wrapped = handleRequest({
    id: 1,
    type: 'wrap',
    design: stackedInverter(),
    library: [],
    name: '非门',
    stage: 1,
  }).wrapped!;
  const template = wrapped.template;
  const module: StoredModule = {
    hash: wrapped.hash,
    name: '非门',
    version: (template as { version: string }).version,
    stage: 1,
    costHalf: wrapped.costHalf,
    isSequential: wrapped.isSequential,
    ports: wrapped.ports,
    template: template as StoredModule['template'],
    sources: [] as string[],
    createdAt: 0,
  };
  const library = [...stored, module];

  it('这个模块本身是好的（自测能反相）', () => {
    const probe = probeModule(template as never, library);
    expect(probe.skipped).toBeNull();
    expect(probe.stuck).toEqual([]);
    expect(probe.rows.map((r) => r.outputs.y)).toEqual(['1·弱', '0·强']);
  });

  it('连续点 sn：q 必须每次都跟着反相，不能冻住', () => {
    // 旧实现（按顶层网 id 恢复）在这里会冻成 ["0·强","0·强","0·强","0·强","0·强"]
    expect(clicksInSr(wrapped.hash, [1, 0, 1, 0, 1], library)).toEqual([
      '0·强',
      '1·弱',
      '0·强',
      '1·弱',
      '0·强',
    ]);
  });

  it('SR 关参考解（两个与非门交叉耦合）：复用状态下「保持」照旧成立', () => {
    // 修好复用路径后必须证明锁存器没被"重收敛"推翻：set → hold → reset → hold
    const level = findLevel('s2-sr-latch')!;
    const design = level.referenceSolution!;
    const lib = teachingModulesFor('rtl');
    const qId = design.ports.find((p) => p.name === 'q')!.nets[0];
    let prev: { key: string; nodes: number[] } | null = null;
    const key = JSON.stringify(design);
    const qs: string[] = [];
    for (const [sn, rn] of [
      [0, 1],
      [1, 1],
      [1, 0],
      [1, 1],
    ] as Array<[0 | 1, 0 | 1]>) {
      const reuseNow = prev !== null && prev.key === key;
      const response = handleRequest({
        id: 1,
        type: 'simulate',
        design,
        library: [...lib],
        mode: 'logic',
        inputs: { sn, rn },
        buttonPorts: [],
        prevNodeSignals: reuseNow ? (prev as { nodes: number[] }).nodes : undefined,
      });
      const byNet = new Map(response.snapshot?.netSignals ?? []);
      qs.push(text(byNet.get(qId)));
      prev = response.snapshot ? { key, nodes: response.snapshot.nodeSignals } : null;
    }
    expect(qs.map((t) => (t === 'Z' ? 'Z' : t[0]))).toEqual(['1', '1', '0', '0']);
  });

  it('复用不比冷启动多算：每次仿真的求值次数同量级（维持状态不等于加倍运算）', () => {
    const level = findLevel('s2-sr-latch')!;
    const design = level.referenceSolution!;
    const lib = [...teachingModulesFor('rtl')];
    const run = (reuse: boolean): number => {
      let prev: number[] | null = null;
      let last = 0;
      for (const [sn, rn] of [
        [0, 1],
        [1, 1],
      ] as Array<[0 | 1, 0 | 1]>) {
        const response = handleRequest({
          id: 1,
          type: 'simulate',
          design,
          library: lib,
          mode: 'logic',
          inputs: { sn, rn },
          buttonPorts: [],
          prevNodeSignals: reuse && prev ? prev : undefined,
        });
        last = response.snapshot?.evaluations ?? 0;
        prev = response.snapshot?.nodeSignals ?? null;
      }
      return last;
    };
    // 复用一次 = 恢复节点态后收敛一次，与冷启动（上电收敛一次）同价；
    // 若哪天又变成"先上电收敛、再恢复收敛"，这里会翻倍报警。
    expect(run(true)).toBeLessThanOrEqual(run(false) * 1.05);
  });

  it('单管反相器（无内部中间节点）行为不变：教科书非门照旧反相', () => {
    const notGate = stored.find((m) => m.name === '非门')!;
    expect(clicksInSr(notGate.hash, [1, 0, 1], library)).toEqual(['0·强', '1·弱', '0·强']);
  });
});
