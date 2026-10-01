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
import { allInputCombinations, type Logic, runVectors, Simulator } from '@lc/sim-core';
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
        lenient: req.lenient,
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
    });
    const values: Record<string, DriveValue> = {};
    // 瞬时按钮端口：先按 0 驱动，让组合逻辑稳定后再置目标值。
    // 否则冷启动仿真里 eq 的上升沿出现在 t=0，会锁存组合链尚未稳定的中间态
    // （真实玩家是先设好 a/b、组合链早已稳定，再按下等号键）。
    const buttonPorts = new Set(req.buttonPorts ?? []);
    for (const port of net.ports) {
      if (port.dir !== 'in') continue;
      const drive = inputs[port.name] ?? 3;
      values[port.name] = drive;
      sim.setInput(port.name, buttonPorts.has(port.name) ? 0 : paramToLogic(drive));
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
    for (let node = 0; node < net.nodeCount; node++) {
      const netId = netIds[node];
      if (netId) netSignals.push([netId, sim.signalOf(node)]);
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

    let truth: SimSnapshot['truth'] = null;
    const inputNames = net.ports.filter((p) => p.dir === 'in').map((p) => p.name);
    if (req.withTruth && inputNames.length > 0 && inputNames.length <= 6) {
      const combos = allInputCombinations(inputNames);
      const settled = combos
        .filter((combo) => Object.values(combo).every((v) => v === 0 || v === 1))
        .map((combo) => ({ inputs: combo }));
      if (settled.length > 0) {
        const run = runVectors(net, settled, { mode, defaultSettlePs: 1_000_000 });
        truth = run.rows.map((row) => ({ inputs: row.inputs, outputs: row.actual }));
      }
    }

    const snapshot: SimSnapshot = {
      ok: true,
      inputs: values,
      portValues: sim.readAllOutputs(),
      netSignals,
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
      truth,
    };
    if (unstable) {
      snapshot.simDiagnostics.push({
        kind: 'unstable',
        severity: 'warning',
        message: '电路没有在仿真窗口内稳定下来（疑似组合环/振荡）',
      });
    }
    return { id: req.id, snapshot };
  } catch (error) {
    return { id: req.id, error: error instanceof Error ? error.message : String(error) };
  }
}
