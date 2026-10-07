// @vitest-environment jsdom
/**
 * 调试模式：「一键出答案」把本关参考解搭到画布上，可直接交付验收（满分）；
 * 开关与开合选择一样持久化。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import {
  disableDebugUrl,
  enableDebugUrl,
  goToLevel,
  renderApp,
  startJob,
  teachCleared,
} from './helpers';

describe('调试模式 · 一键出答案', () => {
  beforeEach(() => {
    localStorage.clear();
    disableDebugUrl();
  });

  it('不带 ?debug=1：连「调试模式」按钮都不显示（存档里开着也不显示）', () => {
    localStorage.setItem('lc-ui-debug', '1'); // 上次开着调试：残留存档不得让按钮冒出来
    renderApp();
    startJob('非门');
    expect(screen.queryByText('调试模式')).toBeNull();
    expect(screen.queryByText('一键出答案')).toBeNull();
  });

  it('带 ?debug=1：按钮出现且进入即开着；可手动关掉再打开，然后一键出答案', async () => {
    enableDebugUrl(); // 调试入口：URL 带 ?debug=1
    renderApp();
    startJob('非门');
    expect(screen.getByText('调试模式')).toBeTruthy();
    expect(screen.getByText('一键出答案')).toBeTruthy(); // ?debug=1 = 进入即开

    fireEvent.click(screen.getByText('调试模式')); // 手动关
    expect(screen.queryByText('一键出答案')).toBeNull();
    fireEvent.click(screen.getByText('调试模式')); // 再开
    expect(screen.getByText('一键出答案')).toBeTruthy();

    fireEvent.click(screen.getByText('一键出答案'));
    expect(screen.getByText(/参考解已搭好/)).toBeTruthy();
    // 自动仿真跑起来了：画布图例出现（只有拿到仿真快照才渲染）。
    // 注：原来这里靠右侧面板成本表里的「三极管」行当信号，该面板已整块移除。
    await waitFor(() => expect(document.querySelector('.legend')).toBeTruthy());
  });

  it('一键出答案后交付验收：功能通过、最优成本满分', async () => {
    enableDebugUrl(); // ?debug=1：按钮出现且进入即开着
    renderApp();
    startJob('非门');
    fireEvent.click(screen.getByText('一键出答案'));
    // 自动仿真跑完（画布图例出现）后，仿真诊断里不得有「基极悬空」误报
    await waitFor(() => expect(document.querySelector('.legend')).toBeTruthy());
    expect(screen.queryByText(/基极悬空|未连接任何驱动/)).toBeNull();
    // 验收（验收台那枚）→ 通过后自动封装并弹出结算
    const judgeButtons = screen.getAllByText('交付验收');
    judgeButtons[judgeButtons.length - 1]?.click();
    await waitFor(() => expect(screen.getByText(/客户验收通过/)).toBeTruthy(), {
      timeout: 5000,
    });
    // 自动封装 → 结算对话框出现（不用再点「交付并封装」）
    await waitFor(() => expect(screen.getByText(/验收报告 · 非门/)).toBeTruthy(), {
      timeout: 5000,
    });
    expect(screen.getByText(/已达满分线/)).toBeTruthy(); // 满分：达到 0.5×成本线
    // 一键出答案的参考解不该有任何「悬空」警告（画布导线是完整的）
    expect(screen.queryByText(/基极悬空|未连接任何驱动/)).toBeNull();
  });

  it('可见性只认 URL：手动关掉后刷新（仍带 ?debug=1）又开着', () => {
    enableDebugUrl();
    const first = renderApp();
    startJob('非门');
    fireEvent.click(screen.getByText('调试模式')); // 手动关掉
    expect(screen.queryByText('一键出答案')).toBeNull();
    first.unmount();
    render(<App />); // 模拟刷新（URL 上还带着 ?debug=1）
    goToLevel('非门');
    expect(screen.getByText('一键出答案')).toBeTruthy();
  });

  it('一键出答案：半加器直接出逻辑门版（元件版无优势不弹窗），验收满分', async () => {
    enableDebugUrl();
    // 半加器是第三章关卡：预置前一关（s2-dff）通关，解锁第三章
    localStorage.setItem(
      'lc-studio-progress-v1',
      JSON.stringify({
        cleared: {
          ...teachCleared(),
          's2-dff': { score: 100, bestCostHalf: 196, clearedAt: Date.now() },
        },
        attempts: {},
        library: [],
      }),
    );
    render(<App />);
    startJob('半加器');
    fireEvent.click(screen.getByText('一键出答案'));
    // 半加器：门版成本 64 < 元件版 84，元件版无优势 → 直接出门版，不弹窗
    expect(screen.getByText(/逻辑门版已搭好/)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '一键出答案' })).toBeNull();
    // 门版 = 模块积木：左侧「我的模块」出现教学门（异或门 / 与门 / 全加器等）
    await waitFor(() => expect(screen.getByText(/我的模块（\d+）/)).toBeTruthy());
    // 验收 → 通过后自动封装并弹出结算（满分）
    const judgeButtons = screen.getAllByText('交付验收');
    judgeButtons[judgeButtons.length - 1]?.click();
    await waitFor(() => expect(screen.getByText(/客户验收通过/)).toBeTruthy(), {
      timeout: 5000,
    });
    await waitFor(() => expect(screen.getByText(/验收报告 · 半加器/)).toBeTruthy(), {
      timeout: 5000,
    });
    expect(screen.getByText(/已达满分线/)).toBeTruthy();
  });

  it('无门版的关（非门）：一键出答案直接出元件版，不弹窗', () => {
    enableDebugUrl();
    renderApp();
    startJob('非门');
    fireEvent.click(screen.getByText('一键出答案'));
    expect(screen.getByText(/参考解已搭好/)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '一键出答案' })).toBeNull();
  });

  it('计算器（新关）：一键出答案直接出门版（元件版无优势，不弹窗）', async () => {
    enableDebugUrl();
    // 预置第三章前半关已通关，解锁计算器（链：…→ s3-bin2bcd → s3-or-chain → s3-encoder → s3-digit-entry → s3-calc）
    const cleared = {
      ...teachCleared(),
      's3-half-adder': { score: 100, bestCostHalf: 84, clearedAt: 1 },
      's3-full-adder': { score: 100, bestCostHalf: 180, clearedAt: 1 },
      's3-adder-4': { score: 100, bestCostHalf: 720, clearedAt: 1 },
      's3-adder-8': { score: 100, bestCostHalf: 1440, clearedAt: 1 },
      's3-alu': { score: 100, bestCostHalf: 1040, clearedAt: 1 },
      's3-bcd2bin': { score: 100, bestCostHalf: 2160, clearedAt: 1 },
      's3-bin2bcd': { score: 100, bestCostHalf: 7872, clearedAt: 1 },
      's3-reg-8': { score: 100, bestCostHalf: 1568, clearedAt: 1 },
      's3-or-chain': { score: 100, bestCostHalf: 12, clearedAt: 1 },
      's3-encoder': { score: 100, bestCostHalf: 88, clearedAt: 1 },
      's3-digit-entry': { score: 100, bestCostHalf: 1748, clearedAt: 1 },
    };
    localStorage.setItem(
      'lc-studio-progress-v1',
      JSON.stringify({ cleared, attempts: {}, library: [], started: {} }),
    );
    render(<App />);
    startJob('简易计算器');
    fireEvent.click(screen.getByText('一键出答案'));
    // 优先逻辑门版（元件版无成本/延迟优势）→ 直接出门版，不弹窗
    expect(screen.getByText(/逻辑门版已搭好/)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '一键出答案' })).toBeNull();
    // 门积木加入画布库（左侧「我的模块」出现 D锁存器/全加器等）
    await waitFor(() => expect(screen.getByText(/我的模块（\d+）/)).toBeTruthy(), {
      timeout: 15000,
    });
  }, 60_000);
});
