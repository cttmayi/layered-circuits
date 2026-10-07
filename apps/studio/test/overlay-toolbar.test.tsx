// @vitest-environment jsdom
/**
 * 顶栏那四个按钮（撤销 / 重做 / 旋转 / 删除）搬到**画布浮动工具条**之后的行为：
 *
 *  1. 撤销/重做常驻画布左下角的浮动条（.ovl-tools），点它们真的入撤销栈/重做栈；
 *  2. 旋转/删除只在**有选中**（元件或连线，口径就是 selection / selectedWires）时出现，
 *     没选中 → 这两个按钮**根本不渲染**（不是置灰）；
 *  3. 顶栏（.toolbar）里再没有这四个按钮；
 *  4. 浮动条吞掉自己的 pointerdown（硬约束：别把点按钮当成画布平移/连线的手势起手）；
 *  5. 定位纯函数（layout/overlay.ts）在对象贴边时把它夹回画布可视区。
 *
 * ⚠️ 老实说清楚：jsdom **不做真实排版**（rect 恒为 0、宽高恒为 0），所以这里的坐标是无意义的；
 * 真实的尺寸/重叠/溢出由 headless Chrome + CDP 实测（见提交信息与 overlay-toolbar 的实测报告）。
 * 这一份守的是**行为与结构**：按钮在哪个容器里、点了真的生效、没选中时真的不渲染。
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc } from '../src/editor/model';
import type { Camera } from '../src/editor/render';
import { placeFloatingBar, selectionAnchor } from '../src/layout/overlay';
import { atWorld, stubCanvasSize, unstubCanvasSize } from './camera-probe';
import { renderApp, startJob } from './helpers';

vi.mock('../src/editor/render.ts', async (importOriginal) => {
  const { withCameraProbe } = await import('./camera-probe');
  return withCameraProbe(await importOriginal<typeof import('../src/editor/render.ts')>());
});

const KEY = 'lc-studio-level-s1-not-v1';

function canvas(): HTMLCanvasElement {
  return document.querySelector('canvas') as HTMLCanvasElement;
}
/** 世界坐标 → client 坐标：用 App 当前相机（进关自适应后相机不是固定值了） */
const screenOf = atWorld;
afterEach(unstubCanvasSize);
function clickWorld(wx: number, wy: number): void {
  fireEvent.mouseDown(canvas(), { button: 0, ...screenOf(wx, wy) });
}
/** 元件库点一下 + 画布点一下 = 放下一个元件（放下后它自己是选中的，见 App.placeAt） */
function place(label: string, wx: number, wy: number): void {
  fireEvent.click(screen.getByText(label).closest('button') as HTMLButtonElement);
  clickWorld(wx, wy);
}

interface SavedSym {
  id: string;
  rot?: number;
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
async function waitPlaced(count: number): Promise<void> {
  await waitFor(() => expect(placedSyms().length).toBe(count), { timeout: 5000 });
}

/** 浮动条按钮（按可访问名/文本找，名字与顶栏时逐字一致） */
const undoBtn = (): HTMLElement => screen.getByRole('button', { name: '撤销' });
const redoBtn = (): HTMLElement => screen.getByRole('button', { name: '重做' });
const rotateBtn = (): HTMLElement | null => screen.queryByRole('button', { name: '旋转 (R)' });
const deleteBtn = (): HTMLElement | null => screen.queryByRole('button', { name: '删除' });

beforeEach(() => {
  localStorage.clear();
  stubCanvasSize(1280, 754); // jsdom 兜底只有 200×200：给个真实画布尺寸，世界坐标才落在画布内
});

describe('画布浮动工具条：撤销 / 重做常驻左下角', () => {
  it('两个按钮在画布的浮动条里，不在顶栏里', () => {
    renderApp();
    startJob('非门');

    const tools = document.querySelector('.ovl-tools') as HTMLElement;
    expect(tools).toBeTruthy();
    // 落在画布容器内（绝对定位于画布左下角），而不是 .body 的直接子元素
    // —— mobile-layout.test.tsx 里 bodyChildren() 的契约不能被打乱
    expect(tools.closest('.canvas-wrap')).toBeTruthy();
    expect(tools.parentElement?.className).toBe('canvas-wrap');
    expect(within(tools).getByRole('button', { name: '撤销' })).toBeTruthy();
    expect(within(tools).getByRole('button', { name: '重做' })).toBeTruthy();
    // 浮动条本身是竖排的（role=toolbar + aria-orientation），按钮是它的直接子元素
    expect(tools.getAttribute('aria-orientation')).toBe('vertical');

    // 顶栏里这四个按钮一个都不剩
    const toolbar = document.querySelector('.toolbar') as HTMLElement;
    for (const name of ['撤销', '重做', '旋转 (R)', '删除']) {
      expect(within(toolbar).queryByRole('button', { name })).toBeNull();
    }
    expect(toolbar.textContent).not.toContain('旋转');
  });

  it('点了真的生效：放下元件 → 撤销回退 → 重做恢复（栈空时置灰）', async () => {
    renderApp();
    startJob('非门');
    // 刚进关：撤销栈是空的 → 置灰（与顶栏时同一套 disabled 语义）
    expect((undoBtn() as HTMLButtonElement).disabled).toBe(true);
    expect((redoBtn() as HTMLButtonElement).disabled).toBe(true);

    place('电阻', 690, 180);
    await waitPlaced(1);
    expect((undoBtn() as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(undoBtn());
    await waitPlaced(0); // 撤销真的把元件拿掉了

    fireEvent.click(redoBtn());
    await waitPlaced(1); // 重做又回来了
  });

  it('拖动元件 / 平移画布时浮动条淡出，手势一停就淡回来', () => {
    renderApp();
    startJob('非门');
    const tools = document.querySelector('.ovl-tools') as HTMLElement;
    expect(tools.className).not.toContain('is-busy');

    // 鼠标：空白处按下 → 拖过 3px 阈值 = 平移
    fireEvent.mouseDown(canvas(), { button: 0, ...screenOf(600, 300) });
    fireEvent.mouseMove(canvas(), { button: 0, ...screenOf(640, 300) });
    expect(tools.className).toContain('is-busy');

    fireEvent.mouseUp(canvas(), { button: 0, ...screenOf(640, 300) });
    expect(tools.className).not.toContain('is-busy');
  });

  it('浮动条吞掉自己的 pointerdown（不冒泡到画布容器）', () => {
    renderApp();
    startJob('非门');
    const wrap = document.querySelector('.canvas-wrap') as HTMLElement;
    let bubbled = 0;
    const spy = (): void => {
      bubbled += 1;
    };
    wrap.addEventListener('pointerdown', spy);
    try {
      fireEvent.pointerDown(undoBtn(), { pointerType: 'touch', pointerId: 1, isPrimary: true });
      fireEvent.pointerDown(undoBtn(), { pointerType: 'mouse', button: 0, buttons: 1 });
      expect(bubbled).toBe(0);
    } finally {
      wrap.removeEventListener('pointerdown', spy);
    }
    // 另外：浮动条不是 <canvas> 的后代，画布自己的手势处理器根本看不到它
    expect(undoBtn().closest('canvas')).toBeNull();
  });
});

describe('画布浮动工具条：旋转 / 删除只在有选中时出现', () => {
  it('没选中 → 两个按钮都不渲染（不是置灰）', () => {
    renderApp();
    startJob('非门');
    clickWorld(500, 300); // 点空白处：清掉选中
    expect(rotateBtn()).toBeNull();
    expect(deleteBtn()).toBeNull();
    expect(document.querySelector('.ovl-sel')).toBeNull();
    // 撤销/重做仍在（常驻）
    expect(undoBtn()).toBeTruthy();
    expect(redoBtn()).toBeTruthy();
  });

  it('选中一个元件 → 旋转/删除出现且都能用', async () => {
    renderApp();
    startJob('非门');
    expect(document.querySelector('.ovl-sel')).toBeNull();

    place('电阻', 690, 180); // 放下即是选中状态
    await waitPlaced(1);
    const sel = document.querySelector('.ovl-sel') as HTMLElement;
    expect(sel).toBeTruthy();
    expect(sel.closest('.canvas-wrap')).toBeTruthy();
    expect(rotateBtn()).toBeTruthy();
    expect(deleteBtn()).toBeTruthy();

    // 旋转：rot 0 → 1
    expect(placedSyms()[0]?.rot ?? 0).toBe(0);
    fireEvent.click(rotateBtn() as HTMLElement);
    await waitFor(() => expect(placedSyms()[0]?.rot).toBe(1), { timeout: 5000 });

    // 删除：元件没了，小条也跟着消失（选中被清空）
    fireEvent.click(deleteBtn() as HTMLElement);
    await waitPlaced(0);
    expect(document.querySelector('.ovl-sel')).toBeNull();
    expect(rotateBtn()).toBeNull();
    expect(deleteBtn()).toBeNull();
  });

  it('选中一条连线 → 出现删除（旋转与顶栏时一样对连线置灰）', async () => {
    renderApp();
    startJob('非门');
    place('电阻', 40, 140); // R：引脚在上下两端，摆在预置 VCC 轨正下方（不压到输入端口 a）
    // 第 ⑪ 轮起关卡模式不再提供「电源与端口」组，改用关卡**预置**的 VCC 轨（世界 (40,60)，引脚在下方 +14）
    await waitPlaced(1);
    clickWorld(40, 118); // R.a
    clickWorld(40, 74); // 预置 VCC.p
    await waitFor(() => expect(readDoc().wires?.length).toBe(1), { timeout: 5000 });

    clickWorld(40, 96); // 点这条线的中点 = 选中这条线
    const del = deleteBtn();
    expect(del).toBeTruthy();
    // 旋转对连线仍旧不可用（与顶栏时的 disabled 口径一致：只看 selection）
    expect((rotateBtn() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(del as HTMLElement);
    await waitFor(() => expect(readDoc().wires?.length).toBe(0), { timeout: 5000 });
  });
});

describe('浮动条定位数学（纯函数：贴边时夹回画布可视区）', () => {
  const camera: Camera = { x: 0, y: 0, scale: 1 };
  /** 一个 44×44 的 npn 元件放在 (0, 0)：足迹 world (-22,-22)-(22,22) */
  const doc = {
    id: 't',
    name: 't',
    syms: [{ id: 'q1', kind: 'unit', unit: 'npn', x: 0, y: 0, rot: 0, label: 'Q1' }],
    wires: [],
    library: [],
  } as unknown as Doc;
  const bar = { width: 110, height: 52 }; // 小浮动条实测尺寸（两个 44px 按钮 + 内边距）

  it('元件锚点 = 足迹底边中点（用画布现有的 worldToScreen，不另存 pan/zoom）', () => {
    const anchor = selectionAnchor(doc, ['q1'], [], camera, 200, 200);
    // world (0, 22) → screen (100, 122)
    expect(anchor).toEqual({ x: 100, top: 78, bottom: 122 });
    expect(selectionAnchor(doc, [], [], camera, 200, 200)).toBeNull();
  });

  it('下方放得下就挂下方；放不下翻到上方；越界夹回来', () => {
    const roomy = { left: 12, top: 56, right: 188, bottom: 192 };
    // 正常：锚点 (100, 122) 在可视区中上部 → 挂在对象**下方**
    expect(placeFloatingBar({ x: 100, top: 78, bottom: 122 }, bar, roomy)).toEqual({
      left: 45,
      top: 130,
    });

    // 贴右下角：下方只剩一点点 → 翻到对象**上方**；右边同时夹进可视区
    const lowBox = { left: 12, top: 0, right: 188, bottom: 120 };
    const low = placeFloatingBar({ x: 198, top: 80, bottom: 114 }, bar, lowBox);
    expect(low.top).toBe(80 - 8 - 52); // 20：挂在对象上方
    expect(low.left).toBe(188 - 110); // 78：右边界内

    // 贴左上角：左边夹到内边距，仍在对象下方
    expect(placeFloatingBar({ x: 0, top: 20, bottom: 40 }, bar, lowBox)).toEqual({
      left: 12,
      top: 48,
    });

    // 可视区比浮动条还矮还窄（极端视口）时也不反着算，直接钉在左上角
    const tiny = placeFloatingBar({ x: 100, top: 60, bottom: 66 }, bar, {
      left: 0,
      top: 0,
      right: 40,
      bottom: 40,
    });
    expect(tiny).toEqual({ left: 0, top: 0 });
  });
});
