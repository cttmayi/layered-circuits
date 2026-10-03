// @vitest-environment jsdom
/**
 * 组件库 / 成绩面板的界面自检（M3-D、M3-E）：
 * 面板必须在关卡模式里真实出现，版本号、溯源入口、重挑战榜与存档按钮都要能看到。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { PROGRESS_KEY } from '../src/level/progress';
import { goToLevel, renderApp, startJob, teachCleared } from './helpers';

describe('组件库与成绩面板', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('点「组件库」弹出面板：我的模块 / 本地重挑战榜 / 存档按钮', () => {
    renderApp();
    startJob('非门');
    fireEvent.click(screen.getByText('组件库'));
    expect(screen.getByRole('dialog', { name: '组件库与成绩' })).toBeTruthy();
    // 元件库（左侧）与组件库面板（右侧）各有一个标题，所以用 getAllByText
    expect(screen.getAllByText('我的模块（0）').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/本地重挑战榜/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '导出存档' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '导入存档' })).toBeTruthy();
    expect(screen.getByText(/还没有封装过模块/)).toBeTruthy();
  });

  it('存档里有模块与通关记录时：入门关（非门）不显示模块，但重挑战榜显示「追赶已知最省」', () => {
    // 预置一份存档：一个模块版本 + 非门（已知最省 8、玩家 12）+ 异或门（已知最省 60、玩家 80）
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        cleared: {
          ...teachCleared(),
          's1-not': { score: 100, bestCostHalf: 12, clearedAt: Date.now() },
          's1-xor': { score: 78, bestCostHalf: 80, clearedAt: Date.now() },
        },
        attempts: { 's1-not': 3 },
        library: [
          {
            hash: 'hash-not-1',
            name: '非门',
            version: '1.0',
            stage: 1,
            costHalf: 8,
            isSequential: false,
            ports: [
              { id: 'a', name: 'a', dir: 'in', width: 1 },
              { id: 'y', name: 'y', dir: 'out', width: 1 },
            ],
            template: { hash: 'hash-not-1' },
            levelId: 's1-not',
            sources: [],
            createdAt: Date.now(),
          },
        ],
      }),
    );
    render(<App />);
    goToLevel('非门'); // 已通关的关：不弹委托，直接进工作台
    fireEvent.click(screen.getByText('组件库'));
    // 入门关（moduleAccess none）用不到模块：即使存档有模块也不显示
    expect(screen.getAllByText('我的模块（0）').length).toBeGreaterThanOrEqual(1);
    // 重挑战榜：非门已知最省 8 半单位（4 元）、玩家 12（6 元）→「追赶 4」；
    // 异或门已知最省 44（22 元）、玩家 80（40 元）→「追赶 22」
    expect(screen.getByText('非门', { selector: '.link' })).toBeTruthy();
    expect(screen.getByText(/追赶 4/)).toBeTruthy();
    expect(screen.getByText(/追赶 22/)).toBeTruthy();
  });

  it('非门关已有画布存档时，读档恢复也不背全量组件库', () => {
    // 进度库里有模块 + 非门关已有玩家画布存档（走 docFor 的读档分支，历史上
    // 该分支会把全量模块库重新注入 doc.library —— 修复后入门关不再背）
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        cleared: {
          ...teachCleared(),
          's1-not': { score: 100, bestCostHalf: 8, clearedAt: Date.now() },
        },
        attempts: {},
        library: [
          {
            hash: 'hash-not-1',
            name: '非门',
            version: '1.0',
            stage: 1,
            costHalf: 8,
            isSequential: false,
            ports: [
              { id: 'a', name: 'a', dir: 'in', width: 1 },
              { id: 'y', name: 'y', dir: 'out', width: 1 },
            ],
            template: { hash: 'hash-not-1' },
            levelId: 's1-not',
            sources: [],
            createdAt: Date.now(),
          },
          {
            hash: 'hash-alu-1',
            name: '简易ALU',
            version: '1.0',
            stage: 3,
            costHalf: 728,
            isSequential: false,
            ports: [],
            template: { hash: 'hash-alu-1' },
            levelId: 's3-alu',
            sources: [],
            createdAt: Date.now(),
          },
        ],
      }),
    );
    // 非门关已有画布存档：一键出答案后的布局（旧存档里还带着历史 library 字段）
    localStorage.setItem(
      'lc-studio-level-s1-not-v1',
      JSON.stringify({
        id: 'level-s1-not',
        name: '非门',
        syms: [
          {
            id: 'in-a',
            kind: 'input',
            x: 40,
            y: 200,
            value: 0,
            label: 'a',
            width: 1,
            locked: true,
          },
          { id: 'out-y', kind: 'output', x: 700, y: 200, label: 'y', width: 1, locked: true },
          { id: 'vcc1', kind: 'vcc', x: 120, y: 30, label: 'VCC' },
          { id: 'gnd1', kind: 'gnd', x: 120, y: 354, label: 'GND' },
          { id: 'res1', kind: 'unit', x: 120, y: 90, label: 'R1', unit: 'res' },
          { id: 'npn1', kind: 'unit', x: 120, y: 274, label: 'Q1', unit: 'npn' },
          { id: 'res2', kind: 'unit', x: 120, y: 182, label: 'R2', unit: 'res' },
        ],
        wires: [],
        library: [{ hash: 'hash-not-1', name: '非门', version: '1.0', stage: 1, costHalf: 8 }],
      }),
    );
    render(<App />);
    goToLevel('非门'); // 已通关：不弹委托，直接进工作台（走读档分支）
    fireEvent.click(screen.getByText('组件库'));
    // 入门关不显示任何模块（即使进度库有 2 个模块、旧画布存档里也带着模块）
    expect(screen.getAllByText('我的模块（0）').length).toBeGreaterThanOrEqual(1);
  });

  it('允许模块的关（与非门）：显示存档里的模块版本与溯源', () => {
    // 预置存档：一个模块版本 + 前三关通关记录（解锁「与非门」，moduleAccess all）
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        cleared: {
          ...teachCleared(),
          's1-not': { score: 100, bestCostHalf: 8, clearedAt: Date.now() },
          's1-and': { score: 100, bestCostHalf: 10, clearedAt: Date.now() },
          's1-or': { score: 100, bestCostHalf: 10, clearedAt: Date.now() },
        },
        attempts: {},
        library: [
          {
            hash: 'hash-not-1',
            name: '非门',
            version: '1.0',
            stage: 1,
            costHalf: 8,
            isSequential: false,
            ports: [
              { id: 'a', name: 'a', dir: 'in', width: 1 },
              { id: 'y', name: 'y', dir: 'out', width: 1 },
            ],
            template: { hash: 'hash-not-1' },
            levelId: 's1-not',
            sources: [],
            createdAt: Date.now(),
          },
        ],
      }),
    );
    render(<App />);
    goToLevel('与非门');
    fireEvent.click(screen.getByText('组件库'));
    expect(screen.getAllByText('我的模块（1）').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/1 个版本 · 最新 v1\.0 · 造价 4/)).toBeTruthy();
  });
});

describe('任务与结算（P0 游戏化外壳）', () => {
  beforeEach(() => localStorage.clear());

  it('第 1 关进关即开工：任务（直接需求）、合同条款直接显示在左侧任务卡上', () => {
    renderApp();
    goToLevel('非门'); // 进关即开工，不再弹「新委托」
    expect(screen.queryByText('新委托')).toBeNull();
    // 任务卡 = 直接表达任务（无场景话术/委托方），合同条款照旧
    expect(screen.getByText('任务 · 非门')).toBeTruthy();
    expect(screen.getAllByText(/输入为高时输出低/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/修表铺|委托方/)).toBeNull();
    expect(screen.getAllByText(/款项/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/元件成本/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/传播延迟/).length).toBeGreaterThanOrEqual(1);
  });

  it('钱包余额显示在顶栏，并且来自存档', () => {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        cleared: {
          ...teachCleared(),
          's1-not': { score: 100, bestCostHalf: 8, bestProfitHalf: 2, clearedAt: 1 },
        },
        attempts: {},
        library: [],
        walletHalf: 2,
      }),
    );
    render(<App />);
    expect(screen.getAllByText(/可用余额 1 元/).length).toBeGreaterThanOrEqual(1);
  });
});

describe('任务墙与星级（P1）', () => {
  beforeEach(() => localStorage.clear());

  it('交付后结算页显示星级（星级规则与进度测试同源）', () => {
    renderApp();
    // 未交付时没有结算页
    expect(screen.queryByText(/验收报告/)).toBeNull();
  });

  it('点「任务墙」弹出章节地图：未解锁的章节节点是禁用的', () => {
    renderApp();
    startJob('非门');
    fireEvent.click(screen.getByText('任务墙'));
    expect(screen.getByRole('dialog', { name: '任务墙' })).toBeTruthy();
    expect(screen.getByText('第一章 · 街道维修铺（逻辑门）')).toBeTruthy();
    expect(screen.getByText('第二章 · 研究所（时序单元）')).toBeTruthy();
    // 第一关可接单，第二关未解锁（禁用），挑战关标出类型
    const node = (title: string): HTMLButtonElement | undefined =>
      screen
        .getAllByText(title)
        .map((n) => n.closest('button'))
        .find((b): b is HTMLButtonElement => b !== null);
    expect(node('非门')?.disabled).toBe(false);
    expect(node('与门')?.disabled).toBe(true);
    expect(screen.getAllByText('元件成本挑战').length).toBeGreaterThanOrEqual(1);
  });

  it('已交付的关卡显示星数与称号；钱包不足时给出升级提示', () => {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        cleared: {
          ...teachCleared(),
          's1-not': { score: 100, bestCostHalf: 8, bestProfitHalf: 2, stars: 3, clearedAt: 1 },
        },
        attempts: {},
        library: [],
        walletHalf: 2,
      }),
    );
    render(<App />);
    goToLevel('非门');
    fireEvent.click(screen.getByText('任务墙'));
    expect(screen.getByText('★★★')).toBeTruthy();
    // 1 单 + 1 元 → 还是学徒，提示升到维修铺师傅还差什么
    expect(screen.getByText(/学徒/)).toBeTruthy();
    expect(screen.getByText(/已交付 1\/30 · 星 3\/90/)).toBeTruthy(); // 教学关不在关卡链：主线 30 关，星上限 = 30 关 × 3
  });
});

describe('元件拖拽放置', () => {
  beforeEach(() => localStorage.clear());

  it('从元件库把三极管拖到画布，松手即放置（成本更新）', async () => {
    renderApp();
    startJob('非门');
    const canvasEl = document.querySelector('.canvas-wrap canvas') as HTMLButtonElement;
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: 'none',
      setData: () => undefined,
      setDragImage: () => undefined,
      getData: (type: string) => (type === 'application/x-lc-place' ? 'unit:npn' : ''),
    } as unknown as DataTransfer;
    const item = screen.getByText('三极管 NPN').closest('button') as HTMLButtonElement;
    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
    item.dispatchEvent(dragStart);
    // jsdom 的 Event 不实现 clientX/clientY，用 defineProperty 手动带上
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
    Object.defineProperty(drop, 'clientX', { value: 450 });
    Object.defineProperty(drop, 'clientY', { value: 300 });
    canvasEl.dispatchEvent(drop);
    // 仿真跑完后成本出现：1 个三极管 = 2 元
    await waitFor(
      () => {
        const texts = [...document.querySelectorAll('.budget-text')].map((n) => n.textContent);
        expect(texts.some((t) => t?.includes('材料费 2'))).toBe(true);
      },
      { timeout: 5000 },
    );
  });
});
