// @vitest-environment jsdom
/**
 * 逻辑关的电平文字不显示驱动强度（用户第 ⑭ 轮）：
 * 第 8 关起判定是零延迟布尔口径，「1·强 / 1·弱」是噪音 → 只显示 `1` / `0`。
 *
 * 作用域（**不能**写成 `simMode === 'logic'` —— 自由模式恒按逻辑口径仿真，但它允许用元件）：
 *   · 逻辑关（关卡声明 `judgeMode === 'logic'`）→ 去掉强度后缀；
 *   · 时序关（1~7 关）→ 一个字不许改（强/弱是教学点），本文件有反证；
 *   · 自由模式 → 保持原样（那里有电源与端口、上拉/下拉电阻，强度是真实信息）。
 *
 * 覆盖的渲染点（改动前实测清单的每一项）：
 *   ① 画布引脚/节点标签（render.ts 的 signalText → `1·强`）
 *   ② 画布图例（App.tsx 的「■ 强 1 / ■ 弱 1 / ■ 强 0 / ■ 弱 0」）
 *   ③ 模块详情里的自测真值表（sim/probe.ts 的 textOf → `1·强`）
 * 悬空（Z）/ 冲突（X）不是强度描述 → 三种模式一律照旧保留。
 */

import { judgeDesign } from '@lc/compiler';
import { ALL_LEVELS, GATE_SEQ_SPECS, gateFastEnabledFor, teachingModulesFor } from '@lc/content';
import type { ModuleTemplate } from '@lc/schema';
import { DesignSchema, FAMILY_CONTRACTS, InMemoryModuleLibrary } from '@lc/schema';
import { S_STRONG, S_WEAK, SIG_Z } from '@lc/sim-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { signalText } from '../src/editor/render';
import { ModuleDetailModal } from '../src/panels/ModuleDetailModal';
import { probeModule } from '../src/sim/probe';
import { dismissTaskDialog, enableDebugUrl, startJob } from './helpers';

// ---------------------------------------------------------------------------
// 画布文字采集：jsdom 不做真实排版，`getContext('2d')` 返回 null（App 会直接 return），
// 所以这里塞一个记录型 ctx，把每次 fillText 的字符串收下来 —— 这是"画布上到底写了什么"
// 唯一可靠的观察口（真排版引擎下的同一份证据由 CDP 给出）。
// ---------------------------------------------------------------------------
const drawnTexts: string[] = [];
let realGetContext: HTMLCanvasElement['getContext'] | null = null;
let realGetRect: typeof Element.prototype.getBoundingClientRect | null = null;

function stubCanvas(): void {
  if (!realGetContext) {
    realGetContext = HTMLCanvasElement.prototype.getContext;
    const noop = (): void => {};
    HTMLCanvasElement.prototype.getContext = (() =>
      new Proxy(
        { fillText: (t: unknown) => void drawnTexts.push(String(t)) },
        {
          get: (target: Record<string, unknown>, prop: string) =>
            prop in target ? target[prop] : noop,
        },
      )) as unknown as HTMLCanvasElement['getContext'];
  }
  if (!realGetRect) {
    realGetRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
      const isCanvas = this.classList?.contains('canvas-wrap');
      const w = isCanvas ? 900 : 0;
      const h = isCanvas ? 600 : 0;
      return {
        x: 0,
        y: 0,
        width: w,
        height: h,
        top: 0,
        left: 0,
        right: w,
        bottom: h,
        toJSON: () => ({}),
      } as DOMRect;
    };
  }
}

afterEach(() => {
  if (realGetContext) HTMLCanvasElement.prototype.getContext = realGetContext;
  if (realGetRect) Element.prototype.getBoundingClientRect = realGetRect;
  realGetContext = null;
  realGetRect = null;
  drawnTexts.length = 0;
});

/** 把关卡之前的所有关标成已通关（cleared 必须是对象） */
function seedUpTo(title: string): void {
  const idx = ALL_LEVELS.findIndex((l) => l.title === title);
  const cleared: Record<string, { score: number; bestCostHalf: number; clearedAt: number }> = {};
  for (const l of ALL_LEVELS.slice(0, idx)) {
    cleared[l.id] = { score: 100, bestCostHalf: 0, clearedAt: 1 };
  }
  localStorage.setItem(
    'lc-studio-progress-v1',
    JSON.stringify({
      family: 'rtl',
      cleared,
      library: [],
      attempts: {},
      walletHalf: 0,
      recon: {},
      sideJobs: {},
      spentHalf: 0,
      started: {},
    }),
  );
}

/** 点「一键出答案」并等仿真快照（图例出现）= 画布上真的有电平可画 */
async function solveAndWait(): Promise<void> {
  fireEvent.click(screen.getByText('一键出答案'));
  await waitFor(() => expect(document.querySelector('.legend')).toBeTruthy(), { timeout: 8000 });
  await waitFor(() => expect(drawnTexts.length).toBeGreaterThan(0), { timeout: 8000 });
}

function legendTexts(): string[] {
  return [...document.querySelectorAll('.legend span')].map((s) => (s.textContent || '').trim());
}

const STRENGTH = /·强|·弱/;

describe('逻辑关电平文字：只显示 1 / 0（用户第 ⑭ 轮）', () => {
  beforeEach(() => {
    localStorage.clear();
    drawnTexts.length = 0;
    stubCanvas();
    enableDebugUrl();
  });

  it('① 逻辑关（第 11 关「主从 D 触发器」）画布上不再画 ·强/·弱，只画 1 / 0', async () => {
    seedUpTo('主从 D 触发器');
    render(<App />);
    startJob('主从 D 触发器');
    dismissTaskDialog();
    await solveAndWait();
    console.log(`[logic] 画布文字=${JSON.stringify([...new Set(drawnTexts)])}`);
    const withStrength = drawnTexts.filter((t) => STRENGTH.test(t));
    expect(withStrength, `逻辑关画布不该出现强度后缀：${JSON.stringify(withStrength)}`).toEqual([]);
    // 反证：电平本身照画（否则"没有后缀"可能只是"什么都没画"）
    expect(drawnTexts).toContain('1');
    expect(drawnTexts).toContain('0');
    // 悬空 / 冲突不是强度描述 → 去后缀后照旧（见下面 ⑧ 的 signalText 单元断言）
  }, 60000);

  it('② 逻辑关图例只剩「■ 1 / ■ 0」，X 与悬空照旧', async () => {
    seedUpTo('主从 D 触发器');
    render(<App />);
    startJob('主从 D 触发器');
    dismissTaskDialog();
    await solveAndWait();
    const legend = legendTexts();
    console.log(`[logic] 图例=${JSON.stringify(legend)}`);
    expect(legend).toEqual(['■ 1', '■ 0', '┅ X', '┅ 悬空']);
  }, 60000);

  it('③ 反证：时序关（第 6 关「与非门」）的画布与图例一个字都没改', async () => {
    seedUpTo('与非门');
    render(<App />);
    startJob('与非门');
    dismissTaskDialog();
    await solveAndWait();
    const legend = legendTexts();
    const texts = [...new Set(drawnTexts)];
    console.log(`[timing] 图例=${JSON.stringify(legend)}｜画布文字=${JSON.stringify(texts)}`);
    expect(legend).toEqual(['■ 强 1', '■ 弱 1', '■ 强 0', '■ 弱 0', '┅ X', '┅ 悬空']);
    expect(
      texts.some((t) => STRENGTH.test(t)),
      `时序关必须照旧标强/弱：${JSON.stringify(texts)}`,
    ).toBe(true);
  }, 60000);

  it('④ 反证：自由模式（载入非门示例，含元件）图例与画布照旧带强/弱', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('自由搭建'));
    fireEvent.click(screen.getByText('载入非门示例'));
    await waitFor(() => expect(document.querySelector('.legend')).toBeTruthy(), { timeout: 8000 });
    await waitFor(() => expect(drawnTexts.length).toBeGreaterThan(0), { timeout: 8000 });
    const legend = legendTexts();
    const texts = [...new Set(drawnTexts)];
    console.log(`[free] 图例=${JSON.stringify(legend)}｜画布文字=${JSON.stringify(texts)}`);
    expect(legend).toEqual(['■ 强 1', '■ 弱 1', '■ 强 0', '■ 弱 0', '┅ X', '┅ 悬空']);
    expect(
      texts.some((t) => STRENGTH.test(t)),
      `自由模式必须照旧标强/弱：${JSON.stringify(texts)}`,
    ).toBe(true);
  }, 60000);

  it('⑤ 模块自测真值表：同一口径（逻辑关 1 / 时序关 1·强）', () => {
    const tpl = teachingModulesFor('rtl').find((t) => t.name === '非门');
    if (!tpl) throw new Error('教学族里没有非门');
    const lib = teachingModulesFor('rtl').map((t) => ({
      hash: t.hash,
      name: t.name,
      version: t.version,
      stage: t.stage,
      costHalf: t.costHalf,
      isSequential: t.isSequential,
      ports: t.ports,
      template: t,
      sources: [],
      createdAt: 0,
    }));
    const logic = probeModule(tpl as unknown as ModuleTemplate, lib as never, {
      showStrength: false,
    });
    const timing = probeModule(tpl as unknown as ModuleTemplate, lib as never);
    const logicTexts = logic.rows.flatMap((r) => Object.values(r.outputs));
    const timingTexts = timing.rows.flatMap((r) => Object.values(r.outputs));
    console.log(
      `[probe] 逻辑关=${JSON.stringify(logicTexts)}｜时序关=${JSON.stringify(timingTexts)}`,
    );
    expect(logicTexts.length).toBeGreaterThan(0);
    expect(logicTexts.some((t) => STRENGTH.test(t))).toBe(false);
    expect(
      logicTexts.every((t) => t === '0' || t === '1' || t.includes('Z') || t.includes('X')),
    ).toBe(true);
    // 反证：默认（时序关/自由模式）仍然带强度后缀
    expect(timingTexts.some((t) => STRENGTH.test(t))).toBe(true);
  }, 30000);

  it('⑥ 模块详情用同一个口径渲染（表格里是 1，不是 1·强）', () => {
    const tpl = teachingModulesFor('rtl').find((t) => t.name === '非门');
    if (!tpl) throw new Error('教学族里没有非门');
    const stored = {
      hash: tpl.hash,
      name: tpl.name,
      version: tpl.version,
      stage: tpl.stage,
      costHalf: tpl.costHalf,
      isSequential: tpl.isSequential,
      ports: tpl.ports,
      template: tpl,
      sources: [],
      createdAt: 0,
    };
    const { unmount } = render(
      <ModuleDetailModal
        module={stored as never}
        library={[stored as never]}
        showStrength={false}
        onClose={() => {}}
      />,
    );
    const tableLogic = document.querySelector('.probe')?.textContent ?? '';
    console.log(
      `[modal] 逻辑关自测表=${JSON.stringify(tableLogic.replace(/\s+/g, ' ').slice(0, 120))}`,
    );
    expect(tableLogic).not.toMatch(STRENGTH);
    unmount();
    render(
      <ModuleDetailModal module={stored as never} library={[stored as never]} onClose={() => {}} />,
    );
    const tableTiming = document.querySelector('.probe')?.textContent ?? '';
    console.log(
      `[modal] 时序关自测表=${JSON.stringify(tableTiming.replace(/\s+/g, ' ').slice(0, 120))}`,
    );
    expect(tableTiming).toMatch(STRENGTH);
  }, 30000);

  it('⑧ signalText：去后缀只影响强/弱，Z / X / 未定义照旧', () => {
    const strong1 = (S_STRONG << 2) | 1;
    const weak1 = (S_WEAK << 2) | 1;
    const strong0 = (S_STRONG << 2) | 0;
    const x = (S_STRONG << 2) | 2;
    // 带强度（时序关/自由模式）
    expect(signalText(strong1)).toBe('1·强');
    expect(signalText(weak1)).toBe('1·弱');
    expect(signalText(strong0)).toBe('0·强');
    // 不带强度（逻辑关）
    expect(signalText(strong1, false)).toBe('1');
    expect(signalText(weak1, false)).toBe('1');
    expect(signalText(strong0, false)).toBe('0');
    // 悬空 / 未定义：两边完全一致（它们本来就不带强度后缀）
    expect(signalText(SIG_Z, false)).toBe('Z');
    expect(signalText(SIG_Z, true)).toBe('Z');
    expect(signalText(undefined, false)).toBe('—');
    expect(signalText(undefined, true)).toBe('—');
    // 冲突 X：逻辑关去后缀 → 'X'；时序关/自由模式沿用**改动前**的老行为（X 也带后缀），
    // 这里刻意把老行为钉住 —— 时序关与自由模式要"一个字不许改"。
    expect(signalText(x, false)).toBe('X');
    expect(signalText(x, true)).toBe('X·强');
  });

  it('⑨ 判定结果口径一致：逻辑关的判定消息里不会出现强/弱字样（画布与判定表同一口径）', () => {
    // 画布去掉强度后缀之后，判定侧也不能再冒出「应为强 1，实际是弱 1」这类字样 —— 否则
    // 玩家会看到"画布显示 1、判定表显示强 1"的不一致。
    // 判定里的强度审计（judge.ts）只在 **元件级** 且 **契约要求推挽输出** 时才跑：
    //   if (!fast && contract.output === 'strong')
    // 逻辑关（第 8 关起）走门级快路（fast 非 null）或元件回落，但契约都是 rtl（output = weak）
    // → 两个条件都不成立。这里逐关用参考解真跑一遍判定，把结论钉住。
    const rows: string[] = [];
    const offenders: string[] = [];
    for (const level of ALL_LEVELS) {
      if (level.judgeMode !== 'logic') continue;
      const ref = level.referenceSolution;
      if (!ref) continue;
      const design = DesignSchema.parse({ ...(ref as object) });
      const result = judgeDesign(design as never, level as never, {
        library: new InMemoryModuleLibrary([]),
        mode: 'logic',
        family: 'rtl',
        ...(gateFastEnabledFor(level.id) ? { gateSeqSpecs: GATE_SEQ_SPECS } : {}),
      });
      const wording = result.errors.filter((e) => /强|弱/.test(e));
      rows.push(`${level.id}:${result.errors.length} 条消息`);
      for (const w of wording) offenders.push(`${level.id}｜${w}`);
    }
    console.log(`[judge] 逻辑关逐关判定消息：${rows.join(' ')}`);
    console.log(
      `[judge] 含强/弱字样的消息：${offenders.length === 0 ? '（无）' : offenders.join(' / ')}`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
    // 反证：契约表本身仍然区分强度（时序关/自由模式该有的信息没被删掉）
    expect(FAMILY_CONTRACTS.rtl.output).not.toBe('strong');
    expect(FAMILY_CONTRACTS.cmos.output).toBe('strong');
  });

  it('⑦ 关卡数据核对：第 8 关起确实是 logic 口径，1~7 关是 timing（作用域的根据）', () => {
    const rows = ALL_LEVELS.map((l) => `${l.id}:${l.judgeMode}`);
    console.log(`[levels] ${rows.join(' ')}`);
    const logic = ALL_LEVELS.filter((l) => l.judgeMode === 'logic');
    const timing = ALL_LEVELS.filter((l) => l.judgeMode !== 'logic');
    expect(logic.length).toBeGreaterThan(0);
    expect(timing.length).toBeGreaterThan(0);
    // 逻辑关全部在第 8 关（索引 7）之后；1~7 关一个都不是 logic
    const firstLogicIdx = ALL_LEVELS.findIndex((l) => l.judgeMode === 'logic');
    expect(firstLogicIdx).toBeGreaterThanOrEqual(7);
    for (const l of ALL_LEVELS.slice(0, firstLogicIdx)) expect(l.judgeMode).not.toBe('logic');
  });
});
