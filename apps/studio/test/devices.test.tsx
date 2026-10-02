// @vitest-environment jsdom
/**
 * 按钮 / 七段数码管器件：
 *  - 模型层：createDeviceSym 生成带交互/显示形态的端口符号；toDesign 导出为普通端口；
 *  - 关卡层：docForLevel 把声明的 button/display 端口变成按钮/数码管符号（锁定）；
 *  - 交互层：沙盒里从组件库放置按钮 → 点击 = 电平 1 → 400ms 自动弹回 0。
 */

import { findLevel } from '@lc/content';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeviceSym, EMPTY_DOC, toDesign } from '../src/editor/model';
import { docForLevel } from '../src/level/progress';
import { FREE_STORAGE_KEY } from '../src/level/session';
import { renderApp } from './helpers';

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

  it('docForLevel：s2-btn-latch 的 btn 端口 → 锁定按钮符号；s3-display 的 seg 端口 → 锁定 7 位数码管符号', () => {
    const btnDoc = docForLevel(findLevel('s2-btn-latch')!, []);
    const btn = btnDoc.syms.find((s) => s.label === 'btn');
    expect(btn?.kind).toBe('input');
    expect(btn?.button).toBe(true);
    expect(btn?.sprite).toBe('button');
    expect(btn?.locked).toBe(true);

    const dispDoc = docForLevel(findLevel('s3-display')!, []);
    const seg = dispDoc.syms.find((s) => s.label === 'seg');
    expect(seg?.kind).toBe('output');
    expect(seg?.display).toBe('segment');
    expect(seg?.width).toBe(7);
    expect(seg?.locked).toBe(true);
  });
});

describe('沙盒：放置按钮器件并点击（瞬时按键自动弹回）', () => {
  // jsdom 里容器尺寸量不到，工作台会退回 200×200；相机初始为 (340,220)、缩放 1
  const CAMERA = { x: 340, y: 220 };
  const SIZE = 200;
  const canvas = (): HTMLCanvasElement => document.querySelector('canvas') as HTMLCanvasElement;
  const screenOf = (wx: number, wy: number): { clientX: number; clientY: number } => ({
    clientX: wx - CAMERA.x + SIZE / 2,
    clientY: wy - CAMERA.y + SIZE / 2,
  });

  it('组件库放置 按钮 + 七段数码管 → 导出形态正确；点击按钮 = 1 并 400ms 自动弹回 0', async () => {
    renderApp();
    // 主菜单 → 自由搭建（沙盒不锁器件）
    fireEvent.click(screen.getByText('自由搭建'));

    // 从组件库点「按钮」，再在画布 (100,100) 落点
    fireEvent.click(screen.getByText('按钮').closest('button') as HTMLButtonElement);
    fireEvent.mouseDown(canvas(), { button: 0, ...screenOf(100, 100) });

    // 从组件库点「七段数码管」，在画布 (300,100) 落点
    fireEvent.click(screen.getByText('七段数码管').closest('button') as HTMLButtonElement);
    fireEvent.mouseDown(canvas(), { button: 0, ...screenOf(300, 100) });

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

    // 点击按钮本体 → 电平 1（按下）
    fireEvent.mouseDown(canvas(), { button: 0, ...screenOf(100, 100) });
    await waitFor(
      () => {
        const btn = readFreeDoc().syms.find((s) => s.label === 'btn1') as { value?: number };
        expect(btn?.value).toBe(1);
      },
      { timeout: 5000 },
    );

    // 400ms 后自动弹回 0（瞬时按键）
    await waitFor(
      () => {
        const btn = readFreeDoc().syms.find((s) => s.label === 'btn1') as { value?: number };
        expect(btn?.value).toBe(0);
      },
      { timeout: 3000 },
    );
  });
});
