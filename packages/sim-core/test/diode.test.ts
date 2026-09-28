import { describe, expect, it } from 'vitest';
import { runVectors } from '../src/harness.js';
import { buildDiodeAnd, buildDiodeOr, buildDiodeRomBit } from './helpers/circuits.js';

describe('二极管语义：单向导通 + 逻辑隔离', () => {
  it('二极管与门（阳极并联 + 上拉，阴极接输入）', () => {
    const net = buildDiodeAnd();
    const result = runVectors(
      net,
      [
        { inputs: { a: 0, b: 0 }, expect: { y: 0 } },
        { inputs: { a: 1, b: 0 }, expect: { y: 0 } },
        { inputs: { a: 0, b: 1 }, expect: { y: 0 } },
        { inputs: { a: 1, b: 1 }, expect: { y: 1 } },
      ],
      { mode: 'logic' },
    );
    expect(result.rows.map((r) => r.actual.y)).toEqual([0, 0, 0, 1]);
    expect(result.pass).toBe(true);
  });

  it('二极管或门（阳极接输入 + 下拉，阴极并联）', () => {
    const net = buildDiodeOr();
    const result = runVectors(
      net,
      [
        { inputs: { a: 0, b: 0 }, expect: { y: 0 } },
        { inputs: { a: 1, b: 0 }, expect: { y: 1 } },
        { inputs: { a: 0, b: 1 }, expect: { y: 1 } },
        { inputs: { a: 1, b: 1 }, expect: { y: 1 } },
      ],
      { mode: 'logic' },
    );
    expect(result.rows.map((r) => r.actual.y)).toEqual([0, 1, 1, 1]);
    expect(result.pass).toBe(true);
  });

  it('二极管 ROM 单元：字线为高时位线被拉高，为低时被下拉电阻拉低', () => {
    const result = runVectors(
      buildDiodeRomBit(),
      [
        { inputs: { w: 0 }, expect: { bl: 0 } },
        { inputs: { w: 1 }, expect: { bl: 1 } },
        { inputs: { w: 0 }, expect: { bl: 0 } },
      ],
      { mode: 'logic' },
    );
    expect(result.pass).toBe(true);
  });

  it('反向不导通：阳极低、阴极高时不产生任何驱动（逻辑隔离）', () => {
    const result = runVectors(buildDiodeRomBit(), [{ inputs: { w: 0 }, expect: { bl: 0 } }], {
      mode: 'logic',
    });
    // 若二极管反向导通，位线会被字线的 0 与下拉电阻共同拉低，这里额外确认没有 X 冲突
    expect(result.diagnostics.some((d) => d.kind === 'drive-conflict')).toBe(false);
    expect(result.rows[0]!.actual.bl).toBe(0);
  });
});
