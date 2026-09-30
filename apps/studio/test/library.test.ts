// @vitest-environment jsdom
/**
 * 组件库版本管理 / 溯源 / 重挑战榜 / 存档导入导出（M3-D、M3-E）自检。
 *
 * 两条关键约束：
 *  - 同名模块再次封装 = **新增版本**，老版本必须还在（否则复古复用关没法玩）；
 *  - 坏存档不许污染现有进度（导入失败必须原样返回错误）。
 */

import { ALL_LEVELS } from '@lc/content';
import type { Level } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import type { StoredModule } from '../src/editor/model';
import {
  addModule,
  compareVersions,
  dedupeLibrary,
  nextVersion,
  storeModule,
  traceOf,
  traceSize,
  versionsOfName,
} from '../src/level/library';
import {
  docForLevel,
  emptyProgress,
  exportSave,
  importSave,
  leaderboard,
  rankOf,
  recordAttempt,
  recordClear,
  starsOf,
} from '../src/level/progress';

function makeModule(name: string, hash: string, extra: Partial<StoredModule> = {}): StoredModule {
  return {
    hash,
    name,
    version: '1.0',
    stage: 1,
    costHalf: 8,
    isSequential: false,
    ports: [
      { id: 'a', name: 'a', dir: 'in', width: 1 },
      { id: 'y', name: 'y', dir: 'out', width: 1 },
    ],
    template: { hash },
    sources: [],
    createdAt: 0,
    ...extra,
  };
}

describe('组件库版本管理', () => {
  it('版本号按数值比较（1.10 比 1.2 新），同名模块再次封装 minor +1', () => {
    expect(compareVersions('1.10', '1.2')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0')).toBe(0);
    expect(compareVersions('2.0', '1.9')).toBeGreaterThan(0);

    let library: StoredModule[] = [];
    expect(nextVersion(library, '与非门')).toBe('1.0');
    library = addModule(library, makeModule('与非门', 'h1'));
    expect(nextVersion(library, '与非门')).toBe('1.1');
    const second = storeModule(library, {
      hash: 'h2',
      name: '与非门',
      costHalf: 6,
      isSequential: false,
      ports: [],
      template: {},
      stage: 1,
      levelId: 's1-nand',
    });
    expect(second.version).toBe('1.1');
    library = addModule(library, second);
    expect(versionsOfName(library, '与非门').map((m) => m.version)).toEqual(['1.1', '1.0']);
    // 老版本依然在库里 —— 复古复用关要靠它
    expect(library.filter((m) => m.name === '与非门')).toHaveLength(2);
  });

  it('同一份电路（同哈希）不会重复入库', () => {
    const library = addModule([], makeModule('非门', 'h1'));
    const again = addModule(library, makeModule('非门', 'h1'));
    expect(again).toHaveLength(1);
  });

  it('溯源树能一路展开到最底层模块，并标出来自哪一关', () => {
    const gate = makeModule('与非门', 'h-gate', { levelId: 's1-nand' });
    const not = makeModule('非门', 'h-not', { levelId: 's1-not', costHalf: 8 });
    const xor = makeModule('异或门', 'h-xor', {
      version: '1.0',
      costHalf: 56,
      levelId: 's1-xor',
      sources: ['h-gate', 'h-not'],
    });
    const library = [gate, not, xor];

    const trace = traceOf(library, 'h-xor');
    expect(trace?.name).toBe('异或门');
    expect(trace?.levelId).toBe('s1-xor');
    expect(trace?.children.map((c) => c.name).sort()).toEqual(['与非门', '非门']);
    expect(traceSize(trace as NonNullable<typeof trace>)).toBe(3);
  });

  it('溯源遇到存档被手改成环时不会死循环', () => {
    const a = makeModule('A', 'h-a', { sources: ['h-b'] });
    const b = makeModule('B', 'h-b', { sources: ['h-a'] });
    const node = traceOf([a, b], 'h-a');
    expect(node).not.toBeNull();
    expect(traceSize(node as NonNullable<typeof node>)).toBeLessThan(10);
  });

  it('存档瘦身 dedupeLibrary：同名模块只留版本号最高的一个，其它名字不受影响', () => {
    const not10 = makeModule('非门', 'h-n1', { version: '1.0', costHalf: 6 });
    const not11 = makeModule('非门', 'h-n2', { version: '1.1', costHalf: 8 });
    const dff10 = makeModule('D触发器', 'h-d1', { version: '1.0', costHalf: 136 });
    const dff11 = makeModule('D触发器', 'h-d2', { version: '1.1', costHalf: 136 });
    const and1 = makeModule('与门', 'h-a1', { version: '1.0' });
    const input = [not10, dff10, and1, not11, dff11];
    const out = dedupeLibrary(input);
    // 每名只剩最新版（保留原顺序）
    expect(out).toEqual([and1, not11, dff11]);
    // 空库 / 无重复库原样返回
    expect(dedupeLibrary([])).toEqual([]);
    expect(dedupeLibrary([and1])).toEqual([and1]);
  });
});

describe('本地重挑战榜（M3-E）', () => {
  it('只统计通关过的关卡，并标出是否已经做到已知最省', () => {
    let progress = emptyProgress();
    expect(leaderboard(progress).every((row) => !row.cleared)).toBe(true);

    // 第 1 关：标准解 12 半单位，通关（但已知最省是 8 —— 输入是弱信号源，可省掉基极限流电阻）
    progress = recordClear(progress, 's1-not', 100, 12);
    progress = recordAttempt(progress, 's1-not');
    progress = recordAttempt(progress, 's1-not');
    // 异或门：已知最省 44（求解器结论），玩家做到 80
    progress = recordClear(progress, 's1-xor', 78, 80);

    const rows = leaderboard(progress);
    const not = rows.find((r) => r.levelId === 's1-not');
    expect(not?.cleared).toBe(true);
    expect(not?.bestCostHalf).toBe(12);
    expect(not?.attempts).toBe(2);
    expect(not?.bestKnownHalf).toBe(8);
    expect(not?.atBestKnown).toBe(false); // 12 > 8：还没追到省电阻版

    // 玩家用省电阻版做到 8 → 标「已到最省」
    progress = recordClear(progress, 's1-not', 100, 8);
    const not2 = leaderboard(progress).find((r) => r.levelId === 's1-not');
    expect(not2?.atBestKnown).toBe(true);

    const xor = rows.find((r) => r.levelId === 's1-xor');
    expect(xor?.optimalHalf).toBe(80);
    expect(xor?.bestKnownHalf).toBe(44);
    expect(xor?.atBestKnown).toBe(false); // 80 > 44：还没追到求解器的最省版
    expect(xor?.atBestKnown).toBe(false);
    expect(xor?.bestScore).toBe(78);
  });

  it('重复通关保留历史最低成本与最高分', () => {
    let progress = recordClear(emptyProgress(), 's1-nand', 100, 14);
    progress = recordClear(progress, 's1-nand', 62, 24);
    const row = leaderboard(progress).find((r) => r.levelId === 's1-nand');
    expect(row?.bestCostHalf).toBe(14);
    expect(row?.bestScore).toBe(100);
  });
});

describe('存档导入导出（M3-E）', () => {
  it('导出再导入得到同一份进度（含组件库各版本与溯源）', () => {
    const library = [
      makeModule('与非门', 'h1', { version: '1.0' }),
      makeModule('与非门', 'h2', { version: '1.1' }),
    ];
    const progress = recordClear({ ...emptyProgress(), library }, 's1-nand', 100, 14);
    const text = exportSave(progress, 1234);
    const { progress: imported, error } = importSave(text);
    expect(error).toBeUndefined();
    expect(imported.cleared['s1-nand']?.bestCostHalf).toBe(14);
    expect(imported.library.map((m) => m.version)).toEqual(['1.0', '1.1']);
  });

  it('坏存档被拒绝，且不返回半成品进度', () => {
    expect(importSave('not json').error).toContain('JSON');
    expect(importSave('{"format":"other"}').error).toContain('存档');
    expect(importSave('{"format":"layered-circuits-save","schemaVersion":9}').error).toContain(
      '版本',
    );
  });

  it('缺字段的老存档也能读（字段逐个兜底）', () => {
    const text = JSON.stringify({
      format: 'layered-circuits-save',
      schemaVersion: 1,
      progress: { cleared: { 's1-not': { score: 100, bestCostHalf: 8, clearedAt: 1 } } },
    });
    const { progress, error } = importSave(text);
    expect(error).toBeUndefined();
    expect(progress.library).toEqual([]);
    expect(progress.attempts).toEqual({});
    expect(progress.cleared['s1-not']?.clearedAt).toBe(1);
  });
});

describe('三星目标与称号（P1）', () => {
  it('星级规则：元件成本与传播延迟各按基准线四档（0.5=3星/0.75=2星/1=1星/超=0星），取较差', () => {
    // 元件成本线 = 标准答案 × 2：成本档
    const base = {
      pass: true,
      costHalf: 50,
      budgetHalf: 100,
      timingBudgetPs: null as number | null,
      criticalPathPs: 0,
    };
    expect(starsOf({ ...base, pass: false })).toBe(0);
    expect(starsOf({ ...base, costHalf: 50 })).toBe(3); // 0.5 × 元件成本线 = 标准答案
    expect(starsOf({ ...base, costHalf: 40 })).toBe(3); // ≤ 0.5 都算 3 星
    expect(starsOf({ ...base, costHalf: 60 })).toBe(2); // 0.6 × 元件成本线 → 2 星档
    expect(starsOf({ ...base, costHalf: 75 })).toBe(2); // ≤ 0.75 × 元件成本线
    expect(starsOf({ ...base, costHalf: 100 })).toBe(1); // ≤ 1（元件成本线）
    expect(starsOf({ ...base, costHalf: 101 })).toBe(0); // 超元件成本线 = 0 星（仍可交付）
    // 传播延迟档与元件成本取较差（传播延迟 = 输入到输出稳定的时间）
    expect(starsOf({ ...base, timingBudgetPs: 1000, criticalPathPs: 500 })).toBe(3); // 0.5 × 延迟预算
    expect(starsOf({ ...base, timingBudgetPs: 1000, criticalPathPs: 750 })).toBe(2); // 0.75 × 延迟预算
    expect(starsOf({ ...base, timingBudgetPs: 1000, criticalPathPs: 1000 })).toBe(1);
    expect(starsOf({ ...base, costHalf: 50, timingBudgetPs: 1000, criticalPathPs: 1100 })).toBe(0); // 延迟超预算 → 0 星
    expect(starsOf({ ...base, costHalf: 75, timingBudgetPs: 1000, criticalPathPs: 500 })).toBe(2); // 成本 2 星、延迟 3 星 → 取较差 2 星
    // 成本挑战关（budgetHalf = 0）：不设成本线 → 成本档达标，只按传播延迟评星
    expect(starsOf({ ...base, budgetHalf: 0, costHalf: 999 })).toBe(3);
    expect(
      starsOf({
        ...base,
        budgetHalf: 0,
        costHalf: 999,
        timingBudgetPs: 1000,
        criticalPathPs: 1100,
      }),
    ).toBe(0); // 延迟超线仍 0 星
  });

  it('星级与利润取历史最好，钱包是各关最好一次的利润之和', () => {
    let progress = recordClear(emptyProgress(), 's1-not', 60, 10, 1);
    expect(progress.cleared['s1-not']?.stars).toBe(1);
    // 重挑战拿了满分三星、成本更低 → 星级与利润都刷新
    progress = recordClear(progress, 's1-not', 100, 8, 3);
    expect(progress.cleared['s1-not']?.stars).toBe(3);
    // 预算线 = 标准答案 × 2：款项 24 半（12 元）− 材料费 8 半 = 16 半（8 元）
    expect(progress.walletHalf).toBe(16);
    expect(progress.cleared['s1-not']?.score).toBe(100);
    expect(progress.cleared['s1-not']?.bestCostHalf).toBe(8);
  });

  it('称号按通关数与钱包升级，并给出下一级差距', () => {
    let progress = emptyProgress();
    expect(rankOf(progress).title).toBe('学徒');
    expect(rankOf(progress).next).toContain('维修铺师傅');
    progress = recordClear(progress, 's1-not', 100, 8, 3);
    progress = recordClear(progress, 's1-and', 100, 8, 3);
    expect(rankOf(progress).title).toBe('学徒'); // 只通了 2 单，还不够 3 单
    progress = recordClear(progress, 's1-or', 100, 8, 3);
    expect(rankOf(progress).title).toBe('维修铺师傅');
  });
});

describe('关卡电源轨（VCC / GND 预置并锁定）', () => {
  it('每个关卡的初始画布都自带锁定的 VCC 与 GND，端口不可删', () => {
    const level = ALL_LEVELS[0] as Level;
    const doc = docForLevel(level, []);
    const rails = doc.syms.filter((sym) => sym.kind === 'vcc' || sym.kind === 'gnd');
    expect(rails.map((r) => `${r.kind}:${r.locked ? 'locked' : 'free'}`)).toEqual([
      'vcc:locked',
      'gnd:locked',
    ]);
    // 端口与电源轨全部锁定：删除会被拦截（symIsLocked 判定）
    expect(doc.syms.every((sym) => sym.locked)).toBe(true);
  });
});
