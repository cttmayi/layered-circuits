/**
 * 计算器键盘部件参考解（GDD 阶段 3.5 计算器链新增）：
 *  - encoderOr：数字键盘编码器参考解（s3-encoder 关）——10 个数字键（d0..d9，一次按一个）
 *    → 4 位 BCD 码 + 任意键脉冲（any = d0∨…∨d9）。纯组合 or 矩阵（教学正道）：
 *    bit0 = d1∨d3∨d5∨d7∨d9、bit1 = d2∨d3∨d6∨d7、bit2 = d4∨d5∨d6∨d7、
 *    bit3 = d8∨d9（一次只按一键 → 无需优先仲裁，直接 OR）。
 *    结构 = 6 个 or4 单元 + 2 个 or2 单元（每单元 = N 个二极管 + 1 下拉），与门版
 *    【多输入或门】【或门】积木同构：成本 8×res + 28×dio = 88 半分。
 *  - encoderInto：calcRef 内部用的 45 与非门版（输出可级联、纯元件），成本 900。
 *  - digitEntry：数字输入寄存器 —— wr 上升沿把 4 位 BCD 数字码「左移一位插入」：
 *    q ← {旧个位, 新数字}（q = (q<<4 & 0xFF) | d，两位封顶滚动）。8 个主从 D 触发器，
 *    十位 D = 旧个位 Q（回接），个位 D = 数字码。成本 8×196 = 1568。
 *
 * 拼装块：dffInto（来自 references-calc）、nandInto（来自 references-ari）。
 */

import { type Design, DesignBuilder } from '@lc/schema';
import { nandInto } from './references-ari.js';
import { dffInto } from './references-calc.js';

/** 多输入 OR（全与非门，输出可级联）：内部网名用计数器保证唯一 */
function orNInto(
  b: DesignBuilder,
  p: string,
  terms: string[],
  out: string,
): void {
  let orn = 0;
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
}

/**
 * 数字键盘编码器：d[0..9]（一键高）→ code[3:0]（BCD，小端）+ any（任意键高）。
 */
export function encoderInto(
  b: DesignBuilder,
  p: string,
  d: string[], // d[0..9]
  code: string[], // code[0..3]
  any: string,
): void {
  // 每键一个反相器（各 OR 链共享；OR 链的输入必须是反相信号：NAND(¬p1,¬p2)=p1∨p2）
  const nd = d.map((_, i) => `${p}nd${i}`);
  d.forEach((di, i) => nandInto(b, `${p}i${i}`, di, di, nd[i] as string));
  // bit3 = d8∨d9
  orNInto(b, `${p}3`, [nd[8] as string, nd[9] as string], code[3] as string);
  // bit2 = d4∨d5∨d6∨d7
  orNInto(b, `${p}2`, [nd[4] as string, nd[5] as string, nd[6] as string, nd[7] as string], code[2] as string);
  // bit1 = d2∨d3∨d6∨d7
  orNInto(b, `${p}1`, [nd[2] as string, nd[3] as string, nd[6] as string, nd[7] as string], code[1] as string);
  // bit0 = d1∨d3∨d5∨d7∨d9
  orNInto(b, `${p}0`, [nd[1] as string, nd[3] as string, nd[5] as string, nd[7] as string, nd[9] as string], code[0] as string);
  // any = d0∨…∨d9
  orNInto(b, `${p}A`, nd, any);
}

/**
 * or 矩阵版编码器参考解（s3-encoder 关）：d0..d9 → code[3:0]、any。
 * 结构 = 6 个 or4 单元 + 2 个 or2 单元（每单元 N 个二极管 + 1 下拉），与门版
 * 【多输入或门】【或门】积木完全同构：成本 8×res + 28×dio = 88 半分。
 */
export function encoderOrRef(id = 'ref-s3-encoder'): Design {
  const b = new DesignBuilder(id, '数字键盘编码器');
  b.gnd('gnd');
  const d = Array.from({ length: 10 }, (_, i) => `d${i}`);
  let n = 0;
  const orN = (terms: string[]): string => {
    if (terms.length === 1) return terms[0] as string;
    if (terms.length <= 4) {
      const o = `o${n}`;
      b.unit('res', { a: o, b: 'gnd' }, `R${n}`);
      terms.forEach((t, i) => b.unit('dio', { a: t, k: o }, `D${n}_${i}`));
      n++;
      return o;
    }
    return orN([orN(terms.slice(0, 4)), ...terms.slice(4)]);
  };
  const code = [
    orN([d[1], d[3], d[5], d[7], d[9]]),
    orN([d[2], d[3], d[6], d[7]]),
    orN([d[4], d[5], d[6], d[7]]),
    orN([d[8], d[9]]),
  ];
  const any = orN(d);
  for (let i = 0; i < 10; i++) b.port(`d${i}`, 'in', d[i]);
  b.port('code', 'out', code);
  b.port('any', 'out', any);
  return b.build();
}

/**
 * 数字输入寄存器：wr 上升沿 q ← {旧个位, d[3:0]}（左移一位 BCD 插入，两位封顶滚动）；
 * fresh=1（换新载入）：q ← {0, d}（十位钳 0，只进个位——计算器按运算符/等号后，
 * 新输入从零开始）。十位 D = 旧个位 ∧ ¬fresh（与门钳位）。
 * 为什么不是「clr 清零」：清零的 D（数据∧¬clr）在时钟沿才变 0，主锁存器会采到旧数据（竞态）；
 * fresh 的 D 在沿前已是 0（换新语义本身就是 0），捕获值天然正确，无竞态。
 * 成本：8×196 + 8×与门 + 1×非门 ≈ 1908。
 */
export function digitEntryInto(
  b: DesignBuilder,
  p: string,
  d: string[], // d[0..3]
  wr: string,
  fresh: string,
  q: string[], // q[0..7]（小端：q[0..3] 个位、q[4..7] 十位）
): void {
  const nfr = `${p}nfr`;
  nandInto(b, `${p}nf`, fresh, fresh, nfr); // ¬fresh
  for (let i = 0; i < 4; i++) {
    // 个位：锁存新数字码
    dffInto(b, `${p}U${i}`, wr, d[i] as string, q[i] as string, `${p}qnu${i}`);
    // 十位：D = 旧个位 ∧ ¬fresh（fresh=1 时进 0）
    const dt = `${p}dt${i}`;
    nandInto(b, `${p}dtA${i}`, q[i] as string, nfr, `${p}dtt${i}`);
    nandInto(b, `${p}dtB${i}`, `${p}dtt${i}`, `${p}dtt${i}`, dt);
    dffInto(b, `${p}T${i}`, wr, dt, q[4 + i] as string, `${p}qnt${i}`);
  }
}

/** 数字输入寄存器参考解：d[3:0]、wr、fresh → q[7:0]（成本 1908） */
export function digitEntryRef(id: string): Design {
  const b = new DesignBuilder(id, '数字输入寄存器');
  b.vcc('vcc');
  b.gnd('gnd');
  const d = Array.from({ length: 4 }, (_, i) => `d${i}`);
  const q = Array.from({ length: 8 }, (_, i) => `q${i}`);
  digitEntryInto(b, 'K', d, 'wr', 'fresh', q);
  b.port('d', 'in', d);
  b.port('wr', 'in', 'wr');
  b.port('fresh', 'in', 'fresh');
  b.port('q', 'out', q);
  return b.build();
}
