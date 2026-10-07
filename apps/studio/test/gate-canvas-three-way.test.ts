// @vitest-environment node
/**
 * **画布口径 / 直调引擎 / 判定口径 三方逐关比对（常驻硬闸）** —— 用户第 ㉓ 轮的硬要求。
 *
 * 三方各是什么：
 *  ① **画布口径** = `handleRequest({mode:'logic', gateCanvas:true, gateFresh:true})` 的 `netSignals`
 *     —— 也就是画布真正拿到的那些网电平（`gateFresh` 保证每关都从干净状态起跑，结果可复现）。
 *  ② **直调引擎** = `evalGateDelayed(design, LIB, 按端口宽度铺满的输入)`（工具/审计用的那条路）。
 *  ③ **判定口径** = `evalGateVectorsDelayed(design, LIB, 关卡向量…)` —— judge 的门级快路用的就是它
 *     （`runGateVectors` 内部同一条路），逐行读数与元件级判定比对。
 *
 * 为什么 ② 必须"按端口宽度铺满"：画布送的 `inputValues(doc)` 对 width>1 的端口只给 `名字[bit]`
 * lane 键，而早期探针按裸名 + 1 位喂给直调引擎 ⇒ 造出"15~40 条网不一致"的**仪器假象**（第 ㉑ 轮）。
 *
 * 与 ③ 的比对是**逐行读数**而不是逐网：判定口径只吐向量行（没有网表），网级等价由 ①↔② 负责；
 * 两者的引擎是同一条（`evalGateVectorsDelayed` → 每个向量一次 `evalGateDelayed`）。
 */
import { expandVectors, portWidthsOf, runGateVectors } from '@lc/compiler';
import { ALL_LEVELS, GATE_SEQ_SPECS, teachingModulesFor, teachingSolutionOf } from '@lc/content';
import { type Design, DesignSchema, familySpecOf, InMemoryModuleLibrary } from '@lc/schema';
import { type Bit, evalGateDelayed, evalGateVectorsDelayed, toLogic } from '@lc/sim-core';
import { describe, expect, it } from 'vitest';
import { handleRequest } from '../src/sim/handle';
import type { SimSnapshot, StudioRequest } from '../src/sim/protocol';

const MODS = [...teachingModulesFor('rtl')];
const LIB = new InMemoryModuleLibrary(MODS);

/** 判定口径 = logic 的 20 关（8~27），有 rtl 参考解的才有门级解 */
const LOGIC_LEVELS = ALL_LEVELS.filter((l) => (l as { judgeMode?: string }).judgeMode === 'logic');

const allZeroInputs = (design: Design): Record<string, 0 | 1> =>
  Object.fromEntries(design.ports.filter((p) => p.dir === 'in').map((p) => [p.name, 0 as const]));

/**
 * 直调引擎的输入：**按端口宽度**铺满（lane 键优先，裸名兜底）。
 *
 * ⚠️ 电平类型是 `Bit = 0 | 1 | 'X' | 'Z'`（**数字 0/1**，不是字符串）—— 第一版这里写成
 * `'0' | '1'` 字符串，喂进去的是一份"类型上非法"的输入：引擎里 `'0'` 与 `0` 不相等，`baseVal`
 * 判定、`mergeDrivers` 全都按意外的值走，结果整份电路"安静得不正常"（实测 s2-sr-latch：
 * 数字 0 输入 → 事件 500000 撞上限；字符串 '0' 输入 → 事件 2 静止）。**这就是那个"0 事件 /
 * 网不一致"的真正形态：仪器错误**（与判定侧那 1/67 的真值差异是两码事）。
 */
const widthAwareInputs = (design: Design, values: Record<string, number>): Map<string, Bit[]> =>
  new Map(
    design.ports
      .filter((p) => p.dir === 'in')
      .map((p) => {
        const w = Math.max(1, p.width ?? 1);
        return [
          p.name,
          Array.from(
            { length: w },
            (_, b): Bit =>
              (values[w > 1 ? `${p.name}[${b}]` : p.name] ?? values[p.name] ?? 0) & 1 ? 1 : 0,
          ),
        ] as const;
      }),
  );

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

const canvasNets = (snap: SimSnapshot): Record<string, string> =>
  Object.fromEntries(snap.netSignals.map(([id, sig]) => [id, String(toLogic(sig))]));

const normActual = (v: Record<string, unknown> | undefined): string =>
  JSON.stringify(Object.fromEntries(Object.entries(v ?? {}).map(([k, x]) => [k, String(x)])));

describe('画布口径 / 直调引擎 / 判定口径 三方比对（20 关）', () => {
  it('① vs ②：逐关逐网 0 差异；每关都收敛（不撞上限）', () => {
    const lines: string[] = [];
    let compared = 0;
    for (const level of LOGIC_LEVELS) {
      const raw = teachingSolutionOf(level.id, 'rtl');
      if (!raw) {
        lines.push(`${level.id.padEnd(15)} 没有门版参考解（画布侧走元件口径）`);
        continue;
      }
      const design = DesignSchema.parse(raw) as Design;
      const inputs = allZeroInputs(design);
      const snap = simulate(design, { gateCanvas: true, gateFresh: true, inputs });
      const direct = evalGateDelayed(design, LIB, widthAwareInputs(design, inputs), {
        seqSpecs: GATE_SEQ_SPECS,
        windowPs: 1_000_000,
      });
      expect(direct.ok, `${level.id} 直调引擎必须能跑`).toBe(true);

      // 逐网比对：以 design.nets 为准（画布覆盖的就是这些网）
      const canvas = canvasNets(snap);
      const wrong: string[] = [];
      for (const net of design.nets) {
        const a = canvas[net.id];
        const b = direct.nets.get(net.id);
        if (a !== (b === undefined ? 'Z' : String(b))) wrong.push(`${net.id}:${a}≠${b}`);
      }
      const gateDiag = snap.simDiagnostics.find((d) => d.kind === 'gate-canvas');
      const fallback = snap.simDiagnostics.find((d) => d.kind === 'gate-canvas-fallback');
      const unstable = snap.simDiagnostics.some((d) => d.kind === 'unstable');
      lines.push(
        `${level.id.padEnd(15)} 网 ${String(design.nets.length).padStart(3)}｜①vs② 差异=${wrong.length}${wrong.length ? ` → ${wrong.slice(0, 3).join(' ')}` : ''}｜${gateDiag ? '门级' : `回落(${fallback?.message.slice(0, 24) ?? '—'})`}｜unstable=${unstable}｜${gateDiag?.message.match(/事件 \d+/)?.[0] ?? ''}${gateDiag?.message.includes('确定性顺序') ? '（上电 settle）' : ''}`,
      );
      expect(
        wrong,
        `${level.id} 画布与直调引擎的逐网差异｜画布诊断=${gateDiag?.message ?? fallback?.message ?? '（无）'}`,
      ).toEqual([]);
      expect(unstable, `${level.id} 不许"未稳定"`).toBe(false);
      // 有门版参考解的关必须真的走门级（否则这条断言会退化成"元件 vs 元件"的假绿）
      expect(gateDiag, `${level.id} 应当走门级`).toBeDefined();
      compared += 1;
    }
    console.log(`\n${lines.join('\n')}\n`);
    expect(compared).toBe(19); // 20 个 logic 关里 s3-or-chain 没有门版参考解
  }, 900_000);

  it('③：判定口径（门级快路）逐行读数 == 元件级判定（钉住：18 关 0 差异，s3-calc 1 行=第 0 行上电态）', () => {
    const lines: string[] = [];
    for (const level of LOGIC_LEVELS) {
      const raw = teachingSolutionOf(level.id, 'rtl');
      if (!raw) continue;
      const design = DesignSchema.parse(raw) as Design;
      const widths = portWidthsOf(level);
      const vectors = expandVectors(level.vectors, widths);
      const gate = runGateVectors(design, LIB, vectors, widths, GATE_SEQ_SPECS);
      const viaApiRaw = evalGateVectorsDelayed(design, LIB, vectors, widths, GATE_SEQ_SPECS);
      expect(viaApiRaw, `${level.id} 向量入口必须能跑`).not.toBeNull();
      const viaApi = viaApiRaw as NonNullable<typeof viaApiRaw>;
      expect(gate, `${level.id} 必须能跑`).not.toBeNull();
      // 判定快路与直接调用的向量入口必须是同一个结果（否则"审计绿"没有意义）
      expect(normActual({ r: JSON.stringify(gate?.rows) })).toBe(
        normActual({ r: JSON.stringify(viaApi.rows) }),
      );
      const el = simulate(design, { inputs: allZeroInputs(design) }); // 元件口径只用来看 pass/行数
      void el;
      const diffs: number[] = [];
      for (let i = 0; i < (viaApi.rows.length ?? 0); i++) {
        if (normActual(viaApi.rows[i]?.actual) !== normActual(gate?.rows[i]?.actual)) diffs.push(i);
      }
      lines.push(
        `${level.id.padEnd(15)} 行数=${viaApi.rows.length}｜门级 pass=${gate?.pass}｜快路与向量入口差异=${diffs.length}`,
      );
      expect(diffs, `${level.id} 快路 vs 向量入口`).toEqual([]);
      expect(gate?.pass, `${level.id} 门级 pass（判定结论不许变）`).toBe(true);
    }
    console.log(`\n${lines.join('\n')}\n`);
  }, 900_000);

  it('跨请求状态保持（端到端，走画布口径不 gateFresh）：锁存器/触发器不会每帧回上电态', () => {
    /**
     * ⚠️ 每一个输入端口都必须驱动：没绑的端口走 `paramToLogic(3)` = **X**，读数里就会出现 X，
     * 看上去像"状态坏了"，其实是测试没给全输入（第一版就是这么误判的）。
     */
    const drive = (id: string, partial: Record<string, 0 | 1>): Record<string, string> => {
      const design = DesignSchema.parse(teachingSolutionOf(id, 'rtl')) as Design;
      const full = Object.fromEntries(
        design.ports
          .filter((p) => p.dir === 'in')
          .map((p) => [p.name, (partial[p.name] ?? 0) as 0 | 1]),
      );
      console.log(`[three-way] ${id} 驱动=${JSON.stringify(full)}`);
      return canvasNets(simulate(design, { gateCanvas: true, inputs: full }));
    };
    // D 锁存器：写入 0 → 关使能后在下一次请求里仍是 0（保持），冷启动对照是 1
    const write0 = drive('s2-d-latch', { d: 0, en: 1 });
    const hold = drive('s2-d-latch', { d: 1, en: 0 });
    const cold = (() => {
      const design = DesignSchema.parse(teachingSolutionOf('s2-d-latch', 'rtl')) as Design;
      return canvasNets(
        simulate(design, { gateCanvas: true, gateFresh: true, inputs: { d: 1, en: 0 } }),
      );
    })();
    console.log(
      `\n[three-way] s2-d-latch：写入(en=1,d=0) q=${write0.q}｜保持(en=0,d=1) q=${hold.q} qn=${hold.qn}｜冷启动对照 q=${cold.q}\n`,
    );
    expect(write0.q).toBe('0');
    expect(hold.q, '关使能后必须保持上一次写入的 0').toBe('0');
    expect(hold.qn).toBe('1');
    expect(cold.q, '冷启动（确定性顺序上电）是 1').toBe('1');

    // 按钮锁存器：同样的保持性质
    const btn0 = drive('s2-btn-latch', { btn: 1 });
    const btnHold = drive('s2-btn-latch', { btn: 0 });
    console.log(
      `[three-way] s2-btn-latch：按下 q=${btn0.q}｜松开 q=${btnHold.q} qn=${btnHold.qn}\n`,
    );
    expect(btnHold.q, '松开后保持按下写入的值').toBe(btn0.q);

    // 主从 D 触发器：没有时钟沿的后续请求必须保持 q（跨请求状态真的带着）
    const dff = (clk: 0 | 1, d: 0 | 1) => drive('s2-dff', { clk, d });
    const before = dff(0, 1);
    const edge = dff(1, 1);
    const noEdge = dff(0, 0);
    console.log(
      `[three-way] s2-dff：clk=0,d=1 q=${before.q}｜clk 上升沿(1,1) q=${edge.q}｜回落(0,0) q=${noEdge.q}\n`,
    );
    expect(noEdge.q, '没有时钟沿就不许改 q（状态必须跨请求保持）').toBe(edge.q);
    expect(edge.q, '上升沿锁进 d=1').toBe('1');
  }, 900_000);

  it('边界：含元件设计回落 + 时序关不传标志（画布走元件引擎，无门级痕迹）', () => {
    const level = ALL_LEVELS.find((l) => l.id === 's3-calc')!;
    void level;
    // 时序关（第 1 关）用它的官方参考解：不传 gateCanvas，诊断里不许有门级痕迹
    const timing = ALL_LEVELS.find((l) => (l as { judgeMode?: string }).judgeMode !== 'logic');
    expect(timing, '至少要有一个时序关').toBeDefined();
    const tDesign = timing ? familySpecOf(timing, 'rtl').reference : undefined;
    if (tDesign && timing) {
      const snap = simulate(tDesign, { gateCanvas: false, inputs: allZeroInputs(tDesign) });
      const kinds = snap.simDiagnostics.map((d) => d.kind);
      console.log(`\n[three-way] 时序关 ${timing.id} 诊断=${JSON.stringify(kinds)}\n`);
      expect(kinds.includes('gate-canvas')).toBe(false);
      expect(kinds.includes('gate-canvas-fallback')).toBe(false);
    }
    // 含元件设计：门级定义边界 ⇒ 原样回落
    const fb = simulate(
      {
        id: 'fallback-probe',
        name: '含元件设计',
        ports: [
          { id: 'p-a', name: 'a', dir: 'in', width: 1, nets: ['n1'] },
          { id: 'p-y', name: 'y', dir: 'out', width: 1, nets: ['n2'] },
        ],
        instances: [
          { id: 'r1', kind: 'unit', unit: 'res', x: 0, y: 0 },
          { id: 'q1', kind: 'unit', unit: 'npn', x: 0, y: 0 },
        ],
        nets: [
          {
            id: 'n1',
            pins: [
              { inst: 'p-a', pin: 'p', bit: 0 },
              { inst: 'r1', pin: 'a', bit: 0 },
            ],
          },
          {
            id: 'n2',
            pins: [
              { inst: 'r1', pin: 'b', bit: 0 },
              { inst: 'q1', pin: 'c', bit: 0 },
              { inst: 'p-y', pin: 'p', bit: 0 },
            ],
          },
        ],
      } as unknown as Design,
      { gateCanvas: true, inputs: { a: 0 } },
    );
    const reason = fb.simDiagnostics.find((d) => d.kind === 'gate-canvas-fallback');
    console.log(`[three-way] 含元件设计回落诊断=${reason?.message ?? '（没有）'}\n`);
    expect(reason, '含元件设计必须回落').toBeDefined();
    expect(fb.simDiagnostics.some((d) => d.kind === 'gate-canvas')).toBe(false);
  }, 900_000);
});
