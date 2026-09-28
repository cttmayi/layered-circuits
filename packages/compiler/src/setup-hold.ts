/**
 * 建立/保持时间实测（M2 硬核模式的判据之一）。
 *
 * 做法：**不查数据手册，直接拿仿真扫**。给数据端口一个跳变，扫它相对时钟沿的位置，
 * 看输出还能不能正确锁存 —— 能锁存的最靠后的位置就是建立时间，最靠前的位置就是保持时间。
 *
 * 这种「实测」与硬核模式的其它数字（关键路径）同源：面板上看到的和判定用的是同一套东西。
 * 扫描是有限步长的，所以结果是最坏情况的上界（步长 100ps 时，误差不超过 100ps）。
 */

import type { FlatNet } from '@lc/sim-core';
import { type Logic, Simulator } from '@lc/sim-core';

export interface SetupHoldSpec {
  /** 时钟端口名 */
  clock: string;
  /** 数据端口名（单比特） */
  data: string;
  /** 被观察的输出端口名 */
  output: string;
  /** 其余输入端口固定成这些电平（缺省全 0） */
  tieInputs?: Record<string, Logic>;
  /** 时钟周期（ps） */
  clockPeriodPs: number;
  /** 扫描步长（ps），默认 500（分立三极管门的延迟就是 500ps 起步，再细没有意义） */
  stepPs?: number;
  /** 扫描上限（ps），默认半个时钟周期且不超过 100ns */
  maxScanPs?: number;
  /** 时钟沿之后留多少时间再采样 */
  capturePs?: number;
}

export interface SetupHoldResult {
  setupPs: number | null;
  holdPs: number | null;
  /** 基线检查：它是否表现得像「边沿触发」（时钟沿采样、高电平期间数据不影响输出） */
  edgeTriggered: boolean;
  notes: string[];
}

/** 上电稳定时间：时钟周期可能只有几十 ns，但电路自己收敛也需要时间 */
function warmupOf(periodPs: number): number {
  return Math.max(periodPs, 200_000);
}

/** 单次试验：在给定时刻安排数据跳变与时钟沿，返回采样到的输出逻辑 */
function trial(
  net: FlatNet,
  spec: SetupHoldSpec,
  options: { dataChangeAtPs: number; clockEdgeAtPs: number; dataFrom: 0 | 1; dataTo: 0 | 1 },
): Logic {
  const sim = new Simulator(net, { mode: 'timing' });
  const tie = spec.tieInputs ?? {};
  const period = spec.clockPeriodPs;
  // 采样等待要够长：太短会把「输出还没走完」误判成「锁存失败」
  const capture = spec.capturePs ?? Math.max(Math.floor(period / 2), 200_000);

  // 1) 先让电路安稳下来：时钟低、数据为初值
  for (const port of net.ports) {
    if (port.dir !== 'in') continue;
    if (port.name === spec.clock) continue;
    if (port.name === spec.data) continue;
    sim.setInputAt(port.name, tie[port.name] ?? 0, 0);
  }
  sim.setInputAt(spec.clock, 0, 0);
  sim.setInputAt(spec.data, options.dataFrom, 0);
  sim.advanceTo(warmupOf(period));

  // 2) 数据在指定时刻跳变（可能在时钟沿之前或之后）
  sim.setInputAt(spec.data, options.dataTo, Math.max(0, options.dataChangeAtPs));
  // 3) 时钟沿
  sim.setInputAt(spec.clock, 1, options.clockEdgeAtPs);
  // 4) 等锁存结果
  sim.advanceTo(options.clockEdgeAtPs + capture, 200_000);
  return sim.readPort(spec.output);
}

/**
 * 扫描测量建立/保持时间。
 *
 * 建立时间：数据必须在时钟沿**之前**多早稳定（越小越好，越小说明电路越快）。
 * 保持时间：时钟沿之后数据必须**再多保持**多久才允许变化（越小越好）。
 */
export function measureSetupHold(net: FlatNet, spec: SetupHoldSpec): SetupHoldResult {
  const notes: string[] = [];
  const period = spec.clockPeriodPs;
  const step = spec.stepPs ?? 500;
  const maxScan = spec.maxScanPs ?? Math.min(Math.floor(period / 2), 100_000);
  const warmupPs = warmupOf(period);
  const edgeAt = warmupPs; // 时钟沿放在上电之后的第一个时刻

  // ---- 基线：能锁存 0、能锁存 1、且时钟高电平期间数据变化不影响输出 ----
  const latch0 = trial(net, spec, {
    dataChangeAtPs: 0,
    clockEdgeAtPs: edgeAt,
    dataFrom: 0,
    dataTo: 0,
  });
  const latch1 = trial(net, spec, {
    dataChangeAtPs: 0,
    clockEdgeAtPs: edgeAt,
    dataFrom: 0,
    dataTo: 1,
  });
  const opaque = trial(net, spec, {
    // 时钟沿之后才改数据：边沿触发的电路不该被影响
    dataChangeAtPs: edgeAt + Math.floor(period / 4),
    clockEdgeAtPs: edgeAt,
    dataFrom: 1,
    dataTo: 0,
  });
  const edgeTriggered = latch0 === 0 && latch1 === 1 && opaque === 1;
  if (!edgeTriggered) {
    notes.push(
      latch0 !== 0 || latch1 !== 1
        ? '电路无法在时钟沿正确锁存数据，建立/保持时间无法测量'
        : '时钟高电平期间数据会串到输出（透明的，不是边沿触发），建立/保持时间无法测量',
    );
    return { setupPs: null, holdPs: null, edgeTriggered: false, notes };
  }

  // ---- 建立时间扫描：数据越来越晚地到达，第一次还能锁住的位置就是建立时间 ----
  let setupPs: number | null = null;
  for (let offset = 0; offset <= maxScan; offset += step) {
    const got = trial(net, spec, {
      dataChangeAtPs: edgeAt - offset,
      clockEdgeAtPs: edgeAt,
      dataFrom: 0,
      dataTo: 1,
    });
    if (got === 1) {
      setupPs = offset;
      break;
    }
  }
  if (setupPs === null)
    notes.push(`即使提前 ${(maxScan / 1000).toFixed(1)}ns 给数据也锁不住（电路太慢或时钟太快）`);

  // ---- 保持时间扫描：数据越来越早地在时钟沿之后变化，直到锁存被破坏 ----
  let holdPs: number | null = null;
  for (let offset = 0; offset <= maxScan; offset += step) {
    const got = trial(net, spec, {
      dataChangeAtPs: edgeAt + offset,
      clockEdgeAtPs: edgeAt,
      dataFrom: 0,
      dataTo: 1,
    });
    if (got === 0) {
      holdPs = offset;
      break;
    }
  }
  if (holdPs === null) notes.push('时钟沿后一直改变数据也锁不住旧值（电路可能有竞争/直通路径）');

  return { setupPs, holdPs, edgeTriggered, notes };
}
