// @vitest-environment jsdom
/**
 * 段码任务图：直接「用图表达任务」——0-9 每个数字下，本关的段线谁亮谁灭。
 * 只画本关输出的段线；真值表不在卡片上（收进「任务详情」弹窗）。
 */

import { findLevel } from '@lc/content';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SegmentTaskDiagram } from '../src/panels/SegmentDiagram';

describe('段码任务图', () => {
  it('段码·abc：0-9 各一个数码管，每格只画 a/b/c 三根段线', () => {
    const level = findLevel('s3-display');
    expect(level).toBeTruthy();
    const { container } = render(<SegmentTaskDiagram level={level!} />);
    expect(container.querySelectorAll('.seg-cell').length).toBe(10);
    expect(container.querySelectorAll('.seg-digit').length).toBe(10);
    // 每格只画本关输出的段线（a/b/c = 3 个 rect，d-g 不画）
    expect(container.querySelector('.seg-cell')!.querySelectorAll('rect').length).toBe(3);
    // 图例：段位标注 + 本关段线数
    expect(screen.getByText(/段位 a·b·c/)).toBeTruthy();
    expect(screen.getByText(/本关要搭的 3 条段线/)).toBeTruthy();
    // 数字 1（bcd0=1）只亮 b、c：对应格 a 灭、b/c 亮
    const one = container.querySelectorAll('.seg-cell')[1]!;
    const rects = [...one.querySelectorAll('rect')].map((r) => r.getAttribute('fill'));
    expect(rects).toEqual([expect.not.stringMatching(/^#ffb454/), '#ffb454', '#ffb454']);
  });

  it('段码·de / 段码·fg：每格只画本关的 2 根段线', () => {
    for (const [id, segs] of [
      ['s3-seg-de', 'd·e'],
      ['s3-seg-fg', 'f·g'],
    ] as const) {
      const level = findLevel(id);
      const { container } = render(<SegmentTaskDiagram level={level!} />);
      expect(container.querySelector('.seg-cell')!.querySelectorAll('rect').length).toBe(2);
      expect(screen.getByText(new RegExp(`段位 ${segs.replace('.', '\\.')}`))).toBeTruthy();
    }
  });
});
