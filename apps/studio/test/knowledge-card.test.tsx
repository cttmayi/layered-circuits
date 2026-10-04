// @vitest-environment jsdom
/**
 * 知识卡片（原教学关）：**可选、不算关卡、不计进度与成绩**。
 *
 * 点开是引导搭建（动手玩一玩），对上了只给一句反馈：
 * 不记「已掌握」、不记尝试次数、不弹结算页（没有客户、没有钱、没有星）、
 * 不产出积木模块。对照表本身就在工作台下方 —— 那就是学习反馈。
 *
 * 参考解由调试入口的「一键出答案」搭出来（卡片的初始画布是半成品，手搭不动鼠标）。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { enableDebugUrl } from './helpers';

const PROGRESS_KEY = 'lc-studio-progress-v1';

describe('知识卡片不算关卡与成绩', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('「认识三极管」对上答案：不弹结算、不记成绩、组件库不多一个模块', async () => {
    enableDebugUrl(); // ?debug=1：一键出答案可用（搭参考解）
    render(<App />);
    fireEvent.click(screen.getByText('知识卡片'));
    fireEvent.click(screen.getByText('认识三极管'));
    fireEvent.click(screen.getByText(/去搭一下试试/));
    fireEvent.click(screen.getByText('一键出答案'));
    await waitFor(() => expect(screen.getByText(/参考解已搭好/)).toBeTruthy());

    // 按钮是「对照答案」（不是订单的「交付验收」）
    expect(screen.getAllByText('对照答案').length).toBeGreaterThan(0);
    const buttons = screen.getAllByText('对照答案');
    buttons[buttons.length - 1]?.click();
    // 反馈：一句说明 + 不弹结算页
    await waitFor(() => expect(screen.getByText(/知识卡片不计进度与成绩/)).toBeTruthy(), {
      timeout: 5000,
    });
    expect(screen.queryByText(/验收报告/)).toBeNull();
    expect(screen.queryByText(/已交付/)).toBeNull();
    // 右侧对照台也是卡片语气：没有「客户」「款项」「正在封装并结算」
    expect(screen.getByText('对上了！跟真值表一致')).toBeTruthy();
    expect(screen.queryByText(/客户验收通过/)).toBeNull();
    expect(screen.queryByText(/正在自动封装/)).toBeNull();
    expect(screen.queryByText(/款项/)).toBeNull();

    // 存档：一个字都不写（没有通关记录、没有尝试记录、组件库为空）
    const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as {
      cleared?: Record<string, unknown>;
      attempts?: Record<string, unknown>;
      library?: unknown[];
    };
    expect(progress.cleared?.['s1-npn'] ?? false).toBe(false);
    expect(Object.keys(progress.cleared ?? {}).length).toBe(0);
    expect(Object.keys(progress.attempts ?? {}).length).toBe(0);
    expect(progress.library ?? []).toEqual([]);
  }, 30_000);

  it('老存档里的教学关记录在装载时被清理（卡片不再显示「已掌握」）', async () => {
    // 模拟旧版本留下的教学关通关记录
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        cleared: {
          's1-npn': { score: 100, bestCostHalf: 8, clearedAt: 1 },
          's1-dio': { score: 100, bestCostHalf: 6, clearedAt: 1 },
        },
        attempts: { 's1-npn': 3 },
        started: { 's1-npn': true },
      }),
    );
    render(<App />);
    fireEvent.click(screen.getByText('知识卡片'));
    // 卡片页没有任何"掌握/通关"计数
    expect(screen.queryByText(/已掌握/)).toBeNull();
    expect(screen.getByText(/不算关卡、不计进度与成绩/)).toBeTruthy();
    // 存档里的残留被清理（自动保存 effect 把清理后的进度写回）
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as {
        cleared?: Record<string, unknown>;
        started?: Record<string, unknown>;
      };
      expect(Object.keys(saved.cleared ?? {}).length).toBe(0);
      expect(saved.started?.['s1-npn'] ?? false).toBe(false);
    });
  });
});
