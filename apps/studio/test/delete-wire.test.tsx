// @vitest-environment jsdom
/** 双击连线直接删除（替代「点选 + Delete」） */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';

const CAMERA = { x: 340, y: 220 };
const SIZE = 200;
const KEY = 'lc-studio-level-s1-not-v1';

function screenOf(wx: number, wy: number): { clientX: number; clientY: number } {
  return { clientX: wx - CAMERA.x + SIZE / 2, clientY: wy - CAMERA.y + SIZE / 2 };
}
function clickWorld(wx: number, wy: number): void {
  fireEvent.mouseDown(document.querySelector('canvas') as HTMLCanvasElement, {
    button: 0,
    ...screenOf(wx, wy),
  });
}
function place(label: string, wx: number, wy: number): void {
  fireEvent.click(screen.getByText(label).closest('button') as HTMLButtonElement);
  clickWorld(wx, wy);
}
function wire(ax: number, ay: number, bx: number, by: number): void {
  clickWorld(ax, ay);
  clickWorld(bx, by);
}

beforeEach(() => localStorage.clear());

describe('双击连线删除', () => {
  it('搭一条线 → 双击它 → 线消失', async () => {
    render(<App />);
    place('电阻', 690, 180); // R：引脚在上下两端
    place('VCC 电源', 690, 80); // VCC：引脚在下方
    wire(690, 158, 690, 94); // R.a → VCC.p（一条竖线）
    await waitFor(
      () => {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { wires?: unknown[] };
        expect(saved.wires?.length).toBe(1);
      },
      { timeout: 5000 },
    );
    // 双击线的中点（690, 126）
    fireEvent.doubleClick(document.querySelector('canvas') as HTMLCanvasElement, {
      button: 0,
      ...screenOf(690, 126),
    });
    await waitFor(
      () => {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { wires?: unknown[] };
        expect(saved.wires?.length).toBe(0);
      },
      { timeout: 5000 },
    );
  });

  it('双击空白处不会误删', async () => {
    render(<App />);
    place('电阻', 690, 180);
    place('VCC 电源', 690, 80);
    wire(690, 158, 690, 94);
    await waitFor(
      () => {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { wires?: unknown[] };
        expect(saved.wires?.length).toBe(1);
      },
      { timeout: 5000 },
    );
    fireEvent.doubleClick(document.querySelector('canvas') as HTMLCanvasElement, {
      button: 0,
      ...screenOf(500, 300), // 空白处
    });
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { wires?: unknown[] };
    expect(saved.wires?.length).toBe(1);
  });
});
