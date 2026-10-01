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
import { fullAdderInto, nandInto, xorInto } from './references-ari.js';

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

/** 数码管显示参考解：val[6:0]（0-99 二进制）→ 十位/个位两位 BCD，喂给七段数码管端口。成本与 bin2bcd 相同（7872）。 */
export function displayRef(id = 'ref-display'): Design {
  const b = new DesignBuilder(id, '数码管显示');
  b.vcc('vcc');
  b.gnd('gnd');
  const val = Array.from({ length: 7 }, (_, i) => `val${i}`);
  const t = Array.from({ length: 4 }, (_, i) => `t${i}`);
  const u = Array.from({ length: 4 }, (_, i) => `u${i}`);
  bin2bcdInto(b, 'x', val, t, u);
  b.port('val', 'in', val);
  b.port('disp_t', 'out', t);
  b.port('disp_u', 'out', u);
  return b.build();
}

/** 简易计算器参考解（高成本版）：eq 上升沿把 a+b（BCD）锁存到显示 */
export function calcRef(id = 'ref-calc'): Design {
  const b = new DesignBuilder(id, '简易计算器');
  b.vcc('vcc');
  b.gnd('gnd');
  // a、b（BCD 8 位）→ 二进制 7 位
  const aT = Array.from({ length: 4 }, (_, i) => `a${i + 4}`);
  const aU = Array.from({ length: 4 }, (_, i) => `a${i}`);
  const bT = Array.from({ length: 4 }, (_, i) => `b${i + 4}`);
  const bU = Array.from({ length: 4 }, (_, i) => `b${i}`);
  const aBin = Array.from({ length: 7 }, (_, i) => `aBin${i}`);
  const bBin = Array.from({ length: 7 }, (_, i) => `bBin${i}`);
  bcd2binInto(b, 'a', aT, aU, aBin);
  bcd2binInto(b, 'b', bT, bU, bBin);
  // 8 位二进制加法 aBin + bBin → sum[7:0]（向量约束 a+b ≤ 99，第 8 位恒 0）
  const sum = Array.from({ length: 8 }, (_, i) => `sum${i}`);
  let carry = 'gnd';
  for (let i = 0; i < 8; i++) {
    const next = i === 7 ? 'sumc' : `sumc${i}`;
    fullAdderInto(
      b,
      `s${i}`,
      i < 7 ? (aBin[i] as string) : 'gnd',
      i < 7 ? (bBin[i] as string) : 'gnd',
      carry,
      sum[i] as string,
      next,
    );
    carry = next;
  }
  // sum → BCD（十位/个位）
  const t = Array.from({ length: 4 }, (_, i) => `t${i}`);
  const u = Array.from({ length: 4 }, (_, i) => `u${i}`);
  bin2bcdInto(b, 'c', sum, t, u);
  // eq 上升沿锁存到 8 位寄存器（d = {u[3:0], t[3:0]}）
  const dIn = Array.from({ length: 8 }, (_, i) =>
    i < 4 ? (u[i] as string) : (t[i - 4] as string),
  );
  for (let i = 0; i < 8; i++) {
    dffInto(b, `r${i}`, 'eq', dIn[i] as string, `q${i}`, `qn${i}`);
  }
  b.port(
    'a',
    'in',
    Array.from({ length: 8 }, (_, i) => `a${i}`),
  );
  b.port(
    'b',
    'in',
    Array.from({ length: 8 }, (_, i) => `b${i}`),
  );
  b.port('eq', 'in', 'eq');
  b.port(
    'disp_t',
    'out',
    Array.from({ length: 4 }, (_, i) => `q${i + 4}`),
  );
  b.port(
    'disp_u',
    'out',
    Array.from({ length: 4 }, (_, i) => `q${i}`),
  );
  return b.build();
}
