// @vitest-environment jsdom
/**
 * 手机端（窄屏 / 竖屏）响应式布局的**行为与样式表契约**：
 *
 *  1. 窄屏行为：命中「窄屏」时进工作台元件库默认收起（画布独占整个 body），
 *     那颗 44px 开合手柄能把抽屉拉出来/收回去（可访问名与原来一致：收起/展开元件库）。
 *     **右侧「验收/属性」面板已按用户要求整块移除**：右侧面板、右侧开合手柄、右侧避让全部不在，
 *     判定入口留在顶栏（「交付验收」）+ 结果弹窗，所以本文件只断言「右侧那套确实不存在」。
 *  2. 竖屏专项：关卡地图靠**减少列数**（6 → 3）适配屏宽、不再横向滚动；元件库改**底部抽屉**。
 *     这两条只写在 `(max-width: 900px) and (orientation: portrait)` 里 —— 横屏手机与桌面读不到。
 *  3. 桌面 / 横屏防回归：视口 ≥ 断点或横屏时 DOM 结构与基线一致（元件库默认展开、6 列地图）。
 *  4. 样式表契约：所有媒体查询都必须带「宽 ≤ 断点」的上限（否则竖屏规则会漏到桌面竖屏窗口）；
 *     断点值与 src/layout/viewport.ts 的常量一致；竖屏块必须排在窄屏块之后（层叠顺序）。
 *
 * ⚠️ 老实说清楚：jsdom **不做真实布局**（没有排版引擎，宽度恒为 0，也不解析 @media）。
 * 所以这里量到的是「DOM 结构 + 样式表文本」，不是真实像素；真实视口尺寸下的
 * 像素/滚动/重叠由 headless Chrome 实测（提交信息里给了做法与数字）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import {
  NARROW_BREAKPOINT_PX,
  NARROW_MEDIA_QUERY,
  PORTRAIT_MEDIA_QUERY,
  TINY_PORTRAIT_BREAKPOINT_PX,
  TINY_PORTRAIT_MEDIA_QUERY as TINY_PORTRAIT_MEDIA_QUERY_FROM_TS,
} from '../src/layout/viewport';
import { dismissTaskDialog, renderApp, startJob } from './helpers';

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
  // 个别用例会用 ?debug=1 让「调试模式」那组出现，跑完复位，别漏给其它用例
  window.history.replaceState({}, '', '/');
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
  ])(
    '视口 %s：面板默认收起，画布是 body 里唯一的布局子元素（右侧那套全视口不存在）',
    (_label, w, h) => {
      setViewport(w, h);
      renderApp();
      startJob('非门');

      // 元件库（唯一的覆盖抽屉）不在 DOM 里 → 不会盖住画布
      expect(screen.queryByText('三极管 NPN')).toBeNull();
      expect(screen.queryByRole('complementary')).toBeNull();
      // 右侧面板整块移除 → 任何视口都没有 .side、也没有 .edge-strip.right（与 portrait 无关）
      expect(document.querySelector('.side')).toBeNull();
      expect(document.querySelector('.edge-strip.right')).toBeNull();
      expect(bodyChildren()).toEqual(['edge-strip left closed', 'canvas-wrap']);

      // 开合手柄只剩左侧那颗，语义名与桌面一致（44px 尺寸由 @media 块保证，见下面的样式表契约）
      expect(screen.getByRole('button', { name: '展开元件库' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /右侧面板/ })).toBeNull();
    },
  );

  it('窄屏：元件库手柄能把抽屉拉出来、再收回去（右侧那套已不存在）', async () => {
    setViewport(390, 844);
    renderApp();
    startJob('非门');

    // 左侧：拉出元件库 → 画布之上多一层抽屉（竖屏时它是底部抽屉，位置由 CSS 决定）
    fireEvent.click(screen.getByRole('button', { name: '展开元件库' }));
    expect(screen.getByText('三极管 NPN')).toBeTruthy();
    expect(document.querySelector('aside.palette')).toBeTruthy();
    expect(bodyChildren()).toEqual(['palette', 'edge-strip left', 'canvas-wrap']);

    // 同一个按钮换成「收起」语义，再收回去
    fireEvent.click(screen.getByRole('button', { name: '收起元件库' }));
    expect(screen.queryByText('三极管 NPN')).toBeNull();

    // 右侧面板（验收/属性）已整块移除：没有右侧手柄可点，也没有 .side 会被拉出来
    expect(screen.queryByRole('button', { name: /右侧面板/ })).toBeNull();
    expect(document.querySelector('.side')).toBeNull();
  });
});

// ---------- 竖屏：手柄行只剩元件库一颗 + 右侧面板整块不存在 ----------
describe('竖屏：底部手柄行只剩元件库一颗（验收面板/手柄已整块移除）', () => {
  it.each([
    ['390×844', 390, 844],
    ['360×640', 360, 640],
    ['430×932', 430, 932],
  ])('%s：手柄行里只有元件库那一颗，带文字标签、贴底不倒挂', (_label, w, h) => {
    setViewport(w, h);
    renderApp();
    startJob('非门');

    // .edge-strip.right 任何视口都不渲染（右侧手柄随面板一起删了）
    expect(document.querySelector('.edge-strip.right')).toBeNull();
    const row = document.querySelector('.edge-strip.left');
    const buttons = [...(row?.querySelectorAll('button') ?? [])];
    // 竖屏那颗「验收」手柄已随面板移除：这一行现在只有一颗按钮
    expect(buttons.length).toBe(1);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['展开元件库']);
    expect(buttons[0]?.textContent?.trim()).toBe('▶元件库'); // 收起态是 ▶ + 文字标签
    expect(buttons[0]?.getAttribute('title')).toBe('展开元件库');
    // 44px 尺寸与贴底位置由 CSS 保证（见样式表契约 / CDP 实测）
    expect(buttons[0]?.parentElement).toBe(row);
  });

  it.each([
    ['390×844', 390, 844],
    ['360×640', 360, 640],
    ['430×932', 430, 932],
  ])('%s：元件库抽屉开合时手柄行跟着上抬/落回，右侧不再有任何面板', (_label, w, h) => {
    setViewport(w, h);
    renderApp();
    startJob('非门');

    // 开元件库 → 手柄行贴到抽屉顶沿（.closed 被摘掉，位置由 CSS 的 :not(.closed) 规则给）
    fireEvent.click(screen.getByRole('button', { name: '展开元件库' }));
    expect(document.querySelector('aside.palette')).toBeTruthy();
    expect(document.querySelector('.side')).toBeNull();
    expect(document.querySelector('.edge-strip.left')?.className).toBe('edge-strip left');

    // 收起来 → 手柄行落回画布左下角
    fireEvent.click(screen.getByRole('button', { name: '收起元件库' }));
    expect(document.querySelector('aside.palette')).toBeNull();
    expect(document.querySelector('.edge-strip.left')?.className).toBe('edge-strip left closed');
    expect(document.querySelector('.side')).toBeNull();
  });

  it.each([
    ['844×390（横屏手机）', 844, 390],
    ['1024×768（横屏平板）', 1024, 768],
    ['1280×800（桌面）', 1280, 800],
  ])('%s：手柄只剩左侧一颗（右侧那套全视口不存在），元件库开合照旧', (_label, w, h) => {
    setViewport(w, h);
    renderApp();
    startJob('非门');

    // 右侧面板 + 右侧手柄已整块移除：宽屏也不再有一左一右两颗手柄
    expect(document.querySelectorAll('.edge-strip.right')).toHaveLength(0);
    expect(document.querySelectorAll('.edge-strip.left button')).toHaveLength(1);
    expect(document.querySelector('.side')).toBeNull();
    expect(screen.queryByRole('button', { name: /右侧面板/ })).toBeNull();

    // 桌面默认开着；横屏窄屏默认收起（narrow 时自动收起）→ 手工拉开成「开着」
    if (!document.querySelector('aside.palette'))
      fireEvent.click(screen.getByRole('button', { name: '展开元件库' }));
    expect(document.querySelector('aside.palette')).toBeTruthy();

    // 宽屏下开合元件库只影响它自己，右侧不会冒出任何东西
    fireEvent.click(screen.getByRole('button', { name: '收起元件库' }));
    fireEvent.click(screen.getByRole('button', { name: '展开元件库' }));
    expect(document.querySelector('aside.palette')).toBeTruthy();
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
  ])('%s：竖屏卡片把**全名**放进 title（44px 宽只能两行，名字要还能认）', (_label, w, h) => {
    setViewport(w, h);
    renderApp();
    startJob('非门');
    dismissTaskDialog();
    openPalette();
    const cards = [...document.querySelectorAll('.palette-item')];
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const name = card.querySelector('.palette-name')?.textContent?.trim() ?? '';
      const title = card.getAttribute('title') ?? '';
      expect(name.length, '卡片里有名字').toBeGreaterThan(0);
      expect(title.startsWith(name), `${name} → title=「${title}」`).toBe(true);
    }
  });

  it('反证：桌面/横屏的卡片 title 逐字不变（没有「名字｜」前缀）', () => {
    setViewport(1280, 800);
    renderApp();
    startJob('非门');
    dismissTaskDialog();
    const cards = [...document.querySelectorAll('.palette-item')];
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const title = card.getAttribute('title') ?? '';
      expect(title).not.toContain('｜'); // 竖屏才拼「名字｜」，桌面一个字都不加
      // 未锁的卡片照旧是那句话；锁住的卡片照旧是关卡给的理由
      if ((card as HTMLButtonElement).disabled) expect(title.length).toBeGreaterThan(0);
      else expect(title).toMatch(/（拖到画布放置/);
    }
  });

  it.each([
    ['390×844', 390, 844],
    ['360×640', 360, 640],
    ['430×932', 430, 932],
  ])('%s：卡片只有名字，价格/说明/引脚数/延迟/状态都不进 DOM', (_label, w, h) => {
    setViewport(w, h);
    renderApp();
    startJob('非门');
    dismissTaskDialog(); // 首次进关的「本关任务」弹窗先收掉：它有合同条款（元件成本/传播延迟）
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

// ---------- 顶栏两行结构：调试模式那一组固定在第二行 ----------
/** URL 带不带 ?debug=1：调试控件（debugFlag）只在带上时才存在 */
function setDebugUrl(on: boolean): void {
  window.history.replaceState({}, '', on ? '/?debug=1' : '/');
}

describe('顶栏两行结构：调试模式那一组在第二行', () => {
  it.each([
    ['桌面 1280×800', 1280, 800],
    ['竖屏 390×844', 390, 844],
  ])('%s：?debug=1 时调试控件落在第二行容器里，且能点开', (_label, w, h) => {
    setViewport(w, h);
    setDebugUrl(true);
    renderApp();
    startJob('非门');

    const rows = [...document.querySelectorAll('.toolbar-row')];
    expect(rows).toHaveLength(2); // 默认就是两行，不靠点什么才换行
    const row2 = document.querySelector('.toolbar-row-debug');
    expect(row2).toBeTruthy();
    expect(row2).toBe(rows[1]);

    // 调试那一组整个在第二行：开关在里面，第一行里没有
    expect(row2?.querySelector('.debug-group')).toBeTruthy();
    expect(screen.getByText('调试模式').closest('.toolbar-row-debug')).toBe(row2);
    expect(rows[0]?.querySelector('.debug-group')).toBeNull();
    expect(rows[0]?.querySelector('.debug-group')).toBeFalsy();

    // 可点：?debug=1 进来调试模式已被强制打开（App.tsx 里的 effect），三个调试按钮就在第二行里
    for (const label of ['复制电路', '一键出答案', '重新计算']) {
      expect(screen.getByText(label).closest('.toolbar-row-debug')).toBe(row2);
    }
    // 关掉再打开，按钮仍在第二行（第二行容器不因为开关状态而搬家）
    fireEvent.click(screen.getByText('调试模式'));
    expect(screen.queryByText('一键出答案')).toBeNull();
    fireEvent.click(screen.getByText('调试模式'));
    expect(screen.getByText('一键出答案').closest('.toolbar-row-debug')).toBe(row2);

    // 第一行照旧：主要按钮组 + 右侧区域（弹簧）
    expect(rows[0]?.querySelector('.brand')).toBeTruthy();
    expect(rows[0]?.querySelector('.spacer')).toBeTruthy();
    expect(rows[0]?.textContent).toContain('返回地图');
  });

  it.each([
    ['桌面 1280×800', 1280, 800],
    ['竖屏 390×844', 390, 844],
  ])('%s：不带 ?debug=1 时第二行整行不渲染（正式玩法不多一条空栏）', (_label, w, h) => {
    setViewport(w, h);
    setDebugUrl(false);
    renderApp();
    startJob('非门');

    expect(document.querySelector('.toolbar-row-debug')).toBeNull();
    expect(document.querySelectorAll('.toolbar-row')).toHaveLength(1);
    // 顶栏里只剩第一行这一个子元素 → 不占高度
    expect([...(document.querySelector('.toolbar')?.children ?? [])]).toHaveLength(1);
    expect(screen.queryByText('调试模式')).toBeNull();
    expect(screen.queryByText('一键出答案')).toBeNull();
  });
});

// ---------- 桌面防回归 ----------
describe('桌面宽屏：结构与基线逐字一致', () => {
  it.each([
    ['1024×768（横屏平板，断点之上）', 1024, 768],
    ['1440×900（桌面）', 1440, 900],
  ])('视口 %s：元件库默认展开、顺序不变、开合按钮是「收起」语义', (_label, w, h) => {
    setViewport(w, h);
    renderApp();
    startJob('非门');

    // 右侧面板/手柄已整块移除：宽屏的 .body 里只剩三块（元件库 + 左手柄 + 画布）
    expect(bodyChildren()).toEqual(['palette', 'edge-strip left', 'canvas-wrap']);
    expect(screen.getByText('三极管 NPN')).toBeTruthy();
    expect(document.querySelector('.side')).toBeNull();
    expect(document.querySelector('.edge-strip.right')).toBeNull();
    expect(screen.getByRole('button', { name: '收起元件库' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /右侧面板/ })).toBeNull();
  });

  it('视口 1024（断点之上）：窄屏那次自动收起不会误触发', () => {
    setViewport(1024, 768);
    renderApp();
    startJob('非门');
    // 面板开合偏好没有被静默写成「收起」（右侧面板的偏好键已随面板一起删掉）
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
/** 用户第 ⑬ 轮：≤380px 竖屏单独一档（360×640 也要一行 8 张） */
const TINY_PORTRAIT_MEDIA_QUERY = TINY_PORTRAIT_MEDIA_QUERY_FROM_TS;
const TINY_INDEX = MEDIA_CSS.findIndex((block) => block.query === TINY_PORTRAIT_MEDIA_QUERY);
const TINY_BLOCK = TINY_INDEX >= 0 ? (MEDIA_CSS[TINY_INDEX]?.body ?? '') : '';
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
    // 元件库改覆盖抽屉，不再挤画布；右侧面板的规则已随面板整块移除
    expect(rules.get('.palette')).toContain('position: absolute');
    expect(rules.get('.side')).toBeUndefined();
    expect(rules.get('.edge-strip.right')).toBeUndefined();
    // 顶栏一行横向滚动（按钮一个不删）
    const toolbar = rules.get('.toolbar') ?? '';
    expect(toolbar).toContain('flex-wrap: nowrap');
    // 横滑从「整条顶栏」下移到**每一行**（顶栏现在是两行结构）
    expect(rules.get('.toolbar-row')).toContain('overflow-x: auto');
    expect(rules.get('.toolbar-row')).toContain('flex-wrap: nowrap');
    expect(rules.get('.toolbar button')).toMatch(/min-height:\s*44px/);
    // 开合手柄：44px 触屏目标 + 窄屏才显示的文字标签
    const handle = rules.get('.edge-strip > button') ?? '';
    expect(handle).toMatch(/min-height:\s*44px/);
    expect(handle).toMatch(/min-width:\s*44px/);
    expect(rules.get('.edge-strip-label')).toContain('display: inline');
    // 面板里的可点项抬到 44px；鼠标专用的提示行在窄屏藏掉
    expect(rules.get('.palette-item')).toContain('min-height: 44px');
    expect(rules.get('.hint-mouse')).toContain('display: none');
    // 顶栏「任务」块（第 ⑧ 轮起只留短标题，描述搬到画布顶端 .canvas-brief）：窄屏**不再吃满
    // 剩余宽度**，只占标题本身的宽度；触屏 44px 目标保住，标题超长自己省略号截断。
    const taskBar = rules.get('.toolbar .task-bar') ?? '';
    expect(taskBar).toMatch(/flex:\s*0 1 auto/);
    expect(taskBar).toMatch(/min-height:\s*44px/);
    expect(taskBar).toMatch(/max-width:\s*none/);
    // 画布顶端的描述浮层：夹在顶部 56px 手柄带（图例 top:60px）之间，最多 2 行；
    // 横屏左上角有「元件库」手柄（实测 8~96px），left 让开它
    const brief = rules.get('.canvas-brief') ?? '';
    expect(brief).toMatch(/top:\s*6px/);
    expect(brief).toMatch(/left:\s*104px/);
    expect(brief).toMatch(/max-height:\s*44px/);
    expect(brief).toMatch(/-webkit-line-clamp:\s*2/);
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

  it('竖屏块里：元件库是底部抽屉 + 手柄行（现在只有元件库一颗）+ 右侧面板规则已全部移除', () => {
    const rules = parseCss(PORTRAIT_BLOCK).base;
    // ① 元件库 = 底部抽屉（自 ⑥ 起的形态不动）
    const palette = rules.get('.palette') ?? '';
    expect(palette).toContain('bottom: 0');
    expect(palette).toContain('height: min(46%, 380px)');
    expect(palette).toContain('border-radius: 14px 14px 0 0');
    expect(palette).toContain('box-shadow: 0 -16px 32px rgba(0, 0, 0, 0.5)');
    expect(palette).toContain('animation: lc-sheet-up 0.18s ease');
    expect(palette).toMatch(/top:\s*auto/);
    // ② 验收（右侧面板）整块移除：竖屏块里再也没有 .side / .edge-strip.right 的规则
    expect(rules.get('.side')).toBeUndefined();
    expect(rules.get('.edge-strip.right')).toBeUndefined();
    // ③ 顶栏：竖屏**允许换行**（横屏/桌面仍是一行横滑）。第 ⑧ 轮起任务块只剩短标题，
    //    所以它和「返回地图」「交付验收」同在第一行；真放不下时按内容宽度换到下一行。
    const topRow = rules.get('.toolbar-row') ?? '';
    expect(topRow).toContain('flex-wrap: wrap');
    expect(topRow).toContain('overflow-x: visible');
    //    第 ⑧ 轮：任务块只占短标题宽度（描述已在画布上），所以它留在第一行，不再独占一行
    expect(rules.get('.toolbar .task-bar')).toMatch(/flex:\s*0 1 auto/);
    //    画布顶端描述浮层：竖屏顶部手柄带是空的（开合手柄在底部那行）→ 贴左边缘
    expect(rules.get('.canvas-brief')).toMatch(/left:\s*8px/);
    // ④ 手柄行：仍是那一行（贴底、抽屉开着时上抬）；行里现在只有元件库一颗按钮，
    //    flex 行结构与 44px 目标原样保留（多出来的 gap 对单颗按钮无影响）
    const row = rules.get('.edge-strip.left') ?? '';
    expect(row).toContain('display: flex');
    expect(row).toContain('flex-direction: row'); // 基础块是竖排，这里必须横过来
    expect(row).toMatch(/top:\s*auto/);
    expect(row).toMatch(/bottom:\s*calc\(8px/);
    expect(rules.get('.edge-strip.left:not(.closed)')).toMatch(/bottom:\s*calc\(min\(46%, 380px\)/);
  });

  it('竖屏块里的精简卡片：一行横排 + 可横滑 + 触屏高度 ≥44px + 一行放得下 ≥8 张', () => {
    const rules = parseCss(PORTRAIT_BLOCK).base;
    const strip = rules.get('.palette-section-body') ?? '';
    expect(strip).toContain('display: flex');
    expect(strip).toMatch(/flex-flow:\s*row nowrap/);
    expect(strip).toContain('overflow-x: auto'); // 横滑只开在这一处
    expect(strip).toContain('overflow-y: hidden');
    const item = rules.get('.palette-item') ?? '';
    expect(item).toMatch(/flex:\s*0 0 auto/);

    const num = (re: RegExp, css: string): number => {
      const m = re.exec(css);
      expect(m, `${re} 没匹配到：${css.slice(0, 60)}`).toBeTruthy();
      return Number(m?.[1] ?? Number.NaN);
    };
    // 用户第 ⑫ 轮：卡片宽 44~46px、卡片间距 ≤4px、抽屉左右内边距 ≤8px。
    // jsdom 不做真实排版（getBoundingClientRect 恒 0），所以这里断言**样式表声明值**，
    // 再用注水宽度算出"一行几张"；真实排版数字由 CDP 三尺寸实测给出（见提交信息）。
    const width = num(/width:\s*(\d+(?:\.\d+)?)px/, item);
    const minWidth = num(/min-width:\s*(\d+(?:\.\d+)?)px/, item);
    const minHeight = num(/min-height:\s*(\d+(?:\.\d+)?)px/, item);
    expect(width).toBeGreaterThanOrEqual(44);
    expect(width).toBeLessThanOrEqual(46);
    expect(minWidth).toBe(width);
    expect(minHeight).toBeGreaterThanOrEqual(44); // 触屏目标：高度一分不让
    const gap = num(/gap:\s*(\d+(?:\.\d+)?)px/, strip);
    expect(gap).toBeLessThanOrEqual(4);
    const palette = rules.get('.palette') ?? '';
    const pad = /padding:\s*(\d+)px\s+(\d+)px\s+calc\(/.exec(palette);
    expect(pad, '竖屏抽屉的三段式 padding').toBeTruthy();
    const sidePad = Number(pad?.[2] ?? Number.NaN);
    expect(sidePad).toBeLessThanOrEqual(8);

    // 390px 视口（用户点名的尺寸）：可用宽 = 390 − 两侧内边距，n 张要 n×宽 + (n−1)×间距
    const usable = 390 - 2 * sidePad;
    const need8 = 8 * width + 7 * gap;
    expect(usable).toBeGreaterThan(0);
    expect(need8, '8 张卡 + 7 道缝').toBeLessThanOrEqual(usable);
    const perRow = Math.floor((usable + gap) / (width + gap));
    expect(perRow, `390px 一行只放得下 ${perRow} 张`).toBeGreaterThanOrEqual(8);
    // 更严的一档：自由模式下抽屉内容比抽屉本体高 → 多一条 **15px** 纵向滚动条（CDP 实测 390 上
    // 抽屉可用宽 374 → 359），扣掉它也要放得下 8 张。
    const SCROLLBAR_PX = 15;
    expect(need8, '扣掉 15px 滚动条后仍要放得下 8 张').toBeLessThanOrEqual(usable - SCROLLBAR_PX);
    expect(Math.floor((usable - SCROLLBAR_PX + gap) / (width + gap))).toBeGreaterThanOrEqual(8);

    // 名字要还能认：字号 10~11px + 折两行 + 超出省略号（全名在 title 里，见下面那条用例）
    const name = rules.get('.palette-item .palette-name') ?? '';
    expect(name).toContain('white-space: normal');
    expect(name).toContain('-webkit-line-clamp: 2');
    expect(name).toContain('overflow: hidden');
    expect(name).toContain('overflow-wrap: anywhere');
    const nameFont = num(/font-size:\s*(\d+(?:\.\d+)?)px/, name);
    expect(nameFont).toBeGreaterThanOrEqual(10);
    expect(nameFont).toBeLessThanOrEqual(11);
  });

  it('窄屏竖屏档（≤380px）：卡片 40px、8 张放得下 360，高度与字号一分不让', () => {
    // 这一档的**存在性**本身就是需求：360×640 上 44px 卡几何上放不下 8 张（见下面的算式）
    expect(TINY_PORTRAIT_MEDIA_QUERY).toBe(
      `(max-width: ${TINY_PORTRAIT_BREAKPOINT_PX}px) and (orientation: portrait)`,
    );
    expect(TINY_INDEX, '样式表里缺少 ≤380px 竖屏档').toBeGreaterThan(-1);
    // 层叠顺序：必须排在竖屏块**之后**，否则 width: 44px 会盖掉这条
    expect(TINY_INDEX).toBeGreaterThan(PORTRAIT_INDEX);
    const tiny = parseCss(TINY_BLOCK).base;
    const portrait = parseCss(PORTRAIT_BLOCK).base;
    const num = (re: RegExp, css: string): number => {
      const m = re.exec(css);
      expect(m, `${re} 没匹配到：${css.slice(0, 60)}`).toBeTruthy();
      return Number(m?.[1] ?? Number.NaN);
    };
    const tinyItem = tiny.get('.palette-item') ?? '';
    expect(tinyItem, 'TINY_BLOCK 里必须覆盖 .palette-item').not.toBe('');
    const width = num(/width:\s*(\d+(?:\.\d+)?)px/, tinyItem);
    const minWidth = num(/min-width:\s*(\d+(?:\.\d+)?)px/, tinyItem);
    expect(width).toBe(40);
    expect(minWidth).toBe(40);
    // 已知取舍：宽度 40 < 44 触控目标，但**只在这一档**；高度不许动
    expect(width).toBeLessThan(44);
    expect(tinyItem, '这一档不许改高度').not.toMatch(/min-height/);
    expect(
      num(/min-height:\s*(\d+(?:\.\d+)?)px/, portrait.get('.palette-item') ?? ''),
    ).toBeGreaterThanOrEqual(44);
    // 字号也不许借机变小（显式写死 10px，仍是允许区间 10~11px）
    const tinyFont = num(
      /font-size:\s*(\d+(?:\.\d+)?)px/,
      tiny.get('.palette-item .palette-name') ?? '',
    );
    expect(tinyFont).toBeGreaterThanOrEqual(10);
    expect(tinyFont).toBeLessThanOrEqual(11);

    // 360×640（用户点名的尺寸）实算：抽屉左右内边距来自竖屏块（≤8px），自由模式再多一条 15px 滚动条
    const pad = /padding:\s*(\d+)px\s+(\d+)px\s+calc\(/.exec(portrait.get('.palette') ?? '');
    expect(pad).toBeTruthy();
    const sidePad = Number(pad?.[2] ?? Number.NaN);
    expect(sidePad).toBeLessThanOrEqual(8);
    const gap = num(/gap:\s*(\d+(?:\.\d+)?)px/, portrait.get('.palette-section-body') ?? '');
    expect(gap).toBeLessThanOrEqual(4);
    const SCROLLBAR_PX = 15; // CDP 实测：自由模式下抽屉多一条 15px 纵向滚动条
    const usable360 = 360 - 2 * sidePad - SCROLLBAR_PX;
    expect(usable360).toBe(339); // 与 CDP 实测一致（360 − 6 − 15）
    const need8 = 8 * width + 7 * gap;
    expect(need8, '8 张卡 + 7 道缝').toBe(334);
    expect(need8, '360px 上必须放得下 8 张').toBeLessThanOrEqual(usable360);
    expect(Math.floor((usable360 + gap) / (width + gap)), '360px 一行张数').toBeGreaterThanOrEqual(
      8,
    );
    // 反证：旧的 44px 卡在 360 上确实放不下（说明这条规则不是多余的）
    expect(8 * 44 + 7 * gap).toBeGreaterThan(usable360);
    // 390 / 430 不被这条规则影响（各自 44px 档仍 ≥8 张）
    expect(TINY_PORTRAIT_BREAKPOINT_PX).toBeLessThan(390);
    for (const vw of [390, 430]) {
      const usable = vw - 2 * sidePad - SCROLLBAR_PX;
      const w44 = num(/width:\s*(\d+(?:\.\d+)?)px/, portrait.get('.palette-item') ?? '');
      expect(Math.floor((usable + gap) / (w44 + gap)), `${vw}px 一行张数`).toBeGreaterThanOrEqual(
        8,
      );
    }
  });

  it('基础块（非媒体查询）里的桌面布局关键声明原样还在', () => {
    // 桌面默认两行：顶栏是 column 容器，行内才换行
    expect(BASE_CSS.get('.toolbar')).toContain('flex-direction: column');
    expect(BASE_CSS.get('.toolbar-row')).toContain('flex-wrap: wrap');
    expect(BASE_CSS.get('.toolbar .spacer')).toContain('flex: 1');
    expect(BASE_CSS.get('.body')).toContain('display: flex');
    expect(BASE_CSS.get('.palette')).toContain('width: 240px');
    // 右侧面板（316px 常驻栏）已整块移除 → 基础块里连它的规则都不该有
    expect(BASE_CSS.get('.side')).toBeUndefined();
    expect(BASE_CSS.get('.edge-strip.right')).toBeUndefined();
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
    // 顶栏任务块：桌面/宽屏**只占短标题宽度**（描述已搬到画布顶端，不再有 brief 那一行）
    expect(BASE_CSS.get('.task-bar')).toContain('flex: 0 1 auto');
    expect(BASE_CSS.get('.task-bar')).toMatch(/max-width:\s*min\(240px/);
    expect(BASE_CSS.get('.task-bar-title')).toContain('text-overflow: ellipsis');
    // 画布顶端的描述浮层（基础块 = 宽屏）：贴左上角、最多 3 行、max-width 够不着右上角图例
    const baseBrief = BASE_CSS.get('.canvas-brief') ?? '';
    expect(baseBrief).toContain('position: absolute');
    expect(baseBrief).toMatch(/top:\s*10px/);
    expect(baseBrief).toMatch(/left:\s*12px/);
    expect(baseBrief).toMatch(/max-width:\s*min\(560px, 46%\)/);
    expect(baseBrief).toMatch(/-webkit-line-clamp:\s*3/);
    expect(baseBrief).toContain('overflow: hidden');
    expect(BASE_CSS.get('.palette-cost')).toContain('color: var(--ok)');
    expect(BASE_CSS.get('.palette-note')).toContain('white-space: nowrap');
  });
});
