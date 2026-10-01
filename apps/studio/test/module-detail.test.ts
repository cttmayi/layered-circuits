import { wrapModule } from '@lc/compiler';
import { DesignBuilder, InMemoryModuleLibrary, type ModuleTemplate } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { fromDesign, type StoredModule } from '../src/editor/model';
import { moduleGlyph } from '../src/editor/render';
import {
  docBounds,
  docForModuleBody,
  fitCamera,
  libraryWithNested,
} from '../src/panels/ModuleDetailModal';

/** 把模板包装成画布库条目（与 App 的 teachingStoredFor 同构） */
function toStored(t: ModuleTemplate): StoredModule {
  return {
    hash: t.hash,
    name: t.name,
    version: t.version,
    stage: t.stage,
    costHalf: t.costHalf,
    isSequential: t.isSequential,
    ports: t.ports,
    template: t,
    sources: [],
    createdAt: 0,
  };
}

/** 一个可封装的反相器 Design → ModuleTemplate（空库可编译） */
function notTemplate(name: string): ModuleTemplate {
  const b = new DesignBuilder(`d-${name}`, name);
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('res', { a: 'vcc', b: 'y' }, 'R1');
  b.unit('res', { a: 'a', b: 'b1' }, 'R2');
  b.unit('npn', { c: 'y', b: 'b1', e: 'gnd' }, 'Q1');
  b.port('a', 'in', 'a');
  b.port('y', 'out', 'y');
  const design = b.build();
  return wrapModule(
    { name, stage: 1, kind: 'logic', ports: design.ports, body: design },
    new InMemoryModuleLibrary(),
  ).template;
}

describe('moduleGlyph（门符号字符，Feature 1）', () => {
  it('门类模块映射到 IEC 符号字符', () => {
    expect(moduleGlyph('与门')).toEqual({ text: '&', bubble: false });
    expect(moduleGlyph('或门')).toEqual({ text: '≥1', bubble: false });
    expect(moduleGlyph('非门')).toEqual({ text: '1', bubble: true });
    expect(moduleGlyph('上拉反相器')).toEqual({ text: '1', bubble: true });
    expect(moduleGlyph('与非门')).toEqual({ text: '&', bubble: true });
    expect(moduleGlyph('或非门')).toEqual({ text: '≥1', bubble: true });
    expect(moduleGlyph('异或门')).toEqual({ text: '=1', bubble: false });
    expect(moduleGlyph('异或门（复古版）')).toEqual({ text: '=1', bubble: false });
    expect(moduleGlyph('同或门')).toEqual({ text: '=1', bubble: true });
    expect(moduleGlyph('CMOS 反相器')).toEqual({ text: '1', bubble: true });
    expect(moduleGlyph('CMOS 与非门')).toEqual({ text: '&', bubble: true });
  });

  it('非门类模块没有标准符号 → null（继续显示名称）', () => {
    expect(moduleGlyph('全加器')).toBeNull();
    expect(moduleGlyph('半加器')).toBeNull();
    expect(moduleGlyph('D锁存器')).toBeNull();
    expect(moduleGlyph('寄存器')).toBeNull();
    expect(moduleGlyph('')).toBeNull();
  });
});

describe('libraryWithNested（递归收集子模块模板，Feature 2）', () => {
  it('把 body 里引用的子模块模板一层层挖出来', () => {
    const inner = notTemplate('内部门');
    const innerLib = new InMemoryModuleLibrary([inner]);
    const b = new DesignBuilder('outer', '外层模块');
    b.module(inner.hash, { a: 'x', y: 'y' }, '内部门');
    b.port('x', 'in', 'x');
    b.port('y', 'out', 'y');
    const outerDesign = b.build();
    const outer = wrapModule(
      { name: '外层模块', stage: 1, kind: 'logic', ports: outerDesign.ports, body: outerDesign },
      innerLib,
    ).template;

    const merged = libraryWithNested(toStored(outer), [toStored(inner)]);
    const hashes = merged.map((m) => m.hash);
    expect(hashes).toContain(outer.hash);
    expect(hashes).toContain(inner.hash);
    // 去重：同一个模板只出现一次
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('库缺子模块时不炸，只收集能解析到的部分', () => {
    const inner = notTemplate('内部门');
    const b = new DesignBuilder('outer2', '外层模块2');
    b.module(inner.hash, { a: 'x', y: 'y' }, '内部门');
    b.port('x', 'in', 'x');
    b.port('y', 'out', 'y');
    const outerDesign = b.build();
    const outer = wrapModule(
      { name: '外层模块2', stage: 1, kind: 'logic', ports: outerDesign.ports, body: outerDesign },
      new InMemoryModuleLibrary([inner]),
    ).template;
    // 库为空 → 只能收集到根模块自己
    const merged = libraryWithNested(toStored(outer), []);
    expect(merged.map((m) => m.hash)).toEqual([outer.hash]);
  });
});

describe('模块内部电路展开（Feature 2）', () => {
  it('docForModuleBody + fromDesign 把 body 还原成可渲染 Doc', () => {
    const inner = notTemplate('内部门');
    const innerLib = new InMemoryModuleLibrary([inner]);
    const b = new DesignBuilder('outer3', '外层模块3');
    b.module(inner.hash, { a: 'x', y: 'y' }, '内部门');
    b.port('x', 'in', 'x');
    b.port('y', 'out', 'y');
    const outerDesign = b.build();
    const outer = wrapModule(
      { name: '外层模块3', stage: 1, kind: 'logic', ports: outerDesign.ports, body: outerDesign },
      innerLib,
    ).template;
    const merged = libraryWithNested(toStored(outer), [toStored(inner)]);
    const doc = fromDesign(outer.body, docForModuleBody(outer, merged));

    // 端口：1 入 1 出
    expect(doc.syms.filter((s) => s.kind === 'input').length).toBe(1);
    expect(doc.syms.filter((s) => s.kind === 'output').length).toBe(1);
    // 子模块实例展开成 module 符号
    expect(doc.syms.some((s) => s.kind === 'module')).toBe(true);
    // 有连线（端口 → 子模块 → 端口）
    expect(doc.wires.length).toBeGreaterThan(0);
  });

  it('docBounds / fitCamera 给出有限可用的取景参数', () => {
    const tpl = notTemplate('非门');
    const doc = fromDesign(tpl.body, docForModuleBody(tpl, [toStored(tpl)]));
    const bounds = docBounds(doc);
    expect(bounds.w).toBeGreaterThan(0);
    expect(bounds.h).toBeGreaterThan(0);
    const cam = fitCamera(doc, 640, 300);
    expect(cam.scale).toBeGreaterThan(0);
    expect(Number.isFinite(cam.x)).toBe(true);
    expect(Number.isFinite(cam.y)).toBe(true);
  });
});

describe('fromDesign：参考解模块实例显示门名而不是 G1 编号（回归）', () => {
  it('实例 label 是自动编号（G1）时，画布模块 label 用库里的门名', () => {
    const gate = notTemplate('与非门');
    const b = new DesignBuilder('ans', '参考解');
    b.module(gate.hash, { a: 'x', y: 'y' }, 'G1');
    b.port('x', 'in', 'x');
    b.port('y', 'out', 'y');
    const design = b.build();

    const doc = fromDesign(design, {
      id: 'base',
      name: 'base',
      syms: [],
      wires: [],
      library: [toStored(gate)],
    });
    const m = doc.syms.find((s) => s.kind === 'module');
    expect(m?.module).toBe(gate.hash);
    expect(m?.label).toBe('与非门');
  });
});
