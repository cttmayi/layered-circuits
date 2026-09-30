/**
 * 阶段 1 的逻辑门参考解（也是关卡的最优成本依据）。
 *
 * 每个门都用「最省的基础元件」搭出来，刻意体现本作的核心取舍：
 *  - 单管共射反相器（1 三极管 + 2 电阻 = 成本 4）最省，但输出高电平是**弱 1**；
 *  - 加一级射极跟随器（2 三极管 + 3 电阻 = 成本 7）得到**强 1**，扇出更强、更适合级联。
 * 二极管逻辑（2 二极管 + 1 电阻 = 成本 4）是搭与门/或门最便宜的办法，代价是单向导通带来的电平损失。
 */

import { type Design, DesignBuilder } from '@lc/schema';

/** 单管共射反相器：a → y（输出高为弱 1，成本 4） */
export function notGateRef(id = 'ref-not'): Design {
  const b = new DesignBuilder(id, '非门');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('res', { a: 'a', b: 'b1' }, 'R1'); // 基极限流
  b.unit('npn', { c: 'y', b: 'b1', e: 'gnd' }, 'Q1'); // 共射反相
  b.unit('res', { a: 'vcc', b: 'y' }, 'R2'); // 集电极上拉
  b.port('a', 'in', 'a');
  b.port('y', 'out', 'y');
  return b.build();
}

/**
 * 教学关·认识三极管：反相开关（门磁警示灯）。
 * 三极管共射极天然反相：基极一通电就导通、把输出拉低；不通电时上拉电阻
 * 把输出钉回 1。y = ¬a（成本 6 = 1 三极管 + 1 上拉电阻）。
 * 输入 a 是弱信号源（带内阻），可以直接接基极；VCC 这种强电源直连基极
 * 才会过流（b-e 只有约 0.7V），需要限流电阻。
 */
export function npnIntroRef(id = 'ref-npn-intro'): Design {
  const b = new DesignBuilder(id, '认识三极管');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('npn', { c: 'y', b: 'a', e: 'gnd' }, 'Q1'); // 共射极：集电极接输出
  b.unit('res', { a: 'vcc', b: 'y' }, 'R1'); // 上拉：管子不导通时把输出钉回 1
  b.port('a', 'in', 'a');
  b.port('y', 'out', 'y');
  return b.build();
}

/**
 * 教学关·认识三极管的半成品：上拉电阻 + 集电极→输出、发射极→GND 都接好了，
 * 只差「基极 b → 输入 a」这一条线（玩家补）—— 接上就亲眼看到「反着来」。
 */
export function npnIntroSeed(id = 'seed-npn-intro'): Design {
  const b = new DesignBuilder(id, '认识三极管 · 半成品');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('npn', { c: 'y', b: 'b_dangling', e: 'gnd' }, 'Q1');
  b.unit('res', { a: 'vcc', b: 'y' }, 'R1'); // 上拉已接
  b.port('a', 'in', 'a_dangling');
  b.port('y', 'out', 'y');
  return b.build();
}

/**
 * 教学关·认识二极管的半成品：下拉电阻已接，二极管本体和它的连线由玩家放——
 * 方向是这关的主角，所以不预置。
 */
/**
 * 教学关·认识二极管的半成品（防倒灌）：两节电池**直接并联**到输出（会信号冲突/倒灌），
 * 负载下拉电阻已接——玩家亲手看到「并联打架」，再加两个二极管隔开（阳极朝电池）。
 */
export function dioIntroSeed(id = 'seed-dio-intro'): Design {
  const b = new DesignBuilder(id, '认识二极管 · 半成品');
  b.gnd('gnd');
  b.unit('res', { a: 'y', b: 'gnd' }, 'R1'); // 负载下拉：两节都没电时输出 0
  b.port('a', 'in', 'y'); // 直接并联：一节没电会拖垮另一节（强 1 / 强 0 冲突）
  b.port('b', 'in', 'y');
  b.port('y', 'out', 'y');
  return b.build();
}

/**
 * 教学关·悬空与默认电平的半成品：三极管开关已接（集电极→输出、发射极→GND、
 * 基极→输入），只差「上拉电阻 VCC → 输出 y」—— 上拉就是这关要教的主角。
 */
export function floatIntroSeed(id = 'seed-float-intro'): Design {
  const b = new DesignBuilder(id, '悬空与默认电平 · 半成品');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('npn', { c: 'y', b: 'a', e: 'gnd' }, 'Q1');
  b.port('a', 'in', 'a');
  b.port('y', 'out', 'y');
  return b.build();
}

/**
 * 教学关·认识二极管的参考解（防倒灌）：两节电池各串一个二极管再并到设备——
 * 二极管只许电流往外流，没电的电池被挡住、拖不垮另一节。y = a 或 b
 * （成本 8 = 2 二极管 + 1 下拉电阻；allowedUnits 只有 dio/res → 二极管是唯一解法）。
 */
export function dioIntroRef(id = 'ref-dio-intro'): Design {
  const b = new DesignBuilder(id, '认识二极管');
  b.gnd('gnd');
  b.unit('dio', { a: 'a', k: 'y' }, 'D1'); // 电池 a：只许电流外流（防倒灌）
  b.unit('dio', { a: 'b', k: 'y' }, 'D2'); // 电池 b：只许电流外流（防倒灌）
  b.unit('res', { a: 'y', b: 'gnd' }, 'R1'); // 负载下拉：两节都没电时输出 0
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** 教学关·悬空与默认电平：上拉反相，a → ¬y（成本 6 = 1 三极管 + 1 上拉电阻） */
export function floatIntroRef(id = 'ref-float-intro'): Design {
  const b = new DesignBuilder(id, '悬空与默认电平');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('res', { a: 'vcc', b: 'y' }, 'R1'); // 上拉：没人驱动时输出默认 1
  b.unit('npn', { c: 'y', b: 'a', e: 'gnd' }, 'Q1'); // 输入 a（弱源）直连基极
  b.port('a', 'in', 'a');
  b.port('y', 'out', 'y');
  return b.build();
}

/** 二极管与门：a·b → y（成本 4） */
export function andGateRef(id = 'ref-and'): Design {
  const b = new DesignBuilder(id, '与门');
  b.vcc('vcc');
  b.unit('res', { a: 'vcc', b: 'y' }, 'R1'); // 上拉：全高时输出才被拉高
  b.unit('dio', { a: 'y', k: 'a' }, 'D1'); // 任一路被拉低 → 输出被压到低
  b.unit('dio', { a: 'y', k: 'b' }, 'D2');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** 二极管或门：a+b → y（成本 4） */
export function orGateRef(id = 'ref-or'): Design {
  const b = new DesignBuilder(id, '或门');
  b.gnd('gnd');
  b.unit('res', { a: 'y', b: 'gnd' }, 'R1'); // 下拉：全低时输出才是低
  b.unit('dio', { a: 'a', k: 'y' }, 'D1');
  b.unit('dio', { a: 'b', k: 'y' }, 'D2');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** RTL 与非门：两个三极管串联下拉（成本 7） */
export function nandGateRef(id = 'ref-nand'): Design {
  const b = new DesignBuilder(id, '与非门');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('res', { a: 'a', b: 'b1' }, 'R1');
  b.unit('res', { a: 'b', b: 'b2' }, 'R2');
  b.unit('npn', { c: 'y', b: 'b1', e: 'mid' }, 'Q1'); // 串联：只有两个都导通才拉低
  b.unit('npn', { c: 'mid', b: 'b2', e: 'gnd' }, 'Q2');
  b.unit('res', { a: 'vcc', b: 'y' }, 'R3');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** 或非门：二极管或门 + 单管反相器（成本 8） */
export function norGateRef(id = 'ref-nor'): Design {
  const b = new DesignBuilder(id, '或非门');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('res', { a: 'o', b: 'gnd' }, 'R1'); // 或门下拉
  b.unit('dio', { a: 'a', k: 'o' }, 'D1');
  b.unit('dio', { a: 'b', k: 'o' }, 'D2');
  b.unit('res', { a: 'o', b: 'b1' }, 'R2'); // 耦合到反相器基极
  b.unit('npn', { c: 'y', b: 'b1', e: 'gnd' }, 'Q1');
  b.unit('res', { a: 'vcc', b: 'y' }, 'R3');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** RTL 或非门：两个三极管并联下拉（成本 7）—— 比「二极管或门 + 反相器」更省，
 *  这是求解器（tools/opt-solver）搜出来的结论，关卡的最优成本以它为准。 */
export function norFastRef(id = 'ref-nor-fast'): Design {
  const b = new DesignBuilder(id, '或非门（并联下拉）');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('res', { a: 'a', b: 'b1' }, 'R1');
  b.unit('res', { a: 'b', b: 'b2' }, 'R2');
  b.unit('npn', { c: 'y', b: 'b1', e: 'gnd' }, 'Q1'); // 任一路导通就把输出拉低
  b.unit('npn', { c: 'y', b: 'b2', e: 'gnd' }, 'Q2');
  b.unit('res', { a: 'vcc', b: 'y' }, 'R3');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** 异或门：4 个 RTL 与非门（成本 28；标准解法，也可用自己封装的与非门模块拼） */
export function xorGateRef(id = 'ref-xor'): Design {
  const b = new DesignBuilder(id, '异或门');
  b.vcc('vcc');
  b.gnd('gnd');
  // NAND1: a·b
  b.unit('res', { a: 'a', b: 'n1b1' }, 'R1');
  b.unit('res', { a: 'b', b: 'n1b2' }, 'R2');
  b.unit('npn', { c: 'n1', b: 'n1b1', e: 'm1' }, 'Q1');
  b.unit('npn', { c: 'm1', b: 'n1b2', e: 'gnd' }, 'Q2');
  b.unit('res', { a: 'vcc', b: 'n1' }, 'R3');
  // NAND2: a · n1
  b.unit('res', { a: 'a', b: 'n2b1' }, 'R4');
  b.unit('res', { a: 'n1', b: 'n2b2' }, 'R5');
  b.unit('npn', { c: 'n2', b: 'n2b1', e: 'm2' }, 'Q3');
  b.unit('npn', { c: 'm2', b: 'n2b2', e: 'gnd' }, 'Q4');
  b.unit('res', { a: 'vcc', b: 'n2' }, 'R6');
  // NAND3: b · n1
  b.unit('res', { a: 'b', b: 'n3b1' }, 'R7');
  b.unit('res', { a: 'n1', b: 'n3b2' }, 'R8');
  b.unit('npn', { c: 'n3', b: 'n3b1', e: 'm3' }, 'Q5');
  b.unit('npn', { c: 'm3', b: 'n3b2', e: 'gnd' }, 'Q6');
  b.unit('res', { a: 'vcc', b: 'n3' }, 'R9');
  // NAND4: n2 · n3 → y
  b.unit('res', { a: 'n2', b: 'n4b1' }, 'R10');
  b.unit('res', { a: 'n3', b: 'n4b2' }, 'R11');
  b.unit('npn', { c: 'y', b: 'n4b1', e: 'm4' }, 'Q7');
  b.unit('npn', { c: 'm4', b: 'n4b2', e: 'gnd' }, 'Q8');
  b.unit('res', { a: 'vcc', b: 'y' }, 'R12');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** 同或门：异或门 + 单管反相器（成本 32） */
export function xnorGateRef(id = 'ref-xnor'): Design {
  const b = new DesignBuilder(id, '同或门');
  b.vcc('vcc');
  b.gnd('gnd');
  // 与非门 1
  b.unit('res', { a: 'a', b: 'n1b1' }, 'R1');
  b.unit('res', { a: 'b', b: 'n1b2' }, 'R2');
  b.unit('npn', { c: 'n1', b: 'n1b1', e: 'm1' }, 'Q1');
  b.unit('npn', { c: 'm1', b: 'n1b2', e: 'gnd' }, 'Q2');
  b.unit('res', { a: 'vcc', b: 'n1' }, 'R3');
  // 与非门 2
  b.unit('res', { a: 'a', b: 'n2b1' }, 'R4');
  b.unit('res', { a: 'n1', b: 'n2b2' }, 'R5');
  b.unit('npn', { c: 'n2', b: 'n2b1', e: 'm2' }, 'Q3');
  b.unit('npn', { c: 'm2', b: 'n2b2', e: 'gnd' }, 'Q4');
  b.unit('res', { a: 'vcc', b: 'n2' }, 'R6');
  // 与非门 3
  b.unit('res', { a: 'b', b: 'n3b1' }, 'R7');
  b.unit('res', { a: 'n1', b: 'n3b2' }, 'R8');
  b.unit('npn', { c: 'n3', b: 'n3b1', e: 'm3' }, 'Q5');
  b.unit('npn', { c: 'm3', b: 'n3b2', e: 'gnd' }, 'Q6');
  b.unit('res', { a: 'vcc', b: 'n3' }, 'R9');
  // 与非门 4 → 异或
  b.unit('res', { a: 'n2', b: 'n4b1' }, 'R10');
  b.unit('res', { a: 'n3', b: 'n4b2' }, 'R11');
  b.unit('npn', { c: 'x', b: 'n4b1', e: 'm4' }, 'Q7');
  b.unit('npn', { c: 'm4', b: 'n4b2', e: 'gnd' }, 'Q8');
  b.unit('res', { a: 'vcc', b: 'x' }, 'R12');
  // 反相器 → y
  b.unit('res', { a: 'x', b: 'b1' }, 'R13');
  b.unit('npn', { c: 'y', b: 'b1', e: 'gnd' }, 'Q9');
  b.unit('res', { a: 'vcc', b: 'y' }, 'R14');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** CMOS 反相器：上 pMOS 下 nMOS，栅并接输入，无电阻、轨到轨强输出（成本 4 半分 = 显示 2） */
export function cmosInvRef(id = 'ref-cmos-inv'): Design {
  const b = new DesignBuilder(id, 'CMOS 反相器');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('pmos', { d: 'y', g: 'a', s: 'vcc' }, 'P1'); // 栅低导通：a=0 → y 被拉到 VCC（强 1）
  b.unit('nmos', { d: 'y', g: 'a', s: 'gnd' }, 'N1'); // 栅高导通：a=1 → y 被拉到 GND（强 0）
  b.port('a', 'in', 'a');
  b.port('y', 'out', 'y');
  return b.build();
}

/**
 * 教学关·CMOS 反相器的半成品：pMOS 上管（源→VCC、漏→y）与 nMOS 下管（漏→y、
 * 源→GND）都放好了，**两个栅极都悬空、输入 a 也没接**——玩家把 a 同时接到
 * 两个栅极（P1.g、N1.g），亲眼看到「互补对：一个导通另一个必截止」。
 */
export function cmosInvSeed(id = 'seed-cmos-inv'): Design {
  const b = new DesignBuilder(id, 'CMOS 反相器 · 半成品');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('pmos', { d: 'y', g: 'g_dangling', s: 'vcc' }, 'P1');
  b.unit('nmos', { d: 'y', g: 'g_dangling', s: 'gnd' }, 'N1');
  b.port('a', 'in', 'a_dangling');
  b.port('y', 'out', 'y');
  return b.build();
}
