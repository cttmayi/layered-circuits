// @vitest-environment jsdom
/**
 * 左右侧面板「展开/收起」与分组折叠（我的元件 / 电源与端口 / 我的模块）：
 *  - 组头可折叠，折叠后元件列表隐藏；
 *  - 左侧整体收起 → 元件库消失、画布腾出空间；再点展开回来；
 *  - 右侧整体收起 → 验收/属性面板隐藏，但迷你侧栏（任务墙等）仍在；
 *  - 开合选择写入 localStorage，重进工作台保持。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { goToLevel, renderApp, startJob } from './helpers';

describe('左右侧面板展开/收起', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('左侧分组可折叠：收「我的元件」后三极管不可见，再点展开恢复', () => {
    renderApp();
    startJob('非门');
    // 三个分组都在
    expect(screen.getByText('我的元件')).toBeTruthy();
    expect(screen.getByText('电源与端口')).toBeTruthy();
    expect(screen.getByText('我的模块（0）')).toBeTruthy();
    // 默认展开：元件列表可见
    expect(screen.getByText('三极管 NPN')).toBeTruthy();
    // 点组头收起
    fireEvent.click(screen.getByText('我的元件').closest('button') as HTMLButtonElement);
    expect(screen.queryByText('三极管 NPN')).toBeNull();
    expect(screen.getByText('电源与端口')).toBeTruthy(); // 其它组不受影响
    // 再点展开
    fireEvent.click(screen.getByText('我的元件').closest('button') as HTMLButtonElement);
    expect(screen.getByText('三极管 NPN')).toBeTruthy();
  });

  it('左侧整体收起：元件库消失，点边缘条展开恢复', () => {
    renderApp();
    startJob('非门');
    fireEvent.click(screen.getByRole('button', { name: '收起元件库' }));
    expect(screen.queryByText('三极管 NPN')).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开元件库' }));
    expect(screen.getByText('三极管 NPN')).toBeTruthy();
  });

  it('右侧整体收起：验收面板隐藏但迷你侧栏可用；展开恢复', async () => {
    renderApp();
    startJob('非门');
    // 右侧面板默认展开：「交付验收」出现两处（工具栏 + 验收面板）
    expect(screen.getAllByText('交付验收').length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole('button', { name: '收起右侧面板' }));
    // 验收面板没了（只剩工具栏那一处），但迷你侧栏的任务墙/组件库还在
    expect(screen.getAllByText('交付验收').length).toBe(1);
    expect(screen.getByText('任务墙')).toBeTruthy();
    // 迷你侧栏仍能开任务墙弹窗
    fireEvent.click(screen.getByText('任务墙'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: '任务墙' })).toBeTruthy());
    // 收起弹窗、展开右侧面板
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '展开右侧面板' }));
    await waitFor(() => expect(screen.getAllByText('交付验收').length).toBeGreaterThanOrEqual(2));
  });

  it('开合选择持久化：收起左侧后重进工作台仍是收起', () => {
    const first = renderApp();
    startJob('非门');
    fireEvent.click(screen.getByRole('button', { name: '收起元件库' }));
    expect(screen.queryByText('三极管 NPN')).toBeNull();
    first.unmount();
    // 重新进入（关卡已开工，直接进工作台，不再弹委托单）：localStorage 记着「左侧收起」
    render(<App />);
    goToLevel('非门');
    expect(screen.queryByText('三极管 NPN')).toBeNull();
    expect(screen.getByRole('button', { name: '展开元件库' })).toBeTruthy();
  });
});
