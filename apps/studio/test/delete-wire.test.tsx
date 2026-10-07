// @vitest-environment jsdom
/** 双击连线直接删除（替代「点选 + Delete」） */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atWorld, stubCanvasSize, unstubCanvasSize } from './camera-probe';
import { renderApp, startJob } from './helpers';

vi.mock('../src/editor/render.ts', async (importOriginal) => {
  const { withCameraProbe } = await import('./camera-probe');
  return withCameraProbe(await importOriginal<typeof import('../src/editor/render.ts')>());
});

const KEY = 'lc-studio-level-s1-not-v1';

/** 世界坐标 → client 坐标：用 App 当前相机（进关自适应后相机不是固定值了） */
const screenOf = atWorld;
afterEach(unstubCanvasSize);
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

beforeEach(() => {
  localStorage.clear();
  stubCanvasSize(1280, 754); // jsdom 兜底只有 200×200：给个真实画布尺寸，世界坐标才落在画布内
});

describe('双击连线删除', () => {
  it('搭一条线 → 双击它 → 线消失', async () => {
    renderApp();
    startJob('非门');
    place('电阻', 40, 140); // R：引脚在上下两端，摆在预置 VCC 轨正下方（不压到输入端口 a）
    // 第 ⑪ 轮起关卡模式不再提供「电源与端口」组，改用关卡**预置**的 VCC 轨
    // （世界 (40,60)，引脚在下方 +14）；实测走线就是一条直线 (40,118)→(40,74)
    wire(40, 118, 40, 74); // R.a → 预置 VCC.p
    await waitFor(
      () => {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { wires?: unknown[] };
        expect(saved.wires?.length).toBe(1);
      },
      { timeout: 5000 },
    );
    // 双击线的中点（R.a (40,118) → VCC.p (40,74) 的中点 = (40,96)）
    fireEvent.doubleClick(document.querySelector('canvas') as HTMLCanvasElement, {
      button: 0,
      ...screenOf(40, 96),
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
    renderApp();
    startJob('非门');
    place('电阻', 40, 140);
    wire(40, 118, 40, 74); // R.a → 预置 VCC.p（一条直线）
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
