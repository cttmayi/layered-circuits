// @vitest-environment jsdom
/**
 * 相机探针（**不 import App**，否则和 vi.mock 的工厂互相等待会死锁）：
 * 把 render.ts 的 `drawScene` 换成"把 Scene 收下来"，测试就能拿到
 * **App 真实在用的相机**。进关自适应（layout/fit.ts）之后相机不再是固定值，
 * 任何按世界坐标点击/拖动的用例都必须用它换算屏幕坐标，不能再写死 (340,220)。
 *
 * 用法（测试文件顶部，vi.mock 的工厂里动态 import，绕开 vitest 的变量提升限制）：
 *   vi.mock('../src/editor/render.ts', async (importOriginal) => {
 *     const { withCameraProbe } = await import('./camera-probe');
 *     return withCameraProbe(await importOriginal<typeof import('../src/editor/render.ts')>());
 *   });
 * 之后 `screenOf = atWorld`，坐标就跟着相机走了。
 */
import type { Camera, Scene } from '../src/editor/render';

/** 探针收到的每次绘制（最后一条 = 当前相机）；尺寸 stub 要还原的原函数 */
const drawnScenes: Scene[] = [];
let stubbedRect: typeof Element.prototype.getBoundingClientRect | null = null;
let stubbedCtx: HTMLCanvasElement['getContext'] | null = null;
const canvasSize = { width: 0, height: 0 };

/** 把 drawScene 换成探针，其余导出原样透出 */
export function withCameraProbe<T extends object>(actual: T): T {
  return {
    ...actual,
    drawScene: (_ctx: unknown, scene: Scene): void => {
      drawnScenes.push(scene);
    },
  };
}

/** 最近一次绘制用的相机 + 画布尺寸（就是 App 当前真的那组） */
export function liveCamera(): Camera & { width: number; height: number } {
  const s = drawnScenes.at(-1);
  if (!s) throw new Error('还没收到任何绘制：这个测试文件 vi.mock 了 editor/render 吗？');
  return { x: s.camera.x, y: s.camera.y, scale: s.camera.scale, width: s.width, height: s.height };
}

/** 世界坐标 → client 坐标（用 App 当前相机；"缩放后按新比例点"才传 scaleOverride） */
export function atWorld(
  wx: number,
  wy: number,
  scaleOverride?: number,
): { clientX: number; clientY: number } {
  const c = liveCamera();
  const k = scaleOverride ?? c.scale;
  return { clientX: (wx - c.x) * k + c.width / 2, clientY: (wy - c.y) * k + c.height / 2 };
}

/**
 * 给画布一个真实尺寸：jsdom 量不到排版，`.canvas-wrap` 恒为 0 → App 兜底 200×200，
 * 而 200×200 装不下一关的内容（进关自适应会贴到 0.35 下限、世界坐标落到画布外）。
 * 想按世界坐标点击的用例先调它，尺寸就稳定下来了。
 * 顺带把 `getContext('2d')` 换成空壳（jsdom 返回 null，否则 App 在拿到 ctx 前就 return、
 * 一次 drawScene 都不会发生，探针也就拿不到相机）。
 */
export function stubCanvasSize(width: number, height: number): void {
  if (!stubbedCtx) {
    stubbedCtx = HTMLCanvasElement.prototype.getContext;
    const noop = (): void => {};
    HTMLCanvasElement.prototype.getContext = (() =>
      new Proxy({}, { get: () => noop })) as unknown as HTMLCanvasElement['getContext'];
  }
  if (!stubbedRect) {
    const real = Element.prototype.getBoundingClientRect;
    stubbedRect = real;
    Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
      if (this.classList?.contains('canvas-wrap')) {
        return {
          x: 0,
          y: 0,
          width: canvasSize.width,
          height: canvasSize.height,
          top: 0,
          left: 0,
          right: canvasSize.width,
          bottom: canvasSize.height,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return real.call(this);
    };
  }
  canvasSize.width = width;
  canvasSize.height = height;
}

/** 撤销 stubCanvasSize（afterEach 里调；没 stub 过就什么都不做） */
export function unstubCanvasSize(): void {
  if (stubbedCtx) {
    HTMLCanvasElement.prototype.getContext = stubbedCtx;
    stubbedCtx = null;
  }
  if (!stubbedRect) return;
  Element.prototype.getBoundingClientRect = stubbedRect;
  stubbedRect = null;
}
