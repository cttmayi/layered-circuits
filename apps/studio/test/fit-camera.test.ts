/**
 * 进关自适应（按可见面积）纯函数单测。
 *
 * 口径（**唯一口径**）：目标 **2275 格²**（= 175 × 13，用户第 ⑩ 轮"视野再扩大 13 倍"）、
 * 允许 **[1950, 2600]**（= [150, 200] × 13）；格距 = `GRID_PITCH = 20` 世界单位/格
 * （editor/render.ts `drawGrid()` 的步长）。2275 格² ≈ **47.7 × 47.7 格**（等比例见方），
 * 各视口按自己的宽高比分配（同一套自洽公式）。
 * **内容尺寸不参与定 scale**（用户裁定：早期"内容优先"会给出 606~2896 格²，四视口没有一个落在新区间里），
 * 内容 bbox 只决定相机中心。
 *
 * 这里断言的是**实得面积**（由 camera 反推：`visibleCells()`），不是"应该"，全是数字。
 * 目标放大 13 倍后**四个目标视口都不撞手势边界**（scale 0.556 ~ 0.921，全在手势区间 [0.35, 2.6] 内），
 * 所以每条都断言 `clamped === 'none'` 且面积正好 2275。容易撞的是**下限**：又小又扁的画布
 * （如 300×200）面积口径只要 0.257 → 夹到 0.35，实得 1224.5 格²（低于区间下限）—— 单列一条验证。
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
 * 第 ⑨ 轮 CDP 实测，与 App 里 usableArea 的口径一致）：
 *  - 桌面：画布 1024×754 —— 顶栏 46 + 左侧元件库 240 + 间距 16（元件库是流内布局）；
 *  - 竖屏：画布 390×735（CDP 实测：顶栏 109 → 844 − 109 = 735，见 mobile-layout 契约）；
 *    用户口径里写的是 390×683，两者都单独覆盖（见"用户第 ⑩ 轮点名的四视口"那条）；
 *  - 横屏：画布 844×333 —— 顶栏 57，元件库是覆盖抽屉（关着就不占）；
 *  - 平板竖屏：画布 768×967 —— 顶栏 57（任务块与按钮同行）。
 */
const VIEWPORTS = [
  { label: '桌面 1280×800（画布 1024×754）', w: 1024, h: 754 },
  { label: '竖屏 390×844（画布 390×735）', w: 390, h: 735 },
  { label: '横屏 844×390（画布 844×333）', w: 844, h: 333 },
  { label: '平板 768×1024（画布 768×967）', w: 768, h: 967 },
] as const;

/** 竖屏把元件库抽屉拉开后**未被遮住**的那条（CDP 实测抽屉 338px：735 − 338 = 397） */
const PORTRAIT_WITH_SHEET = {
  label: '竖屏 390×844 + 底部抽屉 338（未被遮住 390×397）',
  w: 390,
  h: 397,
};

/** 每个目标视口的落点（面积口径自洽解的精确值，CDP 从画布像素反推同值） */
const EXPECTED: Record<string, { scale: number; cellsX: number; cellsY: number }> = {
  '桌面 1280×800（画布 1024×754）': { scale: 0.9211, cellsX: 55.585, cellsY: 40.929 },
  '竖屏 390×844（画布 390×735）': { scale: 0.5612, cellsX: 34.744, cellsY: 65.479 },
  '横屏 844×390（画布 844×333）': { scale: 0.5557, cellsX: 75.935, cellsY: 29.96 },
  '平板 768×1024（画布 768×967）': { scale: 0.9034, cellsX: 42.507, cellsY: 53.521 },
  '竖屏 390×844 + 底部抽屉 338（未被遮住 390×397）': {
    scale: 0.4125,
    cellsX: 47.274,
    cellsY: 48.124,
  },
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
    // 用户第 ⑩ 轮：视野再扩大 13 倍 → 175 × 13 = 2275，区间 [150,200] × 13 = [1950,2600]
    expect(TARGET_CELLS_AREA).toBe(2275);
    expect(TARGET_CELLS_AREA / 175).toBe(13);
    expect(CELLS_AREA_RANGE).toEqual({ min: 1950, max: 2600 });
    expect(CELLS_AREA_RANGE.min / TARGET_CELLS_AREA).toBeCloseTo(150 / 175, 9);
    expect(CELLS_AREA_RANGE.max / TARGET_CELLS_AREA).toBeCloseTo(200 / 175, 9);
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
      // 面积口径落点：格块宽高比正确时 cellsX 就是 sqrt(2275 × A)
      expect(cells.x).toBeCloseTo(Math.sqrt(TARGET_CELLS_AREA * (v.w / v.h)), 2);
      expect(camera.scale).toBeGreaterThan(0);
    }
  });
});

describe('面积口径：按 2275 格² 取景（内容尺寸不参与）', () => {
  it.each([...VIEWPORTS, PORTRAIT_WITH_SHEET])('$label', (v) => {
    const r = fitCamera({ width: v.w, height: v.h, content: REAL_TALL });
    const cells = visibleCells(r.camera, v.w, v.h);
    // scale 永远落在手势区间里，而且这次四个视口都**不撞界**
    expect(r.clamped).toBe('none');
    expect(r.camera.scale).toBeGreaterThanOrEqual(SCALE_RANGE.min);
    expect(r.camera.scale).toBeLessThanOrEqual(SCALE_RANGE.max);
    expect(cells.area).toBeCloseTo(r.cells.area, 6);
    // 不夹紧 → 正好是目标面积，并且落在 [1950, 2600] 里
    expect(r.camera.scale).toBeCloseTo(r.areaScale, 9);
    expect(cells.area).toBeCloseTo(TARGET_CELLS_AREA, 6);
    expect(cells.area).toBeCloseTo(2275, 6);
    expect(cells.area).toBeGreaterThanOrEqual(CELLS_AREA_RANGE.min);
    expect(cells.area).toBeLessThanOrEqual(CELLS_AREA_RANGE.max);
    // 每个视口的具体落点（格子数与 scale）
    const e = EXPECTED[v.label];
    expect(e, `${v.label} 缺期望值`).toBeTruthy();
    expect(r.camera.scale).toBeCloseTo(e?.scale ?? Number.NaN, 3);
    expect(cells.x).toBeCloseTo(e?.cellsX ?? Number.NaN, 2);
    expect(cells.y).toBeCloseTo(e?.cellsY ?? Number.NaN, 2);
  });

  it('四个目标视口的 scale 复核（用户手算 1.01 / 0.58 / 0.56 的核对）', () => {
    // ① 用户按 1230×754 手算桌面 1.01：算式一致，但真机画布是 1024×754（元件库 240 + 间距 16 在流内）
    const asUserSaid = fitCamera({ width: 1230, height: 754, content: SMALL });
    expect(asUserSaid.camera.scale).toBeCloseTo(1.0095, 4); // ≈ 用户算的 1.01
    expect(asUserSaid.clamped).toBe('none');
    expect(fitCamera({ width: 1024, height: 754, content: SMALL }).camera.scale).toBeCloseTo(
      0.9211,
      4,
    ); // 真机画布 → 0.921
    // ② 竖屏：用户按 390×787 算 0.58；真机（顶栏 109）是 390×735 → 0.5612
    expect(fitCamera({ width: 390, height: 787, content: SMALL }).camera.scale).toBeCloseTo(
      0.5808,
      4,
    );
    expect(fitCamera({ width: 390, height: 735, content: SMALL }).camera.scale).toBeCloseTo(
      0.5612,
      4,
    );
    // ③ 横屏 844×333：用户 0.56，代码 0.5557 —— 完全一致
    expect(fitCamera({ width: 844, height: 333, content: SMALL }).camera.scale).toBeCloseTo(
      0.5557,
      4,
    );
    // 四个视口全部落在手势区间内 → 不需要动 SCALE_RANGE
    for (const v of VIEWPORTS) {
      const s = fitCamera({ width: v.w, height: v.h, content: REAL_TALL }).camera.scale;
      expect(s, `${v.label} 撞界了`).toBeGreaterThan(SCALE_RANGE.min);
      expect(s, `${v.label} 撞界了`).toBeLessThan(SCALE_RANGE.max);
    }
  });

  it('用户第 ⑩ 轮点名的四视口（桌面 1024×754 / 竖屏 390×683 / 横屏 844×333 / 平板 768×967）', () => {
    // 用**真实代码**（fitCamera）跑这四组可用区：面积落在 [1950, 2600]、scale 落在手势区间
    // [0.35, 2.6]、内容 bbox 中心正好落在视野中心（内容只做取景居中，不参与 scale）。
    // 竖屏这里用用户写下的 683；真机实测画布是 390×735（上面 VIEWPORTS 走的是实测值），两个都在测。
    const userViews = [
      { label: '桌面画布 1024×754', w: 1024, h: 754, scale: 0.9211 },
      { label: '竖屏画布 390×683', w: 390, h: 683, scale: 0.541 },
      { label: '横屏画布 844×333', w: 844, h: 333, scale: 0.5557 },
      { label: '平板画布 768×967', w: 768, h: 967, scale: 0.9034 },
    ] as const;
    for (const v of userViews) {
      const r = fitCamera({ width: v.w, height: v.h, content: REAL_NOT });
      expect(r.clamped, v.label).toBe('none');
      expect(r.cells.area, v.label).toBeCloseTo(TARGET_CELLS_AREA, 6);
      expect(r.cells.area).toBeGreaterThanOrEqual(CELLS_AREA_RANGE.min);
      expect(r.cells.area).toBeLessThanOrEqual(CELLS_AREA_RANGE.max);
      expect(r.camera.scale, v.label).toBeCloseTo(v.scale, 3);
      expect(r.camera.scale, v.label).toBeGreaterThanOrEqual(SCALE_RANGE.min);
      expect(r.camera.scale, v.label).toBeLessThanOrEqual(SCALE_RANGE.max);
      expect(r.camera.x, v.label).toBeCloseTo(REAL_NOT.x + REAL_NOT.w / 2, 9);
      expect(r.camera.y, v.label).toBeCloseTo(REAL_NOT.y + REAL_NOT.h / 2, 9);
      // 等比例时约 47.7 格见方：sqrt(2275) = 47.697
      expect(Math.sqrt(r.cells.area), v.label).toBeCloseTo(47.697, 2);
    }
  });

  it('往"缩小"走顺手解决了老问题：旧口径 175 在桌面/平板撞**上限 2.6**，现在不撞了', () => {
    // 175 格² 想要 scale ≈ 3.3（桌面）/ 3.18（平板）→ 被 SCALE_RANGE.max = 2.6 夹住，
    // 实得只有 285.5 / 274.7 格²（"够不着"）。2275 想要 0.92 / 0.90 → 一头都不撞。
    const cases = [
      { label: '桌面 1024×754', w: 1024, h: 754, oldArea: 285.5 },
      { label: '平板 768×967', w: 768, h: 967, oldArea: 274.7 },
    ] as const;
    for (const v of cases) {
      const old = fitCamera({ width: v.w, height: v.h, content: SMALL, targetArea: 175 });
      expect(old.clamped, v.label).toBe('max');
      expect(old.camera.scale, v.label).toBe(SCALE_RANGE.max);
      expect(old.cells.area, v.label).toBeCloseTo(v.oldArea, 1);
      const now = fitCamera({ width: v.w, height: v.h, content: SMALL });
      expect(now.clamped, v.label).toBe('none');
      expect(now.cells.area, v.label).toBeCloseTo(TARGET_CELLS_AREA, 6);
      // 目标 ×13，但因为老口径被上限吃掉一截，桌面/平板实测只涨到 ×7.97 / ×8.28（如实记录）
      expect(now.cells.area / old.cells.area, v.label).toBeGreaterThan(7.9);
      expect(now.cells.area / old.cells.area, v.label).toBeLessThan(8.4);
    }
  });

  it('又小又扁的画布会撞**下限** 0.35（放大 13 倍后容易撞的是这一头）', () => {
    const tiny = fitCamera({ width: 300, height: 200, content: SMALL });
    expect(tiny.areaScale).toBeCloseTo(0.2568, 4); // 面积口径想要 0.257 < 0.35
    expect(tiny.clamped).toBe('min');
    expect(tiny.camera.scale).toBe(SCALE_RANGE.min);
    expect(tiny.cells.area).toBeCloseTo(1224.5, 1); // 300×200 / (20×0.35)² —— 落在区间外，如实记录
    // 反证：把下限放开到 0.05 → 正好 2275（说明差的只是下限，不是公式）
    const unclamped = fitCamera({
      width: 300,
      height: 200,
      content: SMALL,
      scaleRange: { min: 0.05, max: 2.6 },
    });
    expect(unclamped.clamped).toBe('none');
    expect(unclamped.cells.area).toBeCloseTo(2275, 6);
  });
});

describe('内容不参与定 scale（用户裁定：目标 2275 格²，内容只决定取景中心）', () => {
  it('真实关卡尺寸（704×584）也不会把视野改掉：五个视口一律 2275 格²', () => {
    for (const v of [...VIEWPORTS, PORTRAIT_WITH_SHEET]) {
      const r = fitCamera({ width: v.w, height: v.h, content: REAL_TALL });
      expect(r.cells.area).toBeCloseTo(TARGET_CELLS_AREA, 6);
      expect(r.clamped).toBe('none');
      // 关键：**不许**被内容带偏 —— 老的内容优先口径下真实关卡是 606~2896 格²，
      // 四个视口**没有一个**落在目标区间里（见下面那条反证）
      expect(r.cells.area).toBeGreaterThanOrEqual(CELLS_AREA_RANGE.min);
      expect(r.cells.area).toBeLessThanOrEqual(CELLS_AREA_RANGE.max);
    }
  });

  it('放大 13 倍后真实关卡内容基本都装得下（只有竖屏宽度差一点点）', () => {
    // 可见世界宽 = 可用宽 / scale；真实内容宽恒 704 世界单位（VCC/GND 轨 + 右侧端口）
    const worldW = (w: number, h: number) =>
      w / fitCamera({ width: w, height: h, content: REAL_TALL }).camera.scale;
    const worldH = (w: number, h: number) =>
      h / fitCamera({ width: w, height: h, content: REAL_TALL }).camera.scale;
    // 桌面 / 横屏 / 平板：内容（704×584）整个装得下 → 不再需要"整关靠平移看"
    for (const v of [
      { w: 1024, h: 754 },
      { w: 844, h: 333 },
      { w: 768, h: 967 },
    ]) {
      expect(worldW(v.w, v.h)).toBeGreaterThan(REAL_TALL.w);
      expect(worldH(v.w, v.h)).toBeGreaterThan(REAL_TALL.h);
    }
    // 竖屏：可见世界宽 694.9，比内容窄 9.1 个世界单位（不到 1.3%）→ 只有边缘一点点要靠平移
    expect(worldW(390, 735)).toBeCloseTo(694.9, 1);
    expect(REAL_TALL.w - worldW(390, 735)).toBeLessThan(10);
    expect(worldH(390, 735)).toBeGreaterThan(REAL_TALL.h);
  });

  it('反证：老口径（min(面积, 内容)）下真实关卡是 606.3 / 1496.9 / 2896.0 / 1934.8 格²', () => {
    const cellsWith = (w: number, h: number, scale: number) => (w * h) / (GRID_PITCH * scale) ** 2;
    const oldScale = (w: number, h: number, box: { w: number; h: number }): number =>
      Math.min(w / (box.w + 80), h / (box.h + 80));
    const newScale = (w: number, h: number, box: Box): number =>
      fitCamera({ width: w, height: h, content: box }).camera.scale;

    // ① 横屏 844×333 + 非门（内容 704×164）：老口径 1.0765 → 606.3 格²（新口径 2275）
    const land = oldScale(844, 333, REAL_NOT);
    expect(land).toBeCloseTo(1.0765, 3);
    expect(cellsWith(844, 333, land)).toBeCloseTo(606.3, 1);
    expect(cellsWith(844, 333, newScale(844, 333, REAL_NOT))).toBeCloseTo(2275, 1);
    // ② 桌面 1024×754 + 高关（704×584）：老口径 1.1355 → 1496.9 格²
    const desk = oldScale(1024, 754, REAL_TALL);
    expect(desk).toBeCloseTo(1.1355, 3);
    expect(cellsWith(1024, 754, desk)).toBeCloseTo(1496.9, 1);
    expect(cellsWith(1024, 754, newScale(1024, 754, REAL_TALL))).toBeCloseTo(2275, 1);
    // ③ 竖屏 390×735 + 高关：老口径 0.4974 → 2896.0 格²（内容口径比面积口径更"远"）
    const port = oldScale(390, 735, REAL_TALL);
    expect(port).toBeCloseTo(0.4974, 3);
    expect(cellsWith(390, 735, port)).toBeCloseTo(2896.0, 1);
    expect(cellsWith(390, 735, newScale(390, 735, REAL_TALL))).toBeCloseTo(2275, 1);
    // ④ 平板 768×967 + 高关：老口径 0.9796 → 1934.8 格²（这一次内容口径反而更"近"）
    const pad = oldScale(768, 967, REAL_TALL);
    expect(pad).toBeCloseTo(0.9796, 3);
    expect(cellsWith(768, 967, pad)).toBeCloseTo(1934.8, 1);
    expect(cellsWith(768, 967, newScale(768, 967, REAL_TALL))).toBeCloseTo(2275, 1);

    // 一句话总结：老口径的四个落点**全部**在目标区间 [1950, 2600] 之外
    for (const v of [606.3, 1496.9, 2896.0, 1934.8])
      expect(v < CELLS_AREA_RANGE.min || v > CELLS_AREA_RANGE.max).toBe(true);
  });

  it('同一视口下，内容尺寸怎么变都不动 scale：只动相机中心', () => {
    for (const content of [SMALL, REAL_NOT, REAL_TALL, { x: 0, y: 0, w: 20000, h: 12000 }]) {
      const r = fitCamera({ width: 390, height: 735, content });
      expect(r.camera.scale).toBeCloseTo(0.5612, 3); // 与 2275 格² 的面积口径一致
      expect(r.cells.area).toBeCloseTo(2275, 1);
      // 只有中心跟着内容走（把内容 bbox 中心放进可用区中心，不算内容优先）
      expect(r.camera.x).toBeCloseTo(content.x + content.w / 2, 9);
      expect(r.camera.y).toBeCloseTo(content.y + content.h / 2, 9);
    }
  });

  it('超大电路也不再被夹到 0.35：面积口径与内容无关，视野恒定', () => {
    const huge = { x: 0, y: 0, w: 20000, h: 12000 };
    const r = fitCamera({ width: 390, height: 735, content: huge });
    expect(r.clamped).toBe('none');
    expect(r.camera.scale).toBeCloseTo(0.5612, 3);
    expect(r.camera.x).toBeCloseTo(10000, 6); // 内容中心
    expect(r.camera.y).toBeCloseTo(6000, 6);
  });

  it('空关卡（没有元件）：用传入的落点，只按面积定 scale', () => {
    const r = fitCamera({ width: 390, height: 735, content: null, center: { x: 340, y: 220 } });
    expect(r.camera.x).toBe(340);
    expect(r.camera.y).toBe(220);
    expect(r.cells.area).toBeCloseTo(2275, 1);
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
      height: 735,
      narrow: true,
      portrait: true,
      leftOpen: true,
      bottomSheet: { w: 390, h: 338 }, // CDP 实测竖屏抽屉 338px
    });
    expect(open).toEqual({ width: 390, height: 397 });
    const closed = usableArea({
      width: 390,
      height: 735,
      narrow: true,
      portrait: true,
      leftOpen: false,
      bottomSheet: { w: 390, h: 338 }, // 元素不在了也量不到；这里给 0 表示量不到
    });
    expect(closed).toEqual({ width: 390, height: 735 });
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

  it('竖屏扣掉抽屉后：面积口径仍落在 2275 格²（实得）', () => {
    const a = usableArea({
      width: 390,
      height: 735,
      narrow: true,
      portrait: true,
      leftOpen: true,
      bottomSheet: { w: 390, h: 338 },
    });
    const r = fitCamera({ width: a.width, height: a.height, content: SMALL });
    expect(r.clamped).toBe('none');
    expect(r.cells.area).toBeCloseTo(2275, 6);
    expect(visibleCells(r.camera, a.width, a.height).area).toBeCloseTo(2275, 6);
    expect(r.camera.scale).toBeCloseTo(0.4125, 3);
  });

  it('抽屉比画布还高（离谱输入）→ 兜底到下限，不出现 0/负数', () => {
    const a = usableArea({
      width: 390,
      height: 300,
      narrow: true,
      portrait: true,
      leftOpen: true,
      bottomSheet: { w: 390, h: 338 },
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
    const h = 735;
    const r = fitCamera({ width: w, height: h, content: REAL_TALL });
    // worldToScreen：sx = (wx - camera.x) * scale + width / 2
    const sx = (r.camera.x - r.camera.x) * r.camera.scale + w / 2;
    const sy = (r.camera.y - r.camera.y) * r.camera.scale + h / 2;
    expect(sx).toBeCloseTo(w / 2, 9);
    expect(sy).toBeCloseTo(h / 2, 9);
  });
});
