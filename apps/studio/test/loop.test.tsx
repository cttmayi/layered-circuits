// @vitest-environment jsdom
/**
 * M1 验收：**核心循环真的可玩**。
 *
 * 这个用例完全用鼠标事件走一遍玩家的操作路径：
 *   进入第 1 关 → 从元件库拖 5 个元件 → 点引脚连 6 条线 → 点「交付验收」→ 看到通过
 *   → 验收通过自动封装 → 组件库多出【非门】、成绩写入存档、下一关解锁。
 *
 * 换句话说：它不是在测某个函数，而是在测「这个游戏能不能按设计玩下去」。
 */

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROGRESS_KEY } from '../src/level/progress';
import { atWorld, stubCanvasSize, unstubCanvasSize } from './camera-probe';
import { renderApp, startJob, topBarTaskTitle } from './helpers';

vi.mock('../src/editor/render.ts', async (importOriginal) => {
  const { withCameraProbe } = await import('./camera-probe');
  return withCameraProbe(await importOriginal<typeof import('../src/editor/render.ts')>());
});

const canvas = (): HTMLCanvasElement => document.querySelector('canvas') as HTMLCanvasElement;

/** 世界坐标 → client 坐标：用 App 当前相机（进关自适应后相机不是固定值了） */
const screenOf = atWorld;
afterEach(unstubCanvasSize);

function clickWorld(wx: number, wy: number): void {
  // fireEvent 会把状态更新包进 act()，这样「点元件库 → 点画布」之间的状态才是已提交的
  fireEvent.mouseDown(canvas(), { button: 0, ...screenOf(wx, wy) });
}

/** 从元件库点一个元件，然后在画布上落点 */
function place(paletteLabel: string, wx: number, wy: number): void {
  fireEvent.click(screen.getByText(paletteLabel).closest('button') as HTMLButtonElement);
  clickWorld(wx, wy);
}

/** 点两个引脚连成一条线 */
function wire(ax: number, ay: number, bx: number, by: number): void {
  clickWorld(ax, ay);
  clickWorld(bx, by);
}

beforeEach(() => {
  localStorage.clear();
  stubCanvasSize(1280, 754); // jsdom 兜底只有 200×200：给个真实画布尺寸，世界坐标才落在画布内
});

/** 关卡总数直接取内容包，避免每加一关就回来改测试 */

describe('M1 核心循环：手搭非门 → 校验 → 通关封装 → 解锁下一关', () => {
  it('用鼠标搭出第 1 关的标准解并通过校验，通关闭环产生可复用的【非门】模块', async () => {
    renderApp();
    startJob('非门');
    expect(topBarTaskTitle()).toBe('任务 · 非门'); // 顶栏任务块（同名文字在任务对话框标题里也有）

    // ---- 1. 摆放元件（画布上预置的是 a / y 端口**和 VCC/GND 电源轨**；第 ⑪ 轮起电平关模式
    //         的元件库不再提供「电源与端口」组，所以电源轨只能用关卡预置的那两条）----
    place('电阻', 280, 240); // R1 基极限流
    place('三极管 NPN', 470, 340); // Q1 共射反相
    place('电阻', 690, 180); // R2 集电极上拉

    // ---- 2. 连线（点引脚 → 再点引脚；坐标 = 元件位置 + 引脚偏移）----
    wire(66, 200, 280, 218); // a.p → R1.a（电阻引脚在上下两端）
    wire(280, 262, 444, 340); // R1.b → Q1.b
    wire(470, 314, 674, 200); // Q1.c → y.p
    wire(470, 314, 690, 202); // Q1.c → R2.b
    wire(690, 158, 40, 74); // R2.a → 预置 VCC.p（世界 (40,60)，引脚在下方 +14）
    wire(470, 366, 700, 46); // Q1.e → 预置 GND.p（世界 (700,60)，引脚在上方 -14）

    // 先确认 6 条线真的连上了（坐标写错时在这里就报错，而不是绕到判定结果里）
    await waitFor(
      () => {
        const saved = JSON.parse(localStorage.getItem('lc-studio-level-s1-not-v1') ?? '{}') as {
          wires?: unknown[];
        };
        expect(saved.wires?.length).toBe(6);
      },
      { timeout: 5000 },
    );

    // 自动仿真跑完了：画布图例出现（只有拿到仿真快照才渲染）。
    // 注：原来这里读的是右侧面板成本表里的「合计 6」，成本表已随右侧面板整块移除；
    // 成本照样算得很准 —— 下面验收弹窗的判定结果里就有「材料费 3 / 款项 6」（6 半 = 3 元）
    await waitFor(() => expect(document.querySelector('.legend')).toBeTruthy(), { timeout: 5000 });

    // ---- 3. 交付验收 ----
    fireEvent.click(screen.getAllByText('交付验收')[0] as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText('客户验收通过！100 分')).toBeTruthy(), {
      timeout: 5000,
    });

    // 逐行对比四要素：功能 / 成本 / 关键路径都达标
    const judgeText = document.querySelector('.judge')?.textContent ?? '';
    expect(judgeText).toContain('全部符合');
    expect(judgeText).toContain('材料费');
    expect(judgeText).toContain('6 / 款项 12'); // 1 三极管 + 2 电阻 = 12 半 = 6 元；款项 24 半 = 12 元
    expect(judgeText).toContain('1.50 ns');
    expect(judgeText).toContain('客户验收通过！100 分');
    // 判定面板逐行对比：0→1 与 1→0 都是 ✓
    const judged = [...document.querySelectorAll('.judge .truth tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    );
    expect(judged).toEqual([
      ['✓', '0', '1', '1'],
      ['✓', '1', '0', '0'],
    ]);
    // 尝试次数被记录（失败/成功都算一次尝试）
    const attempts = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}').attempts ?? {};
    expect(attempts['s1-not']).toBe(1);

    // ---- 4. 验收通过 → 自动封装（没有「交付并封装」按钮，点了验收就直接封装结算） ----
    await waitFor(
      () => {
        const raw = localStorage.getItem(PROGRESS_KEY);
        expect(raw).toBeTruthy();
        const progress = JSON.parse(raw as string) as {
          cleared: Record<string, { score: number; bestCostHalf: number }>;
          library: Array<{ name: string; costHalf: number }>;
        };
        expect(progress.cleared['s1-not']?.score).toBe(100);
        expect(progress.library.map((m) => m.name)).toEqual(['非门']);
        expect(progress.library[0]?.costHalf).toBe(12); // 成本 6（半单位 12）
      },
      { timeout: 5000 },
    );

    // 交付后的结算页是中央弹窗（验收报告），点「关掉」留在本关
    await waitFor(() => expect(screen.getByText(/验收报告 · 非门/)).toBeTruthy(), {
      timeout: 5000,
    });
    expect(document.querySelector('.modal-box')).toBeTruthy();

    // ---- 5. 组件库与解锁状态反馈到界面 ----
    await waitFor(
      () => expect(screen.queryByText(/已通关/)).toBeNull(), // 顶栏进度显示已按用户要求移除
      { timeout: 5000 },
    );
    // 封装出的【非门】出现在元件库「我的模块」里，成本 6，可以直接拖到下一关复用
    const paletteModules = [...document.querySelectorAll('.palette .palette-item')].filter((b) =>
      b.textContent?.includes('非门'),
    );
    expect(paletteModules.length).toBe(1);
    expect(paletteModules[0]?.textContent).toContain('成本 6');
    expect(paletteModules[0]?.textContent).toMatch(/1 入 \/ 1 出/);

    // ---- 6. 关卡地图：非门已通关（cleared），与门点亮为新单（不再是锁定灰态）----
    fireEvent.click(screen.getByText('← 返回地图'));
    await waitFor(() => expect(screen.getByText('与门')).toBeTruthy(), { timeout: 5000 });
    const notNode = screen.getByText('非门').closest('button');
    const andNode = screen.getByText('与门').closest('button');
    expect(notNode?.getAttribute('class')).toContain('cleared');
    expect(andNode?.getAttribute('class')).toContain('new');
  }, 20_000);
});
