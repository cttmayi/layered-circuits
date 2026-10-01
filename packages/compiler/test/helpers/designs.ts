import { type Design, DesignBuilder } from '@lc/schema';

/**
 * 用 DesignBuilder 手写的参考电路（作者态 DTO）。
 * 电路结构与 sim-core/test/helpers/circuits.ts 里的 IR 版一致，用来交叉验证编译器。
 */

/** RTL 非门：2 NPN + 3 电阻（成本 7）；Q1 反相级 + Q2 射极跟随器输出级 */
export function notGateDesign(id = 'not'): Design {
  const b = new DesignBuilder(id, '非门');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('res', { a: 'in', b: 'b1' }, 'R1');
  b.unit('npn', { c: 'a', b: 'b1', e: 'gnd' }, 'Q1');
  b.unit('res', { a: 'vcc', b: 'a' }, 'R2');
  b.unit('npn', { c: 'vcc', b: 'a', e: 'out' }, 'Q2');
  b.unit('res', { a: 'out', b: 'gnd' }, 'R3');
  b.port('in', 'in', 'in');
  b.port('out', 'out', 'out');
  return b.build();
}

/** CMOS 与非门：2 PMOS 上拉 + 2 NMOS 下拉（推挽，无电阻） */
export function cmosNandDesign(id = 'cmos-nand'): Design {
  const b = new DesignBuilder(id, 'CMOS与非门');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('pmos', { d: 'm', g: 'a', s: 'vcc' }, 'P1');
  b.unit('pmos', { d: 'y', g: 'b', s: 'm' }, 'P2');
  b.unit('nmos', { d: 'y', g: 'a', s: 'n1' }, 'N1');
  b.unit('nmos', { d: 'n1', g: 'b', s: 'gnd' }, 'N2');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** SR 锁存器：4 NPN + 6 电阻 */
export function srLatchDesign(id = 'sr-latch'): Design {
  const b = new DesignBuilder(id, 'SR锁存器');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('res', { a: 's', b: 'b1' });
  b.unit('res', { a: 'qn', b: 'b2' });
  b.unit('npn', { c: 'q', b: 'b1', e: 'm1' });
  b.unit('npn', { c: 'm1', b: 'b2', e: 'gnd' });
  b.unit('res', { a: 'vcc', b: 'q' });
  b.unit('res', { a: 'r', b: 'b3' });
  b.unit('res', { a: 'q', b: 'b4' });
  b.unit('npn', { c: 'qn', b: 'b3', e: 'm2' });
  b.unit('npn', { c: 'm2', b: 'b4', e: 'gnd' });
  b.unit('res', { a: 'vcc', b: 'qn' });
  b.port('s', 'in', 's');
  b.port('r', 'in', 'r');
  b.port('q', 'out', 'q');
  b.port('qn', 'out', 'qn');
  return b.build();
}

/** 两路直通（每路一个电阻）：用于验证总线位宽展开 */
export function twoBitPassDesign(id = 'pass2'): Design {
  const b = new DesignBuilder(id, '两位直通');
  b.unit('res', { a: 'd0', b: 'q0' }, 'R0');
  b.unit('res', { a: 'd1', b: 'q1' }, 'R1');
  b.port('d', 'in', ['d0', 'd1']);
  b.port('q', 'out', ['q0', 'q1']);
  return b.build();
}

/** 用两个「非门模块」串联出缓冲器：验证模块复用与成本递归 */
export function bufferDesign(notHash: string, id = 'buffer'): Design {
  const b = new DesignBuilder(id, '缓冲器（两个非门模块）');
  b.module(notHash, { in: 'in', out: 'mid' }, 'NOT#1');
  b.module(notHash, { in: 'mid', out: 'out' }, 'NOT#2');
  b.port('in', 'in', 'in');
  b.port('out', 'out', 'out');
  return b.build();
}

/** 顶层电路：把两位直通模块接到顶层 2 位端口上 */
export function busTopDesign(passHash: string, id = 'bus-top'): Design {
  const b = new DesignBuilder(id, '总线顶层');
  b.module(passHash, { d: ['t0', 't1'], q: ['y0', 'y1'] }, 'PASS2');
  b.port('in', 'in', ['t0', 't1']);
  b.port('out', 'out', ['y0', 'y1']);
  return b.build();
}

/** 有意留一个未连接引脚的非门（用来测编译诊断） */
export function danglingPinDesign(id = 'dangling'): Design {
  const b = new DesignBuilder(id, '缺引脚电路');
  b.vcc('vcc');
  b.unit('res', { a: 'vcc', b: 'out' }, 'R1');
  b.unit('npn', { c: 'out', e: 'gnd' }, 'Q1'); // 基极故意不接
  b.gnd('gnd');
  b.port('out', 'out', 'out');
  return b.build();
}
