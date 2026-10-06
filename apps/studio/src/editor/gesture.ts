/**
 * 触屏手势状态机（纯逻辑：不碰 DOM，可在 node 环境直接单测）
 *
 * 指针类型分流：
 * - `mouse`：完全不接管 —— 鼠标继续走 App 里原有的鼠标事件路径
 *   （onMouseDown/Move/Up/DoubleClick/Wheel），行为与触屏改造前逐字一致；
 *   本模块对鼠标只回一个 `delegate-mouse` 效果，表示"交回老路径"。
 * - `touch` / `pen`：走 pointerdown/move/up/cancel（App 里配合 setPointerCapture），
 *   由本状态机决定当前是哪一种手势，效果再由 App 用**和鼠标同一批动作函数**执行
 *   （点引脚连线、双击删除连线、双击展开模块、拖动元件…），所以两种输入语义一致。
 *
 * 触屏手势定义（与底部提示文案一一对应）：
 * - 单指拖动 = 平移（**不再**拖元件/拉线，避免和"手指画布上滑动"打架）
 * - 双指捏合 = 缩放；两指一起拖 = 平移（中点位移直接平移，见 pinchCamera）
 * - 轻点 = 单击语义（点引脚选中/连线、点元件选中、点输入端口切 0/1）
 * - 双击（两次轻点，320ms 内）= 双击语义（删除连线 / 展开模块）
 * - 长按 420ms 后松手 = 双击语义（同上，手机上更好按）
 * - 长按 420ms 后拖动 = 拖动元件（替代鼠标的"按下即拖"）
 */

import { type Camera, screenToWorld } from './render';

export type PointerKind = 'mouse' | 'touch' | 'pen';

/** 手指按下时命中的对象种类（hitTest 结果的归类） */
export type PressTarget = 'pin' | 'sym' | 'wire' | 'none';

export interface Point {
  x: number;
  y: number;
}

/** 单指拖动超过这个距离才算"拖动"（鼠标平移阈值是 3px，手指抖得厉害些） */
export const TOUCH_SLOP = 6;
/** 长按判定时长：按住不动超过它 → 进入"长按就绪" */
export const LONG_PRESS_MS = 420;
/** 双击判定：两次轻点的时间 / 位移上限（鼠标双击走原生 dblclick，不经过这里） */
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_SLOP = 24;
/** 缩放范围：与滚轮缩放保持一致（0.35 ~ 2.6） */
export const SCALE_RANGE = { min: 0.35, max: 2.6 };

export type TouchPhase = 'idle' | 'pressed' | 'longpressed' | 'panning' | 'moving' | 'pinching';

export interface TouchState {
  phase: TouchPhase;
  /** 按下起点（屏幕坐标）：平移基准 / 轻点判定都以它为基准 */
  origin: Point;
  /** 按下时命中的对象种类（长按后拖动据此决定"拖元件"还是"继续平移"） */
  target: PressTarget;
  /** 双指缩放上一帧的两指位置（缩放基准，每帧跟着更新） */
  pinchA: Point;
  pinchB: Point;
}

export const INITIAL_TOUCH: TouchState = {
  phase: 'idle',
  origin: { x: 0, y: 0 },
  target: 'none',
  pinchA: { x: 0, y: 0 },
  pinchB: { x: 0, y: 0 },
};

export type TouchEvent =
  /** pair 非空 = 已有两根以上手指（第二根及以上落下时进入捏合） */
  | {
      type: 'down';
      kind: PointerKind;
      point: Point;
      target: PressTarget;
      pair: [Point, Point] | null;
    }
  | { type: 'move'; point: Point; pair: [Point, Point] | null }
  /** point = 抬起那根手指的位置；remaining = 还按着的某一根手指（null = 全抬了） */
  | { type: 'up'; point: Point; remaining: Point | null; pair: [Point, Point] | null }
  | { type: 'cancel' }
  /** 长按计时器到点（由 App 的 setTimeout 触发） */
  | { type: 'longpress' };

export type TouchEffect =
  /** 鼠标：交回原生鼠标事件路径 */
  | { type: 'delegate-mouse' }
  | { type: 'arm-longpress' }
  | { type: 'longpress-ready' }
  | { type: 'cancel-longpress' }
  | { type: 'begin-pan'; point: Point }
  | { type: 'pan'; point: Point }
  | { type: 'begin-move'; point: Point }
  | { type: 'move-sym'; point: Point }
  | { type: 'end-move' }
  | { type: 'tap'; point: Point }
  | { type: 'double-click'; point: Point }
  | { type: 'pinch'; fromA: Point; fromB: Point; toA: Point; toB: Point };

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

const idle = (): TouchState => ({ ...INITIAL_TOUCH });

/** 两指位置（不足两指返回 null）；Map 保持插入顺序，取最先按下的两根 */
export function pairOf(pointers: Map<number, Point>): [Point, Point] | null {
  if (pointers.size < 2) return null;
  const [a, b] = [...pointers.values()];
  return [a as Point, b as Point];
}

/** 指针类型归类（浏览器必带 pointerType；测试/老环境缺省按触屏处理） */
export function pointerKindOf(raw: string | undefined): PointerKind {
  if (raw === 'mouse') return 'mouse';
  if (raw === 'pen') return 'pen';
  return 'touch';
}

/**
 * 手势状态机。返回下一个状态 + 本次该执行的效果（App 负责执行，本函数无副作用）。
 */
export function reduceTouch(
  state: TouchState,
  event: TouchEvent,
): { state: TouchState; effects: TouchEffect[] } {
  switch (event.type) {
    case 'down': {
      // 鼠标不接管：鼠标事件路径与改造前完全一致
      if (event.kind === 'mouse') return { state, effects: [{ type: 'delegate-mouse' }] };
      const [a, b] = event.pair ?? [event.point, event.point];
      if (event.pair) {
        // 第二根手指落下 → 捏合缩放；正在拖的元件就地收尾（撤销栈要落一次）
        const effects: TouchEffect[] = [{ type: 'cancel-longpress' }];
        if (state.phase === 'moving') effects.push({ type: 'end-move' });
        return { state: { ...state, phase: 'pinching', pinchA: a, pinchB: b }, effects };
      }
      return {
        state: {
          phase: 'pressed',
          origin: event.point,
          target: event.target,
          pinchA: a,
          pinchB: b,
        },
        effects: [{ type: 'arm-longpress' }],
      };
    }

    case 'move': {
      if (state.phase === 'pinching') {
        if (!event.pair) return { state, effects: [] };
        const [a, b] = event.pair;
        return {
          state: { ...state, pinchA: a, pinchB: b },
          effects: [{ type: 'pinch', fromA: state.pinchA, fromB: state.pinchB, toA: a, toB: b }],
        };
      }
      // 已经在拖了：直接给效果（起点已固定，不必再过阈值）
      if (state.phase === 'panning')
        return { state, effects: [{ type: 'pan', point: event.point }] };
      if (state.phase === 'moving')
        return { state, effects: [{ type: 'move-sym', point: event.point }] };
      if (dist(state.origin, event.point) <= TOUCH_SLOP) return { state, effects: [] };
      if (state.phase === 'pressed') {
        // 单指拖动＝平移：命中元件也不拖元件（拖元件要长按）
        return {
          state: { ...state, phase: 'panning' },
          effects: [{ type: 'begin-pan', point: event.point }],
        };
      }
      if (state.phase === 'longpressed') {
        return state.target === 'sym'
          ? {
              state: { ...state, phase: 'moving' },
              effects: [{ type: 'begin-move', point: event.point }],
            }
          : {
              state: { ...state, phase: 'panning' },
              effects: [{ type: 'begin-pan', point: event.point }],
            };
      }
      return { state, effects: [] };
    }

    case 'up': {
      const effects: TouchEffect[] = [];
      if (state.phase === 'moving') effects.push({ type: 'end-move' });
      if (state.phase === 'pinching') {
        // 还有两指按着：继续捏合（基准换成当前两指）
        if (event.pair) {
          const [a, b] = event.pair;
          return { state: { ...state, pinchA: a, pinchB: b }, effects };
        }
        // 只剩一指：以它重新起算继续平移（不重新长按，避免误触拖元件）
        if (event.remaining) {
          return {
            state: { ...state, phase: 'panning', origin: event.remaining },
            effects: [...effects, { type: 'begin-pan', point: event.remaining }],
          };
        }
        return { state: idle(), effects };
      }
      if (state.phase === 'pressed') {
        // 没怎么动 → 轻点（单击语义，落点用按下点：那才是用户瞄的地方）
        return dist(state.origin, event.point) <= TOUCH_SLOP
          ? { state: idle(), effects: [...effects, { type: 'tap', point: state.origin }] }
          : { state: idle(), effects };
      }
      if (state.phase === 'longpressed') {
        // 长按后原地松手 → 双击语义（手机上比双击好按）
        return dist(state.origin, event.point) <= TOUCH_SLOP
          ? { state: idle(), effects: [...effects, { type: 'double-click', point: state.origin }] }
          : { state: idle(), effects };
      }
      return { state: idle(), effects };
    }

    case 'cancel': {
      // 系统抢走指针（来电、切后台…）：只收尾，绝不当成轻点/双击
      const effects: TouchEffect[] = state.phase === 'moving' ? [{ type: 'end-move' }] : [];
      return { state: idle(), effects };
    }

    case 'longpress': {
      if (state.phase !== 'pressed') return { state, effects: [] };
      return { state: { ...state, phase: 'longpressed' }, effects: [{ type: 'longpress-ready' }] };
    }

    default:
      return { state, effects: [] };
  }
}

/**
 * 双指捏合 → 新相机：捏合中点下的世界点跟着手指中点走（缩放 + 两指平移一次算完）。
 * 缩放比例被 SCALE_RANGE 夹住（与滚轮同一区间），所以捏到头也不会失控。
 */
export function pinchCamera(
  camera: Camera,
  width: number,
  height: number,
  from: { a: Point; b: Point },
  to: { a: Point; b: Point },
): Camera {
  const midFrom = { x: (from.a.x + from.b.x) / 2, y: (from.a.y + from.b.y) / 2 };
  const midTo = { x: (to.a.x + to.b.x) / 2, y: (to.a.y + to.b.y) / 2 };
  const before = Math.hypot(from.b.x - from.a.x, from.b.y - from.a.y);
  const after = Math.hypot(to.b.x - to.a.x, to.b.y - to.a.y);
  const factor = before > 1 ? after / before : 1;
  const scale = Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, camera.scale * factor));
  // 捏合中点下的世界点：缩放后要落在新的中点上 → 直接反解相机位置
  const anchor = screenToWorld(camera, width, height, midFrom.x, midFrom.y);
  return {
    x: anchor.x - (midTo.x - width / 2) / scale,
    y: anchor.y - (midTo.y - height / 2) / scale,
    scale,
  };
}

export interface TapRecord {
  time: number;
  x: number;
  y: number;
}

/** 两次轻点是否算双击（触屏专用；鼠标走原生 dblclick） */
export function isDoubleTap(prev: TapRecord | null, next: TapRecord): boolean {
  if (!prev) return false;
  return (
    next.time - prev.time <= DOUBLE_TAP_MS &&
    Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_SLOP
  );
}
