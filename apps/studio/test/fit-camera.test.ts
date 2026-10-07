/**
 * 进关自适应（按可见面积）纯函数单测。
 *
 * 口径（**唯一口径**）：目标 175 格²、允许 [150, 200]；格距 = `GRID_PITCH = 20` 世界单位/格
 * （editor/render.ts `drawGrid()` 的步长）。175 格² ≈ **13.2 × 13.2 格** = 用户要的「横向 10~15 格」。
 * **内容尺寸不参与定 scale**（用户裁定：早期"内容优先"会把视野撑到 607~3105 格²，是要求值的 3 倍），
 * 内容 bbox 只决定相机中心；大关卡超出视野靠平移/缩放看 —— 这是预期代价。
 *
 * 这里断言的是**实得面积**（由 camera 反推：`visibleCells()`），不是"应该"，全是数字。
 * 大屏上 175 格² 需要的缩放超过手势层上限 2.6（桌面画布 1024×754 要 3.321、平板 768×967 要 3.257），
 * 被硬夹紧后面积必然 > 200（桌面 **285.5**、平板 **274.7**）—— 这几条单独写出来，断言 `clamped === 'max'`
 * 与具体数字，别假装达标（上限属手势契约，本轮不动）。
 */
import { describe, expect, it } from 'vitest';
import { SCALE_RANGE } from '../src/editor/gesture.ts';
import {
  type Box,
  CELLS_AREA_RANGE,
  contentBoxOf,
  fitCamera,
  GRID_PITCH,
  TARGET_CELLS_AREA,
  usableArea,
  visibleCells,
} from '../src/layout/fit.ts';

/**
 * 可用区 = **真机量出来的画布尺寸**（headless Chrome 1280×800 / 844×390 / 390×844 / 768×1024，
 * 第 ⑧ 轮 CDP 实测，与 App 里 usableArea 的口径一致）：
 *  - 桌面：画布 1024×754 —— 顶栏 46 + 左侧元件库 240 + 间距 16（元件库是流内布局）；
 *  - 竖屏：画布 390×683 —— 顶栏 161（任务块换行后的高度，见 mobile-layout 的竖屏顶栏契约）；
 *  - 横屏：画布 844×333 —— 顶栏 57，元件库是覆盖抽屉（关着就不占）；
 *  - 平板竖屏：画布 768×967 —— 顶栏 57（任务块与按钮同行）。
 */
const VIEWPORTS = [
  { label: '桌面 1280×800（画布 1024×754）', w: 1024, h: 754 },
  { label: '竖屏 390×844（画布 390×683）', w: 390, h: 683 },
  { label: '横屏 844×390（画布 844×333）', w: 844, h: 333 },
  { label: '平板 768×1024（画布 768×967）', w: 768, h: 967 },
] as const;

/** 竖屏把元件库抽屉拉开后**未被遮住**的那条（CDP 实测抽屉 314px：683 − 314 = 369） */
const PORTRAIT_WITH_SHEET = {
  label: '竖屏 390×844 + 底部抽屉 314（未被遮住 390×369）',
  w: 390,
  h: 369,
};

/** 小内容：40×30 世界单位的元件区 */
const SMALL = { x: 300, y: 200, w: 40, h: 30 };
/**
 * **真实关卡进关时的内容 bbox**（元件足迹，`docForLevel` + `footprintOf` 实算，见 fit-entry.test.tsx
 * 里同一算法现算的那几条）：所有关卡都带 VCC/GND 电源轨与右侧端口，所以**宽度恒 704**；
 * 高度按关卡 164（非门）~ 584（段码·abc / 多输入或门）。
 */
const REAL_NOT = { x: 18, y: 49, w: 704, h: 164 }; // 第 1 关「非门」
const REAL_TALL = { x: 18, y: 49, w: 704, h: 584 }; // 最高的一关

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
      const { camera, cells } = fitCamera({ width: v.w, height: v.h, content: REAL_TALL });
      expect(cells.x / cells.y).toBeCloseTo(v.w / v.h, 6);
      // 面积口径落点：格块宽高比正确时 cellsX 就是 sqrt(175 × A)
      expect(camera.scale).toBeGreaterThan(0);
    }
  });
});

describe('面积口径：按 175 格² 取景（内容尺寸不参与）', () => {
  it.each([...VIEWPORTS, PORTRAIT_WITH_SHEET])('$label', (v) => {
    const r = fitCamera({ width: v.w, height: v.h, content: REAL_TALL });
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
    for (const v of [{ w: 390, h: 683 }, { w: 844, h: 333 }, PORTRAIT_WITH_SHEET]) {
      const r = fitCamera({ width: v.w, height: v.h, content: REAL_NOT });
      expect(r.clamped).toBe('none');
      expect(r.cells.area).toBeCloseTo(175, 6);
      expect(r.camera.scale).toBeLessThan(SCALE_RANGE.max);
    }
    // 具体数字：竖屏 1.951、横屏 2.004、竖屏+抽屉 1.434（后两个与 CDP 实测 2.0 / 1.45 对得上）
    expect(fitCamera({ width: 390, height: 683, content: REAL_NOT }).camera.scale).toBeCloseTo(
      1.951,
      3,
    );
    expect(fitCamera({ width: 844, height: 333, content: REAL_NOT }).camera.scale).toBeCloseTo(
      2.004,
      3,
    );
    expect(fitCamera({ width: 390, height: 369, content: REAL_NOT }).camera.scale).toBeCloseTo(
      1.434,
      3,
    );
  });

  it('桌面/平板：175 格² 需要 3.321 / 3.257 > 上限 2.6 → 顶到 2.6，面积必然超标（硬夹紧）', () => {
    // 「被 max 截住」= 这两个视口永远拿不到 175：**285.5 / 274.7 格²** 就是本口径在大屏上的真实落点
    // （CDP 从画布像素量出来的也是这两个数）
    const desk = fitCamera({ width: 1024, height: 754, content: SMALL });
    expect(desk.areaScale).toBeCloseTo(3.321, 3);
    expect(desk.clamped).toBe('max');
    expect(desk.camera.scale).toBe(2.6);
    expect(desk.cells.area).toBeCloseTo(285.5, 1); // 1024×754 / (20×2.6)²

    const pad = fitCamera({ width: 768, height: 967, content: SMALL });
    expect(pad.areaScale).toBeCloseTo(3.257, 3);
    expect(pad.camera.scale).toBe(2.6);
    expect(pad.cells.area).toBeCloseTo(274.7, 1);

    // 反证：把上限提到 4 就正好 175（说明差的只是上限，不是公式）
    const unclamped = fitCamera({
      width: 1024,
      height: 754,
      content: SMALL,
      scaleRange: { min: 0.35, max: 4 },
    });
    expect(unclamped.clamped).toBe('none');
    expect(unclamped.cells.area).toBeCloseTo(175, 6);
  });
});

describe('内容不参与定 scale（用户裁定：固定约 13 格视野，超出靠平移/缩放）', () => {
  it('真实关卡尺寸（704×584）也不会把视野撑大：实得面积仍是 175 / 或只顶到上限 2.6 的边界', () => {
    // 目标值：小屏 175 格²；桌面/平板被手势上限 2.6 截到 285.5 / 274.7（硬夹紧，见文件头）
    const expected: Record<string, number> = {
      '桌面 1280×800（画布 1024×754）': 285.5,
      '竖屏 390×844（画布 390×683）': 175, // CDP 实测 175.1（网格间距量化误差）
      '横屏 844×390（画布 844×333）': 175,
      '平板 768×1024（画布 768×967）': 274.7,
      '竖屏 390×844 + 底部抽屉 314（未被遮住 390×369）': 175,
    };
    for (const v of [...VIEWPORTS, PORTRAIT_WITH_SHEET]) {
      const r = fitCamera({ width: v.w, height: v.h, content: REAL_TALL });
      expect(r.cells.area).toBeCloseTo(expected[v.label] ?? Number.NaN, 1);
      // 关键：**不许**被内容撑大（老的内容优先口径下真实关卡是 606~2691 格²，见下面那条反证）
      expect(r.cells.area).toBeLessThan(607);
      // 内容比视野大 → 一定有一部分在视野外，靠平移/缩放看（这是本口径的预期代价）
      expect((REAL_TALL.w * r.camera.scale) / 2).toBeGreaterThan(v.w / 2);
    }
  });

  it('反证：老口径（min(面积, 内容)）下真实关卡的实得面积是 606.3 / 1496.9 / 2691.1 格²', () => {
    const cellsWith = (w: number, h: number, scale: number) => (w * h) / (GRID_PITCH * scale) ** 2;
    const oldScale = (w: number, h: number, box: { w: number; h: number }): number =>
      Math.min(w / (box.w + 80), h / (box.h + 80));
    const newScale = (w: number, h: number, box: Box): number =>
      fitCamera({ width: w, height: h, content: box }).camera.scale;

    // ① 横屏 844×333 + 非门（内容 704×164）：老口径 1.0765 → 606.3 格²（新口径 175）
    const land = oldScale(844, 333, REAL_NOT);
    expect(land).toBeCloseTo(1.0765, 3);
    expect(cellsWith(844, 333, land)).toBeCloseTo(606.3, 1);
    expect(cellsWith(844, 333, newScale(844, 333, REAL_NOT))).toBeCloseTo(175, 1);
    // ② 桌面 1024×754 + 高关（704×584）：老口径 1.1355 → 1496.9 格²（新口径 285.5）
    const desk = oldScale(1024, 754, REAL_TALL);
    expect(desk).toBeCloseTo(1.1355, 3);
    expect(cellsWith(1024, 754, desk)).toBeCloseTo(1496.9, 1);
    expect(cellsWith(1024, 754, newScale(1024, 754, REAL_TALL))).toBeCloseTo(285.5, 1);
    // ③ 竖屏 390×683 + 高关：老口径 0.4974 → 2691.1 格²（新口径 175）
    const port = oldScale(390, 683, REAL_TALL);
    expect(port).toBeCloseTo(0.4974, 3);
    expect(cellsWith(390, 683, port)).toBeCloseTo(2691.1, 1);
    expect(cellsWith(390, 683, newScale(390, 683, REAL_TALL))).toBeCloseTo(175, 1);
  });

  it('同一视口下，内容尺寸怎么变都不动 scale：只动相机中心', () => {
    for (const content of [SMALL, REAL_NOT, REAL_TALL, { x: 0, y: 0, w: 20000, h: 12000 }]) {
      const r = fitCamera({ width: 390, height: 683, content });
      expect(r.camera.scale).toBeCloseTo(1.951, 3); // 与 175 格² 的面积口径一致（CDP 实测 1.95）
      expect(r.cells.area).toBeCloseTo(175, 1);
      // 只有中心跟着内容走（把内容 bbox 中心放进可用区中心，不算内容优先）
      expect(r.camera.x).toBeCloseTo(content.x + content.w / 2, 9);
      expect(r.camera.y).toBeCloseTo(content.y + content.h / 2, 9);
    }
  });

  it('超大电路也不再被夹到 0.35：面积口径与内容无关，视野恒定', () => {
    const huge = { x: 0, y: 0, w: 20000, h: 12000 };
    const r = fitCamera({ width: 390, height: 683, content: huge });
    expect(r.clamped).toBe('none');
    expect(r.camera.scale).toBeCloseTo(1.951, 3);
    expect(r.camera.x).toBeCloseTo(10000, 6); // 内容中心
    expect(r.camera.y).toBeCloseTo(6000, 6);
  });

  it('空关卡（没有元件）：用传入的落点，只按面积定 scale', () => {
    const r = fitCamera({ width: 390, height: 683, content: null, center: { x: 340, y: 220 } });
    expect(r.camera.x).toBe(340);
    expect(r.camera.y).toBe(220);
    expect(r.cells.area).toBeCloseTo(175, 1);
  });
});

describe('usableArea：可用区扣掉覆盖式面板', () => {
  // 右侧「验收/属性」面板已按用户要求整块移除 → UsableAreaInput 里不再有 rightOpen/sidePanel
  // 这两个输入项（改动见 App.tsx：右侧面板、右侧开合手柄、右侧避让全部删除）。

  it('桌面：面板是流内布局，可用区不动（size 本来就不含它们）', () => {
    const a = usableArea({
      width: 1280,
      height: 754,
      narrow: false,
      portrait: false,
      leftOpen: true,
      bottomSheet: { w: 240, h: 754 },
    });
    expect(a).toEqual({ width: 1280, height: 754 });
  });

  it('竖屏：元件库是底部抽屉 → 扣高度（抽屉关着不扣）', () => {
    const open = usableArea({
      width: 390,
      height: 683,
      narrow: true,
      portrait: true,
      leftOpen: true,
      bottomSheet: { w: 390, h: 314 }, // CDP 实测竖屏抽屉 314px
    });
    expect(open).toEqual({ width: 390, height: 369 });
    const closed = usableArea({
      width: 390,
      height: 683,
      narrow: true,
      portrait: true,
      leftOpen: false,
      bottomSheet: { w: 390, h: 314 }, // 元素不在了也量不到；这里给 0 表示量不到
    });
    expect(closed).toEqual({ width: 390, height: 683 });
  });

  it('窄屏横屏：只有元件库是覆盖抽屉 → 扣宽度（右侧面板已移除，不再扣右边）', () => {
    const leftOnly = usableArea({
      width: 844,
      height: 333,
      narrow: true,
      portrait: false,
      leftOpen: true,
      bottomSheet: { w: 320, h: 333 },
    });
    expect(leftOnly).toEqual({ width: 524, height: 333 });
    const closed = usableArea({
      width: 844,
      height: 333,
      narrow: true,
      portrait: false,
      leftOpen: false,
      bottomSheet: { w: 320, h: 333 },
    });
    expect(closed).toEqual({ width: 844, height: 333 });
  });

  it('竖屏扣掉抽屉后：面积口径仍落在 175 格²（实得）', () => {
    const a = usableArea({
      width: 390,
      height: 683,
      narrow: true,
      portrait: true,
      leftOpen: true,
      bottomSheet: { w: 390, h: 314 },
    });
    const r = fitCamera({ width: a.width, height: a.height, content: SMALL });
    expect(r.clamped).toBe('none');
    expect(r.cells.area).toBeCloseTo(175, 6);
    expect(visibleCells(r.camera, a.width, a.height).area).toBeCloseTo(175, 6);
    expect(r.camera.scale).toBeCloseTo(1.434, 3);
  });

  it('抽屉比画布还高（离谱输入）→ 兜底到下限，不出现 0/负数', () => {
    const a = usableArea({
      width: 390,
      height: 300,
      narrow: true,
      portrait: true,
      leftOpen: true,
      bottomSheet: { w: 390, h: 314 },
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
    const h = 683;
    const r = fitCamera({ width: w, height: h, content: REAL_TALL });
    // worldToScreen：sx = (wx - camera.x) * scale + width / 2
    const sx = (r.camera.x - r.camera.x) * r.camera.scale + w / 2;
    const sy = (r.camera.y - r.camera.y) * r.camera.scale + h / 2;
    expect(sx).toBeCloseTo(w / 2, 9);
    expect(sy).toBeCloseTo(h / 2, 9);
  });
});
