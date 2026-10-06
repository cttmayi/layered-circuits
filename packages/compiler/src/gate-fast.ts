/**
 * 逻辑版门级快路：把关卡的测试向量跑在**门级引擎**上（7 个基础门当原子、无延迟、无强弱），
 * 产出与 runVectors 同形的结果，供 judgeDesign 直接使用。
 *
 * 安全第一：**任何不满足条件的情况一律返回 null**，judge 静默回落到原来的元件级引擎。
 * 返回 null 的情形：
 *   - 顶层出现元件（unit）—— 门级快路只处理纯模块设计；
 *   - 某个模块在库里查不到；
 *   - 时序模块没被声明 SeqSpec（不知道哪个端口是时钟/数据）—— 宁可不快，不能算错。
 *
 * 注意：SeqSpec 表由**调用方传入**（apps/studio 里同时引 @lc/content 与 @lc/compiler），
 * 这样 packages/compiler 不必依赖 @lc/content（后者已经依赖前者，反向引会成环）。
 */
import type { Design, ModuleLibrary } from '@lc/schema';
import {
  type Bit,
  type GateSeqSpec,
  GateStateStore,
  type Logic,
  settleGateSteps,
  type TestVector,
  type VectorMismatch,
  type VectorRow,
} from '@lc/sim-core';

export interface GateFastResult {
  pass: boolean;
  /** 门级没有延迟，也就没有波形（抖动/毛刺这类时序概念不适用）*/
  waveform?: undefined;
  rows: VectorRow[];
  diagnostics: never[];
  unstable: boolean;
}

const laneOf = (lane: string): { port: string; bit: number } => {
  const m = /^(.+)\[(\d+)\]$/.exec(lane);
  if (m?.[1] !== undefined && m[2] !== undefined) return { port: m[1], bit: Number(m[2]) };
  return { port: lane, bit: 0 };
};

/** 宽 1 的端口用裸名，宽 >1 用 `name[i]`（与 expandVectors 的口径一致）*/
const laneKey = (port: string, bit: number, width: number): string =>
  width > 1 ? `${port}[${bit}]` : port;

/**
 * 跑门级快路。不适用时返回 null（调用方回落），绝不做"部分正确"的近似。
 */
export const runGateVectors = (
  design: Design,
  library: ModuleLibrary,
  vectors: readonly TestVector[],
  widths: ReadonlyMap<string, number>,
  seqSpecs: Readonly<Record<string, GateSeqSpec>>,
): GateFastResult | null => {
  // ── 适用性：全部实例都得是能解析的模块，且时序模块都有 SeqSpec ──
  for (const inst of design.instances) {
    if (inst.kind === 'unit') return null;
    if (inst.kind !== 'module') continue;
    const mod = library.get(inst.module);
    if (!mod) return null;
    if (mod.isSequential && !seqSpecs[mod.name]) return null;
  }

  // ── 把真实库包成门级引擎要的最小接口（结构兼容，不改库）──
  const gateLib = {
    get: (hash: string) => {
      const m = library.get(hash);
      if (!m) return undefined;
      return {
        name: m.name,
        isSequential: m.isSequential,
        seq: seqSpecs[m.name],
        ports: m.ports.map((p) => ({ name: p.name, dir: p.dir, width: p.width })),
        body: m.body,
      };
    },
  };

  const widthOfPort = (port: string): number => widths.get(port) ?? 1;
  const state = new GateStateStore();
  const held = new Map<string, Bit[]>();
  const rows: VectorRow[] = [];
  let unstable = false;

  for (const [index, vector] of vectors.entries()) {
    // 未列出的输入**保持上一次的值**（与 runVectors 口径一致，便于测时序保持）
    for (const [lane, value] of Object.entries(vector.inputs)) {
      const { port, bit } = laneOf(lane);
      const w = widthOfPort(port);
      const bits = held.get(port) ?? Array.from({ length: w }, (): Bit => 'Z');
      bits[bit] = value as Bit;
      held.set(port, bits);
    }
    const inputs = new Map<string, Bit[]>();
    for (const [port, bits] of held) inputs.set(port, bits);

    const out = settleGateSteps(design, gateLib, inputs, state);
    if (!out.ok) return null; // 引擎说不支持就回落，不硬凑
    if (out.unstable === true) unstable = true;

    const actual: Record<string, Logic> = {};
    for (const [port, bits] of out.outPorts) {
      const w = widthOfPort(port);
      bits.forEach((b, i) => {
        actual[laneKey(port, i, w)] = String(b) as Logic;
      });
    }
    const expected: Record<string, Logic> = { ...(vector.expect ?? {}) };
    const mismatches: VectorMismatch[] = [];
    for (const [lane, exp] of Object.entries(expected)) {
      const got = actual[lane] ?? ('Z' as Logic);
      if (String(exp) !== String(got)) {
        mismatches.push({ port: lane, expected: exp, actual: got });
      }
    }
    const inputLanes: Record<string, Logic> = {};
    for (const [port, bits] of held) {
      const w = widthOfPort(port);
      bits.forEach((b, i) => {
        inputLanes[laneKey(port, i, w)] = String(b) as Logic;
      });
    }
    rows.push({
      index,
      ...(vector.note !== undefined ? { note: vector.note } : {}),
      inputs: inputLanes as unknown as VectorRow['inputs'],
      expected: expected as unknown as VectorRow['expected'],
      actual: actual as unknown as VectorRow['actual'],
      mismatches,
      ok: mismatches.length === 0,
      timePs: 0, // 逻辑版没有延迟，谈不上时间
      window: { fromPs: 0, toPs: 0 },
    });
  }

  return { pass: rows.every((r) => r.ok), rows, diagnostics: [], unstable };
};
