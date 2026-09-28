/**
 * 关卡类型（GDD 4.2 / 4.3 / 4.4）在判定侧的落地自检。
 *
 * 三条约束以前只有 schema 字段、没有真判定，等于纸上规则；这里逐条钉死：
 *  - 成本挑战关：没有预算上限（贵也能过），但会给「还能更省」的提示；
 *  - 复古复用关：禁用后期封装的模块、只放行白名单模块；
 *  - 素材约束：allowedUnits 之外的元件一律判错。
 */

import { designToModulePorts, judgeDesign, wrapModule } from '@lc/compiler';
import { InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { findLevel } from '../src/levels.js';
import { andGateRef, nandGateRef, xorGateRef } from '../src/references.js';
import { dffRef } from '../src/references-seq.js';

const level = (id: string) => {
  const found = findLevel(id);
  if (!found) throw new Error(`缺少关卡 ${id}`);
  return found;
};

/** 往组件库里塞几个模块，模拟玩家已经封装过的积木 */
function libraryWith(
  names: Array<'与非门' | '与门' | '异或门'>,
): Map<string, InMemoryModuleLibrary> {
  const byName = new Map<string, InMemoryModuleLibrary>();
  for (const name of names) {
    const library = new InMemoryModuleLibrary();
    const design =
      name === '与非门'
        ? nandGateRef(`ref-${name}`)
        : name === '与门'
          ? andGateRef(`ref-${name}`)
          : xorGateRef(`ref-${name}`);
    library.add(
      wrapModule(
        {
          name,
          stage: 1,
          kind: 'logic',
          ports: designToModulePorts(design),
          body: design,
        },
        library,
      ).template,
    );
    byName.set(name, library);
  }
  return byName;
}

describe('关卡类型：成本挑战关（GDD 4.2）', () => {
  it('没有预算上限：比标准解更贵的电路也能通关，只给提示', () => {
    const costLevel = level('s2-dff-cost');
    expect(costLevel.kind).toBe('cost');
    expect(costLevel.budgetHalf).toBe(0);

    const library = new InMemoryModuleLibrary();
    const result = judgeDesign(dffRef('ref-cost'), costLevel, { library, hardcore: true });
    expect(result.errors).toEqual([]);
    expect(result.pass).toBe(true);
    expect(result.overBudget).toBe(false);
  });
});

describe('关卡类型：复古复用关（GDD 4.4）', () => {
  it('禁用后期模块：用【与非门】模块会被判错，用白名单里的【与门】模块可以', () => {
    const retro = level('s1-xor-retro');
    expect(retro.kind).toBe('retro');
    expect(retro.bannedModules).toContain('与非门');

    const libraries = libraryWith(['与非门', '与门']);
    const nandLib = libraries.get('与非门')!;
    const andLib = libraries.get('与门')!;
    const reference = retro.referenceSolution!;

    // 1) 白名单里没有【与非门】→ 用它的模块必须判错
    const withNand = {
      ...reference,
      instances: [
        ...reference.instances,
        { kind: 'module' as const, id: 'mod1', module: nandLib.list()[0]!.hash, label: '与非门' },
      ],
    };
    const bannedResult = judgeDesign(withNand, retro, { library: nandLib });
    expect(bannedResult.pass).toBe(false);
    expect(bannedResult.errors.join('；')).toContain('本关只允许使用');

    // 2) 白名单内的【与门】模块：不该因为白名单被拦（功能上它是多余的，可能另有错，但不许是策略错）
    const withAnd = {
      ...reference,
      instances: [
        ...reference.instances,
        { kind: 'module' as const, id: 'mod1', module: andLib.list()[0]!.hash, label: '与门' },
      ],
    };
    const allowedErrors = judgeDesign(withAnd, retro, { library: andLib }).errors;
    expect(allowedErrors.filter((e) => e.includes('只允许使用'))).toEqual([]);
    expect(allowedErrors.filter((e) => e.includes('复古复用关禁用'))).toEqual([]);
  });
});

describe('素材约束（allowedUnits）', () => {
  it('关卡只发三极管和电阻时，用二极管会被判错', () => {
    const xor = level('s1-xor');
    expect(xor.allowedUnits).toEqual(['npn', 'res']);
    const reference = xor.referenceSolution!;
    const withDiode = {
      ...reference,
      instances: [
        ...reference.instances,
        {
          kind: 'unit' as const,
          id: 'd1',
          unit: 'dio' as const,
          pins: {},
          label: '偷偷加的二极管',
        },
      ],
    };
    const result = judgeDesign(withDiode, xor, { library: new InMemoryModuleLibrary() });
    expect(result.pass).toBe(false);
    expect(result.errors.join('；')).toContain('本关不提供');
  });
});

describe('关卡类型：时序挑战关（GDD 4.3）', () => {
  it('强制硬核：时钟频率与硬核时序预算都写在关卡里，参考解能过', () => {
    const fast = level('s2-dff-fast');
    expect(fast.kind).toBe('timing');
    expect(fast.clock?.freqHz).toBe(20_000_000);
    expect(fast.timingBudgetPs).toBe(20_000);
    expect(fast.checks.clockPort).toBe('clk');
    const result = judgeDesign(dffRef('ref-fast'), fast, {
      library: new InMemoryModuleLibrary(),
      hardcore: true,
    });
    expect(result.errors).toEqual([]);
    expect(result.timing?.timingOk).toBe(true);
    expect(result.timing?.edgeTriggered).toBe(true);
  });
});
