// @vitest-environment jsdom
/**
 * 封装时的自测提醒：封一个「输出不随输入变化」的电路（输入没接进去、上拉接到地…）时，
 * 游戏要先说清楚再问要不要封 —— 这种模块放回画布后编译合法、画布上毫无异常，
 * 只有"结果不对"，玩家会以为游戏有 BUG。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { FREE_STORAGE_KEY } from '../src/level/session';

/** 自由搭建里的坏电路：a 什么都没接，y 被一个电阻从 VCC 拉高（恒 1，与 a 无关） */
const stuckCanvas = {
  id: 'free',
  name: '自由搭建',
  syms: [
    { id: 'rail-vcc', kind: 'vcc', x: 40, y: 60, rot: 0, label: 'VCC', locked: true },
    {
      id: 'in-a',
      kind: 'input',
      x: 40,
      y: 200,
      rot: 0,
      value: 0,
      label: 'a',
      width: 1,
      locked: true,
    },
    { id: 'out-y', kind: 'output', x: 680, y: 200, rot: 0, label: 'y', width: 1, locked: true },
    { id: 'r1', kind: 'unit', unit: 'res', x: 360, y: 130, rot: 0, label: 'R1' },
  ],
  wires: [
    { id: 'w1', a: { inst: 'rail-vcc', pin: 'p', bit: 0 }, b: { inst: 'r1', pin: 'a', bit: 0 } },
    { id: 'w2', a: { inst: 'r1', pin: 'b', bit: 0 }, b: { inst: 'out-y', pin: 'p', bit: 0 } },
  ],
  library: [],
};

function enterFree(): void {
  render(<App />);
  fireEvent.click(screen.getByText('自由搭建'));
}

describe('封装前自测', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(FREE_STORAGE_KEY, JSON.stringify(stuckCanvas));
    vi.spyOn(window, 'prompt').mockReturnValue('常量模块');
  });

  it('输出不随输入变 → 弹提醒；选择不封就不进组件库', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    enterFree();
    fireEvent.click(await screen.findByText('封装为模块'));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    const asked = confirmSpy.mock.calls[0]?.[0] as string;
    expect(asked).toContain('输出不随输入变化');
    expect(asked).toContain('y');
    // 没封：组件库里不该出现这个名字
    await waitFor(() => expect(screen.queryByText('常量模块')).toBeNull());
  });

  it('选择继续封装就照常入库', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    enterFree();
    fireEvent.click(await screen.findByText('封装为模块'));
    await waitFor(() => expect(screen.getByText(/已封装「常量模块」/)).toBeTruthy());
  });
});
