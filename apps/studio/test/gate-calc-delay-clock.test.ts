import { compileDesign, expandVectors, judgeDesign, portWidthsOf } from '@lc/compiler';
import { ALL_LEVELS, GATE_SEQ_SPECS, teachingModulesFor, teachingSolutionOf } from '@lc/content';
import { familySpecOf, InMemoryModuleLibrary } from '@lc/schema';
import { evalGateVectorsDelayed, logicValueOf, Simulator } from '@lc/sim-core';
import { describe, expect, it } from 'vitest';

/**
 * **为什么 s3-calc 吃不到门级快路** —— 把实测诊断钉成可执行凭据（并纠正一版被仪器假象误导的旧说法）。
 *
 * ⚠️ 命名纠正（第 ㉓ 轮实测）：本关的时钟**不是环形振荡器**，而是【运算控制】内部一条
 * **建立时间用的延迟链**（`clk1 = op∨eq∨c` 只由按钮输入驱动、**没有反馈回路**，顶层组合环 0 条）。
 * 实测：`accClk` 只在**上电瞬态**里跳（有延迟门级 [0,1µs] 16 次），之后 9µs/90µs/900µs 三个窗口
 * **新增 0 次**；30 秒墙钟跑 2000 次（每次 1µs 窗口）**capped=0**、单次 5.87ms。
 *
 * 实测事实（本文件就是把它们跑出来）：
 *  1. 这一关的时钟**不是外部时钟口**：它是【运算控制】内部一条**建立时间用的延迟链**
 *     （10 级反相链把 `clk1=op∨eq∨c` 推后 ≈15ns，**无反馈、不是振荡器**）。元件级**时序**口径下
 *     量到 `accClk` 在**上电瞬态**里跳变 12 次（500ps 一跳：1→0→1→0…）后安静，按 C 清屏时再加
 *     一个沿（112400ps=1）。八位寄存器正是靠这些**沿**把数据搬进去的。
 *  2. 门级引擎是**零延迟**求值：同一条环路代数上会**收敛到静态电平**
 *     （实测每个向量都 `unstable=false`，`accClk` 稳定在 0 或 1），"振荡"整个消失 ——
 *     寄存器要么一直保持旧值（clk 停在 1）、要么一直透明（clk 停在 0），两者都不是设计意图。
 *     这就是门级 67 行里 **29 行**读到旧值/错值的原因。
 *  3. 顺带澄清一个曾经的误判：**"网是 1 而引脚读到 0"并不存在**。
 *     在真设计上逐轮逐脚核对不变量（`readBit(pin) === 该脚所在 net 的值`）得到
 *     **0 处真不一致**（唯一的"不一致"是 net 尚未赋值 'Z'、按约定读 0）。
 *     跨模块边界的传播也正确，见 `packages/sim-core/test/gate-net-boundary.test.ts`。
 *
 * 这条测试不是"骂引擎"，而是把"这一关依赖延迟构成的时钟"固定下来：
 *  · 哪天给门级加了**有界延迟 / 事件驱动**推进（让延迟链真的产生振荡），
 *    本用例第二条断言会**失败** —— 那正是回去改 docs/design-gates.md 第 10 节、
 *    并考虑放行白名单的信号；
 *  · 在那之前，任何想把它塞进白名单的改动都会被
 *    `gate-fast-calc-guard.test.ts` 与 `gate-fast-whitelist-precondition.test.ts` 拦住。
 */
describe('s3-calc：时钟来自延迟链（建立时间，不是环振）—— 零延迟把建立时间抹掉，有延迟口径修好', () => {
  const id = 's3-calc';
  const level = ALL_LEVELS.find((l) => l.id === id);
  if (!level) throw new Error(`找不到关卡 ${id}`);
  const design = teachingSolutionOf(id, 'rtl');
  if (!design) throw new Error(`${id} 没有门版参考解`);

  /** 读出 accClk 这条 net 上"逻辑值发生跳变"的时刻（去重：只记逻辑值真的变了的那次）*/
  const edgesOf = (
    sim: Simulator,
    node: number,
    sincePs: number,
  ): { atPs: number; v: number }[] => {
    const times = sim.trace?.times ?? [];
    const nodes = sim.trace?.nodes ?? [];
    const signals = sim.trace?.signals ?? [];
    const out: { atPs: number; v: number }[] = [];
    let last: number | undefined;
    for (let k = 0; k < times.length; k++) {
      if ((nodes[k] as number) !== node) continue;
      const at = times[k] as number;
      if (at <= sincePs) continue;
      const v = logicValueOf(signals[k] as number) as number;
      if (last !== undefined && v === last) continue;
      out.push({ atPs: at, v });
      last = v;
    }
    return out;
  };

  it('元件级时序口径：accClk 是延迟链振荡出来的脉冲串（寄存器靠它的沿工作）', () => {
    const library = new InMemoryModuleLibrary([...teachingModulesFor('rtl')]);
    const { net, netIds } = compileDesign(design as never, { library });
    const node = netIds.indexOf('accClk');
    expect(node).toBeGreaterThanOrEqual(0); // 这条 net 真实存在
    const sim = new Simulator(net, { mode: 'timing', trace: true });
    sim.reset();
    for (const p of net.ports) if (p.dir === 'in') sim.setInput(String(p.id ?? p.name), 0);
    sim.runFor(1_000_000); // 上电：跑到电路安静下来
    const powerUpEdges = edgesOf(sim, node, 0);
    console.log(
      `  上电 accClk 跳变 ${powerUpEdges.length} 次：${powerUpEdges.map((e) => `${e.atPs}ps=${e.v}`).join(' ')}`,
    );
    expect(powerUpEdges.length).toBeGreaterThan(6); // "像振荡器"的最低要求
    expect(new Set(powerUpEdges.map((e) => e.v)).size).toBe(2); // 真的在 0/1 之间跳

    // 按一次键（清屏 C）：振荡器再振一阵 —— 累加器就是靠这些沿被写入的
    const sincePs = sim.time;
    sim.setInput('c', 1);
    sim.runFor(1_000_000);
    const pressEdges = edgesOf(sim, node, sincePs);
    console.log(
      `  按 C 之后新增 accClk 跳变 ${pressEdges.length} 次：${pressEdges.map((e) => `${e.atPs}ps=${e.v}`).join(' ')}`,
    );
    expect(pressEdges.length).toBeGreaterThan(0);
  }, 600_000);

  it('门级**新口径（有界延迟 + 惯性）**：同一份设计上 accClk 出现真实的"沿"→ 67 行里 0 行读旧值', () => {
    const spec = familySpecOf(level, 'rtl');
    const r = judgeDesign(design as never, level, {
      library: new InMemoryModuleLibrary([...teachingModulesFor('rtl')]),
      mode: 'logic',
      family: spec.family,
      units: spec.units,
      timingBudgetPs: spec.timingBudgetPs,
      optimalHalf: spec.optimalHalf,
      budgetHalf: spec.budgetHalf,
      gateSeqSpecs: GATE_SEQ_SPECS,
    }) as unknown as { pass?: boolean; rows?: { ok: boolean }[] };
    const rows = r.rows ?? [];
    const bad = rows.filter((x) => !x.ok).length;
    console.log(`  门级（有延迟）：pass=${String(r.pass)} 不通过 ${bad}/${rows.length} 行`);
    expect(r.pass).toBe(true);
    expect(bad).toBe(0);
  }, 600_000);

  it('门级**零延迟回退档**：历史事实可复现 —— 同一份设计 29/67 行不对（这就是这次口径改动的理由）', () => {
    const widths = portWidthsOf(level);
    const zero = evalGateVectorsDelayed(
      design as never,
      new InMemoryModuleLibrary([...teachingModulesFor('rtl')]),
      expandVectors(level.vectors, widths),
      widths,
      GATE_SEQ_SPECS,
      { zeroDelay: true },
    );
    const bad = zero?.rows.filter((x) => !x.ok).length ?? -1;
    console.log(
      `  门级（零延迟档）：pass=${String(zero?.pass)} 不通过 ${bad}/${zero?.rows.length ?? 0} 行`,
    );
    expect(zero?.pass).toBe(false);
    expect(bad).toBe(29);
  }, 600_000);
});
