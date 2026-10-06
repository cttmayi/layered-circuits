// @vitest-environment jsdom
/**
 * 手机端（窄屏 / 竖屏）响应式布局的**行为与样式表契约**：
 *
 *  1. 窄屏行为：命中「窄屏」时进工作台左右面板默认收起（画布独占整个 body），
 *     两颗 44px 开合手柄能把抽屉拉出来/收回去，可访问名与原来完全一致
 *     （panels-collapse.test.tsx 依赖「收起元件库」「收起右侧面板」这批名字）。
 *  2. 竖屏专项：关卡地图靠**减少列数**（6 → 3）适配屏宽、不再横向滚动；元件库改**底部抽屉**。
 *     这两条只写在 `(max-width: 900px) and (orientation: portrait)` 里 —— 横屏手机与桌面读不到。
 *  3. 桌面 / 横屏防回归：视口 ≥ 断点或横屏时 DOM 结构与基线逐字一致（面板默认展开、6 列地图）。
 *  4. 样式表契约：所有媒体查询都必须带「宽 ≤ 断点」的上限（否则竖屏规则会漏到桌面竖屏窗口）；
 *     断点值与 src/layout/viewport.ts 的常量一致；竖屏块必须排在窄屏块之后（层叠顺序）。
 *
 * ⚠️ 老实说清楚：jsdom **不做真实布局**（没有排版引擎，宽度恒为 0，也不解析 @media）。
 * 所以这里量到的是「DOM 结构 + 样式表文本」，不是真实像素；真实视口尺寸下的
 * 像素/滚动/重叠由 headless Chrome 实测（提交信息里给了做法与数字）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import {
  NARROW_BREAKPOINT_PX,
  NARROW_MEDIA_QUERY,
  PORTRAIT_MEDIA_QUERY,
} from '../src/layout/viewport';
import { renderApp, startJob } from './helpers';

// ---------- 视口模拟 ----------
const realMatchMedia = window.matchMedia;
const realInnerWidth = window.innerWidth;
const realInnerHeight = window.innerHeight;

/**
 * 模拟视口尺寸：jsdom 没实现 matchMedia，这里按 max-width / orientation 求值；
 * innerWidth/innerHeight 一起改（走「没有 matchMedia」的兜底路径时也一致）。
 */
function setViewport(width: number, height: number): void {
  for (const [key, value] of [
    ['innerWidth', width],
    ['innerHeight', height],
  ] as const) {
    Object.defineProperty(window, key, { configurable: true, writable: true, value });
  }
  window.matchMedia = ((query: string): MediaQueryList => {
    const cap = /\(max-width:\s*(\d+)px\)/.exec(query);
    const narrow = cap ? width <= Number(cap[1]) : false;
    // 没有 orientation 条件的查询不受方向影响；有的按「高 ≥ 宽 = 竖屏」求值
    const wantsPortrait = /orientation:\s*portrait/.test(query);
    const portrait = wantsPortrait ? height >= width : true;
    return {
      matches: narrow && portrait,
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
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: realInnerHeight,
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
    ['390×844（手机竖屏）', 390, 844],
    ['844×390（横屏手机，高度很矮）', 844, 390],
    ['768×1024（竖屏平板）', 768, 1024],
  ])('视口 %s：左右面板默认收起，画布是 body 里唯一的布局子元素', (_label, w, h) => {
    setViewport(w, h);
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
    setViewport(390, 844);
    renderApp();
    startJob('非门');

    // 左侧：拉出元件库 → 画布之上多一层抽屉（竖屏时它是底部抽屉，位置由 CSS 决定）
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

    // 右侧：拉出验收/属性抽屉（右侧抽屉的行为：竖屏与横屏一致，仍是右侧覆盖抽屉）
    fireEvent.click(screen.getByRole('button', { name: '展开右侧面板' }));
    expect(document.querySelector('.side')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('材料费').length).toBeGreaterThanOrEqual(1));

    fireEvent.click(screen.getByRole('button', { name: '收起右侧面板' }));
    expect(document.querySelector('.side')).toBeNull();
  });
});

// ---------- 竖屏专项：地图减少列数 + 元件库挪到底部 ----------
/** 地图前 6 个节点的内联 left 百分比去重 → 就是「每行列数」（两行的列位置相同） */
function mapColumnsOfFirstRows(): number {
  const nodes = [...document.querySelectorAll('.map-node-btn')];
  const lefts = nodes.slice(0, 6).map((el) => (el as HTMLElement).style.left);
  expect(lefts.length).toBe(6); // 至少两行
  return new Set(lefts).size;
}

describe('竖屏：关卡地图减少列数（6 → 3），不再横向滚动', () => {
  it.each([
    ['390×844 竖屏', 390, 844, 3, 480],
    ['360×640 竖屏', 360, 640, 3, 480],
    ['430×932 竖屏', 430, 932, 3, 480],
  ])('%s：每行 3 列、画布宽 480（viewBox）', (_label, w, h, cols, viewW) => {
    setViewport(w, h);
    renderApp();
    fireEvent.click(screen.getByText('关卡模式'));

    const svg = document.querySelector('.map-svg') as SVGElement;
    expect(svg.getAttribute('viewBox')).toMatch(new RegExp(`^0 0 ${viewW} \\d+$`));
    // 前 6 个节点跨两行：去重后的 x 位置个数 = 每行列数
    expect(mapColumnsOfFirstRows()).toBe(cols);
    // 相邻两行共用同一批列位置（蛇形折回），所以第二行不应引入新的 x
    const lefts = [...document.querySelectorAll('.map-node-btn')]
      .slice(0, 6)
      .map((el) => (el as HTMLElement).style.left);
    expect(new Set(lefts.slice(3)).size).toBe(cols);
    expect([...new Set(lefts.slice(3))].sort()).toEqual([...new Set(lefts.slice(0, 3))].sort());
  });

  it.each([
    ['844×390（横屏手机）', 844, 390, 6],
    ['1280×800（桌面）', 1280, 800, 6],
    ['1024×768（横屏平板）', 1024, 768, 6],
  ])('%s：地图仍是 6 列 / 画布宽 960（逐字不变）', (_label, w, h, cols) => {
    setViewport(w, h);
    renderApp();
    fireEvent.click(screen.getByText('关卡模式'));

    const svg = document.querySelector('.map-svg') as SVGElement;
    expect(svg.getAttribute('viewBox')).toMatch(/^0 0 960 \d+$/);
    expect(mapColumnsOfFirstRows()).toBe(cols);
  });
});

// ---------- 竖屏底部元件库：精简形态（只有名字）+ 可横滑 + 不出现筛选开关 ----------
/** 打开元件库（窄屏默认收起，要用手柄拉开；桌面/横屏平板默认就开着） */
function openPalette(): void {
  if (!document.querySelector('aside.palette')) {
    fireEvent.click(screen.getByRole('button', { name: '展开元件库' }));
  }
}

/** 卡片上「名字以外」的信息节点（价格 / 说明 / 引脚数 / 延迟 / 锁定原因 / 状态标签） */
const EXTRA_INFO = '.palette-cost, .palette-note, .palette-delay, .palette-lock, .palette-name em';

describe('竖屏底部元件库：卡片只留名字', () => {
  it.each([
    ['390×844', 390, 844],
    ['360×640', 360, 640],
    ['430×932', 430, 932],
  ])('%s：卡片只有名字，价格/说明/引脚数/延迟/状态都不进 DOM', (_label, w, h) => {
    setViewport(w, h);
    renderApp();
    startJob('非门');
    openPalette();

    // 名字在、点得到（按钮还带着原来那个 title 提示，只是不再显示成文字）
    expect(screen.getByText('三极管 NPN')).toBeTruthy();
    expect(screen.getByText('电阻')).toBeTruthy();
    // 价格 / 说明 / 引脚数 / 延迟 / 状态标签：一个都没有
    expect(document.querySelectorAll(EXTRA_INFO).length).toBe(0);
    expect(document.body.textContent).not.toMatch(/价格|成本|延迟/);
    expect(document.body.textContent).not.toMatch(/本关不可用/);

    const cards = [...document.querySelectorAll('.palette-item')];
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      // 卡片文本 == 它的名字（只留名字这一项）
      const name = card.querySelector('.palette-name')?.textContent?.trim() ?? '';
      expect(name.length).toBeGreaterThan(0);
      expect((card.textContent ?? '').trim()).toBe(name);
    }
  });

  it.each([
    ['390×844', 390, 844],
    ['360×640', 360, 640],
    ['430×932', 430, 932],
  ])('%s：「隐藏本关不可用」开关不渲染', (_label, w, h) => {
    setViewport(w, h);
    renderApp();
    startJob('非门');
    openPalette();
    expect(screen.queryByText('隐藏本关不可用')).toBeNull();
    expect(document.querySelector('.palette-filter')).toBeNull();
    expect(document.querySelector('.palette-filter input')).toBeNull();
  });
});

describe('横屏 / 桌面：元件库照旧（卡片信息 + 筛选开关都在）', () => {
  it.each([
    ['844×390（横屏手机）', 844, 390],
    ['1024×768（横屏平板）', 1024, 768],
    ['1280×800（桌面）', 1280, 800],
  ])('%s：开关在、卡片信息在', (_label, w, h) => {
    setViewport(w, h);
    renderApp();
    startJob('非门');
    openPalette();

    // 「隐藏本关不可用」开关照旧
    expect(screen.getByText('隐藏本关不可用')).toBeTruthy();
    const filter = document.querySelector('.palette-filter');
    expect(filter).toBeTruthy();
    expect(filter?.querySelector('input[type="checkbox"]')).toBeTruthy();
    // 价格 / 说明 / 延迟这些信息照旧
    expect(document.querySelectorAll('.palette-cost').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.palette-note').length).toBeGreaterThan(0);
    expect(document.body.textContent).toMatch(/价格/);
    // 名字也照旧
    expect(screen.getByText('三极管 NPN')).toBeTruthy();
  });
});

// ---------- 「隐藏本关不可用」的持久化状态：竖屏不生效、横屏/桌面照旧生效 ----------
/**
 * 预置「隐藏本关不可用」的持久化状态（lc-ui-palette-hide-locked）后进工作台、拉开元件库，
 * 量到卡片数 / 开关是否在 / 卡片名字，然后**卸载**（同一个用例里要渲染两次来对比）。
 * 注意不能用 renderApp()：它会把 localStorage 清掉，而这个用例考的就是持久化状态。
 */
function paletteProbe(
  w: number,
  h: number,
  filterOn: boolean,
): { count: number; filter: boolean; names: string } {
  setViewport(w, h);
  localStorage.clear();
  localStorage.setItem('lc-ui-palette-hide-locked', filterOn ? '1' : '0');
  const { unmount } = render(<App />);
  startJob('非门');
  openPalette();
  const palette = document.querySelector('aside.palette');
  const out = {
    count: palette?.querySelectorAll('.palette-item').length ?? 0,
    filter: Boolean(palette?.querySelector('.palette-filter')),
    names: [...(palette?.querySelectorAll('.palette-name') ?? [])]
      .map((el) => (el.textContent ?? '').trim())
      .join('|'),
  };
  unmount();
  return out;
}

describe('竖屏底部形态：不套「隐藏本关不可用」的持久化过滤（开关看不见 → 就不能让它生效）', () => {
  it.each([
    ['390×844', 390, 844],
    ['360×640', 360, 640],
    ['430×932', 430, 932],
  ])('%s：预置「过滤 = 开」时卡片数与全量一致（过滤未生效）', (_label, w, h) => {
    const off = paletteProbe(w, h, false);
    const on = paletteProbe(w, h, true);

    expect(off.count).toBeGreaterThan(0);
    expect(on.count).toBe(off.count); // 恒为「显示全部」
    expect(on.names).toBe(off.names); // 连顺序都一样
    expect(on.filter).toBe(false); // 开关确实不在
    // 反证：这个关在桌面形态下确实会被过滤掉几张（见下一个用例），所以「相等」不是巧合
    expect(on.count).toBeGreaterThan(paletteProbe(1280, 800, true).count);
  });
});

describe('横屏 / 桌面：同一个持久化状态仍然生效（行为不变）', () => {
  it.each([
    ['844×390（横屏手机）', 844, 390],
    ['1024×768（横屏平板）', 1024, 768],
    ['1280×800（桌面）', 1280, 800],
  ])('%s：预置「过滤 = 开」时卡片数确实变少，且开关在', (_label, w, h) => {
    const off = paletteProbe(w, h, false);
    const on = paletteProbe(w, h, true);

    expect(on.filter).toBe(true); // 开关还在
    expect(on.count).toBeLessThan(off.count); // 过滤真的生效
    expect(on.names).not.toBe(off.names);
  });
});

// ---------- 桌面防回归 ----------
describe('桌面宽屏：结构与基线逐字一致', () => {
  it.each([
    ['1024×768（横屏平板，断点之上）', 1024, 768],
    ['1440×900（桌面）', 1440, 900],
  ])('视口 %s：面板默认展开、顺序不变、开合按钮是「收起」语义', (_label, w, h) => {
    setViewport(w, h);
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
    setViewport(1024, 768);
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
const PORTRAIT_INDEX = MEDIA_CSS.findIndex((block) => block.query === PORTRAIT_MEDIA_QUERY);
const PORTRAIT_BLOCK = PORTRAIT_INDEX >= 0 ? (MEDIA_CSS[PORTRAIT_INDEX]?.body ?? '') : '';

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

  it('每条媒体查询都带「宽 ≤ 断点」的上限：竖屏规则漏不到桌面竖屏窗口', () => {
    // 只有 `(orientation: portrait)` 而没有宽度上限的查询会命中桌面竖屏窗口 → 必须禁止
    for (const { query } of MEDIA_CSS) {
      expect(query).toMatch(/max-width:\s*\d+px/);
    }
    // 没有任何 `min-width` / `orientation: landscape` 之类的「宽屏/横屏才生效」查询
    expect(CSS_SOURCE).not.toMatch(/@media[^{]*min-width/);
    expect(CSS_SOURCE).not.toMatch(/@media[^{]*orientation:\s*landscape/);
  });

  it('竖屏块排在窄屏块之后（层叠顺序：竖屏规则才能盖住窄屏规则）', () => {
    expect(PORTRAIT_MEDIA_QUERY).toBe(`${NARROW_MEDIA_QUERY} and (orientation: portrait)`);
    expect(PORTRAIT_INDEX).toBeGreaterThan(
      MEDIA_CSS.findIndex((block) => block.query === NARROW_MEDIA_QUERY),
    );
    expect(PORTRAIT_BLOCK).not.toBe('');
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

  it('竖屏块里真有关键规则：地图不横滑（靠减少列数）+ 元件库在底部', () => {
    const rules = parseCss(PORTRAIT_BLOCK).base;
    // ① 地图：去掉窄屏那条 720px 下限，地图区内不再横向滚动
    expect(rules.get('.map-canvas')).toContain('min-width: 0');
    expect(rules.get('.map-stage')).toContain('overflow-x: hidden');
    expect(rules.get('.map-stage')).toContain('overflow-y: auto');
    // ② 元件库：贴底、占满宽、高度按画布区比例限高（不盖光画布）
    const palette = rules.get('.palette') ?? '';
    expect(palette).toMatch(/top:\s*auto/);
    expect(palette).toContain('bottom: 0');
    expect(palette).toMatch(/right:\s*0/);
    expect(palette).toMatch(/height:\s*min\(/);
    expect(palette).toContain('border-top: 1px solid var(--line)');
    // 手柄跟着挪到底部（收起时贴在画布左下角）
    const strip = rules.get('.edge-strip.left') ?? '';
    expect(strip).toMatch(/top:\s*auto/);
    expect(strip).toMatch(/bottom:\s*calc\(/);
    expect(rules.get('.edge-strip.left:not(.closed)')).toMatch(/bottom:\s*calc\(min\(/);
    // 底部提示让开手柄
    expect(rules.get('.hint')).toMatch(/bottom:\s*calc\(/);
  });

  it('竖屏块里的精简卡片：一行横排 + 固定宽度 + 可横滑 + 触屏目标 ≥44px', () => {
    const rules = parseCss(PORTRAIT_BLOCK).base;
    const strip = rules.get('.palette-section-body') ?? '';
    expect(strip).toContain('display: flex');
    expect(strip).toMatch(/flex-flow:\s*row nowrap/);
    expect(strip).toContain('overflow-x: auto'); // 横滑只开在这一处
    expect(strip).toContain('overflow-y: hidden');
    const item = rules.get('.palette-item') ?? '';
    expect(item).toMatch(/flex:\s*0 0 auto/);
    expect(item).toMatch(/width:\s*104px/);
    expect(item).toMatch(/min-width:\s*104px/);
    expect(item).toMatch(/min-height:\s*48px/); // ≥44px
    // 名字放不下就折行，不靠截断
    const name = rules.get('.palette-row .palette-name') ?? '';
    expect(name).toContain('white-space: normal');
    expect(name).toMatch(/text-overflow:\s*clip/);
    expect(name).toContain('overflow-wrap: anywhere');
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
    // 地图的桌面默认：6 列几何由 WorldMap.tsx 决定，这里守住「基础块不设 min-width」
    expect(BASE_CSS.get('.map-canvas')).not.toContain('min-width');
    expect(BASE_CSS.get('.map-stage')).not.toContain('overflow-x: hidden');
    // 桌面/横屏的元件库仍是竖排列表、卡片仍是整行宽、价格说明照旧显示
    const baseBody = BASE_CSS.get('.palette-section-body') ?? '';
    expect(baseBody).not.toContain('overflow-x: auto');
    expect(baseBody).not.toContain('display: flex');
    expect(BASE_CSS.get('.palette-item')).toContain('width: 100%');
    expect(BASE_CSS.get('.palette-cost')).toContain('color: var(--ok)');
    expect(BASE_CSS.get('.palette-note')).toContain('white-space: nowrap');
  });
});
