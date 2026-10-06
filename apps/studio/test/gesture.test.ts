/**
 * 触屏手势状态机（editor/gesture.ts）单测：纯逻辑，不需要 DOM。
 *
 * 覆盖的手势定义：
 *  - 鼠标 → 状态机不接管（delegate-mouse），鼠标事件路径行为不变
 *  - 单指拖动 = 平移（命中元件也不拖元件）
 *  - 长按 420ms：原地松手 = 双击语义；之后拖动 = 移动元件（空白处仍平移）
 *  - 双指 = 捏合缩放（中点位移同时平移）；抬起一根手指继续平移
 *  - 轻点 = 单击语义；cancel（系统抢指针）绝不当轻点
 */
import { describe, expect, it } from 'vitest';
import {
  DOUBLE_TAP_MS,
  INITIAL_TOUCH,
  isDoubleTap,
  LONG_PRESS_MS,
  type Point,
  type PressTarget,
  pairOf,
  pinchCamera,
  pointerKindOf,
  reduceTouch,
  SCALE_RANGE,
  TOUCH_SLOP,
  type TouchEffect,
  type TouchEvent,
  type TouchState,
} from '../src/editor/gesture';
import { screenToWorld } from '../src/editor/render';

const p = (x: number, y: number): Point => ({ x, y });

/** 依次喂事件，返回最后一个事件后的状态与效果 */
function feed(
  events: TouchEvent[],
  from: TouchState = INITIAL_TOUCH,
): { state: TouchState; effects: TouchEffect[] } {
  let state = from;
  let effects: TouchEffect[] = [];
  for (const event of events) {
    const result = reduceTouch(state, event);
    state = result.state;
    effects = result.effects;
  }
  return { state, effects };
}

const types = (effects: TouchEffect[]): string[] => effects.map((e) => e.type);

const down = (point: Point, target: PressTarget = 'none', pair: null | [Point, Point] = null) =>
  ({ type: 'down', kind: 'touch', point, target, pair }) satisfies TouchEvent;
const move = (point: Point, pair: null | [Point, Point] = null) =>
  ({ type: 'move', point, pair }) satisfies TouchEvent;
const up = (point: Point, remaining: Point | null = null, pair: null | [Point, Point] = null) =>
  ({ type: 'up', point, remaining, pair }) satisfies TouchEvent;
const longpress = { type: 'longpress' } satisfies TouchEvent;

describe('指针类型分流', () => {
  it('pointerKindOf：鼠标 / 触控笔 / 其余（含缺省）都归到触屏', () => {
    expect(pointerKindOf('mouse')).toBe('mouse');
    expect(pointerKindOf('pen')).toBe('pen');
    expect(pointerKindOf('touch')).toBe('touch');
    expect(pointerKindOf(undefined)).toBe('touch');
  });

  it('鼠标按下不接管：只回 delegate-mouse，状态留在 idle（鼠标行为不变）', () => {
    const { state, effects } = feed([
      { type: 'down', kind: 'mouse', point: p(30, 40), target: 'sym', pair: null },
    ]);
    expect(types(effects)).toEqual(['delegate-mouse']);
    expect(state.phase).toBe('idle');
  });

  it('触屏按下才装长按计时器', () => {
    const { state, effects } = feed([down(p(30, 40), 'sym')]);
    expect(types(effects)).toEqual(['arm-longpress']);
    expect(state.phase).toBe('pressed');
    expect(state.target).toBe('sym');
    expect(state.origin).toEqual(p(30, 40));
  });
});

describe('单指拖动 = 平移', () => {
  it('没超过阈值不动（手指抖动不算拖动）', () => {
    const { effects } = feed([down(p(100, 100)), move(p(100 + TOUCH_SLOP, 100))]);
    expect(effects).toEqual([]);
  });

  it('超过阈值 → begin-pan，之后每帧 pan', () => {
    const { state, effects } = feed([down(p(100, 100)), move(p(120, 100)), move(p(140, 130))]);
    expect(state.phase).toBe('panning');
    expect(types(effects)).toEqual(['pan']);
    expect(effects[0]).toEqual({ type: 'pan', point: p(140, 130) });
  });

  it('命中元件也一样是平移：单指拖动**不会**拖元件（拖元件要长按）', () => {
    const { state, effects } = feed([down(p(100, 100), 'sym'), move(p(160, 100))]);
    expect(types(effects)).toEqual(['begin-pan']);
    expect(state.phase).toBe('panning');
  });

  it('拖动收尾不产生轻点', () => {
    const { state, effects } = feed([down(p(100, 100)), move(p(160, 100)), up(p(160, 100))]);
    expect(types(effects)).toEqual([]);
    expect(state.phase).toBe('idle');
  });
});

describe('轻点 = 单击语义', () => {
  it('没怎么动就抬手 → tap，落点用按下点（用户瞄的地方）', () => {
    const { state, effects } = feed([down(p(100, 100), 'pin'), move(p(102, 101)), up(p(103, 101))]);
    expect(effects).toEqual([{ type: 'tap', point: p(100, 100) }]);
    expect(state.phase).toBe('idle');
  });

  it('cancel（系统抢指针）只收尾，绝不当轻点', () => {
    const { state, effects } = feed([down(p(100, 100), 'pin'), { type: 'cancel' }]);
    expect(effects).toEqual([]);
    expect(state.phase).toBe('idle');
  });

  it('isDoubleTap：320ms 内、24px 内才算双击', () => {
    const first = { time: 1000, x: 100, y: 100 };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { time: 1000 + DOUBLE_TAP_MS, x: 110, y: 110 })).toBe(true);
    expect(isDoubleTap(first, { time: 1000 + DOUBLE_TAP_MS + 1, x: 100, y: 100 })).toBe(false);
    expect(isDoubleTap(first, { time: 1100, x: 100 + 25, y: 100 })).toBe(false);
  });
});

describe('长按：松手＝双击语义，拖动＝移动元件', () => {
  it('长按到点 → longpress-ready；原地松手 → double-click', () => {
    const held = feed([down(p(300, 200), 'sym'), longpress]);
    expect(types(held.effects)).toEqual(['longpress-ready']);
    expect(held.state.phase).toBe('longpressed');
    const released = feed([up(p(302, 200))], held.state);
    expect(released.effects).toEqual([{ type: 'double-click', point: p(300, 200) }]);
    expect(released.state.phase).toBe('idle');
  });

  it('长按后拖动命中元件 → begin-move，抬手 → end-move', () => {
    const held = feed([down(p(300, 200), 'sym'), longpress]);
    const dragging = feed([move(p(340, 200))], held.state);
    expect(types(dragging.effects)).toEqual(['begin-move']);
    expect(dragging.state.phase).toBe('moving');
    const dropped = feed([up(p(340, 200))], dragging.state);
    expect(types(dropped.effects)).toEqual(['end-move']);
    expect(dropped.state.phase).toBe('idle');
  });

  it('长按后拖动空白处 → 还是平移', () => {
    const held = feed([down(p(300, 200), 'none'), longpress]);
    const dragging = feed([move(p(340, 200))], held.state);
    expect(types(dragging.effects)).toEqual(['begin-pan']);
    expect(dragging.state.phase).toBe('panning');
  });

  it('长按后被打断（cancel）不触发双击语义', () => {
    const held = feed([down(p(300, 200), 'wire'), longpress]);
    const cancelled = feed([{ type: 'cancel' }], held.state);
    expect(types(cancelled.effects)).toEqual([]);
    expect(cancelled.state.phase).toBe('idle');
  });

  it('长按计时器只有在 pressed 阶段才算数（已经平移/捏合时到点无效）', () => {
    const panning = feed([down(p(100, 100), 'sym'), move(p(200, 100))]);
    expect(panning.state.phase).toBe('panning');
    expect(feed([longpress], panning.state).effects).toEqual([]);
  });

  it('长按时长与阈值是明确的常量（420ms / 6px）', () => {
    expect(LONG_PRESS_MS).toBe(420);
    expect(TOUCH_SLOP).toBe(6);
  });
});

describe('双指：捏合缩放 + 两指平移', () => {
  const a0 = p(50, 100);
  const b0 = p(150, 100);

  it('第二根手指落下 → pinching，move 出 pinch 效果（带前后两指位置）', () => {
    const first = feed([down(a0, 'none')]);
    const second = feed([down(b0, 'none', [a0, b0])], first.state);
    expect(second.state.phase).toBe('pinching');
    const zoomed = feed([move(p(0, 100), [p(0, 100), p(200, 100)])], second.state);
    expect(zoomed.effects).toEqual([
      { type: 'pinch', fromA: a0, fromB: b0, toA: p(0, 100), toB: p(200, 100) },
    ]);
    // 基准跟着更新：下一帧从新位置起算
    expect(zoomed.state.pinchA).toEqual(p(0, 100));
  });

  it('拖动元件时第二根手指落下 → 先给元件拖动收尾，再进捏合', () => {
    const held = feed([down(p(300, 200), 'sym'), longpress]);
    const dragging = feed([move(p(340, 200))], held.state);
    const pinched = feed([down(p(400, 200), 'none', [p(340, 200), p(400, 200)])], dragging.state);
    expect(types(pinched.effects)).toEqual(['cancel-longpress', 'end-move']);
    expect(pinched.state.phase).toBe('pinching');
  });

  it('抬起一根手指 → 以剩下的那根重新起算继续平移（不重新长按、不跳变）', () => {
    const first = feed([down(a0, 'none')]);
    const second = feed([down(b0, 'none', [a0, b0])], first.state);
    const one = feed([up(b0, a0)], second.state);
    expect(one.state.phase).toBe('panning');
    expect(one.state.origin).toEqual(a0);
    expect(types(one.effects)).toEqual(['begin-pan']);
    // 之后这根手指的移动仍然是平移
    expect(types(feed([move(p(120, 100))], one.state).effects)).toEqual(['pan']);
  });

  it('两指全抬 → 回到 idle，不产生轻点', () => {
    const first = feed([down(a0, 'none')]);
    const second = feed([down(b0, 'none', [a0, b0])], first.state);
    const lifted = feed([up(b0, null, null)], second.state);
    expect(lifted.state.phase).toBe('idle');
    expect(lifted.effects).toEqual([]);
  });

  it('pairOf：不足两指返回 null，按插入顺序取最先按下的两根', () => {
    const map = new Map<number, Point>();
    expect(pairOf(map)).toBeNull();
    map.set(1, a0);
    expect(pairOf(map)).toBeNull();
    map.set(2, b0);
    map.set(3, p(200, 200));
    expect(pairOf(map)).toEqual([a0, b0]);
  });
});

describe('pinchCamera：捏合中点下的世界点跟着手指中点走', () => {
  const camera = { x: 100, y: 50, scale: 1 };
  const width = 200;
  const height = 200;

  it('两指拉开一倍 → 缩放翻倍，且中点世界点不动', () => {
    const from = { a: p(50, 100), b: p(150, 100) };
    const to = { a: p(0, 100), b: p(200, 100) };
    const next = pinchCamera(camera, width, height, from, to);
    expect(next.scale).toBeCloseTo(2, 6);
    // 画布正中就是相机位置
    expect(next.x).toBeCloseTo(100, 6);
    expect(next.y).toBeCloseTo(50, 6);
  });

  it('两指同向拖动（距离不变）→ 只平移，缩放不变', () => {
    const next = pinchCamera(
      camera,
      width,
      height,
      { a: p(50, 100), b: p(150, 100) },
      { a: p(70, 120), b: p(170, 120) },
    );
    expect(next.scale).toBeCloseTo(1, 6);
    expect(next.x).toBeCloseTo(80, 6); // 中点右移 20px → 画布左移 20 世界单位
    expect(next.y).toBeCloseTo(30, 6);
  });

  it('捏过头也夹在滚轮同一区间（0.35 ~ 2.6）', () => {
    const far = pinchCamera(
      { ...camera, scale: 2 },
      width,
      height,
      { a: p(50, 100), b: p(150, 100) },
      { a: p(0, 100), b: p(300, 100) },
    );
    expect(far.scale).toBe(SCALE_RANGE.max);
    const tiny = pinchCamera(
      { ...camera, scale: 0.4 },
      width,
      height,
      { a: p(0, 100), b: p(200, 100) },
      { a: p(99, 100), b: p(101, 100) },
    );
    expect(tiny.scale).toBe(SCALE_RANGE.min);
  });

  it('夹住缩放后，中点世界点仍然落在新的中点上（不会漂移）', () => {
    const from = { a: p(50, 100), b: p(150, 100) };
    const to = { a: p(0, 130), b: p(300, 130) };
    const anchor = screenToWorld(camera, width, height, 100, 100);
    const next = pinchCamera(camera, width, height, from, to);
    const landed = screenToWorld(next, width, height, 150, 130);
    expect(landed.x).toBeCloseTo(anchor.x, 6);
    expect(landed.y).toBeCloseTo(anchor.y, 6);
  });
});
