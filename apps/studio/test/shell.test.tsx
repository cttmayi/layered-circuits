// @vitest-environment jsdom
/**
 * 游戏壳：主菜单（开场）→ 关卡地图（选关）→ 工作台；
 * 开工状态持久化：刷新后主菜单出现「继续上次」，直接回工作台不重弹委托。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { goToLevel, renderApp, startJob } from './helpers';

describe('游戏壳：主菜单 / 关卡地图 / 会话恢复', () => {
  beforeEach(() => localStorage.clear());

  it('知识卡片与关卡模式并列：关卡链第一关是非门；元件卡片全开放（无解锁链、不计进度）', () => {
    render(<App />); // 不 seed：验证全新存档
    // 关卡模式：教学关不在链上，非门是第一关（开放），与门锁定
    fireEvent.click(screen.getByText('关卡模式'));
    expect(screen.getByText('非门').closest('button')?.disabled).toBe(false);
    expect(screen.getByText('与门').closest('button')?.disabled).toBe(true);
    expect(screen.queryByText('认识三极管')).toBeNull(); // 教学关不进关卡地图
    fireEvent.click(screen.getByText('← 返回主菜单'));
    // 知识卡片：5 张元件卡全部开放（不评星、不锁链、不计进度）
    fireEvent.click(screen.getByText('知识卡片'));
    expect(screen.getByText(/知识卡片 · 认识元件/)).toBeTruthy();
    expect(screen.getByText(/不算关卡、不计进度与成绩/)).toBeTruthy();
    const npnBtn = screen.getByText('认识三极管').closest('button') as HTMLButtonElement;
    const dioBtn = screen.getByText('认识二极管').closest('button') as HTMLButtonElement;
    expect(npnBtn.disabled).toBe(false); // 教学元件无解锁链
    expect(dioBtn.disabled).toBe(false);
    expect(screen.getAllByText(/点开动手试试/).length).toBe(5); // 5 张卡都可点
  });

  it('知识卡片：点元件弹「元件课堂」概念卡，关闭后是半成品工作台 + 引导条', () => {
    render(<App />);
    fireEvent.click(screen.getByText('知识卡片'));
    fireEvent.click(screen.getByText('认识三极管'));
    // 先讲课：概念卡弹窗（生活类比 + 要点）
    const dialog = screen.getByRole('dialog', { name: '元件课堂' });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText(/反着来的开关/)).toBeTruthy();
    // 概念卡图文并茂：SVG 原理图（可被屏幕阅读器读出）
    expect(within(dialog).getByRole('img', { name: /示意图/ })).toBeTruthy();
    // 点「去搭一下试试」→ 工作台：委托单 + 引导条（跟着做）
    fireEvent.click(screen.getByText(/去搭一下试试/));
    expect(screen.getByText(/任务 · 认识三极管/)).toBeTruthy();
    expect(screen.getByText(/动手搭 · 跟着做/)).toBeTruthy();
    expect(screen.getByText(/第一步：把三极管的基极/)).toBeTruthy();
  });

  it('首次启动进主菜单：关卡模式 / 自由搭建 / 无「继续上次」', () => {
    renderApp();
    expect(screen.getByText('逐层电路')).toBeTruthy();
    expect(screen.getByText('关卡模式')).toBeTruthy();
    expect(screen.getByText('自由搭建')).toBeTruthy();
    expect(screen.queryByText(/继续上次/)).toBeNull();
    // 还没进工作台：没有工作台专属按钮
    expect(screen.queryByText('交付验收')).toBeNull();
  });

  it('主菜单 → 关卡模式 → 地图：第一章标题出现，未解锁的关节点不可点', () => {
    renderApp();
    fireEvent.click(screen.getByText('关卡模式'));
    expect(screen.getByText('第一章 · 元件入门与基础门电路')).toBeTruthy();
    const notBtn = screen.getByText('非门').closest('button') as HTMLButtonElement;
    const andBtn = screen.getByText('与门').closest('button') as HTMLButtonElement;
    expect(notBtn.disabled).toBe(false); // 第一关可接
    expect(andBtn.disabled).toBe(true); // 第二关锁定
  });

  it('开工后刷新（重新进 App）：主菜单有「继续上次」，点它直接回工作台不弹委托', () => {
    const first = renderApp();
    startJob('非门');
    first.unmount();
    // 模拟刷新：localStorage 还在，重新挂载
    render(<App />);
    expect(screen.getByText(/继续上次/)).toBeTruthy();
    fireEvent.click(screen.getByText(/继续上次/));
    // 直接进工作台：不弹「新委托」，图纸卡在
    expect(screen.queryByText('新委托')).toBeNull();
    expect(screen.getByText(/任务 · 非门/)).toBeTruthy();
  });

  it('自由搭建从主菜单进：工作台出现，但没有「交付验收」（关卡专属）', () => {
    renderApp();
    fireEvent.click(screen.getByText('自由搭建'));
    expect(screen.getByText(/电路工作台/)).toBeTruthy();
    expect(screen.queryByText('交付验收')).toBeNull();
  });

  it('进关即开工：新单不再弹「新委托」，直接进工作台；刷新后不重弹', () => {
    const first = renderApp();
    goToLevel('非门'); // 第一关：新单也直接开工
    expect(screen.queryByText('新委托')).toBeNull();
    expect(screen.getByText(/任务 · 非门/)).toBeTruthy();
    first.unmount();
    render(<App />); // 模拟刷新：started 已持久化
    fireEvent.click(screen.getByText(/继续上次/));
    expect(screen.queryByText('新委托')).toBeNull();
    expect(screen.getByText(/任务 · 非门/)).toBeTruthy();
  });

  it('主菜单「新游戏」：确认后先选工艺契约，选定后清空存档、回到全新主菜单', () => {
    // 先有进度：进关即开工（知识卡片不再写进度，所以这里只有主线记录）
    const first = renderApp();
    goToLevel('非门');
    first.unmount();
    const before = JSON.parse(localStorage.getItem('lc-studio-progress-v1') ?? '{}');
    expect(Object.keys(before.cleared ?? {}).length).toBe(0); // 还没通关任何关
    expect(before.cleared?.['s1-not'] ?? false).toBe(false); // 还没通关非门
    expect(before.started?.['s1-not']).toBe(true); // 进关即开工已持久化
    // 有存档 → 主菜单出现「继续上次」
    render(<App />);
    expect(screen.getByText(/继续上次/)).toBeTruthy();
    // 点「新游戏」并确认 → 进入工艺契约选择（决策 2：这一步还没清档）
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByText('新游戏'));
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByText('选择工艺契约')).toBeTruthy();
    const mid = JSON.parse(localStorage.getItem('lc-studio-progress-v1') ?? '{}');
    // 契约选定后才动手清档：这一步存档原样还在（开工记录还在，只是没通关）
    expect(mid.started?.['s1-not']).toBe(true);
    // 选定契约（默认 CMOS）→ 清空存档、回到全新主菜单
    fireEvent.click(screen.getByRole('button', { name: /用 .* 开始/ }));
    expect(screen.queryByText(/继续上次/)).toBeNull();
    // 存档已清空为全新进度（自动保存 effect 会把空进度写回，内容不含任何记录）
    const after = JSON.parse(localStorage.getItem('lc-studio-progress-v1') ?? '{}');
    expect(Object.keys(after.cleared ?? {}).length).toBe(0);
    expect(after.started?.['s1-not'] ?? false).toBe(false);
    expect(screen.getByText('关卡模式')).toBeTruthy(); // 回到全新主菜单
    confirmSpy.mockRestore();
  });
});
