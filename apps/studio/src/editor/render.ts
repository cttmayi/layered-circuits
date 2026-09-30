/**
 * 画布渲染 + 命中测试（纯函数，不依赖 React）。
 *
 * 视觉语义（与 docs/sim-semantics.md 一致）：
 *   强 1 = 亮绿实线   弱 1 = 暗绿细线
 *   强 0 = 冷灰实线   弱 0 = 深灰细线
 *   X    = 红色虚线   Z（悬空）= 土黄虚线
 * 玩家因此能「看见」强度：上拉电阻给出的是弱 1，三极管拉低给出的是强 0。
 */

import { logicValueOf, S_STRONG, SIG_Z, strengthOf } from '@lc/sim-core';
import {
  type Doc,
  moduleBox,
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
  /** 画布探针（工具铺买下后可用）：点任意连线在此处钉一个电平读数 */
  probes: Array<{ id: string; x: number; y: number; inst: string; pin: string; bit?: number }>;
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

function footprintOf(
  sym: Sym,
  library: StoredModule[],
): { x: number; y: number; w: number; h: number } {
  const key = symKindKey(sym);
  if (key === 'module') {
    const box = moduleBox(sym, library);
    return { x: sym.x - box.w / 2, y: sym.y - box.h / 2, w: box.w, h: box.h };
  }
  const sizes: Record<string, { w: number; h: number }> = {
    npn: { w: 44, h: 44 },
    res: { w: 20, h: 40 },
    // 二极管/电容的引脚（±22 / ±14）必须露在足迹外，否则连线从引脚出发
    // 朝内拐时会整段穿过"器件矩形"，看着就像电线穿进元件里。
    dio: { w: 34, h: 24 },
    cap: { w: 22, h: 26 },
    vcc: { w: 28, h: 22 },
    gnd: { w: 34, h: 22 },
    input: { w: 44, h: 26 },
    output: { w: 44, h: 26 },
  };
  let size = sizes[key] ?? { w: 30, h: 30 };
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
  const obstacles = routeObstacles(doc);
  for (const wire of doc.wires) {
    const a = pinWorld(doc, wire.a.inst, wire.a.pin, wire.a.bit ?? 0);
    const b = pinWorld(doc, wire.b.inst, wire.b.pin, wire.b.bit ?? 0);
    if (!a || !b) continue;
    for (const [p, q] of routeSegments(a, b, wire.id.length, obstacles, wire.a.inst, wire.b.inst)) {
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
}

/** 画布上所有元件的矩形（含锁定的端口/电源轨），当作走线障碍 */
export function routeObstacles(doc: Doc): RouteObstacle[] {
  return doc.syms
    .map((sym) => {
      const f = footprintOf(sym, doc.library);
      const m = 5; // 边距：离元件太近也算撞
      return { id: sym.id, x: f.x - m, y: f.y - m, w: f.w + m * 2, h: f.h + m * 2 };
    })
    .filter((o) => o.w > 0 && o.h > 0);
}

/** 点是否落在障碍矩形内（含边界）。用于剔除「朝器件内部拐」的走线候选 */
export function pointInBox(p: { x: number; y: number }, r: RouteObstacle): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
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

function routeClear(
  segs: Array<[{ x: number; y: number }, { x: number; y: number }]>,
  obstacles: RouteObstacle[],
  skipA: string,
  skipB: string,
): boolean {
  for (const [p, q] of segs) {
    for (const ob of obstacles) {
      if (ob.id === skipA || ob.id === skipB) continue;
      if (segHitsRect(p, q, ob)) return false;
    }
  }
  return true;
}

/**
 * 避障布线：优先走「不穿过任何元件」的折线。
 * 候选依次尝试 —— 直连 / 横先 Z / 竖先 Z / 各自向两侧挪 48/96/144，
 * 第一个不撞元件矩形（两端点所属元件除外）的方案胜出；都不行再退回默认中点线。
 */
export function routeSegments(
  a: { x: number; y: number },
  b: { x: number; y: number },
  seed = 0,
  obstacles: RouteObstacle[] = [],
  skipA = '',
  skipB = '',
): Array<[{ x: number; y: number }, { x: number; y: number }]> {
  const off = seed === 0 ? 0 : seedOffset(String(seed));
  const alignedX = Math.abs(a.x - b.x) < 1;
  const alignedY = Math.abs(a.y - b.y) < 1;
  const candidates: Array<Array<[{ x: number; y: number }, { x: number; y: number }]>> = [];
  if (alignedX || alignedY) {
    candidates.push([[a, b]]);
    for (const d of [48, -48, 96, -96, 144, -144]) {
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
    for (const d of [48, -48, 96, -96, 144, -144]) pick(mx0 + d, my0 + d);
  }
  for (const cand of candidates) {
    // 出线段不得「朝器件内部拐」：第一段的拐点若落在起点元件矩形内、或
    // 最后一段的拐点落在终点元件矩形内，说明折线从引脚往器件里穿进去了
    // （视觉上电线穿过元件）。这种候选直接淘汰，让避障换一个方向绕。
    if (skipA) {
      const ba = obstacles.find((o) => o.id === skipA);
      if (ba && cand[0] && pointInBox(cand[0][1], ba)) continue;
    }
    if (skipB) {
      const bb = obstacles.find((o) => o.id === skipB);
      const last = cand[cand.length - 1];
      if (bb && last && pointInBox(last[0], bb)) continue;
    }
    if (!obstacles.length || routeClear(cand, obstacles, skipA, skipB)) return cand;
  }
  // 兜底：默认中点折线（旧行为），保证永远画得出线
  return candidates[0] ?? [[a, b]];
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

export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { doc, camera, width, height } = scene;
  ctx.save();
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, width, height);

  if (scene.grid) drawGrid(ctx, scene);

  // 导线：先按「线段去重」画一遍底色（公共段只画一次，不再叠成重影），
  // 再单独高亮 hover / 选中的线。
  // 整网高亮：把共享引脚（inst:pin）的线归到同一个网，hover/选中时整网点亮、其余压暗
  const wires = doc.wires;
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
      const key = `${end.inst}:${end.pin}`;
      const owner = endpointOwner.get(key);
      if (owner === undefined) endpointOwner.set(key, wire.id);
      else parent.set(find(wire.id), find(owner));
    }
  }
  const netOf = new Map<string, string>();
  for (const wire of wires) netOf.set(wire.id, find(wire.id));
  const activeWireIds = new Set<string>([...scene.selectedWires]);
  if (scene.hover?.kind === 'wire') activeWireIds.add(scene.hover.id);
  const activeNets = new Set<string>();
  for (const id of activeWireIds) {
    const net = netOf.get(id);
    if (net) activeNets.add(net);
  }
  const netDimmed = activeNets.size > 0;
  const obstacles = routeObstacles(doc);

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
    const a = pinWorld(doc, wire.a.inst, wire.a.pin, wire.a.bit ?? 0);
    const b = pinWorld(doc, wire.b.inst, wire.b.pin, wire.b.bit ?? 0);
    if (!a || !b) continue;
    for (const [p, q] of routeSegments(a, b, wire.id.length, obstacles, wire.a.inst, wire.b.inst))
      segments.push({ wire, a: p, b: q });
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

  // 连线中的橡皮筋
  if (scene.pendingPin && scene.pendingPoint) {
    const from = pinWorld(
      doc,
      scene.pendingPin.inst,
      scene.pendingPin.pin,
      scene.pendingPin.bit ?? 0,
    );
    if (from) {
      const sp = worldToScreen(camera, width, height, from.x, from.y);
      const sq = worldToScreen(camera, width, height, scene.pendingPoint.x, scene.pendingPoint.y);
      ctx.save();
      ctx.strokeStyle = PALETTE.hover;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(sq.x, sq.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  for (const sym of doc.syms) drawSymbol(ctx, scene, sym);

  // 画布探针：圆点 + 电平/强度读数（跟着仿真实时变）
  for (const probe of scene.probes) {
    const sp = worldToScreen(camera, width, height, probe.x, probe.y);
    const signal = scene.pinSignals.get(pinKey({ inst: probe.inst, pin: probe.pin, bit: 0 }));
    const style = signalStyle(signal ?? SIG_Z);
    ctx.save();
    // 探头圆点
    ctx.fillStyle = signal === undefined ? '#5b6b7d' : style.color;
    ctx.strokeStyle = PALETTE.bg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 读数标签
    ctx.font = `bold ${Math.max(10, 13 * camera.scale)}px ui-monospace, monospace`;
    ctx.fillStyle = signal === undefined ? '#5b6b7d' : style.color;
    const text = signalText(signal);
    ctx.textAlign = 'center';
    ctx.fillText(text, sp.x, sp.y - 10);
    ctx.restore();
  }

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
    ctx.moveTo(off.x * stub, off.y * stub);
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
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(sym.label, 0, -4);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = `${Math.max(8, 10 * camera.scale)}px ui-monospace, monospace`;
    ctx.fillText(
      `#${(stored?.hash ?? sym.module ?? '').slice(0, 6)} · ${stored ? stored.costHalf / 2 : '?'}`,
      0,
      10,
    );
  } else if (key !== 'vcc' && key !== 'gnd') {
    ctx.fillStyle = PALETTE.textDim;
    ctx.fillText(sym.label, 0, labelY);
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
