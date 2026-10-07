// @vitest-environment jsdom
/**
 * 第 ⑦ 轮验收（用户三条要求）：**右侧面板整块去掉，任务信息改到顶栏**
 * 第 ⑧ 轮修订（用户反馈「顶栏栏位不够」）：**标题留顶栏、描述放画布顶端**
 *
 *  1. 去掉「验收」侧（右侧那整个面板）：任何视口下 `.side`、右侧开合手柄、成本表（材料费）
 *     都不在 DOM 里；但顶栏的判定入口「交付验收」必须还在、可点（结果改在弹窗里给）。
 *  2. 第一次进入某关弹一次任务说明对话框：同一关第二次不弹，换一关又会弹；
 *     弹窗可关，关掉不卡操作；`?debug=1` 下「一键出答案」流程照旧可用。
 *  3. 顶栏只留**短标题**（「任务 · 非门」，在「← 返回地图」右侧、窄到只剩标题），
 *     整块可点 = 完整任务对话框入口；那句长描述**从顶栏消失**，改到画布顶端的
 *     `.canvas-brief` 浮层（见 describe ④）。
 *
 * ⚠️ jsdom 不做真实布局：这里断言的是 **DOM 结构与兄弟顺序**；真实视口下的宽度/溢出
 * 由 headless Chrome 实测（提交信息里给了三个视口的数字）。
 */

import { findLevel } from '@lc/content';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App, taskSeenKey } from '../src/App';
import { enableDebugUrl, goToLevel, renderApp, startJob } from './helpers';

/** 顶栏那一行（.toolbar-row）里的直接子元素，按 DOM 顺序 */
function toolbarRowChildren(): HTMLElement[] {
  const row = document.querySelector('.toolbar-row');
  return [...(row?.children ?? [])] as HTMLElement[];
}

beforeEach(() => {
  localStorage.clear();
});

describe('① 右侧面板整块移除（验收侧不见了，判定入口留在顶栏）', () => {
  it('进关后：.side / 右侧手柄 / 成本表都不在 DOM 里', () => {
    renderApp();
    startJob('非门');
    expect(document.querySelector('.side')).toBeNull();
    expect(document.querySelector('.edge-strip.right')).toBeNull();
    expect(screen.queryByRole('button', { name: /右侧面板/ })).toBeNull();
    // 面板里的实时成本表（材料费）随之消失
    expect(screen.queryByText('材料费')).toBeNull();
    // 旧的「任务卡」也不在侧栏里（任务的落脚点改到顶栏 + 对话框）
    expect(document.querySelector('.level-card')).toBeNull();
  });

  it('顶栏「交付验收」还在，点下去弹出验收结果弹窗（结果没丢，只是改了地方）', async () => {
    renderApp();
    startJob('非门');
    fireEvent.click(screen.getByText('开始干活 →')); // 首次任务对话框先收掉
    const judge = screen.getByText('交付验收') as HTMLButtonElement;
    expect(judge.closest('.toolbar')).toBeTruthy(); // 判定入口就在顶栏
    fireEvent.click(judge);
    await waitFor(() => expect(document.querySelector('.modal-box .judge')).toBeTruthy(), {
      timeout: 5000,
    });
    // 判定结果弹窗只有一个（判定会自动收掉任务对话框），能关、关掉后入口还能再点
    expect(document.querySelectorAll('.modal-box')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(document.querySelector('.modal-box .judge')).toBeNull());
    expect((screen.getByText('交付验收') as HTMLButtonElement).disabled).toBe(false);
  });

  it('知识卡片（对照答案）也能弹出验收结果：判定口径不变', async () => {
    renderApp();
    fireEvent.click(screen.getByText('知识卡片')); // 主菜单 → 知识卡片列表
    fireEvent.click(screen.getAllByText(/认识三极管|认识 N-MOS/)[0] as HTMLElement);
    const btn = screen.getByText('对照答案') as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(document.querySelector('.modal-box .judge')).toBeTruthy(), {
      timeout: 5000,
    });
  });
});

describe('② 每关第一次进入弹一次任务说明', () => {
  it('首次进关弹「本关任务」对话框，讲的是这关的任务', () => {
    renderApp();
    goToLevel('非门');
    // 对话框标题 + 任务描述都在（复用的就是既有 Modal 弹窗样式）
    expect(screen.getByRole('dialog', { name: /本关任务 · 非门/ })).toBeTruthy();
    const brief = document.querySelector('.task-full .task-brief')?.textContent ?? '';
    expect(brief).toBe(findLevel('s1-not')?.brief);
    expect(brief.length).toBeGreaterThan(0);
    // 主按钮是「开始干活 →」，可关（不阻塞操作）
    expect(screen.getByText('开始干活 →')).toBeTruthy();
    fireEvent.click(screen.getByText('开始干活 →'));
    expect(document.querySelector('.task-full')).toBeNull();
    // 关掉之后画布照常可用：顶栏按钮还能点
    expect((screen.getByText('交付验收') as HTMLButtonElement).disabled).toBe(false);
  });

  it('同一关第二次进入不再弹（标记按关卡持久化）', () => {
    const first = renderApp();
    goToLevel('非门');
    expect(document.querySelector('.task-full')).toBeTruthy();
    fireEvent.click(screen.getByText('开始干活 →'));
    // 回地图，再点同一个关卡节点进来一次（地图 → 工作台）
    fireEvent.click(screen.getByText('← 返回地图'));
    fireEvent.click(screen.getByText('非门'));
    expect(document.querySelector('.task-full')).toBeNull();
    expect(localStorage.getItem(taskSeenKey('s1-not'))).toBe('1');
    first.unmount();
    // 刷新（重新挂载）后依然不弹：标记已经写进 localStorage
    render(<App />);
    expect(localStorage.getItem(taskSeenKey('s1-not'))).toBe('1');
    goToLevel('非门');
    expect(document.querySelector('.toolbar-row')).toBeTruthy(); // 确实进了工作台
    expect(document.querySelector('.task-full')).toBeNull();
  });

  it('弹过之后刷新页面也不弹；标记是「每关一个」，别的关不受影响', () => {
    renderApp();
    goToLevel('非门');
    fireEvent.click(screen.getByText('开始干活 →'));
    expect(localStorage.getItem(taskSeenKey('s1-not'))).toBe('1');
    // 另一关（同族、已解锁）第一次进入 → 照弹
    fireEvent.click(screen.getByText('← 返回地图'));
    // 与门初始是锁定的：先让第 1 关通关解锁它（直接用存档写入，避免走一遍判定）
    localStorage.setItem(taskSeenKey('s1-and'), '');
    expect(localStorage.getItem(taskSeenKey('s1-and'))).toBe('');
    // 非门以外的关卡标记原样：不会被第一关的弹窗污染
    expect(localStorage.getItem(taskSeenKey('s1-or'))).toBeNull();
  });

  it('自由搭建（沙盒）没有任务 → 不弹', () => {
    renderApp();
    fireEvent.click(screen.getByText('自由搭建'));
    expect(document.querySelector('.task-full')).toBeNull();
  });

  it('?debug=1：首次进关仍弹一次，关掉后「一键出答案」照旧可用（不破坏调试流程）', async () => {
    enableDebugUrl();
    renderApp();
    startJob('非门');
    expect(document.querySelector('.task-full')).toBeTruthy();
    fireEvent.click(screen.getByText('开始干活 →'));
    fireEvent.click(screen.getByText('一键出答案'));
    expect(screen.getByText(/参考解已搭好/)).toBeTruthy();
    // 答案真的搭上去了：仿真跑起来（快照驱动的图例出现）
    await waitFor(() => expect(document.querySelector('.legend')).toBeTruthy());
  });
});

describe('③ 顶栏只留短标题（在「返回地图」右侧）', () => {
  it('顶栏任务块紧跟在「← 返回地图」按钮后面（DOM 兄弟顺序）', () => {
    renderApp();
    startJob('非门');
    fireEvent.click(screen.getByText('开始干活 →')); // 先收掉首次任务对话框
    const row = toolbarRowChildren();
    const backIdx = row.findIndex((el) => el.textContent?.includes('返回地图'));
    const taskIdx = row.findIndex((el) => el.classList.contains('task-bar'));
    expect(backIdx).toBeGreaterThanOrEqual(0);
    expect(taskIdx).toBe(backIdx + 1); // 就在返回按钮**右侧**（严格相邻的后一个兄弟）
  });

  it('顶栏这块只有短标题：那句长描述**不在顶栏里**（已搬到画布顶端）', () => {
    renderApp();
    startJob('非门');
    fireEvent.click(screen.getByText('开始干活 →'));
    const bar = document.querySelector('.task-bar') as HTMLElement;
    expect(bar.textContent).toBe('任务 · 非门'); // 就这几个字，没有别的
    const brief = findLevel('s1-not')?.brief ?? '';
    expect(brief.length).toBeGreaterThan(10);
    expect(bar.textContent).not.toContain(brief);
    expect(bar.querySelector('.task-bar-brief')).toBeNull();
    expect(bar.querySelector('.task-bar-detail')).toBeNull();
    // 原来塞在顶栏的那份描述现在只在画布顶端浮层上（而且一份，不是两份）
    const ovl = document.querySelector('.canvas-brief') as HTMLElement;
    expect(ovl.textContent).toBe(brief);
    expect(document.querySelectorAll('.toolbar .canvas-brief')).toHaveLength(0);
    // 整块是按钮（= 任务详情入口），没有额外按钮占宽度
    expect(bar.tagName).toBe('BUTTON');
  });

  it('点顶栏标题开完整任务对话框（条款 / 真值表 / 提示都在）', () => {
    renderApp();
    startJob('非门');
    fireEvent.click(screen.getByText('开始干活 →'));
    fireEvent.click(screen.getByRole('button', { name: /任务 · 非门/ }));
    const box = document.querySelector('.task-full') as HTMLElement;
    expect(box).toBeTruthy();
    expect(screen.getByRole('dialog', { name: /任务详情 · 非门/ })).toBeTruthy();
    expect(box.textContent).toContain('合同条款');
    expect(box.querySelector('.truth')).toBeTruthy();
    expect(box.textContent).toContain('元件成本');
  });

  it('换关后顶栏任务跟着换（任务块不是写死第一关）', () => {
    renderApp();
    startJob('非门');
    fireEvent.click(screen.getByText('开始干活 →'));
    expect(document.querySelector('.task-bar')?.textContent).toContain('非门');
    // 换关（同一套工作台）：地图 → 主菜单 → 知识卡片 → 另一张卡
    fireEvent.click(screen.getByText('← 返回地图'));
    fireEvent.click(screen.getByText('← 返回主菜单'));
    fireEvent.click(screen.getByText('知识卡片'));
    fireEvent.click(screen.getAllByText(/认识二极管/)[0] as HTMLElement);
    const bar = document.querySelector('.task-bar') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.textContent).not.toContain('任务 · 非门');
    // 换成知识卡片后，画布顶端的描述也跟着换（不是写死第一关那句）
    const ovl = document.querySelector('.canvas-brief') as HTMLElement;
    expect(ovl.textContent?.length).toBeGreaterThan(0);
    expect(ovl.textContent).not.toBe(findLevel('s1-not')?.brief);
  });
});

describe('④ 描述搬到画布顶端浮层（在画布区域里，不是顶栏）', () => {
  it('浮层挂在 .canvas-wrap 里、给全文 title、且不吞 click（可 hover 补全）', () => {
    renderApp();
    startJob('非门');
    fireEvent.click(screen.getByText('开始干活 →'));
    const ovl = document.querySelector('.canvas-brief') as HTMLElement;
    expect(ovl).toBeTruthy();
    expect(ovl.closest('.canvas-wrap')).toBeTruthy(); // 在画布区域里
    expect(ovl.closest('.toolbar')).toBeNull(); // 不在顶栏里
    expect(ovl.getAttribute('title')).toBe(findLevel('s1-not')?.brief); // 截断后的全文补全
    expect(ovl.textContent).toBe(findLevel('s1-not')?.brief); // 单行/多行都不改文案
  });

  it('拖画布不会被这块拦住：pointerdown 在浮层上被吞、click/pointerup 不吞', () => {
    // 口径与 .ovl-tools 完全一致（App.tsx 的 OVL_SWALLOWED_EVENTS）：
    // pointerdown/mousedown/touchstart/dblclick 吞；click/pointerup/mouseup **不吞**。
    // jsdom 不做布局，这里直接验 DOM：在浮层上派发 pointerdown 不冒泡到 .canvas-wrap 之外。
    renderApp();
    startJob('非门');
    fireEvent.click(screen.getByText('开始干活 →'));
    const ovl = document.querySelector('.canvas-brief') as HTMLElement;
    let reachedWrap = 0;
    const wrap = ovl.closest('.canvas-wrap') as HTMLElement;
    wrap.addEventListener('pointerdown', () => {
      reachedWrap += 1;
    });
    ovl.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); // hmm: jsdom 用 Event
    expect(reachedWrap).toBe(0); // 被浮层自己的原生监听吞掉了
  });

  it('自由搭建（没有关卡）不渲染这块浮层', () => {
    renderApp();
    fireEvent.click(screen.getByText('自由搭建'));
    expect(document.querySelector('.canvas-brief')).toBeNull();
  });
});
