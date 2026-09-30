/**
 * 阶段 2（时序单元）内容自检。
 *
 * 这里最有价值的两条：
 *  - **参考解必须真过关**：成本刚好等于 optimalHalf、得分 100、硬核模式（含空翻与建立/保持）也过；
 *  - **关卡必须真的在考「记忆」**：把组合逻辑或锁存器拿来顶替，必须失败 ——
 *    D 锁存器过不了 D 触发器关卡，是这一阶段的教学落点，靠测试钉死。
 */

import {
  compileDesign,
  expandVectors,
  judgeDesign,
  portWidthsOf,
  requiredPorts,
  wrapModule,
} from '@lc/compiler';
import { DesignBuilder, InMemoryModuleLibrary } from '@lc/schema';
import { runVectors, transitionsIn } from '@lc/sim-core';
import { describe, expect, it } from 'vitest';
import { findLevel, levelOrder } from '../src/levels.js';
import { STAGE2_LEVELS } from '../src/levels-seq.js';
import { nandGateRef } from '../src/references.js';
import { dffRef } from '../src/references-seq.js';

const level = (id: string) => {
  const found = findLevel(id);
  if (!found) throw new Error(`缺少关卡 ${id}`);
  return found;
};

describe('阶段 2 关卡内容', () => {
  it('主线三关按「锁存器 → 门控锁存器 → 边沿触发器」排列，后面接两个挑战关', () => {
    const ids = STAGE2_LEVELS.map((l) => l.id);
    expect(ids).toEqual(['s2-sr-latch', 's2-d-latch', 's2-dff', 's2-dff-cost', 's2-dff-fast']);
    // 挑战关的类型（GDD 4.2 / 4.3）
    expect(level('s2-dff-cost').kind).toBe('cost');
    expect(level('s2-dff-fast').kind).toBe('timing');
    expect(levelOrder('s2-sr-latch')).toBeLessThan(levelOrder('s2-d-latch'));
    expect(levelOrder('s2-d-latch')).toBeLessThan(levelOrder('s2-dff'));

    for (const l of STAGE2_LEVELS) {
      expect(l.stage).toBe(2);
      expect(l.unlock?.kind).toBe('seq');
      expect(l.moduleAccess).toBe('all');
      if (l.kind === 'cost') {
        // 成本挑战关（GDD 4.2）不设预算上限：只比谁更省
        expect(l.budgetHalf).toBe(0);
      } else {
        expect(l.budgetHalf).toBeGreaterThanOrEqual(l.optimalHalf);
      }
      expect(l.optimalHalf).toBeGreaterThan(0);
      expect((l.bestKnownHalf ?? l.optimalHalf) / 2).toBeGreaterThanOrEqual(l.optimalHalf / 2);
      const ports = requiredPorts(l);
      expect(ports.inputs.length).toBeGreaterThan(0);
      expect(ports.outputs.length).toBeGreaterThan(0);
      // 关卡必须真的在考记忆：存在两组「输入完全相同、期望输出不同」的向量 ——
      // 纯组合逻辑永远无法同时满足它们。
      const byInputs = new Map<string, Set<string>>();
      for (const v of l.vectors) {
        const key = JSON.stringify(v.inputs);
        const set = byInputs.get(key) ?? new Set<string>();
        set.add(JSON.stringify(v.expect ?? {}));
        byInputs.set(key, set);
      }
      expect([...byInputs.values()].some((set) => set.size > 1)).toBe(true);
    }
  });

  for (const l of STAGE2_LEVELS) {
    it(`${l.title}（${l.id}）参考解通关：成本 = 最优、得分 100`, () => {
      const design = l.referenceSolution;
      if (!design) throw new Error('缺少参考解');
      const library = new InMemoryModuleLibrary();
      const result = judgeDesign(design, l, { library, hardcore: true });
      expect(result.errors).toEqual([]);
      expect(result.failedRows).toBe(0);
      expect(result.costHalf).toBe(l.optimalHalf);
      expect(result.score).toBe(100);
      expect(result.isSequential).toBe(true);
      // 时序模式下才可能数到跳变（逻辑模式没有延迟，窗口是同一个时刻）
      if (l.mode === 'timing') expect(result.timing.glitches).toBeGreaterThan(0);
    });
  }

  it('SR 锁存器关卡：纯组合的与非门电路过不了（没有记忆）', () => {
    const l = level('s2-sr-latch');
    const b = new DesignBuilder('comb', '组合与非门');
    b.vcc('vcc');
    b.gnd('gnd');
    // y = NAND(sn, rn)，与输入同步，不会保持
    b.unit('res', { a: 'sn', b: 'b1' }, 'R1');
    b.unit('res', { a: 'rn', b: 'b2' }, 'R2');
    b.unit('npn', { c: 'q', b: 'b1', e: 'm1' }, 'Q1');
    b.unit('npn', { c: 'm1', b: 'b2', e: 'gnd' }, 'Q2');
    b.unit('res', { a: 'vcc', b: 'q' }, 'R3');
    b.unit('res', { a: 'vcc', b: 'qn' }, 'R4');
    b.port('sn', 'in', 'sn');
    b.port('rn', 'in', 'rn');
    b.port('q', 'out', 'q');
    b.port('qn', 'out', 'qn');

    const result = judgeDesign(b.build(), l, {
      library: new InMemoryModuleLibrary(),
      hardcore: true,
    });
    expect(result.pass).toBe(false);
    expect(result.failedRows).toBeGreaterThan(0);
  });

  it('D 触发器关卡：把主锁存器常开（只剩一个锁存器）就过不了 —— 时钟高电平期间会空翻', () => {
    const l = level('s2-dff');
    const library = new InMemoryModuleLibrary();
    // 作弊版：主锁存器的使能直接接 VCC（永远透明），于是整个电路退化成一个 D 锁存器
    const base = dffRef('cheat-dlatch');
    const cheat = {
      ...base,
      nets: base.nets.map((n) => (n.id === 'nclk' ? { ...n, id: 'vcc' } : n)),
    };
    const merged = {
      ...cheat,
      nets: Array.from(new Map(cheat.nets.map((n) => [n.id, n])).values()),
    };
    const result = judgeDesign(merged, l, { library, hardcore: true });
    expect(result.pass).toBe(false);
    expect(result.failedRows).toBeGreaterThan(0);
  });

  it('D 触发器参考解：每个向量窗口内输出只跳一次（无空翻），波形可见', () => {
    const l = level('s2-dff');
    const design = l.referenceSolution;
    if (!design) throw new Error('缺少参考解');
    const { net } = compileDesign(design, { library: new InMemoryModuleLibrary() });
    const run = runVectors(net, expandVectors(l.vectors, portWidthsOf(l)), {
      mode: 'timing',
      defaultSettlePs: 25_000,
      trace: true,
    });
    expect(run.pass).toBe(true);
    const wave = run.waveform;
    expect(wave).toBeDefined();
    const qNode = net.ports.find((p) => p.name === 'q')?.node as number;
    const counts = run.rows.map((row) =>
      transitionsIn(wave as never, qNode, row.window.fromPs, row.window.toPs),
    );
    // 第 1 行含上电建立过程，其余行（真正的时钟沿搬运）最多跳一次
    expect(counts.slice(1).every((c) => c <= 1)).toBe(true);
    expect(counts.slice(1).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(3);
  });

  it('阶段 1 的与非门模块可以直接用来搭 SR 锁存器（跨阶段复用）', () => {
    const library = new InMemoryModuleLibrary();
    const wrapped = wrapModule(
      {
        name: '与非门',
        stage: 1,
        kind: 'logic',
        ports: [
          { id: 'a', name: 'a', dir: 'in', width: 1 },
          { id: 'b', name: 'b', dir: 'in', width: 1 },
          { id: 'y', name: 'y', dir: 'out', width: 1 },
        ],
        body: nandGateRef('ref-nand-reuse'),
      },
      library,
    );
    library.add(wrapped.template);
    const hash = wrapped.template.hash;

    const b = new DesignBuilder('sr-from-modules', 'SR锁存器（模块版）');
    b.vcc('vcc');
    b.gnd('gnd');
    b.module(hash, { a: 'sn', b: 'qn', y: 'q' }, 'NAND1');
    b.module(hash, { a: 'rn', b: 'q', y: 'qn' }, 'NAND2');
    b.port('sn', 'in', 'sn');
    b.port('rn', 'in', 'rn');
    b.port('q', 'out', 'q');
    b.port('qn', 'out', 'qn');

    const result = judgeDesign(b.build(), level('s2-sr-latch'), { library, hardcore: true });
    expect(result.errors).toEqual([]);
    expect(result.pass).toBe(true);
    // 模块复用与手搭成本完全一致（都是两个与非门，每个 = 2 三极管 + 3 电阻 = 20 半分）
    expect(result.costHalf).toBe(40);
  });

  it('D 触发器由两个 D 锁存器 + 一个反相器拼成，成本 98（半单位 196）', () => {
    const design = dffRef();
    const { net } = compileDesign(design, { library: new InMemoryModuleLibrary() });
    let npn = 0;
    let res = 0;
    for (let e = 0; e < net.elemCount; e++) {
      const kind = net.elemKind[e];
      if (kind === 0) npn++;
      if (kind === 1) res++;
    }
    expect(npn).toBe(19);
    expect(res).toBe(30);
    expect(npn * 4 + res * 4).toBe(196);
  });
});
