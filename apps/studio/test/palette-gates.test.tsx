// @vitest-environment jsdom
/**
 * 真实 App 层面的验证：开放模块库的关卡，左侧菜单里出现「基础门」区。
 *
 * 这条是"拆分"第 1 步的端到端护栏 —— 组件测试只证明 Palette 会给门出卡片，
 * 这里证明 App 那条注入链（进关时把本契约的门并进画布库，且 docFor 不会把
 * 没人引用的门剪掉）真的接通了。
 *
 * 踩过的坑（写下来免得再犯）——这条测试曾假失败三轮，还让我一度误判"产品没接通"：
 *   1. `renderApp()` 内部是 `localStorage.clear()` + render —— 先 seed 再 renderApp，
 *      通关存档会被冲掉（helper 的注释里写着，我没看），地图上「已通关 0/27」；
 *   2. `goToLevel` 是**点界面**（点「关卡模式」→ 点关卡标题），而地图按进度上锁：
 *      只通关第一章时第 12 关「半加器」点不动，菜单根本不渲染；
 *   3. 于是 waitFor 一路超时，我把"测试没进关"误读成"产品端到端没通"。
 * 教训：断言前先确认前置状态（页面上到底在哪），先打印真实 DOM 再下结论。
 */
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { StudioRequest } from '../src/sim/protocol';

vi.mock('../src/sim/runner', async () => {
  const { handleRequest } = await import('../src/sim/handle');
  return {
    createRunner: () => ({
      send: async (req: StudioRequest) => handleRequest(req),
      dispose: () => {},
    }),
  };
});

const { App } = await import('../src/App');
const { enableDebugUrl, renderApp, startJob } = await import('./helpers');

/** 第一章（7 关，'none'）+ 第二章（4 关，'all'）全通关 → 第 12 关「半加器」可进 */
const CLEARED_IDS = [
  's1-not',
  's1-and',
  's1-or',
  's1-nand',
  's1-nor',
  's1-xor',
  's1-xnor',
  's2-sr-latch',
  's2-btn-latch',
  's2-d-latch',
  's2-dff',
];

function seedThroughChapterTwo(): void {
  localStorage.clear();
  const cleared: Record<string, unknown> = {};
  for (const id of CLEARED_IDS) cleared[id] = { score: 100, bestCostHalf: 6, clearedAt: 1 };
  localStorage.setItem('lc-studio-progress-v1', JSON.stringify({ cleared }));
}

it('开放模块库的关卡里，元件库菜单出现「基础门」区并列出基础门', async () => {
  // ⚠️ 不能用 renderApp()：它内部 localStorage.clear() 会把下面的通关存档冲掉。
  //    正确顺序 = 清空 → 开调试入口 → 写存档 → render(<App/>) → 点进关卡。
  localStorage.clear();
  enableDebugUrl();
  seedThroughChapterTwo();
  render(<App />);
  startJob('半加器'); // 半加器关（第 12 关）是 moduleAccess: 'all'
  expect(await screen.findByText(/基础门（/, {}, { timeout: 20_000 })).toBeTruthy();
  // 列出来的必须是**基础门**，不能是「一键出答案」用的复合积木
  expect(screen.queryByText('二进制→BCD')).toBeNull();
  expect(screen.queryByText('显示控制')).toBeNull();
}, 60_000);

it('只给元件手搭的关卡（第一章）不出现「基础门」区', async () => {
  localStorage.clear();
  enableDebugUrl();
  renderApp();
  startJob('非门'); // 第一章第 1 关：moduleAccess: 'none'
  expect(await screen.findByText('我的元件', {}, { timeout: 30_000 })).toBeTruthy();
  expect(screen.queryByText(/基础门（/)).toBeNull();
}, 60_000);
