// @vitest-environment jsdom
/**
 * 游戏壳：主菜单（开场）→ 关卡地图（选关）→ 工作台；
 * 开工状态持久化：刷新后主菜单出现「继续上次」，直接回工作台不重弹委托。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { startJob } from './helpers';

describe('游戏壳：主菜单 / 关卡地图 / 会话恢复', () => {
  beforeEach(() => localStorage.clear());

  it('首次启动进主菜单：关卡模式 / 自由搭建 / 无「继续上次」', () => {
    render(<App />);
    expect(screen.getByText('逐层电路')).toBeTruthy();
    expect(screen.getByText('关卡模式')).toBeTruthy();
    expect(screen.getByText('自由搭建')).toBeTruthy();
    expect(screen.queryByText(/继续上次/)).toBeNull();
    // 还没进工作台：没有工作台专属按钮
    expect(screen.queryByText('交付验收')).toBeNull();
  });

  it('主菜单 → 关卡模式 → 地图：第一章标题出现，未解锁的关节点不可点', () => {
    render(<App />);
    fireEvent.click(screen.getByText('关卡模式'));
    expect(screen.getByText('第一章 · 基础门电路')).toBeTruthy();
    const notBtn = screen.getByText('非门').closest('button') as HTMLButtonElement;
    const andBtn = screen.getByText('与门').closest('button') as HTMLButtonElement;
    expect(notBtn.disabled).toBe(false); // 第一关可接
    expect(andBtn.disabled).toBe(true); // 第二关锁定
  });

  it('开工后刷新（重新进 App）：主菜单有「继续上次」，点它直接回工作台不弹委托', () => {
    const first = render(<App />);
    startJob('非门');
    first.unmount();
    // 模拟刷新：localStorage 还在，重新挂载
    render(<App />);
    expect(screen.getByText(/继续上次/)).toBeTruthy();
    fireEvent.click(screen.getByText(/继续上次/));
    // 直接进工作台：不弹「新委托」，图纸卡在
    expect(screen.queryByText('新委托')).toBeNull();
    expect(screen.getByText(/委托单 · 非门/)).toBeTruthy();
  });

  it('自由搭建从主菜单进：工作台出现，但没有「交付验收」（关卡专属）', () => {
    render(<App />);
    fireEvent.click(screen.getByText('自由搭建'));
    expect(screen.getByText(/电路工作台/)).toBeTruthy();
    expect(screen.queryByText('交付验收')).toBeNull();
  });
});
