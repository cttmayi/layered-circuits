// @vitest-environment jsdom
/**
 * 组件库版本管理 / 溯源 / 重挑战榜 / 存档导入导出（M3-D、M3-E）自检。
 *
 * 两条关键约束：
 *  - 同名模块再次封装 = **新增版本**，老版本必须还在（否则复古复用关没法玩）；
 *  - 坏存档不许污染现有进度（导入失败必须原样返回错误）。
 */

import { describe, expect, it } from 'vitest';
import type { StoredModule } from '../src/editor/model';
import {
  addModule,
  compareVersions,
  nextVersion,
  storeModule,
  traceOf,
  traceSize,
  versionsOfName,
} from '../src/level/library';
import {
  emptyProgress,
  exportSave,
  importSave,
  leaderboard,
  recordAttempt,
  recordClear,
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
});

describe('本地重挑战榜（M3-E）', () => {
  it('只统计通关过的关卡，并标出是否已经做到已知最省', () => {
    let progress = emptyProgress();
    expect(leaderboard(progress).every((row) => !row.cleared)).toBe(true);

    // 第 1 关：标准解 8 半单位，通关
    progress = recordClear(progress, 's1-not', 100, 8);
    progress = recordAttempt(progress, 's1-not');
    progress = recordAttempt(progress, 's1-not');
    // 异或门：已知最省 42（求解器结论），玩家做到 56
    progress = recordClear(progress, 's1-xor', 78, 56);

    const rows = leaderboard(progress);
    const not = rows.find((r) => r.levelId === 's1-not');
    expect(not?.cleared).toBe(true);
    expect(not?.bestCostHalf).toBe(8);
    expect(not?.attempts).toBe(2);
    expect(not?.atBestKnown).toBe(true);

    const xor = rows.find((r) => r.levelId === 's1-xor');
    expect(xor?.optimalHalf).toBe(56);
    expect(xor?.bestKnownHalf).toBe(42);
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
