// @vitest-environment jsdom
/**
 * 黑盒侦察：图纸输出列先遮住，玩家用测试仪测 + 自己填，核对通过才算「自主测绘」。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { PROGRESS_KEY } from '../src/level/progress';
import { startJob } from './helpers';

function recordCells(): HTMLButtonElement[] {
  return [...document.querySelectorAll('.recon-table .record-cell')] as HTMLButtonElement[];
}

/** 主菜单 → 第 1 关 → 开工 → 图纸卡上的「黑盒侦察（测图纸）」按钮打开居中对话框 */
function openRecon(): void {
  startJob('非门');
  fireEvent.click(screen.getByText('黑盒侦察（测图纸）'));
  expect(screen.getByRole('dialog', { name: '黑盒侦察' })).toBeTruthy();
}

describe('黑盒侦察', () => {
  beforeEach(() => localStorage.clear());

  it('第 1 关：图纸输出列是问号，测试仪测出来后才能填', () => {
    render(<App />);
    openRecon();
    // 未测之前没有读数
    expect(screen.getByText('还没测过')).toBeTruthy();
    expect(recordCells().map((c) => c.textContent)).toEqual(['?', '?']);
    // 核对按钮在没填完之前是禁用的
    expect((screen.getByText('核对图纸') as HTMLButtonElement).disabled).toBe(true);

    // 测第 1 组 → 读出 y=1
    const probeButtons = [...document.querySelectorAll('.probe-btn')] as HTMLButtonElement[];
    if (probeButtons[0]) fireEvent.click(probeButtons[0]);
    expect(document.querySelector('.probe-lamp')?.textContent).toBe('y=1');
  });

  it('填错会被指出来，填对则解锁图纸并记入「自主测绘」', () => {
    render(<App />);
    openRecon();
    const cells = recordCells();
    // 故意把两行都填 0（第 1 行应该是 1）
    if (cells[0]) fireEvent.click(cells[0]);
    if (cells[1]) fireEvent.click(cells[1]);
    fireEvent.click(screen.getByText('核对图纸'));
    expect(screen.getByText(/第 1 组填错了/)).toBeTruthy();

    // 改成正确值：非门是 0→1、1→0。第一行刚才填了 0，再点一下变 1；第二行 0 已经对了。
    const cellsAgain = recordCells();
    if (cellsAgain[0]) fireEvent.click(cellsAgain[0]);
    fireEvent.click(screen.getByText('核对图纸'));

    // 图纸解锁：委托单上的输出列露出真值
    const targetTable = document.querySelector('.level-card .truth') as HTMLTableElement;
    const rows = [...targetTable.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ['0', '1'],
      ['1', '0'],
    ]);
    // 中央弹窗：图纸解开了（黑盒侦察完成的流程时刻）
    expect(screen.getByText('图纸解开了')).toBeTruthy();
    fireEvent.click(screen.getByText('知道了'));
    expect(screen.queryByText('图纸解开了')).toBeNull();
    // 顶栏与存档都记上了
    expect(screen.getAllByText(/自主测绘 1/).length).toBeGreaterThanOrEqual(1);
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as {
      recon?: Record<string, string>;
    };
    expect(saved.recon?.['s1-not']).toBe('measured');
  });

  it('「直接看答案」也能解锁图纸，但记成 skipped（不算自主测绘）', () => {
    render(<App />);
    openRecon();
    fireEvent.click(screen.getByText('直接看答案'));
    // 必须弹出居中的「图纸解开了」反馈弹窗
    expect(screen.getByRole('dialog', { name: '图纸解开了' })).toBeTruthy();
    expect(screen.getByText(/输出列现在能看了/)).toBeTruthy();
    const targetTable = document.querySelector('.level-card .truth') as HTMLTableElement;
    expect(targetTable.textContent).toContain('1');
    expect(screen.getAllByText(/自主测绘 0/).length).toBeGreaterThanOrEqual(1);
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as {
      recon?: Record<string, string>;
    };
    expect(saved.recon?.['s1-not']).toBe('skipped');
  });
});
