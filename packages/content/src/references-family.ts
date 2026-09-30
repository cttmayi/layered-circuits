/**
 * 按逻辑族契约的差异化参考解（「一键出答案」按玩家契约给对应工艺的答案）。
 *
 * 与 referenceSolution（RTL 风格）并列：familyRefs[family] 存各契约自己的标准答案——
 * - CMOS：互补对、无电阻、轨到轨强输出（又便宜又是推挽，工业史上取代前三者的原因）；
 * - TTL：反相/推挽输出级（射极跟随器拉高 + 下拉电阻拉低），高电平强 1，满足推挽契约；
 * - DTL：在关卡已允许二极管时，最省结构与 RTL 相同（二极管与/或本来就给所有人用），
 *   因此本文件不重复造 DTL 版——契约差异如实呈现，不硬凑不同答案。
 *
 * 成本（半分整数）：npn=4、res=4、dio=2、nmos/pmos=2。
 */

import { type Design, DesignBuilder } from '@lc/schema';

// ---- 教学关按契约的变体参考解（CMOS 契约下「认识三极管/二极管」换成 MOS 教学）----

/** 认识 MOS · N-MOS 的参考解：N-MOS 栅高导通拉低 + 上拉电阻钉 1（成本 6 半分 = 显示 3） */
export function nmosIntroRef(id = 'ref-nmos-intro'): Design {
  const b = new DesignBuilder(id, '认识 N-MOS');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('nmos', { d: 'y', g: 'a', s: 'gnd' }, 'N1'); // 栅极高电平导通：漏→源，把输出拉低
  b.unit('res', { a: 'vcc', b: 'y' }, 'R1'); // 上拉：管子截止时把输出钉回 1
  b.port('a', 'in', 'a');
  b.port('y', 'out', 'y');
  return b.build();
}

/** 认识 MOS · N-MOS 的半成品：管子放好但栅极悬空、输入 a 没接 */
export function nmosIntroSeed(id = 'seed-nmos-intro'): Design {
  const b = new DesignBuilder(id, '认识 N-MOS · 半成品');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('nmos', { d: 'y', g: 'g_dangling', s: 'gnd' }, 'N1');
  b.unit('res', { a: 'vcc', b: 'y' }, 'R1'); // 上拉已接
  b.port('a', 'in', 'a_dangling');
  b.port('y', 'out', 'y');
  return b.build();
}

/** 认识 MOS · P-MOS 的参考解：P-MOS 栅低导通拉高 + 下拉电阻钉 0（成本 6 半分 = 显示 3） */
export function pmosIntroRef(id = 'ref-pmos-intro'): Design {
  const b = new DesignBuilder(id, '认识 P-MOS');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('pmos', { d: 'y', g: 'a', s: 'vcc' }, 'P1'); // 栅极低电平导通：源→漏，把输出拉高
  b.unit('res', { a: 'y', b: 'gnd' }, 'R1'); // 下拉：管子截止时把输出钉回 0
  b.port('a', 'in', 'a');
  b.port('y', 'out', 'y');
  return b.build();
}

/** 认识 MOS · P-MOS 的半成品：管子放好但栅极悬空、输入 a 没接 */
export function pmosIntroSeed(id = 'seed-pmos-intro'): Design {
  const b = new DesignBuilder(id, '认识 P-MOS · 半成品');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('pmos', { d: 'y', g: 'g_dangling', s: 'vcc' }, 'P1');
  b.unit('res', { a: 'y', b: 'gnd' }, 'R1'); // 下拉已接
  b.port('a', 'in', 'a_dangling');
  b.port('y', 'out', 'y');
  return b.build();
}

/** CMOS 或非门：上 pMOS 串联、下 nMOS 并联（成本 8 半分 = 显示 4） */
export function cmosNorRef(id = 'ref-cmos-nor'): Design {
  const b = new DesignBuilder(id, 'CMOS 或非门');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('pmos', { d: 'm', g: 'a', s: 'vcc' }, 'P1'); // 上管串联：两个输入都为 0 才拉高
  b.unit('pmos', { d: 'y', g: 'b', s: 'm' }, 'P2');
  b.unit('nmos', { d: 'y', g: 'a', s: 'gnd' }, 'N1'); // 下管并联：任一输入为 1 就拉低
  b.unit('nmos', { d: 'y', g: 'b', s: 'gnd' }, 'N2');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** CMOS 与门 = 与非门 + 反相器（成本 12 半分 = 显示 6） */
export function cmosAndRef(id = 'ref-cmos-and'): Design {
  const b = new DesignBuilder(id, 'CMOS 与门');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('pmos', { d: 'm', g: 'a', s: 'vcc' }, 'P1');
  b.unit('pmos', { d: 'm', g: 'b', s: 'vcc' }, 'P2');
  b.unit('nmos', { d: 'm', g: 'a', s: 'n1' }, 'N1');
  b.unit('nmos', { d: 'n1', g: 'b', s: 'gnd' }, 'N2');
  b.unit('pmos', { d: 'y', g: 'm', s: 'vcc' }, 'P3');
  b.unit('nmos', { d: 'y', g: 'm', s: 'gnd' }, 'N3');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** CMOS 或门 = 或非门 + 反相器（成本 12 半分 = 显示 6） */
export function cmosOrRef(id = 'ref-cmos-or'): Design {
  const b = new DesignBuilder(id, 'CMOS 或门');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('pmos', { d: 'm', g: 'a', s: 'vcc' }, 'P1');
  b.unit('pmos', { d: 'y', g: 'b', s: 'm' }, 'P2');
  b.unit('nmos', { d: 'y', g: 'a', s: 'gnd' }, 'N1');
  b.unit('nmos', { d: 'y', g: 'b', s: 'gnd' }, 'N2');
  b.unit('pmos', { d: 'y2', g: 'y', s: 'vcc' }, 'P3');
  b.unit('nmos', { d: 'y2', g: 'y', s: 'gnd' }, 'N3');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y2');
  return b.build();
}

/** CMOS 异或门：4 个 CMOS 与非门（成本 32 半分 = 显示 16） */
export function cmosXorRef(id = 'ref-cmos-xor'): Design {
  const b = new DesignBuilder(id, 'CMOS 异或门');
  b.vcc('vcc');
  b.gnd('gnd');
  const nand = (idn: string, ga: string, gb: string, out: string): void => {
    b.unit('pmos', { d: out, g: ga, s: 'vcc' }, `${idn}P1`);
    b.unit('pmos', { d: out, g: gb, s: 'vcc' }, `${idn}P2`);
    b.unit('nmos', { d: out, g: ga, s: `${idn}m` }, `${idn}N1`);
    b.unit('nmos', { d: `${idn}m`, g: gb, s: 'gnd' }, `${idn}N2`);
  };
  nand('G1', 'a', 'b', 'n1'); // n1 = NAND(a,b)
  nand('G2', 'a', 'n1', 'n2'); // n2 = NAND(a,n1)
  nand('G3', 'b', 'n1', 'n3'); // n3 = NAND(b,n1)
  nand('G4', 'n2', 'n3', 'y'); // y = NAND(n2,n3) = a⊕b
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** CMOS 同或门 = 异或门 + 反相器（成本 36 半分 = 显示 18） */
export function cmosXnorRef(id = 'ref-cmos-xnor'): Design {
  const b = new DesignBuilder(id, 'CMOS 同或门');
  b.vcc('vcc');
  b.gnd('gnd');
  const nand = (idn: string, ga: string, gb: string, out: string): void => {
    b.unit('pmos', { d: out, g: ga, s: 'vcc' }, `${idn}P1`);
    b.unit('pmos', { d: out, g: gb, s: 'vcc' }, `${idn}P2`);
    b.unit('nmos', { d: out, g: ga, s: `${idn}m` }, `${idn}N1`);
    b.unit('nmos', { d: `${idn}m`, g: gb, s: 'gnd' }, `${idn}N2`);
  };
  nand('G1', 'a', 'b', 'n1');
  nand('G2', 'a', 'n1', 'n2');
  nand('G3', 'b', 'n1', 'n3');
  nand('G4', 'n2', 'n3', 'm');
  b.unit('pmos', { d: 'y', g: 'm', s: 'vcc' }, 'P5'); // 末级反相：XNOR = ¬XOR
  b.unit('nmos', { d: 'y', g: 'm', s: 'gnd' }, 'N5');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** TTL 推挽输出级：射极跟随器拉高（强 1）+ 下拉电阻拉低（弱 0），挂在门输出 `in` 上 */
function ttlOutputStage(b: DesignBuilder, gateOut: string, out: string, tag: string): void {
  b.unit('npn', { c: 'vcc', b: gateOut, e: out }, `${tag}F`); // 跟随器：门输出为 1 → out 强 1
  b.unit('res', { a: out, b: 'gnd' }, `${tag}R`); // 下拉：跟随器关断时 out 弱 0
}

/** TTL 非门：反相 + 推挽输出级（成本 16 半分 = 显示 8） */
export function ttlNotRef(id = 'ref-ttl-not'): Design {
  const b = new DesignBuilder(id, 'TTL 非门');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('npn', { c: 'out', b: 'a', e: 'gnd' }, 'Q1'); // 反相
  b.unit('res', { a: 'vcc', b: 'out' }, 'R1'); // 上拉（弱 1 只喂基极，够用）
  ttlOutputStage(b, 'out', 'y', 'S');
  b.port('a', 'in', 'a');
  b.port('y', 'out', 'y');
  return b.build();
}

/** TTL 与非门：串联堆叠 + 推挽输出级（成本 20 半分 = 显示 10） */
export function ttlNandRef(id = 'ref-ttl-nand'): Design {
  const b = new DesignBuilder(id, 'TTL 与非门');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('npn', { c: 'out', b: 'a', e: 'm' }, 'Q1'); // 串联下拉：两个输入都为 1 才拉低
  b.unit('npn', { c: 'm', b: 'b', e: 'gnd' }, 'Q2');
  b.unit('res', { a: 'vcc', b: 'out' }, 'R1'); // 上拉
  ttlOutputStage(b, 'out', 'y', 'S');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** TTL 或非门：并联下拉 + 推挽输出级（成本 20 半分 = 显示 10） */
export function ttlNorRef(id = 'ref-ttl-nor'): Design {
  const b = new DesignBuilder(id, 'TTL 或非门');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('npn', { c: 'out', b: 'a', e: 'gnd' }, 'Q1'); // 并联下拉：任一输入为 1 就拉低
  b.unit('npn', { c: 'out', b: 'b', e: 'gnd' }, 'Q2');
  b.unit('res', { a: 'vcc', b: 'out' }, 'R1'); // 上拉
  ttlOutputStage(b, 'out', 'y', 'S');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** TTL 与门 = TTL 与非门 + 带输出级的非门（成本 28 半分 = 显示 14） */
export function ttlAndRef(id = 'ref-ttl-and'): Design {
  const b = new DesignBuilder(id, 'TTL 与门');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('npn', { c: 'n', b: 'a', e: 'm' }, 'Q1'); // 与非
  b.unit('npn', { c: 'm', b: 'b', e: 'gnd' }, 'Q2');
  b.unit('res', { a: 'vcc', b: 'n' }, 'R1');
  b.unit('npn', { c: 'out', b: 'n', e: 'gnd' }, 'Q3'); // 反相（内部节点弱 1 够喂基极）
  b.unit('res', { a: 'vcc', b: 'out' }, 'R2');
  ttlOutputStage(b, 'out', 'y', 'S');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** TTL 或门 = TTL 或非门 + 带输出级的非门（成本 28 半分 = 显示 14） */
export function ttlOrRef(id = 'ref-ttl-or'): Design {
  const b = new DesignBuilder(id, 'TTL 或门');
  b.vcc('vcc');
  b.gnd('gnd');
  b.unit('npn', { c: 'n', b: 'a', e: 'gnd' }, 'Q1'); // 或非
  b.unit('npn', { c: 'n', b: 'b', e: 'gnd' }, 'Q2');
  b.unit('res', { a: 'vcc', b: 'n' }, 'R1');
  b.unit('npn', { c: 'out', b: 'n', e: 'gnd' }, 'Q3'); // 反相
  b.unit('res', { a: 'vcc', b: 'out' }, 'R2');
  ttlOutputStage(b, 'out', 'y', 'S');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}
