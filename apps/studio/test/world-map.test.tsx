// @vitest-environment jsdom
/**
 * 关卡地图（选关界面）：27 关都应在动态 viewBox 内、地图区可上下滚动。
 * 防回归：加关后节点不再被裁剪（viewBox 高度随总行数增长）。
 */
import { ALL_LEVELS } from '@lc/content';
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

  it('蛇形连续：同章相邻关卡节点水平或垂直相邻（拐角回行不脱节）', () => {
    // 回行（奇数行）必须右对齐贴住上一行末尾——否则断行节点跑到最左，
    // 相邻关卡被拉成横穿整幅地图的对角折线（如第 6 关连不到第 7 关）。
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
    const posOf = new Map<string, { left: number; top: number }>();
    ALL_LEVELS.forEach((l, i) => {
      posOf.set(l.id, {
        left: Number.parseFloat(btns[i]?.style.left ?? '0'),
        top: Number.parseFloat(btns[i]?.style.top ?? '0'),
      });
    });
    const byStage = new Map<number, typeof ALL_LEVELS>();
    for (const l of ALL_LEVELS) {
      const list = byStage.get(l.stage);
      if (list) list.push(l);
      else byStage.set(l.stage, [l]);
    }
    for (const levels of byStage.values()) {
      for (let i = 0; i + 1 < levels.length; i++) {
        const a = posOf.get(levels[i]!.id);
        const b = posOf.get(levels[i + 1]!.id);
        expect(a && b, `${levels[i]!.title} 位置缺失`).toBeTruthy();
        if (!a || !b) continue;
        const sameCol = Math.abs(a.left - b.left) < 0.01;
        const sameRow = Math.abs(a.top - b.top) < 0.01;
        expect(
          sameCol || sameRow,
          `同章相邻关 ${levels[i]!.title} → ${levels[i + 1]!.title} 应水平或垂直相邻，实际 ${a.left},${a.top} → ${b.left},${b.top}`,
        ).toBe(true);
      }
    }
  });
});
