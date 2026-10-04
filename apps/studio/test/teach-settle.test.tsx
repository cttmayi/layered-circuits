// @vitest-environment jsdom
/**
 * 教学关只学元件，不产出资产：验收通过后记「已掌握」并弹结算，但**不封装模块** ——
 * 组件库不该因为上了一节课多出「二极管或门」这种积木（玩家反馈过这种来路不明的积木）。
 *
 * 参考解由调试入口的「一键出答案」搭出来（教学关的初始画布是半成品，手搭不动鼠标）。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { enableDebugUrl } from './helpers';

const PROGRESS_KEY = 'lc-studio-progress-v1';

describe('教学关通过后不封装模块', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('「认识三极管」通过：记已掌握、弹结算，组件库一个模块都不多', async () => {
    enableDebugUrl(); // ?debug=1：一键出答案可用（搭参考解）
    // 不预置教学关存档：这样「已掌握」只能来自这次通过（教学关本来就无解锁链）
    localStorage.clear();
    render(<App />);
    fireEvent.click(screen.getByText('教学模式'));
    fireEvent.click(screen.getByText('认识三极管'));
    fireEvent.click(screen.getByText(/去搭一下试试/));
    fireEvent.click(screen.getByText('一键出答案'));
    await waitFor(() => expect(screen.getByText(/参考解已搭好/)).toBeTruthy());

    const judgeButtons = screen.getAllByText('交付验收');
    judgeButtons[judgeButtons.length - 1]?.click();
    await waitFor(() => expect(screen.getByText(/验收报告/)).toBeTruthy(), { timeout: 5000 });

    // 结算页说的是「教学关不产出积木模块」，而不是「交付物已进组件库」
    const note = document.querySelector('.settlement .panel-note')?.textContent ?? '';
    expect(note).toContain('教学关');
    expect(note).toContain('不产出积木模块');
    expect(note).not.toContain('已进组件库');
    // 按钮也改成回教学模式（教学关不在关卡链上，没有「下一单」）
    expect(screen.getByText('回到教学模式')).toBeTruthy();

    // 存档：教学关记录在案，但组件库里没有任何模块
    const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as {
      cleared?: Record<string, unknown>;
      library?: unknown[];
    };
    expect(progress.cleared?.['s1-npn']).toBeTruthy(); // 这一关是这次通过的
    expect(progress.library ?? []).toEqual([]); // 组件库一个模块都没有

    // 「回到教学模式」回教学页：这张卡已经是「已掌握 1/5」
    fireEvent.click(screen.getByText('回到教学模式'));
    expect(screen.getByText(/教学模式 · 认识元件/)).toBeTruthy();
    expect(screen.getByText(/已掌握 1\/5/)).toBeTruthy();
  });
});
