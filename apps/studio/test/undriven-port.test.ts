// @vitest-environment node
/**
 * 「输出端口没有被驱动」诊断：玩家把导线落在模块的输入脚上（接反）、或压根没落到引脚上时，
 * 以前界面上什么都不说，玩家只看到「q 一动不动」。判断走结构（谁在这根网上驱动），
 * 不看终态电平 —— 二极管逻辑在输入全 0 时端口本来就是 Z，那是合法的。
 */
import { ALL_LEVELS, findLevel, TEACHING_MODULES, teachingModulesFor } from '@lc/content';
import { describe, expect, it } from 'vitest';
import { createSym, type Doc, toDesign } from '../src/editor/model';
import { docForLevel } from '../src/level/progress';
import { handleRequest } from '../src/sim/handle';
import type { DriveValue, StudioResponse } from '../src/sim/protocol';

const FAMILY_MODULES = teachingModulesFor('rtl');
const stored = FAMILY_MODULES.map((m) => ({
  hash: m.hash,
  name: m.name,
  version: m.version,
  stage: m.stage,
  costHalf: m.costHalf,
  isSequential: m.isSequential,
  ports: m.ports,
  template: m,
  sources: [] as string[],
  createdAt: 0,
}));
const templates = [...FAMILY_MODULES];

function simulate(doc: Doc, inputs: Record<string, DriveValue>): StudioResponse {
  return handleRequest({
    id: 1,
    type: 'simulate',
    design: toDesign(doc),
    library: templates,
    mode: 'logic',
    inputs,
    buttonPorts: [],
  }) as StudioResponse;
}

function undrivenOf(resp: StudioResponse): string[] {
  return (resp.snapshot?.simDiagnostics ?? [])
    .filter((d) => d.kind === 'undriven-port')
    .map((d) => d.message);
}

/** SR 锁存器关里放一个非门：wires 决定接对还是接反 */
function srDocWithInverter(wires: Doc['wires']): { doc: Doc; invId: string } {
  const level = findLevel('s2-sr-latch')!;
  const notMod = FAMILY_MODULES.find((m) => m.name === '非门')!;
  let doc = docForLevel(level, stored);
  const inv = createSym(doc, 'module', undefined, 300, 320, notMod.hash);
  doc = { ...doc, syms: [...doc.syms, inv], wires };
  return { doc, invId: inv.id };
}

describe('输出端口没有被驱动', () => {
  it('导线接在模块的输入脚上（接反）→ 报「q 没有被任何东西驱动」，且 q 一直是 Z', () => {
    const { doc, invId } = srDocWithInverter([]);
    const reversed: Doc = {
      ...doc,
      wires: [
        { id: 'w1', a: { inst: 'in-sn', pin: 'p', bit: 0 }, b: { inst: invId, pin: 'y', bit: 0 } },
        { id: 'w2', a: { inst: invId, pin: 'a', bit: 0 }, b: { inst: 'out-q', pin: 'p', bit: 0 } },
      ],
    };
    const resp = simulate(reversed, { sn: 1, rn: 1 });
    expect(undrivenOf(resp).join(' ')).toContain('输出端口 q 没有被任何东西驱动');
    const design = toDesign(reversed);
    const qNet = design.nets.find((n) => n.pins.some((p) => p.inst === 'out-q'))!;
    expect(resp.snapshot?.netSignals.find(([id]) => id === qNet.id)?.[1]).toBe(0);
  });

  it('接对了（sn → a，y → q）就不点名 q', () => {
    const { doc, invId } = srDocWithInverter([]);
    const good: Doc = {
      ...doc,
      wires: [
        { id: 'w1', a: { inst: 'in-sn', pin: 'p', bit: 0 }, b: { inst: invId, pin: 'a', bit: 0 } },
        { id: 'w2', a: { inst: invId, pin: 'y', bit: 0 }, b: { inst: 'out-q', pin: 'p', bit: 0 } },
      ],
    };
    const resp = simulate(good, { sn: 1, rn: 1 });
    expect(undrivenOf(resp).filter((m) => m.includes('输出端口 q '))).toEqual([]);
    const design = toDesign(good);
    const qNet = design.nets.find((n) => n.pins.some((p) => p.inst === 'out-q'))!;
    expect(resp.snapshot?.netSignals.find(([id]) => id === qNet.id)?.[1]).not.toBe(0);
  });

  it('所有关卡参考解的端口都有驱动：不该误报', () => {
    let simulated = 0;
    for (const level of ALL_LEVELS) {
      const ref = level.referenceSolution!;
      const inputs: Record<string, DriveValue> = Object.fromEntries(
        ref.ports.filter((p) => p.dir === 'in').map((p) => [p.name, 0 as DriveValue]),
      );
      const resp = handleRequest({
        id: 1,
        type: 'simulate',
        design: ref,
        library: ref.instances.some((i) => i.kind === 'module') ? [...TEACHING_MODULES] : [],
        mode: level.mode ?? 'logic',
        inputs,
        buttonPorts: [],
      }) as StudioResponse;
      expect(resp.error, `${level.id} 不该报错`).toBeUndefined();
      expect(undrivenOf(resp), `${level.id} 参考解的输出端口不该被判为没驱动`).toEqual([]);
      simulated += 1;
    }
    expect(simulated).toBe(ALL_LEVELS.length);
  }, 60_000);
});
