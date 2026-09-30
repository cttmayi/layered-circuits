import { describe, expect, it } from 'vitest';
import { type RouteObstacle, routeSegments, segHitsRect, signalText } from '../src/editor/render';

/** 走线路线是否与障碍相交（逐段判定） */
function hitsAny(
  segs: Array<[{ x: number; y: number }, { x: number; y: number }]>,
  obs: RouteObstacle[],
): boolean {
  return segs.some(([p, q]) => obs.some((o) => segHitsRect(p, q, o)));
}

/** 三极管放在 x=0 的竖线上（y 100..144），正好挡住 x=0 的走线 */
const NPN: RouteObstacle = { id: 'q1', x: -22, y: 100, w: 44, h: 44 };

describe('避障布线', () => {
  it('无障碍时保持直连 / 中点折线', () => {
    expect(routeSegments({ x: 0, y: 0 }, { x: 0, y: 80 })).toEqual([
      [
        { x: 0, y: 0 },
        { x: 0, y: 80 },
      ],
    ]);
    const segs = routeSegments({ x: 0, y: 0 }, { x: 80, y: 80 });
    expect(segs.length).toBe(3);
    expect(segs[0][1].x).toBe(40); // 中点拐
  });

  it('竖线被元件挡住 → 自动绕行（阶梯），不穿过元件', () => {
    const segs = routeSegments({ x: 0, y: 0 }, { x: 0, y: 300 }, 0, [NPN], 'a', 'b');
    expect(hitsAny(segs, [NPN])).toBe(false);
    expect(segs.length).toBe(3); // 阶梯：出去-竖直-回来
  });

  it('横线被元件挡住 → 自动绕行', () => {
    const segs = routeSegments({ x: 0, y: 0 }, { x: 300, y: 0 }, 0, [NPN], 'a', 'b');
    expect(hitsAny(segs, [NPN])).toBe(false);
  });

  it('两端点所在元件不算障碍（线从自己的引脚出发是合法的）', () => {
    const segs = routeSegments({ x: 120, y: 130 }, { x: 120, y: 300 }, 0, [NPN], 'q1', 'b');
    expect(segs).toEqual([
      [
        { x: 120, y: 130 },
        { x: 120, y: 300 },
      ],
    ]);
  });

  it('出线段不得朝器件内部拐（连线不穿入器件本体）', () => {
    // Q1 是 npn：足迹半宽 22、引脚 b 在 (-26,0)。从 b 出发水平往右（朝器件内部）
    // 的候选拐点会落在足迹矩形内 → 被淘汰，自动改走垂直绕行。
    const segs = routeSegments({ x: -26, y: 0 }, { x: 120, y: 0 }, 0, [NPN], 'q1', 'b');
    // 第一段的拐点（第一个折弯）不能落在 Q1 矩形内
    const firstTurn = segs[0][1];
    const inside =
      firstTurn.x >= NPN.x &&
      firstTurn.x <= NPN.x + NPN.w &&
      firstTurn.y >= NPN.y &&
      firstTurn.y <= NPN.y + NPN.h;
    expect(inside).toBe(false);
    // 且整条线不穿过 Q1（除引脚起点外）
    expect(hitsAny(segs, [NPN])).toBe(false);
  });

  it('垂直出线段从底部引脚朝上拐也会被剔除', () => {
    // res 的 b 引脚在 (0,22)，足迹半高 20。垂直向上拐（my < 22）的拐点在矩形内
    // → 淘汰；水平出线（在器件下方）保留。
    const RES: RouteObstacle = { id: 'r1', x: -10, y: -20, w: 20, h: 40 };
    const segs = routeSegments({ x: 0, y: 22 }, { x: 120, y: 120 }, 0, [RES], 'r1', 'b');
    const firstTurn = segs[0][1];
    expect(firstTurn.y).toBeGreaterThanOrEqual(RES.y + RES.h); // 拐点在器件下方
    expect(hitsAny(segs, [RES])).toBe(false);
  });

  it('二极管引脚（±22）露在足迹外，直连不被误杀', () => {
    const DIO: RouteObstacle = { id: 'd1', x: -17, y: -12, w: 34, h: 24 };
    // 从 a 引脚 (-22,0) 水平朝左出线：拐点 (-70,0) 在足迹外 → 折线保留
    const segs = routeSegments({ x: -22, y: 0 }, { x: -80, y: 0 }, 0, [DIO], 'd1', 'b');
    expect(hitsAny(segs, [DIO])).toBe(false);
  });
});

describe('signalText（端口强度标注）', () => {
  it('输入端口只显示 0/1，不标强度', () => {
    // S_STRONG<<2|0 = 8（强0），S_STRONG<<2|1 = 9（强1）；弱1 = 5
    expect(signalText(8, false)).toBe('0');
    expect(signalText(9, false)).toBe('1');
  });
  it('电路节点默认仍标强度', () => {
    expect(signalText(9)).toBe('1·强');
    expect(signalText(5)).toBe('1·弱');
  });
});
