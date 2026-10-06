import { describe, expect, it } from 'vitest';
import {
  andBit,
  B0,
  B1,
  type Bit,
  BX,
  BZ,
  evalGate,
  GATE_NAMES,
  isGateName,
  mergeDrivers,
  notBit,
  orBit,
  xorBit,
} from '../src/gate-logic';

/**
 * 逻辑版门级核心的契约：**没有强/弱**，7 个门是原子。
 */
describe('门级求值：4 值逻辑（0/1/X/Z），没有强弱', () => {
  const V: Bit[] = [0, 1, 'X', 'Z'];

  it('非门', () => {
    expect(notBit(B0)).toBe(1);
    expect(notBit(B1)).toBe(0);
    expect(notBit(BX)).toBe('X');
    expect(notBit(BZ)).toBe('X'); // 悬空输入 → 不确定
  });

  it('与门：Kleene —— 有 0 就是 0（另一个输入是 X 也不影响）', () => {
    expect(andBit(0, 0)).toBe(0);
    expect(andBit(0, 1)).toBe(0);
    expect(andBit(1, 1)).toBe(1);
    expect(andBit(0, 'X')).toBe(0);
    expect(andBit(1, 'X')).toBe('X');
    expect(andBit('X', 'Z')).toBe('X');
  });

  it('或门：Kleene —— 有 1 就是 1', () => {
    expect(orBit(0, 0)).toBe(0);
    expect(orBit(1, 0)).toBe(1);
    expect(orBit(1, 'X')).toBe(1);
    expect(orBit(0, 'X')).toBe('X');
    expect(orBit('Z', 'Z')).toBe('X');
  });

  it('异或门：任一输入不确定 → 不确定', () => {
    expect(xorBit(0, 0)).toBe(0);
    expect(xorBit(0, 1)).toBe(1);
    expect(xorBit(1, 1)).toBe(0);
    expect(xorBit('X', 1)).toBe('X');
  });

  it('7 个门名齐全，且与 content 的 BASIC_GATES 对齐', () => {
    expect([...GATE_NAMES]).toEqual([
      '非门',
      '与非门',
      '或非门',
      '与门',
      '或门',
      '异或门',
      '同或门',
    ]);
    expect(isGateName('与非门')).toBe(true);
    expect(isGateName('全加器')).toBe(false); // 复合积木不是基础门
  });

  it('各门的真值表（非门 + 6 个二输入门）', () => {
    expect(evalGate('非门', [0])).toBe(1);
    expect(evalGate('与非门', [1, 1])).toBe(0);
    expect(evalGate('与非门', [1, 0])).toBe(1);
    expect(evalGate('或非门', [0, 0])).toBe(1);
    expect(evalGate('或非门', [1, 0])).toBe(0);
    expect(evalGate('与门', [1, 1])).toBe(1);
    expect(evalGate('或门', [0, 0])).toBe(0);
    expect(evalGate('异或门', [1, 1])).toBe(0);
    expect(evalGate('同或门', [1, 1])).toBe(1); // 同或 = 异或取反
    expect(evalGate('同或门', [0, 1])).toBe(0);
  });

  it('多输入与门/或门按折叠算（对应内容里的多输入或门）', () => {
    expect(evalGate('与门', [1, 1, 1])).toBe(1);
    expect(evalGate('与门', [1, 0, 1])).toBe(0);
    expect(evalGate('或门', [0, 0, 0])).toBe(0);
    expect(evalGate('或门', [0, 1, 0])).toBe(1);
  });

  it('输入个数不足按 X 补齐（悬空端口）', () => {
    expect(evalGate('与门', [1])).toBe('X');
    expect(evalGate('异或门', [])).toBe('X');
  });

  it('节点多驱动合并：0 与 1 撞上就是 X，没有强弱优先级', () => {
    expect(mergeDrivers([0, 0])).toBe(0);
    expect(mergeDrivers([1, 1, 1])).toBe(1);
    expect(mergeDrivers([0, 1])).toBe('X');
    expect(mergeDrivers([0, 'Z', 1])).toBe('X');
    expect(mergeDrivers(['Z', 'Z'])).toBe('Z');
    expect(mergeDrivers([1, 'Z'])).toBe(1);
    expect(mergeDrivers([])).toBe('Z');
  });

  it('4 值 × 4 值的全枚举不抛错，且 X/Z 只会被"吸收"成 0/1 或保留 X', () => {
    for (const a of V) {
      for (const b of V) {
        for (const f of [andBit, orBit, xorBit]) {
          const r = f(a, b);
          expect(['0', '1', 'X'].includes(String(r)) || r === 0 || r === 1).toBe(true);
        }
      }
    }
  });
});
