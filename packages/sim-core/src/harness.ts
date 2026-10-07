/**
 * 关卡判定 / 真值表测试夹具。
 *
 * 关卡断言的最小闭环：给定一组激励向量，跑完仿真后采样输出端口，与期望逻辑比对。
 * 逻辑模式一次收敛；时序模式施加激励后推进 settlePs 再采样（M2 会在此基础上加波形时序断言）。
 */

import { GATE_MAX_EVENTS, SETTLE_PS_DEFAULT } from './bounds.js';
import type { Diagnostic } from './engine.js';
import { type SimMode, Simulator } from './engine.js';
import type { FlatNet } from './ir.js';
import type { Logic } from './signal.js';
import { toWaveform, type Waveform } from './waveform.js';

export interface TestVector {
  /** 端口名 → 逻辑值；未列出的输入保持上一次的值（便于测时序保持） */
  inputs: Record<string, Logic>;
  /** 期望输出；缺省表示本向量只做激励不判定 */
  expect?: Record<string, Logic>;
  /** 时序模式：施加激励后等待多久采样（ps）。默认取 defaultSettlePs */
  settlePs?: number;
  note?: string;
}

export interface VectorMismatch {
  port: string;
  expected: Logic;
  actual: Logic;
}

export interface VectorRow {
  index: number;
  note?: string;
  inputs: Record<string, Logic>;
  expected: Record<string, Logic>;
  actual: Record<string, Logic>;
  mismatches: VectorMismatch[];
  ok: boolean;
  timePs: number;
  /**
   * 本向量的时间窗口（ps）：时序模式下从「上一次采样」到「本次采样」，
   * 逻辑模式下恒为 [0, 0]（无延迟，谈不上窗口）。
   * 竞争冒险检查就是数这个窗口里输出跳变了几次。
   */
  window: { fromPs: number; toPs: number };
}

export interface VectorRunResult {
  pass: boolean;
  rows: VectorRow[];
  diagnostics: Diagnostic[];
  /** 逻辑模式下是否出现未收敛（组合环/振荡） */
  unstable: boolean;
  /** trace: true 时的波形（每个网络一条阶梯曲线） */
  waveform?: Waveform;
}

export interface RunVectorsOptions {
  mode: SimMode;
  trace?: boolean;
  /** trace 时只保留端口网络（UI 波形只要端口；内部节点成千上万时别全带上） */
  tracePortsOnly?: boolean;
  /** 时序模式默认采样等待时间（ps），默认 100ns */
  defaultSettlePs?: number;
  maxIterations?: number;
  /** 时序模式每个向量的事件预算，超出即判定「未稳定」（防止振荡电路卡死） */
  maxEventsPerVector?: number;
}

/** 跑一组向量，返回逐行结果（含诊断，供 UI 直接展示） */
export function runVectors(
  net: FlatNet,
  vectors: readonly TestVector[],
  options: RunVectorsOptions,
): VectorRunResult {
  const sim = new Simulator(net, {
    mode: options.mode,
    trace: options.trace ?? false,
    ...(options.maxIterations !== undefined ? { maxIterations: options.maxIterations } : {}),
  });

  // 默认值来自 bounds.ts（与画布/门级引擎同源，别在这里写死数字）
  const defaultSettlePs = options.defaultSettlePs ?? SETTLE_PS_DEFAULT;
  const maxEventsPerVector = options.maxEventsPerVector ?? GATE_MAX_EVENTS;
  const rows: VectorRow[] = [];
  let unstable = false;
  let pass = true;
  // 时序模式自己维护逻辑时钟：sim.time 反映「最后一次事件」的时刻，不能用它累加
  let clockPs = 0;

  for (let i = 0; i < vectors.length; i++) {
    const vector = vectors[i] as TestVector;
    const fromPs = clockPs;
    if (options.mode === 'timing') {
      // 激励在窗口起点精确生效 → 波形窗口/建立保持时间测量才有意义
      for (const [port, value] of Object.entries(vector.inputs))
        sim.setInputAt(port, value, fromPs);
      clockPs += vector.settlePs ?? defaultSettlePs;
      if (!sim.advanceTo(clockPs, maxEventsPerVector)) unstable = true;
    } else {
      for (const [port, value] of Object.entries(vector.inputs)) sim.setInput(port, value);
      if (!sim.settle()) unstable = true;
    }

    const actual = sim.readAllOutputs();
    const expected = vector.expect ?? {};
    const mismatches: VectorMismatch[] = [];
    for (const [port, want] of Object.entries(expected)) {
      const got = actual[port];
      if (got !== want) mismatches.push({ port, expected: want, actual: got ?? 'Z' });
    }
    const ok = mismatches.length === 0;
    if (!ok) pass = false;

    const row: VectorRow = {
      index: i,
      inputs: { ...vector.inputs },
      expected: { ...expected },
      actual,
      mismatches,
      ok,
      timePs: sim.time,
      window: options.mode === 'timing' ? { fromPs, toPs: clockPs } : { fromPs: 0, toPs: 0 },
    };
    if (vector.note !== undefined) row.note = vector.note;
    rows.push(row);
  }

  const diagnostics = [...sim.allDiagnostics];
  if (diagnostics.some((d) => d.kind === 'unstable')) unstable = true;

  const result: VectorRunResult = { pass, rows, diagnostics, unstable };
  // 缺省带上全部网络（排查用）；关卡判定只要端口，避免把上千个内部节点传到前端
  if (options.trace && sim.trace) {
    result.waveform = toWaveform(sim.trace, net, options.tracePortsOnly ? { portOnly: true } : {});
  }
  return result;
}

/** 穷举 n 位输入的全部组合，方便生成真值表向量 */
export function allInputCombinations(ports: readonly string[]): Array<Record<string, Logic>> {
  const out: Array<Record<string, Logic>> = [];
  const total = 1 << ports.length;
  for (let mask = 0; mask < total; mask++) {
    const combo: Record<string, Logic> = {};
    for (let b = 0; b < ports.length; b++) {
      combo[ports[b] as string] = ((mask >> (ports.length - 1 - b)) & 1) as 0 | 1;
    }
    out.push(combo);
  }
  return out;
}

/** 便捷函数：单次逻辑模式仿真，返回输出端口逻辑值 */
export function evaluateOnce(
  net: FlatNet,
  inputs: Record<string, Logic>,
  options: Partial<RunVectorsOptions> = {},
): Record<string, Logic> {
  const result = runVectors(net, [{ inputs }], {
    mode: options.mode ?? 'logic',
    ...(options.trace !== undefined ? { trace: options.trace } : {}),
    ...(options.defaultSettlePs !== undefined ? { defaultSettlePs: options.defaultSettlePs } : {}),
    ...(options.maxIterations !== undefined ? { maxIterations: options.maxIterations } : {}),
  });
  return (result.rows[0] as VectorRow).actual;
}
