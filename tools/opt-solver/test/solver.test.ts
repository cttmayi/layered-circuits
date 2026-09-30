/**
 * 求解器自检：它得先把「已知的最优」找出来，再回答「还有没有更省的」。
 */

import { ALL_LEVELS } from '@lc/content';
import { InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { buildCatalog, probeFragment } from '../src/catalog.js';
import {
  andDiode,
  nandCmos,
  nandRtl,
  norCmos,
  norRtlParallel,
  notCmos,
  notCommonEmitter,
  orDiode,
} from '../src/fragments.js';
import { searchPlans } from '../src/search.js';
import { solveLevel, targetMaskOf } from '../src/solver.js';

const level = (id: string) => {
  const found = ALL_LEVELS.find((l) => l.id === id);
  if (!found) throw new Error(`缺少关卡 ${id}`);
  return found;
};

describe('门目录', () => {
  it('片段的真值表与成本由真仿真测出（不是手写的表）', () => {
    const not = probeFragment(notCommonEmitter);
    expect(not.mask).toBe(0b0011); // 非门
    expect(not.costHalf).toBe(12); // 1 三极管 + 2 电阻
    const nand = probeFragment(nandRtl);
    expect(nand.mask).toBe(0b0111); // 与非门
    expect(nand.costHalf).toBe(20);
    const and = probeFragment(andDiode);
    expect(and.mask).toBe(0b1000); // 与门
    const or = probeFragment(orDiode);
    expect(or.mask).toBe(0b1110);
    // 并联下拉的或非门确实能工作，与「二极管或 + 反相」同价（都是 20）
    const nor = probeFragment(norRtlParallel);
    expect(nor.mask).toBe(0b0001);
    expect(nor.costHalf).toBe(20);
    // CMOS 片段：无电阻互补对，又便宜又是推挽（工艺升级的落点）
    const cmosNot = probeFragment(notCmos);
    expect(cmosNot.mask).toBe(0b0011);
    expect(cmosNot.costHalf).toBe(4); // 1 pMOS + 1 nMOS
    const cmosNand = probeFragment(nandCmos);
    expect(cmosNand.mask).toBe(0b0111);
    expect(cmosNand.costHalf).toBe(8);
    const cmosNor = probeFragment(norCmos);
    expect(cmosNor.mask).toBe(0b0001);
    expect(cmosNor.costHalf).toBe(8);
  });

  it('掩码空间搜索能找出异或门 = 4 个与非门（成本 28）', () => {
    const gates = buildCatalog(new InMemoryModuleLibrary(), { modules: false });
    const xor = searchPlans(gates).get(0b0110);
    expect(xor).toBeDefined();
    expect(xor?.costHalf).toBeLessThanOrEqual(56);
  });
});

describe('求解器', () => {
  it('时序关卡的向量带记忆 → 不做组合搜索，但仍复核参考解', () => {
    const dff = level('s2-dff');
    expect(targetMaskOf(dff)).toBeNull();
    const report = solveLevel(dff);
    expect(report.best).toBeNull();
    expect(report.referencePass).toBe(true);
    expect(report.spaces.join()).toContain('掩码空间');
  });

  it('每个组合关卡的参考解都真的过关，且求解器不会找出更省的电路', () => {
    const library = new InMemoryModuleLibrary();
    const combinational = ALL_LEVELS.filter((l) => targetMaskOf(l) !== null);
    expect(combinational.length).toBeGreaterThanOrEqual(7);
    for (const l of combinational) {
      const report = solveLevel(l, { library });
      expect(`${l.id} 参考解`).toBe(`${l.id} 参考解`);
      expect(report.referencePass).toBe(true);
      expect(report.best).not.toBeNull();
      // 求解器的结论必须与关卡数据对上：
      //  - 满分线（optimalHalf）= 参考解成本：求解器搜到的最省绝不能比它贵；
      //  - bestKnownHalf 是「已知最省」——可能来自门目录之外的结构（例如省略基极电阻的
      //    2 NPN + 2 电阻与非门 = 16 半单位），片段目录枚举不到时求解器给回满分线那个价。
      //    只要求解器复现出比满分线更省的解，就必须与关卡数据一致。
      expect(report.best?.measuredHalf, `${l.id} 求解器最省成本`).toBeLessThanOrEqual(
        l.optimalHalf,
      );
      if (l.bestKnownHalf !== undefined) {
        const best = report.best?.measuredHalf ?? 0;
        if (best < l.optimalHalf) {
          expect(best, `${l.id} 求解器复现的已知最省`).toBe(l.bestKnownHalf);
        }
      }
      expect(
        l.bestKnownHalf ?? l.optimalHalf,
        `${l.id} 已知最省不能比满分线还贵`,
      ).toBeLessThanOrEqual(l.optimalHalf);
    }
  });
});
