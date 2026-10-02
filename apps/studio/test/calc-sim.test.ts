/**
 * 计算器关的 GUI 仿真通道端到端测试：
 * 走 App 实际用的 handleRequest('simulate')（worker 同一条链路），验证：
 *  - 按钮端口两相驱动：组合链稳定后才出现 eq 上升沿，锁存正确结果；
 *  - prevSignals 状态保持：松开等号、改数据后寄存器保持上次锁存值。
 * 端口语义：calc 的 a/b 是 BCD（a: 0x23 = BCD 数字 23），disp_t/disp_u 是
 * 十位/个位（q[4..7]/q[0..3]）。
 */

import { ALL_LEVELS, teachingModulesFor, teachingSolutionOf } from '@lc/content';
import { describe, expect, it } from 'vitest';
import { docForLevel } from '../src/level/progress';
import { handleRequest } from '../src/sim/handle';
import type { DriveValue } from '../src/sim/protocol';
import { fromDesign, inputValues, toDesign } from '../src/editor/model';

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
  contrib: Array<[string, number[]]>;
}

interface PrevState {
  signals: Record<string, number>;
  contribs: Record<string, number[]>;
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

/** 连续 GUI 仿真：带 prevSignals + prevContribs（状态与贡献保持）与 buttonPorts（两相） */
function guiSim(a: number, b: number, eq: 0 | 1, prev: PrevState | undefined) {
  const resp = handleRequest({
    id: 1,
    type: 'simulate',
    design,
    library: [],
    mode: 'timing',
    inputs: bcdInputs(a, b, eq),
    buttonPorts: ['eq'],
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

describe('计算器关 GUI 仿真通道（按钮 + 状态保持）', () => {
  it('设 23+5 按等号显示 28，松开保持；换 50+19 再按锁存 69', { timeout: 60_000 }, () => {
    let prev: PrevState | undefined;
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

  it('0+0 按等号显示 00', { timeout: 60_000 }, () => {
    let prev: PrevState | undefined;
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
    expect(dt?.width).toBe(7);
    expect(du?.width).toBe(7);
  });
});

describe('s3-display：点击 bcd 输入走 0-9，seg 数码管显示对应段码（7 位按位）', () => {
  // 回归：多 bit 输入端口点击 = 驱动值 +1，且按位展开到各 lane（修复前 bcd 只能 0x0/0xF，
  // 0xF 的译码输出恰好与「9」同形，导致玩家看到"显示 9 后不变"）。
  it('一键出答案后，value 0-9 → seg 段码 0x3F..0x6F', () => {
    const ON = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
    const lv = ALL_LEVELS.find((l) => l.id === 's3-display')!;
    const stored = teachingModulesFor('rtl').map((m) => ({
      hash: m.hash,
      name: m.name,
      version: m.version,
      stage: m.stage,
      costHalf: m.costHalf,
      isSequential: m.isSequential,
      ports: m.ports,
      template: m,
      sources: [],
      createdAt: 0,
    }));
    let doc = fromDesign(teachingSolutionOf('s3-display', 'rtl')!, docForLevel(lv, stored));
    for (let v = 0; v < 10; v++) {
      // 模拟点击：驱动值 +1（与 App 的 stepInput 语义一致）
      doc = {
        ...doc,
        syms: doc.syms.map((s) => (s.kind === 'input' ? { ...s, value: v } : s)),
      };
      const design = toDesign(doc);
      const resp = handleRequest({
        id: 1,
        type: 'simulate',
        design,
        library: doc.library.map((m) => m.template),
        mode: 'logic',
        inputs: inputValues(doc),
        buttonPorts: [],
      });
      expect(resp.error).toBeUndefined();
      const sig = Object.fromEntries(resp.snapshot.netSignals as [string, number][]);
      const segNets = design.ports.find((p) => p.name === 'seg')!.nets;
      let seg = 0;
      segNets.forEach((n, i) => {
        if ((sig[n] & 0x03) === 1) seg |= 1 << i;
      });
      expect(seg, `bcd=${v} 应显示段码 ${ON[v].toString(16)}`).toBe(ON[v]);
    }
  });
});
