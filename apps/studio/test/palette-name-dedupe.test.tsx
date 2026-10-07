// @vitest-environment jsdom
/**
 * 分组显示必须**按名字去重**（用户第 ⑮ 轮：本来 7 个，点一次「一键出答案」变 11 个）。
 *
 * 根因两层：
 *   ① 两个注入点的**族**不一致 —— 进关时 `withLevelGates` 注入玩家工艺（`progress.family`）的
 *      整族门，而一键出答案（`applyAnswer`）注入**本关族**的门；工艺与关卡族不同时，点一下
 *      就凭空多出本关族的门（实测 7 → 11，rtl/ttl 的异或门内容相同所以只多 4 个）；
 *   ② 菜单分组是**按名字**列的，而库是**内容寻址**的 —— 同名不同族（rtl 的非门 vs cmos 的非门）
 *      是两条 → **同名出两张卡**；存档瘦身 `dedupeLibrary` 对教学积木一律保留
 *      （`if (m.teaching) return true`），所以历史遗留条目不会自己消失。
 *
 * 本文件盯三件事：
 *   · **不变量**：任何一组（DOM 里所有 `.palette-section`，将来新增分组自动纳入）里，
 *     卡片名字**两两不同** —— 少了这条，以后有人加新分组忘了去重就会出重复卡；
 *   · 用户那个形态（工艺 cmos + 逻辑关 rtl + 历史遗留 7 条）修后「点击前就干净、点击不变」；
 *   · 反证：干净存档的 5 张门卡与旧行为逐字一致（顺序、hash 都不变）。
 */

import { ALL_LEVELS, BASIC_GATES, teachingModulesFor } from '@lc/content';
import type { LogicFamily } from '@lc/schema';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { dismissTaskDialog, enableDebugUrl, startJob } from './helpers';

const FAMILIES: LogicFamily[] = ['rtl', 'ttl', 'cmos'];

function storedModule(family: LogicFamily, name: string, teaching = true) {
  const t = teachingModulesFor(family).find((m) => m.name === name);
  if (!t) throw new Error(`${family} 没有 ${name}`);
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
    teaching,
  };
}

/** 某族的基础门条目（教学） */
function gatesOf(family: LogicFamily) {
  return teachingModulesFor(family)
    .filter((m) => BASIC_GATES.includes(m.name))
    .map((m) => storedModule(family, m.name));
}

function whoseFamilies(hash: string): string {
  const hits = FAMILIES.filter((f) => teachingModulesFor(f).some((m) => m.hash === hash));
  return hits.length ? hits.join('+') : '玩家/未知';
}

interface Card {
  name: string;
  hash: string;
}

/** 从 DOM 读回某一组的所有卡片（名字 + hash，hash 只能从拖拽载荷里拿） */
function cardsOf(sectionStartsWith: string): Card[] {
  const sec = [...document.querySelectorAll('.palette-section')].find((s) =>
    (s.querySelector('.palette-section-title')?.textContent || '').startsWith(sectionStartsWith),
  );
  if (!sec) return [];
  return [...sec.querySelectorAll('.palette-item')].map((btn) => {
    let payload = '';
    fireEvent.dragStart(btn, {
      dataTransfer: {
        setData: (_t: string, v: string) => {
          payload = v;
        },
        effectAllowed: '',
        setDragImage: () => {},
      },
    });
    return {
      name: (btn.querySelector('.palette-name')?.textContent || '').trim(),
      hash: (payload.startsWith('module:') ? payload.slice(7) : payload) || '?',
    };
  });
}

function groupTitle(prefix: string): string {
  const sec = [...document.querySelectorAll('.palette-section')].find((s) =>
    (s.querySelector('.palette-section-title')?.textContent || '').startsWith(prefix),
  );
  return (sec?.querySelector('.palette-section-title')?.textContent || '(无)').trim();
}

/**
 * **不变量**：DOM 里**每一组**的卡片名字两两不同。
 * 遍历所有 `.palette-section`（不写死分组名）→ 将来新增分组自动被这条盯住。
 */
function assertNoDuplicateNames(tag: string): void {
  const sections = [...document.querySelectorAll('.palette-section')];
  expect(sections.length).toBeGreaterThan(0);
  const report: string[] = [];
  for (const sec of sections) {
    const title = (sec.querySelector('.palette-section-title')?.textContent || '?').trim();
    const names = [...sec.querySelectorAll('.palette-item .palette-name')].map((n) =>
      (n.textContent || '').trim(),
    );
    const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    report.push(
      `${title}→${names.length} 张${dupes.length ? `（重复：${dupes.join('、')}）` : ''}`,
    );
    expect(dupes, `${tag}：组「${title}」出现同名重复卡 ${dupes.join('、')}`).toEqual([]);
  }
  console.log(`[组内不变量 ${tag}] ${report.join('｜')}`);
}

async function enterLevel(
  title: string,
  library: unknown[],
  family: string = 'rtl',
  options: { debug?: boolean } = {},
): Promise<void> {
  localStorage.clear();
  const idx = ALL_LEVELS.findIndex((l) => l.title === title);
  const cleared: Record<string, unknown> = {};
  for (const l of ALL_LEVELS.slice(0, idx))
    cleared[l.id] = { score: 100, bestCostHalf: 0, clearedAt: 1 };
  localStorage.setItem(
    'lc-studio-progress-v1',
    JSON.stringify({
      family,
      cleared,
      library,
      attempts: {},
      walletHalf: 0,
      recon: {},
      sideJobs: {},
      spentHalf: 0,
      started: {},
    }),
  );
  localStorage.setItem(`lc-ui-task-seen-${ALL_LEVELS[idx].id}`, '1');
  if (options.debug !== false) enableDebugUrl();
  render(<App />);
  startJob(title);
  dismissTaskDialog();
  await waitFor(() => expect(document.querySelector('.legend')).toBeTruthy(), { timeout: 8000 });
}

async function clickAnswer(): Promise<void> {
  fireEvent.click(screen.getByText('一键出答案'));
  await waitFor(() => expect(document.querySelector('.toast')).toBeTruthy(), { timeout: 8000 });
}

/** 用户那个形态的历史遗留库：cmos 6 个基础门 + rtl/ttl 异或门 = **7 条** */
const LEGACY_7 = [...gatesOf('cmos'), storedModule('ttl', '异或门')];

describe('分组按名字去重（用户第 ⑮ 轮：7 → 11）', () => {
  it('① 用户形态（工艺 cmos + 逻辑关 rtl + 遗留 7 条）：点击前就干净，连点 3 次逐字不变', async () => {
    expect(LEGACY_7).toHaveLength(7);
    console.log(
      `[seed] 遗留库 7 条：${LEGACY_7.map((m) => `${m.name}@${whoseFamilies(m.hash)}`).join('、')}`,
    );
    await enterLevel('主从 D 触发器', LEGACY_7, 'cmos');
    const before = cardsOf('基础门');
    console.log(
      `[修复后 点击前] ${groupTitle('基础门')}｜${before.map((c) => `${c.name}:${c.hash.slice(0, 8)}`).join('、')}`,
    );
    assertNoDuplicateNames('点击前');
    // 本关（rtl）的 5 个门都显示**本关族**那一份（带本关契约），同或门只有 cmos 版（rtl 没有这个名字）
    const byName = new Map(before.map((c) => [c.name, c.hash]));
    for (const name of ['非门', '与非门', '或门', '与门']) {
      expect(byName.get(name), `${name} 应显示本关族（rtl）那一份`).toBe(
        storedModule('rtl', name).hash,
      );
    }
    expect(before.map((c) => c.name)).not.toContain(undefined);
    expect(new Set(before.map((c) => c.name)).size).toBe(before.length);

    await clickAnswer();
    const after1 = cardsOf('基础门');
    console.log(
      `[修复后 点击 1 次] ${groupTitle('基础门')}｜${after1.map((c) => `${c.name}:${c.hash.slice(0, 8)}`).join('、')}`,
    );
    expect(after1).toEqual(before);
    assertNoDuplicateNames('点击 1 次后');

    await clickAnswer();
    const after2 = cardsOf('基础门');
    console.log(
      `[修复后 点击 2 次] ${groupTitle('基础门')}｜${after2.map((c) => `${c.name}:${c.hash.slice(0, 8)}`).join('、')}`,
    );
    expect(after2).toEqual(before);

    await clickAnswer();
    const after3 = cardsOf('基础门');
    console.log(
      `[修复后 点击 3 次] ${groupTitle('基础门')}｜${after3.map((c) => `${c.name}:${c.hash.slice(0, 8)}`).join('、')}`,
    );
    expect(after3).toEqual(before);
    assertNoDuplicateNames('点击 3 次后');
  }, 90000);

  it('② 反证：干净存档（工艺 rtl）的 5 张门卡与旧行为逐字一致（顺序 + hash 都没变）', async () => {
    await enterLevel('主从 D 触发器', []);
    const cards = cardsOf('基础门');
    console.log(
      `[干净存档] ${groupTitle('基础门')}｜${cards.map((c) => `${c.name}:${c.hash.slice(0, 8)}`).join('、')}`,
    );
    expect(cards.map((c) => c.name)).toEqual(['非门', '与非门', '或门', '异或门', '与门']);
    expect(cards.map((c) => c.hash)).toEqual(
      ['非门', '与非门', '或门', '异或门', '与门'].map((n) => storedModule('rtl', n).hash),
    );
    await clickAnswer();
    expect(cardsOf('基础门')).toEqual(cards);
  }, 90000);

  it('③ 我的模块：同名不同内容的两个模块只出一张卡；新版本优先', async () => {
    const player = (hash: string, version: string, name = '我的锁存器') => ({
      hash,
      name,
      version,
      stage: 1,
      costHalf: 10,
      isSequential: true,
      ports: [{ name: 'd', dir: 'in', width: 1 }],
      sources: [],
      createdAt: 0,
    });
    await enterLevel('主从 D 触发器', [player('aa11', '1.0.0'), player('bb22', '2.0.0')]);
    const cards = cardsOf('我的模块');
    console.log(`[我的模块] ${groupTitle('我的模块')}｜${JSON.stringify(cards)}`);
    expect(cards.map((c) => c.name)).toHaveLength(1);
    expect(cards[0]?.hash).toBe('bb22'); // 版本号更高的那份
    assertNoDuplicateNames('我的模块');
  }, 90000);

  it('④ 时序关（第 6 关）也一并干净：不变量在非逻辑关同样成立', async () => {
    await enterLevel('与非门', LEGACY_7, 'cmos');
    assertNoDuplicateNames('时序关');
    const cards = cardsOf('基础门');
    console.log(
      `[时序关] ${groupTitle('基础门')}｜${cards.map((c) => `${c.name}:${c.hash.slice(0, 8)}`).join('、')}`,
    );
    expect(new Set(cards.map((c) => c.name)).size).toBe(cards.length);
  }, 90000);

  it('⑤ 反证：点击确实把答案搭出来了（toast + 图例 + 验收满分）', async () => {
    await enterLevel('主从 D 触发器', LEGACY_7, 'cmos');
    await clickAnswer();
    const toast = document.querySelector('.toast')?.textContent ?? '';
    console.log(
      `[反证] toast=${JSON.stringify(toast)}｜图例存在=${Boolean(document.querySelector('.legend'))}`,
    );
    expect(toast).toContain('逻辑门版已搭好');
    expect(document.querySelector('.legend')).toBeTruthy();
    fireEvent.click(screen.getByText('交付验收'));
    await waitFor(() => expect(document.querySelector('.legend')).toBeTruthy(), { timeout: 15000 });
    // 验收之后基础门仍然只有一份
    assertNoDuplicateNames('验收后');
  }, 90000);
});
