/**
 * 画布浮动工具条的定位数学（纯函数：不碰 DOM、不自己存视图状态）。
 *
 * 为什么要单开一份：工具条要贴在「选中对象」旁边、还要夹在画布可视区里，
 * 而真实 rect（画布可视区让开底部提示行 / 竖屏抽屉 / 抽屉手柄之后的可用范围）
 * 只有在浏览器里量得出来。所以这里**只做纯计算** —— App 量好尺寸传进来，
 * jsdom 里也能直接单测。
 *
 * ⚠️ 屏幕坐标一律走 `editor/render.ts` 的 `worldToScreen`（画布唯一的视图变换），
 *    绝不在别处再存一份 pan/zoom。
 */
import type { Doc } from '../editor/model';
import {
  type Camera,
  footprintOf,
  routeWires,
  type WireRoute,
  worldToScreen,
} from '../editor/render';

/** 选中对象在屏幕上的锚点：水平中心 + 下沿 + 上沿（都是画布内坐标） */
export interface OverlayAnchor {
  x: number;
  /** 对象下沿：小浮动条优先挂在它下面 */
  bottom: number;
  /** 对象上沿：下面放不下时改挂它上面 */
  top: number;
}

/** 浮动条自身的尺寸（浏览器实测的 offsetWidth/offsetHeight） */
export interface OverlaySize {
  width: number;
  height: number;
}

/** 可视区（已经让开提示行 / 底部抽屉 / 抽屉手柄的矩形，画布内坐标） */
export interface OverlayBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 夹取（lo > hi 时（可视区比浮动条还小）退化成 lo，保证不反着算） */
export function clampNumber(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/** 走线按累计长度取中点：拐弯很多的走线也算得中（别只取第一段的中点） */
function wireMidpoint(route: WireRoute): { x: number; y: number } {
  let total = 0;
  for (const [p, q] of route) total += Math.hypot(q.x - p.x, q.y - p.y);
  let remain = total / 2;
  for (const [p, q] of route) {
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (remain <= len) {
      const t = len === 0 ? 0 : remain / len;
      return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
    }
    remain -= len;
  }
  const last = route[route.length - 1];
  return last ? { x: last[1].x, y: last[1].y } : { x: 0, y: 0 };
}

/**
 * 选中对象 → 屏幕锚点。选中口径与 App 完全一致（`selection` 元件 / `selectedWires` 连线），
 * 这里不另立规则：
 *  - 有选中元件：取**所有**选中元件足迹的并集（多选时小条挂在整组下面）
 *  - 否则看连线：取第一条选中的连线的走线中点
 *  - 都没有 → null（调用方据此**不渲染**旋转/删除，而不是置灰）
 */
export function selectionAnchor(
  doc: Doc,
  selection: readonly string[],
  selectedWires: readonly string[],
  camera: Camera,
  width: number,
  height: number,
): OverlayAnchor | null {
  const boxes = doc.syms
    .filter((s) => selection.includes(s.id))
    .map((s) => footprintOf(s, doc.library));
  if (boxes.length > 0) {
    let x0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const b of boxes) {
      x0 = Math.min(x0, b.x);
      x1 = Math.max(x1, b.x + b.w);
      y0 = Math.min(y0, b.y);
      y1 = Math.max(y1, b.y + b.h);
    }
    const cx = (x0 + x1) / 2;
    const bottom = worldToScreen(camera, width, height, cx, y1);
    const top = worldToScreen(camera, width, height, cx, y0);
    return { x: bottom.x, top: top.y, bottom: bottom.y };
  }

  const routes = routeWires(doc);
  for (const wire of doc.wires) {
    if (!selectedWires.includes(wire.id)) continue;
    const route = routes.get(wire.id);
    if (!route || route.length === 0) continue;
    const mid = wireMidpoint(route);
    const p = worldToScreen(camera, width, height, mid.x, mid.y);
    return { x: p.x, top: p.y, bottom: p.y };
  }
  return null;
}

/**
 * 浮动条的落点：优先挂在对象**下方**；下方放不下就改挂**上方**（Figma 那种贴边翻转）；
 * 最后整体夹进可视区，保证完整落在画布里、不压住手柄。
 * `bar` 还没量出来（jsdom / 首帧：宽高为 0）时夹取退化成「以对象为中心」，不会算歪。
 */
export function placeFloatingBar(
  anchor: OverlayAnchor,
  bar: OverlaySize,
  box: OverlayBox,
  gap = 8,
): { left: number; top: number } {
  let top = anchor.bottom + gap;
  if (top + bar.height > box.bottom) top = anchor.top - gap - bar.height;
  return {
    left: clampNumber(anchor.x - bar.width / 2, box.left, box.right - bar.width),
    top: clampNumber(top, box.top, box.bottom - bar.height),
  };
}
