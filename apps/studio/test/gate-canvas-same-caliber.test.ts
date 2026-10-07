// @vitest-environment node
/**
 * **画布与判定同口径**：逻辑关画布走的门级电平必须就是 `evalGateDelayed` 的网电平，
 * 一个网都不许差；同时钉住"谁走门级、谁回落"的边界（时序关/自由模式/含元件设计）。
 *
 * 这是用户第 ⑲ 轮（走 A 路线：仿真与判定都改成有界延迟门级）的验收断言之一。
 */
import { ALL_LEVELS, GATE_SEQ_SPECS, teachingModulesFor, teachingSolutionOf } from '@lc/content';
import { type Design, DesignSchema, familySpecOf, InMemoryModuleLibrary } from '@lc/schema';
import {
  type Bit,
  evalGateDelayed,
  GATE_MAX_EVENTS,
  GATE_WINDOW_PS,
  SETTLE_PS_DEFAULT,
  toLogic,
} from '@lc/sim-core';
import { describe, expect, it } from 'vitest';
import { GATE_CANVAS_MAX_EVENTS, GATE_CANVAS_WINDOW_PS, handleRequest } from '../src/sim/handle';
import type { SimSnapshot, StudioRequest } from '../src/sim/protocol';

/** 与 App 发送的口径一致：整份 StoredModule（教学模块本身就是可解析的模板）*/
const MODS = [...teachingModulesFor('rtl')];
const LIB = new InMemoryModuleLibrary(MODS);
const levelOf = (id: string) => ALL_LEVELS.find((l) => l.id === id)!;
const designOf = (id: string): Design =>
  DesignSchema.parse(teachingSolutionOf(id, 'rtl')) as Design;

/** 每个输入端口都驱动 0：两侧口径都确定，避免 X/Z 收敛差异掩盖真问题 */
const allZeroInputs = (design: Design): Record<string, 0 | 1> =>
  Object.fromEntries(design.ports.filter((p) => p.dir === 'in').map((p) => [p.name, 0 as const]));

const simulate = (
  design: Design,
  extra: Partial<Extract<StudioRequest, { type: 'simulate' }>>,
): SimSnapshot => {
  const res = handleRequest({
    id: 1,
    type: 'simulate',
    design,
    library: MODS.map((m) => m as unknown),
    mode: 'logic',
    inputs: {},
    ...extra,
  } as StudioRequest);
  if (!res.snapshot) throw new Error(`没有快照：${JSON.stringify(res)}`);
  return res.snapshot;
};

const canvasLevels = (snap: SimSnapshot): Record<string, string> =>
  Object.fromEntries(snap.netSignals.map(([id, sig]) => [id, String(toLogic(sig))]));

// 已启用（原 describe.skip 的两条"缺陷"复核结果，见 2026-01 第 ㉑ 轮）：
//   ① 锁存器保持态撞事件上限 —— **真缺陷**，已修：`GateDelayOptions.powerUp` 默认 `'auto'`
//      （先按老口径跑，只有撞上限才用"确定性顺序上电"重跑）⇒ `s2-d-latch`/`s2-btn-latch`
//      冷启动 events=0 / capped=false，而判定侧的向量逐行结论**一位没变**（复审计 5 文件全绿）。
//   ② "经 handleRequest 跑出 0 事件、15~40 条网不一致" —— **是我的度量方式错**，不是引擎缺陷：
//      · 0 事件是正常的（全 0 输入、电路本来就静止 ⇒ 直跑同样 0 事件）；
//      · 那 15~40 条差异来自**我的对照直跑把宽端口的向量写成 1 位**（s3-alu 的 a/b 是 4 bit），
//        改成按端口宽度铺满后逐网一致（本文件下方直接按 `p.width` 铺）。
describe('逻辑关画布 = 有界延迟门级（同口径断言）', () => {
  for (const id of ['s3-half-adder', 's2-d-latch', 's3-alu', 's3-calc']) {
    it(`${id}：画布每条顶层网都在、且电平 == 门级引擎 nets`, () => {
      const design = designOf(id);
      const inputs = allZeroInputs(design);
      const snap = simulate(design, { gateCanvas: true, inputs });
      // ⚠️ 对照直跑必须**按端口宽度铺满**（s3-alu 的 a/b 是 4 bit）：只写 1 位会让门级引擎
      //    看到不同的输入向量，从而得出"15~40 条网不一致"的假差异（第 ㉑ 轮复核结论）。
      const widthOf = new Map(design.ports.map((p) => [p.name, p.width ?? 1]));
      const run = evalGateDelayed(
        design,
        LIB,
        new Map(
          Object.entries(inputs).map(([k, v]) => [
            k,
            Array.from({ length: widthOf.get(k) ?? 1 }, () => v as 0 | 1),
          ]),
        ),
        { seqSpecs: GATE_SEQ_SPECS, windowPs: 1_000_000 },
      );
      expect(run.ok).toBe(true);
      const canvas = canvasLevels(snap);
      const missing = design.nets.map((n) => n.id).filter((nid) => !(nid in canvas));
      const wrong: string[] = [];
      for (const net of design.nets) {
        const bit = run.nets.get(net.id);
        const expected = bit === undefined ? 'Z' : String(bit);
        if (canvas[net.id] !== expected)
          wrong.push(`${net.id}: 画布=${canvas[net.id]} 门级=${expected}`);
      }
      expect(missing, '画布缺网（画布必须覆盖全部顶层网）').toEqual([]);
      expect(wrong, '画布与门级电平不一致').toEqual([]);
      const kinds = snap.simDiagnostics.map((d) => d.kind);
      expect(kinds).toContain('gate-canvas');
      expect(kinds).not.toContain('gate-canvas-fallback');
      console.log(
        `[gc] ${id.padEnd(14)} 顶层网 ${design.nets.length} 条逐条相同｜${snap.simDiagnostics.find((d) => d.kind === 'gate-canvas')?.message}`,
      );
    }, 900_000);
  }

  it('含元件的设计 → 原样回落元件引擎（老存档/元件电路不受影响）', () => {
    const orChain = levelOf('s3-or-chain');
    const elementDesign = DesignSchema.parse(familySpecOf(orChain, 'rtl').reference) as Design;
    const withGate = simulate(elementDesign, {
      gateCanvas: true,
      inputs: allZeroInputs(elementDesign),
    });
    const withoutGate = simulate(elementDesign, {
      gateCanvas: false,
      inputs: allZeroInputs(elementDesign),
    });
    const kinds = withGate.simDiagnostics.map((d) => d.kind);
    expect(kinds).toContain('gate-canvas-fallback');
    expect(kinds).not.toContain('gate-canvas');
    expect(canvasLevels(withGate)).toEqual(canvasLevels(withoutGate));
    console.log(
      `[gc] 元件设计回落元件引擎：netSignals 与元件口径逐网相同｜${withGate.simDiagnostics.find((d) => d.kind === 'gate-canvas-fallback')?.message}`,
    );
  }, 900_000);

  it('时序关不受影响（不传 gateCanvas 就完全走元件引擎）', () => {
    const timingLevel = ALL_LEVELS.find(
      (l) => (l as { judgeMode?: string }).judgeMode === 'timing',
    )!;
    const timingDesign = DesignSchema.parse(familySpecOf(timingLevel, 'rtl').reference) as Design;
    const snap = simulate(timingDesign, { inputs: allZeroInputs(timingDesign) });
    const kinds = snap.simDiagnostics.map((d) => d.kind);
    expect(kinds).not.toContain('gate-canvas');
    expect(kinds).not.toContain('gate-canvas-fallback');
    console.log(
      `[gc] 时序关 ${timingLevel.id} 不传 gateCanvas：诊断 [${kinds.join(',')}]（无门级痕迹）`,
    );
  }, 900_000);

  it('门级状态跨请求保持（锁存器不会每次点击回上电初值）', () => {
    const design = designOf('s2-d-latch');
    const snapshotAt = (inputs: Record<string, 0 | 1>, id: number): SimSnapshot => {
      const res = handleRequest({
        id,
        type: 'simulate',
        design,
        library: MODS.map((m) => m as unknown),
        mode: 'logic',
        inputs,
        gateCanvas: true,
      } as StudioRequest);
      if (!res.snapshot) throw new Error('没有快照');
      return res.snapshot;
    };
    const first = canvasLevels(snapshotAt({ d: 0, en: 1 }, 1));
    const second = canvasLevels(snapshotAt({ d: 1, en: 0 }, 2));
    const cold = evalGateDelayed(
      design,
      LIB,
      new Map([
        ['d', [1 as const]],
        ['en', [0 as const]],
      ]),
      { seqSpecs: GATE_SEQ_SPECS, windowPs: 1_000_000 },
    );
    const coldQ = String(cold.nets.get('q') ?? '?');
    console.log(
      `[gc] 状态保持：①(en=1,d=0) q=${first.q}｜②(en=0,d=1) q=${second.q}｜同输入冷启动 q=${coldQ}`,
    );
    expect(first.q, '第一次应当写入 0').toBe('0');
    expect(second.q, '第二次必须保持 0（不许回上电初值）').toBe('0');
    expect(coldQ, '冷启动对照确实是上电初值 1').toBe('1');
  }, 900_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 界限值**同源**断言（用户第 ㉔ 轮第 5 条）：画布 / 判定 harness / 门级引擎三处的
// 时间窗与事件上限，值只能有一处定义（packages/sim-core/src/bounds.ts）。
// 任何一处又写死一个数字，这里就红 —— 防止"改了一处、忘了另一处"的口径悄悄分叉。
// ─────────────────────────────────────────────────────────────────────────────
describe('界限值同源（bounds.ts）', () => {
  it('画布常量 === sim-core 的 bounds（不是各写一份）', () => {
    expect(GATE_CANVAS_WINDOW_PS).toBe(GATE_WINDOW_PS);
    expect(GATE_CANVAS_MAX_EVENTS).toBe(GATE_MAX_EVENTS);
    // 数字本身也钉住（改它 = 改判定口径，必须停下回报）
    expect(GATE_WINDOW_PS).toBe(1_000_000);
    expect(GATE_MAX_EVENTS).toBe(500_000);
    expect(SETTLE_PS_DEFAULT).toBe(100_000);
  });

  it('所有关卡向量的 settlePs ≤ GATE_WINDOW_PS（画布 1µs 窗口的依据）', () => {
    let worst = 0;
    let worstLevel = '';
    for (const level of ALL_LEVELS) {
      for (const v of (level.vectors ?? []) as { settlePs?: number }[]) {
        const s = v.settlePs ?? SETTLE_PS_DEFAULT;
        if (s > worst) {
          worst = s;
          worstLevel = level.id;
        }
      }
    }
    expect(worstLevel).not.toBe('');
    expect(worst).toBeLessThanOrEqual(GATE_WINDOW_PS);
  });

  it('三处源码都只**引用** bounds，没有各自写死数字（源码级防漂移）', async () => {
    const { readFileSync } = await import('node:fs');
    const files = [
      'packages/sim-core/src/harness.ts',
      'packages/sim-core/src/gate-delay.ts',
      'apps/studio/src/sim/handle.ts',
    ];
    for (const rel of files) {
      const src = readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');
      // 不许再出现裸字面量（这两个数字曾经在三个文件里各写了一份）
      expect(/(?<![\d_])1_000_000(?![\d_])/.test(src), `${rel} 里不该再有裸的 1_000_000`).toBe(
        false,
      );
      expect(/(?<![\d_])500_000(?![\d_])/.test(src), `${rel} 里不该再有裸的 500_000`).toBe(false);
      // 而且必须真的从 bounds 引用
      expect(/GATE_WINDOW_PS|GATE_MAX_EVENTS/.test(src), `${rel} 应当引用 bounds 的常量`).toBe(
        true,
      );
    }
    // 唯一允许写死数字的地方是 bounds.ts 本身
    const bounds = readFileSync(
      new URL('../../../packages/sim-core/src/bounds.ts', import.meta.url),
      'utf8',
    );
    expect(bounds).toContain('export const GATE_WINDOW_PS = 1_000_000;');
    expect(bounds).toContain('export const GATE_MAX_EVENTS = 500_000;');
    expect(bounds).toContain('export const SETTLE_PS_DEFAULT = 100_000;');
  });

  it('rails 开关保留：不传 → 有延迟档=constant、零延迟档=ignore（老口径一字不动）', () => {
    const d = designOf('s3-adder-4'); // 参考解里有 gnd/vcc 符号
    const inputs = new Map<string, Bit[]>(
      Object.entries(allZeroInputs(d)).map(([k, v]) => [k, [v]]),
    );
    const implicit = evalGateDelayed(d, LIB, inputs);
    const explicit = evalGateDelayed(d, LIB, inputs, { rails: 'constant' });
    expect(Object.fromEntries(implicit.nets)).toEqual(Object.fromEntries(explicit.nets));
    const zeroImplicit = evalGateDelayed(d, LIB, inputs, { zeroDelay: true });
    const zeroExplicit = evalGateDelayed(d, LIB, inputs, { zeroDelay: true, rails: 'ignore' });
    expect(Object.fromEntries(zeroImplicit.nets)).toEqual(Object.fromEntries(zeroExplicit.nets));
  });
});
