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

/** RTL 与非门：¬(a·c) → y（2 三极管 + 3 电阻；半分记账 npn=4/res=4 → 20，输出可级联） */
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

/**
 * BCD→七段译码器（单数字）：bcd[3:0]（bcd0=LSB）→ seg[6:0]（bit0=a..bit6=g）。
 * 43 个与非门的共享结构（2 级 SOP + 共享积项，全部与非门保证信号强度可级联）：
 *   a = A'C' + AC + B + D     b = A'B' + AB + C'    c = A + B' + C
 *   d = A'B + A'C' + AB'C + BC' + D    e = A'B + A'C'
 *   f = A'B' + A'C + B'C + D   g = A'B + B'C + BC' + D
 * 段码（0-9 → 0x3F,0x06,0x5B,0x4F,0x66,0x6D,0x7D,0x07,0x7F,0x6F）。
 * 成本 43×20 = 860（半分记账，RTL 与非门 = 2npn+3res = 20；
 * QM 最小化 + 共享，已在测试里对 0-9 全真值表验证）。
 */
export function seg7Into(
  b: DesignBuilder,
  p: string,
  a: string,
  bb: string,
  c: string,
  d: string,
  seg: string[], // [a..g]
): void {
  // 输入补（每路一个反相器）
  const nA = `${p}nA`;
  const nB = `${p}nB`;
  const nC = `${p}nC`;
  const nD = `${p}nD`;
  nandInto(b, `${p}iA`, a, a, nA);
  nandInto(b, `${p}iB`, bb, bb, nB);
  nandInto(b, `${p}iC`, c, c, nC);
  nandInto(b, `${p}iD`, d, d, nD);
  // 共享积项（输出即 ¬p）
  const t1 = `${p}t1`;
  const t2 = `${p}t2`;
  const t3 = `${p}t3`;
  const t4 = `${p}t4`;
  const t5 = `${p}t5`;
  const t6 = `${p}t6`;
  const t7 = `${p}t7`;
  const t8 = `${p}t8`;
  const t9 = `${p}t9`;
  nandInto(b, `${p}1`, nA, bb, t1); // ¬(A'·B)
  nandInto(b, `${p}2`, nA, nC, t2); // ¬(A'·C')
  nandInto(b, `${p}3`, nB, c, t3); // ¬(B'·C)
  nandInto(b, `${p}4`, bb, nC, t4); // ¬(B·C')
  nandInto(b, `${p}5`, a, c, t5); // ¬(A·C)
  nandInto(b, `${p}6`, nA, nB, t6); // ¬(A'·B')
  nandInto(b, `${p}7`, a, bb, t7); // ¬(A·B)
  nandInto(b, `${p}8a`, t3, t3, `${p}t3n`); // B'·C
  nandInto(b, `${p}8`, a, `${p}t3n`, t8); // ¬(A·B'·C)
  nandInto(b, `${p}9`, nA, c, t9); // ¬(A'·C)
  // OR 链：NAND(¬p1,¬p2)=p1+p2，后续每项 NOT(累加)+NAND
  // 内部网名必须逐条链唯一（计数器），否则不同段的链会串线
  let orn = 0;
  const orN = (out: string, terms: string[]): void => {
    if (terms.length === 2) {
      nandInto(b, `${p}or${orn++}`, terms[0], terms[1], out);
      return;
    }
    let s = `${p}or${orn++}`;
    nandInto(b, `${p}or${orn++}`, terms[0], terms[1], s);
    for (let i = 2; i < terms.length; i++) {
      const inv = `${p}or${orn++}`;
      nandInto(b, `${p}or${orn++}`, s, s, inv);
      const nxt = i === terms.length - 1 ? out : `${p}or${orn++}`;
      nandInto(b, `${p}or${orn++}`, inv, terms[i], nxt);
      s = nxt;
    }
  };
  orN(seg[0], [t2, t5, nB, nD]); // a
  orN(seg[1], [t6, t7, c]); // b（¬p for C' = C 输入直连）
  orN(seg[2], [nA, bb, nC]); // c
  orN(seg[3], [t1, t2, t8, t4, nD]); // d
  orN(seg[4], [t1, t2]); // e
  orN(seg[5], [t6, t9, t3, nD]); // f
  orN(seg[6], [t1, t3, t4, nD]); // g
}

/**
 * 七段译码器的共享子电路（seg7Into 内部使用）：输入反相 + 共享项（14 个与非门）。
 * 网名带前缀 p（nA..nD、t1..t9、t3n 内部），供完整译码器复用。
 */
export function segTermInto(
  b: DesignBuilder,
  p: string,
  A: string,
  B: string,
  C: string,
  D: string,
): void {
  const nA = `${p}nA`;
  const nB = `${p}nB`;
  const nC = `${p}nC`;
  const nD = `${p}nD`;
  nandInto(b, `${p}iA`, A, A, nA);
  nandInto(b, `${p}iB`, B, B, nB);
  nandInto(b, `${p}iC`, C, C, nC);
  nandInto(b, `${p}iD`, D, D, nD);
  nandInto(b, `${p}t1`, nA, B, `${p}t1`); // ¬(A'·B)
  nandInto(b, `${p}t2`, nA, nC, `${p}t2`); // ¬(A'·C')
  nandInto(b, `${p}t3`, nB, C, `${p}t3`); // ¬(B'·C)
  nandInto(b, `${p}t4`, B, nC, `${p}t4`); // ¬(B·C')
  nandInto(b, `${p}t5`, A, C, `${p}t5`); // ¬(A·C)
  nandInto(b, `${p}t6`, nA, nB, `${p}t6`); // ¬(A'·B')
  nandInto(b, `${p}t7`, A, B, `${p}t7`); // ¬(A·B)
  nandInto(b, `${p}t3n`, `${p}t3`, `${p}t3`, `${p}t3n`); // B'·C
  nandInto(b, `${p}t8`, A, `${p}t3n`, `${p}t8`); // ¬(A·B'·C)
  nandInto(b, `${p}t9`, nA, C, `${p}t9`); // ¬(A'·C)
}

/** 段输出链：NAND 链实现 ¬(terms 全与)（与 seg7Into 的 orN 同算法；内部网/实例 id 带前缀 p） */
export function segChainInto(b: DesignBuilder, p: string, out: string, terms: string[]): void {
  let n = 0;
  const g = (a: string, c: string, y: string): void => {
    nandInto(b, `${p}q${n++}`, a, c, y);
  };
  if (terms.length === 2) {
    g(terms[0], terms[1], out);
    return;
  }
  let s = `${p}m${n++}`;
  g(terms[0], terms[1], s);
  for (let i = 2; i < terms.length; i++) {
    const inv = `${p}m${n++}`;
    g(s, s, inv);
    const nxt = i === terms.length - 1 ? out : `${p}m${n++}`;
    g(inv, terms[i], nxt);
    s = nxt;
  }
}

/**
 * 段码关参考解（自包含）：bcd0..3 → 本关段线。
 * 结构 = 4 反相信号 + 本关需要的共享项 + 每段的链式与非（N 项链 = 2N-3 门），
 * abc 19 门 / de 18 门 / fg 19 门。不做「公共部分」拆分：每关的输入输出本身就是可理解的（BCD → 哪几根段线亮）。
 */
function segRef(
  id: string,
  name: string,
  chains: Record<string, string[]>,
  terms: Record<string, [string, string]>,
): Design {
  const b = new DesignBuilder(id, name);
  b.vcc('vcc');
  b.gnd('gnd');
  nandInto(b, 'iA', 'bcd0', 'bcd0', 'nA');
  nandInto(b, 'iB', 'bcd1', 'bcd1', 'nB');
  nandInto(b, 'iC', 'bcd2', 'bcd2', 'nC');
  nandInto(b, 'iD', 'bcd3', 'bcd3', 'nD');
  for (const [t, [a, c]] of Object.entries(terms)) nandInto(b, `t${t}`, a, c, t);
  for (const [out, ts] of Object.entries(chains)) segChainInto(b, out, out, ts);
  for (const n of ['bcd0', 'bcd1', 'bcd2', 'bcd3']) b.port(n, 'in', n);
  for (const n of Object.keys(chains)) b.port(n, 'out', n);
  return b.build();
}

/** 段码·abc 参考解：bcd0..3 → a,b,c（4 反相 + t2,t5,t6,t7 + 链 5+3+3 = 19 个与非门，成本 380） */
export function segABCRef(id = 'ref-s3-seg-abc'): Design {
  return segRef(
    id,
    '段码abc',
    {
      a: ['t2', 't5', 'nB', 'nD'],
      b: ['t6', 't7', 'bcd2'],
      c: ['nA', 'bcd1', 'nC'],
    },
    {
      t2: ['nA', 'nC'],
      t5: ['bcd0', 'bcd2'],
      t6: ['nA', 'nB'],
      t7: ['bcd0', 'bcd1'],
    },
  );
}

/** 段码·de 参考解：bcd0..3 → d,e（4 反相 + t1,t2,t3,t3n,t4,t8 + 链 7+1 = 18 个与非门，成本 360） */
export function segDERef(id = 'ref-s3-seg-de'): Design {
  return segRef(
    id,
    '段码de',
    {
      d: ['t1', 't2', 't8', 't4', 'nD'],
      e: ['t1', 't2'],
    },
    {
      t1: ['nA', 'bcd1'],
      t2: ['nA', 'nC'],
      t3: ['nB', 'bcd2'],
      t3n: ['t3', 't3'],
      t4: ['bcd1', 'nC'],
      t8: ['bcd0', 't3n'],
    },
  );
}

/** 段码·fg 参考解：bcd0..3 → f,g（4 反相 + t1,t3,t4,t6,t9 + 链 5+5 = 19 个与非门，成本 380） */
export function segFGRef(id = 'ref-s3-seg-fg'): Design {
  return segRef(
    id,
    '段码fg',
    {
      f: ['t6', 't9', 't3', 'nD'],
      g: ['t1', 't3', 't4', 'nD'],
    },
    {
      t1: ['nA', 'bcd1'],
      t3: ['nB', 'bcd2'],
      t4: ['bcd1', 'nC'],
      t6: ['nA', 'nB'],
      t9: ['nA', 'bcd2'],
    },
  );
}

/** 七段译码器参考解：bcd[3:0] → seg[6:0]（成本 860） */
export function seg7Ref(id = 'ref-s3-seg7'): Design {
  const b = new DesignBuilder(id, '七段译码器');
  b.vcc('vcc');
  b.gnd('gnd');
  const seg = Array.from({ length: 7 }, (_, i) => `seg${i}`);
  seg7Into(b, 'x', 'bcd0', 'bcd1', 'bcd2', 'bcd3', seg);
  b.port('bcd', 'in', ['bcd0', 'bcd1', 'bcd2', 'bcd3']);
  b.port('seg', 'out', seg);
  return b.build();
}
