import { useEffect, useState } from 'react';

/**
 * 视口宽度断点（窄屏 = 手机 / 竖屏平板）：布局判定的**唯一**来源。
 *
 * 为什么取 900px：
 *  - 手机竖屏 360×640 / 390×844 / 430×932 与横屏手机 844×390 都要走窄屏布局
 *    （横屏手机宽 844 < 900，所以也落进来：顶栏不换行、面板不吃高度）；
 *  - 竖屏平板 768×1024：桌面左右栏 240 + 316 + 32 = 588px，只剩约 180px 画布 → 也算窄屏；
 *  - 1024×768 横屏平板及所有更宽的桌面屏仍是原布局（画布 ≥ 436px，够用），桌面观感逐字不变。
 *
 * ⚠️ styles.css 里那条 `@media (max-width: 900px)` 必须与这里保持一致：
 * CSS 与 TS 各写一份数字，靠 test/mobile-layout.test.tsx 把两边对起来防漂移。
 */
export const NARROW_BREAKPOINT_PX = 900;

/** 窄屏媒体查询串（测试拿它跟 styles.css 里的 @media 对照） */
export const NARROW_MEDIA_QUERY = `(max-width: ${NARROW_BREAKPOINT_PX}px)`;

/**
 * 竖屏窄屏（手机竖屏）媒体查询串：既 ≤ 断点、又是「高 ≥ 宽」的竖屏。
 * 横屏手机（844×390）与桌面宽屏都不匹配 —— 它们的地图/元件库布局必须逐字不变。
 */
export const PORTRAIT_MEDIA_QUERY = `${NARROW_MEDIA_QUERY} and (orientation: portrait)`;

/**
 * 竖屏**窄屏**档（用户第 ⑬ 轮追加）：360×640 这类 ≤380px 的窄竖屏。
 *
 * 为什么单独一档：360 − 6(抽屉左右内边距) − 15(自由模式的纵向滚动条) = 339px，
 * 而 44px 卡要 8 × 44 + 7 × 2 = 366px —— 几何上放不下 8 张。用户要求「一行至少 8 个」，
 * 所以这一档把卡片压到 40px（8 × 40 + 7 × 2 = 334 ≤ 339），**高度与字号一分不让**
 * （min-height 仍 48 ≥ 44；字号仍 10px）。40px < 44px 触控目标是这一档的**已知取舍**。
 *
 * ⚠️ styles.css 末尾那条 `@media (max-width: 380px) and (orientation: portrait)` 必须与这里一致。
 */
export const TINY_PORTRAIT_BREAKPOINT_PX = 380;

/** 窄竖屏档媒体查询串（测试拿它跟 styles.css 里的 @media 对照） */
export const TINY_PORTRAIT_MEDIA_QUERY = `(max-width: ${TINY_PORTRAIT_BREAKPOINT_PX}px) and (orientation: portrait)`;

/** 媒体查询求值：优先 matchMedia；jsdom（没有 matchMedia）用 fallback 兜底 */
function queryMatches(query: string, fallback: () => boolean): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') return window.matchMedia(query).matches;
  return fallback();
}

/**
 * 订阅一条媒体查询：命中状态变化（旋屏、拖窗口）时重新渲染。
 * `initial` 是惰性初始值，只在首帧求值一次，且不进 effect 依赖（没 matchMedia 时不再更新）。
 */
function useMediaQuery(query: string, initial: () => boolean): boolean {
  const [on, setOn] = useState(initial);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    setOn(mql.matches);
    const onChange = (event: MediaQueryListEvent): void => setOn(event.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return on;
}

/**
 * 当前视口是不是窄屏。
 * jsdom（测试环境）没有 window.matchMedia，退回用 window.innerWidth 判断：
 * jsdom 的窗口宽是 1024 > 断点 → 一律按桌面处理，现有桌面用例的 DOM 结构不受影响。
 */
export function isNarrowViewport(): boolean {
  return queryMatches(NARROW_MEDIA_QUERY, () => window.innerWidth <= NARROW_BREAKPOINT_PX);
}

/**
 * 当前视口是不是窄屏**且竖屏**（高 ≥ 宽）。
 * jsdom 兜底路径同理：没有 matchMedia 时用 innerWidth/innerHeight 算。
 */
export function isPortraitNarrowViewport(): boolean {
  return queryMatches(
    PORTRAIT_MEDIA_QUERY,
    () => window.innerWidth <= NARROW_BREAKPOINT_PX && window.innerHeight >= window.innerWidth,
  );
}

/** 订阅「窄屏」：窄屏 ⇄ 桌面（旋屏、拖窗口）时重新渲染，让布局跟着断点走 */
export function useNarrowScreen(): boolean {
  return useMediaQuery(NARROW_MEDIA_QUERY, isNarrowViewport);
}

/** 订阅「窄屏且竖屏」：竖屏 → 横屏（旋屏）时重新渲染（地图列数、元件库位置跟着变） */
export function usePortraitNarrow(): boolean {
  return useMediaQuery(PORTRAIT_MEDIA_QUERY, isPortraitNarrowViewport);
}
