// @vitest-environment jsdom
/** 共享的界面导航 helper：新流程 = 主菜单 → 关卡模式 → 点关节点 → 工作台 */
import { fireEvent, type RenderResult, render, screen } from '@testing-library/react';
import { App } from '../src/App';

/** 三个「元件入门」教学关的 id（插在正式关卡之前） */
export const TEACH_LEVEL_IDS = ['s1-npn', 's1-dio', 's1-float'] as const;

/** 教学关通关记录片段：预置存档时与其它字段合并用（放在 cleared 里） */
export function teachCleared(): Record<
  string,
  { score: number; bestCostHalf: number; clearedAt: number }
> {
  const out: Record<string, { score: number; bestCostHalf: number; clearedAt: number }> = {};
  for (const id of TEACH_LEVEL_IDS) out[id] = { score: 100, bestCostHalf: 6, clearedAt: 1 };
  return out;
}

/**
 * 预置三个教学关已通关：让「非门」等正式关卡在地图上解锁。
 * 绝大多数 UI 测试测的是正式关卡流程，不用逐关搭教学关；
 * 教学关本身的解锁链与判定单独测。
 */
export function seedTeachCleared(): void {
  const key = 'lc-studio-progress-v1';
  const prev = JSON.parse(localStorage.getItem(key) ?? '{}');
  const cleared = { ...prev.cleared, ...teachCleared() };
  const started = { ...(prev.started ?? {}) };
  for (const id of TEACH_LEVEL_IDS) started[id] = true;
  localStorage.setItem(key, JSON.stringify({ ...prev, cleared, started }));
}

/** 渲染整个 App：先清空存档、预置教学关已通关（正式关卡才在地图上可点） */
export function renderApp(): RenderResult {
  localStorage.clear();
  seedTeachCleared();
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
