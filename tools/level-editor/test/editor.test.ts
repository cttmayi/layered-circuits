/**
 * 关卡编辑器自检（GDD 内容基建的验收线）：
 *
 * 「写一份 spec 就能产出**已验收**的关卡」—— 这里的每个用例都会真跑判定，
 * 只要参考解、预算或向量有问题，用例直接红。
 */

import { judgeDesign, requiredPorts } from '@lc/compiler';
import { xorGateRef } from '@lc/content';
import { InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { buildLevel, vectorsOf } from '../src/build.js';
import { parseSpec } from '../src/spec.js';
import { synthesizeSop } from '../src/synth.js';

const library = new InMemoryModuleLibrary();

/** 2 输入关卡：求解器会连参考解一起给出来 */
const XOR_SPEC = parseSpec({
  id: 's3-xor-mini',
  stage: 3,
  title: '异或门（试制）',
  brief: '两个输入不同时输出 1。',
  teaching: '组合逻辑的最小项思路。',
  inputs: ['a', 'b'],
  outputs: ['y'],
  truth: { '0,0': { y: 0 }, '0,1': { y: 1 }, '1,0': { y: 1 }, '1,1': { y: 0 } },
  allowedUnits: ['npn', 'res', 'dio'],
  overhead: 0.2,
});

/** 3 输入关卡：走 SOP 综合兜底 */
const MAJORITY_SPEC = parseSpec({
  id: 's3-majority',
  stage: 3,
  title: '三取二表决器',
  brief: '三个输入里至少两个为 1 时输出 1。',
  teaching: '积之和：把让输出为 1 的每种组合 OR 起来。',
  inputs: ['a', 'b', 'c'],
  outputs: ['y'],
  truth: {
    '0,0,0': { y: 0 },
    '0,0,1': { y: 0 },
    '0,1,0': { y: 0 },
    '0,1,1': { y: 1 },
    '1,0,0': { y: 0 },
    '1,0,1': { y: 1 },
    '1,1,0': { y: 1 },
    '1,1,1': { y: 1 },
  },
  allowedUnits: ['npn', 'res', 'dio'],
});

describe('关卡编辑器：向量生成', () => {
  it('按输入顺序展开真值表，顺序与端口一致', () => {
    const vectors = vectorsOf(XOR_SPEC);
    expect(vectors).toHaveLength(4);
    expect(vectors[1]?.inputs).toEqual({ a: 0, b: 1 });
    expect(vectors[1]?.expect).toEqual({ y: 1 });
  });

  it('真值表行数不对/键不合法时直接报错（坏关卡进不了内容包）', () => {
    // 行数不足
    expect(() => vectorsOf({ ...XOR_SPEC, truth: { '0,0': { y: 0 } } })).toThrow(/真值表不完整/);
    // 行数够但 key 的位数与输入端口数不符
    expect(() =>
      vectorsOf({
        ...XOR_SPEC,
        truth: { '0,0': { y: 0 }, '0,1': { y: 1 }, '1,0': { y: 1 }, '1,0,1': { y: 0 } },
      }),
    ).toThrow(/不符/);
    expect(() =>
      vectorsOf({
        ...XOR_SPEC,
        truth: { '0,0': { z: 0 }, '0,1': { y: 0 }, '1,0': { y: 0 }, '1,1': { y: 0 } },
      }),
    ).toThrow(/缺少输出端口/);
  });
});

describe('关卡编辑器：2 输入关卡全自动（含参考解）', () => {
  it('求解器给出参考解，产出的关卡能过、预算不低于满分线', () => {
    const { level, source, notes } = buildLevel(XOR_SPEC, library);
    expect(level.id).toBe('s3-xor-mini');
    expect(level.vectors).toHaveLength(4);
    expect(level.budgetHalf).toBeGreaterThanOrEqual(level.optimalHalf);
    expect(notes.join('；')).toContain('求解器');

    const check = judgeDesign(level.referenceSolution!, level, { library, hardcore: true });
    expect(check.errors).toEqual([]);
    expect(check.pass).toBe(true);
    expect(check.costHalf).toBe(level.optimalHalf);
    expect(check.score).toBe(100);
    // 生成的源码里带有参考解，可以直接粘进内容包
    expect(source).toContain('parseLevel({');
    expect(source).toContain('Ref = ');
  });

  it('制作人手工写的参考解优先；更省的标准解会被记成「已知最省」而不是抬高分线', () => {
    // 手工参考解故意用「4 个与非门」的老写法（成本 56 = 显示 28），比求解器找到的 36 贵
    const handWritten = xorGateRef('ref-hand');
    const { level, notes } = buildLevel({ ...XOR_SPEC, reference: handWritten }, library);
    expect(notes.join('；')).not.toContain('参考解由求解器生成');
    expect(level.optimalHalf).toBe(56); // 满分线跟着参考解走，课上教的解法照样满分
    expect(level.bestKnownHalf).toBe(36); // 求解器找到的更省解记进榜
    expect(level.budgetHalf).toBe(Math.ceil(56 * 1.2));
    const check = judgeDesign(handWritten, level, { library, hardcore: true });
    expect(check.pass).toBe(true);
    expect(check.score).toBe(100);
  });
});

describe('关卡编辑器：3 输入关卡走 SOP 综合', () => {
  it('SOP 参考解功能一定对（8 组输入全过），并如实标注「不是最省」', () => {
    const { level, notes } = buildLevel(MAJORITY_SPEC, library);
    expect(level.vectors).toHaveLength(8);
    const check = judgeDesign(level.referenceSolution!, level, { library });
    expect(check.errors).toEqual([]);
    expect(check.pass).toBe(true);
    expect(check.costHalf).toBe(level.optimalHalf);
    expect(notes.join('；')).toContain('SOP');
  });

  it('SOP 综合的元件规模随最小项数量增长（4 个最小项 = 4 条与项）', () => {
    const design = synthesizeSop({
      id: 'synth-probe',
      name: 'probe',
      inputs: MAJORITY_SPEC.inputs,
      outputs: MAJORITY_SPEC.outputs,
      truth: MAJORITY_SPEC.truth,
      allowedUnits: MAJORITY_SPEC.allowedUnits,
    });
    const units = design.instances.filter((i) => i.kind === 'unit');
    // 4 个最小项 × 2 个与门 + 3 个可能的反相器 + 3 个或门 + 反相器，至少 20 个元件
    expect(units.length).toBeGreaterThanOrEqual(20);
    expect(
      requiredPorts({
        ...buildLevel(MAJORITY_SPEC, library).level,
      } as never).inputs,
    ).toEqual(['a', 'b', 'c']);
  });
});
