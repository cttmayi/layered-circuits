/**
 * 阶段 3（算术单元）参考解 —— GDD 阶段 3 的晶体管级真解（纯底层元件，不依赖玩家模块库）。
 *
 * 组成方式（成本=半分口径：npn4 res2 dio3；RTL 与非门 = 2npn+3res = 14）：
 *  - 半加器 = 异或门(4 与非门=56) + 进位(2 与非门=28)                    → 84
 *  - 全加器 = 经典 9 与非门（TTL 全加器；强驱动、可级联）                  → 126
 *  - N 位加法器 = N 个全加器串联进位（carry_in 接地）
 *  - 简易 ALU = op 位受控取反 t=op⊕b，再 a + t + op（借位即进位）
 *
 * 为什么全用与非门：二极管与/或门的输出是「弱 1」，再进一级二极管就变成 X
 * （实测弱 1 过二极管或门的下拉电阻会掉进未定义区）。与非门输出可直接级联，
 * 是唯一能保证 8 位进位链信号完整性的基础门。参考解必须空库可编译。
 */

import { type Design, DesignBuilder } from '@lc/schema';

/** RTL 与非门：¬(a·c) → y（2 三极管 + 3 电阻 = 14，输出可级联） */
export function nandInto(b: DesignBuilder, p: string, a: string, c: string, y: string): void {
  b.unit('res', { a, b: `${p}b1` }, `${p}R1`);
  b.unit('res', { a: c, b: `${p}b2` }, `${p}R2`);
  b.unit('npn', { c: y, b: `${p}b1`, e: `${p}m` }, `${p}Q1`);
  b.unit('npn', { c: `${p}m`, b: `${p}b2`, e: 'gnd' }, `${p}Q2`);
  b.unit('res', { a: 'vcc', b: y }, `${p}R3`);
}

/** RTL 异或门：a⊕c → y（4 个与非门 = 56） */
export function xorInto(b: DesignBuilder, p: string, a: string, c: string, y: string): void {
  const n1 = `${p}n1`;
  const n2 = `${p}n2`;
  const n3 = `${p}n3`;
  nandInto(b, `${p}1`, a, c, n1); // n1 = ¬(a·c)
  nandInto(b, `${p}2`, a, n1, n2); // n2 = ¬(a·n1)
  nandInto(b, `${p}3`, c, n1, n3); // n3 = ¬(c·n1)
  nandInto(b, `${p}4`, n2, n3, y); // y = ¬(n2·n3) = a⊕c
}

/**
 * 全加器（经典 9 与非门）：
 *   t1=¬(ab), x=¬(¬(a·t1)·¬(b·t1))=a⊕b, t4=¬(x·cin),
 *   s=¬(¬(x·t4)·¬(cin·t4))=x⊕cin, cout=¬(t1·t4)=ab∨(x·cin)。
 * 成本 9×14 = 126。
 */
export function fullAdderInto(
  b: DesignBuilder,
  p: string,
  a: string,
  bb: string,
  cin: string,
  s: string,
  cout: string,
): void {
  const t1 = `${p}t1`;
  const t2 = `${p}t2`;
  const t3 = `${p}t3`;
  const x = `${p}x`;
  const t4 = `${p}t4`;
  const t5 = `${p}t5`;
  const t6 = `${p}t6`;
  nandInto(b, `${p}1`, a, bb, t1); // t1 = ¬(ab)
  nandInto(b, `${p}2`, a, t1, t2); // t2 = ¬(a·t1)
  nandInto(b, `${p}3`, bb, t1, t3); // t3 = ¬(b·t1)
  nandInto(b, `${p}4`, t2, t3, x); // x = a⊕b
  nandInto(b, `${p}5`, x, cin, t4); // t4 = ¬(x·cin)
  nandInto(b, `${p}6`, x, t4, t5); // t5 = ¬(x·t4)
  nandInto(b, `${p}7`, cin, t4, t6); // t6 = ¬(cin·t4)
  nandInto(b, `${p}8`, t5, t6, s); // s = x⊕cin
  nandInto(b, `${p}9`, t1, t4, cout); // cout = ab ∨ (x·cin)
}

/** 半加器参考解：a, b → s, c（成本 84） */
export function halfAdderRef(id = 'ref-s3-ha'): Design {
  const b = new DesignBuilder(id, '半加器');
  b.vcc('vcc');
  b.gnd('gnd');
  xorInto(b, 'x', 'a', 'b', 's'); // s = a⊕b
  const n = `${'c'}n1`;
  nandInto(b, 'c', 'a', 'b', n); // n = ¬(ab)
  nandInto(b, 'c2', n, n, 'c'); // c = ab（反相器）
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('s', 'out', 's');
  b.port('c', 'out', 'c');
  return b.build();
}

/** 全加器参考解：a, b, cin → s, cout（成本 126） */
export function fullAdderRef(id = 'ref-s3-fa'): Design {
  const b = new DesignBuilder(id, '全加器');
  b.vcc('vcc');
  b.gnd('gnd');
  fullAdderInto(b, 'f', 'a', 'b', 'cin', 's', 'cout');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('cin', 'in', 'cin');
  b.port('s', 'out', 's');
  b.port('cout', 'out', 'cout');
  return b.build();
}

/** N 位行波进位加法器参考解：a + b → y, cout（成本 126×width） */
export function adderRef(width: number, id: string, name: string): Design {
  const b = new DesignBuilder(id, name);
  b.vcc('vcc');
  b.gnd('gnd');
  const aNets = Array.from({ length: width }, (_, i) => `a${i}`);
  const bNets = Array.from({ length: width }, (_, i) => `b${i}`);
  const yNets = Array.from({ length: width }, (_, i) => `y${i}`);
  let carry = 'gnd';
  for (let i = 0; i < width; i++) {
    const next = i === width - 1 ? 'cout' : `c${i}`;
    fullAdderInto(
      b,
      `f${i}`,
      aNets[i] as string,
      bNets[i] as string,
      carry,
      yNets[i] as string,
      next,
    );
    carry = next;
  }
  b.port('a', 'in', aNets);
  b.port('b', 'in', bNets);
  b.port('y', 'out', yNets);
  b.port('cout', 'out', 'cout');
  return b.build();
}

/** 4 位加法器参考解（成本 504） */
export function adder4Ref(id = 'ref-s3-adder4'): Design {
  return adderRef(4, id, '4位加法器');
}

/** 8 位加法器参考解（成本 1008） */
export function adder8Ref(id = 'ref-s3-adder8'): Design {
  return adderRef(8, id, '8位加法器');
}

/**
 * 简易 ALU（加减）参考解：op=0 → y=a+b；op=1 → y=a-b。
 * 原理：t_i = op⊕b_i（op=1 时取反），cin=op（加 1 变补码），再逐位全加。
 * 成本 = 4 异或(4×56=224) + 4 全加器(4×126=504) = 728
 */
export function aluRef(id = 'ref-s3-alu'): Design {
  const b = new DesignBuilder(id, '简易ALU');
  b.vcc('vcc');
  b.gnd('gnd');
  const aNets = Array.from({ length: 4 }, (_, i) => `a${i}`);
  const bNets = Array.from({ length: 4 }, (_, i) => `b${i}`);
  const tNets = Array.from({ length: 4 }, (_, i) => `t${i}`);
  const yNets = Array.from({ length: 4 }, (_, i) => `y${i}`);
  for (let i = 0; i < 4; i++) xorInto(b, `x${i}`, 'op', bNets[i] as string, tNets[i] as string);
  let carry = 'op';
  for (let i = 0; i < 4; i++) {
    const next = `c${i}`;
    fullAdderInto(
      b,
      `f${i}`,
      aNets[i] as string,
      tNets[i] as string,
      carry,
      yNets[i] as string,
      next,
    );
    carry = next;
  }
  b.port('op', 'in', 'op');
  b.port('a', 'in', aNets);
  b.port('b', 'in', bNets);
  b.port('y', 'out', yNets);
  return b.build();
}
