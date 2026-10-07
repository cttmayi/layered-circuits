/**
 * `gate-delay.ts`（有界延迟门级引擎）的护栏测试。
 *
 * 三条硬性正确性要求，一一对应下面的 describe：
 *  ① 零延迟等价：`zeroDelay: true` 必须与现有零延迟门级引擎 **逐网逐行**一致。
 *     实现上零延迟档**直接跑 settleGateSteps**（同一个引擎），护栏分两层：
 *       · 逐网：`nets` 与手工调 `settleGateSteps` 的结果逐位相同；
 *       · 逐行：与测试里独立写的"零延迟参照实现"（历史 runGateVectors 的循环）逐行相同 ——
 *         它验的是入口接线 / 输入保持 / 逐位读数 / 状态携带这一整套口径。
 *     注意：`@lc/compiler` 的 `runGateVectors` 已被切到**有延迟档**（默认就是本文件这套引擎），
 *     它不再是零延迟的参照物，所以参照实现固化在测试里（见 zeroDelayReferenceRows 的注释）。
 *  ② 惯性 vs 传输：有毛刺的电路上两者必须不同，且默认必须是 inertial。
 *  ③ 上限兜底：真环振（3 个非门搭的奇环）必须**返回**、`capped=true`、`events ≤ maxEvents`、
 *     `timePs ≤ windowPs`（不死循环）。
 *
 * 另外把移植时用到的参考数据固化成断言：s3-calc 展平 556 单元 / 666 网 / 20 轨、
 * `unsupported=[]`、accClk 在 kind+inertial 下 [0,1e6] 翻转 16 次且之后不再新增。
 */
import { expandVectors, portWidthsOf } from '@lc/compiler';
import { ALL_LEVELS, GATE_SEQ_SPECS, teachingModulesFor, teachingSolutionOf } from '@lc/content';
import { type Design, InMemoryModuleLibrary, type Level, type ModuleTemplate } from '@lc/schema';
import {
  type Bit,
  evalGateDelayed,
  evalGateVectorsDelayed,
  exportGateDelayState,
  flattenGateNetlist,
  GATE_DELAY_PS,
  GateDelaySim,
  type GateLibrary,
  GateStateStore,
  gateDelaySupport,
  importGateDelayState,
  type Logic,
  settleGateSteps,
  type TestVector,
  type VectorRow,
} from '@lc/sim-core';
import { describe, expect, it } from 'vitest';

/* ═════════════════════════ 夹具 ═════════════════════════ */

const library = new InMemoryModuleLibrary([...teachingModulesFor('rtl')]);
const templates = new Map<string, ModuleTemplate>(
  teachingModulesFor('rtl').map((m) => [m.name, m]),
);
const templateOf = (name: string): ModuleTemplate => {
  const m = templates.get(name);
  if (!m) throw new Error(`教学库里没有【${name}】`);
  return m;
};
const portNames = (t: ModuleTemplate): { ins: string[]; outs: string[] } => ({
  ins: t.ports.filter((p) => p.dir === 'in').map((p) => p.name),
  outs: t.ports.filter((p) => p.dir === 'out').map((p) => p.name),
});

/** 门级引擎要的最小接口（与 gate-fast.ts 的包法一致）*/
const gateLib: GateLibrary = {
  get: (hash: string) => {
    const m = library.get(hash);
    if (!m) return undefined;
    return {
      name: m.name,
      isSequential: m.isSequential,
      seq: GATE_SEQ_SPECS[m.name],
      ports: m.ports.map((p) => ({ name: p.name, dir: p.dir, width: p.width })),
      body: m.body,
    };
  },
};

type LogicLevel = Level & { judgeMode?: string };
const logicLevels = ALL_LEVELS.filter(
  (l) => (l as LogicLevel).judgeMode === 'logic',
) as LogicLevel[];

const solutions = new Map<string, Design | null>();
const solutionOf = (id: string): Design | null => {
  if (!solutions.has(id)) solutions.set(id, teachingSolutionOf(id, 'rtl'));
  return solutions.get(id) ?? null;
};

const laneOf = (lane: string): { port: string; bit: number } => {
  const m = /^(.+)\[(\d+)\]$/.exec(lane);
  if (m?.[1] !== undefined && m[2] !== undefined) return { port: m[1], bit: Number(m[2]) };
  return { port: lane, bit: 0 };
};

/** 与 runVectors / runGateVectors 同口径：未列出的输入保持上一次的值 */
const applyHeld = (
  held: Map<string, Bit[]>,
  inputs: Record<string, unknown>,
  widths: ReadonlyMap<string, number>,
): void => {
  for (const [lane, value] of Object.entries(inputs)) {
    const { port, bit } = laneOf(lane);
    const w = widths.get(port) ?? 1;
    const bits = held.get(port) ?? Array.from({ length: w }, (): Bit => 'Z');
    bits[bit] = value as Bit;
    held.set(port, bits);
  }
};

const normActual = (v: Record<string, unknown> | undefined): string =>
  JSON.stringify(Object.fromEntries(Object.entries(v ?? {}).map(([k, x]) => [k, String(x)])));

/** 全 0 的输入（s3-calc 的上电口径：所有输入口给 0）*/
const zeroInputs = (design: Design): Map<string, Bit[]> => {
  const out = new Map<string, Bit[]>();
  for (const p of design.ports) {
    if (p.dir !== 'in') continue;
    out.set(
      p.name,
      Array.from({ length: Math.max(1, p.width) }, (): Bit => 0),
    );
  }
  return out;
};

/* ═════════════════════════ 0. 展平自检（含参考数据） ═════════════════════════ */

describe('gate-delay · 展平与参考数据', () => {
  it('s3-calc：556 单元 / 666 网 / 20 轨 / 不支持清单为空；延迟表就是 rtl 实测值', () => {
    const design = solutionOf('s3-calc') as Design;
    expect(design).not.toBeNull();
    const { flat, unsupported } = flattenGateNetlist(design, library, GATE_SEQ_SPECS);
    const tally: Record<string, number> = {};
    for (const c of flat.cells) {
      const k = `${c.kind}:${c.name}`;
      tally[k] = (tally[k] ?? 0) + 1;
    }
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) flattenGateNetlist(design, library, GATE_SEQ_SPECS);
    const ms = (performance.now() - t0) / 5;
    console.log(
      `[gd10] s3-calc 展平：单元 ${flat.cells.length} 网 ${flat.netCount} 轨 ${flat.railCount} ` +
        `不支持 ${unsupported.length}｜构成 ${JSON.stringify(tally)}｜展平一次性成本 ${ms.toFixed(1)}ms`,
    );
    expect(flat.cells.length).toBe(556);
    expect(flat.netCount).toBe(666);
    expect(flat.railCount).toBe(20);
    expect(unsupported).toEqual([]);
    expect(gateDelaySupport(design, library, GATE_SEQ_SPECS)).toEqual({ ok: true });
    // 参考数据（各门 rtl 身体关键路径实测值，ps）
    expect(GATE_DELAY_PS.非门).toBe(1500);
    expect(GATE_DELAY_PS.与非门).toBe(2500);
    expect(GATE_DELAY_PS.或非门).toBe(1500);
    expect(GATE_DELAY_PS.或门).toBe(1600);
    expect(GATE_DELAY_PS.与门).toBe(1600);
    expect(GATE_DELAY_PS.异或门).toBe(6500);
    expect(GATE_DELAY_PS.同或门).toBe(8000);
  });

  it('不支持的三种情形如实报出来（元件 / 缺 SeqSpec / 库里找不到模块）', () => {
    const andT = templateOf('与门');
    const ffT = templateOf('主从D触发器');
    const { ins, outs } = portNames(andT);
    const withUnit: Design = {
      schemaVersion: 1,
      id: 'd-unit',
      name: '含元件',
      instances: [
        { kind: 'module', id: 'G1', module: andT.hash },
        { kind: 'unit', id: 'R1', unit: 'res' },
      ],
      nets: [
        { id: 'na', pins: [{ inst: 'G1', pin: ins[0] as string, bit: 0 }] },
        { id: 'nb', pins: [{ inst: 'G1', pin: ins[1] as string, bit: 0 }] },
        { id: 'ny', pins: [{ inst: 'G1', pin: outs[0] as string, bit: 0 }] },
      ],
      ports: [],
    };
    const unitSupport = gateDelaySupport(withUnit, library, GATE_SEQ_SPECS);
    expect(unitSupport.ok).toBe(false);
    expect(unitSupport.reason).toContain('元件');
    expect(evalGateVectorsDelayed(withUnit, library, [], undefined, GATE_SEQ_SPECS, {})).toBeNull();

    const withSeq: Design = {
      schemaVersion: 1,
      id: 'd-seq',
      name: '缺 SeqSpec 的时序器件',
      instances: [{ kind: 'module', id: 'F1', module: ffT.hash }],
      nets: [],
      ports: [],
    };
    expect(gateDelaySupport(withSeq, library, {}).ok).toBe(false);
    expect(gateDelaySupport(withSeq, library, {}).reason).toContain('SeqSpec');
    expect(evalGateVectorsDelayed(withSeq, library, [], undefined, {}, {})).toBeNull();
    // 不传 seqSpecs 时是**保守**判定：带时序器件的设计一律报"没有 SeqSpec"（宁可不跑不能算错）
    expect(gateDelaySupport(withSeq, library).ok).toBe(false);
    expect(gateDelaySupport(withSeq, library).reason).toContain('SeqSpec');
    expect(evalGateVectorsDelayed(withSeq, library, [], undefined, undefined, {})).toBeNull();
    // 传了表就放行
    expect(gateDelaySupport(withSeq, library, GATE_SEQ_SPECS)).toEqual({ ok: true });

    // 库里找不到模块
    const missing: Design = {
      schemaVersion: 1,
      id: 'd-missing',
      name: '库里没有',
      instances: [{ kind: 'module', id: 'X1', module: '不存在的模块' }],
      nets: [],
      ports: [],
    };
    expect(gateDelaySupport(missing, library, GATE_SEQ_SPECS).ok).toBe(false);
    expect(gateDelaySupport(missing, library, GATE_SEQ_SPECS).reason).toContain('库里找不到');

    // GateDelaySim 只做有延迟档：零延迟档走两个入口，传进类里要**响**（不静默换语义）
    const { flat } = flattenGateNetlist(
      solutionOf('s2-d-latch') as Design,
      library,
      GATE_SEQ_SPECS,
    );
    expect(() => new GateDelaySim(flat, { zeroDelay: true })).toThrow(/零延迟/);
  });
});

/* ═════════════════════════ 1. 零延迟等价（硬性要求 ①） ═════════════════════════ */

/**
 * **零延迟参照实现**（测试里独立写一遍，不复用被测代码）：就是历史上 `runGateVectors` 的
 * 零延迟循环 —— 一台持久 `GateStateStore`、未列出的输入保持上一次的值、逐向量 `settleGateSteps`、
 * 读数按 `name[i]`（宽 >1）取、`timePs = 0`、窗口恒 `[0,0]`。
 *
 * 为什么要在这里重写一遍：`packages/compiler/src/gate-fast.ts` 的 `runGateVectors` 已经切到
 * **有延迟档**（`GATE_DELAYED_ENGINE = true`，默认就是本文件这套引擎），它不再是零延迟的参照物；
 * 而"零延迟档必须与现有零延迟门级引擎逐位一致"这条护栏仍然要有人站岗，所以参照实现固化在这里。
 */
const zeroDelayReferenceRows = (
  design: Design,
  vectors: readonly { inputs: Record<string, unknown>; expect?: Record<string, unknown> }[],
  widths: ReadonlyMap<string, number>,
): {
  pass: boolean;
  rows: { actual: Record<string, Logic>; ok: boolean }[];
  unstable: boolean;
} | null => {
  const store = new GateStateStore();
  const held = new Map<string, Bit[]>();
  const rows: { actual: Record<string, Logic>; ok: boolean }[] = [];
  let unstable = false;
  for (const vector of vectors) {
    applyHeld(held, vector.inputs, widths);
    const out = settleGateSteps(design, gateLib, new Map(held), store);
    if (!out.ok) return null;
    if (out.unstable === true) unstable = true;
    const actual: Record<string, Logic> = {};
    for (const [port, bits] of out.outPorts) {
      const w = widths.get(port) ?? 1;
      bits.forEach((b, i) => {
        actual[w > 1 ? `${port}[${i}]` : port] = String(b) as Logic;
      });
    }
    const ok = Object.entries(vector.expect ?? {}).every(
      ([lane, exp]) => String(exp) === String(actual[lane] ?? 'Z'),
    );
    rows.push({ actual, ok });
  }
  return { pass: rows.every((r) => r.ok), rows, unstable };
};

describe('gate-delay · 零延迟等价（zeroDelay）', () => {
  it('19 关逐行：zeroDelay 门级 vs 零延迟参照实现（逐行读数、pass、行数、行形状全等）', () => {
    const lines: string[] = [];
    let levels = 0;
    let rowDiff = 0;
    let totalRows = 0;
    let unstableDiff = 0;
    for (const level of logicLevels) {
      const design = solutionOf(level.id);
      if (!design) {
        lines.push(`${level.id}：（无门版参考解）`);
        continue;
      }
      const widths = portWidthsOf(level);
      const vectors = expandVectors(level.vectors, widths);
      const official = zeroDelayReferenceRows(design, vectors, widths);
      const mine = evalGateVectorsDelayed(design, library, vectors, widths, GATE_SEQ_SPECS, {
        zeroDelay: true,
      });
      expect(official).not.toBeNull();
      expect(mine).not.toBeNull();
      const offRun = official as NonNullable<typeof official>;
      const mineRun = mine as NonNullable<typeof mine>;
      const diff = offRun.rows.filter(
        (r, i) => normActual(r.actual) !== normActual(mineRun.rows[i]?.actual),
      ).length;
      rowDiff += diff;
      totalRows += offRun.rows.length;
      levels++;
      if (offRun.unstable !== mineRun.unstable) unstableDiff++;
      lines.push(
        `${level.id}: pass 参照=${String(offRun.pass)}/我=${String(mineRun.pass)}｜逐行差异 ${diff}/${offRun.rows.length}｜` +
          `unstable 参照=${String(offRun.unstable)}/我=${String(mineRun.unstable)} ${diff === 0 ? '✅' : '❌'}`,
      );
      // 逐关即时打印：一条断言挂了也能看出是哪一关、差在哪
      console.log(`[gd20] ${lines[lines.length - 1]}`);
      expect(mineRun.pass).toBe(offRun.pass);
      expect(mineRun.rows.length).toBe(offRun.rows.length);
      expect(diff).toBe(0);
      // 零延迟档的行形状与历史零延迟门级引擎完全同形（没有时间轴）
      const first = mineRun.rows[0] as VectorRow;
      expect(first.timePs).toBe(0);
      expect(first.window).toEqual({ fromPs: 0, toPs: 0 });
    }
    console.log(`[gd20] 零延迟逐行等价（vs 零延迟参照实现）：\n[gd20] ${lines.join('\n[gd20] ')}`);
    console.log(
      `[gd20] 合计：${levels} 关 / ${totalRows} 行 / 逐行数值差异 ${rowDiff} / unstable 不一致 ${unstableDiff}（0/0 = 完全一致）`,
    );
    expect(levels).toBeGreaterThan(10);
    expect(totalRows).toBeGreaterThan(150);
    expect(rowDiff).toBe(0);
    expect(unstableDiff).toBe(0);
  });

  it('逐网：zeroDelay 的 nets 与 settleGateSteps 的 nets 完全一致（含 s3-calc / 锁存器 / 寄存器关）', () => {
    const ids = ['s3-calc', 's2-d-latch', 's2-dff', 's3-alu', 's3-reg-8', 's3-digit-entry'];
    const lines: string[] = [];
    let compared = 0;
    let diff = 0;
    for (const id of ids) {
      const design = solutionOf(id) as Design;
      const level = logicLevels.find((l) => l.id === id) as LogicLevel;
      const widths = portWidthsOf(level);
      const vectors = expandVectors(level.vectors, widths);
      const storeOfficial = new GateStateStore();
      const storeMine = new GateStateStore();
      const held = new Map<string, Bit[]>();
      let rowDiff = 0;
      let rowCompared = 0;
      const samples: string[] = [];
      let rows = 0;
      for (const vector of vectors) {
        applyHeld(held, vector.inputs, widths);
        const official = settleGateSteps(design, gateLib, new Map(held), storeOfficial);
        const mine = evalGateDelayed(design, library, new Map(held), {
          zeroDelay: true,
          state: storeMine,
          seqSpecs: GATE_SEQ_SPECS,
        });
        expect(mine.ok).toBe(true);
        expect(official.ok).toBe(true);
        rows++;
        for (const [netId, want] of official.nets) {
          rowCompared++;
          const got = mine.nets.get(netId);
          if (String(got) !== String(want)) {
            rowDiff++;
            if (samples.length < 6) {
              samples.push(
                `向量 #${rows - 1} 网 ${netId}：官方 ${String(want)} / 我 ${String(got)}`,
              );
            }
          }
        }
      }
      compared += rowCompared;
      diff += rowDiff;
      lines.push(
        `${id}（${rows} 向量）：逐网对比 ${rowCompared} 处，差异 ${rowDiff} ${rowDiff === 0 ? '✅' : `❌ ${samples.join('；')}`}`,
      );
      expect(rowDiff).toBe(0);
    }
    console.log(`[gd21] 零延迟逐网等价（vs settleGateSteps）：\n[gd21] ${lines.join('\n[gd21] ')}`);
    console.log(`[gd21] 合计对比 ${compared} 处网值，差异 ${diff}`);
    expect(compared).toBeGreaterThan(1000);
    expect(diff).toBe(0);
  });

  it('有延迟档与零延迟档确实不同：默认档有时间轴、有事件，行窗口在动', () => {
    const design = solutionOf('s3-calc') as Design;
    const level = logicLevels.find((l) => l.id === 's3-calc') as LogicLevel;
    const widths = portWidthsOf(level);
    const vectors = expandVectors(level.vectors, widths);
    const inputs = zeroInputs(design);
    // 注：这份设计含时序器件（D锁存器），必须把 SeqSpec 表交给引擎 —— 不传就如实报"没有 SeqSpec"
    const delayed = evalGateDelayed(design, library, inputs, {
      windowPs: 1_000_000,
      seqSpecs: GATE_SEQ_SPECS,
    });
    const zero = evalGateDelayed(design, library, inputs, {
      zeroDelay: true,
      seqSpecs: GATE_SEQ_SPECS,
    });
    console.log(
      `[gd22] s3-calc 单窗口：有延迟（kind/inertial）事件 ${delayed.events} 到 ${delayed.timePs}ps capped=${String(delayed.capped)}｜` +
        `零延迟 事件 ${zero.events} timePs ${zero.timePs} capped=${String(zero.capped)}`,
    );
    expect(delayed.ok).toBe(true);
    expect(zero.ok).toBe(true);
    // 不传 SeqSpec 表：如实拒绝，不猜（这是 API 契约的一部分）
    const noSpecs = evalGateDelayed(design, library, inputs, { windowPs: 1_000_000 });
    expect(noSpecs.ok).toBe(false);
    expect(noSpecs.reason).toContain('SeqSpec');
    expect(delayed.events).toBeGreaterThan(0);
    expect(delayed.timePs).toBe(1_000_000);
    expect(delayed.capped).toBe(false);
    expect(zero.events).toBe(0);
    expect(zero.timePs).toBe(0);

    // 向量级：有延迟档的行带真实窗口（[上次采样, 本次采样]），零延迟档恒 [0,0]
    const zeroVectors = evalGateVectorsDelayed(design, library, vectors, widths, GATE_SEQ_SPECS, {
      zeroDelay: true,
    }) as NonNullable<ReturnType<typeof evalGateVectorsDelayed>>;
    const delayedVectors = evalGateVectorsDelayed(
      design,
      library,
      vectors,
      widths,
      GATE_SEQ_SPECS,
      {},
    ) as NonNullable<ReturnType<typeof evalGateVectorsDelayed>>;
    const rowDiff = delayedVectors.rows.filter(
      (r, i) => normActual(r.actual) !== normActual(zeroVectors.rows[i]?.actual),
    ).length;
    console.log(
      `[gd22] s3-calc 向量级：有延迟 vs 零延迟逐行差异 ${rowDiff}/${zeroVectors.rows.length}｜` +
        `有延迟窗口 ${JSON.stringify(delayedVectors.rows[1]?.window)} 零延迟窗口 ${JSON.stringify(zeroVectors.rows[1]?.window)}`,
    );
    expect(delayedVectors.rows[1]?.window.toPs).toBeGreaterThan(0);
    expect(zeroVectors.rows[1]?.window).toEqual({ fromPs: 0, toPs: 0 });
    expect(rowDiff).toBeGreaterThan(0);
  });
});

/* ═════════════════════════ 2. 惯性 vs 传输（硬性要求 ②） ═════════════════════════ */

/**
 * 手工搭的"毛刺陷阱"：`y = 与门(a=1, b)` 的输出当**电平型 D 锁存器**的使能，数据脚接恒定 0。
 * 让 b 出现一个**短于与门延迟**的 1→0 脉冲：
 *   · inertial  → 脉冲被吃掉，y 从头到尾是 0 → 锁存器从不透明 → q 保持上电初值 1；
 *   · transport → 脉冲照传，y 在 1 个时间步里 0→1→0 → 锁存器当拍透明、把 d=0 写进去 → q 变 0。
 * 这就是"毛刺打进锁存器"的最小复现（正是 transport 会把若干关算错的根因）。
 */
const glitchTrap = (): { design: Design; a: string; b: string } => {
  const andT = templateOf('与门');
  const latchT = templateOf('D锁存器');
  const spec = GATE_SEQ_SPECS[latchT.name] as { clock: string; data: readonly string[] };
  const andIns = portNames(andT).ins;
  const andOut = portNames(andT).outs[0] as string;
  const qPort = portNames(latchT).outs[0] as string;
  const a = andIns[0] as string;
  const b = andIns[1] as string;
  return {
    a,
    b,
    design: {
      schemaVersion: 1,
      id: 'glitch-trap',
      name: '毛刺陷阱',
      instances: [
        { kind: 'module', id: 'G1', module: andT.hash },
        { kind: 'module', id: 'L1', module: latchT.hash },
        { kind: 'gnd', id: 'Z0' },
      ],
      nets: [
        { id: 'na', pins: [{ inst: 'G1', pin: a, bit: 0 }] },
        { id: 'nb', pins: [{ inst: 'G1', pin: b, bit: 0 }] },
        {
          id: 'ny',
          pins: [
            { inst: 'G1', pin: andOut, bit: 0 },
            { inst: 'L1', pin: spec.clock, bit: 0 },
          ],
        },
        {
          id: 'nz',
          pins: [
            { inst: 'L1', pin: spec.data[0] as string, bit: 0 },
            { inst: 'Z0', pin: 'p', bit: 0 },
          ],
        },
        { id: 'nq', pins: [{ inst: 'L1', pin: qPort, bit: 0 }] },
      ],
      ports: [
        { id: 'pa', name: a, dir: 'in', width: 1, nets: ['na'] },
        { id: 'pb', name: b, dir: 'in', width: 1, nets: ['nb'] },
        { id: 'pq', name: qPort, dir: 'out', width: 1, nets: ['nq'] },
      ],
    },
  };
};

/** 跑毛刺陷阱：a=1 常开，b 给一个 1 个时间步宽的脉冲（与门延迟 = 2 个时间步）*/
const runGlitchTrap = (semantics: 'inertial' | 'transport' | undefined) => {
  const { design, a, b } = glitchTrap();
  const { flat } = flattenGateNetlist(design, library, GATE_SEQ_SPECS);
  const sim = new GateDelaySim(flat, semantics === undefined ? {} : { semantics });
  sim.watch('ny');
  sim.setInputs(
    new Map<string, Bit[]>([
      [a, [1]],
      [b, [0]],
    ]),
  );
  sim.advance('window', 1); // → t=1
  sim.setInputs(
    new Map<string, Bit[]>([
      [a, [1]],
      [b, [1]], // 脉冲前沿：落在门的延迟之内
    ]),
  );
  sim.advance('window', 1); // → t=2
  sim.setInputs(
    new Map<string, Bit[]>([
      [a, [1]],
      [b, [0]], // 脉冲后沿
    ]),
  );
  const out = sim.advance('window', 50); // → t=52：transport 的毛刺有足够时间写进锁存器
  return {
    q: sim.netValue('nq'),
    enEdges: sim.edgesOf('ny').length,
    events: out.events,
    quiescent: out.quiescent,
  };
};

describe('gate-delay · 惯性 vs 传输（默认必须 inertial）', () => {
  it('毛刺陷阱：inertial 吃掉短脉冲、transport 把毛刺打进锁存器（终值不同）', () => {
    const inertial = runGlitchTrap('inertial');
    const transport = runGlitchTrap('transport');
    const byDefault = runGlitchTrap(undefined);
    console.log(
      `[gd30] 毛刺陷阱：inertial q=${String(inertial.q)}（使能网跳变 ${inertial.enEdges} 次）｜` +
        `transport q=${String(transport.q)}（使能网跳变 ${transport.enEdges} 次）｜默认 q=${String(byDefault.q)}（跳变 ${byDefault.enEdges} 次）`,
    );
    expect(inertial.enEdges).toBe(0); // 短脉冲被吃掉：使能网从头到尾没动
    expect(transport.enEdges).toBeGreaterThan(0); // 毛刺照传：使能网被毛刺推了一下
    expect(String(inertial.q)).not.toBe(String(transport.q));
    // 默认口径就是 inertial
    expect(String(byDefault.q)).toBe(String(inertial.q));
    expect(byDefault.enEdges).toBe(inertial.enEdges);
  });

  it('默认 = inertial；多关对比：transport 会在若干关上给出不同的逐行读数', () => {
    const lines: string[] = [];
    const offenders: string[] = [];
    let compared = 0;
    let transportOnlyFailures = 0;
    for (const level of logicLevels) {
      const design = solutionOf(level.id);
      if (!design) continue;
      const widths = portWidthsOf(level);
      const vectors = expandVectors(level.vectors, widths);
      const run = (semantics: 'inertial' | 'transport' | undefined) =>
        evalGateVectorsDelayed(design, library, vectors, widths, GATE_SEQ_SPECS, {
          ...(semantics === undefined ? {} : { semantics }),
        }) as NonNullable<ReturnType<typeof evalGateVectorsDelayed>>;
      const inertial = run('inertial');
      const transport = run('transport');
      // 默认档（不传 semantics）必须与显式 inertial 的**每一行**都一致
      const byDefault = run(undefined);
      expect(byDefault.pass).toBe(inertial.pass);
      const defaultDiff = byDefault.rows.filter(
        (r, i) => normActual(r.actual) !== normActual(inertial.rows[i]?.actual),
      ).length;
      expect(defaultDiff).toBe(0);
      const diff = inertial.rows.filter(
        (r, i) => normActual(r.actual) !== normActual(transport.rows[i]?.actual),
      ).length;
      compared++;
      if (diff > 0) offenders.push(`${level.id}(差异 ${diff}/${inertial.rows.length} 行)`);
      if (inertial.pass && !transport.pass) transportOnlyFailures++;
      lines.push(
        `${level.id}: transport 与 inertial 逐行差异 ${diff}/${inertial.rows.length}｜pass inertial=${String(inertial.pass)} transport=${String(transport.pass)}`,
      );
    }
    console.log(`[gd31] inertial vs transport 逐关：\n[gd31] ${lines.join('\n[gd31] ')}`);
    console.log(
      `[gd31] ${compared} 关里 transport 与 inertial 读数不同的有 ${offenders.length} 关：${offenders.join('、') || '（无）'}；` +
        `其中"惯性判过、传输判错"的有 ${transportOnlyFailures} 关`,
    );
    // 同一份设计、同一份向量，只有语义不同 → 必须能看出差别（否则"语义"这个开关是假的）
    expect(offenders.length).toBeGreaterThan(0);
    // 与移植参考数据一致：transport 会把 9~10 关弄错（惯性判过、传输判错）
    expect(transportOnlyFailures).toBeGreaterThanOrEqual(9);
  });

  it('s3-calc 上电窗口：两种语义的事件数/内部跳变表不同（惯性才是实测对的那一档）', () => {
    const design = solutionOf('s3-calc') as Design;
    const { flat } = flattenGateNetlist(design, library, GATE_SEQ_SPECS);
    const inputs = zeroInputs(design);
    const probe = (semantics: 'inertial' | 'transport') => {
      const sim = new GateDelaySim(flat, { caliber: 'kind', semantics, maxEvents: 300_000 });
      sim.watch('accClk');
      sim.setInputs(inputs);
      const out = sim.advance('window', 1_000_000);
      return {
        edges: sim.edgesOf('accClk').length,
        capped: out.capped,
        events: out.events,
        nets: sim.nets(),
        trace: sim
          .edgesOf('accClk')
          .slice(0, 12)
          .map((e) => `${e.atPs}=${String(e.value)}`)
          .join(' '),
      };
    };
    const inertial = probe('inertial');
    const transport = probe('transport');
    const netDiff = [...inertial.nets].filter(
      ([netId, v]) => String(v) !== String(transport.nets.get(netId)),
    ).length;
    console.log(
      `[gd32] s3-calc [0,1e6]：inertial accClk 翻转 ${inertial.edges} 次（事件 ${inertial.events} capped=${String(inertial.capped)}）｜` +
        `transport 翻转 ${transport.edges} 次（事件 ${transport.events} capped=${String(transport.capped)}）｜窗口末态不同的网 ${netDiff}/${inertial.nets.size}`,
    );
    console.log(`[gd32] inertial 前 12 个沿：${inertial.trace}`);
    console.log(`[gd32] transport 前 12 个沿：${transport.trace}`);
    expect(inertial.edges).toBe(16); // 与移植参考数据一致
    expect(inertial.capped).toBe(false);
    expect(transport.capped).toBe(false);
    // 同一份上电瞬态：传输语义多做了 3.4 倍的工作（毛刺没被吃掉），结果也不同
    expect(transport.events).toBeGreaterThan(inertial.events);
    expect(netDiff).toBeGreaterThan(0);
  });
});

/* ═════════════════════════ 3. 环振兜底（硬性要求 ③） ═════════════════════════ */

/** 3 个非门首尾相接 = 奇环（一定振）*/
const ringOscillator = (): Design => {
  const notT = templateOf('非门');
  const { ins, outs } = portNames(notT);
  const i = ins[0] as string;
  const o = outs[0] as string;
  return {
    schemaVersion: 1,
    id: 'ring-3',
    name: '三非门奇环',
    instances: [
      { kind: 'module', id: 'N0', module: notT.hash },
      { kind: 'module', id: 'N1', module: notT.hash },
      { kind: 'module', id: 'N2', module: notT.hash },
    ],
    nets: [
      {
        id: 'y0',
        pins: [
          { inst: 'N0', pin: o, bit: 0 },
          { inst: 'N1', pin: i, bit: 0 },
        ],
      },
      {
        id: 'y1',
        pins: [
          { inst: 'N1', pin: o, bit: 0 },
          { inst: 'N2', pin: i, bit: 0 },
        ],
      },
      {
        id: 'y2',
        pins: [
          { inst: 'N2', pin: o, bit: 0 },
          { inst: 'N0', pin: i, bit: 0 },
        ],
      },
    ],
    ports: [{ id: 'py', name: 'y', dir: 'out', width: 1, nets: ['y0'] }],
  };
};

describe('gate-delay · 环振上限兜底（一定返回、不死循环）', () => {
  it('3 非门奇环：先证明它真在振，再证明撞上限时 capped / events ≤ maxEvents / timePs ≤ windowPs', () => {
    const design = ringOscillator();
    expect(gateDelaySupport(design, library, GATE_SEQ_SPECS)).toEqual({ ok: true });
    const { flat } = flattenGateNetlist(design, library, GATE_SEQ_SPECS);
    expect(flat.cells.length).toBe(3);

    // ① 它真的在振（短窗口 + 充裕额度）：y0 在这段窗口里多次翻转
    const free = new GateDelaySim(flat, { maxEvents: 100_000 });
    free.watch('y0');
    free.setInputs(new Map());
    const short = free.advance('window', 20);
    const flips = free.edgesOf('y0').length;
    console.log(
      `[gd40] 三非门奇环：窗口 20 内 y0 翻转 ${flips} 次（事件 ${short.events}，capped=${String(short.capped)}，y=${String(free.netValue('y0'))}）→ ${flips > 0 ? '确实在振' : '没振'}`,
    );
    expect(flips).toBeGreaterThan(2);
    expect(short.capped).toBe(false);

    // ② 撞上限：固定窗口 + 小额度 → 必须**返回**，且 events ≤ maxEvents、timePs ≤ windowPs
    const windowPs = 1_000_000;
    const maxEvents = 200;
    const t0 = performance.now();
    const run = evalGateDelayed(design, library, new Map(), { windowPs, maxEvents });
    const ms = performance.now() - t0;
    console.log(
      `[gd41] 三非门奇环：窗口 ${windowPs}ps / 上限 ${maxEvents} 事件 → ok=${String(run.ok)} capped=${String(run.capped)} ` +
        `events=${run.events} timePs=${run.timePs} y=${String(run.outPorts.get('y')?.[0])} 用时 ${ms.toFixed(1)}ms（已返回，没死循环）`,
    );
    expect(run.ok).toBe(true);
    expect(run.capped).toBe(true);
    expect(run.events).toBeLessThanOrEqual(maxEvents);
    expect(run.timePs).toBeLessThanOrEqual(windowPs);
    expect(ms).toBeLessThan(10_000);

    // ③ 零延迟档同一份环是"塌成静态"的（这正是需要有延迟的原因：零延迟里没有环振）
    const zero = evalGateDelayed(design, library, new Map(), { zeroDelay: true });
    console.log(
      `[gd41] 零延迟档同一份环：ok=${String(zero.ok)} capped=${String(zero.capped)} events=${zero.events} y=${String(zero.outPorts.get('y')?.[0])}`,
    );
    expect(zero.ok).toBe(true);
    expect(zero.capped).toBe(false);
    expect(zero.events).toBe(0);
  });

  it('向量级入口也守得住：环振电路的向量跑完返回、unstable=true、行窗口不越界', () => {
    const design = ringOscillator();
    const vectors = [
      { inputs: {}, note: '上电' },
      { inputs: {}, note: '再等一个窗口' },
    ];
    const run = evalGateVectorsDelayed(design, library, vectors, undefined, GATE_SEQ_SPECS, {
      maxEvents: 100,
      windowPs: 1_000_000,
    });
    expect(run).not.toBeNull();
    const mine = run as NonNullable<typeof run>;
    console.log(
      `[gd42] 向量级：${mine.rows.length} 行，pass=${String(mine.pass)} unstable=${String(mine.unstable)}｜` +
        `#0 actual=${JSON.stringify(mine.rows[0]?.actual)} window=${JSON.stringify(mine.rows[0]?.window)}`,
    );
    expect(mine.rows.length).toBe(2);
    expect(mine.unstable).toBe(true);
    expect(mine.rows[0]?.window.toPs).toBeLessThanOrEqual(1_000_000);
    expect(mine.rows[0]?.timePs).toBeLessThanOrEqual(1_000_000);
  });
});

/* ═════════════════════════ 4. 移植参考数据（accClk 16 次） ═════════════════════════ */

describe('gate-delay · s3-calc 瞬态参考数据（kind + inertial）', () => {
  it('accClk 在 [0,1e6] 翻转 16 次；之后窗口不再新增（瞬态结束、capped=false）', () => {
    const design = solutionOf('s3-calc') as Design;
    const { flat } = flattenGateNetlist(design, library, GATE_SEQ_SPECS);
    expect(flat.netIdxByKey.get('accClk')).toBeDefined();
    const sim = new GateDelaySim(flat, {
      caliber: 'kind',
      semantics: 'inertial',
      maxEvents: 300_000,
    });
    sim.watch('accClk');
    sim.setInputs(zeroInputs(design));

    const w1 = sim.advance('window', 1_000_000);
    const e1 = sim.edgesOf('accClk').slice();
    const w2 = sim.advance('window', 9_000_000);
    const e2 = sim.edgesOf('accClk').length;
    const w3 = sim.advance('window', 90_000_000);
    const e3 = sim.edgesOf('accClk').length;
    console.log(
      `[gd50] s3-calc accClk：[0,1e6] 翻转 ${e1.length} 次（事件 ${w1.events} capped=${String(w1.capped)} 到 ${w1.timePs}ps，队列余 ${sim.queueSize()}）｜` +
        `[1e6,1e7] 新增 ${e2 - e1.length} 次（capped=${String(w2.capped)}）｜[1e7,1e8] 新增 ${e3 - e2} 次（capped=${String(w3.capped)}）`,
    );
    console.log(
      `[gd50] accClk 时刻表（前 18 个）：${e1
        .slice(0, 18)
        .map((e) => `${e.atPs}ps=${String(e.value)}`)
        .join(' ')}`,
    );
    expect(e1.length).toBe(16);
    expect(e2).toBe(e1.length);
    expect(e3).toBe(e1.length);
    expect(w1.capped).toBe(false);
    expect(w2.capped).toBe(false);
    expect(w3.capped).toBe(false);
  });

  it('跨窗口续跑：分两次 advance 与一次长窗口结果一致；state 传入不改变单次结果', () => {
    const design = solutionOf('s3-calc') as Design;
    const inputs = zeroInputs(design);
    const { flat } = flattenGateNetlist(design, library, GATE_SEQ_SPECS);

    // ① 一台仿真器分两次推 vs 一台仿真器一次推完：accClk 的跳变时刻表必须一样
    const opts = { caliber: 'kind', semantics: 'inertial', maxEvents: 300_000 } as const;
    const once = new GateDelaySim(flat, opts);
    once.watch('accClk');
    once.setInputs(inputs);
    const onceOut = once.advance('window', 10_000_000);
    const twice = new GateDelaySim(flat, opts);
    twice.watch('accClk');
    twice.setInputs(inputs);
    const firstOut = twice.advance('window', 1_000_000);
    const secondOut = twice.advance('window', 9_000_000);
    const key = (e: readonly { atPs: number; value: Bit }[]) =>
      e.map((x) => `${x.atPs}=${String(x.value)}`).join(' ');
    console.log(
      `[gd51] 一次长窗口：[0,1e7] 事件 ${onceOut.events} capped=${String(onceOut.capped)} 到 ${onceOut.timePs}ps｜` +
        `分两次：[0,1e6] 事件 ${firstOut.events} + [1e6,1e7] 事件 ${secondOut.events}，到 ${secondOut.timePs}ps`,
    );
    expect(key(twice.edgesOf('accClk'))).toBe(key(once.edgesOf('accClk')));
    expect(twice.queueSize()).toBe(once.queueSize());

    // ② 传不传 state（空 store）不影响单次结果：状态通道本身是"中性"的
    const whole = evalGateDelayed(design, library, inputs, {
      windowPs: 1_000_000,
      seqSpecs: GATE_SEQ_SPECS,
    });
    const withState = evalGateDelayed(design, library, inputs, {
      windowPs: 1_000_000,
      state: new GateStateStore(),
      seqSpecs: GATE_SEQ_SPECS,
    });
    console.log(
      `[gd51] 单次窗口：无 state 事件 ${whole.events} / 空 state 事件 ${withState.events}，timePs ${whole.timePs}/${withState.timePs}`,
    );
    expect(withState.events).toBe(whole.events);
    expect(withState.timePs).toBe(whole.timePs);
    expect(withState.capped).toBe(whole.capped);
    const diff = [...whole.outPorts].filter(
      ([port, bits]) =>
        String(bits.join('')) !== String((withState.outPorts.get(port) ?? []).join('')),
    );
    expect(diff).toEqual([]);
  });
});

/* ═════════════════════════ 5. 状态跨进程往返（postMessage 可克隆） ═════════════════════════ */

/** 一次连续跑完 vs 分两次（第一次导出状态 → 结构化克隆 → 导入后继续）*/
const splitRun = (
  design: Design,
  v1: ReadonlyMap<string, Bit[]>,
  v2: ReadonlyMap<string, Bit[]>,
  windowPs = 1_000_000,
) => {
  const { flat } = flattenGateNetlist(design, library, GATE_SEQ_SPECS);
  const opts = { maxEvents: 300_000 } as const;
  const whole = new GateDelaySim(flat, opts);
  whole.setInputs(v1);
  const w1 = whole.advance('window', windowPs);
  whole.setInputs(v2);
  const w2 = whole.advance('window', windowPs);

  const first = new GateDelaySim(flat, opts);
  first.setInputs(v1);
  const f1 = first.advance('window', windowPs);
  const data = exportGateDelayState(first.state);
  // postMessage 走的就是结构化克隆：先克隆一遍再导入（模拟真的过了线程边界）
  const second = new GateDelaySim(flat, {
    ...opts,
    state: importGateDelayState(structuredClone(data)),
  });
  second.setInputs(v2);
  const f2 = second.advance('window', windowPs);

  const wholeNets = whole.nets();
  const splitNets = second.nets();
  const diffNets: string[] = [];
  for (const [netId, v] of wholeNets) {
    const got = splitNets.get(netId);
    if (String(got) !== String(v) && diffNets.length < 6)
      diffNets.push(`${netId}: 一次=${String(v)}/两次=${String(got)}`);
  }
  const netDiffCount = [...wholeNets].filter(
    ([netId, v]) => String(splitNets.get(netId)) !== String(v),
  ).length;
  const portDiff = [...whole.outPorts()].filter(
    ([port, bits]) =>
      String(bits.join('')) !== String((second.outPorts().get(port) ?? []).join('')),
  ).length;
  return { whole, second, w1, w2, f1, f2, data, netDiffCount, portDiff, diffNets };
};

describe('gate-delay · 状态跨进程往返（postMessage 可克隆）', () => {
  it('export/import 的纯数据真能过结构化克隆；undefined → 干净 store；脏电平丢掉', () => {
    const store = new GateStateStore();
    store.set('mod6/mod2', 'q', 1, 0); // 复合键：实例路径本身带 '/'
    store.set('mod6/mod2', 'qn', 0, 0);
    store.setClock('mod6/mod2', 1);
    store.netsOf('').set('mod6/mod2/m', 1);
    store.netsOf('').set('ny', 0);
    store.netsOf('mod6/').set('m', 0);

    const data = exportGateDelayState(store, ['', 'mod6/']);
    console.log(
      `[gd60] 导出：values ${Object.keys(data.values).length} 项｜nets ${Object.entries(data.nets)
        .map(([p, t]) => `${p === '' ? '(顶层)' : p}=${Object.keys(t).length} 键`)
        .join(' ')}`,
    );
    // ① postMessage 的真实约束：结构化克隆（+ JSON 往返）都要过得去、且内容不变
    const cloned = structuredClone(data);
    expect(cloned).toEqual(data);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);

    // ② 装回来的 store 逐项相同（值 + 每个路径的内部 net 表）
    const back = importGateDelayState(cloned);
    expect(back.snapshot()).toEqual(data.values);
    expect(Object.fromEntries(back.netsOf(''))).toEqual(data.nets['']);
    expect(Object.fromEntries(back.netsOf('mod6/'))).toEqual(data.nets['mod6/']);
    expect(back.get('mod6/mod2', 'q')).toBe(1);
    expect(back.get('mod6/mod2', 'qn')).toBe(0);
    expect(back.getClock('mod6/mod2')).toBe(1);

    // ③ 画布第一帧：undefined → 一台干净 store（不抛、不是"半截状态"）
    const fresh = importGateDelayState(undefined);
    expect(fresh.snapshot()).toEqual({});
    expect(importGateDelayState(exportGateDelayState(new GateStateStore())).snapshot()).toEqual({});

    // ④ 跨进程数据在类型上不可信：合法电平归一（0/1 数字，字符串 '0'/'1' 也认），其余丢掉
    const dirty = importGateDelayState({
      values: { 'a/q#0': 1, 'a/qn#0': '1', 'a/q2#0': '嗯' } as unknown as Record<string, Bit>,
      nets: { '': { n1: '0', n2: 'x', n3: 'X' } as unknown as Record<string, Bit> },
    });
    expect(dirty.snapshot()).toEqual({ 'a/q#0': 1, 'a/qn#0': 1 });
    expect(Object.fromEntries(dirty.netsOf(''))).toEqual({ n1: 0, n3: 'X' });

    // ⑤ 默认只导延迟引擎自己那条路径（''）；要别的路径得点名传给第二个参数
    expect(Object.keys(exportGateDelayState(store).nets)).toEqual(['']);
  });

  it('s2-d-latch：同一串输入，一次连续跑完 vs 导出/导入分两次跑 —— 逐 net 逐端口一致', () => {
    const design = solutionOf('s2-d-latch') as Design;
    const level = logicLevels.find((l) => l.id === 's2-d-latch') as LogicLevel;
    const widths = portWidthsOf(level);
    const vectors = expandVectors(level.vectors, widths);
    const held1 = new Map<string, Bit[]>();
    const held2 = new Map<string, Bit[]>();
    applyHeld(held1, (vectors[0] as TestVector).inputs, widths);
    applyHeld(held2, (vectors[0] as TestVector).inputs, widths);
    applyHeld(held2, (vectors[1] as TestVector).inputs, widths);
    const { whole, second, w1, w2, f1, f2, data, netDiffCount, portDiff, diffNets } = splitRun(
      design,
      new Map(held1),
      new Map(held2),
    );
    const { flat } = flattenGateNetlist(design, library, GATE_SEQ_SPECS);
    const seqCells = flat.cells.filter((c) => c.kind === 'seq').length;
    console.log(
      `[gd61] s2-d-latch（${flat.cells.length} 单元，其中时序叶子 ${seqCells} 个）：一次 [0,1e6] 事件 ${w1.events}+${w2.events}｜` +
        `分两次 ${f1.events}+${f2.events}｜导出 state：values ${Object.keys(data.values).length} 项、内部网 ${Object.keys(data.nets[''] ?? {}).length} 条｜` +
        `逐 net 差异 ${netDiffCount}、逐端口差异 ${portDiff}｜窗口末端口 ${JSON.stringify(Object.fromEntries([...second.outPorts()].map(([p, b]) => [p, b.join('')])))}`,
    );
    if (netDiffCount > 0) console.log(`[gd61] 差异样例：${diffNets.join('；')}`);
    expect(netDiffCount).toBe(0);
    expect(portDiff).toBe(0);
    expect(String(second.netValue('q'))).toBe(String(whole.netValue('q')));
  });

  it('s2-dff（有时序叶子）：跨进程往返走 values 通道；每一对相邻向量都比一遍 —— 逐 net 一致', () => {
    const design = solutionOf('s2-dff') as Design;
    const level = logicLevels.find((l) => l.id === 's2-dff') as LogicLevel;
    const widths = portWidthsOf(level);
    const vectors = expandVectors(level.vectors, widths);
    const { flat } = flattenGateNetlist(design, library, GATE_SEQ_SPECS);
    const seqCells = flat.cells.filter((c) => c.kind === 'seq').length;
    const windowPs = vectors[0]?.settlePs ?? 1_000_000;
    const opts = { maxEvents: 300_000 } as const;

    const heldOf = (upto: number): Map<string, Bit[]> => {
      const held = new Map<string, Bit[]>();
      for (let i = 0; i <= upto; i++) applyHeld(held, (vectors[i] as TestVector).inputs, widths);
      return held;
    };

    let pairs = 0;
    let captures = 0;
    let valueKeys = 0;
    const lines: string[] = [];
    for (let i = 0; i + 1 < vectors.length; i++) {
      // ① 画布/Worker 的入口函数写法：两次 evalGateDelayed，中间只过一份结构化克隆的纯数据
      const first = evalGateDelayed(design, library, heldOf(i), {
        seqSpecs: GATE_SEQ_SPECS,
        windowPs,
      });
      const data = exportGateDelayState(first.state);
      valueKeys = Object.keys(data.values).length;
      const second = evalGateDelayed(design, library, heldOf(i + 1), {
        seqSpecs: GATE_SEQ_SPECS,
        windowPs,
        state: importGateDelayState(structuredClone(data)),
      });

      // ② 参照：一台 GateDelaySim 一口气推两个窗口
      const whole = new GateDelaySim(flat, opts);
      whole.setInputs(heldOf(i));
      whole.advance('window', windowPs);
      whole.setInputs(heldOf(i + 1));
      whole.advance('window', windowPs);

      const diff = [...whole.nets()].filter(
        ([netId, v]) => String(second.nets.get(netId)) !== String(v),
      );
      const wholeQ = String(whole.netValue('q'));
      const secondQ = String(second.nets.get('q')); // GateDelayRun 没有 netValue，按网名读
      pairs++;
      if (secondQ !== String(second.nets.get('qn'))) captures++; // q 与 qn 互补 = 真的存进了数
      lines.push(`#${i}→${i + 1} 逐 net 差异 ${diff.length}｜一次 q=${wholeQ}/两次 q=${secondQ}`);
      expect({ pair: i, diff: diff.map(([n]) => n) }).toEqual({ pair: i, diff: [] });
      expect(secondQ).toBe(wholeQ);
    }
    console.log(
      `[gd63] s2-dff（${flat.cells.length} 单元，其中时序叶子 ${seqCells} 个）：导出 state values ${valueKeys} 项（时序器件走这条通道）` +
        `｜${pairs} 对相邻向量逐对比对（其中 ${captures} 对 q/qn 互补 = 真的存进了数）｜逐 net 差异合计 0\n[gd63] ${lines.join('\n[gd63] ')}`,
    );
    expect(valueKeys).toBeGreaterThan(0); // 这次真的走了 values 通道
    expect(pairs).toBeGreaterThan(3);
    expect(captures).toBeGreaterThan(0); // 不是空转：确实有向量把数据存进了触发器
  });

  it('门搭反馈锁存器（与非门交叉耦合，无时序叶子）：状态只住在内部 net 里 —— 丢掉就会振', () => {
    const nandT = templateOf('与非门');
    const { ins, outs } = portNames(nandT);
    const y = outs[0] as string;
    const design: Design = {
      schemaVersion: 1,
      id: 'nand-sr',
      name: '与非门交叉耦合锁存器',
      instances: [
        { kind: 'module', id: 'G1', module: nandT.hash },
        { kind: 'module', id: 'G2', module: nandT.hash },
      ],
      nets: [
        {
          id: 'ns',
          pins: [{ inst: 'G1', pin: ins[0] as string, bit: 0 }],
        },
        {
          id: 'nr',
          pins: [{ inst: 'G2', pin: ins[0] as string, bit: 0 }],
        },
        {
          id: 'n1',
          pins: [
            { inst: 'G1', pin: y, bit: 0 },
            { inst: 'G2', pin: ins[1] as string, bit: 0 },
          ],
        },
        {
          id: 'n2',
          pins: [
            { inst: 'G2', pin: y, bit: 0 },
            { inst: 'G1', pin: ins[1] as string, bit: 0 },
          ],
        },
      ],
      ports: [
        { id: 'ps', name: 's', dir: 'in', width: 1, nets: ['ns'] },
        { id: 'pr', name: 'r', dir: 'in', width: 1, nets: ['nr'] },
        { id: 'p1', name: 'y1', dir: 'out', width: 1, nets: ['n1'] },
        { id: 'p2', name: 'y2', dir: 'out', width: 1, nets: ['n2'] },
      ],
    };
    const { flat } = flattenGateNetlist(design, library, GATE_SEQ_SPECS);
    expect(flat.cells.filter((c) => c.kind === 'seq').length).toBe(0); // 没有任何时序器件可存

    const set = new Map<string, Bit[]>([
      ['s', [0]],
      ['r', [1]],
    ]); // 置位
    const hold = new Map<string, Bit[]>([
      ['s', [1]],
      ['r', [1]],
    ]); // 保持（此时状态只在环里）
    const { whole, second, w1, w2, f1, f2, data, netDiffCount, portDiff, diffNets } = splitRun(
      design,
      set,
      hold,
    );
    console.log(
      `[gd62] 与非门锁存器：一次 [置位→保持] → y1=${String(whole.netValue('n1'))}/y2=${String(whole.netValue('n2'))}（事件 ${w1.events}+${w2.events}）｜` +
        `导出/导入分两次 → y1=${String(second.netValue('n1'))}/y2=${String(second.netValue('n2'))}（事件 ${f1.events}+${f2.events}）｜` +
        `导出 state：values ${Object.keys(data.values).length} 项（顺序器件 0 个 → 全是空的）、内部网 ${Object.keys(data.nets[''] ?? {}).length} 条` +
        `｜逐 net 差异 ${netDiffCount}、逐端口差异 ${portDiff}`,
    );
    if (netDiffCount > 0) console.log(`[gd62] 差异样例：${diffNets.join('；')}`);
    expect(netDiffCount).toBe(0);
    expect(portDiff).toBe(0);
    // 置位后的保持态：y1=1（Q）、y2=0
    expect(String(second.netValue('n1'))).toBe('1');
    expect(String(second.netValue('n2'))).toBe('0');
    // 只导出 values（= snapshot()）会丢掉环状态 → 新引擎从 0/0 起把 1,1 喂进交叉耦合的与非门 → 一直振
    const lostValuesOnly = new GateDelaySim(flat, { maxEvents: 500 });
    lostValuesOnly.setInputs(hold);
    const lost = lostValuesOnly.advance('window', 1_000_000);
    console.log(
      `[gd62] 对照组（只带 values、不带内部 net 表）：y1=${String(lostValuesOnly.netValue('n1'))}/y2=${String(lostValuesOnly.netValue('n2'))} ` +
        `capped=${String(lost.capped)} events=${lost.events} → ${lost.capped ? '一直在振（状态真的丢了）' : '没振'}`,
    );
    expect(lost.capped).toBe(true);
    // 而带全量状态那一侧是静止的
    expect(f2.quiescent).toBe(true);
  });
});
