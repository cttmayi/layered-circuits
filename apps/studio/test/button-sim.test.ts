/**
 * 按钮端口在「逻辑模式」下的交互链路回归：
 * 曾把按钮端口一律强制 0（只给时序模式两相驱动），导致逻辑模式关卡（s2-btn-latch）
 * 与沙盒里放置的按钮「点了没反应」。修复：逻辑模式下按钮按目标值直接驱动。
 */

import { ALL_LEVELS } from '@lc/content';
import { describe, expect, it } from 'vitest';
import { handleRequest } from '../src/sim/handle';

const level = ALL_LEVELS.find((l) => l.id === 's2-btn-latch')!;
const design = level.referenceSolution!;

interface SnapLike {
  netSignals: Array<[string, number]>;
  contrib: Array<[string, number[]]>;
  portValues: Record<string, number | string>;
}

interface PrevState {
  signals: Record<string, number>;
  contribs: Record<string, number[]>;
}

/** 连续 GUI 仿真：带 prevSignals + prevContribs（锁存状态与贡献跨仿真保持）与 buttonPorts */
function btnSim(
  btn: 0 | 1,
  rst: 0 | 1,
  prev: PrevState | undefined,
): { snap: SnapLike; next: PrevState } {
  const resp = handleRequest({
    id: 1,
    type: 'simulate',
    design,
    library: [],
    mode: 'logic',
    inputs: { btn, rst },
    buttonPorts: ['btn'],
    prevSignals: prev?.signals,
    prevContribs: prev?.contribs,
  });
  expect(resp.error).toBeUndefined();
  const snap = resp.snapshot as SnapLike;
  return {
    snap,
    next: {
      signals: Object.fromEntries(snap.netSignals),
      contribs: Object.fromEntries(snap.contrib),
    },
  };
}

describe('按钮端口逻辑模式（s2-btn-latch 交互链路）', () => {
  it('rst 复位 → 按按钮 q=1（回归：曾强制按钮=0 没反应）→ 松开保持 1 → rst 清零', () => {
    // 初始：rst=1 强制复位到 0
    let { snap, next } = btnSim(0, 1, undefined);
    expect(snap.portValues['q']).toBe(0);

    // 按按钮（btn=1）：q 必须变 1 —— 修复前逻辑模式把按钮强制成 0，这里会是 0
    ({ snap, next } = btnSim(1, 0, next));
    expect(snap.portValues['q']).toBe(1);
    // 松开按钮（btn=0）：锁存保持 1（prevSignals 携带内部状态）
    ({ snap } = btnSim(0, 0, next));
    expect(snap.portValues['q']).toBe(1);

    // rst 清零
    ({ snap } = btnSim(0, 1, next));
    expect(snap.portValues['q']).toBe(0);
  });

  it('真实玩家序列：上电 → 按按钮置位 → 松开保持 → rst 复位 → 松开保持 0（回归：rst 松开后曾弹回 1）', () => {
    let { snap, next } = btnSim(0, 0, undefined);
    // 上电：锁存器状态不定（1 或 0 都合法），先按按钮强制置位
    void snap;
    ({ snap, next } = btnSim(1, 0, next));
    expect(snap.portValues['q']).toBe(1);
    // 松开按钮：保持 1
    ({ snap, next } = btnSim(0, 0, next));
    expect(snap.portValues['q']).toBe(1);
    // 按 rst：复位到 0
    ({ snap, next } = btnSim(0, 1, next));
    expect(snap.portValues['q']).toBe(0);
    // 松开 rst：保持 0（修复前会因上电态贡献残留弹回 1）
    ({ snap } = btnSim(0, 0, next));
    expect(snap.portValues['q']).toBe(0);
  });
});
