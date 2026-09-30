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
  recordSideJob,
  sideJobCount,
  starsOf,
} from '../src/level/progress';
import { applySideJob, type SideJob, sideJobsOf } from '../src/level/sideJobs';

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

    // 第 1 关：标准解 8 半单位，通关（但已知最省是 6 —— 输入是弱信号源，可省掉基极限流电阻）
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
    expect(not?.bestKnownHalf).toBe(6);
    expect(not?.atBestKnown).toBe(false); // 8 > 6：还没追到省电阻版

    // 玩家用省电阻版做到 6 → 标「已到最省」
    progress = recordClear(progress, 's1-not', 100, 6);
    const not2 = leaderboard(progress).find((r) => r.levelId === 's1-not');
    expect(not2?.atBestKnown).toBe(true);

    const xor = rows.find((r) => r.levelId === 's1-xor');
    expect(xor?.optimalHalf).toBe(56);
    expect(xor?.bestKnownHalf).toBe(42);
    expect(xor?.atBestKnown).toBe(false); // 56 > 42：还没追到求解器的最省版
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
  it('星级规则：功能 1 星，材料费 ≤ 对标 2 星，硬核时序达标 3 星', () => {
    const base = { pass: true, score: 60, timingBudgetPs: null as number | null, timingOk: false };
    expect(starsOf({ ...base, pass: false }, true)).toBe(0);
    expect(starsOf(base, false)).toBe(1); // 只交付
    expect(starsOf({ ...base, score: 100 }, false)).toBe(2); // 满分 + 非硬核
    expect(starsOf(base, true)).toBe(2); // 硬核交付（没有时序预算的关卡）
    expect(starsOf({ ...base, score: 100 }, true)).toBe(3);
    // 有时序预算的关卡：时序星看 timingOk，与模式无关
    expect(starsOf({ ...base, timingBudgetPs: 7000, timingOk: false }, true)).toBe(1);
    expect(starsOf({ ...base, timingBudgetPs: 7000, timingOk: true, score: 100 }, false)).toBe(3);
  });

  it('星级与利润取历史最好，钱包是各关最好一次的利润之和', () => {
    let progress = recordClear(emptyProgress(), 's1-not', 60, 10, 1);
    expect(progress.cleared['s1-not']?.stars).toBe(1);
    // 重挑战拿了满分三星、成本更低 → 星级与利润都刷新
    progress = recordClear(progress, 's1-not', 100, 8, 3);
    expect(progress.cleared['s1-not']?.stars).toBe(3);
    expect(progress.walletHalf).toBe(2); // 款项 10 − 材料费 8 = 2 半单位（1 元）
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

describe('支线单（加急 / 手工 / 省料）', () => {
  it('加急单压缩交期，手工单禁用组件库，早期关卡改成省料单', () => {
    const notLevel = ALL_LEVELS[0] as Level;
    const jobs = sideJobsOf(notLevel);
    expect(jobs.map((j) => j.key)).toEqual(['rush', 'lean']); // 第 1 关本来就不给用积木

    const rush = jobs[0] as SideJob;
    const rushed = applySideJob(notLevel, rush);
    expect(rushed.timingBudgetPs).toBe(Math.floor((notLevel.timingBudgetPs ?? 0) * 0.75));
    expect(rushed.budgetHalf).toBe(notLevel.budgetHalf); // 加急不动款项

    const lean = applySideJob(notLevel, jobs[1] as SideJob);
    expect(lean.budgetHalf).toBe(notLevel.optimalHalf); // 省料单要求做到对标成本

    // 后面的关卡能用手工单：模块通道被彻底关掉
    const laterLevel = ALL_LEVELS.find((l) => l.moduleAccess !== 'none') as Level;
    const manual = sideJobsOf(laterLevel).find((j) => j.key === 'manual') as SideJob;
    expect(applySideJob(laterLevel, manual).moduleAccess).toBe('none');
  });

  it('支线奖金入钱包（每关每支线只发一次，取最大）', () => {
    let progress = emptyProgress();
    progress = recordClear(progress, 's1-not', 100, 8, 3);
    const before = progress.walletHalf;
    progress = recordSideJob(progress, 's1-not', 'rush', 4);
    expect(progress.walletHalf).toBe(before + 4);
    progress = recordSideJob(progress, 's1-not', 'rush', 4); // 重复达成不重复发钱
    expect(progress.walletHalf).toBe(before + 4);
    expect(sideJobCount(progress)).toBe(1);
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
