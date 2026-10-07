/**
 * 逻辑版门级引擎第 4 步：**有界延迟（事件驱动）门级仿真**。
 *
 * 为什么需要这一步：前 3 步（gate-logic → gate-netlist → gate-seq）把延迟**抹平成状态**，
 * 于是拿到的是"稳定之后的电平"。这在纯组合关和普通时序关上够用，但两件事做不了：
 *   ① 画布上看不见"信号一级一级传下去"（只有终点，没有过程）；
 *   ② 靠**延迟**振出来的时钟（s3-calc 的运算控制里那条反相链环形振荡器）在零延迟下
 *      代数上收敛成**静态电平**，"沿"消失了 → 八位寄存器要么一直保持、要么一直透明。
 * 本文件给每个门一个**微小但非零**的延迟，用事件队列推进时间 —— 仍是布尔逻辑（4 值、不比强弱），
 * 但"环"会一直转，"沿"是真实存在的物理量。
 *
 * ── 口径（实测拍板，见 /tmp 里的原型验证报告）──
 *  · 默认 `caliber: 'kind'`：按**门种类**取延迟，值取自各门 rtl 身体电路
 *    `analyzeTiming().criticalPathPs` 的实测值（见 GATE_DELAY_PS），换算成时间步
 *    `max(1, round(ps / 1000))`（时间轴单位 = 1ps）。
 *  · 默认 `semantics: 'inertial'`（惯性）：新事件**取消**旧的待发事件 —— 短于门延迟的毛刺被吃掉。
 *    实测：kind + inertial 下 19 个逻辑关的逐行数值与元件级 `Simulator` **完全一致**；
 *    换成 `transport`（传输）会把 9~10 关弄错（毛刺打进触发器）；换成 `unit`（每门 1 步）
 *    粒度太粗，s3-calc 仍错 2/67 行。所以产品默认 = kind + inertial。
 *  · `zeroDelay: true` 是**零延迟回退档**：不走事件队列，**直接调 `gate-seq.ts` 的
 *    `settleGateSteps`**（同一个引擎），所以结果与现有零延迟门级引擎逐网逐行一致
 *    （"有延迟门级 / 零延迟门级"可切换的基础）。
 *    为什么不是"在展平结构上自己求固定点"：gate-seq 是**逐层递归**求值的（每层各自迭代到固定点、
 *    各自"没收敛就退回上一趟"、各自的时序更新阶段在递归里就执行），展平后只剩**单层**固定点。
 *    移植时实测过展平版：19 关里 18 关与 settleGateSteps 逐网逐行完全一致，只有 s3-calc 不同
 *    （8174 处网值里 1982 处不同 —— 数字输入寄存器里的电平型锁存器在 gate-seq 的递归里
 *    "当拍透明"写进了状态，而单层固定点那一趟看到的使能已经是 0）。而 s3-calc 恰是**零延迟口径
 *    本身就不对**的那一关（实测：官方零延迟门级 58/67 行与元件级不同，展平版更差 66/67 行）。
 *    回退开关要的是"和现在这套逐位相同"，所以这一档复用同一个引擎，而不是去复刻分层求值的中间态。
 *
 * ── 两个约定（会咬人的地方，写在这里省得别人踩）──
 *  · **vcc/gnd**：有延迟档把它们当**恒定轨**（`rails: 'constant'`，跑出来才与元件级一致）；
 *    零延迟档**忽略**它们（`rails: 'ignore'`）—— 现有零延迟门级引擎在 `stepGateNetlist` 里
 *    跳过非 module 实例，那条网没有驱动、读出来是 0，两套引擎的口径必须一一对应，
 *    否则"零延迟等价"这条护栏会被这一条差异整片冲垮。
 *  · **引脚→网**：用并查集归并（同一引脚接多条网名 = 同一个节点；实例端口网 = 父层该脚所在网），
 *    于是整份设计被压成**单层**网表（叶子单元 = 门 / 功能原子 / 时序器件）。有延迟档就吃这份
 *    单层网表：延迟本身让"当前电平"随时存在，不需要再靠分层求值来定义"当拍"。
 *  · **状态跨进程**：`exportGateDelayState` / `importGateDelayState` 把状态摊成可 `postMessage` 的纯数据
 *    （`values` = 时序器件状态 + `nets` = 内部网表值）。重建引擎时**救回来的网值会灌回驱动它的输出槽** ——
 *    门搭的反馈环（交叉耦合与非门、门控锁存器）里一个时序器件都没有，它的状态**只住在网值里**；
 *    只还原"没驱动的网"会让每次重建都把环按 0/0 重启（实测：分两次跑时第二次直接振到事件上限）。
 *  · **SeqSpec**：时序器件（D锁存器 / 主从D触发器）要靠 `seqSpecs` 表才知道哪个脚是时钟、
 *    哪些是数据；没传表时如实报"没有 SeqSpec"（pre-check 也保守地一律拒绝），绝不猜。
 */

import type { Design, ModuleLibrary } from '@lc/schema';
import {
  B0,
  B1,
  type Bit,
  evalGate,
  type GateName,
  isFunctionAtom,
  isGateName,
  mergeDrivers,
  notBit,
} from './gate-logic.js';
import {
  evalAtomOutputs,
  type GateLibrary,
  type GateSeqSpec,
  needsSeqSpec,
} from './gate-netlist.js';
import { GateStateStore, settleGateSteps } from './gate-seq.js';
import type { TestVector, VectorMismatch, VectorRow } from './harness.js';
import type { Logic } from './signal.js';

/* ═════════════════════════ 1. 延迟表与口径 ═════════════════════════ */

/**
 * 门延迟表：按门种类（单位 ps）。
 *
 * 取值 = 各门 rtl 身体电路 `analyzeTiming(compileDesign(模板.body).net).criticalPathPs` 的**实测值**
 * （与模板自带的 criticalPathPs / delayPs 一致），不是拍的：
 *   非门 1500 / 与非门 2500 / 或非门 1500 / 与门 1600 / 或门 1600 / 异或门 6500 / 同或门 8000
 *   全加器 13000 / 多输入或门 1600（功能原子，按整块取关键路径）
 *   D锁存器 7000 / 主从D触发器 6500（时序器件按整块取；原型也**不逐输出端口**细分）
 */
export const GATE_DELAY_PS: Readonly<Record<string, number>> = {
  非门: 1500,
  与非门: 2500,
  或非门: 1500,
  与门: 1600,
  或门: 1600,
  异或门: 6500,
  同或门: 8000,
  全加器: 13000,
  多输入或门: 1600,
  D锁存器: 7000,
  主从D触发器: 6500,
};

/** 表里查不到的门/原子的兜底延迟（ps）：= 1 个 kind 时间步（常用值里的最小值量级）*/
export const DEFAULT_GATE_DELAY_PS = 1000;

/** kind 口径的换算基数：1 时间步 = 1000ps（时间轴单位 = 1ps，便于与元件级对齐读数）*/
const KIND_STEP_PS = 1000;

/** 默认事件上限（与 harness.ts 的 maxEventsPerVector 同量级）*/
const DEFAULT_MAX_EVENTS = 500_000;

/** 默认时间窗（ps）：1µs。带延迟的电路要留够慢路径走完的时间（关卡向量自带 settlePs 时以它为准）*/
const DEFAULT_WINDOW_PS = 1_000_000;

/** 延迟口径：`kind` = 按门种类（产品默认）；`unit` = 每门 1 步（仅对照用，粒度太粗）*/
export type GateDelayCaliber = 'kind' | 'unit';

/** 延迟语义：`inertial` = 惯性（默认，吃毛刺）；`transport` = 传输（毛刺照传，会把沿算错）*/
export type GateDelaySemantics = 'inertial' | 'transport';

/** vcc/gnd 怎么算：`constant` = 当恒定轨（有延迟档默认）；`ignore` = 忽略（与零延迟门级引擎一致）*/
export type GateDelayRails = 'constant' | 'ignore';

export interface GateDelayOptions {
  /** 延迟口径，默认 'kind'（按门种类）*/
  caliber?: GateDelayCaliber;
  /** 延迟语义，默认 'inertial'（惯性）*/
  semantics?: GateDelaySemantics;
  /** 每个窗口的事件上限，撞满即 capped（防振荡电路卡死），默认 500_000 */
  maxEvents?: number;
  /** 表里查不到的门/原子的兜底延迟（ps），默认 GATE_DELAY_PS 的常见值 1000 */
  defaultDelayPs?: number;
  /**
   * **零延迟回退档**（默认 false）：不走事件队列，改用 gate-seq 的 `settleGateSteps`
   * （**同一个引擎**，所以与现有零延迟门级引擎逐网逐行一致）。
   * 它作用于 `evalGateDelayed` / `evalGateVectorsDelayed` 两个入口；
   * `GateDelaySim` 只做有延迟档（它拿的是展平结构，够不着原设计的层次），传 true 会抛错。
   * 打开它时 caliber/semantics/windowPs 都不起作用（零延迟没有时间轴）。
   */
  zeroDelay?: boolean;
  /** vcc/gnd 的算法；缺省按 zeroDelay 自动取（false→'constant' / true→'ignore'）*/
  rails?: GateDelayRails;
  /**
   * **上电（power-up）怎样落地**，默认 `'auto'`：
   *
   * · `'delay'`：老行为 —— 所有单元同时按各自的延迟排队，彼此都只看得到**上一时刻的全 0 快照**。
   * · `'settle'`：上电按**确定性顺序**把每个单元的输出立刻算进去（零延迟地"顺一遍"），
   *   后面的单元看得见前面单元刚算出的值（网值就地刷新）。
   * · `'none'`：**不做上电**，直接从携带进来的状态继续传播（只绑输入、按延迟推进）。
   *   这是"**热帧**"该用的口径：状态里已经写着上电的结果，再"上电"一次就等于把电路重启一遍 ——
   *   实测 `s2-btn-latch` 在保持态（btn=0）下，热帧按 `'delay'` 重新上电会**对称自振到事件上限**
   *   （事件 500000、capped、画布显示 X），而按 `'none'` 继续是 0 事件、锁存值原样保持。
   * · `'auto'`（**默认**）：先按 `'delay'` 跑；**只有撞上事件上限**（= 延迟完全相同的对称环
   *   在上电处自振）才从头按 `'settle'` 重跑一次并采用它的结果。
   *
   * 为什么需要它（实测）：延迟完全相同的交叉耦合环在 `'delay'` 下会**对称振荡到事件上限**
   * （`s2-d-latch` 冷启动 `en=0`：events=500000 / capped=true，transport 口径同样）。
   * 那是"延迟完全匹配"的物理理想化产物，现实里器件微失配会打破对称 —— 按**确定性顺序**上电
   * 就是这个失配的等价物（顺序 = 网表顺序，可复现、可回退）。
   * 为什么默认不是 `'settle'`：`'settle'` 会改掉**能自己稳下来的电路**的逐行结论
   * （实测 `s2-sr-latch` 由 pass=true/0 错行 变成 pass=false/2 错行 —— 那是结论变化，不能默认）。
   * `'auto'` 下判定侧的向量全走 `'delay'` 那条路，逐行结论与老口径逐位相同。
   */
  powerUp?: 'auto' | 'settle' | 'delay' | 'none';
}

/** 入口选项 = 引擎选项 + 单次运行要带的东西（窗口长度、跨请求携带的状态）*/
export type GateDelayRunOptions = GateDelayOptions & {
  /** 本次运行的时间窗（ps），默认 1_000_000 */
  windowPs?: number;
  /** 跨请求携带的时序状态（复用 gate-seq 的 GateStateStore）*/
  state?: GateStateStore;
};

/** 展开后的选项（内部用，缺省值已填好）*/
interface ResolvedDelayOptions {
  caliber: GateDelayCaliber;
  semantics: GateDelaySemantics;
  maxEvents: number;
  defaultDelayPs: number;
  zeroDelay: boolean;
  rails: GateDelayRails;
  powerUp: 'auto' | 'settle' | 'delay' | 'none';
}

const resolveOptions = (opts: GateDelayOptions = {}): ResolvedDelayOptions => {
  const zeroDelay = opts.zeroDelay ?? false;
  return {
    caliber: opts.caliber ?? 'kind',
    semantics: opts.semantics ?? 'inertial',
    maxEvents: opts.maxEvents ?? DEFAULT_MAX_EVENTS,
    defaultDelayPs: opts.defaultDelayPs ?? DEFAULT_GATE_DELAY_PS,
    zeroDelay,
    rails: opts.rails ?? (zeroDelay ? 'ignore' : 'constant'),
    powerUp: opts.powerUp ?? 'auto',
  };
};

/** 一个叶子单元在本口径下的延迟（时间步；时间轴单位 = 1ps）*/
const stepDelayOf = (cell: GateDelayCell, o: ResolvedDelayOptions): number => {
  if (o.zeroDelay) return 0;
  if (o.caliber === 'unit') return 1;
  return Math.max(1, Math.round((cell.delayPs ?? o.defaultDelayPs) / KIND_STEP_PS));
};

/* ═════════════════════════ 2. 展平（Design → 单层网表） ═════════════════════════ */

interface PinRef {
  inst: string;
  pin: string;
  bit: number;
}

/** 单元的一个端口：按位给出它落在哪条（已归并的）网上，-1 = 悬空/没接 */
export interface GateDelayCellPort {
  name: string;
  width: number;
  nets: readonly number[];
}

/** 单元的一个输出槽位：`k` 是它在"整块输出位序"里的下标，`slot` 是全局槽号 */
export interface GateDelayCellSlot {
  k: number;
  slot: number;
  port: string;
  bit: number;
}

/**
 * 展平后的**叶子单元**（内部结构；调用方当它是透明的即可）：
 *  · `gate` = 7 个基础门（按真值函数逐位算，不展开身体）；
 *  · `atom` = 功能原子（全加器 / 多输入或门）；
 *  · `seq`  = 已声明 SeqSpec 的时序器件（按 mode/initial/map 建模）；
 *  · `rail` = **vcc/gnd 升格成的"零延迟常量原子"**（delayPs = 0，永远输出 1/0）——
 *    以前它们只是"合并进网值的常量"（`netConst`），现在是一条**真的驱动**：
 *    于是关卡/玩家电路里"用 vcc 给一个门喂常量 1"与门级口径**同一条路径**，
 *    画布与判定不会再出现"画布认轨、门级不认轨"的分歧（实测两者读数本来就一致，
 *    升格只是把它落成同一种机制）。
 */
export interface GateDelayCell {
  /** 实例路径（`外层/内层` 前缀），与 gate-seq 的 GateStateStore 键口径一致 */
  id: string;
  kind: 'gate' | 'atom' | 'seq' | 'rail';
  /** `kind === 'rail'` 时的常量值（vcc → 1，gnd → 0）*/
  rail?: Bit;
  /** 模块名（门名 / 原子名 / 时序器件名）*/
  name: string;
  seq?: GateSeqSpec;
  ins: readonly GateDelayCellPort[];
  outs: readonly GateDelayCellPort[];
  outSlots: readonly GateDelayCellSlot[];
  /** rtl 身体关键路径实测延迟（ps）；表里没有就是 undefined（运行时按 defaultDelayPs 兜底）*/
  delayPs?: number;
}

/**
 * 展平结果（**内部结构**：字段会随实现调整，外部只该把它原样传给 GateDelaySim / 两个入口）。
 */
export interface GateDelayFlat {
  cells: readonly GateDelayCell[];
  /** 归并后的节点数 */
  netCount: number;
  /** net → 驱动它的输出槽号 */
  netSlots: readonly (readonly number[])[];
  /** slot → net（-1 = 悬空）*/
  slotNet: readonly number[];
  /** net → 读它的单元下标 */
  netReaders: readonly (readonly number[])[];
  /** vcc/gnd 轨所在的 net → 恒定值 */
  netConst: ReadonlyMap<number, Bit>;
  /** 网名（含 `外层/内层` 前缀）→ 归并后的 net */
  netIdxByKey: ReadonlyMap<string, number>;
  /** net → 一个代表网名（回写状态用；同一节点的多个网名取最短的那个）*/
  netKeys: readonly string[];
  /** 顶层端口（按位绑 net）*/
  ports: readonly { name: string; dir: 'in' | 'out'; width: number; nets: readonly number[] }[];
  /** 人类可读的"不支持"原因（空数组 = 可仿真）*/
  unsupported: readonly string[];
  /** 展平时数到的 vcc/gnd 实例数 */
  railCount: number;
}

export interface GateDelayFlatten {
  /** 展平结构（内部细节不外露，原样喂给 GateDelaySim / evalGateDelayed 即可）*/
  flat: GateDelayFlat;
  /** 人类可读的"不支持"原因，空数组 = 可仿真 */
  unsupported: readonly string[];
}

/**
 * 把 `Design` 展平成**单层**网表：递归展开模块 body 直到只剩
 * 门 / 功能原子 / 已声明 SeqSpec 的时序器件；引脚→网用并查集归并。
 *
 * 不支持的三种情形**如实记录**（不猜、不近似）：顶层或任一层的元件（unit）、
 * 库里查不到的模块、需要 SeqSpec 却没拿到的时序模块。
 *
 * 展平是**一次性成本**（实测 s3-calc：556 单元 / 666 网 / 20 轨，约 6.5ms）：要连续跑很多窗口/帧的
 * 调用方应当自己缓存这个结果。
 */
export const flattenGateNetlist = (
  design: Design,
  library: ModuleLibrary,
  seqSpecs: Readonly<Record<string, GateSeqSpec>> = {},
): GateDelayFlatten => {
  const uf = new Map<string, string>();
  const find = (k: string): string => {
    let r = uf.get(k);
    if (r === undefined) {
      uf.set(k, k);
      return k;
    }
    while (r !== k) {
      k = r;
      r = uf.get(k) as string;
    }
    return r;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) uf.set(ra, rb);
  };

  const netPins = new Map<string, PinRef[]>();
  const leaf = new Map<
    string,
    {
      kind: GateDelayCell['kind'];
      name: string;
      seq?: GateSeqSpec;
      ports: { name: string; dir: 'in' | 'out'; width: number }[];
    }
  >();
  const rails: { qid: string; v: Bit }[] = [];
  const unsupported: string[] = [];

  const visit = (d: Design, prefix: string): void => {
    for (const net of d.nets) {
      const key = prefix + net.id;
      find(key);
      const list = netPins.get(key) ?? [];
      for (const p of net.pins) list.push({ inst: prefix + p.inst, pin: p.pin, bit: p.bit ?? 0 });
      netPins.set(key, list);
    }
    for (const inst of d.instances) {
      const qid = prefix + inst.id;
      if (inst.kind === 'unit') {
        unsupported.push(`元件 ${qid}（${inst.unit}）：门级引擎算不了`);
        continue;
      }
      if (inst.kind === 'vcc' || inst.kind === 'gnd') {
        // 升格为零延迟常量原子：既进 rails（老路径：合并进网值 + 输入绑定守卫），
        // 也是一条真驱动（下面按网建 cell）。
        rails.push({ qid, v: inst.kind === 'vcc' ? B1 : B0 });
        leaf.set(qid, {
          kind: 'rail',
          name: inst.kind === 'vcc' ? 'vcc' : 'gnd',
          ports: [{ name: 'p', dir: 'out', width: 1 }],
        });
        continue;
      }
      if (inst.kind !== 'module') continue;
      // 一个实例可以同时接多条网名（元件级里它们是同一个节点）—— 引脚→网是一对多，
      // 这里靠并查集把多条网名并成一个节点，正是元件的 flatten 做的事。
      const mod = library.get(inst.module);
      if (!mod) {
        unsupported.push(`库里找不到模块 ${inst.module}（${qid}）`);
        continue;
      }
      const ports = mod.ports.map((p) => ({ name: p.name, dir: p.dir, width: p.width }));
      if (isGateName(mod.name)) {
        leaf.set(qid, { kind: 'gate', name: mod.name, ports });
        continue;
      }
      if (isFunctionAtom(mod.name)) {
        leaf.set(qid, { kind: 'atom', name: mod.name, ports });
        continue;
      }
      if (needsSeqSpec(mod)) {
        const spec = seqSpecs[mod.name];
        if (!spec) {
          unsupported.push(`时序模块【${mod.name}】（${qid}）没有 SeqSpec：如实不支持`);
          continue;
        }
        leaf.set(qid, { kind: 'seq', name: mod.name, seq: spec, ports });
        continue;
      }
      const body = mod.body;
      if (!body) {
        unsupported.push(`模块【${mod.name}】（${qid}）没有内部电路`);
        continue;
      }
      visit(body, `${prefix}${inst.id}/`);
      // 端口连接：body 端口绑的内层网 ↔ 父层「该实例该脚所在网」
      for (const bp of body.ports) {
        const mp = ports.find((p) => p.name === bp.name);
        const w = Math.max(1, mp?.width ?? bp.width ?? 1);
        for (let b = 0; b < w; b++) {
          const innerNet = bp.nets[b];
          if (innerNet === undefined) continue;
          for (const net of d.nets) {
            if (
              net.pins.some((p) => p.inst === inst.id && p.pin === bp.name && (p.bit ?? 0) === b)
            ) {
              union(`${prefix}${inst.id}/${innerNet}`, prefix + net.id);
            }
          }
        }
      }
    }
  };
  visit(design, '');

  const rootIdx = new Map<string, number>();
  const rootPins: PinRef[][] = [];
  const idxOfKey = (key: string): number => {
    const r = find(key);
    let i = rootIdx.get(r);
    if (i === undefined) {
      i = rootIdx.size;
      rootIdx.set(r, i);
      rootPins.push([]);
    }
    return i;
  };
  for (const key of uf.keys()) idxOfKey(key);
  for (const [key, pins] of netPins) {
    const i = idxOfKey(key);
    // 只有叶子单元的引脚才算「读这条网」；复合实例的引脚已经在递归里落到内层网上了
    for (const p of pins) if (leaf.has(p.inst)) (rootPins[i] as PinRef[]).push(p);
  }
  // vcc/gnd 各自接在哪条网上 → 那条网（归并后的节点）是恒定轨（`netConst` 仍作为兜底合并）
  const netConst = new Map<number, Bit>();
  const railNet = new Map<string, number>();
  for (const rail of rails) {
    for (const [key, pins] of netPins) {
      if (pins.some((p) => p.inst === rail.qid)) {
        const idx = idxOfKey(key);
        netConst.set(idx, rail.v);
        railNet.set(rail.qid, idx);
      }
    }
  }

  const netIdxByKey = new Map<string, number>();
  const netKeys: string[] = [];
  const rememberKey = (key: string, idx: number): void => {
    const cur = netKeys[idx];
    if (cur === undefined || key.length < cur.length || (key.length === cur.length && key < cur)) {
      netKeys[idx] = key;
    }
  };
  for (const key of uf.keys()) {
    const i = idxOfKey(key);
    netIdxByKey.set(key, i);
    rememberKey(key, i);
  }
  for (const [key] of netPins) {
    const i = idxOfKey(key);
    netIdxByKey.set(key, i);
    rememberKey(key, i);
  }

  const pinNet = new Map<string, number>();
  for (let i = 0; i < rootPins.length; i++) {
    for (const p of rootPins[i] as PinRef[]) pinNet.set(`${p.inst}/${p.pin}/${p.bit}`, i);
  }

  const cells: GateDelayCell[] = [];
  const netSlots: number[][] = Array.from({ length: rootPins.length }, () => []);
  const slotNet: number[] = [];
  let slotCount = 0;
  for (const [qid, info] of leaf) {
    const mk = (p: { name: string; dir: 'in' | 'out'; width: number }): GateDelayCellPort => ({
      name: p.name,
      width: Math.max(1, p.width),
      nets: Array.from(
        { length: Math.max(1, p.width) },
        (_, b) => pinNet.get(`${qid}/${p.name}/${b}`) ?? -1,
      ),
    });
    const ins = info.ports.filter((p) => p.dir === 'in').map(mk);
    const outs = info.ports.filter((p) => p.dir === 'out').map(mk);
    const outSlots: GateDelayCellSlot[] = [];
    let k = 0;
    for (const p of outs) {
      for (let b = 0; b < p.width; b++) {
        const slot = slotCount++;
        slotNet.push(p.nets[b] ?? -1);
        outSlots.push({ k: k++, slot, port: p.name, bit: b });
        const net = p.nets[b] ?? -1;
        if (net >= 0) (netSlots[net] as number[]).push(slot);
      }
    }
    const isRail = info.kind === 'rail';
    const ps = isRail ? 0 : GATE_DELAY_PS[info.name];
    const railV = isRail ? (rails.find((r) => r.qid === qid)?.v ?? B0) : undefined;
    cells.push({
      id: qid,
      kind: info.kind,
      name: info.name,
      ...(info.seq ? { seq: info.seq } : {}),
      ...(railV !== undefined ? { rail: railV } : {}),
      ins,
      outs,
      outSlots,
      ...(ps !== undefined ? { delayPs: ps } : {}),
    });
  }

  const netReaders: number[][] = Array.from({ length: rootPins.length }, () => []);
  cells.forEach((c, ci) => {
    const seen = new Set<number>();
    for (const p of c.ins) {
      for (const n of p.nets) {
        if (n < 0 || seen.has(n)) continue;
        seen.add(n);
        (netReaders[n] as number[]).push(ci);
      }
    }
  });

  const ports = design.ports.map((p) => {
    const w = Math.max(1, p.width ?? 1);
    return {
      name: p.name,
      dir: p.dir,
      width: w,
      nets: Array.from({ length: w }, (_, b) => {
        const nid = p.nets[b];
        return nid === undefined ? -1 : (netIdxByKey.get(nid) ?? -1);
      }),
    };
  });

  const flat: GateDelayFlat = {
    cells,
    netCount: rootPins.length,
    netSlots,
    slotNet,
    netReaders,
    netConst,
    netIdxByKey,
    netKeys,
    ports,
    unsupported,
    railCount: rails.length,
  };
  return { flat, unsupported };
};

/* ═════════════════════════ 3. 单元求值（两条引擎共用） ═════════════════════════ */

type NetRead = (net: number) => Bit;

const netBit = (read: NetRead, net: number): Bit => (net >= 0 ? read(net) : B0);

const inputBits = (c: GateDelayCell, read: NetRead): Bit[][] =>
  c.ins.map((p) => Array.from({ length: p.width }, (_, b) => netBit(read, p.nets[b] ?? -1)));

const portBitsOf = (c: GateDelayCell, name: string, read: NetRead): Bit[] => {
  const p = c.ins.find((x) => x.name === name);
  const w = Math.max(1, p?.width ?? 1);
  return Array.from({ length: w }, (_, b) => netBit(read, p?.nets[b] ?? -1));
};

const outK = (c: GateDelayCell, port: string, bit: number): number | undefined =>
  c.outSlots.find((s) => s.port === port && s.bit === bit)?.k;

/** 组合单元（7 个基础门 / 全加器 / 多输入或门）的输出值，按 outSlots 的 k 排列 */
const evalCombCell = (c: GateDelayCell, read: NetRead): Bit[] => {
  const out = Array.from({ length: c.outSlots.length }, (): Bit => B0);
  // vcc/gnd（零延迟常量原子）：不读任何输入，永远输出常量（vcc → 1，gnd → 0）
  if (c.kind === 'rail') {
    for (let k = 0; k < out.length; k++) out[k] = c.rail ?? B0;
    return out;
  }
  const inBits = inputBits(c, read);
  if (c.kind === 'atom') {
    const atomOut = evalAtomOutputs(c.name, c.ins, c.outs, inBits);
    if (atomOut) {
      c.outs.forEach((p, i) => {
        for (let b = 0; b < p.width; b++) {
          const k = outK(c, p.name, b);
          if (k !== undefined) out[k] = atomOut[i]?.[b] ?? 'X';
        }
      });
      return out;
    }
  }
  c.outs.forEach((p) => {
    for (let b = 0; b < p.width; b++) {
      const k = outK(c, p.name, b);
      if (k === undefined) continue;
      out[k] = evalGate(
        c.name as GateName,
        c.ins.map((_p, i) => inBits[i]?.[b] ?? 'X'),
      );
    }
  });
  return out;
};

/** 反相输出口（seq 的 map 里写 `!qn` 的那种）*/
const invertedPortsOf = (spec: GateSeqSpec): ReadonlySet<string> => {
  const inverted = new Set<string>();
  for (const targets of Object.values(spec.map ?? {})) {
    for (const t of Array.isArray(targets) ? targets : [targets]) {
      if (t.startsWith('!')) inverted.add(t.slice(1));
    }
  }
  return inverted;
};

/** 时序器件的上电初值（initial + `!qn` 反相输出）*/
const seqInitLocal = (c: GateDelayCell): Bit[] => {
  const spec = c.seq as GateSeqSpec;
  const base: Bit = spec.initial === '1' ? B1 : B0;
  const inverted = invertedPortsOf(spec);
  const out = Array.from({ length: c.outSlots.length }, (): Bit => B0);
  for (const s of c.outSlots) {
    out[s.k] = inverted.has(s.port) ? (base === B1 ? B0 : B1) : base;
  }
  return out;
};

/** 时序器件的候选状态 = 以 cur 为底，按 SeqSpec 的 map 写入数据（含 `!` 反相）*/
const seqNextLocal = (c: GateDelayCell, cur: Bit[], read: NetRead): Bit[] => {
  const spec = c.seq as GateSeqSpec;
  const out = cur.slice();
  const sole = spec.data.length === 1 && c.outs.length === 1 ? c.outs[0]?.name : undefined;
  for (const dataPort of spec.data) {
    const src = portBitsOf(c, dataPort, read);
    const mapped = spec.map?.[dataPort];
    const targets =
      mapped === undefined ? [sole ?? dataPort] : Array.isArray(mapped) ? mapped : [mapped];
    for (const raw of targets) {
      const invert = raw.startsWith('!');
      const target = invert ? raw.slice(1) : raw;
      const dst = c.outs.find((p) => p.name === target);
      const w = Math.max(1, dst?.width ?? 1);
      for (let b = 0; b < w; b++) {
        const v = (src[b] ?? 'X') as Bit;
        const k = outK(c, target, b);
        if (k !== undefined) out[k] = invert ? notBit(v) : v;
      }
    }
  }
  return out;
};

/* ═════════════════════════ 4. 状态存取（GateStateStore）与跨进程序列化 ═════════════════════════ */

/**
 * 跨请求携带状态就靠 gate-seq 的 GateStateStore：键口径与 gate-seq **完全一致**
 * （时序器件的状态 = `实例路径/端口#位`、时钟 = `实例路径/__clk`），所以同一个 store
 * 在两套引擎之间能接得上；网表值存在它的 `netsOf('')` 里（键 = 展平后的网名）。
 *
 * 为什么要单独有一张网表值：**门搭的反馈环没有"时序器件"可存** —— 交叉耦合的
 * 与非门 / 或非门锁存器里一个 seq 单元都没有，它的状态**只住在网值里**；
 * 只存 `values`（`snapshot()` 的内容）会在跨进程/跨请求时把它丢掉。
 */
const NET_PATH = '';

/**
 * 电平归一：`Bit = 0 | 1 | 'X' | 'Z'` —— **0/1 是数字**（`B0`/`B1`），X/Z 才是字符串。
 *
 * 为什么要容错字符串 `'0'`/`'1'`：跨进程/跨存储的那份数据在类型上不可信，
 * 万一中间某层把电平转成了字符串，严格拒绝就会退化成"每次点击回上电初值"这种
 * 极难查的现象；而 `'0'`/`'1'` 与 `0`/`1` 的对应是**无歧义**的（合法电平里没有字符串 '0'/'1'），
 * 认下来不会把好数据搞坏。其余（`'x'` 小写、`'嗯'`、`null`…）按"没有这条状态"丢掉。
 * （第一版只认字符串 '0'/'1'/'X'/'Z'，把数字 0/1 全丢了、导出状态是空的 —— 测试当场抓到。）
 */
const normalizeBit = (v: unknown): Bit | undefined => {
  if (v === 0 || v === '0') return 0;
  if (v === 1 || v === '1') return 1;
  return v === 'X' || v === 'Z' ? v : undefined;
};

/**
 * **可跨 `postMessage` 往返的纯数据状态**（值 + 按路径隔离的内部 net 表）。
 *
 * 全是字符串/普通对象 —— `structuredClone` / JSON / postMessage 都能过（现场测过）。
 */
export interface GateDelayStateData {
  /** 时序器件状态（`实例路径/端口#位`、`实例路径/__clk`）= `GateStateStore.snapshot()` */
  values: Record<string, Bit>;
  /** 按路径隔离的内部 net 表：`路径 → (网名 → 值)` */
  nets: Record<string, Record<string, Bit>>;
}

/**
 * 把 `GateStateStore` 摊成纯数据（Web Worker 那边 `postMessage` 之前调它）。
 *
 * 诚实交代两件事：
 *  ① `values` 是**完整**的（就是公开的 `snapshot()`）。
 *  ② 私有的 per-path net 表**没有枚举接口** —— `GateStateStore` 只提供 `netsOf(path)`
 *     （按路径取/建），拿不到"有哪些路径"。所以这里导出的是 `paths` **点名的那些路径**，
 *     默认 = 延迟引擎自己用的那一条（`''`，键 = 展平后的网名）。
 *     对"画布 + Worker 跑有延迟档"这个场景，默认参数导出的就是**全量**；
 *     但如果同一个 store 还被 gate-seq 的**分层递归**写过（例如切到 `zeroDelay` 档），
 *     那些层路径（`'mod6/'`、`'mod6/mod2/'`…）需要调用方自己把路径传进来
 *     （路径可以从设计树的实例路径推出来）—— 传不全就会丢那一层的内部网值。
 *
 * 另一条硬约束：**事件队列不在这份数据里**（只带状态、不带"将要落地的事件"）。
 * 请在一个窗口跑到静止后再导出（`advance().quiescent` 为真 / `queueSize() === 0`），
 * 否则没落地的事件会丢。s2-d-latch、与非门交叉耦合锁存器这类静态电路
 * （上电瞬态走完就静止）不受影响，见测试里的"跨进程往返"用例。
 */
export const exportGateDelayState = (
  state: GateStateStore,
  paths: readonly string[] = [NET_PATH],
): GateDelayStateData => {
  const nets: Record<string, Record<string, Bit>> = {};
  for (const path of paths) {
    const table = state.netsOf(path);
    const clean: Record<string, Bit> = {};
    for (const [key, v] of table) {
      const bit = normalizeBit(v);
      if (bit !== undefined) clean[key] = bit;
    }
    nets[path] = clean;
  }
  const values: Record<string, Bit> = {};
  for (const [key, v] of Object.entries(state.snapshot())) {
    const bit = normalizeBit(v);
    if (bit !== undefined) values[key] = bit;
  }
  return { values, nets };
};

/**
 * 把纯数据装回一台可用的 `GateStateStore`（Worker 收到 `postMessage` 之后调它）。
 *
 * 口径：
 *  · `values` 直接灌进 `GateStateStore` 的构造入参（那正是同一套复合键，不做任何拆分/猜测）；
 *  · `nets` 逐路径写回 `netsOf(path)`，空表/非法电平的路径**不建**（不给脏数据留内存）。
 *  · `data === undefined`（画布第一帧）→ 一台干净的新 store（引擎按 SeqSpec 的上电初值起步）。
 *  · 跨进程数据在类型上不可信：不认识的电平（不是 `0/1/X/Z`）按"没有这条状态"丢掉 ——
 *    宁可退回上电初值，也不把脏值灌进引擎。
 */
export const importGateDelayState = (data?: GateDelayStateData): GateStateStore => {
  const values: Record<string, Bit> = {};
  for (const [key, v] of Object.entries(data?.values ?? {})) {
    const bit = normalizeBit(v);
    if (bit !== undefined) values[key] = bit;
  }
  const store = new GateStateStore(values);
  for (const [path, table] of Object.entries(data?.nets ?? {})) {
    const clean: [string, Bit][] = [];
    for (const [key, v] of Object.entries(table ?? {})) {
      const bit = normalizeBit(v);
      if (bit !== undefined) clean.push([key, bit]);
    }
    if (clean.length === 0) continue;
    const m = store.netsOf(path);
    for (const [key, v] of clean) m.set(key, v);
  }
  return store;
};

const loadStateInto = (
  flat: GateDelayFlat,
  state: GateStateStore,
  seqVal: Bit[][],
  seqClk: Bit[],
): void => {
  flat.cells.forEach((c, ci) => {
    if (c.kind !== 'seq' || !c.seq) return;
    const init = seqInitLocal(c);
    c.outSlots.forEach((s, i) => {
      const saved = state.get(c.id, s.port, s.bit);
      (seqVal[ci] as Bit[])[i] = saved ?? (init[i] as Bit);
    });
    seqClk[ci] = state.getClock(c.id) ?? 'Z';
  });
};

const saveStateFrom = (
  flat: GateDelayFlat,
  state: GateStateStore,
  seqVal: readonly Bit[][],
  seqClk: readonly Bit[],
): void => {
  flat.cells.forEach((c, ci) => {
    if (c.kind !== 'seq' || !c.seq) return;
    const vals = seqVal[ci] as Bit[];
    c.outSlots.forEach((s, i) => {
      state.set(c.id, s.port, vals[i] as Bit, s.bit);
    });
    state.setClock(c.id, seqClk[ci] as Bit);
  });
};

/* ═════════════════════════ 5. 有延迟引擎（事件驱动 + 小顶堆） ═════════════════════════ */

export interface GateDelayEdge {
  atPs: number;
  value: Bit;
}

export interface GateDelayAdvance {
  /** 本窗口处理的事件数（含惯性语义下被取消的那些）*/
  events: number;
  /** 窗口结束时刻（ps）*/
  timePs: number;
  /** 撞上事件上限 → 没稳定（UI 应提示"仍在振荡"）*/
  capped: boolean;
  /** 队列空了（真的跑到静止）*/
  quiescent: boolean;
  /** 组合阶段在迭代上限内没收敛（组合环/振荡）→ 判定不可信（与 settleGateSteps 的 unstable 同向）*/
  unstable?: boolean;
  reason?: string;
}

interface DelayEvent {
  t: number;
  cell: number;
  gen: number;
  payload: Bit[];
}

/** 时间戳小顶堆（同刻事件按入堆顺序出，够用且稳定）*/
class EventHeap {
  private readonly a: DelayEvent[] = [];
  get size(): number {
    return this.a.length;
  }
  peek(): DelayEvent | undefined {
    return this.a[0];
  }
  push(e: DelayEvent): void {
    this.a.push(e);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.a[i] as DelayEvent).t >= (this.a[p] as DelayEvent).t) break;
      const t = this.a[i] as DelayEvent;
      this.a[i] = this.a[p] as DelayEvent;
      this.a[p] = t;
      i = p;
    }
  }
  pop(): DelayEvent {
    const top = this.a[0] as DelayEvent;
    const last = this.a.pop() as DelayEvent;
    if (this.a.length > 0) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.a.length && (this.a[l] as DelayEvent).t < (this.a[m] as DelayEvent).t) m = l;
        if (r < this.a.length && (this.a[r] as DelayEvent).t < (this.a[m] as DelayEvent).t) m = r;
        if (m === i) break;
        const t = this.a[i] as DelayEvent;
        this.a[i] = this.a[m] as DelayEvent;
        this.a[m] = t;
        i = m;
      }
    }
    return top;
  }
}

/** 引擎对上层要暴露的东西（有延迟档实现；零延迟档由 asGateLibrary + settleGateSteps 承担）*/
interface DelayEngine {
  setInputs(inputs: ReadonlyMap<string, Bit[]>): void;
  advance(protocol: 'window' | 'quiesce', windowPs: number, maxEvents: number): GateDelayAdvance;
  saveState(): void;
  nets(): ReadonlyMap<string, Bit>;
  outPorts(): ReadonlyMap<string, Bit[]>;
  netValue(netId: string): Bit;
  /** 观测一条网的跳变（有延迟档才有时间轴）*/
  watch(netId: string): void;
  edgesOf(netId: string): readonly GateDelayEdge[];
  timePs: number;
  eventCount: number;
  queueSize(): number;
}

/**
 * 有延迟引擎：每个输出变化按本单元的延迟排队（transport：到点照发；
 * inertial：更新的触发取消旧的待发事件 —— 短于门延迟的毛刺被吃掉）。
 */
class DelayedEngine implements DelayEngine {
  private readonly flat: GateDelayFlat;
  private readonly opts: ResolvedDelayOptions;
  private readonly state: GateStateStore;
  private readonly delaySteps: number[];
  private readonly slotVal: Bit[];
  private readonly cellLast: Bit[][];
  private readonly cellGen: number[];
  private readonly lastClk: Bit[];
  private readonly netVal: Bit[];
  private readonly baseVal: (Bit | undefined)[];
  private readonly heap = new EventHeap();
  private readonly watched = new Map<number, GateDelayEdge[]>();
  private time = 0;
  private events = 0;
  private started = false;

  constructor(flat: GateDelayFlat, opts: ResolvedDelayOptions, state: GateStateStore) {
    this.flat = flat;
    this.opts = opts;
    this.state = state;
    this.delaySteps = flat.cells.map((c) => stepDelayOf(c, opts));
    const slots = flat.cells.reduce((n, c) => n + c.outSlots.length, 0);
    this.slotVal = Array.from({ length: slots }, (): Bit => B0);
    this.cellLast = flat.cells.map((c) => Array.from({ length: c.outSlots.length }, (): Bit => B0));
    this.cellGen = flat.cells.map(() => 0);
    this.lastClk = flat.cells.map((): Bit => 'Z');
    loadStateInto(flat, state, this.cellLast, this.lastClk);
    // 没驱动的网**保持上一次的值**（与 gate-seq 同口径）：上次的值从状态里带过来
    const saved = state.netsOf(NET_PATH);
    this.baseVal = Array.from({ length: flat.netCount }, (_, i): Bit | undefined =>
      saved.get(flat.netKeys[i] ?? ''),
    );
    /**
     * ★ 把**救回来的网值灌进驱动它的输出槽** —— 这是"状态能跨请求/跨进程续跑"的关键一步。
     *
     * 为什么必须做：门搭的反馈环（交叉耦合与非门/或非门、门控锁存器）里**一个时序器件都没有**，
     * 它的状态**只住在网值里**；只把网值塞进 `baseVal`（那是"没驱动的网保持上一次值"用的）
     * 而让各单元的 `slotVal` 从 0 起，等于每次重建引擎都把环按 0/0 重启 ——
     * 实测表现就是"分两次跑"里第二次直接振到事件上限（0/0 喂进交叉耦合与非门会一直翻转）。
     *
     * 口径：每个输出槽按它驱动的网的**归并值**还原。静止态下这是自洽的 ——
     * 归并一组相同的值仍是那个值（`mergeDrivers([v,v,…]) === v`），所以 `mergedValue` 立刻复现
     * 救回来的电平、不会凭空产生一次跳变；多驱动争抢（网是 X）时各驱动的"上次输出"都按 X 还原，
     * 下一次真触发会各自算回真值，只是中间的"上次输出"记账偏保守。
     */
    for (let s = 0; s < flat.slotNet.length; s++) {
      const net = flat.slotNet[s] as number;
      const v = net >= 0 ? this.baseVal[net] : undefined;
      if (v !== undefined) this.slotVal[s] = v;
    }
    flat.cells.forEach((c, ci) => {
      if (c.kind === 'seq' && c.seq) {
        // 时序器件：**器件自身状态优先**（loadStateInto 已从 values 里取出来）
        const vals = this.cellLast[ci] as Bit[];
        c.outSlots.forEach((s, i) => {
          this.slotVal[s.slot] = vals[i] as Bit;
        });
        return;
      }
      // 组合单元：静止态下"上次算出的输出" == "已落地的输出" == 该网的电平
      const last = this.cellLast[ci] as Bit[];
      c.outSlots.forEach((s, i) => {
        last[i] = this.slotVal[s.slot] as Bit;
      });
    });
    this.netVal = Array.from({ length: flat.netCount }, (_, i) => this.mergedValue(i));
  }

  private mergedValue(net: number): Bit {
    if (net < 0) return B0; // 悬空引脚按 0（与 makePinIndex 的约定一致）
    const vals: Bit[] = (this.flat.netSlots[net] as readonly number[]).map(
      (s) => this.slotVal[s] as Bit,
    );
    if (this.opts.rails === 'constant') {
      const c = this.flat.netConst.get(net);
      if (c !== undefined) vals.push(c);
    }
    if (vals.length === 0) return this.baseVal[net] ?? B0;
    return mergeDrivers(vals);
  }

  private read: NetRead = (net) => this.netVal[net] as Bit;

  watch(netId: string): void {
    const net = this.flat.netIdxByKey.get(netId);
    if (net === undefined) return;
    if (!this.watched.has(net)) this.watched.set(net, []);
  }

  edgesOf(netId: string): readonly GateDelayEdge[] {
    const net = this.flat.netIdxByKey.get(netId);
    return (net === undefined ? undefined : this.watched.get(net)) ?? [];
  }

  netValue(netId: string): Bit {
    const net = this.flat.netIdxByKey.get(netId);
    return net === undefined ? B0 : (this.netVal[net] as Bit);
  }

  nets(): ReadonlyMap<string, Bit> {
    const out = new Map<string, Bit>();
    for (const [key, net] of this.flat.netIdxByKey) out.set(key, this.netVal[net] as Bit);
    return out;
  }

  outPorts(): ReadonlyMap<string, Bit[]> {
    const out = new Map<string, Bit[]>();
    for (const p of this.flat.ports) {
      if (p.dir !== 'out') continue;
      out.set(
        p.name,
        p.nets.map((n) => (n < 0 ? B0 : (this.netVal[n] as Bit))),
      );
    }
    return out;
  }

  get timePs(): number {
    return this.time;
  }

  get eventCount(): number {
    return this.events;
  }

  queueSize(): number {
    return this.heap.size;
  }

  private evalCell(ci: number): Bit[] {
    const c = this.flat.cells[ci] as GateDelayCell;
    if (c.kind === 'seq') {
      const spec = c.seq as GateSeqSpec;
      const clk = portBitsOf(c, spec.clock, this.read)[0] ?? B0;
      const prev = this.lastClk[ci] as Bit;
      const active = spec.mode === 'level' ? clk === 1 : prev === 0 && clk === 1;
      // lastClk 必须在**每次触发**时推进（否则 1→0 那次被"负载相同"提前返回掉，后面的 0→1 就认不出沿）
      this.lastClk[ci] = clk;
      return active
        ? seqNextLocal(c, this.cellLast[ci] as Bit[], this.read)
        : (this.cellLast[ci] as Bit[]);
    }
    return evalCombCell(c, this.read);
  }

  private trigger(ci: number, t: number): void {
    const payload = this.evalCell(ci);
    const last = this.cellLast[ci] as Bit[];
    let same = payload.length === last.length;
    if (same) {
      for (let k = 0; k < payload.length; k++) {
        if (payload[k] !== last[k]) {
          same = false;
          break;
        }
      }
    }
    if (same) return;
    const d = this.delaySteps[ci] as number;
    if (this.opts.semantics === 'inertial') {
      this.cellGen[ci] = (this.cellGen[ci] as number) + 1;
      this.heap.push({ t: t + d, cell: ci, gen: this.cellGen[ci] as number, payload });
    } else {
      this.heap.push({ t: t + d, cell: ci, gen: 0, payload });
    }
    this.cellLast[ci] = payload.slice();
  }

  /** 应用 t 时刻的所有事件，并把「网值真变了」的扇出单元在 t 时刻触发 */
  /** 把 t 时刻的一批事件落地，并把「网值真变了」的扇出单元在 t 时刻触发 */
  private apply(batch: readonly DelayEvent[], t: number): void {
    const dirty = new Set<number>();
    for (const ev of batch) {
      this.events++;
      if (this.opts.semantics === 'inertial' && ev.gen !== (this.cellGen[ev.cell] as number))
        continue;
      const c = this.flat.cells[ev.cell] as GateDelayCell;
      for (const s of c.outSlots) {
        const v = ev.payload[s.k] as Bit;
        if (this.slotVal[s.slot] === v) continue;
        this.slotVal[s.slot] = v;
        const net = this.flat.slotNet[s.slot] as number;
        if (net >= 0) dirty.add(net);
      }
    }
    for (const net of dirty) {
      const v = this.mergedValue(net);
      if (this.netVal[net] === v) continue;
      this.netVal[net] = v;
      this.watched.get(net)?.push({ atPs: t, value: v });
      for (const ci of this.flat.netReaders[net] as readonly number[]) this.trigger(ci, t);
    }
  }

  /**
   * 上电顺一遍（零延迟、按网表顺序）：见 `GateDelayOptions.powerUp` 的实测依据。
   * 顺序确定 ⇒ 结果可复现；只有**首次**运行做这一步，之后的传播一律走正常延迟。
   */
  private powerUpSettle(): void {
    const dirty = new Set<number>();
    for (let ci = 0; ci < this.flat.cells.length; ci++) {
      const c = this.flat.cells[ci] as GateDelayCell;
      const payload = this.evalCell(ci);
      const last = this.cellLast[ci] as Bit[];
      const touched = new Set<number>();
      for (let k = 0; k < c.outSlots.length; k++) {
        const s = c.outSlots[k];
        if (s === undefined) continue;
        const v = payload[k] as Bit;
        last[k] = v;
        if (this.slotVal[s.slot] === v) continue;
        this.slotVal[s.slot] = v;
        const net = this.flat.slotNet[s.slot] as number;
        if (net >= 0) touched.add(net);
      }
      // ★ 必须**就地**把网值刷新 —— 单元之间靠 `netVal` 互相读取（`read` 就是 `netVal`），
      //   如果攒到最后再刷，后面的单元照样只看得到上电快照，对称环就还会振（实测过：那样
      //   settle 与 delay 都是 capped=true）。
      for (const net of touched) {
        const v = this.mergedValue(net);
        if (this.netVal[net] === v) continue;
        this.netVal[net] = v;
        this.watched.get(net)?.push({ atPs: 0, value: v });
        dirty.add(net);
      }
    }
    // 上电就变过的网：扇出单元从 t=0 起按各自的延迟正常传播（不再是零延迟）
    for (const net of dirty) {
      for (const ci of this.flat.netReaders[net] as readonly number[]) this.trigger(ci, 0);
    }
  }

  /** 绑输入（未给的位按 Z）+ 首次调用时做上电触发 */
  setInputs(inputs: ReadonlyMap<string, Bit[]>): void {
    for (const p of this.flat.ports) {
      if (p.dir !== 'in') continue;
      const vals = inputs.get(p.name) ?? [];
      for (let b = 0; b < p.width; b++) {
        const net = p.nets[b] ?? -1;
        if (net < 0) continue;
        if (this.opts.rails === 'constant' && this.flat.netConst.has(net)) continue;
        const v = (vals[b] ?? 'Z') as Bit;
        if (this.baseVal[net] === v) continue;
        this.baseVal[net] = v;
        const merged = this.mergedValue(net);
        if (merged === this.netVal[net]) continue;
        this.netVal[net] = merged;
        this.watched.get(net)?.push({ atPs: this.time, value: merged });
        for (const ci of this.flat.netReaders[net] as readonly number[])
          this.trigger(ci, this.time);
      }
    }
    if (!this.started) {
      this.started = true;
      if (this.opts.powerUp === 'settle') this.powerUpSettle();
      else if (this.opts.powerUp !== 'none') {
        for (let ci = 0; ci < this.flat.cells.length; ci++) this.trigger(ci, 0);
      }
    }
  }

  /** window：推进 windowPs；quiesce：跑到队列空 */
  advance(protocol: 'window' | 'quiesce', windowPs: number, maxEvents: number): GateDelayAdvance {
    const horizon = protocol === 'window' ? this.time + windowPs : Number.POSITIVE_INFINITY;
    let used = 0;
    while (this.heap.size > 0) {
      const next = this.heap.peek() as DelayEvent;
      if (next.t > horizon) {
        this.time = horizon === Number.POSITIVE_INFINITY ? next.t : horizon;
        return { events: used, timePs: this.time, capped: false, quiescent: false };
      }
      // 同刻事件必须**成批**应用（同一时刻的竞态不能被顺序化）；批还没落地就先把额度算清楚，
      // 保证 capped 时 events 一定 ≤ maxEvents（额度不够就整批不落地：反正已经判"未稳定"）
      const batch: DelayEvent[] = [];
      while (this.heap.size > 0 && (this.heap.peek() as DelayEvent).t === next.t)
        batch.push(this.heap.pop() as DelayEvent);
      if (used + batch.length > maxEvents) {
        return {
          events: used,
          timePs: this.time,
          capped: true,
          quiescent: false,
          unstable: true,
          reason:
            `事件上限 ${maxEvents} 撞满（t=${next.t}ps 这一批就有 ${batch.length} 个事件，` +
            `队列里还有 ${this.heap.size} 个）：电路还在振荡/未稳定`,
        };
      }
      this.apply(batch, next.t);
      used += batch.length;
      this.time = next.t;
    }
    if (horizon !== Number.POSITIVE_INFINITY) this.time = horizon;
    return { events: used, timePs: this.time, capped: false, quiescent: true };
  }

  saveState(): void {
    saveStateFrom(this.flat, this.state, this.cellLast, this.lastClk);
    const nets = this.state.netsOf(NET_PATH);
    for (let i = 0; i < this.flat.netCount; i++) {
      const key = this.flat.netKeys[i];
      if (key !== undefined) nets.set(key, this.netVal[i] as Bit);
    }
  }
}

/* ═════════════════════════ 7. 对外入口 ═════════════════════════ */

export interface GateDelaySupport {
  ok: boolean;
  /** 不支持时的第一人称原因（与 gateFastSupportReason 风格一致）*/
  reason?: string;
}

/**
 * 这份设计门级（有延迟档）能不能跑：能跑 `ok: true`，不能跑给出**人类可读的原因**。
 *
 * `seqSpecs` 不传时是**保守**判定：带时序器件（D锁存器 / 主从D触发器）的设计一律报"没有 SeqSpec"——
 * 因为"调用方没传表"和"表里没这个模块"在结构上看不出区别，宁可不跑也不能算错（与
 * `runGateVectors` 要求传 seqSpecs 的约定一致）。要做准确预检（编译器/审计）就把
 * GATE_SEQ_SPECS 传进来。
 */
export const gateDelaySupport = (
  design: Design,
  library: ModuleLibrary,
  seqSpecs?: Readonly<Record<string, GateSeqSpec>>,
): GateDelaySupport => {
  const { unsupported } = flattenGateNetlist(design, library, seqSpecs ?? {});
  if (unsupported.length === 0) return { ok: true };
  const first = unsupported[0] as string;
  return {
    ok: false,
    reason: unsupported.length === 1 ? first : `${first}（共 ${unsupported.length} 处不支持）`,
  };
};

export interface GateDelayRun {
  ok: boolean;
  reason?: string;
  /** 网名（含 `外层/内层` 前缀）→ 电平；画布按顶层网名读数即可 */
  nets: ReadonlyMap<string, Bit>;
  /** 端口 → 逐位（与 gate-netlist 的 readOutPorts 同形）*/
  outPorts: ReadonlyMap<string, Bit[]>;
  /** 本窗口处理的事件数 */
  events: number;
  /** 是否撞事件上限（true = 未稳定，UI 应提示"仍在振荡"）*/
  capped: boolean;
  /** 窗口结束时刻（ps）；零延迟档没有时间轴，恒 0 */
  timePs: number;
  /** 复用 gate-seq 的 GateStateStore，便于跨请求携带状态 */
  state: GateStateStore;
}

/**
 * 有延迟门级引擎（**公开**）：一份展平结构 + 一个 GateStateStore 就是一台仿真器。
 *
 * 为什么把它公开：`evalGateDelayed` 每次调用都要重新展平（那是几 ms 的一次性成本），
 * 画布要一帧一帧推、或者要看"某一帧里哪条网跳了几次"（`watch` / `edgesOf`），
 * 都得自己拿着展平结果和仿真器。判定/编译侧用 `evalGateVectorsDelayed` 就行。
 */
export class GateDelaySim {
  readonly state: GateStateStore;
  private readonly impl: DelayEngine;
  private readonly opts: ResolvedDelayOptions;

  constructor(flat: GateDelayFlat, opts: GateDelayRunOptions = {}) {
    this.opts = resolveOptions(opts);
    if (this.opts.zeroDelay) {
      throw new Error(
        'GateDelaySim 只做有延迟档：零延迟档请用 evalGateDelayed / evalGateVectorsDelayed（它们直接跑 settleGateSteps）',
      );
    }
    this.state = opts.state ?? new GateStateStore();
    this.impl = new DelayedEngine(flat, this.opts, this.state);
  }

  /** 绑输入（未给的位按 Z）；首次调用做上电触发（有延迟档）*/
  setInputs(inputs: ReadonlyMap<string, Bit[]>): void {
    this.impl.setInputs(inputs);
  }

  /** 推进一步：window = 跑一个时间窗；quiesce = 跑到队列空 */
  advance(protocol: 'window' | 'quiesce', windowPs: number, maxEvents?: number): GateDelayAdvance {
    const out = this.impl.advance(protocol, windowPs, maxEvents ?? this.opts.maxEvents);
    this.impl.saveState();
    return out;
  }

  /** 跑一个时间窗并取终态（画布用）：不传 inputs 就沿用上一次绑的输入 */
  run(inputs?: ReadonlyMap<string, Bit[]>, windowPs = DEFAULT_WINDOW_PS): GateDelayRun {
    if (inputs) this.setInputs(inputs);
    const out = this.advance('window', windowPs);
    return {
      ok: true,
      nets: this.impl.nets(),
      outPorts: this.impl.outPorts(),
      events: out.events,
      capped: out.capped,
      timePs: out.timePs,
      state: this.state,
    };
  }

  /** 观测一条网（网名）的电平跳变 */
  watch(netId: string): void {
    this.impl.watch(netId);
  }

  /** 被观测网的跳变时刻表（只在有延迟档有意义）*/
  edgesOf(netId: string): readonly GateDelayEdge[] {
    return this.impl.edgesOf(netId);
  }

  /** 一条网当前的电平（查不到的网按 0，与 makePinIndex 的约定一致）*/
  netValue(netId: string): Bit {
    return this.impl.netValue(netId);
  }

  nets(): ReadonlyMap<string, Bit> {
    return this.impl.nets();
  }

  outPorts(): ReadonlyMap<string, Bit[]> {
    return this.impl.outPorts();
  }

  get timePs(): number {
    return this.impl.timePs;
  }

  get events(): number {
    return this.impl.eventCount;
  }

  queueSize(): number {
    return this.impl.queueSize();
  }
}

/** 不支持时的空结果 */
const failedRun = (reason: string, state: GateStateStore): GateDelayRun => ({
  ok: false,
  reason,
  nets: new Map(),
  outPorts: new Map(),
  events: 0,
  capped: false,
  timePs: 0,
  state,
});

/* ── 零延迟回退档：直接复用 gate-seq 的 settleGateSteps ── */

/**
 * 把真实库包成门级引擎要的最小接口（结构兼容，不改库；与 gate-fast.ts 的包法一致）。
 * SeqSpec 表由调用方传入（sim-core 不依赖 @lc/content）。
 */
const asGateLibrary = (
  library: ModuleLibrary,
  seqSpecs: Readonly<Record<string, GateSeqSpec>>,
): GateLibrary => ({
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
});

/**
 * 零延迟档：**直接调 gate-seq 的 settleGateSteps**（不是另写一份"等价的"固定点迭代）。
 *
 * 为什么必须复用同一个引擎，而不是在展平结构上自己求固定点（实测，见文件头的长注释）：
 * gate-seq 是**逐层递归**求值的 —— 每一层各自迭代到固定点、各自做"没收敛就退回上一趟"、
 * 各自的时序更新阶段**在递归里就执行**；展平后是**单层**固定点，时序更新阶段每趟只做一次。
 * 实测差异：19 个逻辑关里 18 关与 settleGateSteps **逐网逐行完全一致**，只有 s3-calc 不同
 * （8174 处网值对比里 1982 处不同，分歧从**上电向量**就出现：数字输入寄存器里的电平型锁存器
 * 在 gate-seq 的递归里被"当拍透明"写进了状态，而单层固定点那一趟看到的使能已经是 0）。
 * 而 s3-calc 恰恰是**零延迟口径本身就不对**的那一关（官方零延迟门级 58/67 行与元件级不同；
 * 展平单层固定点更差，66/67 行）—— "回退开关"要的是**与现在这套引擎逐位相同**，
 * 所以这一档必须复用 settleGateSteps，而不是去复刻它在分层求值里的中间态。
 */
const zeroDelayRun = (
  design: Design,
  library: ModuleLibrary,
  inputs: ReadonlyMap<string, Bit[]>,
  state: GateStateStore,
  seqSpecs: Readonly<Record<string, GateSeqSpec>>,
): GateDelayRun => {
  const out = settleGateSteps(design, asGateLibrary(library, seqSpecs), inputs, state);
  if (!out.ok) return failedRun(out.reason ?? '零延迟门级引擎跑不了这份设计', state);
  return {
    ok: true,
    nets: out.nets,
    outPorts: out.outPorts,
    events: 0, // 零延迟口径没有事件队列
    capped: false,
    timePs: 0, // 也没有时间轴
    state,
  };
};

/**
 * 单设计、单窗口：绑输入 → 推 `windowPs` → 取终态（画布/仿真面板用）。
 *
 * 口径：默认按门种类延迟 + 惯性语义；`zeroDelay: true` 时改走零延迟档（直接跑 settleGateSteps，
 * 与现有零延迟门级引擎逐网逐行一致）。展平是每次调用都做的一次性成本；
 * 要连续推很多窗口请自己用 flattenGateNetlist + GateDelaySim。
 *
 * 注：时序器件（D锁存器 / 主从D触发器这类元件电路的积木）要 `seqSpecs` 才认得出时钟/数据脚；
 * 没传就如实报"没有 SeqSpec"（与 runGateVectors 的约定一致，绝不猜）。
 */
export const evalGateDelayed = (
  design: Design,
  library: ModuleLibrary,
  inputs: ReadonlyMap<string, Bit[]>,
  opts: GateDelayRunOptions & { seqSpecs?: Readonly<Record<string, GateSeqSpec>> } = {},
): GateDelayRun => {
  const state = opts.state ?? new GateStateStore();
  const specs = opts.seqSpecs ?? {};
  if (opts.zeroDelay === true) return zeroDelayRun(design, library, inputs, state, specs);
  const { flat, unsupported } = flattenGateNetlist(design, library, specs);
  if (unsupported.length > 0) {
    return failedRun(`门级引擎跑不了这份设计：${unsupported.join('；')}`, state);
  }
  const windowPs = opts.windowPs ?? DEFAULT_WINDOW_PS;
  const sim = new GateDelaySim(flat, opts);
  sim.setInputs(inputs);
  const first = sim.run(undefined, windowPs);
  /**
   * `'auto'`：只有**上电对称环自振**（撞事件上限）才用 `'settle'` 从头重跑一次。
   * 判据只看 `capped` —— 能自己稳下来的电路完全不受影响（判定侧向量全属这一类）。
   */
  if (opts.powerUp !== 'delay' && opts.powerUp !== 'settle' && first.capped) {
    /**
     * ★ 重跑前**必须清空状态**：第一次尝试（对称自振）已经把中间态写进了 state ——
     *   门搭的反馈环里"一个时序器件都没有"，它的状态**只住在网值里**（构造函数会把
     *   `state.netsOf(NET_PATH)` 灌进 `baseVal`/`slotVal`）。带着这些值重跑就不是"上电"，
     *   而是"接着振"：实测 `s2-d-latch` 冷启动（d=1,en=0）脏状态重跑得 q=0、干净状态得 q=1
     *   —— 画布（走冷状态）与直调引擎（走 auto）因此对不上（第 ㉓ 轮的三方比对就是这么发现的）。
     */
    state.clear();
    const rescue = new GateDelaySim(flat, { ...opts, powerUp: 'settle' });
    rescue.setInputs(inputs);
    const second = rescue.run(undefined, windowPs);
    // 只有确实救下来了（不再撞上限）才采用；否则保留第一次的有界结果并如实报告不稳定
    if (!second.capped) return second;
  }
  return first;
};

/* ── 向量级入口（给 compiler 的 runGateVectors 换引擎用）── */

const laneOf = (lane: string): { port: string; bit: number } => {
  const m = /^(.+)\[(\d+)\]$/.exec(lane);
  if (m?.[1] !== undefined && m[2] !== undefined) return { port: m[1], bit: Number(m[2]) };
  return { port: lane, bit: 0 };
};

/** 宽 1 的端口用裸名，宽 >1 用 `name[i]`（与 expandVectors / gate-fast 的口径一致）*/
const laneKey = (port: string, bit: number, width: number): string =>
  width > 1 ? `${port}[${bit}]` : port;

export interface GateDelayVectorRun {
  pass: boolean;
  /** 行形状与现有 runGateVectors 一致（见 packages/compiler/src/gate-fast.ts）*/
  rows: VectorRow[];
  /** 是否有向量没稳定（撞事件上限 / 组合环在迭代上限内没收敛）*/
  unstable: boolean;
}

/**
 * 向量级入口：把一组测试向量跑在门级引擎上，产出与 `runGateVectors` 同形的结果。
 *
 * 默认 = **有延迟**档（按门种类延迟 + 惯性语义，见文件头）；
 * `zeroDelay: true` = **零延迟回退档**：逐向量直接跑 `settleGateSteps`
 * （与 `runGateVectors` 同一套引擎、同一套输入保持口径 → 逐行读数逐位相同）。
 *
 * 返回 null 的情形与 runGateVectors 完全一致（调用方静默回落元件级引擎）：
 * 顶层或任一层含元件、库里找不到模块、时序模块没有 SeqSpec。
 *
 * `widths` 兼容两种口径：compiler 的 `portWidthsOf` 给的是 Map，索引式的 Record 也能收。
 */
export const evalGateVectorsDelayed = (
  design: Design,
  library: ModuleLibrary,
  vectors: readonly TestVector[],
  widths: Record<string, number> | ReadonlyMap<string, number> | undefined,
  seqSpecs: Record<string, GateSeqSpec> | undefined,
  opts: GateDelayOptions & { windowPs?: number; defaultSettlePs?: number } = {},
): GateDelayVectorRun | null => {
  const specs = seqSpecs ?? {};
  const resolved = resolveOptions(opts);
  const widthOfPort = (port: string): number => {
    if (widths instanceof Map) return widths.get(port) ?? 1;
    if (widths) return (widths as Record<string, number>)[port] ?? 1;
    return design.ports.find((p) => p.name === port)?.width ?? 1;
  };

  // ── 引擎准备：两档的**准入判定**都走展平（"能不能跑"的口径必须一致）──
  const { flat, unsupported } = flattenGateNetlist(design, library, specs);
  if (unsupported.length > 0) return null;
  const sim = resolved.zeroDelay ? undefined : new GateDelaySim(flat, opts);
  const gateLib = resolved.zeroDelay ? asGateLibrary(library, specs) : undefined;
  const zeroState = resolved.zeroDelay ? new GateStateStore() : undefined;
  const defaultSettlePs = opts.defaultSettlePs ?? DEFAULT_WINDOW_PS;

  const held = new Map<string, Bit[]>();
  const rows: VectorRow[] = [];
  let unstable = false;
  let fromPs = 0;

  for (const [index, vector] of vectors.entries()) {
    // 未列出的输入**保持上一次的值**（与 runVectors / runGateVectors 口径一致，便于测时序保持）
    for (const [lane, value] of Object.entries(vector.inputs)) {
      const { port, bit } = laneOf(lane);
      const w = widthOfPort(port);
      const bits = held.get(port) ?? Array.from({ length: w }, (): Bit => 'Z');
      bits[bit] = value as Bit;
      held.set(port, bits);
    }

    let portBits: ReadonlyMap<string, Bit[]>;
    let toPs = 0;
    if (sim) {
      sim.setInputs(held);
      const windowPs = vector.settlePs ?? opts.windowPs ?? defaultSettlePs;
      const out = sim.advance('window', windowPs);
      if (out.unstable === true) unstable = true;
      portBits = sim.outPorts();
      toPs = out.timePs;
    } else {
      const out = settleGateSteps(
        design,
        gateLib as GateLibrary,
        held,
        zeroState as GateStateStore,
      );
      if (!out.ok) return null; // 引擎说不支持就回落，不硬凑（与 runGateVectors 同约定）
      if (out.unstable === true) unstable = true;
      portBits = out.outPorts;
    }

    // 输出端口读数（与 gate-netlist 的 readOutPorts 同形：查不到就是 0）
    const actual: Record<string, Logic> = {};
    for (const [port, bits] of portBits) {
      const w = widthOfPort(port);
      bits.forEach((b, i) => {
        actual[laneKey(port, i, w)] = b as Logic;
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
        inputLanes[laneKey(port, i, w)] = b as Logic;
      });
    }
    rows.push({
      index,
      ...(vector.note !== undefined ? { note: vector.note } : {}),
      inputs: inputLanes,
      expected,
      actual,
      mismatches,
      ok: mismatches.length === 0,
      timePs: toPs,
      // 有延迟档：窗口 = 上一次采样 → 本次采样（与 harness.ts 的 runVectors 同形）
      // 零延迟档：没有时间轴，恒 [0,0]（与历史 runGateVectors 的行形状同形）
      window: resolved.zeroDelay ? { fromPs: 0, toPs: 0 } : { fromPs, toPs },
    });
    fromPs = toPs;
  }

  return { pass: rows.every((r) => r.ok), rows, unstable };
};
