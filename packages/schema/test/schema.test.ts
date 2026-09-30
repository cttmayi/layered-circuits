import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../src/builder.js';
import { parseDesign } from '../src/design.js';
import { budgetFromOptimal, budgetOverhead, parseLevel, scoreOf } from '../src/level.js';
import { InMemoryModuleLibrary, ModuleTemplateSchema } from '../src/module.js';
import { costOf, formatCost } from '../src/units.js';

describe('DesignBuilder + Zod 校验', () => {
  it('构造出的 Design 能通过 schema 校验', () => {
    const b = new DesignBuilder('demo', '示例');
    b.vcc('vcc');
    b.gnd('gnd');
    b.unit('res', { a: 'vcc', b: 'out' });
    b.port('out', 'out', 'out');
    const design = b.build();
    expect(() => parseDesign(design)).not.toThrow();
  });

  it('非法实例（既没有 unit 也没有 module）被拒绝', () => {
    expect(() => parseDesign({ id: 'x', instances: [{ kind: 'unit', id: 'u1' }] })).toThrow();
  });

  it('总线端口按位连接', () => {
    const b = new DesignBuilder('bus');
    b.unit('res', { a: 'd0', b: 'q0' });
    b.unit('res', { a: 'd1', b: 'q1' });
    b.port('d', 'in', ['d0', 'd1']);
    b.port('q', 'out', ['q0', 'q1']);
    const design = parseDesign(b.build());
    expect(design.ports[0]!.width).toBe(2);
    expect(design.nets.find((n) => n.id === 'd1')!.pins).toEqual([
      { inst: 'res2', pin: 'a', bit: 0 },
    ]);
  });
});

describe('关卡数值规则（GDD 6.1）', () => {
  const baseLevel = {
    schemaVersion: 1 as const,
    id: 'L1',
    stage: 1 as const,
    kind: 'main' as const,
    title: '搭建非门',
    brief: '',
    mode: 'logic' as const,
    allowedUnits: ['npn', 'res', 'dio', 'cap'] as const,
    moduleAccess: 'none' as const,
    allowedModules: [],
    bannedModules: [],
    budgetHalf: 16,
    optimalHalf: 14,
    vectors: [],
  };

  it('预算 = 理论最优 × (1 + 上浮比例)，向上取整', () => {
    expect(budgetFromOptimal(14, 0.15)).toBe(17);
    expect(budgetFromOptimal(14, 0.2)).toBe(17);
  });

  it('上浮比例可反查', () => {
    const level = parseLevel({ ...baseLevel, allowedUnits: [...baseLevel.allowedUnits] });
    expect(budgetOverhead(level)).toBeCloseTo(16 / 14 - 1, 6);
  });

  it('评分：越接近理论最优分越高', () => {
    const level = parseLevel({ ...baseLevel, allowedUnits: [...baseLevel.allowedUnits] });
    expect(scoreOf(level, 14)).toBe(100);
    expect(scoreOf(level, 16)).toBe(0);
    expect(scoreOf(level, 15)).toBe(50);
  });

  it('成本口径：半分记账整数，展示时还原（二极管=1、电阻=2、电容=4、MOS=1）', () => {
    expect(formatCost({ npn: 0, res: 0, dio: 1, cap: 0, nmos: 0, pmos: 0 })).toBe('1');
    expect(costOf({ npn: 0, res: 0, dio: 1, cap: 0, nmos: 0, pmos: 0 })).toBe(1);
    expect(costOf({ npn: 0, res: 1, dio: 0, cap: 0, nmos: 0, pmos: 0 })).toBe(2);
    expect(costOf({ npn: 0, res: 0, dio: 0, cap: 1, nmos: 0, pmos: 0 })).toBe(4);
    expect(costOf({ npn: 0, res: 0, dio: 0, cap: 0, nmos: 2, pmos: 2 })).toBe(4);
  });
});

describe('组件库', () => {
  it('内存库按内容哈希索引，可去重', () => {
    const library = new InMemoryModuleLibrary();
    const template = ModuleTemplateSchema.parse({
      hash: 'h1',
      name: '非门',
      stage: 1,
      kind: 'logic',
      ports: [{ id: 'in', name: 'in', dir: 'in', width: 1 }],
      body: { id: 'b', instances: [], nets: [], ports: [] },
      costs: { npn: 2, res: 3, dio: 0, cap: 0 },
      costHalf: 14,
    });
    library.add(template);
    library.add(template);
    expect(library.size).toBe(1);
    expect(library.get('h1')!.costHalf).toBe(14);
  });
});
