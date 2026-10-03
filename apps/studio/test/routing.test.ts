import { describe, expect, it } from 'vitest';
import {
  netRootsOf,
  type RouteObstacle,
  routeSegments,
  segHitsRect,
  signalText,
} from '../src/editor/render';

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

  it('水平段沿引脚高度平穿端点元件（从左侧穿进二极管到右侧引脚）会被剔除', () => {
    // 用户报的真实场景：in-a.p(-34,200) → dio1.k(142,90)。D1 足迹 x∈[103,137]
    // y∈[78,102]。旧候选最后一段沿 y=90 从拐点 (54,90) 平穿 D1 到右侧引脚
    // （D1 是端点元件被豁免）→ 方向约束要求拐点在引脚外侧：x ≥ 142。
    const D1: RouteObstacle = { id: 'dio1', x: 103, y: 78, w: 34, h: 24 };
    const segs = routeSegments({ x: -34, y: 200 }, { x: 142, y: 90 }, 0, [D1], 'in-a', 'dio1');
    // 没有任何一段的「主体」穿过 D1 中部
    for (const [p, q] of segs) {
      const midX = (p.x + q.x) / 2;
      const midY = (p.y + q.y) / 2;
      const throughCenter =
        midX > D1.x + 4 && midX < D1.x + D1.w - 4 && midY > D1.y && midY < D1.y + D1.h;
      expect(throughCenter).toBe(false);
    }
    // 最后一段从 D1 外侧接近引脚：拐点 x ≥ 引脚 x
    const lastTurn = segs[segs.length - 1][0];
    expect(lastTurn.x).toBeGreaterThanOrEqual(142);
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

  it('走线不压未连接的引脚（点障碍）：直连会被引脚弹开', () => {
    // 矩形在 y∈[30,50]（离直连路径 y=0 很远），但引脚 (40,0) 正好在直连线上——
    // 只有点障碍能拦下它，矩形拦不到。
    const OBS: RouteObstacle = { id: 'q1', x: -10, y: 30, w: 20, h: 20, pins: [{ x: 40, y: 0 }] };
    const segs = routeSegments({ x: -80, y: 0 }, { x: 80, y: 0 }, 0, [OBS], 'a', 'b');
    // 直连被引脚淘汰：结果不再是单段直线
    expect(segs.length).toBeGreaterThan(1);
    // 任何一段都不进入引脚 (40,0) 的 7px 邻域
    for (const [p, q] of segs) {
      expect(distToPoint(p, q, { x: 40, y: 0 })).toBeGreaterThan(7);
    }
    // 端点元件自己的引脚不算障碍（豁免）
    const own = routeSegments({ x: 40, y: 0 }, { x: 80, y: 0 }, 0, [OBS], 'q1', 'b');
    expect(own).toEqual([
      [
        { x: 40, y: 0 },
        { x: 80, y: 0 },
      ],
    ]);
  });

  it('新线不与已布导线平行重叠（避让 placed），垂直交叉仍允许', () => {
    // 已布好一条 y=20 的水平线
    const placed: Array<[{ x: number; y: number }, { x: number; y: number }]> = [
      [
        { x: 0, y: 20 },
        { x: 200, y: 20 },
      ],
    ];
    // 与 placed 完全重合的直连被淘汰：结果换路（y=20 上的长段不应出现）
    const segs = routeSegments({ x: 0, y: 20 }, { x: 200, y: 20 }, 0, [], 'a', 'b', placed);
    const overlaps = segs.some(
      ([p, q]) =>
        p.y === 20 &&
        q.y === 20 &&
        Math.max(p.x, q.x) - Math.min(p.x, q.x) > 1 &&
        Math.max(p.x, q.x) > 0 &&
        Math.min(p.x, q.x) < 200,
    );
    expect(overlaps).toBe(false);
    // 垂直交叉于一点不淘汰：竖线照常直连
    const cross = routeSegments({ x: 100, y: 0 }, { x: 100, y: 40 }, 0, [], 'a', 'b', placed);
    expect(cross).toEqual([
      [
        { x: 100, y: 0 },
        { x: 100, y: 40 },
      ],
    ]);
    // 平行但相距够远（> 6）不算重叠，允许
    const apart = routeSegments({ x: 0, y: 40 }, { x: 200, y: 40 }, 0, [], 'a', 'b', placed);
    expect(apart).toEqual([
      [
        { x: 0, y: 40 },
        { x: 200, y: 40 },
      ],
    ]);
  });
});

/** 点到线段的最短距离（测试断言用） */
function distToPoint(
  p: { x: number; y: number },
  q: { x: number; y: number },
  pt: { x: number; y: number },
): number {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(pt.x - p.x, pt.y - p.y);
  let t = ((pt.x - p.x) * dx + (pt.y - p.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(pt.x - (p.x + t * dx), pt.y - (p.y + t * dy));
}

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

describe('netRootsOf（整网并查集）', () => {
  const wire = (id: string, a: [string, string, number?], b: [string, string, number?]) => ({
    id,
    a: { inst: a[0], pin: a[1], bit: a[2] ?? 0 },
    b: { inst: b[0], pin: b[1], bit: b[2] ?? 0 },
  });
  /** 断言两条线是否在同一张网里 */
  const sameNet = (wires: ReturnType<typeof wire>[], x: string, y: string): boolean =>
    netRootsOf(wires).get(x) === netRootsOf(wires).get(y);

  it('同一位引脚扇出 → 同一整网（悬停任一根整网一起亮）', () => {
    const ws = [
      wire('w1', ['u1', 'y', 0], ['p1', 'bcd', 2]),
      wire('w2', ['p1', 'bcd', 2], ['u2', 'a', 0]),
      wire('w3', ['p1', 'bcd', 2], ['u3', 'a', 0]),
    ];
    expect(sameNet(ws, 'w1', 'w2')).toBe(true);
    expect(sameNet(ws, 'w2', 'w3')).toBe(true);
    expect(sameNet(ws, 'w1', 'w3')).toBe(true);
  });

  it('多 bit 端口不同 bit 是独立引脚 → 各自成网（bin/bcd 不得误并）', () => {
    const ws = [
      wire('w0', ['p1', 'bcd', 0], ['u0', 'a', 0]),
      wire('w1', ['p1', 'bcd', 1], ['u1', 'a', 0]),
      wire('w2', ['p1', 'bcd', 2], ['u2', 'a', 0]),
      wire('w3', ['p1', 'bcd', 3], ['u3', 'a', 0]),
    ];
    // 4 根线两两不同网
    for (const a of ws) {
      for (const b of ws) {
        if (a === b) continue;
        expect(sameNet(ws, a.id, b.id), `${a.id} 与 ${b.id} 应各自成网`).toBe(false);
      }
    }
  });

  it('跨元件串联（共享中间引脚）→ 同一整网', () => {
    const ws = [
      wire('w1', ['u1', 'y', 0], ['u2', 'a', 0]),
      wire('w2', ['u2', 'a', 0], ['u3', 'a', 0]),
    ];
    expect(sameNet(ws, 'w1', 'w2')).toBe(true);
  });

  it('bit 缺省与 0 等价（同一物理引脚）', () => {
    const ws = [wire('w1', ['p1', 'bcd', 0], ['u1', 'a']), wire('w2', ['p1', 'bcd'], ['u2', 'a'])];
    expect(sameNet(ws, 'w1', 'w2')).toBe(true);
  });
});
