/**
 * 画布渲染 + 命中测试（纯函数，不依赖 React）。
 *
 * 视觉语义（与 docs/sim-semantics.md 一致）：
 *   强 1 = 亮绿实线   弱 1 = 暗绿细线
 *   强 0 = 冷灰实线   弱 0 = 深灰细线
 *   X    = 红色虚线   Z（悬空）= 土黄虚线
 * 玩家因此能「看见」强度：上拉电阻给出的是弱 1，三极管拉低给出的是强 0。
 */

import type { PinRef } from '@lc/schema';
import { logicValueOf, S_STRONG, SIG_Z, strengthOf } from '@lc/sim-core';
import {
  type Doc,
  MODULE_HALF_WIDTH,
  moduleBox,
  partBoxSize,
  pinKey,
  pinNames,
  pinOffsets,
  type StoredModule,
  type Sym,
  symKindKey,
  type Wire,
} from './model';

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export interface HoverTarget {
  kind: 'sym' | 'pin' | 'wire';
  id: string;
  pin?: string;
  /** 引脚位（多 bit 端口按位区分） */
  bit?: number;
}

export interface Scene {
  doc: Doc;
  camera: Camera;
  width: number;
  height: number;
  pinSignals: Map<string, number>;
  selection: string[];
  selectedWires: string[];
  hover: HoverTarget | null;
  /** 正在连线时的起点引脚 */
  pendingPin: { inst: string; pin: string; bit?: number } | null;
  pendingPoint: { x: number; y: number } | null;
  grid: boolean;
}

export const PALETTE = {
  bg: '#0e1319',
  grid: '#18202a',
  gridStrong: '#202b38',
  body: '#8ea3bb',
  bodyDim: '#4b5a6b',
  fill: '#141c25',
  text: '#c9d6e4',
  textDim: '#71839a',
  selection: '#ffb454',
  hover: '#5fa8ff',
  strong1: '#38d67a',
  weak1: '#1d7a48',
  strong0: '#7d8ea3',
  weak0: '#414c59',
  x: '#ff5f56',
  z: '#b99530',
  wire: '#5b6b7d',
  // 输入/输出端口专用色：有辨识度但不抢戏（低饱和暗调，电平颜色在上面才显眼）
  portInStroke: '#4e7d8a',
  portInFill: '#14212a',
  portOutStroke: '#8a7d4e',
  portOutFill: '#262118',
};

export function worldToScreen(
  camera: Camera,
  width: number,
  height: number,
  wx: number,
  wy: number,
): { x: number; y: number } {
  return {
    x: (wx - camera.x) * camera.scale + width / 2,
    y: (wy - camera.y) * camera.scale + height / 2,
  };
}

export function screenToWorld(
  camera: Camera,
  width: number,
  height: number,
  sx: number,
  sy: number,
): { x: number; y: number } {
  return {
    x: (sx - width / 2) / camera.scale + camera.x,
    y: (sy - height / 2) / camera.scale + camera.y,
  };
}

/** 信号编码 → 颜色 / 线宽 / 是否虚线 */
export function signalStyle(signal: number): { color: string; width: number; dash: number[] } {
  if (signal === SIG_Z) return { color: PALETTE.z, width: 1.4, dash: [5, 4] };
  const strong = strengthOf(signal) === S_STRONG;
  const value = logicValueOf(signal);
  if (value === 0)
    return { color: strong ? PALETTE.strong0 : PALETTE.weak0, width: strong ? 3 : 1.6, dash: [] };
  if (value === 1)
    return { color: strong ? PALETTE.strong1 : PALETTE.weak1, width: strong ? 3 : 1.6, dash: [] };
  return { color: PALETTE.x, width: 2.4, dash: [7, 4] };
}

export function signalText(signal: number | undefined, showStrength = true): string {
  if (signal === undefined) return '—';
  if (signal === SIG_Z) return 'Z';
  const value = logicValueOf(signal);
  const tag = value === 0 ? '0' : value === 1 ? '1' : 'X';
  if (!showStrength) return tag;
  return `${tag}${strengthOf(signal) === S_STRONG ? '·强' : '·弱'}`;
}

/**
 * 门级模块在画布上的 IEC 逻辑符号（用字符表达，替代中文门名）：
 *   与门 &、或门 ≥1、非门 1、异或门 =1；与非/或非/同或/反相在输出侧画反相气泡。
 * 非门类模块（锁存器/加法器/寄存器等）没有标准单字符符号 → null，保持显示名称。
 */
const MODULE_GLYPHS: Record<string, { text: string; bubble: boolean }> = {
  非门: { text: '1', bubble: true },
  上拉反相器: { text: '1', bubble: true },
  'CMOS 反相器': { text: '1', bubble: true },
  跟随器: { text: '1', bubble: false },
  缓冲器: { text: '1', bubble: false },
  与门: { text: '&', bubble: false },
  或门: { text: '≥1', bubble: false },
  与非门: { text: '&', bubble: true },
  或非门: { text: '≥1', bubble: true },
  异或门: { text: '=1', bubble: false },
  '异或门（复古版）': { text: '=1', bubble: false },
  同或门: { text: '=1', bubble: true },
  'CMOS 与非门': { text: '&', bubble: true },
};

export function moduleGlyph(name: string): { text: string; bubble: boolean } | null {
  return MODULE_GLYPHS[name] ?? null;
}

/** 元件在画布上的足迹（世界坐标矩形）。命中测试与画布浮动工具条共用同一份，
 *  免得两处尺寸口径不一致（只加了个 export，逻辑一字未改）。 */
export function footprintOf(
  sym: Sym,
  library: StoredModule[],
): { x: number; y: number; w: number; h: number } {
  const key = symKindKey(sym);
  let size = partBoxSize(key, sym.unit, sym.module, library);
  if (key === 'input' || key === 'output') {
    const width = sym.width ?? 1;
    if (width > 1) size = { w: 44, h: Math.max(26, (width - 1) * 14 + 26) };
  }
  const swap =
    sym.rot % 2 === 1 &&
    (key === 'res' || key === 'dio' || key === 'cap' || key === 'input' || key === 'output');
  const w = swap ? size.h : size.w;
  const h = swap ? size.w : size.h;
  return { x: sym.x - w / 2, y: sym.y - h / 2, w, h };
}

export function hitTest(scene: Scene, wx: number, wy: number, tolerance = 9): HoverTarget | null {
  const { doc } = scene;
  const pinTol = tolerance / scene.camera.scale + 4;
  for (const sym of doc.syms) {
    for (const off of pinOffsets(sym, doc.library)) {
      const px = sym.x + off.x;
      const py = sym.y + off.y;
      if (Math.hypot(px - wx, py - wy) <= pinTol)
        return { kind: 'pin', id: sym.id, pin: off.name, bit: off.bit ?? 0 };
    }
  }
  for (const sym of doc.syms) {
    const f = footprintOf(sym, doc.library);
    if (wx >= f.x && wx <= f.x + f.w && wy >= f.y && wy <= f.y + f.h)
      return { kind: 'sym', id: sym.id };
  }
  const wireTol = 6 / scene.camera.scale + 2;
  const routes = routeWires(doc);
  for (const wire of doc.wires) {
    const segs = routes.get(wire.id);
    if (!segs || segs.length === 0) continue;
    for (const [p, q] of segs) {
      if (distanceToSegment(wx, wy, p, q) <= wireTol) return { kind: 'wire', id: wire.id };
    }
  }
  return null;
}

function pinWorld(doc: Doc, inst: string, pin: string, bit = 0): { x: number; y: number } | null {
  const sym = doc.syms.find((s) => s.id === inst);
  if (!sym) return null;
  const off = pinOffsets(sym, doc.library).find((p) => p.name === pin && (p.bit ?? 0) === bit);
  if (!off) return null;
  return { x: sym.x + off.x, y: sym.y + off.y };
}

/** 导线走线：折线（先水平再垂直再水平），示意更接近原理图 */
/** 走线用的稳定小偏移：同一方向的多条平行线错开，避免拐点/公共段完全叠在一起 */
function seedOffset(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const off = ((h & 3) + 1) * 4; // 4 / 8 / 12 / 16
  return h & 4 ? off : -off;
}

export interface RouteObstacle {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 该元件的引脚世界坐标：走线也要避开未连接的引脚，防止看起来像接了线 */
  pins?: Array<{ x: number; y: number }>;
}

/** 画布上所有元件的矩形（含锁定的端口/电源轨），当作走线障碍 */
export function routeObstacles(doc: Doc): RouteObstacle[] {
  return doc.syms
    .map((sym) => {
      const f = footprintOf(sym, doc.library);
      const m = 5; // 边距：离元件太近也算撞
      // 引脚全部单列为点障碍：半径比边距大，能拦下「贴着盒边擦过未连接引脚」的走线
      const pins = pinOffsets(sym, doc.library).map((p) => ({ x: sym.x + p.x, y: sym.y + p.y }));
      return { id: sym.id, x: f.x - m, y: f.y - m, w: f.w + m * 2, h: f.h + m * 2, pins };
    })
    .filter((o) => o.w > 0 && o.h > 0);
}

/** 端点引脚相对其元件矩形的方位（引脚在元件的左/右/上/下侧） */
export function pinSide(
  p: { x: number; y: number },
  box: RouteObstacle | undefined,
): 'l' | 'r' | 'u' | 'd' | null {
  if (!box) return null;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return Math.abs(p.x - cx) >= Math.abs(p.y - cy) ? (p.x < cx ? 'l' : 'r') : p.y < cy ? 'u' : 'd';
}

/** 出线段是否朝引脚的外侧走：水平段对左右侧引脚、垂直段对上下侧引脚才约束 */
function outwardTurn(
  turn: { x: number; y: number },
  from: { x: number; y: number },
  side: 'l' | 'r' | 'u' | 'd',
): boolean {
  if (turn.y === from.y) {
    if (side === 'l') return turn.x <= from.x;
    if (side === 'r') return turn.x >= from.x;
    return true; // 引脚在顶/底部，水平段在元件外侧，无约束
  }
  if (turn.x === from.x) {
    if (side === 'u') return turn.y <= from.y;
    if (side === 'd') return turn.y >= from.y;
    return true; // 引脚在左/右侧，垂直段在元件外侧，无约束
  }
  return true; // 斜段（直连），由 routeClear 负责
}

export function segHitsRect(
  p: { x: number; y: number },
  q: { x: number; y: number },
  r: RouteObstacle,
): boolean {
  const [x0, x1] = p.x <= q.x ? [p.x, q.x] : [q.x, p.x];
  const [y0, y1] = p.y <= q.y ? [p.y, q.y] : [q.y, p.y];
  if (x1 < r.x || x0 > r.x + r.w || y1 < r.y || y0 > r.y + r.h) return false;
  // 矩形内含端点也算撞（只有两端点所属元件会被跳过）
  if (x0 >= r.x && x1 <= r.x + r.w && y0 >= r.y && y1 <= r.y + r.h) return true;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  // 逐边判断线段与矩形边的相交（轴对齐矩形，简化为 4 条边 + 端点包含）
  const edges: Array<[{ x: number; y: number }, { x: number; y: number }]> = [
    [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
    ],
    [
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
    ],
    [
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ],
    [
      { x: r.x, y: r.y + r.h },
      { x: r.x, y: r.y },
    ],
  ];
  for (const [u, v] of edges) {
    const den = dx * (v.y - u.y) - dy * (v.x - u.x);
    if (den === 0) continue;
    const t = ((u.x - p.x) * (v.y - u.y) - (u.y - p.y) * (v.x - u.x)) / den;
    const u2 = ((u.x - p.x) * dy - (u.y - p.y) * dx) / den;
    if (t >= 0 && t <= 1 && u2 >= 0 && u2 <= 1) return true;
  }
  return false;
}

/** 线段是否进入引脚点的邻域（引脚点与线段距离 ≤ 半径） */
function segHitsPins(
  p: { x: number; y: number },
  q: { x: number; y: number },
  pins: Array<{ x: number; y: number }> | undefined,
  radius: number,
): boolean {
  if (!pins) return false;
  for (const pt of pins) if (distanceToSegment(pt.x, pt.y, p, q) <= radius) return true;
  return false;
}

/**
 * 两条轴对齐线段是否「平行贴近/重叠」：同向（水平-水平 / 垂直-垂直）、
 * 间距 < gap、且投影区间有超过 1 单位的长度的交集（仅端点相接不算重叠 —— 那是合法汇合点）。
 * 交叉（垂直相交一点）不算重叠，永远允许。
 */
function segsOverlapLen(
  p: { x: number; y: number },
  q: { x: number; y: number },
  r: { x: number; y: number },
  s: { x: number; y: number },
  gap: number,
): number {
  const ph = p.y === q.y;
  const qh = r.y === s.y;
  if (ph && qh) {
    if (Math.abs(p.y - r.y) > gap) return 0;
    const a0 = Math.min(p.x, q.x);
    const a1 = Math.max(p.x, q.x);
    const b0 = Math.min(r.x, s.x);
    const b1 = Math.max(r.x, s.x);
    return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  }
  const pv = p.x === q.x;
  const qv = r.x === s.x;
  if (pv && qv) {
    if (Math.abs(p.x - r.x) > gap) return 0;
    const a0 = Math.min(p.y, q.y);
    const a1 = Math.max(p.y, q.y);
    const b0 = Math.min(r.y, s.y);
    const b1 = Math.max(r.y, s.y);
    return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  }
  return 0;
}

function segsOverlap(
  p: { x: number; y: number },
  q: { x: number; y: number },
  r: { x: number; y: number },
  s: { x: number; y: number },
  gap: number,
): boolean {
  return segsOverlapLen(p, q, r, s, gap) > 1;
}

/** 引脚邻域半径（世界单位）：走线不得压过未连接的引脚 */
const PIN_RADIUS = 8;
/** 绕行候选的侧向偏移档位：从近到远依次尝试，密集区域自动走更远的外圈 */
const ROUTE_OFFSETS = [48, -48, 96, -96, 144, -144, 192, -192, 240, -240];

function routeClear(
  segs: Array<[{ x: number; y: number }, { x: number; y: number }]>,
  obstacles: RouteObstacle[],
  skipA: string,
  skipB: string,
  /** 已布好的其他导线线段：候选线不得与它们平行重叠/贴近（交叉仍允许） */
  avoid: Array<[{ x: number; y: number }, { x: number; y: number }]> = [],
  pinRadius = PIN_RADIUS,
  /** 端点引脚点：从这些点出发的线豁免它们自己，但同一元件的其他引脚仍要避开 */
  exemptPins: Array<{ x: number; y: number }> = [],
): boolean {
  for (const [p, q] of segs) {
    for (const ob of obstacles) {
      if (ob.id === skipA || ob.id === skipB) {
        // 端点元件：盒子跳过（导线必须能从引脚出发），但**其他引脚点仍要避开**——
        // 否则从 a 引脚出发的线会垂直擦过同一元件的 b 引脚点（视觉像连到了它）。
        // 只豁免端点引脚自己（线从它出发，本来就在邻域内）。
        const others = (ob.pins ?? []).filter(
          (pt) => !exemptPins.some((e) => Math.abs(e.x - pt.x) < 0.5 && Math.abs(e.y - pt.y) < 0.5),
        );
        if (segHitsPins(p, q, others, pinRadius)) return false;
        continue;
      }
      if (segHitsRect(p, q, ob)) return false;
      if (segHitsPins(p, q, ob.pins, pinRadius)) return false;
    }
    for (const [r, s] of avoid) {
      if (segsOverlap(p, q, r, s, 6)) return false;
    }
  }
  return true;
}

/**
 * 候选的「坏」程度（没有候选全清时的兜底排序）：
 * 优先少穿元件（×1000），其次少压引脚（×100），再其次少贴已有导线（×10），最后看总长。
 */
function routeViolations(
  segs: Array<[{ x: number; y: number }, { x: number; y: number }]>,
  obstacles: RouteObstacle[],
  skipA: string,
  skipB: string,
  avoid: Array<[{ x: number; y: number }, { x: number; y: number }]>,
  pinRadius = PIN_RADIUS,
  /** 端点引脚点：与 routeClear 一致，端点元件只豁免这些点，其他引脚仍计违规 */
  exemptPins: Array<{ x: number; y: number }> = [],
): number {
  let rects = 0;
  let pins = 0;
  let overlaps = 0;
  let len = 0;
  for (const [p, q] of segs) {
    len += Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
    for (const ob of obstacles) {
      if (ob.id === skipA || ob.id === skipB) {
        const others = (ob.pins ?? []).filter(
          (pt) => !exemptPins.some((e) => Math.abs(e.x - pt.x) < 0.5 && Math.abs(e.y - pt.y) < 0.5),
        );
        if (segHitsPins(p, q, others, pinRadius)) pins++;
        continue;
      }
      if (segHitsRect(p, q, ob)) rects++;
      else if (segHitsPins(p, q, ob.pins, pinRadius)) pins++;
    }
    for (const [r, s] of avoid) {
      if (segsOverlap(p, q, r, s, 6)) overlaps++;
    }
  }
  // 「穿盒」是硬违规：只要有一根线进了模块内部，评分就必须无条件输给任何不穿盒的
  // 候选（哪怕那条候选与别的线贴得很紧）。否则密集区会为了少几段重叠而选择穿盒。
  if (rects > 0) return 1_000_000 + rects * 1000 + pins * 100;
  return pins * 100 + overlaps * 10 + len / 1000;
}

/**
 * 一维「空隙中点」扫描：把 [lo,hi] 内被若干区间覆盖的部分挖掉，返回每个空段的中点。
 * 元件之间的空带/空列就是导线可以走的通道，多折点绕行靠它找拐点。
 */
function gapMids(lo: number, hi: number, ranges: Array<[number, number]>): number[] {
  const merged: Array<[number, number]> = [];
  for (const r of [...ranges].sort((p, q) => p[0] - q[0])) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const mids: number[] = [];
  let cursor = lo;
  for (const [r0, r1] of merged) {
    if (r1 < lo || r0 > hi) continue;
    if (r0 > cursor) mids.push((cursor + r0) / 2);
    cursor = Math.max(cursor, r1);
  }
  if (cursor < hi) mids.push((cursor + hi) / 2);
  return mids;
}

/**
 * 一维「车道」扫描：与 gapMids 同样是挖出空段，但每个空段按 pitch 铺多条车道。
 * 通道网格用这个 —— 只取中点的话每条通道只能走一根线（平行贴近会被 routeClear
 * 淘汰），8 位总线一下就把所有通道占满。
 */
function gapLanes(
  lo: number,
  hi: number,
  ranges: Array<[number, number]>,
  maxPer = 6,
  pitch = 11,
  edge = 9,
): number[] {
  const merged: Array<[number, number]> = [];
  for (const r of [...ranges].sort((p, q) => p[0] - q[0])) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const lanes: number[] = [];
  let cursor = lo;
  const pushGap = (g0: number, g1: number): void => {
    const p0 = Math.max(lo, g0);
    const p1 = Math.min(hi, g1);
    if (p1 - p0 < edge * 2 + 2) return;
    const usable = p1 - p0 - edge * 2;
    const n = Math.min(maxPer, Math.max(1, Math.floor(usable / pitch) + 1));
    for (let i = 0; i < n; i += 1) {
      lanes.push(n === 1 ? (p0 + p1) / 2 : p0 + edge + (usable * i) / (n - 1));
    }
  };
  for (const [r0, r1] of merged) {
    if (r1 < lo || r0 > hi) continue;
    if (r0 > cursor) pushGap(cursor, r0);
    cursor = Math.max(cursor, r1);
  }
  if (cursor < hi) pushGap(cursor, hi);
  return lanes;
}

/** 障碍是否与 a→b 的走廊重叠（只算真正会挡路的障碍） */
function inCorridorX(o: RouteObstacle, a: { x: number }, b: { x: number }): boolean {
  return o.x < Math.max(a.x, b.x) && o.x + o.w > Math.min(a.x, b.x);
}
function inCorridorY(o: RouteObstacle, a: { y: number }, b: { y: number }): boolean {
  return o.y < Math.max(a.y, b.y) && o.y + o.h > Math.min(a.y, b.y);
}

/**
 * 通道网格布线：把「元件之间的空隙」（空列 × 空带，每条空隙可铺多条车道）连成
 * 网格，用 Dijkstra 找一条任意拐点数、**绝不穿元件盒、不压引脚**的折线。
 * 固定形状候选（直连 / Z 形 / 5 段绕行）全被拒时兜底——大电路的长总线常需要
 * 3 个以上拐点才能绕过一整列模块。
 * 其他导线在这里是「软避让」：贴近要按长度罚分，但不直接否决。理由很直接——
 * 与别的线挤在一起只是难看，穿进模块内部是错的。
 */
function channelRoute(
  a: { x: number; y: number },
  b: { x: number; y: number },
  obstacles: RouteObstacle[],
  skipA: string,
  skipB: string,
  pinRadius: number,
  /** 端点引脚方位：约束「第一段朝引脚外侧走、最后一段从外侧接近」。
   *  放在搜索内部而不是事后否决 —— 否则搜到的好路线会因为方向不合被整条丢掉，
   *  只能退回穿盒的坏路线（s3-calc 的 mod1.code→mod6.d）。 */
  sideA: 'l' | 'r' | 'u' | 'd' | null = null,
  sideB: 'l' | 'r' | 'u' | 'd' | null = null,
  /** 其他导线：允许并行贴近，但按贴近长度计入代价 —— 通道被占满时优先走空闲车道，
   *  只在实在没路时才与别的线挤在一起（而不是无视它们，也不是为了躲线去穿模块）。 */
  softAvoid: Array<[{ x: number; y: number }, { x: number; y: number }]> = [],
): WireRoute | null {
  const SOFT_PENALTY = 1000;
  const blockers = obstacles.filter((o) => o.id !== skipA && o.id !== skipB);
  if (!blockers.length) return null;
  const MARGIN = 300;
  // 规模封顶用「均匀抽稀」而不是「取最近的」：绕开整片模块的高速通道（网格下方的
  // 空带）离走廊中点很远，取最近会把它抽掉。
  const spread = (arr: number[], keep: number): number[] => {
    if (arr.length <= keep) return arr;
    const step = Math.ceil(arr.length / keep);
    return arr.filter((_, i) => i % step === 0);
  };
  const xs = [
    ...new Set([
      a.x,
      b.x,
      ...spread(
        gapLanes(
          Math.min(a.x, b.x) - MARGIN,
          Math.max(a.x, b.x) + MARGIN,
          blockers.filter((o) => inCorridorY(o, a, b)).map((o) => [o.x, o.x + o.w]),
        ),
        24,
      ),
    ]),
  ].sort((p, q) => p - q);
  const ys = [
    ...new Set([
      a.y,
      b.y,
      ...spread(
        gapLanes(
          Math.min(a.y, b.y) - MARGIN,
          Math.max(a.y, b.y) + MARGIN,
          blockers.filter((o) => inCorridorX(o, a, b)).map((o) => [o.y, o.y + o.h]),
        ),
        24,
      ),
    ]),
  ].sort((p, q) => p - q);
  const xi = xs.indexOf(a.x);
  const yi = ys.indexOf(a.y);
  const goalI = xs.indexOf(b.x);
  const goalJ = ys.indexOf(b.y);
  if (xi < 0 || yi < 0 || goalI < 0 || goalJ < 0) return null;
  const nodeAt = (i: number, j: number): { x: number; y: number } => ({ x: xs[i]!, y: ys[j]! });
  const start = yi * xs.length + xi;
  const goal = goalJ * xs.length + goalI;
  // 局部裁剪：路线必然落在网格范围内，范围之外的障碍/引脚/已布线段不可能被碰到。
  // 不做这层裁剪的话每次搜索都要扫全画布（大电路上万个引脚），155 根线的计算器
  // 会从 100ms 涨到 1.2s。
  const bx0 = xs[0]! - 16;
  const bx1 = xs[xs.length - 1]! + 16;
  const by0 = ys[0]! - 16;
  const by1 = ys[ys.length - 1]! + 16;
  const inside = (x: number, y: number): boolean => x >= bx0 && x <= bx1 && y >= by0 && y <= by1;
  const nearBox = (p: { x: number; y: number }, q: { x: number; y: number }): boolean =>
    Math.min(p.x, q.x) <= bx1 &&
    Math.max(p.x, q.x) >= bx0 &&
    Math.min(p.y, q.y) <= by1 &&
    Math.max(p.y, q.y) >= by0;
  const local: RouteObstacle[] = [];
  for (const ob of obstacles) {
    if (ob.id !== skipA && ob.id !== skipB) {
      if (ob.x + ob.w < bx0 || ob.x > bx1 || ob.y + ob.h < by0 || ob.y > by1) continue;
    }
    local.push({ ...ob, pins: (ob.pins ?? []).filter((pt) => inside(pt.x, pt.y)) });
  }
  const soft = softAvoid.filter(([p, q]) => nearBox(p, q));
  // 每条网格线只可能被「横跨这条线」的矩形和「离这条线 < 引脚半径」的引脚挡住，
  // 于是先按线把这些候选筛出来（每条约 300 个检查 × 48 条线），每条边就只需查
  // 少数几个对象。不筛的话每次搜索要在上千条边上各扫全部障碍/引脚（实测占大头）。
  const lineRelevant = new Map<number, RouteObstacle[]>();
  const buildLine = (vertical: boolean, idx: number, coord: number): void => {
    const out: RouteObstacle[] = [];
    for (const ob of local) {
      const spans = vertical
        ? ob.x <= coord && coord <= ob.x + ob.w
        : ob.y <= coord && coord <= ob.y + ob.h;
      const pins = (ob.pins ?? []).filter((pt) =>
        vertical ? Math.abs(pt.x - coord) <= pinRadius : Math.abs(pt.y - coord) <= pinRadius,
      );
      if (!spans && !pins.length) continue;
      // 不横跨该线的矩形只需保留引脚（盒子本身碰不到这条线上的线段）
      out.push(spans ? { ...ob, pins } : { id: ob.id, x: ob.x, y: ob.y, w: ob.w, h: ob.h, pins });
    }
    lineRelevant.set(vertical ? idx : xs.length + idx, out);
  };
  for (let i = 0; i < xs.length; i += 1) buildLine(true, i, xs[i]!);
  for (let j = 0; j < ys.length; j += 1) buildLine(false, j, ys[j]!);
  // 按网格线预索引软避让线段：竖直边只可能被「x 贴近这条网格线」的竖直线段并行贴近，
  // 水平边同理（垂直相交是交叉，不算贴近）。预索引后每条边只查少数几根线，而不是
  // 全画布上百根——否则代价循环占掉一半耗时（100+ 根线时每次搜索上千条边）。
  const nearVert = new Map<number, typeof soft>();
  const nearHorz = new Map<number, typeof soft>();
  for (let i = 0; i < xs.length; i += 1) {
    const lineX = xs[i]!;
    nearVert.set(
      i,
      soft.filter(([p, q]) => p.x === q.x && Math.abs(p.x - lineX) <= 6),
    );
  }
  for (let j = 0; j < ys.length; j += 1) {
    const lineY = ys[j]!;
    nearHorz.set(
      j,
      soft.filter(([p, q]) => p.y === q.y && Math.abs(p.y - lineY) <= 6),
    );
  }
  /** 这条边是否「不穿盒、不压引脚」（与其他导线的贴近只按代价罚分，不直接否决） */
  const clear = (p: { x: number; y: number }, q: { x: number; y: number }, key: number): boolean =>
    routeClear([[p, q]], lineRelevant.get(key) ?? [], skipA, skipB, [], pinRadius, [a, b]);
  const dist = new Map<number, number>();
  const from = new Map<number, number>();
  dist.set(start, 0);
  // 二叉堆取最小（网格最多 24×24 个节点，线性扫描找最小是 O(n²)，实测占掉大半耗时）
  const heap: number[] = [start];
  const better = (x: number, y: number): boolean =>
    (dist.get(x) ?? Infinity) < (dist.get(y) ?? Infinity);
  const push = (id: number): void => {
    heap.push(id);
    let i = heap.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (!better(heap[i]!, heap[par]!)) break;
      const t = heap[par]!;
      heap[par] = heap[i]!;
      heap[i] = t;
      i = par;
    }
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && better(heap[l]!, heap[m]!)) m = l;
        if (r < heap.length && better(heap[r]!, heap[m]!)) m = r;
        if (m === i) break;
        const t = heap[m]!;
        heap[m] = heap[i]!;
        heap[i] = t;
        i = m;
      }
    }
    return top;
  };
  const settled = new Set<number>();
  const neighbors = (id: number): number[] => {
    const i = id % xs.length;
    const j = Math.floor(id / xs.length);
    const out: number[] = [];
    if (i > 0) out.push(id - 1);
    if (i < xs.length - 1) out.push(id + 1);
    if (j > 0) out.push(id - xs.length);
    if (j < ys.length - 1) out.push(id + xs.length);
    return out;
  };
  while (heap.length) {
    const cur = pop();
    const bestD = dist.get(cur) ?? Infinity;
    if (settled.has(cur)) continue;
    settled.add(cur);
    if (cur === goal) break;
    for (const nb of neighbors(cur)) {
      const ci = cur % xs.length;
      const cj = Math.floor(cur / xs.length);
      const ni = nb % xs.length;
      const nj = Math.floor(nb / xs.length);
      const p = nodeAt(ci, cj);
      const q = nodeAt(ni, nj);
      if (cur === start && sideA && !outwardTurn(q, p, sideA)) continue;
      if (nb === goal && sideB && !outwardTurn(p, q, sideB)) continue;
      // 软避让的车道允许「贴近但完全重叠」也走（此时 clear 仍会用 gap 拦下），
      // 所以软避让线段从硬避让里排除
      if (!clear(p, q, ni === ci ? ci : xs.length + cj)) continue;
      let step = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
      if (soft.length) {
        // 竖直边只在「x 贴近本网格线」的线段里找并行贴近，水平边同理
        const list = (ni === ci ? nearVert.get(ci) : nearHorz.get(cj)) ?? [];
        let close = 0;
        for (const [r, s] of list) close += segsOverlapLen(p, q, r, s, 6);
        step += close * SOFT_PENALTY;
      }
      const nd = bestD + step;
      if (nd < (dist.get(nb) ?? Infinity)) {
        dist.set(nb, nd);
        from.set(nb, cur);
        push(nb);
      }
    }
  }
  if (!dist.has(goal)) return null;
  const path: Array<{ x: number; y: number }> = [];
  for (let id: number | undefined = goal; id !== undefined; id = from.get(id)) {
    path.push(nodeAt(id % xs.length, Math.floor(id / xs.length)));
    if (id === start) break;
  }
  path.reverse();
  // 简化：丢掉重复点、合并共线点（网格路径有很多冗余拐点）
  const dedup: Array<{ x: number; y: number }> = [];
  for (const p of [a, ...path, b]) {
    const last = dedup[dedup.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    dedup.push(p);
  }
  const out: Array<{ x: number; y: number }> = [];
  for (const p of dedup) {
    const last = out[out.length - 1];
    const prev = out[out.length - 2];
    if (
      last &&
      prev &&
      ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))
    ) {
      out[out.length - 1] = p;
    } else {
      out.push(p);
    }
  }
  if (out.length < 2) return null;
  const segs: WireRoute = [];
  for (let i = 0; i + 1 < out.length; i++) segs.push([out[i]!, out[i + 1]!]);
  return segs.length ? segs : null;
}

/**
 * 多折点绕行候选：单折点 Z 形被障碍全拒（共享信号跨多列且中间全堵）时，
 * 沿「障碍之间的空带/空列」扫出 5 段绕行。空带 = 不被任何非端点元件矩形覆盖的
 * 水平带（垂直同理），取带中心做拐点；竖先/横先各生成一份，交给 routeClear 验证
 * （贴矩形边缘的窄缝仍算候选，靠引脚半径检查兜底，避免「宁可穿盒」的坏路线）。
 */
function detourCandidates(
  a: { x: number; y: number },
  b: { x: number; y: number },
  obstacles: RouteObstacle[],
  skipA: string,
  skipB: string,
): Array<Array<[{ x: number; y: number }, { x: number; y: number }]>> {
  const blockers = obstacles.filter((o) => o.id !== skipA && o.id !== skipB);
  if (!blockers.length) return [];
  const yLo = Math.min(a.y, b.y) - 240;
  const yHi = Math.max(a.y, b.y) + 240;
  const xLo = Math.min(a.x, b.x) - 240;
  const xHi = Math.max(a.x, b.x) + 240;
  // 空带只看「x 与走廊重叠」的障碍（水平段只会在 a.x..b.x 之间走）；空列同理。
  // 否则画布边缘的端口/电源会吞掉中间的有效 gap（如 out-q 覆盖 133..267 吃掉
  // 219..237 的空带），多折点绕行直接无解。
  const corridorX = (o: RouteObstacle): boolean =>
    o.x < Math.max(a.x, b.x) && o.x + o.w > Math.min(a.x, b.x);
  const corridorY = (o: RouteObstacle): boolean =>
    o.y < Math.max(a.y, b.y) && o.y + o.h > Math.min(a.y, b.y);
  const bands = gapMids(
    yLo,
    yHi,
    blockers.filter(corridorX).map((o) => [o.y, o.y + o.h] as [number, number]),
  );
  const cols = gapMids(
    xLo,
    xHi,
    blockers.filter(corridorY).map((o) => [o.x, o.x + o.w] as [number, number]),
  );
  const out: WireRoute[] = [];
  for (const gy of bands) {
    for (const gx of cols) {
      // 竖先：先垂直到空带，再横到空列，再垂直接近 b
      const vFirst: WireRoute = [
        [a, { x: a.x, y: gy }],
        [
          { x: a.x, y: gy },
          { x: gx, y: gy },
        ],
        [
          { x: gx, y: gy },
          { x: gx, y: b.y },
        ],
        [{ x: gx, y: b.y }, b],
      ];
      // 横先：先横到空列，再垂直到空带，再水平接近 b
      const hFirst: WireRoute = [
        [a, { x: gx, y: a.y }],
        [
          { x: gx, y: a.y },
          { x: gx, y: gy },
        ],
        [
          { x: gx, y: gy },
          { x: b.x, y: gy },
        ],
        [{ x: b.x, y: gy }, b],
      ];
      out.push(vFirst, hFirst);
    }
  }
  return out;
}

/**
 * 避障布线：优先走「不穿过任何元件、不压未连接引脚、不与已有导线重叠」的折线。
 * 候选依次尝试 —— 直连 / 横先 Z / 竖先 Z / 各自向两侧挪 48/96/144，
 * 第一个不撞元件矩形（两端点所属元件除外）与未连接引脚、且不与已布线段平行贴近的
 * 方案胜出（交叉仍允许）；都不行再退回默认中点线（保证永远画得出）。
 */
export function routeSegments(
  a: { x: number; y: number },
  b: { x: number; y: number },
  seed = 0,
  obstacles: RouteObstacle[] = [],
  skipA = '',
  skipB = '',
  /** 已布好的其他导线线段（平行重叠/贴近则淘汰候选；交叉仍允许） */
  avoid: Array<[{ x: number; y: number }, { x: number; y: number }]> = [],
): Array<[{ x: number; y: number }, { x: number; y: number }]> {
  const off = seed === 0 ? 0 : seedOffset(String(seed));
  const alignedX = Math.abs(a.x - b.x) < 1;
  const alignedY = Math.abs(a.y - b.y) < 1;
  const candidates: Array<Array<[{ x: number; y: number }, { x: number; y: number }]>> = [];
  if (alignedX || alignedY) {
    candidates.push([[a, b]]);
    for (const d of ROUTE_OFFSETS) {
      if (alignedX)
        candidates.push([
          [a, { x: a.x + d, y: a.y }],
          [
            { x: a.x + d, y: a.y },
            { x: a.x + d, y: b.y },
          ],
          [{ x: a.x + d, y: b.y }, b],
        ]);
      else
        candidates.push([
          [a, { x: a.x, y: a.y + d }],
          [
            { x: a.x, y: a.y + d },
            { x: b.x, y: a.y + d },
          ],
          [{ x: b.x, y: a.y + d }, b],
        ]);
    }
  } else {
    const mx0 = (a.x + b.x) / 2 + off;
    const my0 = (a.y + b.y) / 2 + off;
    const pick = (mx: number, my: number): void => {
      candidates.push([
        [a, { x: mx, y: a.y }],
        [
          { x: mx, y: a.y },
          { x: mx, y: b.y },
        ],
        [{ x: mx, y: b.y }, b],
      ]);
      candidates.push([
        [a, { x: a.x, y: my }],
        [
          { x: a.x, y: my },
          { x: b.x, y: my },
        ],
        [{ x: b.x, y: my }, b],
      ]);
    };
    pick(mx0, my0);
    for (const d of ROUTE_OFFSETS) pick(mx0 + d, my0 + d);
  }
  const boxOf = (id: string): RouteObstacle | undefined => obstacles.find((o) => o.id === id);
  for (const cand of candidates) {
    // 出线段必须从「引脚的外侧」接近端点元件，否则折线会沿引脚高度水平
    // 横穿进器件（比如从左侧平穿二极管到右侧引脚）。对每一段：若它跟引脚
    // 同方向（水平段 vs 左右侧引脚 / 垂直段 vs 上下侧引脚），拐点就得在
    // 引脚的外侧；朝器件内部拐的候选直接淘汰，让避障换方向绕。
    const sideA = pinSide(a, boxOf(skipA));
    const sideB = pinSide(b, boxOf(skipB));
    if (sideA && cand[0] && !outwardTurn(cand[0][1], cand[0][0], sideA)) continue;
    if (
      sideB &&
      cand[cand.length - 1] &&
      !outwardTurn(cand[cand.length - 1][0], cand[cand.length - 1][1], sideB)
    )
      continue;
    if (!obstacles.length && !avoid.length) return cand;
    if (routeClear(cand, obstacles, skipA, skipB, avoid, PIN_RADIUS, [a, b])) return cand;
  }
  // 单折点全被拒 → 多折点绕行（空带/空列扫描）。同样过方向约束与避障检查。
  const detours = detourCandidates(a, b, obstacles, skipA, skipB);
  for (const cand of detours) {
    const sideA = pinSide(a, boxOf(skipA));
    const sideB = pinSide(b, boxOf(skipB));
    if (sideA && cand[0] && !outwardTurn(cand[0][1], cand[0][0], sideA)) continue;
    if (
      sideB &&
      cand[cand.length - 1] &&
      !outwardTurn(cand[cand.length - 1][0], cand[cand.length - 1][1], sideB)
    )
      continue;
    if (routeClear(cand, obstacles, skipA, skipB, avoid, PIN_RADIUS, [a, b])) return cand;
  }
  const sideA = pinSide(a, boxOf(skipA));
  const sideB = pinSide(b, boxOf(skipB));
  // 走到这里说明固定形状候选没有一个「全清」的。用通道网格（任意拐点数）再搜一条：
  // 它同时干两件事 —— ① 硬规则：绝不穿模块内部；② 借软避让代价挑空闲通道把导线散开。
  // 硬避让（其他导线）在这里降级成「按贴近长度罚分」的软约束：挤在一起只是难看，
  // 穿进模块里面是错的。
  {
    const grid = channelRoute(a, b, obstacles, skipA, skipB, PIN_RADIUS, sideA, sideB, avoid);
    const head = grid?.[0];
    const tail = grid?.[grid.length - 1];
    const okA = !sideA || !head || outwardTurn(head[1], head[0], sideA);
    const okB = !sideB || !tail || outwardTurn(tail[0], tail[1], sideB);
    if (grid && okA && okB) return grid;
  }
  // 兜底：没有候选全清时，挑「坏」得最少的（优先不穿元件、不压引脚、不贴线），
  // 而不是无脑取第一条直连——密集区也不会横穿引脚/元件。
  const pool = candidates.length ? [...candidates, ...detours] : detours;
  let best = pool[0] ?? [[a, b]];
  let bestScore = Infinity;
  for (const cand of pool) {
    const score = routeViolations(cand, obstacles, skipA, skipB, avoid, PIN_RADIUS, [a, b]);
    if (score < bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

export type WireRoute = Array<[{ x: number; y: number }, { x: number; y: number }]>;

/** 布线结果缓存：画布对象不变时，渲染与命中测试共用同一份布线，不重复计算 */
const routeCache = new WeakMap<Doc, Map<string, WireRoute>>();

/**
 * 一次性为整份画布布线：按导线顺序逐条避障——每条新线都把「已布好的线段」当障碍
 * （平行重叠/贴近的候选直接淘汰，交叉仍允许），从根源上杜绝导线重叠。
 * 结果按 wire id 存进 Map（doc 每次编辑都是新对象，缓存自动失效）。
 */
export function routeWires(doc: Doc): Map<string, WireRoute> {
  const cached = routeCache.get(doc);
  if (cached) return cached;
  const obstacles = routeObstacles(doc);
  const placed: WireRoute = [];
  const result = new Map<string, WireRoute>();
  for (const wire of doc.wires) {
    const a = pinWorld(doc, wire.a.inst, wire.a.pin, wire.a.bit ?? 0);
    const b = pinWorld(doc, wire.b.inst, wire.b.pin, wire.b.bit ?? 0);
    if (!a || !b) {
      result.set(wire.id, []);
      continue;
    }
    const segs = routeSegments(a, b, wire.id.length, obstacles, wire.a.inst, wire.b.inst, placed);
    result.set(wire.id, segs);
    placed.push(...segs);
  }
  routeCache.set(doc, result);
  return result;
}

/** 线段去重 key（端点取整到 0.5，同一条公共段只画一次，消灭扇出重影） */
function segKey(p: { x: number; y: number }, q: { x: number; y: number }): string {
  const a = [Math.round(p.x * 2) / 2, Math.round(p.y * 2) / 2];
  const b = [Math.round(q.x * 2) / 2, Math.round(q.y * 2) / 2];
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])
    ? `${a[0]},${a[1]}>${b[0]},${b[1]}`
    : `${b[0]},${b[1]}>${a[0]},${a[1]}`;
}

function distanceToSegment(
  px: number,
  py: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - a.x, py - a.y);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/**
 * 整网并查集：共享同一引脚端点（inst:pin:bit）的线归为同一网，返回 线id → 网根。
 * bit 必须进端点键：多 bit 端口（bin/bcd 等）每个 bit 是独立引脚、独立信号，
 * 只按 inst:pin 合并会把 bcd[3:0] 的 4 根线误并成一张网（悬停 bcd0 会连带点亮 bcd1..3）。
 */
export function netRootsOf(
  wires: Array<{ id: string; a: PinRef; b: PinRef }>,
): Map<string, string> {
  const parent = new Map<string, string>();
  for (const wire of wires) parent.set(wire.id, wire.id);
  const find = (id: string): string => {
    let cur = id;
    while (parent.get(cur) !== cur) cur = parent.get(cur) ?? cur;
    parent.set(id, cur);
    return cur;
  };
  const endpointOwner = new Map<string, string>();
  for (const wire of wires) {
    for (const end of [wire.a, wire.b]) {
      const key = `${end.inst}:${end.pin}:${end.bit ?? 0}`;
      const owner = endpointOwner.get(key);
      if (owner === undefined) endpointOwner.set(key, wire.id);
      else parent.set(find(wire.id), find(owner));
    }
  }
  const netOf = new Map<string, string>();
  for (const wire of wires) netOf.set(wire.id, find(wire.id));
  return netOf;
}

export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { doc, camera, width, height } = scene;
  ctx.save();
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, width, height);

  if (scene.grid) drawGrid(ctx, scene);

  // 导线：先按「线段去重」画一遍底色（公共段只画一次，不再叠成重影），
  // 再单独高亮 hover / 选中的线。
  // 整网高亮：把共享引脚（inst:pin:bit）的线归到同一个网，hover/选中时整网点亮、其余压暗
  const wires = doc.wires;
  const netOf = netRootsOf(wires);
  const activeWireIds = new Set<string>([...scene.selectedWires]);
  if (scene.hover?.kind === 'wire') activeWireIds.add(scene.hover.id);
  const activeNets = new Set<string>();
  for (const id of activeWireIds) {
    const net = netOf.get(id);
    if (net) activeNets.add(net);
  }
  const netDimmed = activeNets.size > 0;
  const routes = routeWires(doc);

  const segments: Array<{ wire: Wire; a: { x: number; y: number }; b: { x: number; y: number } }> =
    [];
  const seen = new Set<string>();
  const line = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
    const sp = worldToScreen(camera, width, height, from.x, from.y);
    const sq = worldToScreen(camera, width, height, to.x, to.y);
    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y);
    ctx.lineTo(sq.x, sq.y);
    ctx.stroke();
  };
  for (const wire of doc.wires) {
    const segs = routes.get(wire.id);
    if (!segs) continue;
    for (const [p, q] of segs) segments.push({ wire, a: p, b: q });
  }
  ctx.save();
  ctx.lineCap = 'round';
  for (const seg of segments) {
    const key = segKey(seg.a, seg.b);
    if (seen.has(key)) continue; // 同一条公共段，只画一次
    seen.add(key);
    const net = netOf.get(seg.wire.id) ?? '';
    const inActiveNet = activeNets.has(net);
    const style = signalStyle(scene.pinSignals.get(pinKey(seg.wire.a)) ?? SIG_Z);
    ctx.globalAlpha = netDimmed && !inActiveNet ? 0.3 : 1;
    ctx.strokeStyle = inActiveNet ? PALETTE.selection : style.color;
    ctx.lineWidth = (inActiveNet ? style.width + 1 : style.width) * Math.min(1.6, camera.scale);
    ctx.setLineDash(style.dash.map((d) => d * camera.scale));
    line(seg.a, seg.b);
  }
  ctx.globalAlpha = 1;
  for (const seg of segments) {
    const selected = scene.selectedWires.includes(seg.wire.id);
    const hovered = scene.hover?.kind === 'wire' && scene.hover.id === seg.wire.id;
    if (!selected && !hovered) continue;
    const net = netOf.get(seg.wire.id) ?? '';
    ctx.strokeStyle = selected || activeNets.has(net) ? PALETTE.selection : PALETTE.hover;
    ctx.lineWidth =
      (signalStyle(scene.pinSignals.get(pinKey(seg.wire.a)) ?? SIG_Z).width + 1.5) *
      Math.min(1.6, camera.scale);
    ctx.setLineDash([]);
    line(seg.a, seg.b);
  }
  ctx.restore();

  // 连接点圆点：同一引脚被 ≥2 根线共用时画一个实心点，连接关系一目了然
  const jointCount = new Map<string, number>();
  for (const wire of doc.wires) {
    for (const end of [wire.a, wire.b]) {
      const key = `${end.inst}:${end.pin}[${end.bit ?? 0}]`;
      jointCount.set(key, (jointCount.get(key) ?? 0) + 1);
    }
  }
  for (const wire of doc.wires) {
    for (const end of [wire.a, wire.b]) {
      const key = `${end.inst}:${end.pin}[${end.bit ?? 0}]`;
      if ((jointCount.get(key) ?? 0) < 2) continue;
      const p = pinWorld(doc, end.inst, end.pin, end.bit ?? 0);
      if (!p) continue;
      const sp = worldToScreen(camera, width, height, p.x, p.y);
      const r = Math.max(2.6, 4.5 * camera.scale);
      ctx.save();
      ctx.fillStyle = '#9fb2c4';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // 连线中的橡皮筋（预览也走避障布线：绕开元件/引脚/已布导线，所见即所得）
  if (scene.pendingPin && scene.pendingPoint) {
    const from = pinWorld(
      doc,
      scene.pendingPin.inst,
      scene.pendingPin.pin,
      scene.pendingPin.bit ?? 0,
    );
    if (from) {
      const placed: WireRoute = [];
      for (const segs of routeWires(doc).values()) placed.push(...segs);
      const segs = routeSegments(
        from,
        scene.pendingPoint,
        0,
        routeObstacles(doc),
        scene.pendingPin.inst,
        '',
        placed,
      );
      ctx.save();
      ctx.strokeStyle = PALETTE.hover;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      let first = true;
      for (const [p, q] of segs) {
        const sp = worldToScreen(camera, width, height, p.x, p.y);
        const sq = worldToScreen(camera, width, height, q.x, q.y);
        if (first) {
          ctx.moveTo(sp.x, sp.y);
          first = false;
        }
        ctx.lineTo(sq.x, sq.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // 教学关场景背景（墙/门洞等装饰，画在元件与导线之下，跟随平移缩放）
  if (doc.backdrop) {
    for (const b of doc.backdrop) drawBackdrop(ctx, scene, b);
  }

  for (const sym of doc.syms) drawSymbol(ctx, scene, sym);

  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { camera, width, height } = scene;
  const step = 20 * camera.scale;
  if (step < 6) return;
  const origin = worldToScreen(camera, width, height, 0, 0);
  ctx.save();
  ctx.lineWidth = 1;
  for (let x = origin.x % step; x < width; x += step) {
    const world = Math.round(((x - width / 2) / camera.scale + camera.x) / 20) * 20;
    ctx.strokeStyle = world % 100 === 0 ? PALETTE.gridStrong : PALETTE.grid;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
    ctx.stroke();
  }
  for (let y = origin.y % step; y < height; y += step) {
    const world = Math.round(((y - height / 2) / camera.scale + camera.y) / 20) * 20;
    ctx.strokeStyle = world % 100 === 0 ? PALETTE.gridStrong : PALETTE.grid;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

/** 教学关场景背景：墙 / 门洞（纯装饰，半透明，不遮住元件） */
function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  b: import('./model.ts').BackdropItem,
): void {
  const { camera, width, height } = scene;
  const p = worldToScreen(camera, width, height, b.x, b.y);
  const sw = b.w * camera.scale;
  const sh = b.h * camera.scale;
  ctx.save();
  ctx.fillStyle = 'rgba(62, 82, 102, 0.2)';
  ctx.strokeStyle = 'rgba(120, 155, 190, 0.38)';
  ctx.lineWidth = 2;
  ctx.fillRect(p.x, p.y, sw, sh);
  ctx.strokeRect(p.x, p.y, sw, sh);
  // 顶面（受光）
  ctx.fillStyle = 'rgba(150, 185, 215, 0.22)';
  ctx.fillRect(p.x, p.y, sw, Math.max(3, 4 * camera.scale));
  if (b.kind === 'doorFrame') {
    // 门洞：墙内挖一个深色门洞
    const dx = p.x + sw * 0.3;
    const dw = sw * 0.4;
    const dy = p.y + sh * 0.12;
    const dh = sh * 0.76;
    ctx.fillStyle = 'rgba(6, 10, 15, 0.92)';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = 'rgba(90, 112, 132, 0.5)';
    ctx.strokeRect(dx, dy, dw, dh);
  }
  ctx.restore();
}

/**
 * 教学关实物图标（画在端口位置、世界坐标原点居中、由信号驱动状态）：
 * - button 按钮（输入）：按下=1 发亮，松开=0 灰
 * - lamp   灯泡（输出）：亮=1 发黄光，灭=0 灰
 * - bell   铃铛（输出）：响=1 发黄，不响=0 灰
 * - door   门（输出）：关好=1 贴框，开着=0 甩开
 */
function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: NonNullable<Sym['sprite']>,
  signal: number,
): void {
  const on = logicValueOf(signal) === 1; // 亮 / 响 / 开
  const onColor = '#ffd479';
  const onSoft = 'rgba(255,212,121,0.3)';
  const offFill = '#2a3139';
  const offStroke = '#5b6b7d';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (sprite === 'button') {
    // 按钮：按下（1）= 发亮并压下；松开（0）= 灰并弹起
    ctx.strokeStyle = on ? onColor : offStroke;
    ctx.fillStyle = on ? onSoft : offFill;
    ctx.beginPath();
    ctx.arc(0, -4, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 按钮杆：按下时缩进去（状态由图形表达，不画文字避免与端口名重叠）
    ctx.fillStyle = on ? onColor : offStroke;
    ctx.fillRect(-5, on ? 10 : 8, 10, on ? 4 : 6);
    ctx.strokeRect(-7, 14, 14, 4);
  } else if (sprite === 'lamp') {
    // 灯泡：亮（1）= 发黄光 + 光线；灭（0）= 灰玻璃
    if (on) {
      ctx.fillStyle = onSoft;
      ctx.beginPath();
      ctx.arc(0, -5, 20, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = on ? onColor : offStroke;
    ctx.fillStyle = on ? onColor : offFill;
    ctx.beginPath();
    ctx.arc(0, -5, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 灯丝
    ctx.strokeStyle = on ? '#fff6d9' : PALETTE.bodyDim;
    ctx.beginPath();
    ctx.moveTo(-3, -7);
    ctx.lineTo(0, -4);
    ctx.lineTo(3, -7);
    ctx.stroke();
    // 底座
    ctx.strokeStyle = on ? onColor : offStroke;
    ctx.fillStyle = on ? 'rgba(255,212,121,0.5)' : '#232a31';
    ctx.beginPath();
    ctx.moveTo(-6, 5);
    ctx.lineTo(6, 5);
    ctx.lineTo(4, 12);
    ctx.lineTo(-4, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 底座下的「参考地」装饰：输出是信号监视器，灯的另一端默认接公共地
    // （地是所有信号的参考，不用玩家接）——画成小号接地符，纯视觉不参与电路
    ctx.strokeStyle = on ? 'rgba(255,212,121,0.55)' : '#3f4b57';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, 12);
    ctx.lineTo(0, 15);
    ctx.stroke();
    for (const [idx, w] of [5, 3.2, 1.6].entries()) {
      ctx.beginPath();
      ctx.moveTo(-w, 15 + idx * 2.4);
      ctx.lineTo(w, 15 + idx * 2.4);
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    if (on) {
      ctx.strokeStyle = onColor;
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 20, -5 + Math.sin(a) * 20);
        ctx.lineTo(Math.cos(a) * 27, -5 + Math.sin(a) * 27);
        ctx.stroke();
      }
      ctx.lineWidth = 2;
    }
  } else if (sprite === 'bell') {
    // 铃铛：响（1）= 发黄 + 两边的「叮」；不响（0）= 灰
    ctx.strokeStyle = on ? onColor : offStroke;
    ctx.fillStyle = on ? onColor : offFill;
    ctx.beginPath();
    ctx.arc(0, -2, 13, Math.PI, 0);
    ctx.lineTo(12, 8);
    ctx.lineTo(-12, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 铃锤
    ctx.strokeStyle = on ? onColor : offStroke;
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(0, 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 17, 3, 0, Math.PI * 2);
    ctx.stroke();
    // 提手
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(0, -18);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -21, 3, 0, Math.PI * 2);
    ctx.stroke();
    if (on) {
      ctx.strokeStyle = onColor;
      ctx.lineWidth = 1.6;
      for (const dir of [1, -1]) {
        ctx.beginPath();
        ctx.moveTo(18 * dir, 2);
        ctx.quadraticCurveTo(26 * dir, 2, 26 * dir, -5);
        ctx.stroke();
      }
      ctx.lineWidth = 2;
    }
  } else if (sprite === 'battery') {
    // 电池：有电（1）= 绿色 + 满格；没电（0）= 灰 + 空。方向感来自正负极标记
    ctx.strokeStyle = on ? '#5cc482' : offStroke;
    ctx.fillStyle = on ? 'rgba(92,196,130,0.25)' : offFill;
    ctx.fillRect(-13, -8, 26, 26);
    ctx.strokeRect(-13, -8, 26, 26);
    // 正负极凸起：上 + 下 −
    ctx.fillStyle = on ? '#5cc482' : offStroke;
    ctx.fillRect(7, -15, 8, 7); // 正极凸起
    ctx.fillRect(-15, 12, 6, 8); // 负极条
    // 电量格
    const bars = on ? 3 : 0;
    ctx.fillStyle = on ? '#5cc482' : '#3a434d';
    for (let i = 0; i < 3; i++) {
      const fill = i < bars;
      ctx.fillStyle = fill ? '#5cc482' : '#3a434d';
      ctx.fillRect(-9 + i * 6, -4, 4, 18);
    }
    // + − 标记
    ctx.fillStyle = on ? '#d9ffe9' : PALETTE.bodyDim;
    ctx.font = 'bold 10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('+', 11, -19);
    ctx.fillText('−', -12, 25);
  } else if (sprite === 'door') {
    // 门：门框 + 门扇。关好（1）= 门扇贴框；开着（0）= 门扇甩开
    ctx.strokeStyle = offStroke;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(-14, -20, 28, 40);
    ctx.lineWidth = 2;
    if (on) {
      ctx.fillStyle = on ? 'rgba(92,196,130,0.25)' : offFill;
      ctx.strokeStyle = on ? '#5cc482' : offStroke;
      ctx.fillRect(-11, -17, 22, 34);
      ctx.strokeRect(-11, -17, 22, 34);
      ctx.fillStyle = on ? '#5cc482' : PALETTE.bodyDim;
      ctx.beginPath();
      ctx.arc(7, 0, 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = offStroke;
      ctx.beginPath();
      ctx.moveTo(-14, -20);
      ctx.lineTo(-2, -10);
      ctx.lineTo(-2, 10);
      ctx.lineTo(-14, 20);
      ctx.closePath();
      ctx.stroke();
    }
  }
}

/**
 * 七段数码管（计算器屏幕）：按 7 位段码位图点亮段（bit0=a..bit6=g）。
 * 段编号（共阴极）：0 上横、1 右上竖、2 右下竖、3 下横、4 左下竖、5 左上竖、6 中横。
 * 数码管 7 位化后不再内部译码——电路自己把 BCD 译成 7 根段信号（s3-display 搭译码器）。
 */
function drawSegment(ctx: CanvasRenderingContext2D, bitmap: number): void {
  const on = new Set<number>();
  for (let s = 0; s < 7; s++) if ((bitmap >> s) & 1) on.add(s);
  // 每个段一个「段条」：x/y 用世界坐标（原点在端口中心）
  const seg = [
    { s: 0, x1: -16, y1: -26, x2: 16, y2: -26 },
    { s: 1, x1: 18, y1: -24, x2: 18, y2: 0 },
    { s: 2, x1: 18, y1: 2, x2: 18, y2: 26 },
    { s: 3, x1: -16, y1: 28, x2: 16, y2: 28 },
    { s: 4, x1: -18, y1: 2, x2: -18, y2: 26 },
    { s: 5, x1: -18, y1: -24, x2: -18, y2: 0 },
    { s: 6, x1: -16, y1: 1, x2: 16, y2: 1 },
  ];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  for (const g of seg) {
    const lit = on.has(g.s);
    ctx.strokeStyle = lit ? '#ffd479' : 'rgba(60,74,88,0.55)';
    ctx.beginPath();
    ctx.moveTo(g.x1, g.y1);
    ctx.lineTo(g.x2, g.y2);
    ctx.stroke();
  }
  // 外壳
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(90,112,132,0.6)';
  ctx.strokeRect(-24, -32, 48, 64);
}

function drawSymbol(ctx: CanvasRenderingContext2D, scene: Scene, sym: Sym): void {
  const { doc, camera, width, height } = scene;
  const p = worldToScreen(camera, width, height, sym.x, sym.y);
  const selected = scene.selection.includes(sym.id);
  const hovered = scene.hover?.kind === 'sym' && scene.hover.id === sym.id;
  const key = symKindKey(sym);

  ctx.save();
  ctx.translate(p.x, p.y);

  // 选中/悬停光晕
  if (selected || hovered) {
    const box = key === 'module' ? moduleBox(sym, doc.library) : null;
    const f = footprintOf(sym, doc.library);
    ctx.save();
    ctx.strokeStyle = selected ? PALETTE.selection : PALETTE.hover;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    const w = (box ? box.w : f.w) * camera.scale * 0.5 + 6;
    const h = (box ? box.h : Math.abs(f.h)) * camera.scale * 0.5 + 6;
    ctx.strokeRect(-w, -h, w * 2, h * 2);
    ctx.restore();
  }

  ctx.rotate((sym.rot * Math.PI) / 2);
  ctx.scale(camera.scale, camera.scale);
  ctx.lineWidth = 2 / camera.scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = PALETTE.body;
  ctx.fillStyle = PALETTE.fill;
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';

  // 引脚引线 + 端点：颜色 = 该引脚所在网络电平
  for (const off of pinOffsets({ ...sym, rot: 0 }, doc.library)) {
    const signal = scene.pinSignals.get(pinKey({ inst: sym.id, pin: off.name, bit: 0 }));
    const style = signalStyle(signal ?? SIG_Z);
    const len = Math.hypot(off.x, off.y);
    const stub = 0.78;
    ctx.save();
    ctx.strokeStyle = signal === undefined ? PALETTE.bodyDim : style.color;
    ctx.lineWidth = (signal === undefined ? 1.6 : style.width) / camera.scale;
    ctx.setLineDash(style.dash.map((d) => d / camera.scale));
    ctx.beginPath();
    // 模块：引线从方框边缘（±半宽）画到外端引脚；其余元件保持原内缩短引线
    const start =
      key === 'module'
        ? { x: Math.sign(off.x) * MODULE_HALF_WIDTH, y: off.y }
        : { x: off.x * stub, y: off.y * stub };
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(off.x, off.y);
    ctx.stroke();
    ctx.restore();

    // 端点圆点：空心 = 未接线
    ctx.save();
    ctx.fillStyle = signal === undefined ? PALETTE.bg : style.color;
    ctx.strokeStyle = signal === undefined ? PALETTE.bodyDim : style.color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(off.x, off.y, len > 20 ? 3.2 : 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  switch (key) {
    case 'npn': {
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-9, -11);
      ctx.lineTo(-9, 11);
      ctx.lineWidth = 3 / camera.scale;
      ctx.stroke();
      ctx.lineWidth = 2 / camera.scale;
      // 基极引线：从圆左缘接到基极条，不再有断缝
      ctx.beginPath();
      ctx.moveTo(-19, 0);
      ctx.lineTo(-9, 0);
      ctx.stroke();
      ctx.lineWidth = 2 / camera.scale;
      // 集电极
      ctx.beginPath();
      ctx.moveTo(-9, -7);
      ctx.lineTo(0, -17);
      ctx.lineTo(0, -22);
      ctx.stroke();
      // 发射极 + 箭头
      ctx.beginPath();
      ctx.moveTo(-9, 7);
      ctx.lineTo(0, 17);
      ctx.lineTo(0, 22);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-1.5, 12.5);
      ctx.lineTo(4.5, 17.5);
      ctx.lineTo(-4, 19.5);
      ctx.closePath();
      ctx.fillStyle = PALETTE.body;
      ctx.fill();
      break;
    }
    case 'nmos':
    case 'pmos': {
      // MOS 符号：圆内一条栅极竖条，漏极在上、源极在下；P-MOS 栅极引线上带小圆圈
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-9, -11);
      ctx.lineTo(-9, 11);
      ctx.lineWidth = 3 / camera.scale;
      ctx.stroke();
      ctx.lineWidth = 2 / camera.scale;
      // 栅极引线：从圆左缘接到栅极条
      ctx.beginPath();
      ctx.moveTo(-19, 0);
      ctx.lineTo(-9, 0);
      ctx.stroke();
      ctx.lineWidth = 2 / camera.scale;
      // 漏极
      ctx.beginPath();
      ctx.moveTo(-9, -7);
      ctx.lineTo(0, -17);
      ctx.lineTo(0, -22);
      ctx.stroke();
      // 源极
      ctx.beginPath();
      ctx.moveTo(-9, 7);
      ctx.lineTo(0, 17);
      ctx.lineTo(0, 22);
      ctx.stroke();
      if (key === 'pmos') {
        ctx.beginPath();
        ctx.arc(-14, 0, 3.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'res': {
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(0, -11);
      ctx.moveTo(0, 11);
      ctx.lineTo(0, 22);
      ctx.stroke();
      ctx.fillRect(-8, -11, 16, 22);
      ctx.strokeRect(-8, -11, 16, 22);
      break;
    }
    case 'dio': {
      ctx.beginPath();
      ctx.moveTo(-22, 0);
      ctx.lineTo(-9, 0);
      ctx.moveTo(9, 0);
      ctx.lineTo(22, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-9, -9);
      ctx.lineTo(-9, 9);
      ctx.lineTo(9, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(9, -9);
      ctx.lineTo(9, 9);
      ctx.stroke();
      break;
    }
    case 'cap': {
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(-4, 0);
      ctx.moveTo(4, 0);
      ctx.lineTo(14, 0);
      ctx.stroke();
      ctx.lineWidth = 3 / camera.scale;
      ctx.beginPath();
      ctx.moveTo(-4, -9);
      ctx.lineTo(-4, 9);
      ctx.moveTo(4, -9);
      ctx.lineTo(4, 9);
      ctx.stroke();
      break;
    }
    case 'vcc': {
      // 标准电源符：引脚向上一条竖线 → 顶部一条 T 横杠
      ctx.beginPath();
      ctx.moveTo(0, 14);
      ctx.lineTo(0, 2);
      ctx.stroke();
      ctx.lineWidth = 2.6 / camera.scale;
      ctx.beginPath();
      ctx.moveTo(-9, 2);
      ctx.lineTo(9, 2);
      ctx.stroke();
      break;
    }
    case 'gnd': {
      // 标准接地符：引脚向下一条竖线，三条横杠从宽到窄
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(0, -2);
      ctx.stroke();
      ctx.lineWidth = 2.6 / camera.scale;
      for (const [idx, w] of [10, 6.5, 3].entries()) {
        ctx.beginPath();
        ctx.moveTo(-w, -2 + idx * 3.2);
        ctx.lineTo(w, -2 + idx * 3.2);
        ctx.stroke();
      }
      break;
    }
    case 'input':
    case 'output': {
      const isIn = key === 'input';
      // 教学关实物图标（按钮/灯泡/铃铛/门）：由信号驱动状态，替代抽象方框
      if (sym.sprite) {
        const sig = scene.pinSignals.get(pinKey({ inst: sym.id, pin: 'p', bit: 0 }));
        drawSprite(ctx, sym.sprite, sig ?? SIG_Z);
        break;
      }
      // 七段数码管（输出端口 display: 'segment'）：7 位段码位图，每根线点亮对应段（bit0=a..bit6=g）
      if (!isIn && sym.display === 'segment') {
        const width = sym.width ?? 1;
        let bitmap = 0;
        for (let bit = 0; bit < Math.min(width, 7); bit++) {
          const sig = scene.pinSignals.get(pinKey({ inst: sym.id, pin: 'p', bit }));
          if (sig !== undefined && logicValueOf(sig) === 1) bitmap |= 1 << bit;
        }
        drawSegment(ctx, bitmap);
        break;
      }
      const width = sym.width ?? 1;
      const h = Math.max(26, (width - 1) * 14 + 26);
      ctx.fillStyle = isIn ? PALETTE.portInFill : PALETTE.portOutFill;
      ctx.strokeStyle = isIn ? PALETTE.portInStroke : PALETTE.portOutStroke;
      ctx.fillRect(isIn ? -22 : -10, -h / 2, 32, h);
      ctx.strokeRect(isIn ? -22 : -10, -h / 2, 32, h);
      if (width <= 1) {
        ctx.strokeStyle = PALETTE.body;
        ctx.beginPath();
        ctx.moveTo(isIn ? 10 : -26, 0);
        ctx.lineTo(isIn ? 26 : -10, 0);
        ctx.stroke();
      } else {
        // 总线端口：每个 lane 一个引脚点 + 位序号
        ctx.strokeStyle = PALETTE.body;
        ctx.fillStyle = PALETTE.body;
        for (let bit = 0; bit < width; bit++) {
          const ly = (bit - (width - 1) / 2) * 14;
          ctx.beginPath();
          ctx.moveTo(isIn ? 10 : -26, ly);
          ctx.lineTo(isIn ? 26 : -10, ly);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(isIn ? 26 : -26, ly, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = PALETTE.textDim;
          ctx.font = '8px ui-monospace, monospace';
          ctx.fillText(String(bit), isIn ? 28 : -28, ly + 3);
          ctx.fillStyle = PALETTE.body;
        }
      }
      break;
    }
    case 'module': {
      const box = moduleBox(sym, doc.library);
      ctx.fillRect(-box.w / 2, -box.h / 2, box.w, box.h);
      ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
      // 门级模块：中文门名为主（居中，按长度缩放），右上角小字标 IEC 符号（& / ≥1 / =1 / 1），
      // 反相门在输出侧画气泡。非门类模块（锁存器/加法器等）不在盒内画字，名称走下方标签段。
      const stored = doc.library.find((m) => m.hash === sym.module);
      const glyph = moduleGlyph(stored?.name ?? sym.label);
      if (glyph) {
        ctx.save();
        const name = stored?.name || sym.label || '';
        const nameSize = Math.min(13, Math.max(8, Math.floor(58 / Math.max(name.length, 2))));
        ctx.font = `${nameSize}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = PALETTE.text;
        ctx.fillText(name, 0, box.h * 0.04);
        // 辅助徽标：右上角 IEC 符号字符
        ctx.font = `bold ${Math.min(11, box.h * 0.2)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillStyle = PALETTE.textDim;
        ctx.fillText(glyph.text, box.w / 2 - 4, -box.h / 2 + 4);
        // 反相气泡：输出侧引脚（画布已按 sym.rot 旋转，引脚偏移强制 rot:0 与引线绘制一致）
        if (glyph.bubble) {
          ctx.strokeStyle = PALETTE.body;
          ctx.lineWidth = 1.6 / camera.scale;
          for (const off of pinOffsets({ ...sym, rot: 0 }, doc.library)) {
            if (off.x <= 0) continue; // 反相气泡画在输出侧（x > 0 的引脚）
            ctx.beginPath();
            ctx.arc(off.x, off.y, 5.2, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      break;
    }
    default:
      break;
  }

  ctx.restore();

  // 文字标签（不随旋转）
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.font = `${Math.max(9, 11 * camera.scale)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';

  const f = footprintOf(sym, doc.library);
  const labelY = sym.rot % 2 === 1 ? f.h / 2 + 14 * camera.scale : f.h / 2 + 13 * camera.scale;

  if (key === 'input' || key === 'output') {
    if (sym.sprite) {
      // 实物图标端口：状态由图形表达，下方只标端口名（务必 restore，否则变换泄漏导致后续元件画到画布外）
      ctx.font = `${Math.max(9, 11 * camera.scale)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = PALETTE.textDim;
      ctx.fillText(sym.label, 0, labelY + 10);
      ctx.restore();
      return;
    }
    const width = sym.width ?? 1;
    if (width > 1) {
      // 总线端口：把各位 lane 的信号拼成数值显示（小端）
      let value = 0;
      let valid = true;
      for (let bit = 0; bit < width; bit++) {
        const sig = scene.pinSignals.get(pinKey({ inst: sym.id, pin: 'p', bit }));
        if (sig === undefined) {
          valid = false;
          break;
        }
        if ((sig & 1) === 1) value |= 1 << bit;
      }
      ctx.fillStyle = PALETTE.text;
      ctx.font = `bold ${Math.max(10, 13 * camera.scale)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(valid ? String(value) : '?', 0, 4 * camera.scale);
      ctx.font = `${Math.max(9, 11 * camera.scale)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = PALETTE.textDim;
      ctx.fillText(`${sym.label}[${width - 1}:0]`, 0, labelY + 10);
    } else {
      const signal = scene.pinSignals.get(pinKey({ inst: sym.id, pin: 'p', bit: 0 }));
      const style = signalStyle(signal ?? SIG_Z);
      ctx.fillStyle = style.color;
      ctx.font = `bold ${Math.max(10, 13 * camera.scale)}px ui-monospace, monospace`;
      // 输入端口是「用户开关」：永远强驱动，只显示 0/1；输出/电路节点才标强/弱
      ctx.fillText(signalText(signal, key !== 'input'), 0, 4 * camera.scale);
      ctx.font = `${Math.max(9, 11 * camera.scale)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = PALETTE.textDim;
      ctx.fillText(sym.label, 0, labelY + 10);
    }
  } else if (key === 'module') {
    const stored = doc.library.find((m) => m.hash === sym.module);
    const glyph = moduleGlyph(stored?.name ?? sym.label);
    const hashCost = `#${(stored?.hash ?? sym.module ?? '').slice(0, 6)} · ${stored ? stored.costHalf / 2 : '?'}`;
    if (!glyph) {
      // 非门类模块：盒内仍是名称，下方接 hash · 成本
      ctx.fillStyle = PALETTE.text;
      ctx.fillText(sym.label, 0, -4);
      ctx.fillStyle = PALETTE.textDim;
      ctx.font = `${Math.max(8, 10 * camera.scale)}px ui-monospace, monospace`;
      ctx.fillText(hashCost, 0, 10);
    } else {
      // 门级模块：盒内是逻辑符号（见 case 'module'），识别信息移到盒下方
      ctx.fillStyle = PALETTE.textDim;
      ctx.font = `${Math.max(8, 10 * camera.scale)}px ui-monospace, monospace`;
      ctx.fillText(hashCost, 0, labelY + 6);
    }
  } else if (key !== 'vcc' && key !== 'gnd') {
    ctx.fillStyle = PALETTE.textDim;
    ctx.fillText(sym.label, 0, labelY);
  } else {
    // 电源/地：标签放符号右侧（避开竖直引脚线），更易识别
    ctx.fillStyle = PALETTE.textDim;
    ctx.textAlign = 'left';
    ctx.fillText(
      sym.label || (key === 'vcc' ? 'VCC' : 'GND'),
      f.w / 2 + 4 * camera.scale,
      5 * camera.scale,
    );
    ctx.textAlign = 'center';
  }
  ctx.restore();
}

/** 给 UI 用：列出该符号所有引脚及其信号 */
export function symPinSignals(
  scene: Scene,
  sym: Sym,
): Array<{ pin: string; signal: number | undefined }> {
  return pinNames(sym, scene.doc.library).map((pin) => ({
    pin,
    signal: scene.pinSignals.get(pinKey({ inst: sym.id, pin, bit: 0 })),
  }));
}

/**
 * 拖拽图标：把元件符号画到小画布上，作为 setDragImage 的拖影
 * （默认拖影是整张元件库卡片，换成符号本体更好认）
 */
export function drawIcon(kind: string, ctx: CanvasRenderingContext2D, size: number): void {
  const s = size / 64;
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.scale(s, s);
  ctx.strokeStyle = PALETTE.body;
  ctx.fillStyle = PALETTE.fill;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (kind) {
    case 'npn': {
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-9, -11);
      ctx.lineTo(-9, 11);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-19, 0);
      ctx.lineTo(-9, 0);
      ctx.moveTo(-9, -7);
      ctx.lineTo(0, -17);
      ctx.lineTo(0, -26);
      ctx.moveTo(-9, 7);
      ctx.lineTo(0, 17);
      ctx.lineTo(0, 26);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-1.5, 12.5);
      ctx.lineTo(4.5, 17.5);
      ctx.lineTo(-4, 19.5);
      ctx.closePath();
      ctx.fillStyle = PALETTE.body;
      ctx.fill();
      break;
    }
    case 'nmos':
    case 'pmos': {
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-9, -11);
      ctx.lineTo(-9, 11);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-19, 0);
      ctx.lineTo(-9, 0);
      ctx.moveTo(-9, -7);
      ctx.lineTo(0, -17);
      ctx.lineTo(0, -26);
      ctx.moveTo(-9, 7);
      ctx.lineTo(0, 17);
      ctx.lineTo(0, 26);
      ctx.stroke();
      if (kind === 'pmos') {
        ctx.beginPath();
        ctx.arc(-14, 0, 3.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'res': {
      ctx.beginPath();
      ctx.moveTo(0, -26);
      ctx.lineTo(0, -11);
      ctx.moveTo(0, 11);
      ctx.lineTo(0, 26);
      ctx.stroke();
      ctx.fillRect(-9, -11, 18, 22);
      ctx.strokeRect(-9, -11, 18, 22);
      break;
    }
    case 'dio': {
      ctx.beginPath();
      ctx.moveTo(-26, 0);
      ctx.lineTo(-10, 0);
      ctx.moveTo(10, 0);
      ctx.lineTo(26, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-10, -9);
      ctx.lineTo(-10, 9);
      ctx.lineTo(10, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(10, -9);
      ctx.lineTo(10, 9);
      ctx.stroke();
      break;
    }
    case 'cap': {
      ctx.beginPath();
      ctx.moveTo(-26, 0);
      ctx.lineTo(-4, 0);
      ctx.moveTo(4, 0);
      ctx.lineTo(26, 0);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-4, -9);
      ctx.lineTo(-4, 9);
      ctx.moveTo(4, -9);
      ctx.lineTo(4, 9);
      ctx.stroke();
      break;
    }
    case 'vcc': {
      ctx.beginPath();
      ctx.moveTo(0, 14);
      ctx.lineTo(0, 2);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-9, 2);
      ctx.lineTo(9, 2);
      ctx.stroke();
      break;
    }
    case 'gnd': {
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(0, -2);
      ctx.stroke();
      ctx.lineWidth = 4;
      for (const [idx, w] of [10, 6.5, 3].entries()) {
        ctx.beginPath();
        ctx.moveTo(-w, -2 + idx * 3.2);
        ctx.lineTo(w, -2 + idx * 3.2);
        ctx.stroke();
      }
      break;
    }
    case 'input': {
      ctx.fillStyle = PALETTE.portInFill;
      ctx.strokeStyle = PALETTE.portInStroke;
      ctx.fillRect(-20, -13, 30, 26);
      ctx.strokeRect(-20, -13, 30, 26);
      ctx.strokeStyle = PALETTE.body;
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(26, 0);
      ctx.stroke();
      break;
    }
    case 'output': {
      ctx.fillStyle = PALETTE.portOutFill;
      ctx.strokeStyle = PALETTE.portOutStroke;
      ctx.fillRect(-10, -13, 30, 26);
      ctx.strokeRect(-10, -13, 30, 26);
      ctx.strokeStyle = PALETTE.body;
      ctx.beginPath();
      ctx.moveTo(-26, 0);
      ctx.lineTo(-10, 0);
      ctx.stroke();
      break;
    }
    case 'button': {
      // 按钮器件图标：圆帽 + 底座杆（与画布 drawSprite('button') 同形）
      ctx.strokeStyle = PALETTE.bodyDim;
      ctx.fillStyle = PALETTE.fill;
      ctx.beginPath();
      ctx.arc(0, -6, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = PALETTE.body;
      ctx.fillRect(-4, 6, 8, 6);
      ctx.strokeRect(-6, 12, 12, 4);
      break;
    }
    case 'segment': {
      // 七段数码管图标：画出 7 段（a-g）围成的「8」
      ctx.strokeStyle = PALETTE.body;
      ctx.lineWidth = 3;
      const seg = (x1: number, y1: number, x2: number, y2: number): void => {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      };
      seg(-8, -14, 8, -14); // a（顶）
      seg(11, -11, 11, 1); // b（右上）
      seg(11, 5, 11, 17); // c（右下）
      seg(-8, 20, 8, 20); // d（底）
      seg(-11, 5, -11, 17); // e（左下）
      seg(-11, -11, -11, 1); // f（左上）
      seg(-8, 3, 8, 3); // g（中）
      break;
    }
    case 'module': {
      ctx.fillRect(-24, -16, 48, 32);
      ctx.strokeRect(-24, -16, 48, 32);
      ctx.fillStyle = PALETTE.textDim;
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('模块', 0, 4);
      break;
    }
    default:
      break;
  }
  ctx.restore();
}
