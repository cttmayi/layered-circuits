// @vitest-environment jsdom
/**
 * 手机端（窄屏）响应式布局的**行为与样式表契约**：
 *
 *  1. 窄屏行为：命中「窄屏」时进工作台左右面板默认收起（画布独占整个 body），
 *     两颗 44px 开合手柄能把抽屉拉出来/收回去，可访问名与原来完全一致
 *     （panels-collapse.test.tsx 依赖「收起元件库」「收起右侧面板」这批名字）。
 *  2. 桌面防回归：视口 ≥ 断点时 DOM 结构与基线逐字一致（面板默认展开、顺序不变）。
 *  3. 样式表契约：所有媒体查询都不得命中桌面宽屏；窄屏断点值与 src/layout/viewport.ts
 *     的 NARROW_BREAKPOINT_PX 必须一致；窄屏块里必须真有关键规则（覆盖抽屉 / 顶栏横向滚动 /
 *     44px 触屏目标）；基础块里的桌面关键声明原样还在。
 *
 * ⚠️ 老实说清楚：jsdom **不做真实布局**（没有排版引擎，宽度恒为 0，也不解析 @media）。
 * 所以这里量到的是「DOM 结构 + 样式表文本」，不是真实像素；真实视口尺寸下的
 * 像素/滚动/溢出由 headless Chrome 实测（提交信息里给了做法与数字）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NARROW_BREAKPOINT_PX, NARROW_MEDIA_QUERY } from '../src/layout/viewport';
import { renderApp, startJob } from './helpers';

// ---------- 视口模拟 ----------
const realMatchMedia = window.matchMedia;
const realInnerWidth = window.innerWidth;

/** 模拟视口宽度：jsdom 没实现 matchMedia，这里按 max-width 求值；innerWidth 一起改（兜底路径） */
function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  window.matchMedia = ((query: string): MediaQueryList => {
    const matched = /\(max-width:\s*(\d+)px\)/.exec(query);
    const matches = matched ? width <= Number(matched[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = realMatchMedia;
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: realInnerWidth,
  });
});

beforeEach(() => {
  localStorage.clear();
});

/** 工作台里 .body 的直接子元素（顺序即布局顺序） */
function bodyChildren(): string[] {
  const body = document.querySelector('.body') as HTMLElement | null;
  return [...(body?.children ?? [])].map((el) => el.className);
}

// ---------- 视口行为 ----------
describe('窄屏 = 覆盖抽屉：进工作台先把画布让出来', () => {
  it.each([
    ['390×844（手机竖屏）', 390],
    ['844×390（横屏手机，高度很矮）', 844],
    ['768×1024（竖屏平板）', 768],
  ])('视口 %s：左右面板默认收起，画布是 body 里唯一的布局子元素', (_label, w) => {
    setViewportWidth(w);
    renderApp();
    startJob('非门');

    // 两块面板都不在 DOM 里 → 不会盖住画布
    expect(screen.queryByText('三极管 NPN')).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(bodyChildren()).toEqual([
      'edge-strip left closed',
      'canvas-wrap',
      'edge-strip right closed',
    ]);

    // 两个开合手柄在，语义名与桌面一致（44px 尺寸由 @media 块保证，见下面的样式表契约）
    expect(screen.getByRole('button', { name: '展开元件库' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '展开右侧面板' })).toBeTruthy();
  });

  it('窄屏：两颗手柄都能把抽屉拉出来、再收回去', async () => {
    setViewportWidth(390);
    renderApp();
    startJob('非门');

    // 左侧：拉出元件库 → 画布上方多一层抽屉
    fireEvent.click(screen.getByRole('button', { name: '展开元件库' }));
    expect(screen.getByText('三极管 NPN')).toBeTruthy();
    expect(document.querySelector('aside.palette')).toBeTruthy();
    expect(bodyChildren()).toEqual([
      'palette',
      'edge-strip left',
      'canvas-wrap',
      'edge-strip right closed',
    ]);

    // 同一个按钮换成「收起」语义，再收回去
    fireEvent.click(screen.getByRole('button', { name: '收起元件库' }));
    expect(screen.queryByText('三极管 NPN')).toBeNull();

    // 右侧：拉出验收/属性抽屉
    fireEvent.click(screen.getByRole('button', { name: '展开右侧面板' }));
    expect(document.querySelector('.side')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('材料费').length).toBeGreaterThanOrEqual(1));

    fireEvent.click(screen.getByRole('button', { name: '收起右侧面板' }));
    expect(document.querySelector('.side')).toBeNull();
  });
});

// ---------- 桌面防回归 ----------
describe('桌面宽屏：结构与基线逐字一致', () => {
  it.each([
    ['1024×768（横屏平板，断点之上）', 1024],
    ['1440×900（桌面）', 1440],
  ])('视口 %s：面板默认展开、顺序不变、开合按钮是「收起」语义', (_label, w) => {
    setViewportWidth(w);
    renderApp();
    startJob('非门');

    expect(bodyChildren()).toEqual([
      'palette',
      'edge-strip left',
      'canvas-wrap',
      'side',
      'edge-strip right',
    ]);
    expect(screen.getByText('三极管 NPN')).toBeTruthy();
    expect(screen.getAllByText('材料费').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: '收起元件库' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '收起右侧面板' })).toBeTruthy();
  });

  it('视口 1024（断点之上）：窄屏那次自动收起不会误触发', () => {
    setViewportWidth(1024);
    renderApp();
    startJob('非门');
    // 面板开合偏好没有被静默写成「收起」
    expect(localStorage.getItem('lc-ui-left-open')).toBeNull();
    expect(localStorage.getItem('lc-ui-right-open')).toBeNull();
  });
});

// ---------- 样式表契约 ----------
interface CssParts {
  /** 顶层普通规则：选择器 → 声明文本（重复选择器取第一处） */
  base: Map<string, string>;
  /** 顶层 @media 块 */
  media: Array<{ query: string; body: string }>;
}

/** 极简 CSS 扫描：按花括号配对切出顶层规则与 @media 块（够用即可，不做通用解析） */
function parseCss(source: string): CssParts {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, ''); // 注释里可能有花括号，先去掉
  const base = new Map<string, string>();
  const media: Array<{ query: string; body: string }> = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const selector = css.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    if (selector.startsWith('@media')) {
      media.push({ query: selector.slice('@media'.length).trim(), body });
    } else if (!selector.startsWith('@')) {
      for (const one of selector.split(',')) {
        const key = one.trim().replace(/\s+/g, ' ');
        if (!base.has(key)) base.set(key, body);
      }
    }
    i = j;
  }
  return { base, media };
}

// jsdom 环境下 import.meta.url 是 http(s) 的（不是 file:），所以用 cwd 拼路径：
// vitest.config.ts 在仓库根，pnpm test 的 cwd 就是仓库根。
const CSS_SOURCE = readFileSync(resolve(process.cwd(), 'apps/studio/src/styles.css'), 'utf8');
const { base: BASE_CSS, media: MEDIA_CSS } = parseCss(CSS_SOURCE);
const NARROW_BLOCK = MEDIA_CSS.find((block) => block.query === NARROW_MEDIA_QUERY)?.body ?? '';

describe('样式表契约：窄屏断点只管窄屏', () => {
  it('CSS 里没有任何会命中桌面宽屏的媒体查询，且窄屏断点与 TS 常量一致', () => {
    expect(NARROW_MEDIA_QUERY).toBe(`(max-width: ${NARROW_BREAKPOINT_PX}px)`);
    expect(MEDIA_CSS.length).toBeGreaterThanOrEqual(1);
    // 出现 max-width 的媒体查询，值必须 ≤ 断点；出现 min-width 就是「宽屏才生效」→ 直接失败
    for (const { query } of MEDIA_CSS) {
      for (const found of query.matchAll(/(min|max)-width:\s*(\d+)px/g)) {
        expect(found[1]).toBe('max');
        expect(Number(found[2])).toBeLessThanOrEqual(NARROW_BREAKPOINT_PX);
      }
    }
    expect(MEDIA_CSS.map((b) => b.query)).toContain(NARROW_MEDIA_QUERY);
  });

  it('窄屏块里真有关键规则：覆盖抽屉 / 顶栏横向滚动 / 44px 触屏目标 / 手柄文字标签', () => {
    expect(NARROW_BLOCK).not.toBe('');
    const rules = parseCss(NARROW_BLOCK).base;
    // 面板改覆盖抽屉，不再挤画布
    expect(rules.get('.palette')).toContain('position: absolute');
    expect(rules.get('.side')).toContain('position: absolute');
    // 顶栏一行横向滚动（按钮一个不删）
    const toolbar = rules.get('.toolbar') ?? '';
    expect(toolbar).toContain('flex-wrap: nowrap');
    expect(toolbar).toContain('overflow-x: auto');
    expect(rules.get('.toolbar button')).toMatch(/min-height:\s*44px/);
    // 开合手柄：44px 触屏目标 + 窄屏才显示的文字标签
    const handle = rules.get('.edge-strip > button') ?? '';
    expect(handle).toMatch(/min-height:\s*44px/);
    expect(handle).toMatch(/min-width:\s*44px/);
    expect(rules.get('.edge-strip-label')).toContain('display: inline');
    // 面板里的可点项抬到 44px；鼠标专用的提示行在窄屏藏掉
    expect(rules.get('.palette-item')).toContain('min-height: 44px');
    expect(rules.get('.hint-mouse')).toContain('display: none');
  });

  it('基础块（非媒体查询）里的桌面布局关键声明原样还在', () => {
    expect(BASE_CSS.get('.toolbar')).toContain('flex-wrap: wrap');
    expect(BASE_CSS.get('.body')).toContain('display: flex');
    expect(BASE_CSS.get('.palette')).toContain('width: 240px');
    expect(BASE_CSS.get('.side')).toContain('width: 316px');
    expect(BASE_CSS.get('.canvas-wrap')).toContain('flex: 1');
    expect(BASE_CSS.get('.edge-strip')).toContain('width: 16px');
    expect(BASE_CSS.get('.edge-strip-label')).toContain('display: none');
    expect(BASE_CSS.get('.hint-mouse')).toContain('display: block');
  });
});
