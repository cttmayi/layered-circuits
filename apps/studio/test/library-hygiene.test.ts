// @vitest-environment jsdom
/**
 * 组件库卫生：
 * ① 库瘦身按**名字**删旧版本 —— 但"同名"不等于"同一谱系"（玩家可以把两个完全不同的电路
 *    都叫「非门」，自动版本号只按名字递增）。被存档画布引用到的模块必须保留，否则画布上的
 *    实例解析不到、导线静默消失（编译器只报一句"模块不在组件库中"）。
 * ② 自动补进画布库的教学积木必须带 teaching 标记，否则会混进「我的模块」栏 ——
 *    名字一样、样子一样，玩家分不清哪个是自己封装的（曾把玩家自己那个 8 元非门
 *    和 6 元的积木非门当成同一个东西）。
 */
import { findLevel, TEACHING_MODULES } from '@lc/content';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSym, type Doc, type StoredModule } from '../src/editor/model';
import { dedupeLibrary, storeModule } from '../src/level/library';
import { docForLevel } from '../src/level/progress';
import { docFor, initialSession, storageKeyFor } from '../src/level/session';
import { handleRequest } from '../src/sim/handle';

const PROGRESS_KEY = 'lc-studio-progress-v1';

/** 用真封装造一个模块（省得手写模板） */
function makeModule(name: string, id: string, variant = false): StoredModule {
  const wrapped = handleRequest({
    id: 1,
    type: 'wrap',
    library: [],
    name,
    stage: 1,
    design: {
      schemaVersion: 1,
      id,
      name,
      instances: [
        { kind: 'vcc', id: 'vcc1' },
        { kind: 'gnd', id: 'gnd1' },
        { kind: 'unit', id: 'r1', unit: 'res' },
        { kind: 'unit', id: 'q1', unit: 'npn' },
        { kind: 'unit', id: 'r2', unit: 'res' },
        ...(variant ? [{ kind: 'unit' as const, id: 'r3', unit: 'res' as const }] : []),
      ],
      nets: [
        { id: 'na', pins: [{ inst: 'r1', pin: 'a', bit: 0 }] },
        {
          id: 'nb',
          pins: [
            { inst: 'r1', pin: 'b', bit: 0 },
            { inst: 'q1', pin: 'b', bit: 0 },
          ],
        },
        {
          id: 'ng',
          pins: [
            { inst: 'gnd1', pin: 'p', bit: 0 },
            { inst: 'q1', pin: 'e', bit: 0 },
          ],
        },
        {
          id: 'ny',
          pins: [
            { inst: 'q1', pin: 'c', bit: 0 },
            { inst: 'r2', pin: 'b', bit: 0 },
          ],
        },
        {
          id: 'nv',
          pins: [
            { inst: 'vcc1', pin: 'p', bit: 0 },
            { inst: 'r2', pin: 'a', bit: 0 },
          ],
        },
      ],
      ports: [
        { id: 'a', name: 'a', dir: 'in', width: 1, nets: ['na'] },
        { id: 'y', name: 'y', dir: 'out', width: 1, nets: ['ny'] },
      ],
    },
  }).wrapped!;
  return storeModule([], {
    hash: wrapped.hash,
    name,
    costHalf: wrapped.costHalf,
    isSequential: wrapped.isSequential,
    ports: wrapped.ports,
    template: wrapped.template,
    stage: 1,
  });
}

/** 某个关卡的存档画布：预置元件 + 一个模块实例 */
function canvasWith(levelId: string, hash: string): Doc {
  const level = findLevel(levelId)!;
  const base = docForLevel(level, []);
  const u1 = createSym(base, 'module', undefined, 300, 320, hash);
  return { ...base, syms: [...base.syms, u1] };
}

describe('库瘦身：被画布引用的模块不能被删', () => {
  it('没有引用时：同名只留最新版本（瘦身照旧生效）', () => {
    const old = { ...makeModule('非门', 'a'), version: '1.0' };
    const fresh = { ...makeModule('非门', 'b', true), version: '1.1' };
    expect(old.hash).not.toBe(fresh.hash);
    expect(dedupeLibrary([old, fresh]).map((m) => m.hash)).toEqual([fresh.hash]);
  });

  it('被画布引用时：低版本也留下', () => {
    const old = { ...makeModule('非门', 'a'), version: '1.0', hash: 'hash-old' };
    const fresh = { ...makeModule('非门', 'b'), version: '1.1', hash: 'hash-new' };
    expect(dedupeLibrary([old, fresh], new Set(['hash-old'])).map((m) => m.hash)).toEqual([
      'hash-old',
      'hash-new',
    ]);
  });

  it('同一份内容（同哈希）只留一条', () => {
    const a = { ...makeModule('非门', 'a'), version: '1.0' };
    expect(dedupeLibrary([a, { ...a, version: '1.1' }])).toHaveLength(1);
  });

  it('端到端：画布上放着旧版本的模块，读档后它还在（导线不会静默消失）', () => {
    const old = { ...makeModule('非门', 'a'), version: '1.0' };
    const fresh = { ...makeModule('非门', 'b', true), version: '1.1' };
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({ cleared: {}, attempts: {}, library: [old, fresh] }),
    );
    localStorage.setItem(
      storageKeyFor('level', 's2-sr-latch'),
      JSON.stringify(canvasWith('s2-sr-latch', old.hash)),
    );
    const session = initialSession();
    expect(session.progress.library.map((m) => m.hash).sort()).toEqual(
      [old.hash, fresh.hash].sort(),
    );
    // 模块实例在画布库里可解析（否则 pinOffsets 拿不到引脚、导线会被丢掉）
    const doc = docFor('level', 's2-sr-latch', session.progress.library);
    expect(doc.library.some((m) => m.hash === old.hash)).toBe(true);
  });
});

describe('自动补进画布库的教学积木带 teaching 标记', () => {
  beforeEach(() => localStorage.clear());

  it('不混进「我的模块」栏（否则和玩家自制模块分不清）', () => {
    const brick = TEACHING_MODULES.find((m) => m.name === '非门')!;
    localStorage.setItem(
      storageKeyFor('level', 's2-sr-latch'),
      JSON.stringify(canvasWith('s2-sr-latch', brick.hash)),
    );
    // 玩家库里没有这个积木 → resolveMissingModules 会把它补进来供编译解析
    const doc = docFor('level', 's2-sr-latch', []);
    const injected = doc.library.find((m) => m.hash === brick.hash);
    expect(injected).toBeDefined();
    expect(injected?.teaching).toBe(true);
    expect(doc.library.filter((m) => !m.teaching)).toEqual([]);
  });
});
