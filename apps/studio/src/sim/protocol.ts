/**
 * 工作台 ↔ 仿真内核 的消息协议。
 * 同一份 handleRequest 既跑在 Web Worker 里，也跑在主线程回退路径上（见 runner.ts）。
 */

import type { JudgeResult } from '@lc/compiler';
import type { Design, Level, LogicFamily } from '@lc/schema';
import type { Logic, SimMode } from '@lc/sim-core';
import type { StoredPort } from '../editor/model';

export type DriveValue = 0 | 1 | 2 | 3;

export interface SimSnapshot {
  ok: boolean;
  error?: string;
  /** 端口名 → 驱动值 */
  inputs: Record<string, DriveValue>;
  portValues: Record<string, Logic>;
  /** 每个网（netId）对应的仿真电平编码 */
  netSignals: Array<[string, number]>;
  nodeCount: number;
  elemCount: number;
  evaluations: number;
  timePs: number;
  simDiagnostics: Array<{ kind: string; severity: string; message: string }>;
  compileDiagnostics: Array<{ kind: string; severity: string; message: string }>;
  cost: { counts: Record<string, number>; half: number; text: string };
  /** 内容哈希：只跟电路结构有关，挪动元件/改标签不会变 */
  hash: string;
  timing: {
    portDelayPs: Record<string, number>;
    criticalPathPs: number;
    isSequential: boolean;
    uncertain: boolean;
  } | null;
  truth: Array<{ inputs: Record<string, Logic>; outputs: Record<string, Logic> }> | null;
}

export interface WrappedModuleInfo {
  template: unknown;
  hash: string;
  name: string;
  costHalf: number;
  isSequential: boolean;
  ports: StoredPort[];
  /** 端口名 → 最长传播延迟（ps） */
  delayPs: Record<string, number>;
  criticalPathPs: number;
  diagnostics: string[];
}

export type StudioRequest =
  | {
      id: number;
      type: 'simulate';
      design: Design;
      library: unknown[];
      mode: SimMode;
      inputs: Record<string, DriveValue>;
      /** 瞬时按钮端口：仿真时先按 0 稳定，再按目标值（组合链稳定后才出现上升沿，避免锁存中间态） */
      buttonPorts?: string[];
      /** 上次仿真的节点信号（顶层网 id → signal），用于锁存器/寄存器状态跨仿真保持 */
      prevSignals?: Record<string, number>;
      withTiming?: boolean;
      withTruth?: boolean;
      maxTruthRows?: number;
    }
  | { id: number; type: 'wrap'; design: Design; library: unknown[]; name: string; stage: number }
  | {
      id: number;
      type: 'judge';
      design: Design;
      library: unknown[];
      level: Level;
      /** 硬核工程模式：额外检查关卡时序预算 */
      hardcore: boolean;
      /** 玩家契约：判定按契约换可用元件集、满分线/预算/时序预算（缺省 rtl） */
      family?: LogicFamily;
    };

/** 去掉 id 的请求（Omit 在联合类型上会塌成公共字段，必须分配式处理） */
export type StudioRequestInput = StudioRequest extends infer T
  ? T extends { id: number }
    ? Omit<T, 'id'>
    : never
  : never;

export interface StudioResponse {
  id: number;
  snapshot?: SimSnapshot;
  wrapped?: WrappedModuleInfo;
  judge?: JudgeResult;
  error?: string;
}
