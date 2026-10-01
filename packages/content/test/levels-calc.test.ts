/**
 * 简易计算器链（4 个新关）回归测试：
 *  - 每个新关的参考解必须按契约判定过关；
 *  - costHalf === optimalHalf（参考解成本即满分线，评星契约自洽）；
 *  - score === 100（参考解 = 3 星基准）。
 * 高成本版（先高成本、后优化）——成本数字偏大是当前阶段的预期，优化后回填。
 */
import { judgeDesign } from '@lc/compiler';
import { InMemoryModuleLibrary, type Level } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { ALL_LEVELS } from '../src/levels.js';
import { elementEdgeOf, TEACHING_MODULES, teachingSolutionOf } from '../src/teachings.js';

const lib = new InMemoryModuleLibrary();
const NEW_IDS = ['s3-bcd2bin', 's3-bin2bcd', 's3-reg-8', 's3-calc'];

describe('计算器链新关', () => {
  for (const id of NEW_IDS) {
    it(
      `${id}：参考解过关且满分（costHalf === optimalHalf）`,
      () => {
        const level = ALL_LEVELS.find((l) => l.id === id) as Level;
        expect(level, `关卡 ${id} 已定义`).toBeTruthy();
        const ref = level.referenceSolution;
        expect(ref, `参考解存在`).toBeTruthy();
        const r = judgeDesign(ref!, level, {
          library: lib,
          family: 'rtl',
          units: level.allowedUnits,
          optimalHalf: level.optimalHalf,
          budgetHalf: level.budgetHalf,
          hardcore: true,
        });
        expect(r.pass, `${id} 参考解应过关：${r.errors.join('；')}`).toBe(true);
        expect(r.costHalf).toBe(level.optimalHalf);
        expect(r.score).toBe(100);
      },
      // 大电路的时序行为探测较慢（calc 是 600+ 元件、10 输入），放宽超时
      id === 's3-calc' ? 30_000 : 15_000,
    );

    it(
      `${id}：门版参考解过关且满分（一键出答案直接出门版）`,
      () => {
        const level = ALL_LEVELS.find((l) => l.id === id) as Level;
        const teach = teachingSolutionOf(id);
        expect(teach, `${id} 有门版（优先逻辑门版原则）`).toBeTruthy();
        const gateLib = new InMemoryModuleLibrary([...TEACHING_MODULES]);
        const r = judgeDesign(teach!, level, {
          library: gateLib,
          family: 'rtl',
          units: level.allowedUnits,
          optimalHalf: level.optimalHalf,
          budgetHalf: level.budgetHalf,
          hardcore: true,
        });
        expect(r.pass, `${id} 门版应过关：${r.errors.join('；')}`).toBe(true);
        expect(r.score).toBe(100);
        // 原则：元件版不占优 → 不弹窗，一键出答案直接出门版
        expect(elementEdgeOf(level)).toBeNull();
      },
      id === 's3-calc' ? 60_000 : 30_000,
    );
  }

  it('新关在解锁链末端：s3-calc 是最后一关', () => {
    const ids = ALL_LEVELS.map((l) => l.id);
    const last = ids[ids.length - 1];
    expect(last).toBe('s3-calc');
    const idx = NEW_IDS.map((id) => ids.indexOf(id));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });
});
