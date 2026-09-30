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

import { ALL_LEVELS } from '@lc/content';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PROGRESS_KEY } from '../src/level/progress';
import { renderApp, startJob } from './helpers';

// jsdom 里容器尺寸量不到，工作台会退回 200×200；相机初始为 (340,220)、缩放 1
const CAMERA = { x: 340, y: 220 };
const SIZE = 200;

const canvas = (): HTMLCanvasElement => document.querySelector('canvas') as HTMLCanvasElement;

/** 世界坐标 → 客户端坐标（jsdom 的 getBoundingClientRect 全是 0，所以直接相等） */
function screenOf(wx: number, wy: number): { clientX: number; clientY: number } {
  return {
    clientX: wx - CAMERA.x + SIZE / 2,
    clientY: wy - CAMERA.y + SIZE / 2,
  };
}

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
});

/** 关卡总数直接取内容包，避免每加一关就回来改测试 */
const LEVEL_TOTAL = ALL_LEVELS.length;

describe('M1 核心循环：手搭非门 → 校验 → 通关封装 → 解锁下一关', () => {
  it('用鼠标搭出第 1 关的标准解并通过校验，通关闭环产生可复用的【非门】模块', async () => {
    renderApp();
    startJob('非门');
    expect(screen.getByText(/委托单 · 非门/)).toBeTruthy();

    // ---- 1. 摆放元件（画布上只有关卡预置的 a / y 端口）----
    place('电阻', 280, 240); // R1 基极限流
    place('三极管 NPN', 470, 340); // Q1 共射反相
    place('电阻', 690, 180); // R2 集电极上拉
    place('VCC 电源', 690, 80);
    place('GND 地', 470, 460);

    // ---- 2. 连线（点引脚 → 再点引脚；坐标 = 元件位置 + 引脚偏移）----
    wire(66, 200, 280, 218); // a.p → R1.a（电阻引脚在上下两端）
    wire(280, 262, 444, 340); // R1.b → Q1.b
    wire(470, 314, 674, 200); // Q1.c → y.p
    wire(470, 314, 690, 202); // Q1.c → R2.b
    wire(690, 158, 690, 94); // R2.a → VCC.p
    wire(470, 366, 470, 446); // Q1.e → GND.p

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

    // 成本面板应该已经算出 6（1 三极管 + 2 电阻）
    await waitFor(
      () => {
        const rows = [...document.querySelectorAll('.kv tr')].map((tr) => tr.textContent ?? '');
        expect(rows.some((row) => row.includes('合计') && row.includes('6'))).toBe(true);
      },
      { timeout: 5000 },
    );

    // ---- 3. 交付验收 ----
    fireEvent.click(screen.getAllByText('交付验收')[0] as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText('客户验收通过！100 分')).toBeTruthy(), {
      timeout: 5000,
    });

    // 逐行对比四要素：功能 / 成本 / 关键路径都达标
    const judgeText = document.querySelector('.judge')?.textContent ?? '';
    expect(judgeText).toContain('全部符合');
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
      () => expect(screen.getByText(new RegExp(`已通关 4/${LEVEL_TOTAL}`))).toBeTruthy(),
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
