// @vitest-environment jsdom
/**
 * 用户报的 bug 的**整机复现**（真实 App + 真实关卡数据 + 真实存档形状）：
 *
 *   完成第 10 关「D 锁存器」→ 交付时自动封装出「D 锁存器」模块进个人库 → 进第 11 关
 *   「主从 D 触发器」→ 它必须出现在「我的模块」里。
 *
 * 根因（见 apps/studio/src/sim/gate-usable.ts 文件头）：门级引擎**按模块名**查
 * `GATE_SEQ_SPECS`，玩家自己起的名字（手动封装默认「我的模块」、老版本用关卡标题
 * 「D 锁存器」带空格）对不上表 → 探针返回 null → 旧实现把模块整条藏掉。
 * 现在的口径：**时序模块一律列**；只有含元件的**组合**老模块（第 1~7 关的非门/与门）才隐藏。
 */
import { designToModulePorts, wrapModule } from '@lc/compiler';
import { ALL_LEVELS, hashOf, teachingModulesFor } from '@lc/content';
import { DesignSchema, InMemoryModuleLibrary } from '@lc/schema';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import type { StoredModule } from '../src/editor/model.ts';
import { dismissTaskDialog } from './helpers';

const TPL = teachingModulesFor('rtl');
const TPL_LIB = new InMemoryModuleLibrary([...TPL]);
const PROGRESS_KEY = 'lc-studio-progress-v1';
const DFF_TITLE = (ALL_LEVELS.find((l) => l.id === 's2-dff') as { title: string }).title;

const asStored = (
  t: { hash: string; name: string } & Record<string, unknown>,
  levelId?: string,
): StoredModule =>
  ({
    hash: t.hash,
    name: t.name,
    version: (t.version as string) ?? '1.0',
    stage: (t.stage as number) ?? 2,
    costHalf: t.costHalf as number,
    isSequential: t.isSequential as boolean,
    ports: (t.ports as Array<{ id: string; name: string; dir: 'in' | 'out'; width: number }>).map(
      (p) => ({
        id: p.id,
        name: p.name,
        dir: p.dir,
        width: p.width,
      }),
    ),
    template: t as never,
    sources: [],
    createdAt: 0,
    ...(levelId ? { levelId } : {}),
  }) as StoredModule;

/** 上一关交付时自动封装出来的 D 锁存器（身体 = 教学积木同款元件版锁存电路），名字由玩家决定 */
function playerLatchNamed(name: string): StoredModule {
  const tpl = TPL_LIB.get(hashOf('D锁存器')) as (typeof TPL)[number];
  const { template } = wrapModule(
    { name, stage: 2, kind: 'logic', ports: designToModulePorts(tpl.body), body: tpl.body },
    TPL_LIB,
  );
  return asStored(template as never, 's2-d-latch');
}

/** 第 1~7 关那种"用元件搭的非门"（含元件的组合模块 → 逻辑关按设计隐藏） */
function unitNotModule(): StoredModule {
  const body = DesignSchema.parse({
    id: 'm-not-unit',
    name: '非门（元件版）',
    instances: [
      { kind: 'unit', id: 'r1', unit: 'res', pos: { x: 0, y: 0 } },
      { kind: 'unit', id: 'r2', unit: 'res', pos: { x: 0, y: 80 } },
      { kind: 'unit', id: 'q1', unit: 'npn', pos: { x: 80, y: 40 } },
      { kind: 'vcc', id: 'v1', pos: { x: 100, y: 0 } },
      { kind: 'gnd', id: 'g1', pos: { x: 40, y: 160 } },
    ],
    nets: [
      {
        id: 'n1',
        pins: [
          { inst: 'r1', pin: 'b' },
          { inst: 'q1', pin: 'b' },
        ],
      },
      { id: 'n2', pins: [{ inst: 'q1', pin: 'c' }] },
    ],
    ports: [
      { id: 'a', name: 'a', dir: 'in', width: 1, nets: ['n1'] },
      { id: 'y', name: 'y', dir: 'out', width: 1, nets: ['n2'] },
    ],
  });
  const { template } = wrapModule(
    { name: '非门（元件版）', stage: 1, kind: 'logic', ports: designToModulePorts(body), body },
    TPL_LIB,
  );
  return asStored(template as never, 's1-not');
}

/** 干净存档：前 10 关已通关 + 库里躺着玩家自己的模块 */
function seedProgress(library: StoredModule[]): void {
  // 成绩记录的形状必须与 App 存档一致（{score,bestCostHalf,clearedAt}），
  // 否则装载时会被当作脏数据丢掉 —— 丢掉了关卡就全锁着，进不去工作台。
  const cleared: Record<string, { score: number; bestCostHalf: number; clearedAt: number }> = {};
  for (const level of ALL_LEVELS.slice(0, 10)) {
    cleared[level.id] = { score: 100, bestCostHalf: 0, clearedAt: 1 };
  }
  localStorage.clear();
  localStorage.setItem(
    PROGRESS_KEY,
    JSON.stringify({
      family: 'rtl',
      cleared,
      attempts: {},
      library,
      walletHalf: 0,
      recon: {},
      sideJobs: {},
      spentHalf: 0,
      started: {},
    }),
  );
}

/** 「我的模块」组里实际渲染出来的卡片名字（只取那一组，避开与组头「我的模块（N）」撞名） */
function cardNames(): string[] {
  const section = [...document.querySelectorAll('.palette-section')].find((sec) =>
    (sec.querySelector('.palette-section-title')?.textContent?.trim() ?? '').startsWith('我的模块'),
  );
  return [...(section?.querySelectorAll('.palette-name') ?? [])].map((el) =>
    (el.textContent?.trim() ?? '').replace(/\s+(时序|组合|模块)$/, ''),
  );
}

function enterDffLevel(): void {
  // 关卡地图上的关节点是一个按钮；点它才进工作台（helpers.goToLevel 只点文字节点，jsdom 里不冒泡成按钮点击）
  fireEvent.click(screen.getByText('关卡模式'));
  const node = screen.getByText(DFF_TITLE).closest('button');
  if (!node) throw new Error(`关卡地图上找不到「${DFF_TITLE}」的关节点按钮`);
  fireEvent.click(node);
  dismissTaskDialog();
}

describe('整机复现：上一关的 D 锁存器在「主从 D 触发器」关必须还在（用户报的 bug）', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('玩家自己起名的 D 锁存器（我的模块 / D 锁存器 / D锁存器）都在；元件版老非门不在；基础门照旧', () => {
    for (const name of ['我的模块', 'D 锁存器', 'D锁存器']) {
      seedProgress([playerLatchNamed(name), unitNotModule()]);
      const view = render(<App />);
      enterDffLevel();
      expect(cardNames(), name).toEqual([name]); // 上一关的成果仍在
      expect(screen.getByText('我的模块（1）'), name).toBeTruthy();
      expect(screen.queryByText('非门（元件版）', { exact: false }), name).toBeNull(); // 含元件的组合老模块按设计隐藏
      // 「基础门」那组照旧
      expect(screen.getByText(/^基础门（\d+）$/), name).toBeTruthy();
      expect(screen.getAllByText('非门', { exact: false }).length, name).toBeGreaterThan(0);
      // 不留任何"已隐藏 N 个"的说明文字
      expect(screen.queryByText(/已隐藏|本关判定走门级/), name).toBeNull();
      view.unmount();
    }
  });

  it('防回归（数据驱动）：每个"教学族产物"在该关的可见性 = 口径（时序必列、含元件的组合必藏）', () => {
    const checked: string[] = [];
    for (const level of ALL_LEVELS.slice(0, 10)) {
      const name = level.unlock?.name;
      if (!name) continue;
      let tpl: (typeof TPL)[number] | undefined;
      try {
        tpl = TPL_LIB.get(hashOf(name));
      } catch {
        continue; // 教学族里没有同名积木（元件版非门/或非门这些走另一条路，见上一条用例）
      }
      if (!tpl) continue;
      const product = playerLatchNamed(name);
      seedProgress([product]); // 一次只放一个，免得存档按 hash 去重把结论搅浑
      const view = render(<App />);
      enterDffLevel();
      const shown = cardNames();
      const expected = product.isSequential; // 口径：时序一律列；含元件的**组合**模块隐藏
      expect(
        shown.includes(name),
        `${name}(isSeq=${product.isSequential}) 列出=${shown.join('/')}`,
      ).toBe(expected);
      checked.push(`${name}(isSeq=${product.isSequential}→${expected ? '列' : '藏'})`);
      view.unmount();
    }
    expect(checked.length).toBeGreaterThan(0);
    console.log(`[guard] 教学族产物逐关核对：${checked.join('、')}`);
  });
});
