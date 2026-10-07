/**
 * 请求处理器：把「编辑器状态」翻译成「内核调用」，再把结果整理成可结构化克隆的快照。
 * 纯函数、无 DOM —— Worker 与主线程回退路径共用同一份实现，保证两条路径结果一致。
 */

import {
  analyzeTiming,
  type CompileDiagnostic,
  compileDesign,
  computeCosts,
  hashDesign,
  judgeDesign,
  wrapModule,
} from '@lc/compiler';
import { GATE_SEQ_SPECS, gateFastEnabledFor } from '@lc/content';
import type { Design } from '@lc/schema';
import {
  costHalfOf,
  familySpecOf,
  formatCost,
  InMemoryModuleLibrary,
  type ModuleLibrary,
  ModuleTemplateSchema,
  parseLevel,
} from '@lc/schema';
import {
  type Bit,
  evalGateDelayed,
  type GateDelayRun,
  GateStateStore,
  gateDelaySupport,
  type Logic,
  logicToSignal,
  S_STRONG,
  SIG_Z,
  Simulator,
  toWaveform,
} from '@lc/sim-core';
import type {
  DriveValue,
  SimSnapshot,
  StudioRequest,
  StudioResponse,
  WrappedModuleInfo,
} from './protocol';

function paramToLogic(p: DriveValue): Logic {
  if (p === 0) return 0;
  if (p === 1) return 1;
  if (p === 2) return 'X';
  return 'Z';
}

function buildLibrary(raw: unknown[]): ModuleLibrary {
  const library = new InMemoryModuleLibrary();
  for (const item of raw) {
    const parsed = ModuleTemplateSchema.safeParse(item);
    if (parsed.success) library.add(parsed.data);
  }
  return library;
}

/* ── 逻辑关画布：**有界延迟 + 惯性**门级引擎（与判定同口径，用户第 ⑲ 轮拍板走 A 路线）────────
 *
 * 为什么画布也要换：判定（白名单关）走的是门级引擎，画布若还走元件引擎，同一份电路会出现
 * "判定说对、画布显示另一个电路"的分歧；而且零延迟门级把"建立时间"抹掉（s3-calc 靠 10 级
 * 反相器链把时钟沿推后 15ns），画布读到的就是错的中间态。
 *
 * 边界（一处都不含糊）：
 *   · 只有**逻辑关**画布走这条（请求里 `gateCanvas: true`）；时序关 1~7 与自由模式**不受影响**；
 *   · 设计里含元件、或有缺 SeqSpec 的时序模块 → `gateDelaySupport` 说不支持 → **原样回落元件引擎**
 *     （老存档、元件电路照旧显示，Z/X 也不变）；
 *   · 门级状态跨请求保存在**本模块作用域**里（按电路哈希索引，只留最近几个），不往协议里塞类实例。
 *
 * 验收口径（apps/studio/test/gate-canvas-same-caliber.test.ts 钉住）：
 *   画布 `netSignals` 里每条顶层网的电平 == 门级引擎 `evalGateDelayed().nets` 的同名网电平。
 */
const GATE_CANVAS_WINDOW_PS = 1_000_000; // 1µs：够慢路径走完（关卡向量 settlePs 的上限也是它）
const GATE_CANVAS_MAX_EVENTS = 500_000; // 与 harness.ts 的 maxEventsPerVector 同量级
const GATE_CANVAS_STATE_KEEP = 8; // 状态缓存只留最近 8 份电路
/**
 * "这份电路的上电是对称自振，必须用 settle 口径" 的**备忘**（按电路 hash）。
 *
 * 为什么需要：默认 `powerUp:'delay'` 能保住判定侧的逐行结论，但对称环（电平型锁存器上电即
 * `en=0`）会在那一次尝试里烧满事件预算 —— 实测 50 万事件 ≈ **280ms/帧**。备忘之后只有这一关的
 * **第一帧**付这个代价，而且第一帧用下面的小预算探（撞上限就立刻改用 settle 重跑，≈11ms）。
 */
const gateCanvasNeedsSettle = new Set<string>();
/** 探"上电自振"用的小事件预算：正常电路一轮远用不到（18 关实测最大 292 事件），
 *  撞上它基本就是对称环 —— 真的需要更多事件的电路只会在这一帧走 settle 口径，不影响判定。*/
const GATE_CANVAS_PROBE_EVENTS = 20_000;

const gateCanvasStates = new Map<string, GateStateStore>();

const gateCanvasState = (key: string): GateStateStore => {
  const hit = gateCanvasStates.get(key);
  if (hit) {
    // LRU：命中即挪到队尾
    gateCanvasStates.delete(key);
    gateCanvasStates.set(key, hit);
    return hit;
  }
  const fresh = new GateStateStore();
  gateCanvasStates.set(key, fresh);
  while (gateCanvasStates.size > GATE_CANVAS_STATE_KEEP) {
    const oldest = gateCanvasStates.keys().next().value;
    if (oldest === undefined) break;
    gateCanvasStates.delete(oldest);
  }
  return fresh;
};

/** 把请求里的驱动值摊成门级要的「端口 → 逐位 Bit」*/
const gateInputsOf = (design: Design, inputs: Record<string, DriveValue>): Map<string, Bit[]> => {
  const out = new Map<string, Bit[]>();
  for (const port of design.ports) {
    if (port.dir !== 'in') continue;
    const width = Math.max(1, port.width ?? 1);
    /**
     * ⚠️ 多 bit 输入必须**逐 lane 取**：画布送的 `inputValues(doc)` 对 width>1 的端口只给
     * `名字[bit]` 这种 lane 键（与编译器命名一致），没有裸名 —— 只读裸名会全部落到兜底值
     * `3`，门级就看到一份"输入全是 X"的设计（实测：数码管关点 bcd，门级 netSignals 里的
     * seg 全是 0，画布段码不跟随）。裸名作兜底，兼容 width=1 与老调用方。
     */
    out.set(
      port.name,
      Array.from({ length: width }, (_, b) =>
        paramToLogic(
          inputs[width > 1 ? `${port.name}[${b}]` : port.name] ?? inputs[port.name] ?? 3,
        ),
      ) as Bit[],
    );
  }
  return out;
};

export function handleRequest(req: StudioRequest): StudioResponse {
  try {
    const library = buildLibrary(req.library.slice());
    if (req.type === 'wrap') {
      const result = wrapModule(
        {
          name: req.name,
          version: '1.0',
          stage: req.stage,
          kind: 'logic',
          ports: req.design.ports,
          body: req.design,
        },
        library,
      );
      const info: WrappedModuleInfo = {
        template: result.template,
        hash: result.template.hash,
        name: result.template.name,
        costHalf: result.template.costHalf,
        isSequential: result.template.isSequential,
        ports: result.template.ports.map((p) => ({
          id: p.id,
          name: p.name,
          dir: p.dir,
          width: p.width,
        })),
        delayPs: result.template.delayPs,
        criticalPathPs: result.template.criticalPathPs,
        diagnostics: result.diagnostics.map((d) => `[${d.severity}] ${d.message}`),
      };
      return { id: req.id, wrapped: info };
    }

    if (req.type === 'judge') {
      const level = parseLevel(req.level);
      // 按玩家契约算生效规格：元件集 / 满分线 / 预算 / 时序预算 / 强度契约
      const spec = familySpecOf(level, req.family ?? 'rtl');
      const result = judgeDesign(req.design, level, {
        library,
        // 门级快路**按关白名单**启用：只在护栏证明结论一致的关上走（见 gate-seq-specs.ts）
        ...(gateFastEnabledFor(level.id) ? { gateSeqSpecs: GATE_SEQ_SPECS } : {}),
        hardcore: req.hardcore,
        mode: req.mode,
        family: spec.family,
        units: spec.units,
        timingBudgetPs: spec.timingBudgetPs,
        optimalHalf: spec.optimalHalf,
        budgetHalf: spec.budgetHalf,
        bestKnownHalf: spec.bestKnownHalf,
      });
      return { id: req.id, judge: result };
    }

    const { design, mode, inputs } = req;
    const { net, diagnostics: compileDiagnostics, netIds } = compileDesign(design, { library });

    const sim = new Simulator(net, {
      mode,
      // 时序视图要看波形：只有这条路径需要记录 trace（逻辑模式没有时间轴，记了也没用）
      trace: req.withWaveform === true,
      maxEvents: 2_000_000,
      initialSignals: req.prevSignals,
      initialContribs: req.prevContribs,
      initialNodeSignals: req.prevNodeSignals,
    });
    const values: Record<string, DriveValue> = {};
    // 瞬时按钮端口：
    //  - 时序模式：先按 0 驱动，让组合逻辑稳定后再置目标值。否则冷启动仿真里 eq 的上升沿
    //    出现在 t=0，会锁存组合链尚未稳定的中间态（真实玩家是先设好 a/b、组合链早已稳定，
    //    再按下等号键）。
    //  - 逻辑模式：按钮就是普通输入，直接按目标值驱动（settle 收敛到终态，无沿语义；
    //    锁存器保持态由 prevSignals 跨仿真携带）。
    const buttonPorts = new Set(req.buttonPorts ?? []);
    for (const port of net.ports) {
      if (port.dir !== 'in') continue;
      const drive = inputs[port.name] ?? 3;
      values[port.name] = drive;
      sim.setInput(
        port.name,
        mode === 'timing' && buttonPorts.has(port.name) ? 0 : paramToLogic(drive),
      );
    }

    let unstable = false;
    if (mode === 'timing') {
      // 先给组合链一个稳定窗口（含按钮端口为 0 时的状态）
      if (!sim.advanceTo(sim.time + 1_000_000, 500_000)) unstable = true;
      // 按钮端口在组合链稳定后才生效（上升沿锁存正确的组合输出）
      for (const bp of buttonPorts) {
        const drive = inputs[bp] ?? 0;
        sim.setInput(bp, paramToLogic(drive));
      }
      if (!sim.advanceTo(sim.time + 1_000_000, 500_000)) unstable = true;
    } else if (!sim.settle()) {
      unstable = true;
    }

    const netSignals: Array<[string, number]> = [];
    const contrib: Array<[string, number[]]> = [];
    // 全节点电平（含模块内部节点）：跨仿真恢复的完整状态，见 prevNodeSignals
    const nodeSignals: number[] = [];
    for (let node = 0; node < net.nodeCount; node++) {
      nodeSignals.push(sim.signalOf(node));
      const netId = netIds[node];
      if (!netId) continue;
      netSignals.push([netId, sim.signalOf(node)]);
      const start = net.driveStart[node] as number;
      const end = net.driveStart[node + 1] as number;
      const vals: number[] = [];
      for (let i = start; i < end; i++) {
        vals.push(sim.contribOf(net.driveElem[i] as number, net.driveSlot[i] as number));
      }
      contrib.push([netId, vals]);
    }

    // ── 逻辑关画布：门级（有界延迟 + 惯性）覆盖顶层网电平 ──────────────────────────
    let gateRun: GateDelayRun | null = null;
    let gateReason = '';
    let gatePowerUpRescued = false;
    if (mode === 'logic' && req.gateCanvas === true) {
      // ⚠️ 必须把 `GATE_SEQ_SPECS` 一起传进预检：不传时它是**保守**判定（"带时序器件一律报
      //    没有 SeqSpec"），会把 s2-dff / s3-reg-8 / s3-digit-entry 这三关误判成"门级不支持"
      //    而回落元件引擎 —— 判定侧（runGateVectors）一直带着这张表，两边口径必须一致。
      const support = gateDelaySupport(design, library, GATE_SEQ_SPECS);
      if (!support.ok) {
        gateReason = support.reason ?? '门级不支持这份设计';
      } else {
        const designHash = hashDesign(design);
        const state = gateCanvasState(designHash);
        const common = {
          state,
          seqSpecs: GATE_SEQ_SPECS,
          windowPs: GATE_CANVAS_WINDOW_PS,
        } as const;
        // 已经在备忘里（上电对称自振）→ 直接用 settle 口径，不再白烧事件预算
        let run = evalGateDelayed(design, library, gateInputsOf(design, inputs), {
          ...common,
          maxEvents: gateCanvasNeedsSettle.has(designHash)
            ? GATE_CANVAS_MAX_EVENTS
            : GATE_CANVAS_PROBE_EVENTS,
          powerUp: gateCanvasNeedsSettle.has(designHash) ? 'settle' : 'delay',
        });
        if (!gateCanvasNeedsSettle.has(designHash) && run.ok && run.capped) {
          // 上电对称自振（延迟完全匹配的交叉耦合环）：记下来，用确定性顺序上电重跑
          gateCanvasNeedsSettle.add(designHash);
          run = evalGateDelayed(design, library, gateInputsOf(design, inputs), {
            ...common,
            maxEvents: GATE_CANVAS_MAX_EVENTS,
            powerUp: 'settle',
          });
          gatePowerUpRescued = true;
        }
        if (run.ok) gateRun = run;
        else gateReason = run.reason ?? '门级引擎跑不了这份设计';
      }
      const run = gateRun;
      if (run) {
        // 门级只保证「有驱动/被绑定的网」有值；**无驱动的网按 Z 报**（画布上=悬空土黄虚线，
        // 与元件引擎对无驱动网的读数一致），而不是"缺 key 画灰"——那会把"没接"显示成"接了但没电"。
        // ⚠️ 遍历 `design.nets` 而不是 `netIds`：compileDesign 会把等价网并成一个节点，
        // `netIds` 里因此缺掉一部分顶层网名（例如锁存器的 q/qn、全加器的中间网），
        // 用 netIds 覆盖就会让那些网在画布上消失。
        const gated: Array<[string, number]> = design.nets.map((n) => {
          const bit = run.nets.get(n.id);
          // 位 → 强驱动信号：逻辑关图例只承诺 1/0 两色，门级没有强弱，必须给强驱动
          return [n.id, bit === undefined ? SIG_Z : logicToSignal(bit as Logic, S_STRONG)];
        });
        netSignals.length = 0;
        netSignals.push(...gated);
      }
    }

    const { counts, diagnostics: costDiagnostics } = computeCosts(design, library);
    const half = costHalfOf(counts);

    let timing: SimSnapshot['timing'] = null;
    if (req.withTiming) {
      const analysis = analyzeTiming(net);
      timing = {
        portDelayPs: analysis.portDelayPs,
        criticalPathPs: analysis.criticalPathPs,
        isSequential: analysis.isSequential,
        uncertain: analysis.uncertain,
      };
    }

    const snapshot: SimSnapshot = {
      ok: true,
      inputs: values,
      portValues: sim.readAllOutputs(),
      netSignals,
      contrib,
      nodeSignals,
      nodeCount: net.nodeCount,
      elemCount: net.elemCount,
      evaluations: sim.stats.evaluations,
      timePs: sim.time,
      simDiagnostics: sim.allDiagnostics.map((d) => ({
        kind: d.kind,
        severity: d.severity,
        message: d.message,
      })),
      compileDiagnostics: [...compileDiagnostics, ...costDiagnostics].map(
        (d: CompileDiagnostic) => ({
          kind: d.kind,
          severity: d.severity,
          message: d.message,
        }),
      ),
      cost: { counts: { ...counts }, half, text: formatCost(counts) },
      hash: hashDesign(design),
      // 实时波形（端口级）：时序视图用它画阶梯图；逻辑模式没有时间轴，恒为空
      waveform:
        req.withWaveform === true && sim.trace
          ? toWaveform(sim.trace, net, { portOnly: true })
          : null,
      timing,
    };
    if (gateRun) {
      snapshot.simDiagnostics.push({
        kind: 'gate-canvas',
        severity: 'info',
        message: `画布走门级引擎（有界延迟 ${GATE_CANVAS_WINDOW_PS / 1000}ns 窗口 + 惯性语义，与判定同口径）：事件 ${gateRun.events}，终态时刻 ${gateRun.timePs}ps${gatePowerUpRescued ? '（上电改按确定性顺序铺一遍：这份电路的交叉耦合环在完全相同的延迟下会对称自振）' : ''}`,
      });
      if (gateRun.capped) {
        snapshot.simDiagnostics.push({
          kind: 'unstable',
          severity: 'warning',
          message: `门级仿真撞到事件上限（${GATE_CANVAS_MAX_EVENTS}）—— 电路仍在活动（可能是自搭环路在振荡），已停在窗口结束时刻`,
        });
      }
    } else if (mode === 'logic' && req.gateCanvas === true) {
      snapshot.simDiagnostics.push({
        kind: 'gate-canvas-fallback',
        severity: 'info',
        message: `画布回落元件引擎（门级不支持这份设计）：${gateReason}`,
      });
    }
    if (unstable) {
      snapshot.simDiagnostics.push({
        kind: 'unstable',
        severity: 'warning',
        message: '电路没有在仿真窗口内稳定下来（疑似组合环/振荡）',
      });
    }

    // 关卡输出端口没有任何驱动源 → 明确说一句。玩家最常见的迷惑就是「看着接上了，q 却一动不动」：
    // 导线落在模块/元件的**输入脚**上（接反）、压根没落到引脚上、或者**自制模块内部压根没输出**
    // （封装时输入没接进去、输出脚没接到东西上）—— 这三种情况编译只关心「连没连」，
    // 端口悬空在判定里也只表现为「结果不对」，界面上原本一个字都不说。
    // 判断用结构而不是终态电平：二极管逻辑在输入全 0 时端口本来就是 Z（合法的），
    // 拿 Z 当「没驱动」会误报（s3-bin2bcd 的参考解就被误报过）。
    // 控制脚（三极管基极、MOS 栅极）只输入不驱动；模块只有输出端口算驱动源。
    const CONTROL_PINS: Record<string, readonly string[]> = {
      npn: ['b'],
      nmos: ['g'],
      pmos: ['g'],
    };
    const portById = new Map(design.ports.map((p) => [p.id, p]));
    const instById = new Map(design.instances.map((i) => [i.id, i]));
    /** 模块输出端口虽然算驱动源，但它是不是真的给出电平取决于模块内部 —— 单独一类 */
    const isModuleOut = (pin: { inst: string; pin: string }): boolean => {
      const inst = instById.get(pin.inst);
      if (inst?.kind !== 'module') return false;
      return library.get(inst.module)?.ports.find((p) => p.name === pin.pin)?.dir === 'out';
    };
    const isDriver = (pin: { inst: string; pin: string }): boolean => {
      const port = portById.get(pin.inst);
      if (port) return port.dir === 'in';
      const inst = instById.get(pin.inst);
      if (!inst) return true; // 认不出的引脚不判（模块缺失另有 unknown-module 诊断）
      if (inst.kind === 'vcc' || inst.kind === 'gnd') return true;
      if (inst.kind === 'unit') return !(CONTROL_PINS[inst.unit] ?? []).includes(pin.pin);
      const tpl = library.get(inst.module);
      const tplPort = tpl?.ports.find((p) => p.name === pin.pin);
      return tplPort ? tplPort.dir === 'out' : true;
    };
    const drivenNets = new Set<string>();
    /** 「硬」驱动：元件、电源轨、输入端口。只有模块输出脚不算 —— 模块内部可以是死的 */
    const hardDrivenNets = new Set<string>();
    // 输入端口挂着的整根网都算被驱动：参考解里 bin[0] 与 bcd[0] 直接共用一根网，
    // 那根网的 pins 是空的（靠端口 nets 相同表达连通），只看 pins 会误报。
    for (const port of design.ports) {
      if (port.dir !== 'in') continue;
      for (const netId of port.nets) {
        if (!netId) continue;
        drivenNets.add(netId);
        hardDrivenNets.add(netId);
      }
    }
    for (const net of design.nets) {
      if (net.pins.some(isDriver)) drivenNets.add(net.id);
      if (net.pins.some((pin) => isDriver(pin) && !isModuleOut(pin))) hardDrivenNets.add(net.id);
    }
    // 扁平端口按名字索引：拿到输出端口的终态电平（判断「模块输出脚在、但里面没驱动」）
    const flatByPort = new Map(net.ports.map((p) => [p.name, p]));
    for (const port of design.ports) {
      if (port.dir !== 'out') continue;
      port.nets.forEach((netId, bit) => {
        const label = port.width > 1 ? `${port.name}[${bit}]` : port.name;
        const flat = flatByPort.get(label);
        const floating = flat ? sim.signalOf(flat.node) === SIG_Z : false;
        // 结构上有驱动源：只有「驱动源全是模块输出脚、且终态确实是 Z」才算模块内部是死的
        const driven = netId !== undefined && netId !== '' && drivenNets.has(netId);
        if (driven && (hardDrivenNets.has(netId as string) || !floating)) return;
        snapshot.simDiagnostics.push({
          kind: 'undriven-port',
          severity: 'warning',
          message: driven
            ? `输出端口 ${label} 是悬空的：驱动它的模块内部没有给出电平（模块可能是坏的，双击它展开看看内部电路）`
            : `输出端口 ${label} 没有被任何东西驱动：检查导线是否真的接在 ${label} 上（接到元件的输入脚、或模块的输入脚都不算）`,
        });
      });
    }
    return { id: req.id, snapshot };
  } catch (error) {
    return { id: req.id, error: error instanceof Error ? error.message : String(error) };
  }
}
