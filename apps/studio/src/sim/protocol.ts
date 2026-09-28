/**
 * 工作台 ↔ 仿真内核 的消息协议。
 * 同一份 handleRequest 既跑在 Web Worker 里，也跑在主线程回退路径上（见 runner.ts）。
 */

import type { Design } from '@lc/schema';
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
      withTiming?: boolean;
      withTruth?: boolean;
      maxTruthRows?: number;
    }
  | { id: number; type: 'wrap'; design: Design; library: unknown[]; name: string; stage: number };

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
  error?: string;
}
