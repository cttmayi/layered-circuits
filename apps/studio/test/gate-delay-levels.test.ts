// @vitest-environment node
/**
 * **有界延迟门级（新口径）逐关对照表 —— 期望值钉住**
 *
 * 背景（用户第 ⑲ 轮拍板走 A 路线）：门级引擎从"零延迟求值"换成"**有界延迟 + 惯性语义**"的
 * 事件驱动模型（`packages/sim-core/src/gate-delay.ts`，延迟 = 各门 rtl 身体电路的 criticalPathPs 实测值）。
 * 这份表把 20 个逻辑关的结论钉住，防止口径改动悄悄改掉通关结论：
 *
 *   · 每一关（有门版参考解的 19 关）都必须 **pass=true**、**错行=0**、**行数不变**；
 *   · 逐关与**元件级**（judgeDesign 不传 gateSeqSpecs）比对：18 关逐行 0 差异，
 *     `s3-calc` 66/67 行相同（只剩"待命"那一行的上电态不同，该行无期望值 → 两台上 pass=true）；
 *   · 口径可回退：零延迟档（`zeroDelay: true`）与历史结果完全一致（18 关 0 差异、s3-calc 仍是 29 行错）。
 *
 * ⚠️ 任何一关的 pass / 错行 / 行数在这里变了 → 这条测试必红，是**故意**的：口径改动不许悄悄改结论。
 */

import { expandVectors, judgeDesign, portWidthsOf, runGateVectors } from '@lc/compiler';
import {
  ALL_LEVELS,
  GATE_SEQ_SPECS,
  gateFastEnabledFor,
  teachingModulesFor,
  teachingSolutionOf,
} from '@lc/content';
import { type Design, DesignSchema, InMemoryModuleLibrary } from '@lc/schema';
import { evalGateVectorsDelayed } from '@lc/sim-core';
import { describe, expect, it } from 'vitest';

const LIB = new InMemoryModuleLibrary([...teachingModulesFor('rtl')]);
const LOGIC_LEVELS = ALL_LEVELS.filter((l) => (l as { judgeMode?: string }).judgeMode === 'logic');

/** 只比每行读数（actual），数字与字符串归一化 —— 与门级快路审计同口径 */
const normActual = (v: unknown): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries((v ?? {}) as Record<string, unknown>).map(([k, x]) => [k, String(x)]),
    ),
  );

/** 期望的错误行数（新口径）。全部为 0：这就是"没偷偷改结论"的定义。 */
const EXPECT_WRONG_ROWS: Readonly<Record<string, number>> = {
  's2-sr-latch': 0,
  's2-btn-latch': 0,
  's2-d-latch': 0,
  's2-dff': 0,
  's3-half-adder': 0,
  's3-full-adder': 0,
  's3-adder-4': 0,
  's3-adder-8': 0,
  's3-alu': 0,
  's3-bcd2bin': 0,
  's3-bin2bcd': 0,
  's3-display': 0,
  's3-seg-de': 0,
  's3-seg-fg': 0,
  's3-display2': 0,
  's3-reg-8': 0,
  's3-encoder': 0,
  's3-digit-entry': 0,
  's3-calc': 0,
};

/** 期望的行数（与关卡向量数一致，钉住"行数不变"） */
const EXPECT_ROWS: Readonly<Record<string, number>> = {
  's2-sr-latch': 4,
  's2-btn-latch': 5,
  's2-d-latch': 5,
  's2-dff': 7,
  's3-half-adder': 4,
  's3-full-adder': 8,
  's3-adder-4': 8,
  's3-adder-8': 8,
  's3-alu': 8,
  's3-bcd2bin': 8,
  's3-bin2bcd': 8,
  's3-display': 10,
  's3-seg-de': 10,
  's3-seg-fg': 10,
  's3-display2': 6,
  's3-reg-8': 7,
  's3-encoder': 11,
  's3-digit-entry': 11,
  's3-calc': 67,
};

/** 逐关与元件级逐行差异（新口径 = 有延迟 + 惯性）：只有 s3-calc 有 1 行差（待命行的上电态）*/
const EXPECT_DIFF_VS_ELEMENT: Readonly<Record<string, number>> = Object.fromEntries(
  Object.keys(EXPECT_WRONG_ROWS).map((id) => [id, id === 's3-calc' ? 1 : 0]),
);

describe('有界延迟门级 · 20 个逻辑关的结论表（钉住，不许悄悄变）', () => {
  it('逐关：pass=true / 错行=0 / 行数不变 / 得分=100（走判定的实际口径）', () => {
    const lines: string[] = [];
    for (const level of LOGIC_LEVELS) {
      const design = teachingSolutionOf(level.id, 'rtl');
      if (!design) {
        lines.push(
          `${level.id.padEnd(15)} 无门版参考解（skip）白名单=${gateFastEnabledFor(level.id)}`,
        );
        continue;
      }
      const d = DesignSchema.parse(design) as Design;
      const r = judgeDesign(d, level, {
        library: LIB,
        mode: 'logic',
        ...(gateFastEnabledFor(level.id) ? { gateSeqSpecs: GATE_SEQ_SPECS } : {}),
      });
      const wrong = r.rows.filter((x) => x.ok === false).length;
      lines.push(
        `${level.id.padEnd(15)} 白名单=${gateFastEnabledFor(level.id) ? 'ON ' : 'off'} pass=${r.pass} 行数=${r.rows.length}/${EXPECT_ROWS[level.id]} 错行=${wrong} 得分=${r.score}`,
      );
      expect(r.pass, `${level.id} 的 pass 不该变`).toBe(true);
      expect(wrong, `${level.id} 的错行数`).toBe(EXPECT_WRONG_ROWS[level.id]);
      expect(r.rows.length, `${level.id} 的行数`).toBe(EXPECT_ROWS[level.id]);
      expect(r.score, `${level.id} 的得分`).toBe(100);
    }
    console.log(`\n${lines.join('\n')}\n`);
  }, 900_000);

  it('逐关：门级（有延迟）与元件级逐行数值差异 = 钉住值（18 关 0，s3-calc 1）', () => {
    const lines: string[] = [];
    for (const level of LOGIC_LEVELS) {
      const design = teachingSolutionOf(level.id, 'rtl');
      if (!design) continue;
      const d = DesignSchema.parse(design) as Design;
      const vectors = expandVectors(level.vectors, portWidthsOf(level));
      const gate = runGateVectors(d, LIB, vectors, portWidthsOf(level), GATE_SEQ_SPECS);
      expect(gate, `${level.id} 门级应当能跑`.replace('应当能跑', '必须能跑')).not.toBeNull();
      const el = judgeDesign(d, level, { library: LIB, mode: 'logic' });
      const diffs: number[] = [];
      for (let i = 0; i < el.rows.length; i++) {
        if (normActual(el.rows[i]?.actual) !== normActual(gate?.rows[i]?.actual)) diffs.push(i);
      }
      lines.push(
        `${level.id.padEnd(15)} 门级 pass=${gate?.pass} 元件 pass=${el.pass} 差异=${diffs.length}/${el.rows.length} 差异行=[${diffs.join(',')}]`,
      );
      expect(diffs.length, `${level.id} 与元件级的逐行差异数`).toBe(
        EXPECT_DIFF_VS_ELEMENT[level.id],
      );
      expect(gate?.pass, `${level.id} 门级 pass`).toBe(el.pass);
    }
    console.log(`\n${lines.join('\n')}\n`);
  }, 900_000);

  it('回退开关：零延迟档与历史口径一致（s3-calc 仍是 29 行错，证明"零延迟才是短板"）', () => {
    const lines: string[] = [];
    for (const level of LOGIC_LEVELS) {
      const design = teachingSolutionOf(level.id, 'rtl');
      if (!design) continue;
      const d = DesignSchema.parse(design) as Design;
      const widths = portWidthsOf(level);
      const vectors = expandVectors(level.vectors, widths);
      const zero = evalGateVectorsDelayed(d, LIB, vectors, widths, GATE_SEQ_SPECS, {
        zeroDelay: true,
      });
      const delayed = evalGateVectorsDelayed(d, LIB, vectors, widths, GATE_SEQ_SPECS);
      const zeroWrong = zero?.rows.filter((r) => !r.ok).length ?? -1;
      const delayedWrong = delayed?.rows.filter((r) => !r.ok).length ?? -1;
      lines.push(
        `${level.id.padEnd(15)} 零延迟档 pass=${zero?.pass} 错行=${zeroWrong}/${zero?.rows.length} ｜ 有延迟档 pass=${delayed?.pass} 错行=${delayedWrong}`,
      );
      // 🔒 有延迟档一律不劣于零延迟档（这条就是这次口径改动的目的）
      expect(delayedWrong, `${level.id} 有延迟档的错行数不该多于零延迟档`).toBeLessThanOrEqual(
        zeroWrong,
      );
      if (level.id === 's3-calc') {
        expect(zeroWrong, 's3-calc 在零延迟档下仍是 29 行错（历史事实）').toBe(29);
        expect(delayedWrong, 's3-calc 在有延迟档下 0 行错').toBe(0);
      }
    }
    console.log(`\n${lines.join('\n')}\n`);
  }, 900_000);

  it('s3-calc 的残留差异只在那一条没有期望值的「待命」行', () => {
    const calcLevel = LOGIC_LEVELS.find((l) => l.id === 's3-calc')!;
    const design = teachingSolutionOf('s3-calc', 'rtl');
    const d = DesignSchema.parse(design) as Design;
    const widths = portWidthsOf(calcLevel);
    const gate = evalGateVectorsDelayed(
      d,
      LIB,
      expandVectors(calcLevel.vectors, widths),
      widths,
      GATE_SEQ_SPECS,
    );
    const el = judgeDesign(d, calcLevel, { library: LIB, mode: 'logic' });
    const diffRows: number[] = [];
    for (let i = 0; i < (el?.rows.length ?? 0); i++) {
      if (normActual(el?.rows[i]?.actual) !== normActual(gate?.rows[i]?.actual)) diffRows.push(i);
    }
    expect(diffRows).toEqual([0]);
    // 该行没有期望值 → 门级与元件级都判它 ok
    expect(gate?.rows[0]?.ok).toBe(true);
    expect(el?.rows[0]?.ok).toBe(true);
    expect(Object.keys(el?.rows[0]?.expected ?? {}).length).toBe(0);
  }, 900_000);
});
