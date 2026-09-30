/**
 * fromDesign（Design → 画布 Doc）往返自检：「一键出答案」把参考解搭回画布后，
 * 再导出必须仍是一份能通关、成本不变的电路。
 */

import { judgeDesign } from '@lc/compiler';
import { ALL_LEVELS, TEACHING_MODULES, teachingSolutionOf } from '@lc/content';
import { InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { fromDesign, toDesign } from '../src/editor/model';
import { docForLevel } from '../src/level/progress';

describe('fromDesign 还原器（一键出答案）', () => {
  it('每个有关卡参考解的关：还原 → 再导出 → 判定通关且满分', () => {
    const library = new InMemoryModuleLibrary();
    let checked = 0;
    for (const level of ALL_LEVELS) {
      const ref = level.referenceSolution;
      if (!ref) continue;
      checked++;
      const base = docForLevel(level, []);
      const doc = fromDesign(ref, base);
      // 端口保留：位宽与锁定继承自关卡预置
      expect(doc.syms.filter((s) => s.kind === 'input' || s.kind === 'output').length).toBe(
        base.syms.filter((s) => s.kind === 'input' || s.kind === 'output').length,
      );
      // 元件真的铺上去了
      expect(doc.syms.filter((s) => s.kind === 'unit' || s.kind === 'module').length).toBe(
        ref.instances.filter((i) => i.kind === 'unit' || i.kind === 'module').length,
      );
      // 多 bit 端口位宽保留
      for (const p of level.ports) {
        const sym = doc.syms.find(
          (s) => s.kind !== 'vcc' && s.kind !== 'gnd' && s.label === p.name,
        );
        expect(sym?.width, `${level.id} 端口 ${p.name} 位宽`).toBe(p.width);
      }
      // 往返：导出 → 判定（硬核）→ 通过 + 满分
      const design = toDesign(doc);
      const r = judgeDesign(design, level, { library, hardcore: true });
      expect(r.pass, `${level.id} 还原后应通关：${r.errors.join('；')}`).toBe(true);
      expect(r.score, `${level.id} 还原后应满分`).toBe(100);
    }
    expect(checked).toBeGreaterThanOrEqual(15);
  });

  it('没有参考解的关返回空电路提示（不炸）', () => {
    const level = ALL_LEVELS[0]!;
    const base = docForLevel(level, []);
    // 空 design（无实例、无网络）也能还原成只剩端口的画布
    const doc = fromDesign(
      { schemaVersion: 1, id: 'empty', name: 'x', instances: [], nets: [], ports: [] },
      base,
    );
    expect(doc.syms.filter((s) => s.kind === 'input' || s.kind === 'output').length).toBe(
      base.syms.filter((s) => s.kind === 'input' || s.kind === 'output').length,
    );
    expect(doc.wires.length).toBe(0);
  });
});

describe('逻辑门版参考解（简洁版一键出答案）', () => {
  /** 教学门积木 → 画布库条目（与 App 注入 doc.library 的方式一致） */
  const stored = TEACHING_MODULES.map((m) => ({
    hash: m.hash,
    name: m.name,
    version: m.version,
    stage: m.stage,
    costHalf: m.costHalf,
    isSequential: m.isSequential,
    ports: m.ports,
    template: m,
    sources: [],
    createdAt: 0,
  }));

  it('5 个算术关都有门版；直接判定通关且满分，成本不高于元件版', () => {
    const library = new InMemoryModuleLibrary([...TEACHING_MODULES]);
    let checked = 0;
    for (const level of ALL_LEVELS) {
      const teaching = teachingSolutionOf(level.id);
      if (!teaching) continue;
      checked++;
      const r = judgeDesign(teaching, level, { library, hardcore: true });
      expect(r.pass, `${level.id} 门版应通关：${r.errors.join('；')}`).toBe(true);
      expect(r.score, `${level.id} 门版应满分`).toBe(100);
      expect(r.costHalf, `${level.id} 门版成本应 ≤ 元件版`).toBeLessThanOrEqual(level.optimalHalf);
    }
    expect(checked).toBe(5);
  });

  it('门版 还原 → 再导出 → 判定通关且满分（App 的完整链路）', () => {
    const library = new InMemoryModuleLibrary([...TEACHING_MODULES]);
    let checked = 0;
    for (const level of ALL_LEVELS) {
      const teaching = teachingSolutionOf(level.id);
      if (!teaching) continue;
      checked++;
      const base = docForLevel(level, stored);
      const doc = fromDesign(teaching, base);
      // 门版用模块积木：画布上应该是 module sym 而不是几百个晶体管
      expect(
        doc.syms.filter((s) => s.kind === 'module').length,
        `${level.id} 门版应全是模块积木`,
      ).toBe(teaching.instances.filter((i) => i.kind === 'module').length);
      const design = toDesign(doc);
      const r = judgeDesign(design, level, { library, hardcore: true });
      expect(r.pass, `${level.id} 门版还原后应通关：${r.errors.join('；')}`).toBe(true);
      expect(r.score, `${level.id} 门版还原后应满分`).toBe(100);
    }
    expect(checked).toBe(5);
  });
});
