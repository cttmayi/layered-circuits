// @vitest-environment jsdom
/**
 * 关卡模式「只列有 `levelId` 的模块」（用户第 ⑰ 轮拍板，原话：
 * 「自由模式搭建的模块 —— 在关卡中**全面不可见**」）。
 *
 * 口径：
 *   · **关卡模式（任何一关，逻辑关与时序关都算）**：只列**有 `levelId`** 的模块（关卡里自动封装产出的）；
 *     **没有 `levelId` 的一律不列**。
 *   · **老存档例外**：加 `levelId` 字段之前的老存档也没有这个字段 → 无 `levelId` 且 `stage >= 2`
 *     视为关卡产出（照旧走原规则，别让老存档的 D 锁存器消失）；无 `levelId` 且 `stage === 1` 一律不列。
 *   · **自由模式本身**照旧全列（反证用例）。
 *
 * 为什么 `stage === 1` 能代表"没进过关卡"：自由模式封装用 `stage: currentLevel?.stage ?? 1` →
 * 自由模式没有关卡 → **stage 恒为 1**，与电路是元件搭的还是**全用门搭的无关**（stage 来自当前关卡）。
 * 这条前提在 `palette-element-level-modules.test.tsx` 的 ⑥ 里用 App.tsx 原文 + 关卡 stage 数据钉住了。
 */

import { ALL_LEVELS } from '@lc/content';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import type { StoredModule } from '../src/editor/model';
import { dismissTaskDialog, enableDebugUrl, startJob } from './helpers';

const mod = (over: Partial<StoredModule> & { hash: string; name: string }): StoredModule =>
  ({
    version: '1.0.0',
    stage: 1,
    costHalf: 4,
    isSequential: false,
    ports: [{ name: 'a', dir: 'in', width: 1 }],
    template: null,
    sources: [],
    createdAt: 0,
    ...over,
  }) as StoredModule;

/** 自由模式手动封装的那种：没有 levelId、stage = 1（元件搭 / 全用门搭都是 1） */
const freeBuiltUnits = mod({ hash: 'free-u', name: '自由·元件搭的', stage: 1 });
const freeBuiltGates = mod({
  hash: 'free-g',
  name: '自由·全用门搭的',
  stage: 1,
  template: { body: { instances: [{ kind: 'module' }] } },
} as Partial<StoredModule> & { hash: string; name: string });
/** 关卡自动封装产出的：带 levelId（时序关 / 逻辑关各一个） */
const levelBuiltTiming = mod({
  hash: 'lv-t',
  name: '第 4 关产的与非门',
  levelId: 's1-nand',
  stage: 1,
});
const levelBuiltLogic = mod({
  hash: 'lv-l',
  name: '第 10 关产的锁存器',
  levelId: 's2-d-latch',
  stage: 2,
  isSequential: true,
});
/** 老存档：没有 levelId，但 stage >= 2 → 例外，照旧列 */
const legacyLogic = mod({ hash: 'old-l', name: '老存档·逻辑关产出', stage: 2, isSequential: true });

function cards(prefix: string) {
  const sec = [...document.querySelectorAll('.palette-section')].find((s) =>
    (s.querySelector('.palette-section-title')?.textContent || '').startsWith(prefix),
  );
  if (!sec) return [] as string[];
  return [...sec.querySelectorAll('.palette-item')].map((b) => {
    let payload = '';
    fireEvent.dragStart(b, {
      dataTransfer: {
        setData: (_t: string, v: string) => {
          payload = v;
        },
        effectAllowed: '',
        setDragImage: () => {},
      },
    });
    return `${(b.querySelector('.palette-name')?.textContent || '').trim()}@${payload.startsWith('module:') ? payload.slice(7, 15) : '?'}`;
  });
}

async function open(opts: { levelTitle?: string; free?: boolean; library: StoredModule[] }) {
  localStorage.clear();
  const cleared: Record<string, unknown> = {};
  if (opts.levelTitle) {
    const idx = ALL_LEVELS.findIndex((l) => l.title === opts.levelTitle);
    for (const l of ALL_LEVELS.slice(0, idx))
      cleared[l.id] = { score: 100, bestCostHalf: 0, clearedAt: 1 };
    localStorage.setItem(`lc-ui-task-seen-${ALL_LEVELS[idx].id}`, '1');
  }
  localStorage.setItem(
    'lc-studio-progress-v1',
    JSON.stringify({
      family: 'rtl',
      cleared,
      library: opts.library,
      attempts: {},
      walletHalf: 0,
      recon: {},
      sideJobs: {},
      spentHalf: 0,
      started: {},
    }),
  );
  enableDebugUrl();
  render(<App />);
  if (opts.free) {
    const freeBtn = [...document.querySelectorAll('button')].find((b) =>
      /自由搭建/.test(b.textContent || ''),
    );
    if (!freeBtn) throw new Error('找不到「自由搭建」按钮');
    fireEvent.click(freeBtn);
  } else if (opts.levelTitle) {
    startJob(opts.levelTitle);
    dismissTaskDialog();
  }
  await waitFor(
    () =>
      expect(document.querySelector('.legend') || document.querySelector('.palette')).toBeTruthy(),
    { timeout: 10000 },
  );
  await waitFor(
    () => expect(document.querySelectorAll('.palette-section').length).toBeGreaterThan(0),
    { timeout: 8000 },
  );
}

describe('关卡模式只列有 levelId 的模块（自由模式搭的在关卡里全面不可见）', () => {
  it('① 逐关（全部 27 关：时序关与逻辑关都算）：自由模式搭的一律不列，关卡产出的照旧列、老存档 stage>=2 例外', async () => {
    const library = [
      freeBuiltUnits,
      freeBuiltGates,
      levelBuiltTiming,
      levelBuiltLogic,
      legacyLogic,
    ];
    let violations = 0;
    for (const [i, level] of ALL_LEVELS.entries()) {
      cleanup();
      await open({ levelTitle: level.title, library });
      const mine = cards('我的模块');
      const names = mine.map((c) => c.split('@')[0].replace(/ 时序$/, ''));
      const bad = [freeBuiltUnits.name, freeBuiltGates.name].filter((n) => names.includes(n));
      violations += bad.length;
      if (i < 4 || bad.length > 0)
        console.log(
          `[① ] #${i + 1} ${level.id}（${level.judgeMode ?? 'timing'}）我的模块=(${mine.join('、') || '空'})`,
        );
      expect(bad, `${level.id}：自由模式搭的不该出现在关卡里`).toEqual([]);
    }
    console.log(
      `[① ] 汇总：27 关 × 5 条库（2 条自由模式搭的）→ 自由模式搭的被列出 ${violations} 次（应为 0）`,
    );
    expect(violations).toBe(0);
  }, 600000);

  it('② 关卡产出的（有 levelId）与老存档 stage>=2 的照旧列 —— 时序关一关一关看', async () => {
    const library = [levelBuiltTiming, levelBuiltLogic, legacyLogic, freeBuiltUnits];
    cleanup();
    await open({ levelTitle: '与非门', library }); // 第 4 关（时序关）
    const mine = cards('我的模块');
    console.log(`[② ] 时序关 #4 我的模块=(${mine.join('、')})`);
    for (const n of [levelBuiltTiming.name, levelBuiltLogic.name, legacyLogic.name]) {
      expect(
        mine.map((c) => c.split('@')[0].replace(/ 时序$/, '')),
        `${n} 必须照旧列在时序关`,
      ).toContain(n);
    }
    expect(mine.map((c) => c.split('@')[0].replace(/ 时序$/, ''))).not.toContain(
      freeBuiltUnits.name,
    );
  }, 300000);

  it('③ 反证：自由模式本身照旧全列（不受影响）', async () => {
    const library = [
      freeBuiltUnits,
      freeBuiltGates,
      levelBuiltTiming,
      levelBuiltLogic,
      legacyLogic,
    ];
    cleanup();
    await open({ free: true, library });
    const mine = cards('我的模块');
    console.log(`[③ ] 自由模式 我的模块=(${mine.join('、')})`);
    for (const m of library) {
      expect(
        mine.map((c) => c.split('@')[0].replace(/ 时序$/, '')),
        `自由模式必须列 ${m.name}`,
      ).toContain(m.name);
    }
  }, 300000);

  it('④ 逐关（全部 20 个逻辑关）：逻辑关同时满足"只列关卡产出"与"不列元件/时序关产出"', async () => {
    const library = [
      levelBuiltTiming,
      levelBuiltLogic,
      legacyLogic,
      freeBuiltUnits,
      freeBuiltGates,
    ];
    let rows = 0;
    for (const level of ALL_LEVELS.filter((l) => l.judgeMode === 'logic')) {
      cleanup();
      await open({ levelTitle: level.title, library });
      const names = cards('我的模块').map((c) => c.split('@')[0].replace(/ 时序$/, ''));
      rows += 1;
      expect(names, `${level.id}：第 4 关（时序关）产出的不该在逻辑关`).not.toContain(
        levelBuiltTiming.name,
      );
      expect(names, `${level.id}：自由模式搭的不该在关卡里`).not.toContain(freeBuiltUnits.name);
      expect(names, `${level.id}：第 10 关（逻辑关）产出的锁存器必须照旧在`).toContain(
        levelBuiltLogic.name,
      );
      expect(names, `${level.id}：老存档 stage>=2 的必须照旧在`).toContain(legacyLogic.name);
    }
    console.log(`[④ ] 逐关 ${rows} 个逻辑关全部满足四条规定`);
    expect(rows).toBe(20);
  }, 600000);
});
