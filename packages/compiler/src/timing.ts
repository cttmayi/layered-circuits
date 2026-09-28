/**
 * 时序分析：给模块模板算出「端口延迟矩阵」与「是否时序电路」。
 *
 * M0 的实现选择（相对 Tech-Plan 的原始方案做了修订，原因记录在此）：
 * 不用图论 STA，而是**用同一套时序仿真去实测最长传播延迟**：
 *   对每个输入端口，分别做 0→1 / 1→0 两种翻转，测「输出引脚最后一次变化的时刻 − 翻转时刻」，
 *   取所有输入、所有输出的最大值作为关键路径延迟。
 * 原因：开关级模型里电阻/三极管/二极管都是双向通路，图论最长路会产生大量伪环
 * （VCC—电阻—输出 会把节点合并成团），反而得出「组合电路是时序电路」「延迟为 0」这类错误结论；
 * 实测法的结果与硬核模式仿真完全一致（玩家在面板上看到的延迟就是仿真器真的延迟）。
 * 代价：I 个输入 × 2 次仿真，只在封装那一刻算一次并缓存进模板。
 * 模块规模极大（M4+ 的整机）时可以再用「模板黑盒 + 图论 STA」做增量优化。
 *
 * 「是否时序电路」同样用行为判定：同一组激励在不同历史下输出不同 = 有记忆 = 时序电路。
 */

import type { FlatNet, Logic } from '@lc/sim-core';
import { Simulator } from '@lc/sim-core';

export interface TimingAnalysisOptions {
  /** 输入翻转后的观察窗口（ps），默认 1ms */
  windowPs?: number;
  /** 稳态等待窗口（ps），默认 1ms */
  steadyPs?: number;
  /** 单次仿真的最大事件数（硬上限） */
  maxEvents?: number;
  /** 单次推进的事件预算：超出即判定「未稳定」，用来给振荡电路快速兜底 */
  eventBudget?: number;
  /** 状态依赖探测的向量对数 */
  stateProbePairs?: number;
}

export interface TimingAnalysis {
  /** 输出端口名 → 最长传播延迟（ps） */
  portDelayPs: Record<string, number>;
  /** 关键路径延迟（ps） */
  criticalPathPs: number;
  /** 是否含记忆（时序电路） */
  isSequential: boolean;
  /** 仿真中出现了 X / 悬空 / 振荡，结果仅供参考 */
  uncertain: boolean;
  diagnostics: string[];
}

const DEFAULT_WINDOW_PS = 1_000_000_000;
const DEFAULT_STEADY_PS = 1_000_000_000;
/** 单次推进的事件预算：正常电路几十~几千个事件就稳定了；振荡电路会很快撞上这个上限 */
const DEFAULT_EVENT_BUDGET = 20_000;

function sameVector(a: Record<string, Logic>, b: Record<string, Logic>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

export function analyzeTiming(net: FlatNet, options: TimingAnalysisOptions = {}): TimingAnalysis {
  const windowPs = options.windowPs ?? DEFAULT_WINDOW_PS;
  const steadyPs = options.steadyPs ?? DEFAULT_STEADY_PS;
  const maxEvents = options.maxEvents ?? 2_000_000;
  // 预算随电路规模自适应：正常电路会自然排空队列，只有振荡电路才会撞上限
  const eventBudget = options.eventBudget ?? Math.max(DEFAULT_EVENT_BUDGET, 200 * net.elemCount);
  const pairs = options.stateProbePairs ?? 12;

  const inputs = net.ports.filter((p) => p.dir === 'in');
  const outputs = net.ports.filter((p) => p.dir === 'out');
  const diagnostics: string[] = [];
  const portDelayPs: Record<string, number> = {};
  for (const o of outputs) portDelayPs[o.name] = 0;
  let uncertain = false;

  const newSim = (): Simulator => new Simulator(net, { mode: 'timing', trace: true, maxEvents });

  const driveAll = (sim: Simulator, level: Logic): void => {
    for (const p of inputs) sim.setInput(p.name, level);
  };

  // ---- 1) 传播延迟 ----
  for (const input of inputs) {
    for (const [initial, flipped] of [
      [0, 1],
      [1, 0],
    ] as Array<[Logic, Logic]>) {
      const sim = newSim();
      driveAll(sim, initial);
      if (!sim.advanceTo(steadyPs, eventBudget)) {
        uncertain = true;
        continue;
      }
      const t0 = sim.time;
      sim.setInput(input.name, flipped);
      if (!sim.advanceTo(t0 + windowPs, eventBudget)) uncertain = true;

      const trace = sim.trace;
      if (!trace) continue;
      const lastChange = new Map<number, number>();
      for (let i = 0; i < trace.times.length; i++) {
        lastChange.set(trace.nodes[i] as number, trace.times[i] as number);
      }
      for (const out of outputs) {
        const t = lastChange.get(out.node);
        if (t === undefined || t <= t0) continue;
        const delay = t - t0;
        if (delay > (portDelayPs[out.name] as number)) portDelayPs[out.name] = delay;
        if (delay > windowPs) uncertain = true;
      }
      if (sim.allDiagnostics.some((d) => d.kind === 'unstable' || d.kind === 'drive-conflict')) {
        uncertain = true;
      }
    }
  }

  const criticalPathPs = outputs.reduce(
    (max, o) => Math.max(max, portDelayPs[o.name] as number),
    0,
  );

  // ---- 2) 时序电路判定（行为探测） ----
  // 判据：同一段历史之后的同一激励，输出是否不同。
  //   Run A：冷启动 → 预热向量 → v1 → v2，记 outA
  //   Run B：冷启动 → 预热向量 → v2，记 outB
  //   若 outA ≠ outB ⇒ 电路记住了 v1 ⇒ 时序电路。
  // 「预热向量」是第一个能稳定下来的探测向量：像 SR 锁存器这种
  // 冷启动即处于非法态（Q=Qn=1）的电路，直接施加保持向量会因对称延迟产生竞争而不收敛，
  // 必须先进入稳定态再比较历史。
  let isSequential = false;
  if (inputs.length > 0 && outputs.length > 0) {
    const allLow: Record<string, Logic> = {};
    const allHigh: Record<string, Logic> = {};
    const altA: Record<string, Logic> = {};
    const altB: Record<string, Logic> = {};
    inputs.forEach((p, i) => {
      allLow[p.name] = 0;
      allHigh[p.name] = 1;
      altA[p.name] = (i % 2) as 0 | 1;
      altB[p.name] = ((i + 1) % 2) as 0 | 1;
    });
    const vectors: Array<Record<string, Logic>> = [allLow, allHigh, altA, altB];
    for (const p of inputs.slice(0, 4)) vectors.push({ ...allLow, [p.name]: 1 as Logic });

    /** 施加一个向量并推进到稳定；不收敛返回 null */
    const applyTo = (sim: Simulator, v: Record<string, Logic>): string | null => {
      for (const [port, value] of Object.entries(v)) sim.setInput(port, value);
      if (!sim.advanceTo(sim.time + steadyPs, eventBudget)) {
        uncertain = true;
        return null;
      }
      return JSON.stringify(sim.readAllOutputs());
    };

    // 预热向量：像 SR 锁存器这种「冷启动即处于非法态」的电路，直接施加保持向量
    // 会因对称延迟产生竞争而不收敛；必须先进入稳定态再比较历史。
    // 因此对每个能稳定的向量都做一遍探测，任意一次发现历史依赖即可判定。
    const probeBudget = pairs * 4;
    let probesDone = 0;
    outer: for (const prime of vectors) {
      if (probesDone >= probeBudget) break;
      const simPrime = newSim();
      if (applyTo(simPrime, prime) === null) continue;

      for (let i = 0; i < vectors.length; i++) {
        for (let j = 0; j < vectors.length; j++) {
          if (i === j || probesDone >= probeBudget) continue;
          const v1 = vectors[i] as Record<string, Logic>;
          const v2 = vectors[j] as Record<string, Logic>;
          if (sameVector(v1, v2)) continue;
          probesDone++;

          const simA = newSim();
          if (applyTo(simA, prime) === null) continue;
          if (applyTo(simA, v1) === null) continue;
          const outA = applyTo(simA, v2);
          if (outA === null) continue;

          const simB = newSim();
          if (applyTo(simB, prime) === null) continue;
          const outB = applyTo(simB, v2);
          if (outB === null) continue;

          if (outA !== outB) {
            isSequential = true;
            break outer;
          }
        }
      }
    }
  } else if (outputs.length > 0 && inputs.length === 0) {
    isSequential = true;
  }

  return { portDelayPs, criticalPathPs, isSequential, uncertain, diagnostics };
}

/** 由关键路径延迟推算「最高可用时钟频率」（Hz）；含建立/保持余量时 M2 再细化 */
export function maxClockHz(criticalPathPs: number, safetyFactor = 1.0): number {
  if (criticalPathPs <= 0) return Number.POSITIVE_INFINITY;
  return 1e12 / (criticalPathPs * safetyFactor);
}
