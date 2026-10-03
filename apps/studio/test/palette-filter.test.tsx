// @vitest-environment jsdom
/**
 * 左侧元件库顶部的「隐藏本关不可用」筛选：
 *  - 默认全部显示（可用 + 锁定都列出，锁定项灰置）；
 *  - 勾上后锁定元件整卡消失，可用元件不受影响；
 *  - 勾选状态写入 localStorage，重挂载保持。
 *
 * 直接渲染 Palette 并给一个受限 allowedUnits 的假关卡，绕开地图导航。
 */
import type { Level } from '@lc/schema';
import { fireEvent, type RenderResult, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Palette } from '../src/panels/Palette';

/** 一个只开放 NPN/电阻 的假关卡（RTL 教学关同款约束） */
function lockedLevel(): Level {
  return {
    id: 't-not',
    title: '非门（测试）',
    allowedUnits: ['npn', 'res'],
    moduleAccess: 'none',
    bannedModules: [],
    allowedModules: [],
    kind: 'normal',
  } as unknown as Level;
}

function renderPalette(): RenderResult {
  return render(<Palette placing={null} onPick={() => {}} library={[]} level={lockedLevel()} />);
}

describe('元件库「隐藏本关不可用」', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('勾选后隐藏锁定元件，可用元件保留', () => {
    renderPalette();
    // 默认全部显示：可用（三极管/电阻）与锁定（二极管/N-MOS…）都列出
    expect(screen.getByText('三极管 NPN')).toBeTruthy();
    expect(screen.getByText('二极管')).toBeTruthy();
    expect(screen.getByText('N-MOS')).toBeTruthy();
    // 电源与端口：VCC 可用、输入引脚在关卡模式下锁定
    expect(screen.getByText('VCC 电源')).toBeTruthy();
    expect(screen.getByText('输入引脚')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('隐藏本关不可用'));

    expect(screen.queryByText('二极管')).toBeNull();
    expect(screen.queryByText('N-MOS')).toBeNull();
    expect(screen.queryByText('输入引脚')).toBeNull();
    expect(screen.getByText('三极管 NPN')).toBeTruthy();
    expect(screen.getByText('VCC 电源')).toBeTruthy();
  });

  it('勾选状态持久化：重新打开元件库仍生效', () => {
    const first = renderPalette();
    fireEvent.click(screen.getByLabelText('隐藏本关不可用'));
    expect(screen.queryByText('二极管')).toBeNull();
    first.unmount();

    renderPalette();
    expect(screen.queryByText('二极管')).toBeNull();
    expect(screen.getByText('三极管 NPN')).toBeTruthy();
  });
});
