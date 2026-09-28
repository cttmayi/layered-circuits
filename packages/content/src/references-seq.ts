/**
 * 阶段 2 的时序单元参考解（也是关卡最优成本的依据）。
 *
 * 三个单元本质上是同一个故事的三步：
 *  1. 两个与非门交叉耦合 → 能记住 1 个比特（SR 锁存器）；
 *  2. 前面加两个「门控」与非门 → 由使能端决定什么时候记（D 锁存器）；
 *  3. 两个锁存器一主一从、使能互补 → 只在时钟沿记一次，消除空翻（D 触发器）。
 */

import { type Design, DesignBuilder } from '@lc/schema';

/**
 * 与非门 SR 锁存器（低有效置位/复位 sn、rn），成本 14。
 * 输出 q / qn 互补。
 */
export function srLatchRef(id = 'ref-sr'): Design {
  const b = new DesignBuilder(id, 'SR锁存器');
  b.vcc('vcc');
  b.gnd('gnd');
  // 与非门 1：输入 sn 与 qn → 输出 q
  b.unit('res', { a: 'sn', b: 'b1' }, 'R1');
  b.unit('res', { a: 'qn', b: 'b2' }, 'R2');
  b.unit('npn', { c: 'q', b: 'b1', e: 'm1' }, 'Q1');
  b.unit('npn', { c: 'm1', b: 'b2', e: 'gnd' }, 'Q2');
  b.unit('res', { a: 'vcc', b: 'q' }, 'R3');
  // 与非门 2：输入 rn 与 q → 输出 qn
  b.unit('res', { a: 'rn', b: 'b3' }, 'R4');
  b.unit('res', { a: 'q', b: 'b4' }, 'R5');
  b.unit('npn', { c: 'qn', b: 'b3', e: 'm2' }, 'Q3');
  b.unit('npn', { c: 'm2', b: 'b4', e: 'gnd' }, 'Q4');
  b.unit('res', { a: 'vcc', b: 'qn' }, 'R6');
  b.port('sn', 'in', 'sn');
  b.port('rn', 'in', 'rn');
  b.port('q', 'out', 'q');
  b.port('qn', 'out', 'qn');
  return b.build();
}

/**
 * 门控 D 锁存器（d + en → q），成本 32：
 * 一个单管反相器造出 d̄，两个与非门做门控，两个与非门做锁存。
 * en=1 时透明（q 跟 d），en=0 时保持。
 */
export function dLatchRef(
  id = 'ref-dlatch',
  opts: { label?: string; suffix?: string } = {},
): Design {
  const s = opts.suffix ?? '';
  const b = new DesignBuilder(id, opts.label ?? 'D锁存器');
  b.vcc('vcc');
  b.gnd('gnd');
  // 反相器：d → nd
  b.unit('res', { a: `d${s}`, b: `nb1${s}` }, `R1${s}`);
  b.unit('npn', { c: `nd${s}`, b: `nb1${s}`, e: 'gnd' }, `Q1${s}`);
  b.unit('res', { a: 'vcc', b: `nd${s}` }, `R2${s}`);
  // 门控：ns = NAND(d, en)，nr = NAND(nd, en)
  b.unit('res', { a: `d${s}`, b: `s1${s}` }, `R3${s}`);
  b.unit('res', { a: `en${s}`, b: `s2${s}` }, `R4${s}`);
  b.unit('npn', { c: `ns${s}`, b: `s1${s}`, e: `sm1${s}` }, `Q2${s}`);
  b.unit('npn', { c: `sm1${s}`, b: `s2${s}`, e: 'gnd' }, `Q3${s}`);
  b.unit('res', { a: 'vcc', b: `ns${s}` }, `R5${s}`);
  b.unit('res', { a: `nd${s}`, b: `s3${s}` }, `R6${s}`);
  b.unit('res', { a: `en${s}`, b: `s4${s}` }, `R7${s}`);
  b.unit('npn', { c: `nr${s}`, b: `s3${s}`, e: `sm2${s}` }, `Q4${s}`);
  b.unit('npn', { c: `sm2${s}`, b: `s4${s}`, e: 'gnd' }, `Q5${s}`);
  b.unit('res', { a: 'vcc', b: `nr${s}` }, `R8${s}`);
  // 锁存：q = NAND(ns, qn)，qn = NAND(nr, q)
  b.unit('res', { a: `ns${s}`, b: `b1${s}` }, `R9${s}`);
  b.unit('res', { a: `qn${s}`, b: `b2${s}` }, `R10${s}`);
  b.unit('npn', { c: `q${s}`, b: `b1${s}`, e: `m1${s}` }, `Q6${s}`);
  b.unit('npn', { c: `m1${s}`, b: `b2${s}`, e: 'gnd' }, `Q7${s}`);
  b.unit('res', { a: 'vcc', b: `q${s}` }, `R11${s}`);
  b.unit('res', { a: `nr${s}`, b: `b3${s}` }, `R12${s}`);
  b.unit('res', { a: `q${s}`, b: `b4${s}` }, `R13${s}`);
  b.unit('npn', { c: `qn${s}`, b: `b3${s}`, e: `m2${s}` }, `Q8${s}`);
  b.unit('npn', { c: `m2${s}`, b: `b4${s}`, e: 'gnd' }, `Q9${s}`);
  b.unit('res', { a: 'vcc', b: `qn${s}` }, `R14${s}`);
  b.port('d', 'in', `d${s}`);
  b.port('en', 'in', `en${s}`);
  b.port('q', 'out', `q${s}`);
  return b.build();
}

/**
 * 主从 D 触发器（上升沿），成本 68：
 * 主锁存器在 clk=0 时透明（先存下来），从锁存器在 clk=1 时透明（把主的值送出去），
 * 于是数据只在时钟上升沿被整体搬运一次 —— 高电平期间改数据不会串到输出（无空翻）。
 */
export function dffRef(id = 'ref-dff'): Design {
  const b = new DesignBuilder(id, 'D触发器');
  b.vcc('vcc');
  b.gnd('gnd');
  // 时钟反相器：clk → nclk（单管反相器，成本 4）
  b.unit('res', { a: 'clk', b: 'cb1' }, 'RC1');
  b.unit('npn', { c: 'nclk', b: 'cb1', e: 'gnd' }, 'QC1');
  b.unit('res', { a: 'vcc', b: 'nclk' }, 'RC2');
  // 主锁存器：d，使能 nclk → m
  b.unit('res', { a: 'd', b: 'mnb1' }, 'RM1');
  b.unit('npn', { c: 'mnd', b: 'mnb1', e: 'gnd' }, 'QM1');
  b.unit('res', { a: 'vcc', b: 'mnd' }, 'RM2');
  b.unit('res', { a: 'd', b: 'ms1' }, 'RM3');
  b.unit('res', { a: 'nclk', b: 'ms2' }, 'RM4');
  b.unit('npn', { c: 'mns', b: 'ms1', e: 'msm1' }, 'QM2');
  b.unit('npn', { c: 'msm1', b: 'ms2', e: 'gnd' }, 'QM3');
  b.unit('res', { a: 'vcc', b: 'mns' }, 'RM5');
  b.unit('res', { a: 'mnd', b: 'ms3' }, 'RM6');
  b.unit('res', { a: 'nclk', b: 'ms4' }, 'RM7');
  b.unit('npn', { c: 'mnr', b: 'ms3', e: 'msm2' }, 'QM4');
  b.unit('npn', { c: 'msm2', b: 'ms4', e: 'gnd' }, 'QM5');
  b.unit('res', { a: 'vcc', b: 'mnr' }, 'RM8');
  b.unit('res', { a: 'mns', b: 'mb1' }, 'RM9');
  b.unit('res', { a: 'mqn', b: 'mb2' }, 'RM10');
  b.unit('npn', { c: 'm', b: 'mb1', e: 'mm1' }, 'QM6');
  b.unit('npn', { c: 'mm1', b: 'mb2', e: 'gnd' }, 'QM7');
  b.unit('res', { a: 'vcc', b: 'm' }, 'RM11');
  b.unit('res', { a: 'mnr', b: 'mb3' }, 'RM12');
  b.unit('res', { a: 'm', b: 'mb4' }, 'RM13');
  b.unit('npn', { c: 'mqn', b: 'mb3', e: 'mm2' }, 'QM8');
  b.unit('npn', { c: 'mm2', b: 'mb4', e: 'gnd' }, 'QM9');
  b.unit('res', { a: 'vcc', b: 'mqn' }, 'RM14');
  // 从锁存器：m，使能 clk → q
  b.unit('res', { a: 'm', b: 'snb1' }, 'RS1');
  b.unit('npn', { c: 'snd', b: 'snb1', e: 'gnd' }, 'QS1');
  b.unit('res', { a: 'vcc', b: 'snd' }, 'RS2');
  b.unit('res', { a: 'm', b: 'ss1' }, 'RS3');
  b.unit('res', { a: 'clk', b: 'ss2' }, 'RS4');
  b.unit('npn', { c: 'sns', b: 'ss1', e: 'ssm1' }, 'QS2');
  b.unit('npn', { c: 'ssm1', b: 'ss2', e: 'gnd' }, 'QS3');
  b.unit('res', { a: 'vcc', b: 'sns' }, 'RS5');
  b.unit('res', { a: 'snd', b: 'ss3' }, 'RS6');
  b.unit('res', { a: 'clk', b: 'ss4' }, 'RS7');
  b.unit('npn', { c: 'snr', b: 'ss3', e: 'ssm2' }, 'QS4');
  b.unit('npn', { c: 'ssm2', b: 'ss4', e: 'gnd' }, 'QS5');
  b.unit('res', { a: 'vcc', b: 'snr' }, 'RS8');
  b.unit('res', { a: 'sns', b: 'sb1' }, 'RS9');
  b.unit('res', { a: 'sqn', b: 'sb2' }, 'RS10');
  b.unit('npn', { c: 'q', b: 'sb1', e: 'sm1' }, 'QS6');
  b.unit('npn', { c: 'sm1', b: 'sb2', e: 'gnd' }, 'QS7');
  b.unit('res', { a: 'vcc', b: 'q' }, 'RS11');
  b.unit('res', { a: 'snr', b: 'sb3' }, 'RS12');
  b.unit('res', { a: 'q', b: 'sb4' }, 'RS13');
  b.unit('npn', { c: 'sqn', b: 'sb3', e: 'sm2' }, 'QS8');
  b.unit('npn', { c: 'sm2', b: 'sb4', e: 'gnd' }, 'QS9');
  b.unit('res', { a: 'vcc', b: 'sqn' }, 'RS14');
  b.port('d', 'in', 'd');
  b.port('clk', 'in', 'clk');
  b.port('q', 'out', 'q');
  b.port('qn', 'out', 'sqn');
  return b.build();
}
