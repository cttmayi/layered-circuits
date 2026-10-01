/**
 * 计算器关的 GUI 仿真通道端到端测试：
 * 走 App 实际用的 handleRequest('simulate')（worker 同一条链路），验证：
 *  - 按钮端口两相驱动：组合链稳定后才出现 eq 上升沿，锁存正确结果；
 *  - prevSignals 状态保持：松开等号、改数据后寄存器保持上次锁存值。
 * 端口语义：calc 的 a/b 是 BCD（a: 0x23 = BCD 数字 23），disp_t/disp_u 是
 * 十位/个位（q[4..7]/q[0..3]）。
 */

import { ALL_LEVELS } from '@lc/content';
import { describe, expect, it } from 'vitest';
import { docForLevel } from '../src/level/progress';
import { handleRequest } from '../src/sim/handle';
import type { DriveValue } from '../src/sim/protocol';

const level = ALL_LEVELS.find((l) => l.id === 's3-calc')!;
const design = level.referenceSolution!;

/** BCD 数字 → 8 位输入位图（a[0..7]） */
function bcdInputs(a: number, b: number, eq: 0 | 1): Record<string, DriveValue> {
  const v: Record<string, DriveValue> = { eq };
  for (let i = 0; i < 8; i++) {
    v[`a[${i}]`] = ((a >> i) & 1) as DriveValue;
    v[`b[${i}]`] = ((b >> i) & 1) as DriveValue;
  }
  return v;
}

interface SnapshotLike {
  netSignals: Array<[string, number]>;
}

/** 从仿真快照读十位/个位（q 寄存器即 disp_t/disp_u 的网） */
function readDisp(snap: SnapshotLike): number {
  const sig = (label: string): number => {
    const hit = snap.netSignals.find(([k]) => k === label);
    return hit ? hit[1] : -1;
  };
  const bus = (start: number): number => {
    let v = 0;
    for (let i = 0; i < 4; i++) if ((sig(`q${start + i}`) & 0x03) === 1) v |= 1 << i;
    return v;
  };
  return bus(4) * 10 + bus(0);
}

/** 连续 GUI 仿真：带 prevSignals（状态保持）与 buttonPorts（两相） */
function guiSim(a: number, b: number, eq: 0 | 1, prev: Record<string, number> | undefined) {
  const resp = handleRequest({
    id: 1,
    type: 'simulate',
    design,
    library: [],
    mode: 'timing',
    inputs: bcdInputs(a, b, eq),
    buttonPorts: ['eq'],
    prevSignals: prev,
  });
  expect(resp.error).toBeUndefined();
  const snap = resp.snapshot as SnapshotLike;
  return { snap, next: Object.fromEntries(snap.netSignals) };
}

describe('计算器关 GUI 仿真通道（按钮 + 状态保持）', () => {
  it('设 23+5 按等号显示 28，松开保持；换 50+19 再按锁存 69', () => {
    let prev: Record<string, number> | undefined;
    // 上电/设数（未锁存，显示上电态即可）
    ({ next: prev } = guiSim(0x23, 0x05, 0, prev));
    // 按等号（两相）：23+5=28
    let r = guiSim(0x23, 0x05, 1, prev);
    expect(readDisp(r.snap)).toBe(28);
    prev = r.next;
    // 松开等号：28 保持（prevSignals 状态续传）
    r = guiSim(0x23, 0x05, 0, prev);
    expect(readDisp(r.snap)).toBe(28);
    prev = r.next;
    // 换 50+19（BCD）并按下等号：50+19=69
    r = guiSim(0x50, 0x19, 1, prev);
    expect(readDisp(r.snap)).toBe(69);
    prev = r.next;
    // 松开：69 保持
    r = guiSim(0x50, 0x19, 0, prev);
    expect(readDisp(r.snap)).toBe(69);
  });

  it('0+0 按等号显示 00', () => {
    let prev: Record<string, number> | undefined;
    ({ next: prev } = guiSim(0, 0, 0, prev));
    const r = guiSim(0, 0, 1, prev);
    expect(readDisp(r.snap)).toBe(0);
  });

  it('关卡端口在画布上的形态：eq 是按钮、disp_t/disp_u 是数码管', () => {
    const doc = docForLevel(level, []);
    const eq = doc.syms.find((s) => s.kind === 'input' && s.label === 'eq');
    expect(eq?.button).toBe(true);
    expect(eq?.sprite).toBe('button');
    const dt = doc.syms.find((s) => s.kind === 'output' && s.label === 'disp_t');
    const du = doc.syms.find((s) => s.kind === 'output' && s.label === 'disp_u');
    expect(dt?.display).toBe('segment');
    expect(du?.display).toBe('segment');
    expect(dt?.width).toBe(4);
    expect(du?.width).toBe(4);
  });
});
