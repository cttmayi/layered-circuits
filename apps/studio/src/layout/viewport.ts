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
 * 当前视口是不是窄屏。
 * jsdom（测试环境）没有 window.matchMedia，退回用 window.innerWidth 判断：
 * jsdom 的窗口宽是 1024 > 断点 → 一律按桌面处理，现有桌面用例的 DOM 结构不受影响。
 */
export function isNarrowViewport(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(NARROW_MEDIA_QUERY).matches;
  }
  return window.innerWidth <= NARROW_BREAKPOINT_PX;
}

/**
 * 订阅视口宽度：窄屏 ⇄ 桌面（旋屏、拖窗口）时重新渲染，让布局跟着断点走。
 * 监听器不可用时退化成「只在挂载时判定一次」，不会抛错。
 */
export function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState<boolean>(isNarrowViewport);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW_MEDIA_QUERY);
    setNarrow(query.matches);
    const onChange = (event: MediaQueryListEvent): void => setNarrow(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return narrow;
}
