/**
 * 简易计算器章节的参考解 —— GDD 阶段 3.5（算术 → 计算器）。
 *
 * 高成本版（用户拍板「先高成本、再做低成本优化」）：
 *  - bcd2bin：两位 BCD（十位 t + 个位 u）→ 7 位二进制。bin = u + 8t + 2t
 *    （×8/×2 移位加权 + 两级行波进位加法器，复用 fullAdderInto）。
 *  - bin2bcd：7 位二进制 → 两位 BCD。double-dabble「加 3 移位」组合展开
 *    （左移 7 次、每步个位/十位 ≥5 加 3；加 3 单元门控进位）。
 *  - reg8：8 位寄存器 = 8 个主从 D 触发器共用 clk（复用 dffInto）。
 *  - calc：a、b（BCD）→ bcd2bin×2 → 8 位二进制加法 → bin2bcd → 8 位锁存
 *    （eq 按钮边沿）→ 十位/个位七段显示。
 *
 * 拼装块（可复用于关卡参考解与玩家模块思路）：dffInto / bcd2binInto /
 * plus3Into / bin2bcdInto / fullAdderInto(来自 references-ari)。
 */

import { type Design, DesignBuilder } from '@lc/schema';
import { fullAdderInto, nandInto, seg7Into, xorInto } from './references-ari.js';
import { digitEntryInto, encoderInto } from './references-keypad.js';
import { hashOf } from './teachings.js';

/**
 * 主从 D 触发器（无 rail 拼装块）：clk 上升沿把 d 搬到 q。
 * 内部网/实例全部加前缀 p（8 个并排共用 vcc/gnd 与 clk）。
 */
export function dffInto(
  b: DesignBuilder,
  p: string,
  clk: string,
  d: string,
  q: string,
  qn: string,
): void {
  // 时钟反相器：clk → nclk（单管反相器）
  b.unit('res', { a: clk, b: `${p}cb1` }, `${p}RC1`);
  b.unit('npn', { c: `${p}nclk`, b: `${p}cb1`, e: 'gnd' }, `${p}QC1`);
  b.unit('res', { a: 'vcc', b: `${p}nclk` }, `${p}RC2`);
  // 主锁存器：d，使能 nclk → m
  b.unit('res', { a: d, b: `${p}mnb1` }, `${p}RM1`);
  b.unit('npn', { c: `${p}mnd`, b: `${p}mnb1`, e: 'gnd' }, `${p}QM1`);
  b.unit('res', { a: 'vcc', b: `${p}mnd` }, `${p}RM2`);
  b.unit('res', { a: d, b: `${p}ms1` }, `${p}RM3`);
  b.unit('res', { a: `${p}nclk`, b: `${p}ms2` }, `${p}RM4`);
  b.unit('npn', { c: `${p}mns`, b: `${p}ms1`, e: `${p}msm1` }, `${p}QM2`);
  b.unit('npn', { c: `${p}msm1`, b: `${p}ms2`, e: 'gnd' }, `${p}QM3`);
  b.unit('res', { a: 'vcc', b: `${p}mns` }, `${p}RM5`);
  b.unit('res', { a: `${p}mnd`, b: `${p}ms3` }, `${p}RM6`);
  b.unit('res', { a: `${p}nclk`, b: `${p}ms4` }, `${p}RM7`);
  b.unit('npn', { c: `${p}mnr`, b: `${p}ms3`, e: `${p}msm2` }, `${p}QM4`);
  b.unit('npn', { c: `${p}msm2`, b: `${p}ms4`, e: 'gnd' }, `${p}QM5`);
  b.unit('res', { a: 'vcc', b: `${p}mnr` }, `${p}RM8`);
  b.unit('res', { a: `${p}mns`, b: `${p}mb1` }, `${p}RM9`);
  b.unit('res', { a: `${p}mqn`, b: `${p}mb2` }, `${p}RM10`);
  b.unit('npn', { c: `${p}m`, b: `${p}mb1`, e: `${p}mm1` }, `${p}QM6`);
  b.unit('npn', { c: `${p}mm1`, b: `${p}mb2`, e: 'gnd' }, `${p}QM7`);
  b.unit('res', { a: 'vcc', b: `${p}m` }, `${p}RM11`);
  b.unit('res', { a: `${p}mnr`, b: `${p}mb3` }, `${p}RM12`);
  b.unit('res', { a: `${p}m`, b: `${p}mb4` }, `${p}RM13`);
  b.unit('npn', { c: `${p}mqn`, b: `${p}mb3`, e: `${p}mm2` }, `${p}QM8`);
  b.unit('npn', { c: `${p}mm2`, b: `${p}mb4`, e: 'gnd' }, `${p}QM9`);
  b.unit('res', { a: 'vcc', b: `${p}mqn` }, `${p}RM14`);
  // 从锁存器：m，使能 clk → q
  b.unit('res', { a: `${p}m`, b: `${p}snb1` }, `${p}RS1`);
  b.unit('npn', { c: `${p}snd`, b: `${p}snb1`, e: 'gnd' }, `${p}QS1`);
  b.unit('res', { a: 'vcc', b: `${p}snd` }, `${p}RS2`);
  b.unit('res', { a: `${p}m`, b: `${p}ss1` }, `${p}RS3`);
  b.unit('res', { a: clk, b: `${p}ss2` }, `${p}RS4`);
  b.unit('npn', { c: `${p}sns`, b: `${p}ss1`, e: `${p}ssm1` }, `${p}QS2`);
  b.unit('npn', { c: `${p}ssm1`, b: `${p}ss2`, e: 'gnd' }, `${p}QS3`);
  b.unit('res', { a: 'vcc', b: `${p}sns` }, `${p}RS5`);
  b.unit('res', { a: `${p}snd`, b: `${p}ss3` }, `${p}RS6`);
  b.unit('res', { a: clk, b: `${p}ss4` }, `${p}RS7`);
  b.unit('npn', { c: `${p}snr`, b: `${p}ss3`, e: `${p}ssm2` }, `${p}QS4`);
  b.unit('npn', { c: `${p}ssm2`, b: `${p}ss4`, e: 'gnd' }, `${p}QS5`);
  b.unit('res', { a: 'vcc', b: `${p}snr` }, `${p}RS8`);
  b.unit('res', { a: `${p}sns`, b: `${p}sb1` }, `${p}RS9`);
  b.unit('res', { a: qn, b: `${p}sb2` }, `${p}RS10`);
  b.unit('npn', { c: q, b: `${p}sb1`, e: `${p}sm1` }, `${p}QS6`);
  b.unit('npn', { c: `${p}sm1`, b: `${p}sb2`, e: 'gnd' }, `${p}QS7`);
  b.unit('res', { a: 'vcc', b: q }, `${p}RS11`);
  b.unit('res', { a: `${p}snr`, b: `${p}sb3` }, `${p}RS12`);
  b.unit('res', { a: q, b: `${p}sb4` }, `${p}RS13`);
  b.unit('npn', { c: qn, b: `${p}sb3`, e: `${p}sm2` }, `${p}QS8`);
  b.unit('npn', { c: `${p}sm2`, b: `${p}sb4`, e: 'gnd' }, `${p}QS9`);
  b.unit('res', { a: 'vcc', b: qn }, `${p}RS14`);
}

/** 8 位寄存器参考解：d[7:0] 在 clk 上升沿锁存到 q[7:0]（8 个 D 触发器共用时钟） */
export function reg8Ref(id = 'ref-reg8'): Design {
  const b = new DesignBuilder(id, '8位寄存器');
  b.vcc('vcc');
  b.gnd('gnd');
  for (let i = 0; i < 8; i++) {
    dffInto(b, `f${i}`, 'clk', `d${i}`, `q${i}`, `qn${i}`);
  }
  b.port(
    'd',
    'in',
    Array.from({ length: 8 }, (_, i) => `d${i}`),
  );
  b.port('clk', 'in', 'clk');
  b.port(
    'q',
    'out',
    Array.from({ length: 8 }, (_, i) => `q${i}`),
  );
  return b.build();
}

/**
 * 两位 BCD → 二进制（拼装块）：bin = u + 8t + 2t（t = bcd[7:4] 十位，u = bcd[3:0] 个位）。
 * 第一级 5 位加法器 u + 2t；第二级 7 位加法器 s1 + 8t → bin[6:0]。
 */
export function bcd2binInto(
  b: DesignBuilder,
  p: string,
  t: string[],
  u: string[],
  bin: string[],
): void {
  // 2t：t 左移 1 位（bit i = t[i-1]；bit0 = 0）
  const t2 = Array.from({ length: 5 }, (_, i) => (i === 0 ? 'gnd' : (t[i - 1] as string)));
  // 第一级：s1 = u + t2（5 位，u+t2 ≤ 27 < 32 无溢出）
  const s1 = Array.from({ length: 5 }, (_, i) => `${p}s1${i}`);
  let carry = 'gnd';
  for (let i = 0; i < 5; i++) {
    const next = i === 4 ? `${p}c1` : `${p}c1${i}`;
    fullAdderInto(b, `${p}a${i}`, u[i] as string, t2[i] as string, carry, s1[i] as string, next);
    carry = next;
  }
  // 8t：t 左移 3 位（bit j = t[j-3]）
  const t8 = Array.from({ length: 7 }, (_, j) => (j < 3 ? 'gnd' : (t[j - 3] as string)));
  // 第二级：bin = s1 + t8（7 位，s1+t8 ≤ 99 = 0b1100011）
  carry = 'gnd';
  for (let i = 0; i < 7; i++) {
    const next = i === 6 ? `${p}c2` : `${p}c2${i}`;
    fullAdderInto(
      b,
      `${p}b${i}`,
      i < 5 ? (s1[i] as string) : 'gnd',
      t8[i] as string,
      carry,
      bin[i] as string,
      next,
    );
    carry = next;
  }
}

/** 两位 BCD → 二进制参考解：bcd[7:4] 十位、bcd[3:0] 个位 → bin[6:0] */
export function bcd2binRef(id = 'ref-bcd2bin'): Design {
  const b = new DesignBuilder(id, 'BCD→二进制');
  b.vcc('vcc');
  b.gnd('gnd');
  const t = Array.from({ length: 4 }, (_, i) => `bcd${i + 4}`);
  const u = Array.from({ length: 4 }, (_, i) => `bcd${i}`);
  const bin = Array.from({ length: 7 }, (_, i) => `bin${i}`);
  bcd2binInto(b, 'x', t, u, bin);
  b.port(
    'bcd',
    'in',
    Array.from({ length: 8 }, (_, i) => `bcd${i}`),
  );
  b.port('bin', 'out', bin);
  return b.build();
}

/**
 * double-dabble「加 3」单元（拼装块）：a ≥ 5 时输出 a + 3（= +0011），否则原样。
 * 门控：ge5 = a3∨(a2∧(a1∨a0))；y0 = a0⊕ge5；y1 = a1⊕(ge5·¬a0)；
 * c2 = ge5·(a1∨a0)；y2 = a2⊕c2；c3 = a2·c2；y3 = a3⊕c3。
 * （加 3 = bit0、bit1 各加 1：c1 = ge5·a0 是 bit0 进位；y1 的 ⊕ 项 = ge5⊕c1 = ge5·¬a0）
 */
export function plus3Into(b: DesignBuilder, p: string, a: string[], y: string[]): void {
  const notA1 = `${p}na1`;
  const notA0 = `${p}na0`;
  nandInto(b, `${p}na1`, a[1] as string, a[1] as string, notA1);
  nandInto(b, `${p}na0`, a[0] as string, a[0] as string, notA0);
  const o10 = `${p}o10`;
  nandInto(b, `${p}o10`, notA1, notA0, o10); // a1 ∨ a0
  const a20 = `${p}a20`;
  nandInto(b, `${p}a20`, a[2] as string, o10, a20); // ¬(a2∧(a1∨a0))
  const notA3 = `${p}na3`;
  nandInto(b, `${p}na3`, a[3] as string, a[3] as string, notA3);
  const ge5 = `${p}ge5`;
  nandInto(b, `${p}ge5b`, notA3, a20, ge5); // a3 ∨ (a2∧(a1∨a0))
  // y0 = a0 ⊕ ge5
  xorInto(b, `${p}y0`, a[0] as string, ge5, y[0] as string);
  // y1 = a1 ⊕ (ge5·¬a0)
  const t1 = `${p}t1`;
  const nt1 = `${p}nt1`;
  nandInto(b, `${p}t1`, ge5, notA0, nt1);
  nandInto(b, `${p}nt1`, nt1, nt1, t1);
  xorInto(b, `${p}y1`, a[1] as string, t1, y[1] as string);
  // c2 = ge5·(a1∨a0)
  const c2 = `${p}c2`;
  const nc2 = `${p}nc2`;
  nandInto(b, `${p}c2`, ge5, o10, nc2);
  nandInto(b, `${p}nc2`, nc2, nc2, c2);
  xorInto(b, `${p}y2`, a[2] as string, c2, y[2] as string);
  // c3 = a2·c2
  const c3 = `${p}c3`;
  const nc3 = `${p}nc3`;
  nandInto(b, `${p}c3`, a[2] as string, c2, nc3);
  nandInto(b, `${p}nc3`, nc3, nc3, c3);
  xorInto(b, `${p}y3`, a[3] as string, c3, y[3] as string);
}

/**
 * 二进制 → 两位 BCD（拼装块）：7 位 bin → 十位 t[3:0] + 个位 u[3:0]。
 * double-dabble 组合展开：7 次左移，每步先对个位/十位做「≥5 加 3」，再左移并入 1 位。
 * 移位用 net 共享（同名 net 直连），无缓冲元件。
 */
export function bin2bcdInto(
  b: DesignBuilder,
  p: string,
  bin: string[],
  t: string[],
  u: string[],
): void {
  let tens = Array.from({ length: 4 }, (_, i) => `${p}s0t${i}`);
  let ones = Array.from({ length: 4 }, (_, i) => `${p}s0u${i}`);
  // 初始全 0：net 经电阻拉低（弱 0；后续 plus3 强 1 驱动会覆盖）
  for (let i = 0; i < 4; i++) {
    b.unit('res', { a: 'gnd', b: tens[i] as string }, `${p}z${i}R`);
    b.unit('res', { a: 'gnd', b: ones[i] as string }, `${p}zy${i}R`);
  }
  for (let step = 0; step < 7; step++) {
    const st = `${p}s${step + 1}`;
    // 1) 对当前 ones/tens 做 ≥5 加 3
    const onesP = Array.from({ length: 4 }, (_, i) => `${st}u${i}`);
    const tensP = Array.from({ length: 4 }, (_, i) => `${st}t${i}`);
    plus3Into(b, `${st}u`, ones, onesP);
    plus3Into(b, `${st}t`, tens, tensP);
    // 2) 左移并入 bin[6-step]（net 共享：新 net 名 = 输入 net 名）
    const bit = bin[6 - step] as string;
    const nextOnes: string[] = [bit, onesP[0] as string, onesP[1] as string, onesP[2] as string];
    const nextTens: string[] = [
      onesP[3] as string,
      tensP[0] as string,
      tensP[1] as string,
      tensP[2] as string,
    ];
    tens = nextTens;
    ones = nextOnes;
  }
  // 输出（最后阶段的 net 直接接端口）
  for (let i = 0; i < 4; i++) {
    t[i] = tens[i] as string;
    u[i] = ones[i] as string;
  }
}

/** 二进制 → 两位 BCD 参考解：bin[6:0] → bcd[7:4] 十位、bcd[3:0] 个位 */
export function bin2bcdRef(id = 'ref-bin2bcd'): Design {
  const b = new DesignBuilder(id, '二进制→BCD');
  b.vcc('vcc');
  b.gnd('gnd');
  const bin = Array.from({ length: 7 }, (_, i) => `bin${i}`);
  const t = Array.from({ length: 4 }, (_, i) => `bcd${i + 4}`);
  const u = Array.from({ length: 4 }, (_, i) => `bcd${i}`);
  bin2bcdInto(b, 'x', bin, t, u);
  b.port('bin', 'in', bin);
  b.port('bcd', 'out', [...u, ...t]);
  return b.build();
}

/**
 * 简易计算器参考解（真实键盘版）：13 键（d0-d9、+、-、=、C）+ 两位数码管。
 *
 * 立即执行链式模型（运算符按下即结算）：
 *  - 编码器 → code[3:0]、any（任一键按下）；
 *  - 数字输入寄存器 ER：wr=any（数字键时钟）、fresh=¬E_in（换新载入）；
 *  - 运算控制（calcControlInto）：op_plus/op_minus/P/J/E_in 五个标志 + 累加器选择；
 *  - 累加器 ACC：op/= 边沿锁存 ALU 结果（a_src = (P∨J)?ACC:0，首运算 A=0+ER=ER）；
 *  - ALU：a_src/ER → bcd2bin ×2 → 加减（mode=op_minus，减法 = 补码+进位 1）→ bin2bcd；
 *  - 显示（calcDisplayInto）：E_in?ER:ACC → 2×七段译码器 → 负数（借位∧减法）显示 EE。
 */

/** 多输入或门（拼装块）：y = a0∨a1∨…（先逐项反相，再逐级 NAND 折叠，每步反相累积项） */
export function orNInto(b: DesignBuilder, p: string, terms: string[], y: string): void {
  if (terms.length === 0) return;
  const invs = terms.map((_, i) => `${p}i${i}`);
  terms.forEach((t, i) => {
    nandInto(b, `${p}ni${i}`, t, t, invs[i] as string);
  });
  let acc = invs[0] as string;
  for (let i = 1; i < invs.length; i++) {
    if (i > 1) {
      // 累积项反相：NAND(OR_{i-1}, OR_{i-1}) = ¬OR_{i-1}，再 NAND(¬OR_{i-1}, ¬t_i) = OR_{i-1}∨t_i
      const inv = `${p}w${i}`;
      nandInto(b, `${p}w${i}`, acc, acc, inv);
      acc = inv;
    }
    const next = i === invs.length - 1 ? y : `${p}o${i}`;
    nandInto(b, `${p}o${i}`, acc, invs[i] as string, next);
    acc = next;
  }
}

export interface CalcControlPins {
  aSrc: string[];
  accD: string[];
  accClk: string;
  erFresh: string;
  opMinus: string;
  ein: string;
  /** P∨J：有未结算的前值（a_src 选择 + 减法模式生效条件） */
  pending: string;
}

/**
 * 运算控制（拼装块）：五个标志 + 累加器选择。
 *  - op_plus/op_minus/P 用 clk1 = op∨eq∨c；J/E_in 用 clk2 = any∨op∨eq∨c；
 *  - a_src = (P∨J) ? ACC : 0（首运算 A=0，ALU 算 0+ER=ER）；
 *  - acc_d = (eq∨op) ? ALU : (c ? 0 : ACC)；
 *  - er_fresh = ¬E_in（换新载入）。
 */
export function calcControlInto(
  b: DesignBuilder,
  p: string,
  plus: string,
  minus: string,
  eq: string,
  c: string,
  any: string,
  acc: string[],
  alu: string[],
): CalcControlPins {
  const op = `${p}op`;
  const clk1 = `${p}clk1`;
  const clk2 = `${p}clk2`;
  const clkOpC = `${p}clkc`;
  orNInto(b, `${p}op`, [plus, minus], op);
  orNInto(b, `${p}cl1`, [op, eq, c], clk1);
  orNInto(b, `${p}cl2`, [any, op, eq, c], clk2);
  // op_minus 只被「新运算 / C」改写：= 提交结果后仍需保留减法模式（负结果判定）
  orNInto(b, `${p}clc`, [op, c], clkOpC);
  const opPlus = `${p}opp`;
  const opMinus = `${p}opm`;
  const pn = `${p}p`;
  const j = `${p}j`;
  const ein = `${p}ein`;
  dffInto(b, `${p}Fop+`, clk1, plus, opPlus, `${p}nop+`);
  dffInto(b, `${p}Fop-`, clkOpC, minus, opMinus, `${p}nop-`);
  dffInto(b, `${p}Fp`, clk1, op, pn, `${p}np`);
  dffInto(b, `${p}Fj`, clk2, eq, j, `${p}nj`);
  dffInto(b, `${p}Fe`, clk2, any, ein, `${p}ne`);
  // a_src = (P∨J) ? ACC : 0 → ACC ∧ (P∨J)
  const sel = `${p}sel`;
  orNInto(b, `${p}sel`, [pn, j], sel);
  const aSrc = Array.from({ length: 8 }, (_, i) => `${p}as${i}`);
  for (let i = 0; i < 8; i++) {
    const t = `${p}asn${i}`;
    nandInto(b, `${p}asA${i}`, acc[i] as string, sel, t);
    nandInto(b, `${p}asB${i}`, t, t, aSrc[i] as string);
  }
  // acc_d = (eq∨op) ? ALU : (c ? 0 : ACC) = (eq∨op) ? ALU : ACC∧¬c
  // 注：不在 op 沿做「= 后抑制重算」（J 抑制）——给 J 标志加 9 个负载会破坏
  // 弱信号下主从触发器的从锁收敛（J 卡在上电 1 清不掉）；「= 后直接 op」按
  // 立即执行模型用旧操作数重算（简化语义，向量不覆盖该链）。
  const sel1 = `${p}sel1`;
  const nsel1 = `${p}nsel1`;
  const nc = `${p}nc`;
  orNInto(b, `${p}sel1`, [eq, op], sel1);
  nandInto(b, `${p}ns1`, sel1, sel1, nsel1);
  nandInto(b, `${p}nc`, c, c, nc);
  const accD = Array.from({ length: 8 }, (_, i) => `${p}ad${i}`);
  for (let i = 0; i < 8; i++) {
    const inner = `${p}in${i}`;
    const inn = `${p}inn${i}`;
    nandInto(b, `${p}inA${i}`, acc[i] as string, nc, inn);
    nandInto(b, `${p}inB${i}`, inn, inn, inner);
    const t1 = `${p}ad1${i}`;
    const t2 = `${p}ad2${i}`;
    nandInto(b, `${p}adA${i}`, alu[i] as string, sel1, t1);
    nandInto(b, `${p}adB${i}`, inner, nsel1, t2);
    nandInto(b, `${p}adC${i}`, t1, t2, accD[i] as string);
  }
  // 累加器时钟延迟：accD（按钮→mux ≈ 4-5 级门）必须比 acc_clk（按钮→orN ≈ 2-3 级门）
  // 先稳定（建立时间）。给 acc_clk 加 10 级反相器（偶数，极性不变，≈15us），
  // 保证 op/eq/c 沿上 accD 已稳定、主锁存器采到正确值（否则会采到旧 ACC）。
  const accClk = `${p}ack`;
  let d = clk1;
  for (let i = 0; i < 10; i++) {
    const next = i === 9 ? accClk : `${p}ak${i}d`;
    nandInto(b, `${p}ak${i}`, d, d, next);
    d = next;
  }
  const erFresh = `${p}fr`;
  nandInto(b, `${p}fr`, ein, ein, erFresh);
  return { aSrc, accD, accClk, erFresh, opMinus, ein, pending: sel };
}

/**
 * 显示控制（拼装块）：显示源 E_in?ER:ACC（8 位 mux）+ 负数 EE 覆写。
 *  - err = neg ∧ ¬ein（neg = 上次 = 的借位锁存标志；只覆盖「显示结果」——输入数字时显示 ER）；
 *  - E 段码 0x79（a,d,e,f,g 亮 / b,c 灭）：亮段 = dec∨err，灭段 = dec∧¬err。
 */
export function calcDisplayInto(
  b: DesignBuilder,
  p: string,
  ein: string,
  er: string[],
  acc: string[],
  neg: string,
  decT: string[],
  decU: string[],
  disp: string[],
  segT: string[],
  segU: string[],
): void {
  const nein = `${p}nein`;
  nandInto(b, `${p}nein`, ein, ein, nein);
  for (let i = 0; i < 8; i++) {
    const t1 = `${p}dm1${i}`;
    const t2 = `${p}dm2${i}`;
    nandInto(b, `${p}dmA${i}`, er[i] as string, ein, t1);
    nandInto(b, `${p}dmB${i}`, acc[i] as string, nein, t2);
    nandInto(b, `${p}dmC${i}`, t1, t2, disp[i] as string);
  }
  const err = `${p}err`;
  const errn = `${p}errn`;
  // err = neg ∧ ¬ein
  nandInto(b, `${p}errA`, neg, nein, errn);
  nandInto(b, `${p}errB`, errn, errn, err);
  const nerr = `${p}nerr`;
  nandInto(b, `${p}nerr`, err, err, nerr);
  // E 段码 0x79：a(0),d(3),e(4),f(5),g(6) 亮；b(1),c(2) 灭
  const E_ON = [0, 3, 4, 5, 6];
  for (let k = 0; k < 2; k++) {
    const dec = k === 0 ? decT : decU;
    const seg = k === 0 ? segT : segU;
    for (let i = 0; i < 7; i++) {
      if (E_ON.includes(i)) {
        // seg = dec ∨ err = NAND(¬dec, ¬err)
        const nd = `${p}e${k}nd${i}`;
        nandInto(b, `${p}e${k}na${i}`, dec[i] as string, dec[i] as string, nd);
        nandInto(b, `${p}e${k}nb${i}`, nd, nerr, seg[i] as string);
      } else {
        // seg = dec ∧ ¬err
        const t = `${p}e${k}nt${i}`;
        nandInto(b, `${p}e${k}na${i}`, dec[i] as string, nerr, t);
        nandInto(b, `${p}e${k}nb${i}`, t, t, seg[i] as string);
      }
    }
  }
}

/**
 * 简易计算器参考解（键盘版）：13 键 + 两位数码管（立即执行链式模型）。
 */
export function calcRef(id = 'ref-calc'): Design {
  const b = new DesignBuilder(id, '简易计算器');
  b.vcc('vcc');
  b.gnd('gnd');
  const keys = Array.from({ length: 10 }, (_, i) => `d${i}`);
  const code = Array.from({ length: 4 }, (_, i) => `code${i}`);
  const any = 'any';
  encoderInto(b, 'E', keys, code, any);
  const er = Array.from({ length: 8 }, (_, i) => `er${i}`);
  const acc = Array.from({ length: 8 }, (_, i) => `acc${i}`);
  const sum = Array.from({ length: 8 }, (_, i) => `sum${i}`);
  // 1) bin2bcd 先建：t/u 数组被 bin2bcdInto 改写为内部网名（alu = bin2bcd 输出）
  const t = Array.from({ length: 4 }, (_, i) => `t${i}`);
  const u = Array.from({ length: 4 }, (_, i) => `u${i}`);
  bin2bcdInto(b, 'R', [sum[0], sum[1], sum[2], sum[3], sum[4], sum[5], sum[6]], t, u);
  const alu = [...u, ...t];
  // 2) 运算控制（net 只是名字，循环依赖靠命名解析）
  const ctrl = calcControlInto(b, 'C', 'plus', 'minus', 'eq', 'c', any, acc, alu);
  // 3) 输入寄存器：wr = any 经 4 级反相延迟（约 +6us）——给 DFF 更多建立时间，
  //    且仍早于 ein 更新（~13us）→ fresh 不被破坏
  const anyD = 'anyD';
  let ad0 = any;
  for (let i = 0; i < 4; i++) {
    const next = i === 3 ? anyD : `anyd${i}`;
    nandInto(b, `AD${i}`, ad0, ad0, next);
    ad0 = next;
  }
  digitEntryInto(b, 'D', code, anyD, ctrl.erFresh, er);
  // 4) 累加器：8 个 D 触发器（clk = acc_clk）
  for (let i = 0; i < 8; i++) {
    dffInto(b, `r${i}`, ctrl.accClk, ctrl.accD[i] as string, acc[i] as string, `qn${i}`);
  }
  // 5) ALU：a_src、er（BCD）→ 二进制 → 加减 → 写入 sum（bin2bcd 已在 1) 读取）
  const aBin = Array.from({ length: 7 }, (_, i) => `aBin${i}`);
  const bBin = Array.from({ length: 7 }, (_, i) => `bBin${i}`);
  bcd2binInto(
    b,
    'A',
    [
      ctrl.aSrc[4] as string,
      ctrl.aSrc[5] as string,
      ctrl.aSrc[6] as string,
      ctrl.aSrc[7] as string,
    ],
    [
      ctrl.aSrc[0] as string,
      ctrl.aSrc[1] as string,
      ctrl.aSrc[2] as string,
      ctrl.aSrc[3] as string,
    ],
    aBin,
  );
  bcd2binInto(
    b,
    'B',
    [er[4] as string, er[5] as string, er[6] as string, er[7] as string],
    [er[0] as string, er[1] as string, er[2] as string, er[3] as string],
    bBin,
  );
  // 减法：b_i ⊕ mode，进位 1。mode = op_minus ∧ pending —— 首运算没有前值（pending=0），
  // 按「载入 ER」处理（0+ER=ER），减法从第二个运算起生效。
  const mode = 'mode';
  const moder = 'moder';
  nandInto(b, 'M1', ctrl.opMinus, ctrl.pending, moder);
  nandInto(b, 'M2', moder, moder, mode);
  const bx = Array.from({ length: 7 }, (_, i) => `bx${i}`);
  for (let i = 0; i < 7; i++) xorInto(b, `X${i}`, bBin[i] as string, mode, bx[i] as string);
  let carry = mode;
  const borrowRaw = 'borrowRaw';
  for (let i = 0; i < 8; i++) {
    const next = i === 7 ? borrowRaw : `sumc${i}`;
    fullAdderInto(
      b,
      `S${i}`,
      i < 7 ? (aBin[i] as string) : 'gnd',
      i < 7 ? (bx[i] as string) : mode,
      carry,
      sum[i] as string,
      next,
    );
    carry = next;
  }
  // 借位 = ¬第 8 位进位（两补码减法：a-b 借位当且仅当进位输出为 0）
  const borrow = 'borrow';
  nandInto(b, 'BR1', borrowRaw, borrowRaw, borrow);
  // NEG 标志：= / op / C 沿上锁存 borrow∧op_minus∧¬c —— 结果的负性在 = 时刻定格，
  // 之后 a_src 重算（截断 BCD）不会再翻转 EE 判定
  const ncNeg = 'ncNeg';
  const negClk = 'negClk';
  const negD1 = 'negD1';
  const negD2 = 'negD2';
  const negD3 = 'negD3';
  nandInto(b, 'N1', 'c', 'c', ncNeg);
  nandInto(b, 'N2', borrow, ctrl.opMinus, negD1);
  nandInto(b, 'N3', negD1, negD1, negD2);
  nandInto(b, 'N4', negD2, ncNeg, negD3);
  nandInto(b, 'N5', negD3, negD3, 'negD');
  orNInto(b, 'N6', ['eq', 'plus', 'minus', 'c'], negClk);
  dffInto(b, 'Neg', negClk, 'negD', 'neg', 'nneg');
  // 6) 显示：E_in?ER:ACC → 2×七段译码器 → 负数 EE 覆写
  const disp = Array.from({ length: 8 }, (_, i) => `disp${i}`);
  const decT = Array.from({ length: 7 }, (_, i) => `decT${i}`);
  const decU = Array.from({ length: 7 }, (_, i) => `decU${i}`);
  const segT = Array.from({ length: 7 }, (_, i) => `segT${i}`);
  const segU = Array.from({ length: 7 }, (_, i) => `segU${i}`);
  seg7Into(
    b,
    'T',
    disp[4] as string,
    disp[5] as string,
    disp[6] as string,
    disp[7] as string,
    decT,
  );
  seg7Into(
    b,
    'U',
    disp[0] as string,
    disp[1] as string,
    disp[2] as string,
    disp[3] as string,
    decU,
  );
  calcDisplayInto(b, 'V', ctrl.ein, er, acc, 'neg', decT, decU, disp, segT, segU);
  for (let i = 0; i < 10; i++) b.port(`d${i}`, 'in', `d${i}`);
  b.port('plus', 'in', 'plus');
  b.port('minus', 'in', 'minus');
  b.port('eq', 'in', 'eq');
  b.port('c', 'in', 'c');
  b.port('disp_t', 'out', segT);
  b.port('disp_u', 'out', segU);
  return b.build();
}

/**
 * 数码管显示参考解：2 位数码管 = 2× 七段译码器模块（复用玩家自己的译码器）。
 * 顶层只有 2 个模块实例，成本 2×860 = 1720。模块引用教学积木「七段译码器」的内容哈希
 * （hash 内容稳定）；玩家在 s3-display 用门版答案通关封装出的译码器与此同结构同哈希。
 */
export function seg7x2Ref(id = 'ref-s3-display2'): Design {
  const b = new DesignBuilder(id, '数码管显示');
  const seg7 = hashOf('七段译码器', 'rtl');
  const t = Array.from({ length: 4 }, (_, i) => `t${i}`); // 十位 bcd
  const u = Array.from({ length: 4 }, (_, i) => `u${i}`); // 个位 bcd
  const ten = Array.from({ length: 7 }, (_, i) => `seg1${i}`);
  const one = Array.from({ length: 7 }, (_, i) => `seg2${i}`);
  b.module(seg7, { bcd: t, seg: ten }, 'D1');
  b.module(seg7, { bcd: u, seg: one }, 'D2');
  b.port('bcd1', 'in', t);
  b.port('bcd2', 'in', u);
  b.port('seg1', 'out', ten);
  b.port('seg2', 'out', one);
  return b.build();
}
