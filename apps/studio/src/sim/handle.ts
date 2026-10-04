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
import {
  costHalfOf,
  familySpecOf,
  formatCost,
  InMemoryModuleLibrary,
  type ModuleLibrary,
  ModuleTemplateSchema,
  parseLevel,
} from '@lc/schema';
import { type Logic, SIG_Z, Simulator } from '@lc/sim-core';
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
        hardcore: req.hardcore,
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
      trace: false,
      maxEvents: 2_000_000,
      initialSignals: req.prevSignals,
      initialContribs: req.prevContribs,
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
    for (let node = 0; node < net.nodeCount; node++) {
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
      timing,
    };
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
      if (!inst || inst.kind !== 'module') return false;
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
