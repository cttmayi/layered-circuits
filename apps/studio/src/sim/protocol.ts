/**
 * 工作台 ↔ 仿真内核 的消息协议。
 * 同一份 handleRequest 既跑在 Web Worker 里，也跑在主线程回退路径上（见 runner.ts）。
 */

import type { JudgeResult } from '@lc/compiler';
import type { Design, Level, LogicFamily } from '@lc/schema';
import type { Logic, SimMode, Waveform } from '@lc/sim-core';
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
  /** 每个网各驱动元素槽位的贡献值（按 net.driveStart 顺序），与 netSignals 同一终态。
   *  恢复初始态时两者必须一起还原（见 prevSignals/prevContribs），否则元素求值会读到
   *  上电旧贡献，把锁存器/寄存器等状态电路在输入变化时错误翻转或卡死。 */
  contrib: Array<[string, number[]]>;
  nodeCount: number;
  elemCount: number;
  /** 全节点电平（按节点序号，含模块内部节点）：跨仿真恢复用的完整状态 */
  nodeSignals: number[];
  evaluations: number;
  timePs: number;
  simDiagnostics: Array<{ kind: string; severity: string; message: string }>;
  compileDiagnostics: Array<{ kind: string; severity: string; message: string }>;
  cost: { counts: Record<string, number>; half: number; text: string };
  /** 内容哈希：只跟电路结构有关，挪动元件/改标签不会变 */
  hash: string;
  /** 端口级实时波形（只有请求 withWaveform 且时序模式下才有；逻辑模式为空） */
  waveform?: Waveform | null;
  timing: {
    portDelayPs: Record<string, number>;
    criticalPathPs: number;
    isSequential: boolean;
    uncertain: boolean;
  } | null;
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
      /** 与 prevSignals 配套的贡献缓存（顶层网 id → 各驱动槽位贡献值，按 driveStart 顺序）：
       *  恢复信号必须一并恢复贡献，否则元素求值读到上电旧贡献会把状态电路毒化 */
      prevContribs?: Record<string, number[]>;
      /** 上次仿真的**全节点**电平（按节点序号，含模块内部节点）。有它就优先用它恢复：
       *  prevSignals 只按顶层网 id 恢复，模块内部节点没有名字、恢复不到 ——
       *  「顶层终态 + 内部上电态」混在一起时，内部节点的贡献不变、事件不再往下游传，
       *  输出会冻住（两级串联模块在 seq 关卡里点输入毫无反应）。 */
      prevNodeSignals?: number[];
      withTiming?: boolean;
      /** 要一份「实时时序波形」（端口级）：把这次仿真画成阶梯图，
       *  「时序视图」用它展示真实延迟/竞争/毛刺 —— 与判定无关 */
      withWaveform?: boolean;
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
