/**
 * 开关级 + 事件驱动仿真内核。
 *
 * 两种模式共用同一套求值逻辑，只有「调度器」不同：
 *   - mode = 'logic'（新手科普模式）：忽略所有元件延迟，用同刻 FIFO 队列迭代到收敛；
 *     超过迭代上限即判定组合环/振荡（不稳定），不会死循环。
 *   - mode = 'timing'（硬核工程模式）：二叉堆事件队列，按元件延迟（ps）推进时间，
 *     可复现真实竞争冒险；波形 trace 记录每次节点变化。
 *
 * 语义细节（为什么三极管是双向导通、二极管为什么只按「强侧压弱侧」传递）见 docs/sim-semantics.md。
 */

import { ElementKind, type FlatNet, type FlatPort, PIN_STRIDE } from './ir.js';
import {
  type Logic,
  logicValueOf,
  S_STRONG,
  S_WEAK,
  SIG_STRONG_0,
  SIG_STRONG_1,
  SIG_STRONG_X,
  SIG_WEAK_X,
  SIG_Z,
  sig,
  strengthOf,
  toLogic,
  V0,
  V1,
  VX,
} from './signal.js';

export type SimMode = 'logic' | 'timing';

export interface SimOptions {
  mode: SimMode;
  /** 是否记录波形（内存换可观测性） */
  trace?: boolean;
  /** 逻辑模式下收敛迭代上限（元素求值次数），默认 max(2000, 50 × 元素数) */
  maxIterations?: number;
  /** 时序模式下的最大事件数安全阀，默认 20_000_000 */
  maxEvents?: number;
  /** 每类诊断最多保留多少条 */
  maxDiagnosticsPerKind?: number;
  /** 用上次仿真的节点信号恢复初始态（键 = 顶层网 id）：GUI 连续仿真时，
   *  锁存器/寄存器的「保持」跨仿真保留（否则每次冷启动都回到上电非法态）。
   *  只恢复能对上的网，其余节点维持上电默认。 */
  initialSignals?: Record<string, number>;
  /** 与 initialSignals 配套的元素贡献缓存（键 = 顶层网 id → 该网各驱动元素槽位的
   *  贡献值，按 net.driveStart 顺序）。恢复信号时必须一并恢复贡献，否则元素求值时
   *  经 resolveExcluding 读到上电旧贡献，会把恢复态「毒化」—— 状态电路在输入变化时
   *  被错误翻转或卡死。两者都来自上一次仿真的终态快照，天然一致。 */
  initialContribs?: Record<string, number[]>;
}

export type DiagnosticKind =
  | 'drive-conflict'
  | 'resistive-tie'
  | 'floating-input'
  | 'unstable'
  | 'cap-ignored';

export interface Diagnostic {
  kind: DiagnosticKind;
  severity: 'error' | 'warning' | 'info';
  timePs: number;
  node?: number;
  elem?: number;
  nodeLabel?: string;
  message: string;
}

export interface Trace {
  times: number[];
  nodes: number[];
  signals: number[];
}

export interface SimResultSnapshot {
  timePs: number;
  evaluations: number;
  logicMode: boolean;
}

interface HeapEntry {
  time: number;
  seq: number;
  elem: number;
}

export class Simulator {
  readonly net: FlatNet;
  readonly mode: SimMode;
  readonly trace: Trace | undefined;

  private nodeSig: Uint8Array;
  private contrib: Uint8Array;
  private changeCount: Uint32Array;
  private timePs = 0;

  // 逻辑模式：同刻 FIFO
  private fifo: number[] = [];
  private fifoHead = 0;
  private inFifo: Uint8Array;

  // 时序模式：最小堆
  private heap: HeapEntry[] = [];
  private queuedTime: Float64Array;
  private seq = 0;

  private evaluations = 0;
  private eventCount = 0;
  private diagnostics: Diagnostic[] = [];
  private diagKeys = new Set<string>();
  private diagCountByKind = new Map<DiagnosticKind, number>();
  private unstableReported = false;

  private readonly maxIterations: number;
  private readonly maxEvents: number;
  private readonly maxDiagnosticsPerKind: number;
  private readonly options: SimOptions;
  private readonly inPorts = new Map<string, FlatPort>();
  private readonly outPorts = new Map<string, FlatPort>();
  /** 三极管基极「曾处于悬空」的节点 → 元素下标（仿真停下时才判定并报告） */
  private readonly floatingBase = new Map<number, number>();
  /** 输入端口总数（用于判定「所有输入都设置过」——输入没设置完之前不算仿真开始） */
  private readonly inputPortCount: number;
  /** 已被 setInput/setInputAt 设置过的输入端口元素下标 */
  private readonly setInputElems = new Set<number>();

  constructor(net: FlatNet, options: SimOptions) {
    this.net = net;
    this.mode = options.mode;
    this.options = options;
    this.trace = options.trace ? { times: [], nodes: [], signals: [] } : undefined;
    this.maxIterations = options.maxIterations ?? Math.max(2000, net.elemCount * 50);
    this.maxEvents = options.maxEvents ?? 20_000_000;
    this.maxDiagnosticsPerKind = options.maxDiagnosticsPerKind ?? 50;

    this.nodeSig = new Uint8Array(net.nodeCount);
    this.contrib = new Uint8Array(net.elemCount * PIN_STRIDE);
    this.changeCount = new Uint32Array(net.nodeCount);
    this.inFifo = new Uint8Array(net.elemCount);
    this.queuedTime = new Float64Array(net.elemCount).fill(Number.NaN);
    this.inputPortCount = net.ports.filter((p) => p.dir === 'in').length;

    for (const port of net.ports) {
      if (port.dir === 'in') {
        this.inPorts.set(port.id, port);
        this.inPorts.set(port.name, port);
      } else {
        this.outPorts.set(port.id, port);
        this.outPorts.set(port.name, port);
      }
    }

    this.reset();
  }

  // ---------------------------------------------------------------- 生命周期

  /** 上电：源在 t=0 建立，其余元件按延迟逐级传播（见构造函数注释）。
   *  上电阶段输入引脚还没设置、任何节点都是 Z，此时报告悬空是误报（任何电路都会报），
   *  所以这里不报告浮动；悬空检查只发生在输入设置完之后的收敛（见 settle 的注释）。 */
  private powerUp(): void {
    if (this.mode === 'logic') {
      for (let e = 0; e < this.net.elemCount; e++) this.schedule(e, 0);
      this.settle(false);
      return;
    }
    for (let e = 0; e < this.net.elemCount; e++) {
      const kind = this.net.elemKind[e] as number;
      const delay =
        kind === ElementKind.POWER || kind === ElementKind.INPUT
          ? 0
          : (this.net.elemDelayPs[e] as number);
      this.schedule(e, delay);
    }
    this.drainUntil(0, Number.POSITIVE_INFINITY, false);
  }

  reset(): void {
    this.nodeSig.fill(SIG_Z);
    this.contrib.fill(SIG_Z);
    this.changeCount.fill(0);
    this.setInputElems.clear();
    this.timePs = 0;
    this.fifo = [];
    this.fifoHead = 0;
    this.inFifo.fill(0);
    this.heap = [];
    this.queuedTime.fill(Number.NaN);
    this.seq = 0;
    this.evaluations = 0;
    this.eventCount = 0;
    this.diagnostics = [];
    this.diagKeys.clear();
    this.diagCountByKind.clear();
    this.unstableReported = false;
    if (this.trace) {
      this.trace.times.length = 0;
      this.trace.nodes.length = 0;
      this.trace.signals.length = 0;
    }

    // 上电：
    // - 逻辑模式：所有元素在 t = 0 迭代到收敛（无延迟可言）；
    // - 时序模式：只有电源/输入引脚这类「源」在 t = 0 立刻建立，其余元件靠自身的
    //   传播延迟逐级推进。这样波形上看到的建立过程是真实的（每一级各占自己的延迟），
    //   而不是全体挤在同一时刻 —— 竞争冒险/空翻才看得出来。
    this.powerUp();

    // 用上次仿真的信号恢复初始态（键 = 顶层网 id）。恢复发生在队列排空之后：
    // 后续 setInput 触发的求值会从恢复值继续演化（锁存器保持旧状态）。
    // 注意：信号必须与贡献（initialContribs）成对出现 —— 两者出自同一次仿真的终态，
    // 单独恢复信号会让 contrib 停留在上电旧值，下一次求值经 resolveExcluding 读到
    // 陈旧贡献，把恢复态「毒化」（状态电路在输入变化时卡死/误翻转）。只给信号不给
    // 贡献的调用方视为「不要状态保持」：跳过恢复，维持上电默认（宁可丢状态也不产出
    // 错误结果）。
    if (this.options.initialSignals && this.options.initialContribs) {
      const sig = this.options.initialSignals;
      for (let node = 0; node < this.net.nodeCount; node++) {
        const id = this.net.nodeLabel[node];
        if (!id) continue;
        const s = sig[id];
        if (s !== undefined) this.nodeSig[node] = s & 0x0f;
      }
      // 恢复只写 nodeSig 是不够的：contrib（元素贡献缓存）仍是上电旧值，二者不一致。
      // 下一次求值时，元素会经 resolveExcluding 读到其他元素的陈旧贡献，把恢复态
      // 「毒化」—— 状态电路（按钮/锁存器）在输入变化时被错误翻转或卡死
      // （例：rst 复位后松开，锁存器因上电态三极管贡献而弹回置位）。
      // 所以快照同时携带 contrib（上一次仿真的终态贡献），这里按网还原到对应槽位；
      // 信号与贡献出自同一终态，恢复后完全一致，无需任何重收敛。
      const ic = this.options.initialContribs as Record<string, number[]>;
      for (let node = 0; node < this.net.nodeCount; node++) {
        const id = this.net.nodeLabel[node];
        if (!id) continue;
        const vals = ic[id];
        if (!vals) continue;
        const start = this.net.driveStart[node] as number;
        const end = this.net.driveStart[node + 1] as number;
        const n = Math.min(end - start, vals.length);
        for (let i = 0; i < n; i++) {
          const de = this.net.driveElem[start + i] as number;
          const ds = this.net.driveSlot[start + i] as number;
          this.contrib[de * PIN_STRIDE + ds] = vals[i] ?? SIG_Z;
        }
      }
    }
  }

  /** 逻辑模式：迭代到收敛。返回是否收敛（false = 振荡/组合环）
   *  @param reportFloating 收敛后是否检查「仍悬空的三极管基极」。上电（powerUp）阶段
   *     输入引脚还没设置、所有节点都是 Z，此时报告悬空是误报（任何电路都会报），
   *     所以 powerUp 传 false；输入设置完之后的收敛才传默认 true —— 那时仍悬空
   *     才是玩家真的忘了接输入。 */
  settle(reportFloating = true): boolean {
    if (this.mode !== 'logic') {
      throw new Error('settle() 只能在 logic 模式下调用');
    }
    while (this.fifoHead < this.fifo.length) {
      if (this.evaluations >= this.maxIterations) {
        this.reportUnstable();
        return false;
      }
      const e = this.fifo[this.fifoHead++] as number;
      this.inFifo[e] = 0;
      this.evaluations++;
      this.evalElement(e, 0);
      if (this.fifoHead > 4096 && this.fifoHead * 2 > this.fifo.length) {
        this.fifo = this.fifo.slice(this.fifoHead);
        this.fifoHead = 0;
      }
    }
    this.fifo = [];
    this.fifoHead = 0;
    // 输入全部设置过才算仿真开始：上电/设置输入的中间态悬空是初始化，不算玩家错误
    if (reportFloating && this.allInputsSet()) this.reportFloatingBases();
    return true;
  }

  /**
   * 时序模式：推进到指定时刻（含）。
   * @returns 是否已排空事件队列；false 表示 maxEvents 预算用尽（电路仍在变化，通常是振荡）
   */
  advanceTo(timePs: number, maxEvents?: number): boolean {
    if (this.mode !== 'timing') {
      throw new Error('advanceTo() 只能在 timing 模式下调用');
    }
    return this.drainUntil(timePs, maxEvents ?? Number.POSITIVE_INFINITY);
  }

  runFor(deltaPs: number, maxEvents?: number): boolean {
    return this.advanceTo(this.timePs + deltaPs, maxEvents);
  }

  /** 时序模式：事件队列是否已排空（电路已经稳定下来） */
  get isQuiescent(): boolean {
    return this.heap.length === 0;
  }

  get time(): number {
    return this.timePs;
  }

  get stats(): SimResultSnapshot {
    return { timePs: this.timePs, evaluations: this.evaluations, logicMode: this.mode === 'logic' };
  }

  get allDiagnostics(): readonly Diagnostic[] {
    return this.diagnostics;
  }

  // ------------------------------------------------------------------ 输入输出

  setInput(portIdOrName: string, value: Logic): void {
    const port = this.inPorts.get(portIdOrName);
    if (!port) throw new Error(`未找到输入端口：${portIdOrName}`);
    // 无论值变没变，只要被显式设置过就算「输入已驱动」——未设置之前不算仿真开始
    this.setInputElems.add(port.elem);
    const encoded = value === 'Z' ? 3 : value === 'X' ? VX : (value as number);
    if (this.net.elemParam[port.elem] === encoded) return;
    this.net.elemParam[port.elem] = encoded;
    this.schedule(port.elem, this.timePs);
    if (this.mode === 'logic') this.settle();
    else this.drainUntil(this.timePs);
  }

  /** 批量设置输入（逻辑模式下一次收敛；时序模式下逐个生效） */
  setInputs(values: Record<string, Logic>): void {
    for (const [key, value] of Object.entries(values)) this.setInput(key, value);
  }

  /**
   * 在指定时刻施加输入（时序模式专用）。
   *
   * 为什么需要它：激励必须落在**确定的时刻**上，否则「输入何时变化」取决于上一个向量
   * 最后一次事件的时刻（2000ps 还是 2001ps 全看电路内部节奏），波形窗口、建立/保持时间
   * 测量都会跟着漂。逻辑模式下等价于 setInput。
   */
  setInputAt(portIdOrName: string, value: Logic, atPs: number): void {
    if (this.mode === 'logic') {
      this.setInput(portIdOrName, value);
      return;
    }
    const port = this.inPorts.get(portIdOrName);
    if (!port) throw new Error(`未找到输入端口：${portIdOrName}`);
    if (atPs > this.timePs) {
      this.advanceTo(atPs);
      // 队列可能已经空了：时间仍然要推到 atPs，激励才有确定的落点
      this.timePs = atPs;
    }
    this.setInputElems.add(port.elem);
    const encoded = value === 'Z' ? 3 : value === 'X' ? VX : (value as number);
    if (this.net.elemParam[port.elem] === encoded) return;
    this.net.elemParam[port.elem] = encoded;
    this.schedule(port.elem, this.timePs);
    this.drainUntil(this.timePs);
  }

  readPort(portIdOrName: string): Logic {
    const port = this.outPorts.get(portIdOrName) ?? this.inPorts.get(portIdOrName);
    if (!port) throw new Error(`未找到端口：${portIdOrName}`);
    return toLogic(this.nodeSig[port.node] as number);
  }

  readAllOutputs(): Record<string, Logic> {
    const out: Record<string, Logic> = {};
    for (const port of this.net.ports) {
      if (port.dir === 'out') out[port.name] = toLogic(this.nodeSig[port.node] as number);
    }
    return out;
  }

  readAllInputs(): Record<string, Logic> {
    const out: Record<string, Logic> = {};
    for (const port of this.net.ports) {
      if (port.dir === 'in') out[port.name] = toLogic(this.nodeSig[port.node] as number);
    }
    return out;
  }

  signalOf(node: number): number {
    return this.nodeSig[node] as number;
  }

  /** 元素某槽位对所在网的贡献值（快照用，配合 initialContribs 跨仿真恢复） */
  contribOf(elem: number, slot: number): number {
    return this.contrib[elem * PIN_STRIDE + slot] ?? SIG_Z;
  }

  nodeLabel(node: number): string {
    return this.net.nodeLabel[node] ?? `#${node}`;
  }

  /** 节点变化次数（用于定位振荡节点） */
  changeCountOf(node: number): number {
    return this.changeCount[node] as number;
  }

  // -------------------------------------------------------------------- 调度

  private schedule(elem: number, atPs: number): void {
    if (this.mode === 'logic') {
      if (this.inFifo[elem] === 1) return;
      this.inFifo[elem] = 1;
      this.fifo.push(elem);
      return;
    }
    const prev = this.queuedTime[elem] as number;
    if (prev === atPs) return; // 同刻去重；被弹出时会清空，不会漏事件
    this.queuedTime[elem] = atPs;
    this.pushHeap({ time: atPs, seq: this.seq++, elem });
  }

  private drainUntil(
    limitPs: number,
    maxEvents = Number.POSITIVE_INFINITY,
    reportFloating = true,
  ): boolean {
    const budget = this.eventCount + maxEvents;
    while (this.heap.length > 0) {
      const top = this.heap[0] as HeapEntry;
      if (top.time > limitPs) break;
      if (this.eventCount >= budget) {
        // 预算用尽：不判定为硬错误，但要让上层知道「电路还在动」
        this.diagnose(
          'unstable',
          'warning',
          `在 ${maxEvents} 次事件内电路仍未稳定（可能振荡），已暂停推进`,
          -1,
          -1,
          this.timePs,
        );
        return false;
      }
      this.popHeap();
      if (this.queuedTime[top.elem] === top.time) this.queuedTime[top.elem] = Number.NaN;
      if (++this.eventCount > this.maxEvents) {
        this.diagnose(
          'unstable',
          'error',
          `事件数超过安全上限 ${this.maxEvents}，仿真中止（疑似振荡或反馈环）`,
          0,
          -1,
          this.timePs,
        );
        this.heap = [];
        return false;
      }
      this.timePs = top.time;
      this.evaluations++;
      this.evalElement(top.elem, top.time);
    }
    // 队列已空时不要推进 timePs：调用方（波形/延迟测量）需要「最后一次事件发生的时刻」
    if (this.heap.length === 0 && reportFloating && this.allInputsSet()) {
      this.reportFloatingBases();
    }
    return true;
  }

  /**
   * 报告「仿真停下来时仍无驱动」的三极管基极。
   * 为什么不在求值时立刻报警：时序模式下上电要一级一级传播，中途基极短暂悬空是正常的，
   * 只有稳定后仍然悬空才说明玩家真的忘了接。
   */
  private allInputsSet(): boolean {
    // 所有输入端口都被显式设置过，才算是「仿真真正开始」——在这之前（上电 / 逐个
    // setInput 的中间态）节点悬空是初始化过程，不是玩家电路的错误。
    return this.setInputElems.size >= this.inputPortCount;
  }

  private reportFloatingBases(): void {
    for (const [node, elem] of this.floatingBase) {
      if ((this.nodeSig[node] as number) !== SIG_Z) continue;
      this.diagnose(
        'floating-input',
        'warning',
        `${this.elemLabel(elem)} 的栅极/基极悬空（未连接任何驱动），按截止处理`,
        node,
        elem,
        this.timePs,
      );
    }
  }

  private pushHeap(entry: HeapEntry): void {
    this.heap.push(entry);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapLess(this.heap[i] as HeapEntry, this.heap[parent] as HeapEntry)) {
        const tmp = this.heap[parent] as HeapEntry;
        this.heap[parent] = this.heap[i] as HeapEntry;
        this.heap[i] = tmp;
        i = parent;
      } else break;
    }
  }

  private popHeap(): void {
    const last = this.heap.pop() as HeapEntry;
    if (this.heap.length === 0) return;
    this.heap[0] = last;
    let i = 0;
    const n = this.heap.length;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let smallest = i;
      if (l < n && heapLess(this.heap[l] as HeapEntry, this.heap[smallest] as HeapEntry))
        smallest = l;
      if (r < n && heapLess(this.heap[r] as HeapEntry, this.heap[smallest] as HeapEntry))
        smallest = r;
      if (smallest === i) break;
      const tmp = this.heap[smallest] as HeapEntry;
      this.heap[smallest] = this.heap[i] as HeapEntry;
      this.heap[i] = tmp;
      i = smallest;
    }
  }

  // ------------------------------------------------------------------ 求值

  private evalElement(e: number, atPs: number): void {
    const kind = this.net.elemKind[e] as number;
    const base = e * PIN_STRIDE;
    const p0 = this.net.elemPin[base] as number;
    const p1 = this.net.elemPin[base + 1] as number;
    const p2 = this.net.elemPin[base + 2] as number;

    let d0 = SIG_Z;
    let d1 = SIG_Z;
    let d2 = SIG_Z;

    switch (kind) {
      case ElementKind.NPN: {
        const gate = this.nodeSig[p1] as number;
        if (gate === SIG_Z) {
          // 建立过程中节点本来就可能是悬空态，先记下来；等仿真停下来再判定是否真的没驱动
          this.floatingBase.set(p1, e);
        } else if (logicValueOf(gate) === VX) {
          // 基极电平未知 → 通断未知，向两端注入弱 X
          d0 = SIG_WEAK_X;
          d2 = SIG_WEAK_X;
        } else if (logicValueOf(gate) === V1) {
          // 导通：只向「驱动能力更弱」的一侧传递对端电平（电流从低阻侧流向高阻侧）
          const pass = passDrives(
            this.resolveExcluding(p0, e, 0),
            this.resolveExcluding(p2, e, 2),
            S_STRONG,
          );
          d0 = pass.d0;
          d2 = pass.d1;
        }
        break;
      }
      case ElementKind.NMOS: {
        const gate = this.nodeSig[p1] as number;
        if (gate === SIG_Z) {
          this.floatingBase.set(p1, e);
        } else if (logicValueOf(gate) === VX) {
          // 栅极电平未知 → 通断未知，向两端注入弱 X
          d0 = SIG_WEAK_X;
          d2 = SIG_WEAK_X;
        } else if (logicValueOf(gate) === V1) {
          // N-MOS 栅极高电平导通：漏源强导通（栅极不取电流，无需限流）
          const pass = passDrivesMos(
            this.resolveExcluding(p0, e, 0),
            this.resolveExcluding(p2, e, 2),
            S_STRONG,
          );
          d0 = pass.d0;
          d2 = pass.d1;
        }
        break;
      }
      case ElementKind.PMOS: {
        const gate = this.nodeSig[p1] as number;
        if (gate === SIG_Z) {
          this.floatingBase.set(p1, e);
        } else if (logicValueOf(gate) === VX) {
          d0 = SIG_WEAK_X;
          d2 = SIG_WEAK_X;
        } else if (logicValueOf(gate) === V0) {
          // P-MOS 栅极低电平导通
          const pass = passDrivesMos(
            this.resolveExcluding(p0, e, 0),
            this.resolveExcluding(p2, e, 2),
            S_STRONG,
          );
          d0 = pass.d0;
          d2 = pass.d1;
        }
        break;
      }
      case ElementKind.RES: {
        // 电阻：通路，但只能提供弱驱动（永远被任何强驱动压过）
        ({ d0, d1 } = passDrives(
          this.resolveExcluding(p0, e, 0),
          this.resolveExcluding(p1, e, 1),
          S_WEAK,
        ));
        break;
      }
      case ElementKind.DIO: {
        const sa = this.resolveExcluding(p0, e, 0);
        const sk = this.resolveExcluding(p1, e, 1);
        const anodeValue = sa === SIG_Z ? -1 : logicValueOf(sa);
        const cathodeValue = sk === SIG_Z ? -1 : logicValueOf(sk);
        const cathodeHigh = cathodeValue === V1;
        if (anodeValue === V1 && !cathodeHigh) {
          // 正向导通：单向（电流只能阳极 → 阴极），依然只压向更弱的一侧
          const anodeStrength = strengthOf(sa);
          const cathodeStrength = strengthOf(sk);
          if (anodeStrength >= cathodeStrength) {
            d1 = sig(Math.min(anodeStrength, S_STRONG), V1);
          } else {
            d0 = sig(Math.min(cathodeStrength, S_STRONG), cathodeValue < 0 ? V0 : cathodeValue);
          }
        } else if (anodeValue === VX && !cathodeHigh) {
          d1 = SIG_WEAK_X;
        }
        break;
      }
      case ElementKind.POWER: {
        d0 = this.net.elemParam[e] === 1 ? SIG_STRONG_1 : SIG_STRONG_0;
        break;
      }
      case ElementKind.INPUT: {
        const param = this.net.elemParam[e] as number;
        d0 = param === 3 ? SIG_Z : (S_STRONG << 2) | param;
        break;
      }
      case ElementKind.CAP: {
        // 电容不参与逻辑仿真（M0 决策：时钟由关卡端口/振荡环折叠提供，见 sim-semantics.md）
        this.diagnose(
          'cap-ignored',
          'info',
          `电容 ${this.elemLabel(e)} 仅计入成本，不参与逻辑仿真`,
          p0,
          e,
          atPs,
        );
        break;
      }
      default:
        break;
    }

    this.applyDrive(e, 0, d0, atPs);
    this.applyDrive(e, 1, d1, atPs);
    this.applyDrive(e, 2, d2, atPs);
  }

  private applyDrive(e: number, slot: number, next: number, atPs: number): void {
    const idx = e * PIN_STRIDE + slot;
    if (this.contrib[idx] === next) return;
    this.contrib[idx] = next;
    const node = this.net.elemPin[idx] as number;
    if (node < 0) return;
    this.resolveNode(node, atPs);
  }

  /**
   * 节点归约，但排除「自己这个元素在本槽位的贡献」。
   *
   * 为什么需要它：通路元件（电阻/三极管/二极管）只向更弱的一侧传递电平。
   * 若不排除自己，两个节点会通过导通的三极管互相「自证」一个强电平，
   * 形成物理上不存在的假稳态（例如与非门的一个输入从 1 变 0 后，
   * 串联中点的强 0 会永远锁在「浮空孤岛」里，而真实电路会被上拉电阻充电拉高）。
   */
  private resolveExcluding(node: number, elem: number, slot: number): number {
    const start = this.net.driveStart[node] as number;
    const end = this.net.driveStart[node + 1] as number;
    let strongMask = 0;
    let weakMask = 0;
    for (let i = start; i < end; i++) {
      const de = this.net.driveElem[i] as number;
      const ds = this.net.driveSlot[i] as number;
      if (de === elem && ds === slot) continue;
      const c = this.contrib[de * PIN_STRIDE + ds] as number;
      if (c === SIG_Z) continue;
      const bit = 1 << (c & 3);
      if (c >> 2 === S_STRONG) strongMask |= bit;
      else weakMask |= bit;
    }
    if (strongMask !== 0) {
      return (strongMask & (strongMask - 1)) === 0
        ? (S_STRONG << 2) | maskValue(strongMask)
        : SIG_STRONG_X;
    }
    if (weakMask !== 0) {
      return (weakMask & (weakMask - 1)) === 0 ? (S_WEAK << 2) | maskValue(weakMask) : SIG_WEAK_X;
    }
    return SIG_Z;
  }

  private resolveNode(node: number, atPs: number): void {
    const start = this.net.driveStart[node] as number;
    const end = this.net.driveStart[node + 1] as number;
    let strongMask = 0;
    let weakMask = 0;
    let strongCount = 0;
    for (let i = start; i < end; i++) {
      const de = this.net.driveElem[i] as number;
      const ds = this.net.driveSlot[i] as number;
      const c = this.contrib[de * PIN_STRIDE + ds] as number;
      if (c === SIG_Z) continue;
      const bit = 1 << (c & 3);
      if (c >> 2 === S_STRONG) {
        strongMask |= bit;
        strongCount++;
      } else {
        weakMask |= bit;
      }
    }

    let next = SIG_Z;
    if (strongMask !== 0) {
      const single = (strongMask & (strongMask - 1)) === 0;
      if (single) next = (S_STRONG << 2) | maskValue(strongMask);
      else {
        next = SIG_STRONG_X;
        if (strongCount > 1) {
          this.diagnose(
            'drive-conflict',
            'error',
            `节点 ${this.nodeLabel(node)} 存在 ${strongCount} 个强驱动互相冲突（短路/多驱动），判定为 X`,
            node,
            -1,
            atPs,
          );
        }
      }
    } else if (weakMask !== 0) {
      const single = (weakMask & (weakMask - 1)) === 0;
      if (single) next = (S_WEAK << 2) | maskValue(weakMask);
      else {
        next = SIG_WEAK_X;
        this.diagnose(
          'resistive-tie',
          'warning',
          `节点 ${this.nodeLabel(node)} 由多个弱驱动（电阻）对拉，分压结果不确定，判定为 X`,
          node,
          -1,
          atPs,
        );
      }
    }

    if ((this.nodeSig[node] as number) === next) return;
    this.nodeSig[node] = next;
    this.changeCount[node] = (this.changeCount[node] as number) + 1;
    if (this.trace) {
      this.trace.times.push(atPs);
      this.trace.nodes.push(node);
      this.trace.signals.push(next);
    }

    const wStart = this.net.watchStart[node] as number;
    const wEnd = this.net.watchStart[node + 1] as number;
    for (let i = wStart; i < wEnd; i++) {
      const watcher = this.net.watchElem[i] as number;
      this.schedule(watcher, atPs + (this.net.elemDelayPs[watcher] as number));
    }
  }

  // ------------------------------------------------------------------ 诊断

  private elemLabel(e: number): string {
    return this.net.elemLabel[e] ?? `#${e}`;
  }

  private diagnose(
    kind: DiagnosticKind,
    severity: Diagnostic['severity'],
    message: string,
    node: number,
    elem: number,
    timePs: number,
  ): void {
    const key = `${kind}:${node}:${elem}`;
    if (this.diagKeys.has(key)) return;
    const used = this.diagCountByKind.get(kind) ?? 0;
    if (used >= this.maxDiagnosticsPerKind) return;
    this.diagKeys.add(key);
    this.diagCountByKind.set(kind, used + 1);
    const diag: Diagnostic = { kind, severity, timePs, message };
    if (node >= 0) {
      diag.node = node;
      diag.nodeLabel = this.nodeLabel(node);
    }
    if (elem >= 0) diag.elem = elem;
    this.diagnostics.push(diag);
  }

  private reportUnstable(): void {
    if (this.unstableReported) return;
    this.unstableReported = true;
    const top = [...this.changeCount.keys()]
      .sort((a, b) => (this.changeCount[b] as number) - (this.changeCount[a] as number))
      .slice(0, 5)
      .filter((n) => (this.changeCount[n] as number) > 0)
      .map((n) => `${this.nodeLabel(n)}(${this.changeCount[n]} 次)`)
      .join('、');
    this.diagnose(
      'unstable',
      'error',
      `电路在 ${this.evaluations} 次求值后仍未稳定，判定为组合环/振荡。波动最剧烈的节点：${top || '（无）'}`,
      -1,
      -1,
      this.timePs,
    );
  }
}

function heapLess(a: HeapEntry, b: HeapEntry): boolean {
  return a.time < b.time || (a.time === b.time && a.seq < b.seq);
}

/**
 * 通路元件的传递规则：只驱动「外部驱动更弱」的一侧，强度取 min(强侧强度, 元件能力上限)。
 * - 两侧都没有外部驱动 → 谁都不驱动（悬空孤岛不会自我维持电平）；
 * - 两侧强度相同 → 互相交换电平（同强度对拉结果是中间电平 → X）。
 */
function passDrives(a: number, b: number, cap: number): { d0: number; d1: number } {
  const aStrength = strengthOf(a);
  const bStrength = strengthOf(b);
  if (aStrength > bStrength)
    return { d0: SIG_Z, d1: sig(Math.min(aStrength, cap), logicValueOf(a)) };
  if (bStrength > aStrength)
    return { d0: sig(Math.min(bStrength, cap), logicValueOf(b)), d1: SIG_Z };
  if (aStrength > 0) {
    const strength = Math.min(aStrength, cap);
    return { d0: sig(strength, logicValueOf(b)), d1: sig(strength, logicValueOf(a)) };
  }
  return { d0: SIG_Z, d1: SIG_Z };
}

/**
 * MOS 专用传递规则（NMOS/PMOS）：同强度**异值**时两边都不驱动（Z），而不是注入 X。
 *
 * 为什么 CMOS 要例外：瞬态里「旧值」可能只是上一状态在浮空节点上的残留
 * （例如 CMOS 串联堆叠的中间节点被充电后，下一次输入翻转瞬间与电源轨对拉）——
 * 注入 X 会经 MOS 通路自持成锁死的 X（CMOS 与非门级联的异或门就会这样挂掉）。
 * 改成 Z 后，电源轨/更强的外部驱动会在下一轮迭代里胜出，瞬态正常收敛；
 * 真正的稳态冲突仍会在共享节点上被 resolveNode 判成 X（drive-conflict）。
 * 三极管/二极管/电阻保留旧语义：它们的网络里上拉多为弱电阻，不会出现
 * 「强-强对拉」的瞬态，且已有电路（DFF 等）依赖旧行为。
 */
function passDrivesMos(a: number, b: number, cap: number): { d0: number; d1: number } {
  const aStrength = strengthOf(a);
  const bStrength = strengthOf(b);
  if (aStrength > bStrength)
    return { d0: SIG_Z, d1: sig(Math.min(aStrength, cap), logicValueOf(a)) };
  if (bStrength > aStrength)
    return { d0: sig(Math.min(bStrength, cap), logicValueOf(b)), d1: SIG_Z };
  if (aStrength > 0) {
    if (logicValueOf(a) !== logicValueOf(b)) return { d0: SIG_Z, d1: SIG_Z };
    const strength = Math.min(aStrength, cap);
    return { d0: sig(strength, logicValueOf(b)), d1: sig(strength, logicValueOf(a)) };
  }
  return { d0: SIG_Z, d1: SIG_Z };
}

function maskValue(mask: number): number {
  if (mask & (1 << V0)) return V0;
  if (mask & (1 << V1)) return V1;
  return VX;
}
