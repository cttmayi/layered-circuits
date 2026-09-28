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
  pendingPin: { inst: string; pin: string } | null;
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

export function signalText(signal: number | undefined): string {
  if (signal === undefined) return '—';
  if (signal === SIG_Z) return 'Z';
  const value = logicValueOf(signal);
  const tag = value === 0 ? '0' : value === 1 ? '1' : 'X';
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
    dio: { w: 46, h: 24 },
    cap: { w: 30, h: 26 },
    vcc: { w: 28, h: 22 },
    gnd: { w: 34, h: 22 },
    input: { w: 44, h: 26 },
    output: { w: 44, h: 26 },
  };
  const size = sizes[key] ?? { w: 30, h: 30 };
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
      if (Math.hypot(px - wx, py - wy) <= pinTol) return { kind: 'pin', id: sym.id, pin: off.name };
    }
  }
  for (const sym of doc.syms) {
    const f = footprintOf(sym, doc.library);
    if (wx >= f.x && wx <= f.x + f.w && wy >= f.y && wy <= f.y + f.h)
      return { kind: 'sym', id: sym.id };
  }
  const wireTol = 6 / scene.camera.scale + 2;
  for (const wire of doc.wires) {
    const a = pinWorld(doc, wire.a.inst, wire.a.pin);
    const b = pinWorld(doc, wire.b.inst, wire.b.pin);
    if (!a || !b) continue;
    for (const [p, q] of routeSegments(a, b)) {
      if (distanceToSegment(wx, wy, p, q) <= wireTol) return { kind: 'wire', id: wire.id };
    }
  }
  return null;
}

function pinWorld(doc: Doc, inst: string, pin: string): { x: number; y: number } | null {
  const sym = doc.syms.find((s) => s.id === inst);
  if (!sym) return null;
  const off = pinOffsets(sym, doc.library).find((p) => p.name === pin);
  if (!off) return null;
  return { x: sym.x + off.x, y: sym.y + off.y };
}

/** 导线走线：折线（先水平再垂直再水平），示意更接近原理图 */
function routeSegments(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Array<[{ x: number; y: number }, { x: number; y: number }]> {
  if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) return [[a, b]];
  if (Math.abs(a.y - b.y) < 26) {
    const mx = (a.x + b.x) / 2;
    return [
      [a, { x: mx, y: a.y }],
      [
        { x: mx, y: a.y },
        { x: mx, y: b.y },
      ],
      [{ x: mx, y: b.y }, b],
    ];
  }
  const my = (a.y + b.y) / 2;
  return [
    [a, { x: a.x, y: my }],
    [
      { x: a.x, y: my },
      { x: b.x, y: my },
    ],
    [{ x: b.x, y: my }, b],
  ];
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

  // 导线
  for (const wire of doc.wires) {
    const a = pinWorld(doc, wire.a.inst, wire.a.pin);
    const b = pinWorld(doc, wire.b.inst, wire.b.pin);
    if (!a || !b) continue;
    const selected = scene.selectedWires.includes(wire.id);
    const hovered = scene.hover?.kind === 'wire' && scene.hover.id === wire.id;
    const style = signalStyle(scene.pinSignals.get(pinKey(wire.a)) ?? SIG_Z);
    ctx.save();
    ctx.strokeStyle = selected ? PALETTE.selection : hovered ? PALETTE.hover : style.color;
    ctx.lineWidth =
      (selected || hovered ? style.width + 1.5 : style.width) * Math.min(1.6, camera.scale);
    ctx.setLineDash(style.dash.map((d) => d * camera.scale));
    ctx.lineCap = 'round';
    for (const [p, q] of routeSegments(a, b)) {
      const sp = worldToScreen(camera, width, height, p.x, p.y);
      const sq = worldToScreen(camera, width, height, q.x, q.y);
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(sq.x, sq.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 连线中的橡皮筋
  if (scene.pendingPin && scene.pendingPoint) {
    const from = pinWorld(doc, scene.pendingPin.inst, scene.pendingPin.pin);
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
      ctx.beginPath();
      ctx.moveTo(0, 14);
      ctx.lineTo(0, 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-7, 5);
      ctx.lineTo(7, 5);
      ctx.stroke();
      ctx.lineWidth = 2 / camera.scale;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(0, -1);
      ctx.stroke();
      break;
    }
    case 'gnd': {
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(0, -3);
      ctx.stroke();
      ctx.lineWidth = 2.6 / camera.scale;
      for (const [idx, w] of [9, 6, 3].entries()) {
        ctx.beginPath();
        ctx.moveTo(-w, -3 + idx * 3.4);
        ctx.lineTo(w, -3 + idx * 3.4);
        ctx.stroke();
      }
      break;
    }
    case 'input': {
      ctx.fillRect(-22, -13, 32, 26);
      ctx.strokeRect(-22, -13, 32, 26);
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(26, 0);
      ctx.stroke();
      break;
    }
    case 'output': {
      ctx.fillRect(-10, -13, 32, 26);
      ctx.strokeRect(-10, -13, 32, 26);
      ctx.beginPath();
      ctx.moveTo(-26, 0);
      ctx.lineTo(-10, 0);
      ctx.stroke();
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
    const signal = scene.pinSignals.get(pinKey({ inst: sym.id, pin: 'p', bit: 0 }));
    const style = signalStyle(signal ?? SIG_Z);
    ctx.fillStyle = style.color;
    ctx.font = `bold ${Math.max(10, 13 * camera.scale)}px ui-monospace, monospace`;
    ctx.fillText(signalText(signal), 0, 4 * camera.scale);
    ctx.font = `${Math.max(9, 11 * camera.scale)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = PALETTE.textDim;
    ctx.fillText(sym.label, 0, labelY + 10);
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
