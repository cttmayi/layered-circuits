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
  return { id: 'scratch', name: '未命名电路', syms: [], wires: [], library: [], backdrop: [] };
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

/**
 * 教学关半成品画布：横向布局（输入在左、输出在右、元件居中、电源顶底），
 * 让「还差哪一步」一眼可见。与 levels 里的 seedDoc（Design）连接一致：
 * 玩家补完关键连接后就是参考解。三个教学关各一个。
 */
export function npnIntroSeedDoc(): Doc {
  const doc = emptyDoc();
  doc.name = '认识三极管 · 半成品';
  doc.syms = [
    // 实物图标：输入=门磁按钮（按下=开门=1）、输出=警示灯（1=亮）
    sym({ id: 'in-a', kind: 'input', x: 60, y: 230, label: 'a', value: 0, sprite: 'button' }),
    sym({ id: 'out-y', kind: 'output', x: 660, y: 230, label: 'y', sprite: 'lamp' }),
    // 电源→负载→三极管→地 自上而下竖排，像课本里的共射反相电路，从左往右读
    sym({ id: 'vcc', kind: 'vcc', x: 300, y: 10, label: 'VCC' }),
    sym({ id: 'r1', kind: 'unit', unit: 'res', x: 300, y: 150, label: 'R1' }),
    sym({ id: 'q1', kind: 'unit', unit: 'npn', x: 300, y: 230, label: 'Q1' }),
    sym({ id: 'gnd', kind: 'gnd', x: 300, y: 340, label: 'GND' }),
    // 灯是「真两脚器件」：p 接输出信号、g 接公共地——灯下面那个地是给灯用的回路端
    sym({ id: 'gnd2', kind: 'gnd', x: 660, y: 340, label: '' }),
  ];
  // 场景背景：门磁按钮装在左墙、警示灯挂在右墙，中间是电路
  doc.backdrop = [
    { kind: 'wall', x: 6, y: 90, w: 44, h: 280 },
    { kind: 'wall', x: 668, y: 90, w: 44, h: 280 },
  ];
  // 上拉 VCC→R1→Q1 集电极、集电极→输出、发射极→GND、灯的地端→GND 都已接好；
  // 只差基极 b→输入 a
  doc.wires = [
    wire('vcc', 'p', 'r1', 'a'),
    wire('r1', 'b', 'q1', 'c'),
    wire('q1', 'c', 'out-y', 'p'),
    wire('q1', 'e', 'gnd', 'p'),
    wire('out-y', 'g', 'gnd2', 'p'),
  ];
  return doc;
}

export function dioIntroSeedDoc(): Doc {
  const doc = emptyDoc();
  doc.name = '认识二极管 · 半成品';
  doc.syms = [
    // 实物图标：输入=电池（有电亮/没电灰）、输出=设备指示灯
    sym({ id: 'in-a', kind: 'input', x: 60, y: 160, label: 'a', value: 0, sprite: 'battery' }),
    sym({ id: 'in-b', kind: 'input', x: 60, y: 300, label: 'b', value: 0, sprite: 'battery' }),
    sym({ id: 'out-y', kind: 'output', x: 660, y: 230, label: 'y', sprite: 'lamp' }),
    sym({ id: 'gnd', kind: 'gnd', x: 480, y: 340, label: 'GND' }),
    sym({ id: 'r1', kind: 'unit', unit: 'res', x: 480, y: 230, rot: 1, label: 'R1' }),
    // 灯的地端：设备灯下面那个地是给灯用的回路端（p 接输出、g 接公共地）
    sym({ id: 'gnd2', kind: 'gnd', x: 660, y: 340, label: '' }),
  ];
  // 场景背景：两节电池装在左墙电池架、设备灯在右墙
  doc.backdrop = [
    { kind: 'wall', x: 6, y: 90, w: 44, h: 280 },
    { kind: 'wall', x: 668, y: 90, w: 44, h: 280 },
  ];
  // 两节电池直接并联到输出（信号冲突/倒灌），负载下拉电阻已接、灯的地端已接地；
  // 玩家加二极管隔开
  doc.wires = [
    wire('in-a', 'p', 'out-y', 'p'),
    wire('in-b', 'p', 'out-y', 'p'),
    wire('out-y', 'p', 'r1', 'a'),
    wire('r1', 'b', 'gnd', 'p'),
    wire('out-y', 'g', 'gnd2', 'p'),
  ];
  return doc;
}

export function floatIntroSeedDoc(): Doc {
  const doc = emptyDoc();
  doc.name = '悬空与默认电平 · 半成品';
  doc.syms = [
    // 实物图标：输入=推门按钮（按下=1）、输出=弹簧门（关好=1）
    sym({ id: 'in-a', kind: 'input', x: 60, y: 230, label: 'a', value: 0, sprite: 'button' }),
    sym({ id: 'out-y', kind: 'output', x: 660, y: 230, label: 'y', sprite: 'door' }),
    sym({ id: 'vcc', kind: 'vcc', x: 420, y: 70, label: 'VCC' }),
    sym({ id: 'gnd', kind: 'gnd', x: 300, y: 340, label: 'GND' }),
    sym({ id: 'q1', kind: 'unit', unit: 'npn', x: 300, y: 230, label: 'Q1' }),
  ];
  // 场景背景：推门按钮装在左墙、弹簧门在右墙门洞里
  doc.backdrop = [
    { kind: 'wall', x: 6, y: 90, w: 44, h: 280 },
    { kind: 'doorFrame', x: 640, y: 90, w: 76, h: 280 },
  ];
  // 三极管开关已接（集电极→输出、基极→输入、发射极→GND）；只差上拉电阻 VCC→y
  doc.wires = [
    wire('q1', 'c', 'out-y', 'p'),
    wire('q1', 'b', 'in-a', 'p'),
    wire('q1', 'e', 'gnd', 'p'),
  ];
  return doc;
}

/** 教学关半成品画布分发（levels 的 seedDoc 只负责判定，这里管画布布局） */
export function teachingSeedDoc(levelId: string): Doc {
  if (levelId === 's1-dio') return dioIntroSeedDoc();
  if (levelId === 's1-float') return floatIntroSeedDoc();
  return npnIntroSeedDoc();
}
