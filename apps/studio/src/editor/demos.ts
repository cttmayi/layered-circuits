/**
 * 示例电路。第一个示例就是 M0 的验收电路：
 * RTL 非门 = 2 三极管 + 3 电阻（Q1 共射反相级 + Q2 射极跟随器输出级），成本 7。
 */

import type { Doc, Sym, Wire } from './model';

function wire(inst1: string, pin1: string, inst2: string, pin2: string): Wire {
  return {
    id: `${inst1}.${pin1}-${inst2}.${pin2}`,
    a: { inst: inst1, pin: pin1, bit: 0 },
    b: { inst: inst2, pin: pin2, bit: 0 },
  };
}

function sym(partial: Partial<Sym> & Pick<Sym, 'id' | 'kind' | 'x' | 'y' | 'label'>): Sym {
  return { rot: 0, ...partial } as Sym;
}

export function emptyDoc(): Doc {
  return { id: 'scratch', name: '未命名电路', syms: [], wires: [], library: [] };
}

export function notGateDemo(): Doc {
  const syms: Sym[] = [
    sym({ id: 'in1', kind: 'input', x: 40, y: 210, label: 'in', value: 0 }),
    sym({ id: 'r1', kind: 'unit', unit: 'res', x: 170, y: 210, rot: 1, label: 'R1' }),
    sym({ id: 'q1', kind: 'unit', unit: 'npn', x: 290, y: 240, label: 'Q1' }),
    sym({ id: 'gnd1', kind: 'gnd', x: 290, y: 330, label: 'GND' }),
    sym({ id: 'r2', kind: 'unit', unit: 'res', x: 360, y: 150, label: 'R2' }),
    sym({ id: 'vcc1', kind: 'vcc', x: 360, y: 70, label: 'VCC' }),
    sym({ id: 'q2', kind: 'unit', unit: 'npn', x: 460, y: 240, label: 'Q2' }),
    sym({ id: 'vcc2', kind: 'vcc', x: 460, y: 120, label: 'VCC' }),
    sym({ id: 'r3', kind: 'unit', unit: 'res', x: 560, y: 310, label: 'R3' }),
    sym({ id: 'gnd2', kind: 'gnd', x: 560, y: 380, label: 'GND' }),
    sym({ id: 'out1', kind: 'output', x: 640, y: 266, label: 'out' }),
  ];

  const wires: Wire[] = [
    wire('in1', 'p', 'r1', 'b'),
    wire('r1', 'a', 'q1', 'b'),
    wire('q1', 'c', 'r2', 'b'),
    wire('q1', 'c', 'q2', 'b'),
    wire('r2', 'a', 'vcc1', 'p'),
    wire('q1', 'e', 'gnd1', 'p'),
    wire('q2', 'c', 'vcc2', 'p'),
    wire('q2', 'e', 'r3', 'a'),
    wire('q2', 'e', 'out1', 'p'),
    wire('r3', 'b', 'gnd2', 'p'),
  ];

  return { id: 'not-gate', name: '非门（2 三极管 + 3 电阻）', syms, wires, library: [] };
}

/** 一个「没有接线的三极管」示例，用来演示诊断提示（教学反馈） */
export function danglingDemo(): Doc {
  const doc = emptyDoc();
  doc.name = '未接线示例';
  doc.syms = [
    sym({ id: 'in1', kind: 'input', x: 60, y: 200, label: 'in', value: 1 }),
    sym({ id: 'q1', kind: 'unit', unit: 'npn', x: 260, y: 200, label: 'Q1' }),
    sym({ id: 'out1', kind: 'output', x: 440, y: 200, label: 'out' }),
  ];
  doc.wires = [wire('in1', 'p', 'q1', 'b')];
  return doc;
}
