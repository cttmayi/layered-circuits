// @vitest-environment jsdom
/**
 * 按钮 / 七段数码管器件：
 *  - 模型层：createDeviceSym 生成带交互/显示形态的端口符号；toDesign 导出为普通端口；
 *  - 关卡层：docForLevel 把声明的 button/display 端口变成按钮/数码管符号（锁定）；
 *  - 交互层：沙盒里从组件库放置按钮 → 点击 = 电平 1 → 400ms 自动弹回 0。
 */

import { findLevel } from '@lc/content';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeviceSym, EMPTY_DOC, toDesign } from '../src/editor/model';
import { docForLevel } from '../src/level/progress';
import { FREE_STORAGE_KEY } from '../src/level/session';
import { atWorld, stubCanvasSize, unstubCanvasSize } from './camera-probe';
import { renderApp } from './helpers';

vi.mock('../src/editor/render.ts', async (importOriginal) => {
  const { withCameraProbe } = await import('./camera-probe');
  return withCameraProbe(await importOriginal<typeof import('../src/editor/render.ts')>());
});

afterEach(() => {
  localStorage.clear();
});

function readFreeDoc(): { syms: Array<Record<string, unknown>> } {
  return JSON.parse(localStorage.getItem(FREE_STORAGE_KEY) ?? '{}') as {
    syms: Array<Record<string, unknown>>;
  };
}

describe('按钮 / 七段数码管器件', () => {
  it('createDeviceSym：按钮 = 输入端口 + button/sprite，数码管 = 输出端口 + display/width 4，标签唯一', () => {
    const btn = createDeviceSym(EMPTY_DOC, 'button', 100, 100);
    expect(btn.kind).toBe('input');
    expect(btn.button).toBe(true);
    expect(btn.sprite).toBe('button');
    expect(btn.label).toBe('btn1');

    const withBtn = { ...EMPTY_DOC, syms: [btn] };
    const seg = createDeviceSym(withBtn, 'segment', 200, 100);
    expect(seg.kind).toBe('output');
    expect(seg.display).toBe('segment');
    expect(seg.width).toBe(7);
    expect(seg.label).toBe('seg1');

    // 第二个按钮不得与第一个重名（端口名就是判定接口，重名会被 inPorts 覆盖）
    const btn2 = createDeviceSym({ ...withBtn, syms: [...withBtn.syms, seg] }, 'button', 300, 100);
    expect(btn2.label).toBe('btn2');
  });

  it('toDesign 导出：按钮 = 1 位输入端口，数码管 = 7 位输出端口', () => {
    const doc = {
      ...EMPTY_DOC,
      syms: [
        createDeviceSym(EMPTY_DOC, 'button', 100, 100),
        createDeviceSym(EMPTY_DOC, 'segment', 200, 100),
      ],
    };
    const design = toDesign(doc);
    const btn = design.ports.find((p) => p.name === 'btn1');
    expect(btn?.dir).toBe('in');
    expect(btn?.width).toBe(1);
    const seg = design.ports.find((p) => p.name === 'seg1');
    expect(seg?.dir).toBe('out');
    expect(seg?.width).toBe(7);
  });

  it('docForLevel：s2-btn-latch 的 btn 端口 → 锁定按钮符号；s3-display2 的 seg1/seg2 端口 → 锁定 7 位数码管符号', () => {
    const btnDoc = docForLevel(findLevel('s2-btn-latch')!, []);
    const btn = btnDoc.syms.find((s) => s.label === 'btn');
    expect(btn?.kind).toBe('input');
    expect(btn?.button).toBe(true);
    expect(btn?.sprite).toBe('button');
    expect(btn?.locked).toBe(true);

    const dispDoc = docForLevel(findLevel('s3-display2')!, []);
    for (const name of ['seg1', 'seg2']) {
      const seg = dispDoc.syms.find((s) => s.label === name);
      expect(seg?.kind).toBe('output');
      expect(seg?.display).toBe('segment');
      expect(seg?.width).toBe(7);
      expect(seg?.locked).toBe(true);
    }
  });
});

describe('沙盒：放置按钮器件并点击（瞬时按键自动弹回）', () => {
  const canvas = (): HTMLCanvasElement => document.querySelector('canvas') as HTMLCanvasElement;
  /** 世界坐标 → client 坐标：用 App 当前相机（进关自适应后相机不是固定值了） */
  const screenOf = atWorld;
  afterEach(unstubCanvasSize);

  it('组件库放置 按钮 + 七段数码管 → 导出形态正确；按住 = 1、松开 = 0', {
    timeout: 30_000,
  }, async () => {
    stubCanvasSize(1280, 754); // jsdom 兜底只有 200×200：给个真实画布尺寸，世界坐标才落在画布内
    renderApp();
    // 主菜单 → 自由搭建（沙盒不锁器件）
    fireEvent.click(screen.getByText('自由搭建'));

    // 从组件库点「按钮」，再在画布 (100,100) 落点
    fireEvent.click(screen.getByText('按钮').closest('button') as HTMLButtonElement);
    fireEvent.mouseDown(canvas(), { button: 0, ...screenOf(100, 100) });

    // 从组件库点「七段数码管」，在画布 (300,100) 落点
    fireEvent.click(screen.getByText('七段数码管').closest('button') as HTMLButtonElement);
    fireEvent.mouseDown(canvas(), { button: 0, ...screenOf(300, 100) });

    // 导出形态断言（存档 400ms 防抖，waitFor 等落盘）
    await waitFor(
      () => {
        const doc = readFreeDoc();
        const btn = doc.syms.find((s) => s.label === 'btn1');
        const seg = doc.syms.find((s) => s.label === 'seg1');
        expect(btn?.kind).toBe('input');
        expect(btn?.button).toBe(true);
        expect(btn?.sprite).toBe('button');
        expect(btn?.value).toBe(0);
        expect(seg?.kind).toBe('output');
        expect(seg?.display).toBe('segment');
        expect(seg?.width).toBe(7);
      },
      { timeout: 5000 },
    );

    // 按住按钮 → 电平 1（按下期间保持；按住 = 1、松开 = 0，无自动弹回定时器，
    // 存档 400ms 防抖一定能捕获到稳定的 1 态——不存在旧版「弹回 vs 存档」竞态）
    fireEvent.mouseDown(canvas(), { button: 0, ...screenOf(100, 100) });
    await waitFor(
      () => {
        const btn = readFreeDoc().syms.find((s) => s.label === 'btn1') as { value?: number };
        expect(btn?.value).toBe(1);
      },
      { timeout: 5000 },
    );

    // 松开 → 归 0（瞬时按键）
    fireEvent.mouseUp(canvas());
    await waitFor(
      () => {
        const btn = readFreeDoc().syms.find((s) => s.label === 'btn1') as { value?: number };
        expect(btn?.value).toBe(0);
      },
      { timeout: 5000 },
    );
  });
});
