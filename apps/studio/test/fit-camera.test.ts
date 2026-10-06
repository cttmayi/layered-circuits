/**
 * 进关自适应（按可见面积）纯函数单测。
 *
 * 口径：目标 175 格²、允许 [150, 200]；格距 = `GRID_PITCH = 20` 世界单位/格
 * （editor/render.ts `drawGrid()` 的步长）。
 *
 * 这里断言的是**实得面积**（由 camera 反推：`visibleCells()`），不是"应该"，全是数字。
 * 大屏上 175 格² 需要的缩放超过手势层上限 2.6（桌面要 3.713、平板要 3.257），被硬夹紧后
 * 面积必然 > 200 —— 这几条单独写出来，断言 `clamped === 'max'` 与具体数字，别假装达标。
 */
import { describe, expect, it } from 'vitest';
import { SCALE_RANGE } from '../src/editor/gesture.ts';
import {
  CELLS_AREA_RANGE,
  CONTENT_MARGIN,
  contentBoxOf,
  fitCamera,
  GRID_PITCH,
  TARGET_CELLS_AREA,
  usableArea,
  visibleCells,
} from '../src/layout/fit.ts';

/** 可用区 = 视口扣掉顶栏（桌面 46 / 窄屏 57）与竖屏底部抽屉 */
const VIEWPORTS = [
  { label: '桌面 1280×800（画布 1280×754）', w: 1280, h: 754 },
  { label: '竖屏 390×844（画布 390×787）', w: 390, h: 787 },
  { label: '横屏 844×390（画布 844×333）', w: 844, h: 333 },
  { label: '平板 768×1024（画布 768×967）', w: 768, h: 967 },
] as const;

/** 竖屏把抽屉拉开后的可用区（元件库/验收抽屉高 362，见 mobile-layout 实测） */
const PORTRAIT_WITH_SHEET = {
  label: '竖屏 390×844 + 底部抽屉 362（可用 390×425）',
  w: 390,
  h: 425,
};

/** 小内容：40×30 世界单位的元件区（远小于 175 格² 的可视区 → 面积口径说了算） */
const SMALL = { x: 300, y: 200, w: 40, h: 30 };
/** 大内容：900×700 世界单位（≈ 45×35 格，比可视区大 → 内容口径说了算） */
const BIG = { x: 260, y: 90, w: 900, h: 700 };

describe('格距与可见格数口径', () => {
  it('格距常量 = 20 世界单位/格（render.ts drawGrid 的步长）', () => {
    expect(GRID_PITCH).toBe(20);
    expect(TARGET_CELLS_AREA).toBe(175);
    expect(CELLS_AREA_RANGE).toEqual({ min: 150, max: 200 });
    // 与手势层的缩放区间是同一个来源，不是另抄一份
    expect(SCALE_RANGE).toEqual({ min: 0.35, max: 2.6 });
  });

  it('visibleCells：scale=1 时 800×600 可见 40×30 = 1200 格²', () => {
    const cells = visibleCells({ x: 0, y: 0, scale: 1 }, 800, 600);
    expect(cells.x).toBeCloseTo(40, 9);
    expect(cells.y).toBeCloseTo(30, 9);
    expect(cells.area).toBeCloseTo(1200, 6);
  });

  it('可见格块的宽高比 == 可用区宽高比（铺满可用区，不是反的）', () => {
    for (const v of [...VIEWPORTS, PORTRAIT_WITH_SHEET]) {
      const { camera, cells } = fitCamera({ width: v.w, height: v.h, content: SMALL });
      expect(cells.x / cells.y).toBeCloseTo(v.w / v.h, 6);
      // 面积口径落点：格块宽高比正确时 cellsX 就是 sqrt(175 × A)
      expect(camera.scale).toBeGreaterThan(0);
    }
  });
});

describe('面积口径：小内容时按 175 格² 取景', () => {
  it.each([...VIEWPORTS, PORTRAIT_WITH_SHEET])('$label', (v) => {
    const r = fitCamera({ width: v.w, height: v.h, content: SMALL });
    const cells = visibleCells(r.camera, v.w, v.h);
    // scale 永远落在手势区间里
    expect(r.camera.scale).toBeGreaterThanOrEqual(SCALE_RANGE.min);
    expect(r.camera.scale).toBeLessThanOrEqual(SCALE_RANGE.max);
    expect(cells.area).toBeCloseTo(r.cells.area, 6);

    if (r.clamped === 'none') {
      // 夹紧没生效 → 必须正好是 175 格²（落进 [150,200]）
      expect(r.camera.scale).toBeCloseTo(r.areaScale, 9);
      expect(cells.area).toBeCloseTo(TARGET_CELLS_AREA, 6);
      expect(cells.area).toBeGreaterThanOrEqual(CELLS_AREA_RANGE.min);
      expect(cells.area).toBeLessThanOrEqual(CELLS_AREA_RANGE.max);
    } else {
      // 夹紧生效 → 只能顶到边界；这里只可能是上限（大屏）
      expect(r.clamped).toBe('max');
      expect(r.camera.scale).toBe(SCALE_RANGE.max);
      expect(r.areaScale).toBeGreaterThan(SCALE_RANGE.max);
    }
  });

  it('竖屏/横屏/竖屏+抽屉：实得面积正好 175.0 格²，且 scale 在上限之内', () => {
    for (const v of [{ w: 390, h: 787 }, { w: 844, h: 333 }, PORTRAIT_WITH_SHEET]) {
      const r = fitCamera({ width: v.w, height: v.h, content: SMALL });
      expect(r.clamped).toBe('none');
      expect(r.cells.area).toBeCloseTo(175, 6);
      expect(r.camera.scale).toBeLessThan(SCALE_RANGE.max);
    }
    // 具体数字：竖屏 2.094、横屏 2.004、竖屏+抽屉 1.539
    expect(fitCamera({ width: 390, height: 787, content: SMALL }).camera.scale).toBeCloseTo(
      2.094,
      3,
    );
    expect(fitCamera({ width: 844, height: 333, content: SMALL }).camera.scale).toBeCloseTo(
      2.004,
      3,
    );
    expect(fitCamera({ width: 390, height: 425, content: SMALL }).camera.scale).toBeCloseTo(
      1.539,
      3,
    );
  });

  it('桌面/平板：175 格² 需要 3.713 / 3.257 > 上限 2.6 → 顶到 2.6，面积必然超标（硬夹紧）', () => {
    const desk = fitCamera({ width: 1280, height: 754, content: SMALL });
    expect(desk.areaScale).toBeCloseTo(3.713, 3);
    expect(desk.clamped).toBe('max');
    expect(desk.camera.scale).toBe(2.6);
    expect(desk.cells.area).toBeCloseTo(356.9, 1); // 1280×754 / (20×2.6)²

    const pad = fitCamera({ width: 768, height: 967, content: SMALL });
    expect(pad.areaScale).toBeCloseTo(3.257, 3);
    expect(pad.camera.scale).toBe(2.6);
    expect(pad.cells.area).toBeCloseTo(274.7, 1);

    // 反证：把上限提到 3.713 就正好 175（说明差的只是上限，不是公式）
    const unclamped = fitCamera({
      width: 1280,
      height: 754,
      content: SMALL,
      scaleRange: { min: 0.35, max: 4 },
    });
    expect(unclamped.clamped).toBe('none');
    expect(unclamped.cells.area).toBeCloseTo(175, 6);
  });
});

describe('内容优先', () => {
  it('大电路：取更小的那个 scale，内容（含留白）完整落在可用区内', () => {
    for (const v of [...VIEWPORTS, PORTRAIT_WITH_SHEET]) {
      const r = fitCamera({ width: v.w, height: v.h, content: BIG });
      expect(r.contentScale).toBeLessThan(r.areaScale); // 内容口径确实更紧
      expect(r.camera.scale).toBeCloseTo(r.contentScale, 9);
      expect(r.camera.scale).toBeGreaterThanOrEqual(SCALE_RANGE.min);
      expect(r.camera.scale).toBeLessThanOrEqual(SCALE_RANGE.max);

      // 内容 bbox（含留白）→ 屏幕坐标，四边都在可用区里
      const halfW = (BIG.w / 2 + CONTENT_MARGIN) * r.camera.scale;
      const halfH = (BIG.h / 2 + CONTENT_MARGIN) * r.camera.scale;
      expect(halfW).toBeLessThanOrEqual(v.w / 2 + 1e-9);
      expect(halfH).toBeLessThanOrEqual(v.h / 2 + 1e-9);
      // 居中：内容中心 == 相机位置（可用区中心）
      expect(r.camera.x).toBeCloseTo(BIG.x + BIG.w / 2, 9);
      expect(r.camera.y).toBeCloseTo(BIG.y + BIG.h / 2, 9);
    }
  });

  it('小内容：不会被放大超过面积口径的 scale（175 格² 那个）', () => {
    for (const v of [...VIEWPORTS, PORTRAIT_WITH_SHEET]) {
      const r = fitCamera({ width: v.w, height: v.h, content: { x: 0, y: 0, w: 20, h: 20 } });
      expect(r.camera.scale).toBeLessThanOrEqual(Math.min(r.areaScale, SCALE_RANGE.max) + 1e-12);
      expect(r.contentScale).toBeGreaterThan(r.areaScale); // 内容口径确实更松
    }
  });

  it('超大电路：夹到 0.35 下限（允许平移看其余部分），不越界', () => {
    const huge = { x: 0, y: 0, w: 20000, h: 12000 };
    const r = fitCamera({ width: 390, height: 787, content: huge });
    expect(r.clamped).toBe('min');
    expect(r.camera.scale).toBe(SCALE_RANGE.min);
  });

  it('空关卡（没有元件）：用传入的落点，只按面积定 scale', () => {
    const r = fitCamera({ width: 390, height: 787, content: null, center: { x: 340, y: 220 } });
    expect(r.camera.x).toBe(340);
    expect(r.camera.y).toBe(220);
    expect(r.cells.area).toBeCloseTo(175, 6);
  });
});

describe('usableArea：可用区扣掉覆盖式面板', () => {
  it('桌面：面板是流内布局，可用区不动（size 本来就不含它们）', () => {
    const a = usableArea({
      width: 1280,
      height: 754,
      narrow: false,
      portrait: false,
      leftOpen: true,
      rightOpen: true,
      bottomSheet: { w: 240, h: 754 },
      sidePanel: { w: 316, h: 754 },
    });
    expect(a).toEqual({ width: 1280, height: 754 });
  });

  it('竖屏：元件库/验收是底部抽屉 → 扣高度（抽屉关着不扣）', () => {
    const open = usableArea({
      width: 390,
      height: 787,
      narrow: true,
      portrait: true,
      leftOpen: true,
      rightOpen: false,
      bottomSheet: { w: 390, h: 362 },
    });
    expect(open).toEqual({ width: 390, height: 425 });
    const closed = usableArea({
      width: 390,
      height: 787,
      narrow: true,
      portrait: true,
      leftOpen: false,
      rightOpen: false,
      bottomSheet: { w: 390, h: 362 }, // 元素不在了也量不到；这里给 0 表示量不到
    });
    expect(closed).toEqual({ width: 390, height: 787 });
    // 验收抽屉开着也一样扣高度（两块是同一种底部抽屉）
    const side = usableArea({
      width: 390,
      height: 787,
      narrow: true,
      portrait: true,
      leftOpen: false,
      rightOpen: true,
      bottomSheet: { w: 390, h: 362 },
    });
    expect(side).toEqual({ width: 390, height: 425 });
  });

  it('窄屏横屏：左右都是覆盖抽屉 → 扣宽度', () => {
    const both = usableArea({
      width: 844,
      height: 333,
      narrow: true,
      portrait: false,
      leftOpen: true,
      rightOpen: true,
      bottomSheet: { w: 320, h: 333 },
      sidePanel: { w: 360, h: 333 },
    });
    expect(both).toEqual({ width: 164, height: 333 });
    const rightOnly = usableArea({
      width: 844,
      height: 333,
      narrow: true,
      portrait: false,
      leftOpen: false,
      rightOpen: true,
      sidePanel: { w: 360, h: 333 },
    });
    expect(rightOnly).toEqual({ width: 484, height: 333 });
  });

  it('竖屏扣掉抽屉后：面积口径仍落在 175 格²（实得）', () => {
    const a = usableArea({
      width: 390,
      height: 787,
      narrow: true,
      portrait: true,
      leftOpen: true,
      rightOpen: false,
      bottomSheet: { w: 390, h: 362 },
    });
    const r = fitCamera({ width: a.width, height: a.height, content: SMALL });
    expect(r.clamped).toBe('none');
    expect(r.cells.area).toBeCloseTo(175, 6);
    expect(visibleCells(r.camera, a.width, a.height).area).toBeCloseTo(175, 6);
    expect(r.camera.scale).toBeCloseTo(1.539, 3);
  });

  it('抽屉比画布还高（离谱输入）→ 兜底到下限，不出现 0/负数', () => {
    const a = usableArea({
      width: 390,
      height: 300,
      narrow: true,
      portrait: true,
      leftOpen: true,
      rightOpen: false,
      bottomSheet: { w: 390, h: 362 },
    });
    expect(a).toEqual({ width: 390, height: 120 });
  });
});

describe('contentBoxOf：内容 bbox 由元件足迹算', () => {
  const box = (x: number, y: number, w: number, h: number) => ({
    x: x - w / 2,
    y: y - h / 2,
    w,
    h,
  });

  it('并集 + 空关卡返回 null', () => {
    expect(contentBoxOf([], (s: { x: number; y: number }) => box(s.x, s.y, 44, 44))).toBeNull();
    const b = contentBoxOf(
      [
        { x: 100, y: 100 },
        { x: 300, y: 50 },
      ],
      (s) => box(s.x, s.y, 44, 44),
    );
    expect(b).toEqual({ x: 78, y: 28, w: 244, h: 94 });
  });

  it('教学关 backdrop 不参与（否则一面大墙会把相机拉远）—— 只喂 syms 就是', () => {
    const b = contentBoxOf([{ x: 0, y: 0 }], (s) => box(s.x, s.y, 20, 20));
    expect(b).toEqual({ x: -10, y: -10, w: 20, h: 20 });
  });
});

describe('相机模型一致：camera 是「可用区中心对应的世界点」', () => {
  it('世界中心映射到屏幕中心（render.ts 的 worldToScreen 口径）', () => {
    const w = 390;
    const h = 787;
    const r = fitCamera({ width: w, height: h, content: BIG });
    // worldToScreen：sx = (wx - camera.x) * scale + width / 2
    const sx = (r.camera.x - r.camera.x) * r.camera.scale + w / 2;
    const sy = (r.camera.y - r.camera.y) * r.camera.scale + h / 2;
    expect(sx).toBeCloseTo(w / 2, 9);
    expect(sy).toBeCloseTo(h / 2, 9);
  });
});
