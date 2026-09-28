import { type FlatNet, NetlistBuilder } from '../../src/index.js';

/**
 * 晶体管级参考电路（RTL 风格）。
 *
 * 这些是「GDD 2.2.2 成本示例」在开关级语义下的可运行实现：用 2 个 NPN + 3 个电阻搭出非门，
 * 用来验证 docs/sim-semantics.md 里的强度/导通规则真的能撑起 RTL 设计。
 */

/**
 * RTL 非门：2 NPN + 3 电阻（成本 = 2×2 + 3×1 = 7，与 GDD 2.2.2 的示例一致）。
 *
 * 拓扑：Q1 共射反相级（IN 高 → A 被强拉低），Q2 射极跟随器输出级（A 高 → OUT 从 VCC 强拉高），
 * R3 是输出下拉，用来定义低电平。射极跟随器不反相，所以整体是反相器。
 */
export function buildNotGate(): FlatNet {
  const b = new NetlistBuilder();
  const IN = b.node('IN');
  const VCC = b.node('VCC');
  const GND = b.node('GND');
  const B1 = b.node('B1');
  const A = b.node('A');
  const OUT = b.node('OUT');

  b.power(VCC, 1);
  b.power(GND, 0);
  b.res(IN, B1, 'R1');
  b.npn(A, B1, GND, 'Q1');
  b.res(VCC, A, 'R2');
  b.npn(VCC, A, OUT, 'Q2');
  b.res(OUT, GND, 'R3');
  b.input(IN, 'in');
  b.output(OUT, 'out');
  return b.build();
}

/** 振荡环：把反相器的输出接回输入 → 逻辑模式必须判定为不稳定 */
export function buildInverterLoop(): FlatNet {
  const b = new NetlistBuilder();
  const VCC = b.node('VCC');
  const GND = b.node('GND');
  const NODE = b.node('NODE');
  const B1 = b.node('B1');

  b.power(VCC, 1);
  b.power(GND, 0);
  b.res(NODE, B1, 'R1');
  b.npn(NODE, B1, GND, 'Q1');
  b.res(VCC, NODE, 'R2');
  b.output(NODE, 'out');
  return b.build();
}

/** RTL 与非门：2 NPN 串联 + 3 电阻（A=B=1 时输出强 0，否则被上拉为 1） */
export function buildNandGate(): FlatNet {
  const b = new NetlistBuilder();
  const IN1 = b.node('IN1');
  const IN2 = b.node('IN2');
  const VCC = b.node('VCC');
  const GND = b.node('GND');
  const B1 = b.node('B1');
  const B2 = b.node('B2');
  const MID = b.node('MID');
  const OUT = b.node('OUT');

  b.power(VCC, 1);
  b.power(GND, 0);
  b.res(IN1, B1, 'R1');
  b.res(IN2, B2, 'R2');
  b.npn(OUT, B1, MID, 'Q1');
  b.npn(MID, B2, GND, 'Q2');
  b.res(VCC, OUT, 'R3');
  b.input(IN1, 'a');
  b.input(IN2, 'b');
  b.output(OUT, 'y');
  return b.build();
}

/** 由两个与非门交叉耦合的 SR 锁存器（低电平有效的置位/复位） */
export function buildSRLatch(): FlatNet {
  const b = new NetlistBuilder();
  const S = b.node('S');
  const R = b.node('R');
  const VCC = b.node('VCC');
  const GND = b.node('GND');

  const B1 = b.node('B1');
  const B2 = b.node('B2');
  const M1 = b.node('M1');
  const Q = b.node('Q');

  const B3 = b.node('B3');
  const B4 = b.node('B4');
  const M2 = b.node('M2');
  const QN = b.node('QN');

  b.power(VCC, 1);
  b.power(GND, 0);

  // 与非门 1：输入 S 与 QN，输出 Q
  b.res(S, B1, 'R1');
  b.res(QN, B2, 'R2');
  b.npn(Q, B1, M1, 'Q1');
  b.npn(M1, B2, GND, 'Q2');
  b.res(VCC, Q, 'R3');

  // 与非门 2：输入 R 与 Q，输出 QN
  b.res(R, B3, 'R4');
  b.res(Q, B4, 'R5');
  b.npn(QN, B3, M2, 'Q3');
  b.npn(M2, B4, GND, 'Q4');
  b.res(VCC, QN, 'R6');

  b.input(S, 's');
  b.input(R, 'r');
  b.output(Q, 'q');
  b.output(QN, 'qn');
  return b.build();
}

/** 二极管与门：阳极并联到 Y（上拉电阻），阴极各接一个输入 */
export function buildDiodeAnd(): FlatNet {
  const b = new NetlistBuilder();
  const A = b.node('A');
  const B = b.node('B');
  const Y = b.node('Y');
  const VCC = b.node('VCC');

  b.power(VCC, 1);
  b.res(VCC, Y, 'R1');
  b.dio(Y, A, 'D1');
  b.dio(Y, B, 'D2');
  b.input(A, 'a');
  b.input(B, 'b');
  b.output(Y, 'y');
  return b.build();
}

/** 二极管或门：阳极各接一个输入，阴极并联到 Y（下拉电阻） */
export function buildDiodeOr(): FlatNet {
  const b = new NetlistBuilder();
  const A = b.node('A');
  const B = b.node('B');
  const Y = b.node('Y');
  const GND = b.node('GND');

  b.power(GND, 0);
  b.res(Y, GND, 'R1');
  b.dio(A, Y, 'D1');
  b.dio(B, Y, 'D2');
  b.input(A, 'a');
  b.input(B, 'b');
  b.output(Y, 'y');
  return b.build();
}

/** 二极管 ROM 单元：字线 W 为高时经二极管把位线 BL 拉高（BL 有下拉电阻） */
export function buildDiodeRomBit(): FlatNet {
  const b = new NetlistBuilder();
  const W = b.node('W');
  const BL = b.node('BL');
  const GND = b.node('GND');

  b.power(GND, 0);
  b.res(BL, GND, 'R1');
  b.dio(W, BL, 'D1');
  b.input(W, 'w');
  b.output(BL, 'bl');
  return b.build();
}
