// @vitest-environment jsdom
/**
 * 元件库「展开/收起」与分组折叠（关卡模式下是「我的元件 / 我的模块」两组 ——
 * 「电源与端口」按用户第 ⑪ 轮要求**只在自由模式渲染**，契约与依据见 palette-power-group.test.tsx）：
 *  - 组头可折叠，折叠后元件列表隐藏；
 *  - 元件库整体收起 → 元件库消失、画布腾出空间；再点展开回来；
 *  - **右侧「验收/属性」面板已按用户要求整块移除**（连同右侧开合手柄与右侧避让逻辑），
 *    所以这里只断言「右侧那套确实不在 DOM 里、顶栏判定入口还在」；
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
    // 关卡模式：只有「我的元件 / 我的模块」两组，「电源与端口」整组不渲染
    expect(screen.getByText('我的元件')).toBeTruthy();
    expect(screen.getByText('我的模块（0）')).toBeTruthy();
    expect(screen.queryByText('电源与端口')).toBeNull();
    expect(screen.queryByText('VCC 电源')).toBeNull();
    // 默认展开：元件列表可见
    expect(screen.getByText('三极管 NPN')).toBeTruthy();
    // 点组头收起
    fireEvent.click(screen.getByText('我的元件').closest('button') as HTMLButtonElement);
    expect(screen.queryByText('三极管 NPN')).toBeNull();
    expect(screen.getByText('我的模块（0）')).toBeTruthy(); // 其它组不受影响
    expect(screen.queryByText('电源与端口')).toBeNull(); // 关卡模式一如既往不渲染该组
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

  it('右侧面板已整块移除：DOM 里没有验收/属性面板，也没有右侧开合手柄；判定入口留在顶栏', async () => {
    renderApp();
    startJob('非门');
    // 面板本身、它的手柄、以及面板里的成本表（材料费）都不在 DOM 里
    expect(document.querySelector('.side')).toBeNull();
    expect(document.querySelector('.edge-strip.right')).toBeNull();
    expect(screen.queryByRole('button', { name: /右侧面板/ })).toBeNull();
    expect(screen.queryByText('材料费')).toBeNull();
    // 判定入口不能丢：顶栏「交付验收」还在、可点（结果改在弹窗里给）
    const judge = screen.getByText('交付验收') as HTMLButtonElement;
    expect(judge.disabled).toBe(false);
    fireEvent.click(judge);
    // 点下去能弹出验收结果弹窗（逐行对比 / 问题清单）
    await waitFor(() => expect(document.querySelector('.modal-box .judge')).toBeTruthy(), {
      timeout: 5000,
    });
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
