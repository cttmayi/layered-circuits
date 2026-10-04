// @vitest-environment jsdom
/**
 * 回归：一键出答案 → 返回地图 → 重进同一关，模块引脚与连线不能消失。
 *
 * 根因：存档只存画布不背组件库，读档时用 progress.library（玩家自有库）重新注入；
 * 而一键出答案搭的是教学模板（非门/与非门…），其 hash 不在玩家自有库里 →
 * 重进后 pinOffsets 查不到模板返回空 → 模块引脚消失、导线失效。
 * 修复：docFor 读档时按需补上被存档引用的教学模板（resolveMissingModules）。
 */
import { ALL_LEVELS } from '@lc/content';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { StudioRequestInput, StudioResponse } from '../src/sim/protocol';
import { enableDebugUrl, seedTeachCleared } from './helpers';

const requests = vi.hoisted(() => [] as Array<{ req: StudioRequestInput; resp: StudioResponse }>);
vi.mock('../src/sim/handle', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/sim/handle')>();
  return {
    ...mod,
    handleRequest: vi.fn((req: StudioRequestInput) => {
      const resp = mod.handleRequest(req as never) as StudioResponse;
      requests.push({ req, resp });
      return resp;
    }),
  };
});

const level = ALL_LEVELS.find((l) => l.id === 's2-btn-latch')!;

function enterBtnLatch(): void {
  enableDebugUrl(); // 「调试模式」按钮只在 ?debug=1 时出现（挂载时判定，必须在 render 前）
  localStorage.clear();
  seedTeachCleared();
  const key = 'lc-studio-progress-v1';
  const prev = JSON.parse(localStorage.getItem(key) ?? '{}');
  const cleared = { ...(prev.cleared ?? {}) };
  for (const l of ALL_LEVELS) {
    if (l.id === level.id) break;
    cleared[l.id] = { score: 100, bestProfitHalf: 999, bestCostHalf: 6, clearedAt: 1 };
  }
  localStorage.setItem(key, JSON.stringify({ ...prev, cleared }));
  render(<App />);
  fireEvent.click(screen.getByText('关卡模式'));
  fireEvent.click(screen.getByText('按钮锁存'));
}

const modHashes = (req: StudioRequestInput): string[] =>
  ((req.design as { instances?: Array<{ module?: string }> }).instances ?? [])
    .map((i) => i.module)
    .filter(Boolean) as string[];

const libHashes = (req: StudioRequestInput): string[] =>
  (req.library ?? []).map((m) => (m as { hash: string }).hash);

describe('一键出答案 → 返回地图 → 重进', () => {
  beforeEach(() => {
    localStorage.clear();
    requests.length = 0;
  });

  it('重进后模块引脚模板仍在库中，仿真正常', { timeout: 40_000 }, async () => {
    enterBtnLatch();
    await waitFor(() => expect(screen.getByText('调试模式')).toBeTruthy(), { timeout: 4000 });
    fireEvent.click(screen.getByText('一键出答案')); // ?debug=1：进入即已开
    await new Promise((r) => setTimeout(r, 300));
    const modal = screen.queryByText('逻辑门版（简洁）');
    if (modal) fireEvent.click(modal);
    await waitFor(() => expect(requests.length).toBeGreaterThan(0), { timeout: 4000 });

    // 等自动存档（400ms 防抖）把答案画布落盘
    await new Promise((r) => setTimeout(r, 700));
    const answerMods = modHashes(requests[requests.length - 1].req);
    expect(answerMods.length).toBeGreaterThan(0);

    // 返回地图 → 重进同一关
    fireEvent.click(screen.getByText('← 返回地图'));
    await waitFor(() => expect(screen.getByText('按钮锁存')).toBeTruthy(), { timeout: 4000 });
    fireEvent.click(screen.getByText('按钮锁存'));
    await waitFor(() => expect(requests.length).toBeGreaterThan(1), { timeout: 4000 });

    const re = requests[requests.length - 1];
    const reMods = modHashes(re.req);
    expect(reMods.length).toBe(answerMods.length); // 答案画布被读回
    const reLib = libHashes(re.req);
    // 核心断言：读回的库必须能解析所有模块 hash（否则引脚/连线消失）
    const missing = reMods.filter((h) => !reLib.includes(h));
    expect(missing).toEqual([]);
    // 仿真也要正常：非门输出网存在且有值
    expect(re.resp.error).toBeUndefined();
    const nets = new Set((re.resp.snapshot?.netSignals ?? []).map(([k]) => k));
    expect(nets.size).toBeGreaterThan(0);
  });
});
