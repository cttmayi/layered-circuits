// @vitest-environment jsdom
/**
 * 调试模式：「一键出答案」把本关参考解搭到画布上，可直接交付验收（满分）；
 * 开关与开合选择一样持久化。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { goToLevel, startJob } from './helpers';

describe('调试模式 · 一键出答案', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('默认隐藏；打开调试模式后出现「一键出答案」，点击搭出参考解', async () => {
    render(<App />);
    startJob('非门');
    expect(screen.queryByText('一键出答案')).toBeNull();

    fireEvent.click(screen.getByText('调试模式'));
    expect(screen.getByText('一键出答案')).toBeTruthy();

    fireEvent.click(screen.getByText('一键出答案'));
    expect(screen.getByText(/参考解已搭好/)).toBeTruthy();
    // 自动仿真跑起来了：真值表有内容（非门 2 行），说明电路真的搭到了画布上
    await waitFor(() => {
      const tt = screen.queryByText(/真值表（\d+ 行）/);
      expect(tt).toBeTruthy();
      expect((tt?.textContent ?? '').match(/真值表（(\d+) 行）/)?.[1]).toBe('2');
    });
  });

  it('一键出答案后交付验收：功能通过、最优成本满分', async () => {
    render(<App />);
    startJob('非门');
    fireEvent.click(screen.getByText('调试模式'));
    fireEvent.click(screen.getByText('一键出答案'));
    // 验收（工具栏那枚）
    const judgeButtons = screen.getAllByText('交付验收');
    judgeButtons[judgeButtons.length - 1]?.click();
    await waitFor(() => expect(screen.getByText(/验收通过|合格|已通过/)).toBeTruthy(), {
      timeout: 5000,
    });
    expect(screen.getByText(/满分|成本正好等于最优|评 A|星 ?3/)).toBeTruthy();
  });

  it('调试模式开关持久化：刷新后仍开着', () => {
    const first = render(<App />);
    startJob('非门');
    fireEvent.click(screen.getByText('调试模式'));
    expect(screen.getByText('一键出答案')).toBeTruthy();
    first.unmount();
    render(<App />);
    goToLevel('非门');
    expect(screen.getByText('一键出答案')).toBeTruthy();
  });

  it('门版答案：半加器用模块积木（异或门+与门），交付验收满分', async () => {
    // 半加器是第三章关卡：预置前一关（s2-dff-fast）通关，解锁第三章
    localStorage.setItem(
      'lc-studio-progress-v1',
      JSON.stringify({
        cleared: { 's2-dff-fast': { score: 100, bestCostHalf: 48, clearedAt: Date.now() } },
        attempts: {},
        library: [],
      }),
    );
    render(<App />);
    startJob('半加器');
    fireEvent.click(screen.getByText('调试模式'));
    fireEvent.click(screen.getByText('门版答案'));
    expect(screen.getByText(/逻辑门版已搭好/)).toBeTruthy();
    // 门版 = 模块积木：左侧「我的模块」出现教学门（异或门 / 与门 / 全加器等）
    await waitFor(() => expect(screen.getByText(/我的模块（\d+）/)).toBeTruthy());
    // 验收 → 满分
    const judgeButtons = screen.getAllByText('交付验收');
    judgeButtons[judgeButtons.length - 1]?.click();
    await waitFor(() => expect(screen.getByText(/验收通过|合格|已通过/)).toBeTruthy(), {
      timeout: 5000,
    });
    expect(screen.getByText(/满分|成本正好等于最优|评 A|星 ?3/)).toBeTruthy();
  });

  it('没有门版的关（非门）：点门版答案给提示，不炸', () => {
    render(<App />);
    startJob('非门');
    fireEvent.click(screen.getByText('调试模式'));
    fireEvent.click(screen.getByText('门版答案'));
    expect(screen.getByText(/本关没有逻辑门版参考解/)).toBeTruthy();
  });
});
