/**
 * 计算器关的 GUI 仿真通道端到端测试：
 * 走 App 实际用的 handleRequest('simulate')（worker 同一条链路），验证：
 *  - 按钮端口两相驱动：组合链稳定后才出现按键上升沿，锁存正确结果；
 *  - prevSignals 状态保持：松开按键、改数据后寄存器保持上次锁存值。
 * 端口语义：calc 是 13 键数字键盘（d0-d9、plus、minus、eq、c）→ 两位段码
 * disp_t/disp_u（7 位 BCD→段码，0x3F..0x6F，负数显示 EE=0x79）。
 */

import { ALL_LEVELS } from '@lc/content';
import { describe, expect, it } from 'vitest';
import { docForLevel } from '../src/level/progress';
import { handleRequest } from '../src/sim/handle';
import type { DriveValue } from '../src/sim/protocol';

const level = ALL_LEVELS.find((l) => l.id === 's3-calc')!;
const design = level.referenceSolution!;
const ALL_KEYS = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'plus', 'minus', 'eq', 'c'];

/** 段码 → 数字字符（0x79 = E 错误标志） */
const SEG_DIGIT: Record<number, string> = {
  0x3f: '0', 0x06: '1', 0x5b: '2', 0x4f: '3', 0x66: '4',
  0x6d: '5', 0x7d: '6', 0x07: '7', 0x7f: '8', 0x6f: '9', 0x79: 'E',
};

/** 单键驱动：全部键 0，只有目标键按下 */
function keyInputs(key: string, pressed: 0 | 1): Record<string, DriveValue> {
  const v: Record<string, DriveValue> = {};
  for (const k of ALL_KEYS) v[k] = 0;
  v[key] = pressed;
  return v;
}

interface SnapshotLike {
  netSignals: Array<[string, number]>;
  contrib: Array<[string, number[]]>;
}

interface PrevState {
  signals: Record<string, number>;
  contribs: Record<string, number[]>;
}

/** 从仿真快照读两位显示（disp_t/disp_u 的段码网 segT0-6 / segU0-6） */
function readDisp(snap: SnapshotLike): string {
  const sig = (label: string): number => {
    const hit = snap.netSignals.find(([k]) => k === label);
    return hit ? hit[1] : -1;
  };
  const seg = (prefix: string): string => {
    let byte = 0;
    for (let i = 0; i < 7; i++) {
      if ((sig(`${prefix}${i}`) & 0x03) === 1) byte |= 1 << i;
    }
    return SEG_DIGIT[byte] ?? '?';
  };
  return seg('segT') + seg('segU');
}

/** 连续 GUI 仿真：带 prevSignals + prevContribs（状态与贡献保持）与 buttonPorts（两相） */
function guiSim(key: string, pressed: 0 | 1, prev: PrevState | undefined) {
  const resp = handleRequest({
    id: 1,
    type: 'simulate',
    design,
    library: [],
    mode: 'timing',
    inputs: keyInputs(key, pressed),
    buttonPorts: [key],
    prevSignals: prev?.signals,
    prevContribs: prev?.contribs,
  });
  expect(resp.error).toBeUndefined();
  const snap = resp.snapshot as SnapshotLike;
  return {
    snap,
    next: {
      signals: Object.fromEntries(snap.netSignals),
      contribs: Object.fromEntries(snap.contrib),
    },
  };
}

/** 完整按键序列（按下 + 松开），返回每键按下后的显示 */
function keySeq(seq: string[], prev?: PrevState): { shows: string[]; prev: PrevState } {
  let p = prev;
  const shows: string[] = [];
  for (const k of seq) {
    const r1 = guiSim(k, 1, p);
    shows.push(readDisp(r1.snap));
    p = r1.next;
    const r0 = guiSim(k, 0, p);
    p = r0.next;
  }
  return { shows, prev: p! };
}

describe('计算器关 GUI 仿真通道（按钮 + 状态保持）', () => {
  it('12+5= 显示 17，松开保持；C 清屏后 5-8= 显示 EE', { timeout: 120_000 }, () => {
    // 12+5=17
    let { shows, prev } = keySeq(['c', 'd1', 'd2', 'plus', 'd5', 'eq']);
    expect(shows[0]).toBe('00'); // C 清屏
    expect(shows[1]).toBe('01'); // 1
    expect(shows[2]).toBe('12'); // 12
    expect(shows[3]).toBe('12'); // +
    expect(shows[4]).toBe('05'); // 5
    expect(shows[5]).toBe('17'); // = 12+5=17
    // 松开 = 后状态保持（prevSignals 续传），显示仍是 17
    const held = guiSim('eq', 0, prev);
    expect(readDisp(held.snap)).toBe('17');
    prev = held.next;
    // C 清屏 → 5-8= → EE（负数错误标志）
    ({ shows, prev } = keySeq(['c', 'd5', 'minus', 'd8', 'eq'], prev));
    expect(shows[0]).toBe('00');
    expect(shows[1]).toBe('05');
    expect(shows[3]).toBe('08');
    expect(shows[4]).toBe('EE');
  });

  it('0+7= 显示 07', { timeout: 60_000 }, () => {
    const { shows } = keySeq(['c', 'd0', 'plus', 'd7', 'eq']);
    expect(shows[0]).toBe('00');
    expect(shows[1]).toBe('00'); // 0
    expect(shows[3]).toBe('07');
    expect(shows[4]).toBe('07');
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
    expect(dt?.width).toBe(7);
    expect(du?.width).toBe(7);
  });
});
