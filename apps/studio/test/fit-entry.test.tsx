// @vitest-environment jsdom
/**
 * 进关自适应的**接线**测（纯函数的数字在 fit-camera.test.ts）：相机不在 DOM 里，
 * 所以这里把 `drawScene` 换成"把 Scene 收下来"，从 `scene.camera` / `scene.width|height`
 * 反推真正喂给渲染的相机 —— 断言的是进关时实际发生的事，不是"应该"。
 *
 * jsdom 没有排版引擎：`.canvas-wrap` 量出来是 0（App 兜底 200×200）、面板 offset* 恒 0，
 * 所以这里用 `stubCanvasRect()` 给画布一个真实尺寸、用 `fakePanelSize()` 让面板"量得到尺寸"，
 * 数字仍然全部现算（内容 bbox 也走 App 里那条同一算法）——不是写死的期望值。
 */
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCALE_RANGE } from '../src/editor/gesture.ts';
import type { Scene } from '../src/editor/render.ts';

/** 收到的每次绘制（最后一条 = 当前相机） */
const scenes: Scene[] = [];
vi.mock('../src/editor/render.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/editor/render.ts')>();
  return {
    ...actual,
    drawScene: (_ctx: unknown, scene: Scene) => {
      scenes.push(scene);
    },
  };
});

import { footprintOf } from '../src/editor/render.ts';
import { contentBoxOf, GRID_PITCH, visibleCells } from '../src/layout/fit.ts';
import { goToLevel, renderApp } from './helpers.tsx';

// ---- 视口模拟（和 mobile-layout.test.tsx 同一套：jsdom 没有 matchMedia） ----
const realMatchMedia = window.matchMedia;
const realInnerWidth = window.innerWidth;
const realInnerHeight = window.innerHeight;

function setViewport(width: number, height: number): void {
  for (const [key, value] of [
    ['innerWidth', width],
    ['innerHeight', height],
  ] as const) {
    Object.defineProperty(window, key, { configurable: true, writable: true, value });
  }
  window.matchMedia = ((query: string): MediaQueryList => {
    const cap = /\(max-width:\s*(\d+)px\)/.exec(query);
    const narrow = cap ? width <= Number(cap[1]) : false;
    const wantsPortrait = /orientation:\s*portrait/.test(query);
    const portrait = wantsPortrait ? height >= width : true;
    return {
      matches: narrow && portrait,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

// ---- jsdom 没有 canvas 2d 上下文：给个"什么都能调"的空壳，让 App 走到 drawScene ----
const realGetContext = HTMLCanvasElement.prototype.getContext;
function stubCanvas(): void {
  const noop = (): void => {};
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy({}, { get: () => noop })) as unknown as HTMLCanvasElement['getContext'];
}

// ---- 给画布一个真实尺寸（App 量的是 .canvas-wrap 的 getBoundingClientRect） ----
const realGetRect = Element.prototype.getBoundingClientRect;
function stubCanvasRect(w: number, h: number): void {
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    if (this.classList?.contains('canvas-wrap')) {
      return {
        x: 0,
        y: 0,
        width: w,
        height: h,
        top: 0,
        left: 0,
        right: w,
        bottom: h,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return realGetRect.call(this);
  };
}

// ---- 让覆盖式面板"量得到尺寸"（jsdom 排版恒 0） ----
const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const realOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
function fakePanelSize(w: number, h: number): void {
  const isPanel = (el: HTMLElement): boolean =>
    el.classList?.contains('palette') || el.classList?.contains('side');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isPanel(this) ? h : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return isPanel(this) ? w : 0;
    },
  });
}

afterEach(() => {
  scenes.length = 0;
  window.history.replaceState({}, '', '/');
  window.matchMedia = realMatchMedia;
  HTMLCanvasElement.prototype.getContext = realGetContext;
  Element.prototype.getBoundingClientRect = realGetRect;
  if (realOffsetHeight)
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetHeight);
  if (realOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realOffsetWidth);
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: realInnerWidth,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: realInnerHeight,
  });
});

function lastScene(): Scene {
  const s = scenes.at(-1);
  if (!s) throw new Error('一次 drawScene 都没发生');
  return s;
}

/** 当前内容 bbox（用 App 里那条同一算法现算） */
function boxOf(scene: Scene): { x: number; y: number; w: number; h: number } {
  const box = contentBoxOf(scene.doc.syms, (sym) => footprintOf(sym, scene.doc.library));
  if (!box) throw new Error('这一关没有元件？');
  return box;
}

/** 面积口径会给出的 scale（A = 可用宽/可用高）—— 现在这是**唯一**口径（目标 2275 格² = 175×13） */
function areaScaleFor(w: number, h: number): number {
  return w / (Math.sqrt(2275 * (w / h)) * GRID_PITCH);
}

/** 真正喂给渲染的 scale：面积口径夹到手势区间；新目标下四个真实视口都不夹，又小又扁的可用区会撞下限 */
function expectedScale(w: number, h: number): number {
  return Math.min(Math.max(areaScaleFor(w, h), SCALE_RANGE.min), SCALE_RANGE.max);
}

/**
 * **老口径的"内容优先"那一半**（已按用户裁定删除）：只按内容 bbox（含 40 世界单位留白）把整关塞进来。
 * 留在这里做反证 —— 它给出的 606~2896 格²，四个视口**没有一个**落在目标区间 [1950, 2600] 里，
 * 所以"面积 ∈ 区间"这条断言本身就是防回归闸门（一旦内容又参与定 scale，这条立刻红）。
 * 注意不要拿 `areaScaleFor` 混进来（那是**新**目标），否则反证会被新口径污染。
 */
function oldContentOnlyScale(w: number, h: number, box: { w: number; h: number }): number {
  return Math.min(w / (box.w + 80), h / (box.h + 80));
}

/** 手动缩放一次（App 的 onWheel） */
function wheelZoom(canvas: Element, deltaY: number): void {
  fireEvent.wheel(canvas, { deltaY, clientX: 100, clientY: 100 });
}

/**
 * 手动平移一次：鼠标走的是 onMouseDown/Move/Up（`onPointerDown` 对 mouse 直接 return），
 * 位移要超过 3px 阈值才算"真的在平移"。
 */
function mousePan(canvas: Element): void {
  fireEvent.mouseDown(canvas, { button: 0, clientX: 150, clientY: 300 });
  fireEvent.mouseMove(canvas, { button: 0, clientX: 60, clientY: 300 });
  fireEvent.mouseUp(canvas, { button: 0, clientX: 60, clientY: 300 });
}

/** 回地图再点同一关（进关路径与 goToLevel 相同，只是不再点「关卡模式」） */
function reenterSameLevel(title: string): void {
  fireEvent.click(screen.getByTitle('回到关卡地图（草图已自动保存）'));
  fireEvent.click(screen.getByText(title));
}

describe('进关自适应：进关就把相机摆好（目标 2275 格² ≈ 47.7 格见方 + 内容居中）', () => {
  it.each([
    // 画布尺寸 = CDP 实测（桌面扣掉左侧元件库 240 + 间距 16；竖屏顶栏 109 高）
    ['桌面 1280×800（画布 1024×754）', 1280, 800, 1024, 754],
    ['竖屏 390×844（画布 390×735）', 390, 844, 390, 735],
    ['横屏 844×390（画布 844×333）', 844, 390, 844, 333],
    ['平板 768×1024（画布 768×967）', 768, 1024, 768, 967],
  ])(
    '%s：scale 只由面积口径定（真实关卡内容不参与）、相机居中于内容中心、内容基本装得下',
    (_l, vw, vh, cw, ch) => {
      stubCanvas();
      stubCanvasRect(cw, ch);
      setViewport(vw, vh);
      renderApp();
      goToLevel('非门');
      const s = lastScene();
      const box = boxOf(s);

      // 手势区间内，而且四个真实视口都**不夹紧**
      expect(s.camera.scale).toBeGreaterThanOrEqual(SCALE_RANGE.min);
      expect(s.camera.scale).toBeLessThanOrEqual(SCALE_RANGE.max);
      expect(s.camera.scale).toBeCloseTo(expectedScale(cw, ch), 9);
      expect(s.camera.scale).toBeCloseTo(areaScaleFor(cw, ch), 9);
      // 居中：相机 = 内容 bbox 中心（= 可用区中心），不是旧默认值 (340,220)
      expect(s.camera.x).toBeCloseTo(box.x + box.w / 2, 6);
      expect(s.camera.y).toBeCloseTo(box.y + box.h / 2, 6);

      // **核心口径**：可见面积正好 2275 格²，落在 [1950, 2600] 里
      const cells = visibleCells(s.camera, cw, ch);
      expect(cells.area).toBeCloseTo(2275, 1);
      expect(cells.area).toBeGreaterThanOrEqual(1950);
      expect(cells.area).toBeLessThanOrEqual(2600);
      // 不许被内容带偏：老口径（内容优先）在这一关的落点必须**在区间外**（反证口径还活着）
      const oldScale = oldContentOnlyScale(cw, ch, box);
      const oldArea = (cw * ch) / (GRID_PITCH * oldScale) ** 2;
      expect(oldArea < 1950 || oldArea > 2600, `老口径 ${oldArea} 竟然落在区间里`).toBe(true);
      // 目标放大 13 倍后真实内容（704 宽）基本装得下：桌面/横屏/平板整关可见，
      // 竖屏最多差 6px（不到 2%）→ 只有边缘一点点要靠平移
      expect((box.w * s.camera.scale) / 2).toBeLessThanOrEqual(cw / 2 + 6);
    },
  );

  it('数字对得上：桌面 1024×754 的 scale == 面积口径 0.9211（不夹紧）= 2275 格²', () => {
    stubCanvas();
    stubCanvasRect(1024, 754);
    setViewport(1280, 800);
    renderApp();
    goToLevel('非门');
    const s = lastScene();
    const box = boxOf(s);
    // 175 时这里要 3.321 撞上限 2.6；目标 ×13 后只要 0.9211，稳稳落在手势区间里
    expect(areaScaleFor(1024, 754)).toBeCloseTo(0.9211, 4);
    expect(s.camera.scale).toBeCloseTo(0.9211, 4);
    expect(visibleCells(s.camera, 1024, 754).area).toBeCloseTo(2275, 1);
    expect(s.camera.scale).toBeGreaterThan(SCALE_RANGE.min);
    // 反证：老口径（内容优先）在这一关给 min(1024/784, 754/244) = 1.306 → 1131.5 格²（区间外）
    const oldScale = oldContentOnlyScale(1024, 754, box);
    expect(oldScale).toBeCloseTo(1.306, 3);
    expect((1024 * 754) / (GRID_PITCH * oldScale) ** 2).toBeCloseTo(1131.5, 1);
    expect(oldScale).toBeGreaterThan(s.camera.scale); // 老口径会把视野**缩**到比目标小（1131.5 < 1950）
  });

  it('竖屏扣掉底部抽屉：可用区高变矮 → 面积口径跟着变（仍不碰内容）', () => {
    stubCanvas();
    stubCanvasRect(600, 400);
    setViewport(390, 844);
    renderApp();
    goToLevel('非门');
    // 竖屏一进关两块面板都是收起的（窄屏自动收起）
    expect(screen.getByRole('button', { name: '展开元件库' })).toBeTruthy();
    const withoutSheet = lastScene().camera;
    const box = boxOf(lastScene());
    expect(withoutSheet.scale).toBeCloseTo(expectedScale(600, 400), 9);
    expect(visibleCells(withoutSheet, 600, 400).area).toBeCloseTo(2275, 1);

    // 拉开底部抽屉（260px 高）→ 可用区 600×400 → 600×140，面积口径的 scale 跟着变
    fakePanelSize(390, 260);
    fireEvent.click(screen.getByRole('button', { name: '展开元件库' }));
    const withSheet = lastScene().camera;
    const withCells = visibleCells(withSheet, 600, 140);
    expect(withSheet).not.toEqual(withoutSheet);
    // 140px 高的可用区：面积口径想要 0.3038 < 0.35 → 撞**下限**（放大 13 倍后容易撞的是这一头），
    // 实得 1714.3 格²（低于区间下限，如实记录；真机竖屏可用区 390×397 是 0.4125，不撞）
    expect(areaScaleFor(600, 140)).toBeCloseTo(0.3038, 4);
    expect(withSheet.scale).toBeCloseTo(expectedScale(600, 140), 9);
    expect(withSheet.scale).toBe(SCALE_RANGE.min);
    expect(withCells.area).toBeCloseTo(1714.3, 1);
    expect(withSheet.scale).toBeGreaterThanOrEqual(SCALE_RANGE.min);
    // 相机仍在内容中心（中心不随可用区变）
    expect(withSheet.x).toBeCloseTo(box.x + box.w / 2, 6);
    expect(withSheet.y).toBeCloseTo(box.y + box.h / 2, 6);
  });

  it('回地图再进同一关：重新 fit（相机回到 fit 出来的位置）', () => {
    stubCanvas();
    stubCanvasRect(1024, 754);
    setViewport(1280, 800);
    renderApp();
    goToLevel('非门');
    const fitted = lastScene().camera;
    mousePan(document.querySelector('canvas')!);
    const panned = lastScene().camera;
    expect(panned).not.toEqual(fitted);
    reenterSameLevel('非门');
    expect(lastScene().camera).toEqual(fitted);
  });
});

describe('手动平移/缩放之后不再被重置', () => {
  it('滚轮缩放一次 → 再触发容器尺寸变化（旋屏）也不重新 fit', () => {
    stubCanvas();
    stubCanvasRect(1024, 754);
    setViewport(1280, 800);
    renderApp();
    goToLevel('非门');
    const canvas = document.querySelector('canvas');
    expect(canvas).toBeTruthy();
    const fitted = lastScene().camera;

    // 桌面进关的 scale 是面积口径给的 0.9211（新目标下不夹紧）→ 往回缩一点就算"用户接管了视图"
    wheelZoom(canvas!, 100);
    const zoomed = lastScene().camera;
    expect(fitted.scale).toBeCloseTo(0.9211, 4);
    expect(zoomed.scale).toBeLessThan(fitted.scale);

    setViewport(844, 390); // 旋屏
    stubCanvasRect(844, 333);
    fireEvent(window, new Event('resize'));
    expect(lastScene().camera).toEqual(zoomed);
  });

  it('手动平移一次 → 抽屉开合也不重新 fit', () => {
    stubCanvas();
    stubCanvasRect(390, 735);
    fakePanelSize(390, 362);
    setViewport(390, 844);
    renderApp();
    goToLevel('非门');
    const canvas = document.querySelector('canvas')!;
    mousePan(canvas);
    const panned = lastScene().camera;

    // 拉开竖屏底部抽屉 → 不该重新 fit
    fireEvent.click(screen.getByRole('button', { name: '展开元件库' }));
    expect(lastScene().camera).toEqual(panned);
    // 再收起 → 仍不该动镜头
    fireEvent.click(screen.getByRole('button', { name: '收起元件库' }));
    expect(lastScene().camera).toEqual(panned);
  });
});

describe('可见格数（CDP 用的是同一算法，先在这里对一遍）', () => {
  it('进关后由 camera 反推的可见格数 = 可用区面积 / (格距×scale)²；桌面是 2275', () => {
    stubCanvas();
    stubCanvasRect(1024, 754);
    setViewport(1280, 800);
    renderApp();
    goToLevel('非门');
    const s = lastScene();
    const cells = visibleCells(s.camera, 1024, 754);
    expect(cells.area).toBeCloseTo((1024 * 754) / (GRID_PITCH * s.camera.scale) ** 2, 6);
    // 格块宽高比 = 可用区宽高比（2275 格² 那套「同比例铺满」的口径）
    expect(cells.x / cells.y).toBeCloseTo(1024 / 754, 6);
    // 桌面 55.59 × 40.93 = 2275.0（≈47.7 格见方的那套面积；不是 175，也不是老口径的 1131.5）
    expect(cells.x).toBeCloseTo(55.59, 1);
    expect(cells.y).toBeCloseTo(40.93, 1);
    expect(cells.area).toBeCloseTo(2275, 1);
  });

  it('竖屏：不被夹紧 → 正好 2275 格²（34.7 格宽 × 65.5 格高）', () => {
    stubCanvas();
    stubCanvasRect(390, 735);
    setViewport(390, 844);
    renderApp();
    goToLevel('非门');
    const s = lastScene();
    const cells = visibleCells(s.camera, 390, 735);
    expect(cells.x).toBeCloseTo(Math.sqrt(2275 * (390 / 735)), 2); // 34.74
    expect(cells.y).toBeCloseTo(2275 / Math.sqrt(2275 * (390 / 735)), 2); // 65.48
    expect(cells.x * cells.y).toBeCloseTo(2275, 1);
    expect(cells.area).toBeGreaterThanOrEqual(1950);
    expect(cells.area).toBeLessThanOrEqual(2600);
  });
});
