/**
 * 按契约的差异化参考解（familyRefs）：
 * - 每个 familyRefs 条目的参考解，用该契约规格（元件并集 / 满分线 / 预算 / 时序预算）
 *   判定必须过关且满分（成本 = 该契约 optimalHalf）；
 * - familySpecOf 的语义：教学关有变体按契约换（CMOS 学 MOS），无变体固定原规格；
 *   功能关跟随玩家契约、缺省回退 rtl；levelViewOf 让 UI 也按契约显示教学内容；
 * - 强输出契约（TTL/CMOS）会打回弱上拉凑出的高电平（一键答案给错工艺时玩家看得到报错）。
 */
import { judgeDesign } from '@lc/compiler';
import {
  DesignBuilder,
  FAMILIES,
  FAMILY_CONTRACTS,
  familySpecOf,
  InMemoryModuleLibrary,
  levelViewOf,
} from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { ALL_LEVELS } from '../src/levels.js';
import type { cmosInvRef } from '../src/references.js';

const lib = new InMemoryModuleLibrary();

/** 手搭一个 RTL 反相器（弱 1），用于验证强契约打回 */
function rtlInverter(): ReturnType<typeof cmosInvRef> {
  const b = new DesignBuilder('weak-inv', 'RTL 反相器');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('res', { a: 'vcc', b: 'y' }, 'R1');
  b.unit('npn', { c: 'y', b: 'a', e: 'gnd' }, 'Q1');
  b.port('a', 'in', 'a');
  b.port('y', 'out', 'y');
  return b.build();
}

describe('按契约参考解（familyRefs）', () => {
  it('每个 familyRefs 条目：参考解按契约规格判定过关且满分', () => {
    let count = 0;
    for (const level of ALL_LEVELS) {
      if (!level.familyRefs) continue;
      for (const family of FAMILIES) {
        const ref = level.familyRefs[family];
        if (!ref) continue;
        count++;
        const spec = familySpecOf(level, family);
        // 教学关变体：内容（端口/真值表/元件）在契约视图里，判定要用视图
        const view = levelViewOf(level, family);
        const r = judgeDesign(spec.reference, view, {
          library: lib,
          family: spec.family,
          units: spec.units,
          timingBudgetPs: spec.timingBudgetPs,
          optimalHalf: spec.optimalHalf,
          budgetHalf: spec.budgetHalf,
          bestKnownHalf: spec.bestKnownHalf,
          hardcore: true,
        });
        expect(r.pass, `${level.id}/${family} 参考解应过关：${r.errors.join('；')}`).toBe(true);
        expect(r.costHalf).toBe(spec.optimalHalf);
        expect(r.score).toBe(100);
      }
    }
    expect(count).toBeGreaterThanOrEqual(16);
  });

  it('一键答案按契约不一样：同一关不同契约的参考解成本/结构不同', () => {
    const level = ALL_LEVELS.find((l) => l.id === 's1-not')!;
    const rtl = familySpecOf(level, 'rtl');
    const cmos = familySpecOf(level, 'cmos');
    expect(cmos.optimalHalf).toBeLessThan(rtl.optimalHalf); // CMOS 无电阻更省
    expect(cmos.reference).not.toEqual(rtl.reference);
    // 结构不同：CMOS 版只用 MOS
    const kinds = new Set(
      cmos.reference.instances.map((i) => (i.kind === 'unit' ? (i as { unit: string }).unit : '')),
    );
    expect(kinds.has('nmos')).toBe(true);
    expect(kinds.has('res')).toBe(false);
  });

  it('familySpecOf：教学关无变体契约固定原规格，有变体契约（cmos）按契约换内容', () => {
    const teaching = ALL_LEVELS.find((l) => l.id === 's1-npn')!;
    // 无变体的契约（rtl/dtl/ttl）：固定原规格
    for (const family of FAMILIES.filter((f) => f !== 'cmos')) {
      const spec = familySpecOf(teaching, family);
      expect(spec.family).toBe('rtl'); // 教学关声明 rtl
      expect(spec.units).toEqual([...teaching.allowedUnits]);
      expect(spec.reference).toBe(teaching.referenceSolution);
    }
    // cmos 契约：教学变体（教 MOS 不教三极管）
    const cmos = familySpecOf(teaching, 'cmos');
    expect(cmos.units).toEqual(['nmos', 'res']);
    expect(cmos.reference).not.toBe(teaching.referenceSolution);
    const view = levelViewOf(teaching, 'cmos');
    expect(view.title).toContain('N-MOS'); // 标题跟着换
    expect(view.requiredUnits).toEqual(['nmos']);
    expect(view.allowedUnits).toEqual(['nmos', 'res']);
    expect(view.id).toBe(teaching.id); // id 不变 → 进度/解锁兼容
  });

  it('levelViewOf：教学关按契约换内容、id 不变；非教学关原样返回', () => {
    // CMOS 契约下三关教学关全部换成 MOS 教学内容
    const mos = {
      's1-npn': 'N-MOS',
      's1-dio': 'P-MOS',
      's1-float': 'CMOS',
    } as const;
    for (const [id, expectText] of Object.entries(mos)) {
      const level = ALL_LEVELS.find((l) => l.id === id)!;
      const view = levelViewOf(level, 'cmos');
      expect(view.title).toContain(expectText);
      expect(view.id).toBe(id);
      // 原样返回 rtl 契约
      expect(levelViewOf(level, 'rtl')).toBe(level);
    }
    // 非教学关（功能关）不受 levelViewOf 影响
    const gate = ALL_LEVELS.find((l) => l.id === 's1-not')!;
    expect(levelViewOf(gate, 'cmos')).toBe(gate);
  });

  it('familySpecOf：功能关缺省回退 rtl 规格（没有 familyRefs 的关不受契约影响）', () => {
    const level = ALL_LEVELS.find((l) => l.id === 's2-sr-latch')!;
    const spec = familySpecOf(level, 'cmos');
    expect(spec.family).toBe('rtl');
    expect(spec.optimalHalf).toBe(level.optimalHalf);
    expect(spec.reference).toBe(level.referenceSolution);
  });

  it('强输出契约打回弱 1：CMOS 契约下 RTL 反相器（上拉弱 1）被拒绝', () => {
    const level = ALL_LEVELS.find((l) => l.id === 's1-not')!;
    const spec = familySpecOf(level, 'cmos');
    const r = judgeDesign(rtlInverter(), level, {
      library: lib,
      family: spec.family,
      units: spec.units,
      optimalHalf: spec.optimalHalf,
      budgetHalf: spec.budgetHalf,
    });
    expect(r.pass).toBe(false);
    const msg = r.errors.join('；');
    expect(msg).toContain('强'); // 强度契约报错（推挽族输出高必须强 1）
    expect(msg).toContain(FAMILY_CONTRACTS.cmos.name.slice(0, 4) || 'CMOS');
  });

  it('弱输出契约不误伤：RTL 契约下 RTL 反相器过关', () => {
    const level = ALL_LEVELS.find((l) => l.id === 's1-not')!;
    const spec = familySpecOf(level, 'rtl');
    const r = judgeDesign(rtlInverter(), level, {
      library: lib,
      family: spec.family,
      units: spec.units,
      optimalHalf: spec.optimalHalf,
      budgetHalf: spec.budgetHalf,
    });
    expect(r.pass).toBe(true);
  });
});
