// @vitest-environment jsdom
/**
 * 触屏手势在画布上的接线（真实 App + Pointer Events）：
 *  - 单指拖动 = 平移，**不会**把命中的元件拖走
 *  - 轻点两个引脚 = 连线（触屏路径与鼠标走同一批动作函数）
 *  - 双击（两次轻点）= 双击语义：删除连线
 *  - 长按后原地松手 = 双击语义：删除连线（手机上比双击好按）
 *  - 长按后拖动 = 移动元件
 *  - 双指捏合 = 缩放（用"缩放后按新比例轻点引脚仍能命中"反证相机真的变了）
 * 鼠标路径的旧用例在 delete-wire / loop / devices 等文件里继续覆盖。
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atWorld, stubCanvasSize, unstubCanvasSize } from './camera-probe';
import { renderApp, startJob } from './helpers';

vi.mock('../src/editor/render.ts', async (importOriginal) => {
  const { withCameraProbe } = await import('./camera-probe');
  return withCameraProbe(await importOriginal<typeof import('../src/editor/render.ts')>());
});

const KEY = 'lc-studio-level-s1-not-v1';
afterEach(unstubCanvasSize);

function canvas(): HTMLCanvasElement {
  return document.querySelector('canvas') as HTMLCanvasElement;
}

/** 世界坐标 → client 坐标：用 App **当前**相机（进关自适应后相机不是固定值） */
const screenOf = atWorld;

function down(wx: number, wy: number, id: number): void {
  fireEvent.pointerDown(canvas(), {
    pointerType: 'touch',
    pointerId: id,
    isPrimary: id === 1,
    button: 0,
    buttons: 1,
    ...screenOf(wx, wy),
  });
}
function move(wx: number, wy: number, id: number): void {
  fireEvent.pointerMove(canvas(), {
    pointerType: 'touch',
    pointerId: id,
    isPrimary: id === 1,
    button: -1,
    buttons: 1,
    ...screenOf(wx, wy),
  });
}
function up(wx: number, wy: number, id: number): void {
  fireEvent.pointerUp(canvas(), {
    pointerType: 'touch',
    pointerId: id,
    isPrimary: id === 1,
    button: 0,
    buttons: 0,
    ...screenOf(wx, wy),
  });
}

let nextId = 1;
/** 轻点一下（按下 → 抬起，换一个 pointerId，跟真机一样） */
function tap(wx: number, wy: number): void {
  const id = nextId++;
  down(wx, wy, id);
  up(wx, wy, id);
}
/** 单指拖动：从 (ax, ay) 拖到 (bx, by)（都是世界坐标，屏幕位移按当前相机换算） */
function drag(ax: number, ay: number, bx: number, by: number): void {
  const id = nextId++;
  down(ax, ay, id);
  move((ax + bx) / 2, (ay + by) / 2, id);
  move(bx, by, id);
  up(bx, by, id);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitWires(count: number): Promise<void> {
  await waitFor(() => expect(readDoc().wires?.length).toBe(count), { timeout: 5000 });
}

interface SavedSym {
  id: string;
  x: number;
  y: number;
  locked?: boolean;
}
interface SavedDoc {
  syms?: SavedSym[];
  wires?: unknown[];
}
function readDoc(): SavedDoc {
  return JSON.parse(localStorage.getItem(KEY) ?? '{}') as SavedDoc;
}
/** 关卡自带的端口是 locked 的，这里只数玩家自己放上去的元件 */
function placedSyms(): SavedSym[] {
  return (readDoc().syms ?? []).filter((s) => !s.locked);
}
async function waitPlaced(count: number): Promise<SavedSym[]> {
  await waitFor(() => expect(placedSyms().length).toBe(count), { timeout: 5000 });
  return placedSyms();
}
/** 点元件库条目 → 轻点画布放置（触屏路径：pointerdown 即落子） */
async function place(label: string, wx: number, wy: number): Promise<void> {
  fireEvent.click(screen.getByText(label).closest('button') as HTMLButtonElement);
  const id = nextId++;
  down(wx, wy, id);
  up(wx, wy, id);
}

beforeEach(() => {
  localStorage.clear();
  stubCanvasSize(1280, 754); // jsdom 兜底只有 200×200：给个真实画布尺寸，世界坐标才落在画布内
});

describe('触屏手势：画布接线', () => {
  it('单指拖动 = 平移：命中的元件不会被拖走，也不会拉出线', async () => {
    renderApp();
    startJob('非门');
    await place('电阻', 690, 180);
    const before = (await waitPlaced(1))[0];

    drag(690, 180, 760, 240); // 从元件身上开始单指拖动
    await sleep(600); // 等自动存档

    const after = placedSyms();
    expect(after[0]?.x).toBe(before?.x);
    expect(after[0]?.y).toBe(before?.y);
    expect(readDoc().wires?.length ?? 0).toBe(0);
  });

  it('轻点两个引脚 = 连线', async () => {
    renderApp();
    startJob('非门');
    await place('电阻', 40, 140); // R：引脚在上下两端（摆在预置 VCC 轨正下方，且不压到输入端口 a）
    await waitPlaced(1);

    // 第 ⑪ 轮起关卡模式不再提供「电源与端口」组，用关卡**预置**的 VCC 轨（世界 (40,60)，引脚在下方 +14）；
    // 走线实测是一条直线 (40,118)→(40,74)，所以线中点就是 (40,96)
    tap(40, 118); // R.a
    tap(40, 74); // 预置 VCC.p
    await waitWires(1);
  });

  it('双击（两次轻点）= 双击语义：删除连线', async () => {
    renderApp();
    startJob('非门');
    await place('电阻', 40, 140); // 摆在预置 VCC 轨正下方 → 走线是一条直线，中点好命中
    await waitPlaced(1);
    tap(40, 118);
    tap(40, 74); // 预置 VCC.p
    await waitWires(1);

    tap(40, 96); // 这条线的中点 (40,118)–(40,74)
    tap(40, 96); // 320ms 内的第二次轻点 = 双击
    await waitWires(0);
  });

  it('长按后原地松手 = 双击语义：删除连线', async () => {
    renderApp();
    startJob('非门');
    await place('电阻', 40, 140);
    await waitPlaced(1);
    tap(40, 118);
    tap(40, 74); // 预置 VCC.p
    await waitWires(1);

    const id = nextId++;
    down(40, 96, id); // 按住这条线的中点
    await sleep(500); // 越过 420ms 长按阈值
    up(40, 96, id); // 原地松手
    await waitWires(0);
  });

  it('长按后拖动 = 移动元件（单指直接拖只会平移，见第一个用例）', async () => {
    renderApp();
    startJob('非门');
    await place('电阻', 690, 180);
    const before = (await waitPlaced(1))[0];

    const id = nextId++;
    down(690, 180, id);
    await sleep(500); // 长按就绪
    move(710, 180, id); // 长按后拖动 → 拖元件
    move(730, 180, id);
    up(730, 180, id);
    await sleep(600);

    const after = placedSyms()[0];
    expect(after?.x).toBe((before?.x ?? 0) + 40);
    expect(after?.y).toBe(before?.y);
  });

  it('双指捏合 = 缩放：缩放后按新比例轻点引脚仍能命中并连线', async () => {
    renderApp();
    startJob('非门');
    await place('电阻', 690, 180);
    await place('电阻', 690, 300); // 缩放后预置电源轨会跑出画布，所以这条用两个自己放的电阻
    await waitPlaced(2);

    // 两指拉开一倍 → 缩放 ×2（进关自适应后的 scale 不确定，所以下面按"当前相机"点引脚）
    const f1 = nextId++;
    const f2 = nextId++;
    down(290, 220, f1);
    down(390, 220, f2);
    move(240, 220, f1); // 手指 1 左移：距离 150
    move(440, 220, f2); // 手指 2 右移：距离 200 → 共放大 1.5×4/3 = 2×
    up(240, 220, f1);
    up(440, 220, f2);

    // 缩放后引脚在屏幕上的位置变了：按**缩放后的相机**轻点，仍应命中两个引脚并连成一条线
    const id1 = nextId++;
    down(690, 158, id1);
    up(690, 158, id1);
    const id2 = nextId++;
    down(690, 278, id2);
    up(690, 278, id2);
    await waitWires(1);
  });
});
