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
import { CONTENT_MARGIN, contentBoxOf, GRID_PITCH, visibleCells } from '../src/layout/fit.ts';
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

/** 面积口径会给出的 scale（A = 可用宽/可用高） */
function areaScaleFor(w: number, h: number): number {
  return w / (Math.sqrt(175 * (w / h)) * GRID_PITCH);
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

describe('进关自适应：进关就把相机摆好（内容完整可见 + 居中）', () => {
  it.each([
    ['桌面 1280×800（画布 1280×754）', 1280, 800, 1280, 754],
    ['竖屏 390×844（画布 390×787）', 390, 844, 390, 787],
    ['横屏 844×390（画布 844×333）', 844, 390, 844, 333],
    ['平板 768×1024（画布 768×967）', 768, 1024, 768, 967],
  ])(
    '%s：scale 在 [0.35,2.6] 内、相机居中于内容中心、内容（含留白）完整落在可用区里',
    (_l, vw, vh, cw, ch) => {
      stubCanvas();
      stubCanvasRect(cw, ch);
      setViewport(vw, vh);
      renderApp();
      goToLevel('非门');
      const s = lastScene();
      const box = boxOf(s);

      expect(s.camera.scale).toBeGreaterThanOrEqual(SCALE_RANGE.min);
      expect(s.camera.scale).toBeLessThanOrEqual(SCALE_RANGE.max);
      // 居中：相机 = 内容 bbox 中心（= 可用区中心），不是旧默认值 (340,220)
      expect(s.camera.x).toBeCloseTo(box.x + box.w / 2, 6);
      expect(s.camera.y).toBeCloseTo(box.y + box.h / 2, 6);
      // 内容（含留白）四边都在可用区里（这一关够小，不该被下限 0.35 截住）
      expect(((box.w + CONTENT_MARGIN * 2) * s.camera.scale) / 2).toBeLessThanOrEqual(
        cw / 2 + 1e-9,
      );
      expect(((box.h + CONTENT_MARGIN * 2) * s.camera.scale) / 2).toBeLessThanOrEqual(
        ch / 2 + 1e-9,
      );
      // 内容口径确实是更紧的那个（这关内容比 175 格² 的视野大 → 取更小的）
      expect(s.camera.scale).toBeLessThan(areaScaleFor(cw, ch));
    },
  );

  it('数字对得上：桌面 1280×754 的 scale == 内容口径 min(1280/(w+80), 754/(h+80))', () => {
    stubCanvas();
    stubCanvasRect(1280, 754);
    setViewport(1280, 800);
    renderApp();
    goToLevel('非门');
    const s = lastScene();
    const box = boxOf(s);
    const expected = Math.min(1280 / (box.w + 80), 754 / (box.h + 80));
    expect(s.camera.scale).toBeCloseTo(expected, 9);
    // 面积口径要给的 scale 是 3.7 量级（> 上限 2.6）→ 大屏上 175 格² 够不着
    expect(areaScaleFor(1280, 754)).toBeGreaterThan(3);
  });

  it('竖屏扣掉底部抽屉：可用高变矮 → 内容口径跟着变', () => {
    stubCanvas();
    stubCanvasRect(600, 400);
    setViewport(390, 844);
    renderApp();
    goToLevel('非门');
    // 竖屏一进关两块面板都是收起的（窄屏自动收起）
    expect(screen.getByRole('button', { name: '展开元件库' })).toBeTruthy();
    const withoutSheet = lastScene().camera;
    const box = boxOf(lastScene());
    expect(withoutSheet.scale).toBeCloseTo(Math.min(600 / (box.w + 80), 400 / (box.h + 80)), 9);

    // 拉开底部抽屉（260px 高）→ 可用高 400 → 140，这时高度项才真的更紧（fit 结果跟着变）
    fakePanelSize(390, 260);
    fireEvent.click(screen.getByRole('button', { name: '展开元件库' }));
    const withSheet = lastScene().camera;
    expect(withSheet).not.toEqual(withoutSheet);
    const expectedWith = Math.min(600 / (box.w + 80), 140 / (box.h + 80));
    expect(expectedWith).toBeLessThan(600 / (box.w + 80)); // 高度项确实更紧
    expect(withSheet.scale).toBeCloseTo(expectedWith, 9);
    expect(withSheet.scale).toBeGreaterThanOrEqual(SCALE_RANGE.min);
  });

  it('回地图再进同一关：重新 fit（相机回到 fit 出来的位置）', () => {
    stubCanvas();
    stubCanvasRect(1280, 754);
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
    stubCanvasRect(1280, 754);
    setViewport(1280, 800);
    renderApp();
    goToLevel('非门');
    const canvas = document.querySelector('canvas');
    expect(canvas).toBeTruthy();
    const fitted = lastScene().camera;

    wheelZoom(canvas!, -100);
    const zoomed = lastScene().camera;
    expect(zoomed.scale).toBeGreaterThan(fitted.scale);

    setViewport(844, 390); // 旋屏
    stubCanvasRect(844, 333);
    fireEvent(window, new Event('resize'));
    expect(lastScene().camera).toEqual(zoomed);
  });

  it('手动平移一次 → 抽屉开合也不重新 fit', () => {
    stubCanvas();
    stubCanvasRect(390, 787);
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
  it('进关后由 camera 反推的可见格数 = 可用区面积 / (格距×scale)²', () => {
    stubCanvas();
    stubCanvasRect(1280, 754);
    setViewport(1280, 800);
    renderApp();
    goToLevel('非门');
    const s = lastScene();
    const cells = visibleCells(s.camera, 1280, 754);
    expect(cells.area).toBeCloseTo((1280 * 754) / (GRID_PITCH * s.camera.scale) ** 2, 6);
    // 这一关内容比 175 格² 的视野大 → 实得面积大于 200（内容优先，不是没生效）
    expect(cells.area).toBeGreaterThan(200);
  });
});
