/**
 * 进关自适应：按**可见面积**算相机（`{x, y, scale}`，就是 editor/render.ts 里那一套相机模型，
 * 不另存视图状态；平移/缩放的既有代码一行没改）。
 *
 * ---- 格距常量 ----
 * **`GRID_PITCH = 20`（世界单位/格）**，出自 `editor/render.ts` 的 `drawGrid()`：
 *   `const step = 20 * camera.scale;` … `Math.round(… / 20) * 20`（粗线每 5 格，`world % 100 === 0`）。
 * 也就是屏幕上看到的一格 = 20×20 世界单位。
 * （`snap()` 的 10 是摆放元件时的半步吸附、`fromDesign` 的 COL_STEP=176/ROW_GAP=48 是自动布局的
 *   列距行距、`PART_SIZES` 是元件足迹尺寸 —— 都不是"画出来的格子"，横竖只有 20 这一个真格距。）
 *
 * ---- 面积口径（**唯一口径**）----
 * 目标可见面积 175 格²，允许区间 [150, 200]。要同时满足：
 *   ① `cellsX × cellsY = target`（面积就是这么多格²）
 *   ② `cellsX / cellsY = 可用宽 / 可用高`（看得见的格块与可用区同比例，才叫"铺满可用区"）
 * 解得 **`cellsX = sqrt(target × A)`、`cellsY = target / cellsX`（A = 可用宽/可用高）**，
 * 于是 `scale = 可用宽 / (cellsX × 格距)`。
 *
 * 注意：请求里的写法是 `cellsX = sqrt(target / A)`，那等价于把 A 当成**高/宽**。若真按"A = 宽/高"
 * 代入，两条要求会自相矛盾：桌面 1280×754 算出 cellsX=10.15 / cellsY=17.24（格块宽高比 0.589，
 * 而可用区是 1.698 —— 反了），反推实得面积 60.7 格²；竖屏 390×787 则反推出 712.6 格²，
 * 都不是 175。这里按上面① ②自洽解实现（等价于把 A 取高/宽），实得面积才是 175.0。
 *
 * **175 格² ≈ 13.2 × 13.2 格**，与用户说的「横向大概 10~15 格」是同一个意思：
 * 他要的是「进关固定看到约 13 格的视野」，**不是**"把整关内容都装进来"。
 *
 * ---- 内容不参与定 scale（用户裁定，别退回内容优先）----
 * 早期版本取过 `min(面积口径, 内容口径)`，那会让视野被真实关卡撑到 **606~2691 格²**
 * （≳ 39 格宽，是用户要求的 3~15 倍；单测里那三条反证数字就是它们），与「固定约 13 格」直接冲突。
 * 现在：**内容 bbox 只决定相机中心**
 * （把内容中心放到可用区中心，纯粹是取景友好，不影响 scale），大关卡超出视野的部分
 * **靠平移/缩放查看**——这是本口径的**预期代价**（手势层本来就有平移/双指缩放）。
 *
 * ---- 唯一保留的优先级：夹紧到手势区间 ----
 * scale 必须落在手势层的 [0.35, 2.6]（`editor/gesture.ts` 的 SCALE_RANGE，**不动它**，那是手势契约）。
 * 大屏上 175 格² 需要的缩放会超过上限（桌面画布 1024×754 需要 3.321、平板 768×967 需要 3.257），
 * 这时取上限 → 可见面积必然大于 200 格²（桌面 **285.5**、平板 **274.7**，CDP 从画布像素量出来同值）。
 * 这是硬夹紧的必然结果，返回值里 `clamped === 'max'` 就是它；想真落到 175 得把上限提到 3.33
 * （会改动手势 `SCALE_RANGE`，那是手势契约，故本轮不动）。
 */
import { SCALE_RANGE } from '../editor/gesture.ts';
import type { Camera } from '../editor/render.ts';

/** 一格 = 20 世界单位（render.ts drawGrid 的步长，见文件头注释） */
export const GRID_PITCH = 20;
/** 目标可见面积（格²）：用户确认取 175 */
export const TARGET_CELLS_AREA = 175;
/** 允许区间（格²）：[150, 200] */
export const CELLS_AREA_RANGE = { min: 150, max: 200 } as const;
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FitOptions {
  /** 可用区宽（px）：竖屏要扣掉底部抽屉，窄屏要扣掉左右覆盖抽屉 */
  width: number;
  /** 可用区高（px） */
  height: number;
  /** 内容 bbox（世界单位）：**只用来定相机中心**（不再参与 scale，见文件头「内容不参与定 scale」）；空关卡传 null */
  content?: Box | null;
  /** 没有内容时的相机落点（世界坐标），缺省 (0, 0) */
  center?: { x: number; y: number } | null;
  pitch?: number;
  targetArea?: number;
  scaleRange?: { min: number; max: number };
}

export interface FitResult {
  camera: Camera;
  /** 面积口径算出来的 scale（**就是**唯一该用的那个，未夹紧） */
  areaScale: number;
  /** 是否被 scaleRange 夹紧了（大屏必然 'max'，见文件头） */
  clamped: 'none' | 'min' | 'max';
  /** 最终可见格数（由相机反推；单测与 CDP 实测用的是同一个算法） */
  cells: { x: number; y: number; area: number };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 由相机与可用区反推「看得见多少格」——实测口径就是这个 */
export function visibleCells(
  camera: Camera,
  width: number,
  height: number,
  pitch: number = GRID_PITCH,
): { x: number; y: number; area: number } {
  const cellPx = pitch * camera.scale;
  const x = width / cellPx;
  const y = height / cellPx;
  return { x, y, area: x * y };
}

export interface UsableAreaInput {
  /** 画布可视区尺寸（px），即 .canvas-wrap 量出来的那个 */
  width: number;
  height: number;
  narrow: boolean;
  portrait: boolean;
  leftOpen: boolean;
  /** 覆盖式面板的实测尺寸（px）；量不到就传 null/0（右侧验收面板已整块移除，只剩元件库） */
  bottomSheet?: { w: number; h: number } | null;
  /** 可用区下限，避免离谱输入（抽屉比画布还高时的兜底） */
  floor?: number;
}

/**
 * 可用区 = 画布可视区**扣掉覆盖式面板**：
 *  - 竖屏：元件库是**底部抽屉** → 扣高度；
 *  - 窄屏横屏：元件库是**左侧**覆盖抽屉 → 扣宽度；
 *  - 桌面：元件库是流内布局（.canvas-wrap 本来就不含它）→ 不用扣。
 *  （右侧验收面板整块移除后，这里不再有右侧避让项。）
 */
export function usableArea(input: UsableAreaInput): { width: number; height: number } {
  const floor = input.floor ?? 120;
  let { width, height } = input;
  if (input.narrow && input.portrait && input.leftOpen) {
    const h = input.bottomSheet?.h ?? 0;
    if (h > 0) height -= h;
  } else if (input.narrow) {
    if (input.leftOpen) width -= input.bottomSheet?.w ?? 0;
  }
  return { width: Math.max(floor, width), height: Math.max(floor, height) };
}

/** 纯函数：可用宽高 + 格距 + 内容 bbox → camera */
export function fitCamera(options: FitOptions): FitResult {
  const { width, height, content = null, center = null } = options;
  const pitch = options.pitch ?? GRID_PITCH;
  const targetArea = options.targetArea ?? TARGET_CELLS_AREA;
  const range = options.scaleRange ?? SCALE_RANGE;
  const w = Math.max(1, width);
  const h = Math.max(1, height);

  // ① 面积口径：cellsX = sqrt(target × A)、cellsY = target / cellsX（A = 可用宽/可用高）
  const aspect = w / h;
  const cellsX = Math.sqrt(targetArea * aspect);
  const areaScale = w / (cellsX * pitch);

  // ② 只夹紧到手势区间：**内容不参与**（早期版本这里取过 min(面积口径, 内容口径)，
  //    结果视野被内容撑到 607~3105 格²，与「固定约 13 格」冲突，已按用户裁定去掉）
  const scale = clamp(areaScale, range.min, range.max);
  const clamped: FitResult['clamped'] =
    scale > areaScale ? 'min' : scale < areaScale ? 'max' : 'none';

  // ③ 居中：把**内容 bbox 中心**放进可用区中心（camera 按 render.ts 的约定就是
  //    「可用区中心对应的世界点」）。这只是取景友好，不参与 scale 计算。
  //    大关卡因此会有一部分在视野外 —— 预期的代价，靠平移/缩放看。
  const cx = content ? content.x + content.w / 2 : (center?.x ?? 0);
  const cy = content ? content.y + content.h / 2 : (center?.y ?? 0);

  const camera: Camera = { x: cx, y: cy, scale };
  return { camera, areaScale, clamped, cells: visibleCells(camera, w, h, pitch) };
}

/**
 * 从 doc 的元件足迹算内容 bbox（世界单位）。只算元件、不含导线：
 * 导线只在元件引脚之间走，端点在足迹上；教学关的 backdrop（墙/门洞）是装饰，不参与，
 * 否则一面大墙会把相机拉得很远。
 */
export function contentBoxOf<T extends { x: number; y: number }>(
  syms: readonly T[],
  footprint: (sym: T) => Box,
): Box | null {
  if (syms.length === 0) return null;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const sym of syms) {
    const b = footprint(sym);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
