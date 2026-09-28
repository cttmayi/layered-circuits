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
  wrapModule,
} from '@lc/compiler';
import {
  formatCost,
  InMemoryModuleLibrary,
  type ModuleLibrary,
  ModuleTemplateSchema,
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

    const { design, mode, inputs } = req;
    const { net, diagnostics: compileDiagnostics, netIds } = compileDesign(design, { library });

    const sim = new Simulator(net, { mode, trace: false, maxEvents: 2_000_000 });
    const values: Record<string, DriveValue> = {};
    for (const port of net.ports) {
      if (port.dir !== 'in') continue;
      const drive = inputs[port.name] ?? 3;
      values[port.name] = drive;
      sim.setInput(port.name, paramToLogic(drive));
    }

    let unstable = false;
    if (mode === 'timing') {
      // 硬核模式：给一个足够大的等待窗口，让玩家能看到「延迟之后才变」的现象
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
    const half = counts.npn * 4 + counts.res * 2 + counts.dio * 3 + counts.cap * 6;

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
