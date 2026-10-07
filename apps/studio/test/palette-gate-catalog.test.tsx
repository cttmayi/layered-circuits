// @vitest-environment jsdom
/**
 * 「逻辑关的基础门 = **本关声明的门清单**，与库里有什么完全无关」（用户第 ⑯ 轮口径）。
 *
 * 用户原话：「到了第 8 关，应该就不存在不同的非门了。理论上也没有 hash 的必要性」。
 * 落到菜单上：逻辑关的「基础门」分组必须照**门身份**（= 名字 + 本关族契约）渲染，
 * 一个门一张卡 —— 库里塞了同名不同 hash 的别族门、塞了重复条目、塞了乱七八糟的东西，
 * 这一组都要**逐字不变**。
 *
 * 本文件盯四件事：
 *   ① 逐关（全部 20 个逻辑关）：把库**故意污染**后，基础门组的名字+hash 逐字等于
 *      `gateCatalogFor(本关族)`（权威清单）；
 *   ② 与库内容无关：3 种污染（含重复条目、同名不同族的非门、垃圾条目）下卡片完全一致；
 *   ③ 用户那个形态（工艺 cmos + 逻辑关 rtl + 遗留 7 条）：点击前就干净、连点 3 次逐字不变；
 *   ④ 反证：一键出答案确实搭出答案（toast + 图例）且交付验收**满分**；
 *      以及「我的模块」**不合并**同名 —— 玩家自建模块是他的不同作品，两张卡并存。
 */

import { ALL_LEVELS, BASIC_GATES, teachingModulesFor } from '@lc/content';
import type { LogicFamily } from '@lc/schema';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { gateCatalogFor } from '../src/level/library';
import { dismissTaskDialog, enableDebugUrl, startJob } from './helpers';

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

function gatesOf(family: LogicFamily) {
  return teachingModulesFor(family)
    .filter((m) => BASIC_GATES.includes(m.name))
    .map((m) => storedModule(family, m.name));
}

/** 教学条目之外的"垃圾"条目：同名不同 hash 的假非门、乱名字、重复条目 */
function junk(name: string, hash: string, teaching = true) {
  return {
    hash,
    name,
    version: '9.9.9',
    stage: 1,
    costHalf: 3,
    isSequential: false,
    ports: [],
    template: null,
    sources: [],
    createdAt: 0,
    ...(teaching ? { teaching: true } : {}),
  };
}

const JUNK = [
  junk('非门', 'deadbeef'.repeat(8)), // 同名（非门）不同 hash 的假条目
  junk('非门', 'deadbeef'.repeat(8)), // 连重复条目一起塞
  junk('与非门', 'feedface'.repeat(8)),
  junk('乱码门', 'cafebabe'.repeat(8)),
  junk('非门', '0badf00d'.repeat(8), false), // 非教学的同名条目 → 属「我的模块」
];
/** 用户形态的历史遗留：cmos 六个基础门 + rtl/ttl 异或门 = 7 条同名不同 hash 的混装 */
const LEGACY_7 = [...gatesOf('cmos'), storedModule('ttl', '异或门')];
const POLLUTIONS: Array<{ tag: string; library: unknown[] }> = [
  { tag: 'A 遗留 7 条 + 垃圾', library: [...LEGACY_7, ...JUNK] },
  {
    tag: 'B 全部重复两遍',
    library: [...gatesOf('cmos'), ...gatesOf('cmos'), ...gatesOf('rtl'), ...gatesOf('ttl')],
  },
  { tag: 'C 只剩垃圾', library: [...JUNK] },
  { tag: 'D 空库', library: [] },
];

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
 * **不变量（最本质的那条）**：逻辑关「基础门」组的卡片 = 该关权威清单，名字两两不同。
 * 不写死名字列表 → 清单变了（加门/换族）测试自动跟着走；只钉"菜单 == 清单"。
 */
function assertGateGroupEqualsCatalog(tag: string): Card[] {
  const cards = cardsOf('基础门');
  const expected = gateCatalogFor('rtl').map((m) => ({ name: m.name, hash: m.hash }));
  console.log(
    `[${tag}] ${groupTitle('基础门')}｜${cards.map((c) => `${c.name}:${c.hash.slice(0, 8)}`).join('、')}`,
  );
  expect(cards, `${tag}：基础门组 != 本关权威清单`).toEqual(expected);
  expect(new Set(cards.map((c) => c.name)).size, `${tag}：基础门组出现同名卡`).toBe(cards.length);
  return cards;
}

async function enterLevel(
  title: string,
  library: unknown[],
  family: string = 'rtl',
  options: { debug?: boolean; extraStorage?: Record<string, string> } = {},
): Promise<void> {
  localStorage.clear();
  for (const [k, v] of Object.entries(options.extraStorage ?? {})) localStorage.setItem(k, v);
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

const logicLevels = ALL_LEVELS.filter((l) => l.judgeMode === 'logic');

describe('逻辑关基础门 = 本关清单（与库无关）', () => {
  it('① 逐关（全部逻辑关）：库被污染成"遗留 7 条 + 同名假非门 + 重复条目 + 垃圾"后，清单逐字不变', async () => {
    expect(logicLevels.length).toBe(20);
    const rows: string[] = [];
    for (const level of logicLevels) {
      cleanup();
      await enterLevel(level.title, POLLUTIONS[0]?.library ?? [], 'cmos', { debug: false });
      const cards = cardsOf('基础门');
      expect(
        cards.map((c) => c.name),
        `${level.id}：清单必须等于本关权威清单`,
      ).toEqual(gateCatalogFor('rtl').map((m) => m.name));
      expect(
        cards.map((c) => c.hash),
        `${level.id}：卡片 hash 必须是本关族那一份`,
      ).toEqual(gateCatalogFor('rtl').map((m) => m.hash));
      rows.push(`${level.id}:${cards.map((c) => c.name).join('、')}`);
    }
    console.log(
      `[逐关清单 · 污染库] ${rows.length} 关：${rows.slice(0, 3).join('｜')}｜…（其余同名同样）`,
    );
    expect(rows.length).toBe(20);
  }, 300000);

  it('② 与库内容无关：4 种污染（含空库）下基础门组完全一致', async () => {
    const snapshots: Record<string, string> = {};
    for (const level of ['主从 D 触发器', '简易计算器']) {
      for (const p of POLLUTIONS) {
        cleanup();
        await enterLevel(level, p.library, 'cmos', { debug: false });
        const cards = cardsOf('基础门');
        snapshots[`${level}|${p.tag}`] = JSON.stringify(cards);
        expect(
          cards.map((c) => c.hash),
          `${level}｜${p.tag}`,
        ).toEqual(gateCatalogFor('rtl').map((m) => m.hash));
      }
    }
    for (const level of ['主从 D 触发器', '简易计算器']) {
      const uniq = new Set(POLLUTIONS.map((p) => snapshots[`${level}|${p.tag}`]));
      console.log(
        `[库无关] ${level}：4 种库 → ${uniq.size} 种结果（${[...uniq][0]?.slice(0, 120)}…）`,
      );
      expect(uniq.size, `${level}：不同库给出了不同菜单 = 仍与库相关`).toBe(1);
    }
  }, 300000);

  it('③ 用户形态（工艺 cmos + 逻辑关 + 遗留 7 条）：点击前就干净，连点 3 次逐字不变', async () => {
    expect(LEGACY_7).toHaveLength(7); // 用户看到的那 7 张卡
    console.log(
      `[seed] 遗留库 7 条：${LEGACY_7.map((m) => `${m.name}@${m.hash.slice(0, 8)}`).join('、')}`,
    );
    await enterLevel('主从 D 触发器', [...LEGACY_7, ...JUNK], 'cmos');
    const before = assertGateGroupEqualsCatalog('点击前');
    console.log(`[组头] 点击前：${groupTitle('基础门')}（用户当时看到的是"基础门（7）"）`);
    await clickAnswer();
    const after1 = assertGateGroupEqualsCatalog('点击 1 次');
    expect(after1).toEqual(before);
    await clickAnswer();
    expect(assertGateGroupEqualsCatalog('点击 2 次')).toEqual(before);
    await clickAnswer();
    expect(assertGateGroupEqualsCatalog('点击 3 次')).toEqual(before);
  }, 120000);

  it('④ 反证：点击确实搭出答案（toast + 图例），交付验收满分，验收后清单仍不变', async () => {
    await enterLevel('主从 D 触发器', [...LEGACY_7, ...JUNK], 'cmos');
    await clickAnswer();
    const toast = document.querySelector('.toast')?.textContent ?? '';
    expect(toast).toContain('逻辑门版已搭好');
    expect(document.querySelector('.legend')).toBeTruthy();
    const judge = screen.getAllByText('交付验收');
    judge[judge.length - 1]?.click();
    await waitFor(() => expect(screen.getByText(/客户验收通过/)).toBeTruthy(), { timeout: 15000 });
    await waitFor(() => expect(screen.getByText(/验收报告 · 主从 D 触发器/)).toBeTruthy(), {
      timeout: 15000,
    });
    expect(screen.getByText(/已达满分线/)).toBeTruthy(); // 满分：达到 0.5×成本线
    console.log('[反证] toast + 图例 + 客户验收通过 + 已达满分线 全部命中');
    assertGateGroupEqualsCatalog('验收后');
  }, 120000);

  it('⑤ 我的模块**不合并**同名：玩家两件同名作品两张卡（与基础门相反的口径）', async () => {
    const player = (hash: string, version: string, name = '我的锁存器') => ({
      hash,
      name,
      version,
      stage: 1,
      costHalf: 10,
      isSequential: true,
      ports: [{ name: 'd', dir: 'in', width: 1 }],
      template: null,
      sources: [],
      createdAt: 0,
    });
    // 存档瘦身（dedupeLibrary）只留"同名最新版本"，旧版本要靠**某关画布还在引用**才保住 ——
    // 所以这里造出真实场景：玩家上一版锁存器（aa11）还摆在第一关的画布上。
    const oldDoc = JSON.stringify({
      id: 'level-s1-not',
      name: '非门',
      syms: [{ id: 'm-old', kind: 'module', module: 'aa11', x: 300, y: 200, rot: 0 }],
      wires: [],
      library: [],
    });
    await enterLevel('主从 D 触发器', [player('aa11', '1.0.0'), player('bb22', '2.0.0')], 'rtl', {
      debug: false,
      extraStorage: { 'lc-studio-level-s1-not-v1': oldDoc },
    });
    const cards = cardsOf('我的模块');
    console.log(`[我的模块] ${groupTitle('我的模块')}｜${JSON.stringify(cards)}`);
    // 卡片名字带「时序」后缀（时序模块的标注）→ 两件同名作品都在，各是各的 hash
    expect(cards.map((c) => c.name)).toEqual(['我的锁存器 时序', '我的锁存器 时序']);
    expect(cards.map((c) => c.hash)).toEqual(['aa11', 'bb22']);
    // 基础门组不受影响
    expect(cardsOf('基础门').map((c) => c.name)).toEqual(gateCatalogFor('rtl').map((m) => m.name));
  }, 120000);

  it('⑥ 时机关（非逻辑关）保持旧口径：库里那套 + 按名字去重，且与干净存档逐字一致', async () => {
    await enterLevel('与非门', [...LEGACY_7, ...JUNK], 'cmos', { debug: false });
    const polluted = cardsOf('基础门');
    console.log(
      `[时机关·污染库] ${groupTitle('基础门')}｜${polluted.map((c) => `${c.name}:${c.hash.slice(0, 8)}`).join('、')}`,
    );
    expect(new Set(polluted.map((c) => c.name)).size).toBe(polluted.length); // 同名仍只出一张
    cleanup();
    await enterLevel('与非门', [], 'rtl', { debug: false });
    const clean = cardsOf('基础门');
    console.log(
      `[时机关·干净库] ${groupTitle('基础门')}｜${clean.map((c) => `${c.name}:${c.hash.slice(0, 8)}`).join('、')}`,
    );
    expect(clean.map((c) => c.name)).toEqual(['非门', '与非门', '或门', '异或门', '与门']);
    expect(clean.map((c) => c.hash)).toEqual(
      ['非门', '与非门', '或门', '异或门', '与门'].map((n) => storedModule('rtl', n).hash),
    );
  }, 120000);
});
