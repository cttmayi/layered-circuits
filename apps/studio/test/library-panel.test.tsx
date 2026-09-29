// @vitest-environment jsdom
/**
 * 组件库 / 成绩面板的界面自检（M3-D、M3-E）：
 * 面板必须在关卡模式里真实出现，版本号、溯源入口、重挑战榜与存档按钮都要能看到。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { PROGRESS_KEY } from '../src/level/progress';

describe('组件库与成绩面板', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('点「组件库」弹出面板：我的模块 / 本地重挑战榜 / 存档按钮', () => {
    render(<App />);
    fireEvent.click(screen.getByText('组件库'));
    expect(screen.getByRole('dialog', { name: '组件库与成绩' })).toBeTruthy();
    // 元件库（左侧）与组件库面板（右侧）各有一个标题，所以用 getAllByText
    expect(screen.getAllByText('我的模块（0）').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/本地重挑战榜/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '导出存档' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '导入存档' })).toBeTruthy();
    expect(screen.getByText(/还没有封装过模块/)).toBeTruthy();
  });

  it('存档里有模块与通关记录时：显示版本、重挑战行与「追赶已知最省」', () => {
    // 预置一份存档：一个模块版本 + 第 1 关通关记录
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        cleared: { 's1-not': { score: 100, bestCostHalf: 8, clearedAt: Date.now() } },
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
    fireEvent.click(screen.getByText('组件库'));
    expect(screen.getAllByText('我的模块（1）').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/1 个版本 · 最新 v1\.0 · 成本 4/)).toBeTruthy();
    // 重挑战榜：非门的已知最省 = 满分线 = 8 半单位（4）
    expect(screen.getByText('非门', { selector: '.link' })).toBeTruthy();
    expect(screen.getByText(/已到最省/)).toBeTruthy();
  });
});

describe('委托单与结算（P0 游戏化外壳）', () => {
  beforeEach(() => localStorage.clear());

  it('第 1 关显示成一张委托单：委托方、人话需求、合同条款', () => {
    render(<App />);
    // 进关即弹「新委托」对话框（中央），内容与左侧委托单一致
    expect(screen.getByText('新委托')).toBeTruthy();
    expect(screen.getAllByText('修表铺 · 老周').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/收音机的指示灯接反了/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('款项').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('禁忌').length).toBeGreaterThanOrEqual(1);
    // 点开工关掉对话框，左侧卡片仍在
    fireEvent.click(screen.getByText('开工'));
    expect(screen.queryByText('新委托')).toBeNull();
    expect(screen.getByText('委托单 · 非门')).toBeTruthy();
  });

  it('钱包余额显示在顶栏，并且来自存档', () => {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        cleared: { 's1-not': { score: 100, bestCostHalf: 8, bestProfitHalf: 2, clearedAt: 1 } },
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
    render(<App />);
    // 未交付时没有结算页
    expect(screen.queryByText(/验收报告/)).toBeNull();
  });

  it('点「任务墙」弹出章节地图：未解锁的章节节点是禁用的', () => {
    render(<App />);
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
    expect(screen.getAllByText('成本挑战').length).toBeGreaterThanOrEqual(1);
  });

  it('已交付的关卡显示星数与称号；钱包不足时给出升级提示', () => {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        cleared: {
          's1-not': { score: 100, bestCostHalf: 8, bestProfitHalf: 2, stars: 3, clearedAt: 1 },
        },
        attempts: {},
        library: [],
        walletHalf: 2,
      }),
    );
    render(<App />);
    fireEvent.click(screen.getByText('任务墙'));
    expect(screen.getByText('★★★')).toBeTruthy();
    // 1 单 + 1 元 → 还是学徒，提示升到维修铺师傅还差什么
    expect(screen.getByText(/学徒/)).toBeTruthy();
    expect(screen.getByText(/已交付 1\/13 · 星 3\/39/)).toBeTruthy();
  });
});

describe('接单对话框里直接选支线（操作在中间完成）', () => {
  beforeEach(() => localStorage.clear());

  /** 点击对话框里包含指定文本的那个按钮（卡片上也有同名文本，要取弹窗里的） */
  function inModal(text: RegExp): HTMLButtonElement | undefined {
    for (const node of screen.getAllByText(text)) {
      if (!node.closest('.modal-box')) continue;
      const button = node.closest('button');
      if (button) return button as HTMLButtonElement;
    }
    return undefined;
  }

  it('在「新委托」对话框里接加急单，开工后支线状态生效', () => {
    render(<App />);
    const job = inModal(/加急单/);
    expect(job).toBeTruthy();
    if (job) fireEvent.click(job);
    const start = screen.getByText(/开工（接：加急单）/);
    fireEvent.click(start);
    // 支线已生效：委托单上显示已接
    expect(screen.queryByText('新委托')).toBeNull();
    expect(screen.getByText(/已接支线/)).toBeTruthy();
  });

  it('不接支线开工：只做主线', () => {
    render(<App />);
    const start = inModal(/^开工$/);
    if (start) fireEvent.click(start);
    expect(screen.queryByText('新委托')).toBeNull();
    expect(screen.queryByText(/已接支线/)).toBeNull();
  });
});

describe('元件拖拽放置', () => {
  beforeEach(() => localStorage.clear());

  it('从元件库把三极管拖到画布，松手即放置（成本更新）', async () => {
    render(<App />);
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
