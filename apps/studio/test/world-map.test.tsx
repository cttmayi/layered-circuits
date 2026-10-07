// @vitest-environment jsdom
/**
 * 关卡地图（选关界面）：27 关都应在动态 viewBox 内、地图区可上下滚动。
 * 防回归：加关后节点不再被裁剪（viewBox 高度随总行数增长）。
 */
import { ALL_LEVELS, findLevel } from '@lc/content';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { emptyProgress } from '../src/level/progress';
import { WorldMap } from '../src/panels/WorldMap';

describe('关卡地图（选关界面）', () => {
  it('30 个关卡节点全部落在动态 viewBox 内（top% < 100，无裁剪）', () => {
    const { container } = render(
      <WorldMap
        progress={emptyProgress()}
        family="rtl"
        currentLevelId="s1-npn"
        onPick={() => {}}
        onBack={() => {}}
      />,
    );
    const btns = [...container.querySelectorAll<HTMLButtonElement>('.map-node-btn')];
    expect(btns).toHaveLength(ALL_LEVELS.length);
    for (const b of btns) {
      const top = Number.parseFloat(b.style.top);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThan(100);
    }
  });

  it('SVG 的 viewBox 高度 ≥ 最后一个节点位置（内容不被裁剪）', () => {
    const { container } = render(
      <WorldMap
        progress={emptyProgress()}
        family="rtl"
        currentLevelId="s1-npn"
        onPick={() => {}}
        onBack={() => {}}
      />,
    );
    const svg = container.querySelector<SVGSVGElement>('.map-svg');
    const vb = svg?.getAttribute('viewBox')?.split(' ').map(Number) ?? [];
    const viewH = vb[3] ?? 0;
    const last = [...container.querySelectorAll<HTMLButtonElement>('.map-node-btn')].at(-1);
    const lastTop = Number.parseFloat(last?.style.top ?? '0');
    // 最后一个节点 top% 对应 viewBox 内的 y = top% × viewH，应小于 viewH（留出节点半径）
    expect(lastTop).toBeLessThan(100);
    expect(viewH).toBeGreaterThan(0);
    // 滚动结构：.map-stage 是滚动容器，.map-canvas 是节点定位的包含块
    const stage = container.querySelector('.map-stage');
    const canvas = container.querySelector('.map-canvas');
    expect(stage).not.toBeNull();
    expect(canvas).not.toBeNull();
    expect(canvas?.parentElement).toBe(stage);
  });

  it('蛇形连续：任意相邻关卡（含跨章）节点水平或垂直相邻，不断线', () => {
    // 全表一条蛇形：若某对相邻关卡既不同列也不同行（对角），连线会被拉成
    // 横穿整幅地图的折线（如第 6 关连不到第 7 关、第二章末连不到第三章首）。
    const { container } = render(
      <WorldMap
        progress={emptyProgress()}
        family="rtl"
        currentLevelId="s1-npn"
        onPick={() => {}}
        onBack={() => {}}
      />,
    );
    const btns = [...container.querySelectorAll<HTMLButtonElement>('.map-node-btn')];
    expect(btns).toHaveLength(ALL_LEVELS.length);
    for (let i = 0; i + 1 < ALL_LEVELS.length; i++) {
      const a = btns[i];
      const b = btns[i + 1];
      expect(a && b, `${ALL_LEVELS[i]!.id} 节点缺失`).toBeTruthy();
      if (!a || !b) continue;
      const ax = Number.parseFloat(a.style.left);
      const ay = Number.parseFloat(a.style.top);
      const bx = Number.parseFloat(b.style.left);
      const by = Number.parseFloat(b.style.top);
      const sameCol = Math.abs(ax - bx) < 0.01;
      const sameRow = Math.abs(ay - by) < 0.01;
      expect(
        sameCol || sameRow,
        `相邻关 ${ALL_LEVELS[i]!.title} → ${ALL_LEVELS[i + 1]!.title} 应水平或垂直相邻，实际 ${ax},${ay} → ${bx},${by}`,
      ).toBe(true);
    }
  });
});

describe('地图卡片的信息完整（与已删除的 LevelCard 无关，防"删文件顺手删信息"）', () => {
  it('每个节点都有关卡号 + 标题 + 状态（已通关显示 ★ 数量），信息不靠侧栏那张任务卡', () => {
    // 第 ⑧ 轮用户提问：删掉 panels/LevelCard.tsx 会不会让**选关地图**的卡片缺信息？
    // 结论：不会 —— LevelCard 只被 App 的右侧验收面板引用（已整块移除），地图节点由 WorldMap
    // 自己渲染。这条把它钉住：节点的号码/标题/星级/状态全在，且不依赖任何侧栏组件。
    const progress = emptyProgress();
    // 第 1 关按存档口径标成已通关（三星）：星级只从 progress 来，与侧栏无关
    progress.cleared['s1-not'] = {
      score: 100,
      bestProfitHalf: 999,
      bestCostHalf: 6,
      stars: 3,
      clearedAt: 1,
    };
    const { container } = render(
      <WorldMap
        progress={progress}
        family="rtl"
        currentLevelId="s1-notch"
        onPick={() => {}}
        onBack={() => {}}
      />,
    );
    const btns = [...container.querySelectorAll<HTMLButtonElement>('.map-node-btn')];
    expect(btns).toHaveLength(ALL_LEVELS.length);
    btns.forEach((b, i) => {
      const level = ALL_LEVELS[i]!;
      const view = findLevel(level.id)!;
      expect(b.querySelector('.node-num')?.textContent, `${level.id} 缺关卡号`).toBe(String(i + 1));
      expect(b.querySelector('.node-title')?.textContent, `${level.id} 缺标题`).toBe(view.title);
      expect(
        (b.querySelector('.node-stars')?.textContent ?? '').trim().length,
        `${level.id} 缺状态（星/图标）`,
      ).toBeGreaterThan(0);
      // 悬停补全（标题 + 状态）也在
      expect(b.getAttribute('title') ?? '').toContain(view.title);
    });
    // 已通关那关：三颗实心星（星级真的从 progress 来）
    const clearedBtn = btns.find((b) => b.querySelector('.node-title')?.textContent === '非门');
    expect(clearedBtn?.textContent).toContain('★★★');
    expect(clearedBtn?.className).toContain('cleared');
    // 没有侧栏「任务卡」这回事：地图里不存在 .level-card
    expect(container.querySelector('.level-card')).toBeNull();
  });
});
