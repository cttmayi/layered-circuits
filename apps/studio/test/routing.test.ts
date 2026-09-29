import { describe, expect, it } from 'vitest';
import { type RouteObstacle, routeSegments, segHitsRect } from '../src/editor/render';

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
});
