// @vitest-environment jsdom
/**
 * 「时序视图」：把"怎么看"和"怎么判"分开。
 *
 * 科普模式（逻辑模式）下点开时序视图，仿真改走真实时序（带延迟、能看波形/竞争），
 * 但**判定口径不变** —— 交付验收仍然按关卡声明的稳定值判，视图绝不影响成绩。
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
  it('科普模式 → 开后时序视图：simulate 带 withWaveform，judge 一个字段都没变', async () => {
    enableDebugUrl();
    renderApp();
    startJob('非门');
    // 一键出答案：省得在测试里手搭电路
    fireEvent.click(screen.getByText('一键出答案'));
    await waitFor(() => expect(screen.getByText('三极管')).toBeTruthy());
    // 默认（科普模式、视图关）：逻辑模式跑，不带波形
    const first = simRequests().at(-1)!;
    expect(first).toMatchObject({ type: 'simulate', mode: 'logic' });
    expect(first.type === 'simulate' && first.withWaveform).toBe(false);

    // 打开时序视图
    fireEvent.click(screen.getByText('时序视图'));
    await waitFor(() => {
      const last = simRequests().at(-1)!;
      expect(last.type === 'simulate' && last.mode).toBe('timing');
    });
    const viewed = simRequests().at(-1)!;
    expect(viewed.type === 'simulate' && viewed.withWaveform).toBe(true);
    // 画布上出现真实波形（端口行有标签）
    await waitFor(() => expect(document.querySelectorAll('.wlabel').length).toBeGreaterThan(0));

    // 交付验收：判定请求必须与视图无关（原样：不给 mode、hardcore 仍按科普模式为 false）
    fireEvent.click(screen.getAllByText('交付验收')[0]!);
    await waitFor(() => expect(judgeRequests().length).toBeGreaterThan(0));
    const judge = judgeRequests().at(-1)!;
    expect(judge.type === 'judge' && judge.hardcore).toBe(false);
    expect(judge.type === 'judge' && (judge as { mode?: unknown }).mode).toBeUndefined();
    // 而且照样判过（说明视图没把判定带偏）
    await waitFor(() => expect(screen.getAllByText(/材料费/).length).toBeGreaterThan(0));
  }, 30_000);
});

describe('视图不残留', () => {
  it('换关后回到关卡自己的口径（视图关掉）', async () => {
    // 预置前六关已通关：这样「同或门」在地图上是可点的
    localStorage.clear();
    const cleared: Record<string, unknown> = {};
    for (const id of ['s1-not', 's1-and', 's1-or', 's1-nand', 's1-nor', 's1-xor']) {
      cleared[id] = { score: 100, bestCostHalf: 6, clearedAt: 1 };
    }
    localStorage.setItem('lc-studio-progress-v1', JSON.stringify({ cleared }));
    render(<App />);
    startJob('非门');
    fireEvent.click(screen.getByText('时序视图'));
    await waitFor(() => {
      const last = simRequests().at(-1)!;
      expect(last.type === 'simulate' && last.mode).toBe('timing');
    });
    // 换关：视图应当回到该关自己的口径（默认稳定值视角）
    fireEvent.click(screen.getByText('← 返回地图'));
    fireEvent.click(screen.getByText('同或门'));
    await waitFor(() => {
      const last = simRequests().at(-1)!;
      expect(last.type === 'simulate' && last.mode).toBe('logic');
    });
    expect(screen.queryByText('时序视图')?.className ?? '').not.toContain('active');
  }, 30_000);
});
