// @vitest-environment jsdom
/**
 * 「手动封装为模块」（D 路径）的 provenance —— 与交付验收自动封装（A 路径）对齐。
 *
 * ## 先钉住一个**产品事实**（这条是关键，第 ㉓ 轮实测）
 * 「封装为模块」按钮**只在自由模式渲染**（`App.tsx`：`gameMode === 'free' &&`）。
 * 也就是说：**关卡里根本点不到手动封装** —— 时序关工具栏上只有「重载本关」，没有手动封装。
 * 推论：D 路径的产物永远是"**关卡之外**搭的"（没有 `levelId`、`stage` 恒为 1），
 * 于是它在**任何关卡**里都不列（`builtOutsideLevels`）。
 *
 * ## 代码侧仍与 A 路径统一口径
 * `wrapSelection` 现在写成 `...(currentLevel ? { levelId: currentLevel.id } : {})` ——
 * 与交付验收自动封装同形。今天它是**空操作**（自由模式没有 `currentLevel`），但把
 * `library.ts` 注释里"两条封装路径都写 `levelId`"这句话变成**真的**，也不会在将来
 * 把按钮挪进关卡时留下一个"绕过 1~7 关产出不过关"的洞。
 *
 * ## 为什么要守着
 * 逻辑关（第 8 关起）按**产出处 provenance** 过滤：「第 1~7 关产出的模块不要往第 8 关之后放」
 * （`producedInElementLevel`，判据是 `levelId` 那关的 `judgeMode`）。`levelId` 一旦漏写，
 * 就绕过了这条规则：同一份电路"手封"看得见、"自动封"看不见。
 */
import { ALL_LEVELS, isTeachLevel } from '@lc/content';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { builtOutsideLevels } from '../src/level/library';
import { dismissTaskDialog, enableDebugUrl, goToLevel } from './helpers';

interface Stored {
  name: string;
  stage: number;
  levelId?: string;
}

const libraryOf = (): Stored[] =>
  (JSON.parse(localStorage.getItem('lc-studio-progress-v1') ?? '{}').library ?? []) as Stored[];

function seedProgress(clearedUpToTitle?: string): void {
  const cleared: Record<string, unknown> = {};
  if (clearedUpToTitle) {
    const idx = ALL_LEVELS.findIndex((l) => l.title === clearedUpToTitle);
    for (const l of ALL_LEVELS.slice(0, idx))
      cleared[l.id] = { score: 100, bestCostHalf: 0, clearedAt: 1 };
  }
  localStorage.setItem(
    'lc-studio-progress-v1',
    JSON.stringify({
      family: 'rtl',
      cleared,
      library: [],
      attempts: {},
      walletHalf: 0,
      recon: {},
      sideJobs: {},
      spentHalf: 0,
      started: {},
    }),
  );
}

const byText = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(text));

describe('手动封装（D 路径）的 provenance', () => {
  beforeEach(() => {
    enableDebugUrl();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // `wrapSelection` 先 `window.prompt` 问名字（jsdom 默认返回 null ⇒ 直接早退，什么都不封）
    vi.spyOn(window, 'prompt').mockReturnValue('我的模块');
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('产品事实：关卡里**没有**手动封装按钮（时序关）—— D 路径产物因此永远无 levelId', async () => {
    const level = ALL_LEVELS[3]; // 第 4 关（时序关）
    localStorage.clear();
    seedProgress(level.title);
    localStorage.setItem(`lc-ui-task-seen-${level.id}`, '1');
    render(<App />);
    goToLevel(level.title);
    dismissTaskDialog();
    await waitFor(() => expect(byText('一键出答案')).toBeTruthy());
    // 关卡工具栏上：有「重载本关」，**没有**「封装为模块」
    expect(byText('重载本关')).toBeTruthy();
    expect(byText('封装为模块')).toBeUndefined();
    expect(screen.queryByText('封装为模块')).toBeNull();
    console.log(
      `[dpath] 关卡工具栏=${[...document.querySelectorAll('button')]
        .map((b) => (b.textContent ?? '').trim())
        .filter((t) => t && t.length < 12)
        .join('|')}`,
    );
    // 于是"自由模式封装的那种"（无 levelId、stage=1）在关卡里一律不列
    const freeBuilt = { levelId: undefined, stage: 1 } as Parameters<typeof builtOutsideLevels>[0];
    expect(builtOutsideLevels(freeBuilt)).toBe(true);
  }, 60_000);

  it('自由模式手动封装：产物**不带 levelId**、stage=1（D 路径与 A 路径的唯一差别点）', async () => {
    localStorage.clear();
    seedProgress();
    render(<App />);
    const freeEntry = [...document.querySelectorAll('button')].find((b) =>
      /自由搭建/.test(b.textContent ?? ''),
    );
    expect(freeEntry).toBeTruthy();
    (freeEntry as HTMLButtonElement).click();
    await waitFor(() => expect(byText('封装为模块')).toBeTruthy());
    (byText('载入非门示例') as HTMLButtonElement).click();
    await waitFor(() => expect(libraryOf().length).toBe(0));
    (byText('封装为模块') as HTMLButtonElement).click();
    await waitFor(() => expect(libraryOf().length).toBeGreaterThan(0), { timeout: 8000 });
    const made = libraryOf()[0] as Stored;
    console.log(
      `[dpath] 自由模式手动封装产物：name=${made.name} stage=${made.stage} levelId=${String(made.levelId)}`,
    );
    expect(made.stage).toBe(1);
    expect(made.levelId).toBeUndefined(); // ← 自由模式没有关卡 ⇒ 不写 provenance（老规则一字不动）
    expect(isTeachLevel('s1-not')).toBe(false); // 顺带钉住：s1-* 是真关卡、不是知识卡片
  }, 60_000);
});
