// @vitest-environment jsdom
/**
 * 「时序视图」：把"怎么看"和"怎么判"分开。
 *
 * 科普模式（逻辑模式）下点开时序视图，仿真改走真实时序（带延迟、能看波形/竞争），
 * 但**判定口径不变** —— 交付验收按关卡自己声明的口径判（logic 或 timing），视图绝不影响成绩。
 * 这是"全面改成时序模式"方向的第一步：先让玩家随时能看见真实时序，判定先不动。
 */

import { findLevel } from '@lc/content';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioRequest } from '../src/sim/protocol';

/** 记录所有请求；执行仍交给真正的 handleRequest，所以响应是真实的 */
const seen = vi.hoisted(() => [] as StudioRequest[]);

vi.mock('../src/sim/runner', async () => {
  const { handleRequest } = await import('../src/sim/handle');
  return {
    createRunner: () => ({
      send: async (req: StudioRequest) => {
        seen.push(req);
        return handleRequest(req);
      },
      dispose: () => {},
    }),
  };
});

const { App } = await import('../src/App');
const { disableDebugUrl, enableDebugUrl, renderApp, startJob } = await import('./helpers');
const { handleRequest } = await import('../src/sim/handle');

/** 预置第一章全通关（含同或门）：不然第二章的关卡在地图上点不动 */
function seedCleared(): void {
  localStorage.clear();
  const cleared: Record<string, unknown> = {};
  for (const id of ['s1-not', 's1-and', 's1-or', 's1-nand', 's1-nor', 's1-xor', 's1-xnor']) {
    cleared[id] = { score: 100, bestCostHalf: 6, clearedAt: 1 };
  }
  localStorage.setItem('lc-studio-progress-v1', JSON.stringify({ cleared }));
}

const simRequests = () => seen.filter((r) => r.type === 'simulate');
const judgeRequests = () => seen.filter((r) => r.type === 'judge');

beforeEach(() => {
  localStorage.clear();
  seen.length = 0;
  disableDebugUrl();
});

describe('仿真层：时序视图真的按真实时序跑，并带回端口波形', () => {
  it('同一份组合电路：逻辑模式无波形，时序模式有波形且结论一致', () => {
    const design = findLevel('s1-not')!.referenceSolution!;
    const logic = handleRequest({
      id: 1,
      type: 'simulate',
      design,
      library: [],
      mode: 'logic',
      inputs: { a: 1 },
      buttonPorts: [],
    });
    const timing = handleRequest({
      id: 2,
      type: 'simulate',
      design,
      library: [],
      mode: 'timing',
      inputs: { a: 1 },
      buttonPorts: [],
      withWaveform: true,
    });
    // 逻辑模式没有时间轴：不给波形
    expect(logic.snapshot?.waveform ?? null).toBeNull();
    // 时序模式：端口级波形非空，且包含输出端口 y
    const wave = timing.snapshot?.waveform ?? null;
    expect(wave).not.toBeNull();
    expect(wave?.nets.some((n) => n.port?.name === 'y')).toBe(true);
    // 关键：**结论不变** —— 时序视图只是"看得见过程"，输出的稳定值必须相同
    expect(timing.snapshot?.portValues).toEqual(logic.snapshot?.portValues);
    // 延迟看得见：输出不是在 t=0 就翻的，而是在元件延迟之后
    const yNet = wave?.nets.find((n) => n.port?.name === 'y');
    expect(yNet).toBeDefined();
    expect(yNet?.steps.length).toBeGreaterThan(1);
    expect(yNet?.steps.at(-1)?.timePs).toBeGreaterThan(0);
  });
});

describe('界面层：时序视图只改仿真，不改判定', () => {
  it('时序视图开关只收放波形显示：不重跑仿真，判定也不受影响', async () => {
    enableDebugUrl();
    renderApp();
    startJob('非门');
    // 一键出答案：省得在测试里手搭电路
    fireEvent.click(screen.getByText('一键出答案'));
    await waitFor(() => expect(screen.getByText('三极管')).toBeTruthy());
    // 画布与判定共用工具栏口径（默认时序版），因此默认按真实时序跑、带波形
    await waitFor(() => {
      const last = simRequests().at(-1)!;
      expect(last.type === 'simulate' && last.mode).toBe('timing');
    });
    const first = simRequests().at(-1)!;
    expect(first.type === 'simulate' && first.withWaveform).toBe(true);
    await waitFor(() => expect(document.querySelectorAll('.wlabel').length).toBeGreaterThan(0));
    // 旧的两档开关（科普模式 / 硬核模式）已移除；现在是「逻辑版 / 时序版」一个总开关，默认时序版
    expect(screen.queryByText('科普模式')).toBeNull();
    expect(screen.queryByText(/硬核模式/)).toBeNull();

    // 收起「时序视图」：只收起波形显示，不重跑仿真
    const before = simRequests().length;
    fireEvent.click(screen.getByText('时序视图'));
    await waitFor(() => expect(document.querySelectorAll('.wlabel').length).toBe(0));
    expect(simRequests().length).toBe(before);

    // 交付验收：判定口径只由工具栏的「逻辑版 / 时序版」决定，跟「时序视图」（画不画波形）无关；
    // 默认时序版 → 判定按真实时序 + hardcore。上面刚收起过波形，这里 mode 必须还是 timing。
    fireEvent.click(screen.getAllByText('交付验收')[0]!);
    await waitFor(() => expect(judgeRequests().length).toBeGreaterThan(0));
    const judge = judgeRequests().at(-1)!;
    expect(judge.type === 'judge' && judge.hardcore).toBe(true);
    expect(judge.type === 'judge' && judge.mode).toBe('timing');
    // 而且照样判过（说明收起波形没把判定带偏）
    await waitFor(() => expect(screen.getAllByText(/材料费/).length).toBeGreaterThan(0));
  }, 30_000);
});

describe('判定口径跟随关卡：1~7 关走真实时序，第 8 关起走逻辑', () => {
  it('SR 锁存器（第 8 关起）：按关卡口径走逻辑验证，不再跑真实时序', async () => {
    seedCleared();
    render(<App />);
    startJob('SR 锁存器');
    // 先确认真的进了工作台：锁着的关卡点不动，否则后面的断言会「空过」
    await waitFor(() => expect(screen.getAllByText('交付验收').length).toBeGreaterThan(0));
    await waitFor(() => {
      const last = simRequests().at(-1);
      expect(last?.type === 'simulate' && last.mode).toBe('logic');
    });
  }, 30_000);

  it('与非门（第 4 关）：按关卡口径走真实时序', async () => {
    seedCleared(); // 预置第一章已通关，「与非门」在地图上可点
    render(<App />);
    startJob('与非门');
    await waitFor(() => expect(screen.getAllByText('交付验收').length).toBeGreaterThan(0));
    await waitFor(() => {
      const last = simRequests().at(-1);
      expect(last?.type === 'simulate' && last.mode).toBe('timing');
    });
  }, 30_000);
});

describe('视图不残留', () => {
  it('波形视图的选择跨关保留（不再按关卡口径强制重置）', async () => {
    // 预置前六关已通关：这样「同或门」在地图上是可点的
    seedCleared();
    render(<App />);
    startJob('非门');
    await waitFor(() => expect(screen.getAllByText('交付验收').length).toBeGreaterThan(0));
    await waitFor(() => expect(document.querySelectorAll('.wlabel').length).toBeGreaterThan(0));

    // 收起波形显示
    fireEvent.click(screen.getByText('时序视图'));
    await waitFor(() => expect(document.querySelectorAll('.wlabel').length).toBe(0));

    // 换关：选择保留（玩家偏好不该被关卡切换覆盖）
    fireEvent.click(screen.getByText('← 返回地图'));
    fireEvent.click(screen.getByText('同或门'));
    await waitFor(() => expect(screen.getAllByText('交付验收').length).toBeGreaterThan(0));
    expect(screen.queryByText('时序视图')?.className ?? '').not.toContain('active');
    expect(document.querySelectorAll('.wlabel').length).toBe(0);

    // 但仿真照样按真实时序跑 —— 「怎么看」和「怎么跑」已经分开
    await waitFor(() => {
      const last = simRequests().at(-1)!;
      expect(last.type === 'simulate' && last.mode).toBe('timing');
    });
  }, 30_000);
});
