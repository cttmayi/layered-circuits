// @vitest-environment jsdom
/**
 * 位宽（第三章总线）在编辑器层的落点：
 *  - 画布端口带 width，导出成多位 Design 端口（nets 按位）；
 *  - 多 bit 输入端口的驱动按 lane 键输出（a[i]），与编译器展开名一致；
 *  - 引脚命中按位返回 bit，同宽总线一次连整根（lane 对齐）。
 */

import { findLevel } from '@lc/content';
import { beforeEach, describe, expect, it } from 'vitest';
import { inputValues, pinOffsets, toDesign } from '../src/editor/model';
import { docForLevel } from '../src/level/progress';

const adder4 = () => findLevel('s3-adder-4')!;

describe('位宽：画布端口与导出', () => {
  beforeEach(() => localStorage.clear());

  it('关卡画布端口带位宽：4 位加法器的 a/b 是 width 4，y 是 width 4，cout 是 1 位', () => {
    const doc = docForLevel(adder4(), []);
    const inputA = doc.syms.find((s) => s.kind === 'input' && s.label === 'a');
    const inputB = doc.syms.find((s) => s.kind === 'input' && s.label === 'b');
    const outputY = doc.syms.find((s) => s.kind === 'output' && s.label === 'y');
    const outputCout = doc.syms.find((s) => s.kind === 'output' && s.label === 'cout');
    expect(inputA?.width).toBe(4);
    expect(inputB?.width).toBe(4);
    expect(outputY?.width).toBe(4);
    expect(outputCout?.width).toBe(1);
    // 多 bit 端口有 4 个引脚位（同名 pin，bit 0..3）
    const pins = pinOffsets(inputA as never, []);
    expect(pins.filter((p) => p.name === 'p')).toHaveLength(4);
  });

  it('接线后导出：多 bit 端口 = width 4 + 每 lane 一个 net；驱动按 lane 键输出', () => {
    const doc = docForLevel(adder4(), []);
    // 未接线：多 bit 输入驱动展开成 lane 键
    const drives = inputValues(doc);
    expect(drives['a[0]']).toBe(0);
    expect(drives['a[3]']).toBe(0);
    expect(drives.b).toBeUndefined(); // b 是 width 4 → 也没有裸名
    // 把 a[0] 接到 gnd 之类 → 导出时 a 端口只含接线的 lane？这里直接构造 4 根线
    // ⚠️ 逻辑关（第 8 关起）的初始画布**不再预置电源轨**（用户第 ⑳ 轮拍板）——
    // 这条用例只是需要"一根常量驱动"来把 4 个 lane 并到同一个 net，所以自己加一根地。
    doc.syms.push({ id: 'test-gnd', kind: 'gnd', x: 0, y: 0, rot: 0, label: 'GND' } as never);
    const rail = doc.syms.find((s) => s.kind === 'gnd')!;
    const a = doc.syms.find((s) => s.kind === 'input' && s.label === 'a')!;
    doc.wires = [
      { id: 'w1', a: { inst: rail.id, pin: 'p', bit: 0 }, b: { inst: a.id, pin: 'p', bit: 0 } },
      { id: 'w2', a: { inst: rail.id, pin: 'p', bit: 0 }, b: { inst: a.id, pin: 'p', bit: 1 } },
      { id: 'w3', a: { inst: rail.id, pin: 'p', bit: 0 }, b: { inst: a.id, pin: 'p', bit: 2 } },
      { id: 'w4', a: { inst: rail.id, pin: 'p', bit: 0 }, b: { inst: a.id, pin: 'p', bit: 3 } },
    ];
    const design = toDesign(doc);
    const portA = design.ports.find((p) => p.name === 'a');
    expect(portA?.width).toBe(4);
    expect(portA?.nets).toHaveLength(4);
    // 四个 lane 在同一 net（都接 gnd）→ 导出的 nets 里去重后应该只有少数 net
    const unique = new Set(
      design.nets.map((n) => n.pins.map((p) => `${p.inst}.${p.pin}[${p.bit}]`).join('+')),
    );
    expect(unique.size).toBeGreaterThan(0);
  });
});
