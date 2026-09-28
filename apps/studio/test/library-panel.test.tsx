// @vitest-environment jsdom
/**
 * 组件库 / 成绩面板的界面自检（M3-D、M3-E）：
 * 面板必须在关卡模式里真实出现，版本号、溯源入口、重挑战榜与存档按钮都要能看到。
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { PROGRESS_KEY } from '../src/level/progress';

describe('组件库与成绩面板', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('关卡模式下右侧有面板：我的模块 / 本地重挑战榜 / 存档按钮', () => {
    render(<App />);
    expect(screen.getByText('组件库与成绩')).toBeTruthy();
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
    expect(screen.getByText('委托单 · 非门')).toBeTruthy();
    expect(screen.getByText('修表铺 · 老周')).toBeTruthy();
    expect(screen.getByText(/收音机的指示灯接反了/)).toBeTruthy();
    expect(screen.getByText('款项')).toBeTruthy();
    expect(screen.getByText('禁忌')).toBeTruthy();
    expect(screen.getByText(/5 元（材料费自负/)).toBeTruthy();
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
    expect(screen.getByText(/钱包 1 元/)).toBeTruthy();
  });
});
