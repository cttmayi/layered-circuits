// @vitest-environment jsdom
/** 共享的界面导航 helper：新流程 = 主菜单 → 关卡模式 → 点关节点 → 工作台 */
import { fireEvent, type RenderResult, render, screen } from '@testing-library/react';
import { App } from '../src/App';

/** 知识卡片 id（原教学关：认识元件，不算关卡与成绩） */
export const TEACH_LEVEL_IDS = [
  's1-npn',
  's1-dio',
  's1-float',
  's1-cmos-inv',
  's1-cmos-nand',
] as const;

/** 知识卡片的"通关"记录片段：**只为兼容老测试**——现在装载时会被清理（卡片不计进度） */
export function teachCleared(): Record<
  string,
  { score: number; bestCostHalf: number; clearedAt: number }
> {
  const out: Record<string, { score: number; bestCostHalf: number; clearedAt: number }> = {};
  for (const id of TEACH_LEVEL_IDS) out[id] = { score: 100, bestCostHalf: 6, clearedAt: 1 };
  return out;
}

/**
 * 预置知识卡片的"已掌握"记录（兼容用）：卡片已改成不计进度，装载时会被清理掉，
 * 所以正确用法的测试不该依赖它 —— 留在这里只是免得旧测试 import 报错。
 */
export function seedTeachCleared(): void {
  const key = 'lc-studio-progress-v1';
  const prev = JSON.parse(localStorage.getItem(key) ?? '{}');
  const cleared = { ...prev.cleared, ...teachCleared() };
  const started = { ...(prev.started ?? {}) };
  for (const id of TEACH_LEVEL_IDS) started[id] = true;
  localStorage.setItem(key, JSON.stringify({ ...prev, cleared, started }));
}

/**
 * 「调试模式」按钮只在 URL 带 ?debug=1 时出现（正式玩法里连按钮都不该有）。
 * 需要点「一键出答案」的测试要在 render 之前调用它 —— 开关在挂载时判定。
 */
export function enableDebugUrl(): void {
  window.history.replaceState({}, '', '/?debug=1');
}

/** 清掉 URL 上的调试参数（同一文件的多个用例互不影响） */
export function disableDebugUrl(): void {
  window.history.replaceState({}, '', '/');
}

/** 渲染整个 App：先清空存档、预置教学关已通关（正式关卡才在地图上可点） */
export function renderApp(): RenderResult {
  localStorage.clear();
  return render(<App />);
}

/** 主菜单 → 关卡模式 → 点某关节点进入工作台（已通关/进行中的关不会弹委托） */
export function goToLevel(title: string): void {
  fireEvent.click(screen.getByText('关卡模式'));
  fireEvent.click(screen.getByText(title));
}

/** 完整开工：进第 X 关即开工（进关不再弹「新委托」，直接进工作台） */
export function startJob(title: string): void {
  goToLevel(title);
}
