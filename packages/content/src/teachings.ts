/**
 * 逻辑门版参考解（「简洁版一键出答案」）—— 阶段 3 算术单元的积木版。
 *
 * 与参考解（references-ari）同结构、同成本，但画布上是**门级积木**而不是几百个晶体管：
 *  - 半加器 = 【异或门】+【与门】                  成本 64（比元件版 84 还省：进位直接用二极管与门）
 *  - 全加器 = 9×【与非门】（经典 TTL 结构，强驱动）  成本 126（与元件版相同）
 *  - 4位/8位加法器 = N×【全加器】积木串联进位        成本 504 / 1008（与元件版相同）
 *  - 简易ALU = 4×【异或门】+ 4×【全加器】           成本 728（与元件版相同）
 *
 * 成本为什么能和元件版一样甚至更省：模块成本 = 封装时递归加总的底层元件成本（GDD 2.2），
 * 门版和元件版元件构成相同 → 成本相同。「用逻辑门」并不天然更贵 —— 贵的是「教科书直觉搭法」
 * （异或+与+或全加器要用强驱动或门，会超预算），而本项目教学版直接复用参考解的优化结构。
 *
 * 积木分两层（关卡设计规范 §二.4：同一单元 ≥3 次必须封装，答案顶层盒数 ≤ 15）：
 *  - 基础门（TEACHING_MODULES_BASE）：非门/与非门/或门/异或门/与门/D锁存器/全加器，元件级封装；
 *  - 复合积木（COMPOSITE_ORDER）：加3单元、主从D触发器、BCD→二进制、二进制→BCD、八位寄存器，
 *    基于基础门（或更早的复合积木）封装，供 bin2bcd / reg-8 / calc 的门版复用，
 *    内部可经画布「双击模块」下钻查看。
 *
 * 注意：这些 Design 引用了模块 hash，必须带 TEACHING_MODULES 建库才能编译/判定，
 * 因此**不能**放进关卡数据的 referenceSolution（那必须空库可编译）——只给「一键出答案」用。
 */
import { analyzeTiming, compileDesign, computeCosts, wrapModule } from '@lc/compiler';
import {
  type Design,
  DesignBuilder,
  familySpecOf,
  InMemoryModuleLibrary,
  type Level,
  type LogicFamily,
  type ModuleKind,
  type ModuleTemplate,
} from '@lc/schema';
import {
  andGateRef,
  cmosInvRef,
  cmosNandRef,
  nandGateRef,
  notGateRef,
  orGateRef,
  xnorGateRef,
  xorGateRef,
} from './references.js';
import { fullAdderRef } from './references-ari.js';
import {
  cmosAndRef,
  cmosOrRef,
  cmosXnorRef,
  cmosXorRef,
  ttlAndRef,
  ttlNandRef,
  ttlNotRef,
  ttlOrRef,
} from './references-family.js';

/** 门级参考解都是纯底层元件，空库即可封装（hash 由内容决定，稳定可复现） */
const EMPTY_LIB = new InMemoryModuleLibrary();

function wrapGate(name: string, body: Design, kind: ModuleKind): ModuleTemplate {
  const { template } = wrapModule({ name, stage: 3, kind, ports: body.ports, body }, EMPTY_LIB);
  return template;
}

/**
 * 门控 D 锁存器（带 qn 输出）：内部与参考解完全相同，只是额外导出 qn。
 * 参考解不导 qn（关卡 s2-d-latch 只要 q），但主从 D 触发器（s2-dff）的输出端口有 qn，
 * 所以教学库需要一个能把 qn 带出来的 D 锁存器模块。
 */
function dLatchQnRef(id = 'ref-dlatch-qn'): Design {
  const b = new DesignBuilder(id, 'D锁存器');
  b.vcc('vcc');
  b.gnd('gnd');
  // 反相器：d → nd
  b.unit('res', { a: 'd', b: 'nb1' }, 'R1');
  b.unit('npn', { c: 'nd', b: 'nb1', e: 'gnd' }, 'Q1');
  b.unit('res', { a: 'vcc', b: 'nd' }, 'R2');
  // 门控：ns = NAND(d, en)，nr = NAND(nd, en)
  b.unit('res', { a: 'd', b: 's1' }, 'R3');
  b.unit('res', { a: 'en', b: 's2' }, 'R4');
  b.unit('npn', { c: 'ns', b: 's1', e: 'sm1' }, 'Q2');
  b.unit('npn', { c: 'sm1', b: 's2', e: 'gnd' }, 'Q3');
  b.unit('res', { a: 'vcc', b: 'ns' }, 'R5');
  b.unit('res', { a: 'nd', b: 's3' }, 'R6');
  b.unit('res', { a: 'en', b: 's4' }, 'R7');
  b.unit('npn', { c: 'nr', b: 's3', e: 'sm2' }, 'Q4');
  b.unit('npn', { c: 'sm2', b: 's4', e: 'gnd' }, 'Q5');
  b.unit('res', { a: 'vcc', b: 'nr' }, 'R8');
  // 锁存：q = NAND(ns, qn)，qn = NAND(nr, q)
  b.unit('res', { a: 'ns', b: 'b1' }, 'R9');
  b.unit('res', { a: 'qn', b: 'b2' }, 'R10');
  b.unit('npn', { c: 'q', b: 'b1', e: 'm1' }, 'Q6');
  b.unit('npn', { c: 'm1', b: 'b2', e: 'gnd' }, 'Q7');
  b.unit('res', { a: 'vcc', b: 'q' }, 'R11');
  b.unit('res', { a: 'nr', b: 'b3' }, 'R12');
  b.unit('res', { a: 'q', b: 'b4' }, 'R13');
  b.unit('npn', { c: 'qn', b: 'b3', e: 'm2' }, 'Q8');
  b.unit('npn', { c: 'm2', b: 'b4', e: 'gnd' }, 'Q9');
  b.unit('res', { a: 'vcc', b: 'qn' }, 'R14');
  b.port('d', 'in', 'd');
  b.port('en', 'in', 'en');
  b.port('q', 'out', 'q');
  b.port('qn', 'out', 'qn');
  return b.build();
}

/** RTL 基础门积木（元件级，EMPTY_LIB 封装，内容哈希稳定）——复合积木的原料 */
const TEACHING_MODULES_BASE: readonly ModuleTemplate[] = [
  wrapGate('非门', notGateRef(), 'logic'),
  wrapGate('与非门', nandGateRef(), 'logic'),
  wrapGate('或门', orGateRef(), 'logic'),
  wrapGate('异或门', xorGateRef(), 'logic'),
  wrapGate('与门', andGateRef(), 'logic'),
  wrapGate('D锁存器', dLatchQnRef(), 'seq'),
  wrapGate('全加器', fullAdderRef(), 'arith'),
];

type GateRef = (id?: string) => Design;
/**
 * 教学门积木的工艺表：每个门按契约给工艺参考解（TTL 推挽 / CMOS 互补都是强输出，
 * 强输出契约判定才过得去）；缺失的工艺自动回退 RTL（只有该契约有 familyRefs 的关
 * 判定才查强度，其余关回退 RTL 判定 → RTL 积木即可）。
 */
const FAMILY_GATES: Record<string, Partial<Record<LogicFamily, GateRef>>> = {
  非门: { rtl: notGateRef, ttl: ttlNotRef, cmos: cmosInvRef },
  与非门: { rtl: nandGateRef, ttl: ttlNandRef, cmos: cmosNandRef },
  与门: { rtl: andGateRef, ttl: ttlAndRef, cmos: cmosAndRef },
  或门: { rtl: orGateRef, ttl: ttlOrRef, cmos: cmosOrRef },
  异或门: { rtl: xorGateRef, cmos: cmosXorRef },
  同或门: { rtl: xnorGateRef, cmos: cmosXnorRef },
  D锁存器: { rtl: dLatchQnRef },
  全加器: { rtl: fullAdderRef },
};

const GATE_KIND: Record<string, ModuleKind> = {
  非门: 'logic',
  与非门: 'logic',
  或门: 'logic',
  与门: 'logic',
  异或门: 'logic',
  同或门: 'logic',
  D锁存器: 'seq',
  全加器: 'arith',
};

const templateCache = new Map<string, ModuleTemplate>();

function gateTemplateFor(name: string, family: LogicFamily = 'rtl'): ModuleTemplate {
  const key = `${family}:${name}`;
  let t = templateCache.get(key);
  if (!t) {
    const ref = FAMILY_GATES[name]?.[family] ?? FAMILY_GATES[name]?.rtl;
    if (!ref) throw new Error(`教学模块缺失：${name}`);
    t = wrapGate(name, ref(), GATE_KIND[name] ?? 'logic');
    templateCache.set(key, t);
  }
  return t;
}

/**
 * 复合积木（基于基础门/更早的复合积木封装）——关卡设计规范 §二.4：同一单元 ≥3 次必须封装。
 * 目前服务计算器链：加3单元（bin2bcd 的 14 个重复单元）、主从D触发器（reg-8/calc 复用）、
 * 七段译码器（display 的译码器，calc 复用 2 次）、BCD↔二进制转换器与八位寄存器
 * （calc 组装关的粗粒度积木）。内部可经「双击模块」下钻查看。
 */
const COMPOSITE_ORDER = [
  '加3单元',
  '主从D触发器',
  'BCD→二进制',
  '二进制→BCD',
  '七段译码器',
  '八位寄存器',
] as const;
const COMPOSITE_KIND: Record<string, ModuleKind> = {
  加3单元: 'arith',
  主从D触发器: 'seq',
  'BCD→二进制': 'arith',
  '二进制→BCD': 'arith',
  七段译码器: 'arith',
  八位寄存器: 'seq',
};
const compositeCache = new Map<string, ModuleTemplate>();

/** 复合积木的 body：按依赖顺序引用已存在的积木（绝不自引用/循环） */
function compositeBodyOf(name: string, family: LogicFamily): Design {
  switch (name) {
    case '加3单元':
      return plus3BrickRef(family);
    case '主从D触发器':
      return dffByModules(`brick-dff-${family}`, '主从D触发器', family);
    case 'BCD→二进制':
      return bcd2binByModules(`brick-bcd2bin-${family}`, 'BCD→二进制', family);
    case '二进制→BCD':
      return bin2bcdByModules(`brick-bin2bcd-${family}`, '二进制→BCD', family);
    case '七段译码器':
      return seg7ByModules(`brick-seg7-${family}`, '七段译码器', family);
    case '八位寄存器':
      return reg8ByModules(`brick-reg8-${family}`, '八位寄存器', family);
    default:
      throw new Error(`未知复合积木：${name}`);
  }
}

/** 封装复合积木：库 = 基础门 + 依赖顺序排在前面的复合积木 */
function compositeFor(name: string, family: LogicFamily): ModuleTemplate {
  const key = `${family}:${name}`;
  let t = compositeCache.get(key);
  if (!t) {
    const idx = COMPOSITE_ORDER.indexOf(name as (typeof COMPOSITE_ORDER)[number]);
    const body = compositeBodyOf(name, family);
    const lib = new InMemoryModuleLibrary([
      ...baseTemplatesFor(family),
      ...COMPOSITE_ORDER.slice(0, idx).map((n) => compositeFor(n, family)),
    ]);
    const { template } = wrapModule(
      { name, stage: 3, kind: COMPOSITE_KIND[name] ?? 'logic', ports: body.ports, body },
      lib,
    );
    t = template;
    compositeCache.set(key, t);
  }
  return t;
}

/** 基础门积木（按工艺：RTL 用基础集，TTL/CMOS 用对应工艺参考解封装） */
function baseTemplatesFor(family: LogicFamily): readonly ModuleTemplate[] {
  if (family === 'rtl') return TEACHING_MODULES_BASE;
  const names = Object.keys(FAMILY_GATES);
  return names.map((n) => gateTemplateFor(n, family));
}

/** 全部教学积木（基础门 + 复合积木）——App 一键出答案门版时并入画布库；判定库也用这个 */
export const TEACHING_MODULES: readonly ModuleTemplate[] = [
  ...TEACHING_MODULES_BASE,
  ...COMPOSITE_ORDER.map((n) => compositeFor(n, 'rtl')),
];

/** 某工艺的教学积木全集（基础门 + 复合积木；App 一键出答案门版时并入画布库；判定库也用这个） */
export function teachingModulesFor(family: LogicFamily): readonly ModuleTemplate[] {
  if (family === 'rtl') return TEACHING_MODULES;
  return [...baseTemplatesFor(family), ...COMPOSITE_ORDER.map((n) => compositeFor(n, family))];
}

/** 按名取积木模板（基础门与复合积木都能取，复合积木按依赖顺序惰性封装） */
function templateFor(name: string, family: LogicFamily = 'rtl'): ModuleTemplate {
  if ((COMPOSITE_ORDER as readonly string[]).includes(name)) return compositeFor(name, family);
  return gateTemplateFor(name, family);
}

function hashOf(name: string, family: LogicFamily = 'rtl'): string {
  return templateFor(name, family).hash;
}

/** 半加器（门版）：s = a⊕b（异或门），c = a∧b（与门） */
function halfAdderByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  b.module(hashOf('异或门', family), { a: 'a', b: 'b', y: 's' }, 'X1');
  b.module(hashOf('与门', family), { a: 'a', b: 'b', y: 'c' }, 'A1');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('s', 'out', 's');
  b.port('c', 'out', 'c');
  return b.build();
}

/** 与非门（门版）：【与门】+【非门】——用其他门搭，不自引用、无循环依赖 */
function nandByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  b.module(hashOf('与门', family), { a: 'a', b: 'b', y: 'm' }, 'A1');
  b.module(hashOf('非门', family), { a: 'm', y: 'y' }, 'N1');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** 或非门（门版）：【或门】+【非门】——本关 teaching 即「把或当一级再接反相器」，模块化组合思路 */
function norByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  b.module(hashOf('或门', family), { a: 'a', b: 'b', y: 'm' }, 'O1');
  b.module(hashOf('非门', family), { a: 'm', y: 'y' }, 'N1');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** 全加器（门版）：经典 9 与非门，结构同参考解，但每个与非门都是模块积木 */
function fullAdderByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  const nand = hashOf('与非门', family);
  const n1 = 't1';
  const n2 = 't2';
  const n3 = 't3';
  const x = 'x';
  const n4 = 't4';
  const n5 = 't5';
  const n6 = 't6';
  b.module(nand, { a: 'a', b: 'b', y: n1 }, 'G1'); // t1 = ¬(ab)
  b.module(nand, { a: 'a', b: n1, y: n2 }, 'G2'); // t2 = ¬(a·t1)
  b.module(nand, { a: 'b', b: n1, y: n3 }, 'G3'); // t3 = ¬(b·t1)
  b.module(nand, { a: n2, b: n3, y: x }, 'G4'); // x = a⊕b
  b.module(nand, { a: x, b: 'cin', y: n4 }, 'G5'); // t4 = ¬(x·cin)
  b.module(nand, { a: x, b: n4, y: n5 }, 'G6'); // t5 = ¬(x·t4)
  b.module(nand, { a: 'cin', b: n4, y: n6 }, 'G7'); // t6 = ¬(cin·t4)
  b.module(nand, { a: n5, b: n6, y: 's' }, 'G8'); // s = x⊕cin
  b.module(nand, { a: n1, b: n4, y: 'cout' }, 'G9'); // cout = ab ∨ (x·cin)
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('cin', 'in', 'cin');
  b.port('s', 'out', 's');
  b.port('cout', 'out', 'cout');
  return b.build();
}

/** N 位行波进位加法器（门版）：N 个【全加器】积木串联进位，最低位 cin 接地 */
function adderByModules(
  width: number,
  id: string,
  name: string,
  family: LogicFamily = 'rtl',
): Design {
  const b = new DesignBuilder(id, name);
  const aNets = Array.from({ length: width }, (_, i) => `a${i}`);
  const bNets = Array.from({ length: width }, (_, i) => `b${i}`);
  const yNets = Array.from({ length: width }, (_, i) => `y${i}`);
  let carry = 'gnd';
  for (let i = 0; i < width; i++) {
    const next = i === width - 1 ? 'cout' : `c${i}`;
    b.module(
      hashOf('全加器', family),
      {
        a: aNets[i] as string,
        b: bNets[i] as string,
        cin: carry,
        s: yNets[i] as string,
        cout: next,
      },
      `FA${i}`,
    );
    carry = next;
  }
  b.port('a', 'in', aNets);
  b.port('b', 'in', bNets);
  b.port('y', 'out', yNets);
  b.port('cout', 'out', 'cout');
  return b.build();
}

/** 简易ALU（门版）：4×【异或门】取反 + 4×【全加器】，op 兼作最低位进位（补码减法） */
function aluByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  const aNets = Array.from({ length: 4 }, (_, i) => `a${i}`);
  const bNets = Array.from({ length: 4 }, (_, i) => `b${i}`);
  const tNets = Array.from({ length: 4 }, (_, i) => `t${i}`);
  const yNets = Array.from({ length: 4 }, (_, i) => `y${i}`);
  const xor = hashOf('异或门', family);
  for (let i = 0; i < 4; i++)
    b.module(xor, { a: 'op', b: bNets[i] as string, y: tNets[i] as string }, `X${i}`);
  let carry = 'op';
  const fa = hashOf('全加器', family);
  for (let i = 0; i < 4; i++) {
    const next = `c${i}`;
    b.module(
      fa,
      {
        a: aNets[i] as string,
        b: tNets[i] as string,
        cin: carry,
        s: yNets[i] as string,
        cout: next,
      },
      `FA${i}`,
    );
    carry = next;
  }
  b.port('op', 'in', 'op');
  b.port('a', 'in', aNets);
  b.port('b', 'in', bNets);
  b.port('y', 'out', yNets);
  return b.build();
}

/** 异或门（门版）：经典 4 与非门（本关本就许用【非门】【与非门】） */
function xorByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  const nand = hashOf('与非门', family);
  const n1 = 'n1';
  const n2 = 'n2';
  const n3 = 'n3';
  b.module(nand, { a: 'a', b: 'b', y: n1 }, 'G1'); // n1 = ¬(ab)
  b.module(nand, { a: 'a', b: n1, y: n2 }, 'G2'); // n2 = ¬(a·n1)
  b.module(nand, { a: 'b', b: n1, y: n3 }, 'G3'); // n3 = ¬(b·n1)
  b.module(nand, { a: n2, b: n3, y: 'y' }, 'G4'); // y = ¬(n2·n3) = a⊕b
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** 同或门（门版）：【异或门】+【非门】 */
function xnorByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  b.module(hashOf('异或门', family), { a: 'a', b: 'b', y: 'x' }, 'X1');
  b.module(hashOf('非门', family), { a: 'x', y: 'y' }, 'N1');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/**
 * 异或门·复古版（门版）：4【与门】+ 4【非门】= 8 盒，成本 80（恰等于满分线）。
 * 本关禁用【与非门】积木，只许用 非门/与门/或门。与门/或门是二极管逻辑（弱输出），
 * 二极管阳极若挂在「输出侧」会在强度对等时把电平反灌回输入（组合反馈 → 振荡），
 * 所以不能用 a·¬b / ¬a·b 再合并的结构；改用标准 4-与非门展开（每个与非门 = 与门+非门）：
 *   w1 = ¬(a·b)；w2 = ¬(a·w1)；w3 = ¬(b·w1)；y = ¬(w2·w3) = (a·¬b)∨(¬a·b)
 * 中间节点全是与非门输出（强 0 / 弱 1），二极管阴极接弱 1 被 cathodeHigh 挡住、接强 0 只把
 * 输出拉低，不会反灌 → 仿真稳定收敛。
 */
function xorRetroByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  const and = hashOf('与门', family);
  const not = hashOf('非门', family);
  b.module(and, { a: 'a', b: 'b', y: 'ab' }, 'A1');
  b.module(not, { a: 'ab', y: 'w1' }, 'N1');
  b.module(and, { a: 'a', b: 'w1', y: 'aw1' }, 'A2');
  b.module(not, { a: 'aw1', y: 'w2' }, 'N2');
  b.module(and, { a: 'b', b: 'w1', y: 'bw1' }, 'A3');
  b.module(not, { a: 'bw1', y: 'w3' }, 'N3');
  b.module(and, { a: 'w2', b: 'w3', y: 'w2w3' }, 'A4');
  b.module(not, { a: 'w2w3', y: 'y' }, 'N4');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** 与非门 SR 锁存器（门版）：2 个【与非门】交叉耦合，低有效置位/复位 */
function srLatchByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  const nand = hashOf('与非门', family);
  b.module(nand, { a: 'sn', b: 'qn', y: 'q' }, 'G1');
  b.module(nand, { a: 'rn', b: 'q', y: 'qn' }, 'G2');
  b.port('sn', 'in', 'sn');
  b.port('rn', 'in', 'rn');
  b.port('q', 'out', 'q');
  b.port('qn', 'out', 'qn');
  return b.build();
}

/** 按钮锁存器（门版）：2 个【非门】把 btn/rst 反相成低有效 sn/rn + 2 个【与非门】交叉耦合，4 盒 */
function btnLatchByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  const nand = hashOf('与非门', family);
  const not = hashOf('非门', family);
  b.module(not, { a: 'btn', y: 'sn' }, 'N1');
  b.module(not, { a: 'rst', y: 'rn' }, 'N2');
  b.module(nand, { a: 'sn', b: 'qn', y: 'q' }, 'G1');
  b.module(nand, { a: 'rn', b: 'q', y: 'qn' }, 'G2');
  b.port('btn', 'in', 'btn');
  b.port('rst', 'in', 'rst');
  b.port('q', 'out', 'q');
  return b.build();
}

/** 门控 D 锁存器（门版）：【非门】造 d̄ + 4 个【与非门】（2 门控 + 2 锁存） */
function dLatchByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  const nand = hashOf('与非门', family);
  b.module(hashOf('非门', family), { a: 'd', y: 'nd' }, 'N1');
  b.module(nand, { a: 'd', b: 'en', y: 'ns' }, 'G1');
  b.module(nand, { a: 'nd', b: 'en', y: 'nr' }, 'G2');
  b.module(nand, { a: 'ns', b: 'qn', y: 'q' }, 'G3');
  b.module(nand, { a: 'nr', b: 'q', y: 'qn' }, 'G4');
  b.port('d', 'in', 'd');
  b.port('en', 'in', 'en');
  b.port('q', 'out', 'q');
  return b.build();
}

/** 主从 D 触发器（门版）：时钟反相 + 2 个【D锁存器】（主使能 nclk、从使能 clk），q/qn 出自从锁存器 */
function dffByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  b.module(hashOf('非门', family), { a: 'clk', y: 'nclk' }, 'N1');
  b.module(hashOf('D锁存器', family), { d: 'd', en: 'nclk', q: 'm', qn: 'mqn' }, 'MASTER');
  b.module(hashOf('D锁存器', family), { d: 'm', en: 'clk', q: 'q', qn: 'qn' }, 'SLAVE');
  b.port('d', 'in', 'd');
  b.port('clk', 'in', 'clk');
  b.port('q', 'out', 'q');
  b.port('qn', 'out', 'qn');
  return b.build();
}

/**
 * 某关卡有没有逻辑门版参考解；没有返回 null（此时退元件版即可）。
 * family = 按玩家工艺取对应工艺的门版（TTL/CMOS 强输出积木；缺失工艺回退 RTL）。
 * 注意传 familySpecOf 回退后的 family（无该契约 familyRefs 的关判定回退 RTL，门版也回退）。
 */
export function teachingSolutionOf(levelId: string, family: LogicFamily = 'rtl'): Design | null {
  switch (levelId) {
    case 's1-nand':
      // 与非门 = 与门 + 非门（用其他门搭；答案绝不能是「与非门积木」——自引用/循环）。
      // 每个契约都给门版（默认答案）；TTL/CMOS 拼两门贵（44/16 > 满分线 20/8），
      // 由 familySpecOf 放宽预算到 2.2× 满分线承接，元件版因此成为「更优解」选项。
      return nandByModules('teach-s1-nand', '与非门（门版）', family);
    case 's1-nor':
      // 或非门 = 或门 + 非门（本关 teaching 的「模块化组合」思路）；同样全契约给门版。
      return norByModules('teach-s1-nor', '或非门（门版）', family);
    case 's1-xor':
      return xorByModules('teach-s1-xor', '异或门（门版）', family);
    case 's1-xor-retro':
      // 复古复用关禁用【与非门】积木：用 非门/与门/或门 拼（5 盒，符合本关素材约束）
      return xorRetroByModules('teach-s1-xor-retro', '异或门（复古版）', family);
    case 's1-xnor':
      return xnorByModules('teach-s1-xnor', '同或门（门版）', family);
    case 's2-sr-latch':
      return srLatchByModules('teach-s2-sr', 'SR锁存器（门版）', family);
    case 's2-btn-latch':
      return btnLatchByModules('teach-s2-btn-latch', '按钮锁存器（门版）', family);
    case 's2-d-latch':
      return dLatchByModules('teach-s2-dl', 'D锁存器（门版）', family);
    case 's2-dff':
    case 's2-dff-cost':
    case 's2-dff-fast':
      return dffByModules(`teach-${levelId}`, 'D触发器（门版）', family);
    case 's3-half-adder':
      return halfAdderByModules('teach-s3-ha', '半加器（门版）', family);
    case 's3-full-adder':
      return fullAdderByModules('teach-s3-fa', '全加器（门版）', family);
    case 's3-adder-4':
      return adderByModules(4, 'teach-s3-a4', '4位加法器（门版）', family);
    case 's3-adder-8':
      return adderByModules(8, 'teach-s3-a8', '8位加法器（门版）', family);
    case 's3-alu':
      return aluByModules('teach-s3-alu', '简易ALU（门版）', family);
    case 's3-bcd2bin':
      return bcd2binByModules('teach-s3-bcd2bin', 'BCD→二进制（门版）', family);
    case 's3-bin2bcd':
      return bin2bcdByModules('teach-s3-bin2bcd', '二进制→BCD（门版）', family);
    case 's3-display':
      return seg7ByModules('teach-s3-display', '七段译码器（门版）', family);
    case 's3-reg-8':
      return reg8ByModules('teach-s3-reg8', '8位寄存器（门版）', family);
    case 's3-calc':
      return calcByModules('teach-s3-calc', '简易计算器（门版）', family);
    default:
      return null;
  }
}

/**
 * 元件版相对门版有没有「值得给选项」的优势：'cost'（造价更低）或 'delay'（传播延迟更短）。
 * 两者都不严格占优 → null（此时不该给元件版选项，一键出答案直接出门版）。
 *
 * 为什么大多数关是 null：模块成本 = 封装时递归加总的底层元件成本，门版与元件版
 * 同结构时二者完全相同；只有结构不同才可能出现差异（如半加器门版用二极管与门，
 * 成本反而更低 64<84）。「元件版」唯一可能占优的场景是某关参考解用了更省/更快的
 * 晶体管结构而门版没跟上——目前内容里没有，将来若加了，这里会自动把选项亮出来。
 */
export function elementEdgeOf(level: Level, family: LogicFamily = 'rtl'): 'cost' | 'delay' | null {
  const spec = familySpecOf(level, family);
  const ref = spec.reference;
  const teach = teachingSolutionOf(level.id, spec.family);
  if (!ref || !teach) return null;
  const gateLib = new InMemoryModuleLibrary([...teachingModulesFor(spec.family)]);
  const emptyLib = new InMemoryModuleLibrary();
  const ec = computeCosts(ref, emptyLib).costHalf;
  const gc = computeCosts(teach, gateLib).costHalf;
  if (ec < gc) return 'cost';
  const ed = analyzeTiming(compileDesign(ref, { library: emptyLib }).net).criticalPathPs;
  const gd = analyzeTiming(compileDesign(teach, { library: gateLib }).net).criticalPathPs;
  if (ed < gd) return 'delay';
  return null;
}

// ---------------------------------------------------------------- 计算器章节门版
// 与 references-calc 的元件版同结构、同逻辑，只是把拼装块换成教学门积木：
//   - bcd2bin：12 个【全加器】积木（×8/×2 移位加权 + 两级行波进位）
//   - bin2bcd：14 个「加 3」单元（【非门】+【与非门】+【与门】+【异或门】积木）
//   - reg8：8 个主从 D 触发器（【非门】时钟反相 + 2×【D锁存器】）
//   - seg7：43 个【与非门】（七段译码器，s3-display 本关门版）
//   - calc：bcd2bin×2 → 8×【全加器】加法 → bin2bcd → 8 个主从 D 触发器锁存 → 2×seg7
//   - calc：bcd2bin×2 → 8×【全加器】加法 → bin2bcd → 8 个主从 D 触发器锁存
// 结构相同 → 成本与元件版一致或更低（教学积木里与门是二极管版更省），
// 因此 elementEdgeOf 对新 4 关都为 null → 一键出答案直接出门版（符合既定原则）。

/** 两位 BCD → 二进制（门版拼装块）：等价 bcd2binInto，全加器换成积木 */
function bcd2binModulesInto(
  b: DesignBuilder,
  p: string,
  t: string[],
  u: string[],
  bin: string[],
  family: LogicFamily = 'rtl',
): void {
  const fa = hashOf('全加器', family);
  // 2t：t 左移 1 位（bit i = t[i-1]；bit0 = 0）
  const t2 = Array.from({ length: 5 }, (_, i) => (i === 0 ? 'gnd' : (t[i - 1] as string)));
  // 第一级：s1 = u + t2（5 位）
  const s1 = Array.from({ length: 5 }, (_, i) => `${p}s1${i}`);
  let carry = 'gnd';
  for (let i = 0; i < 5; i++) {
    const next = i === 4 ? `${p}c1` : `${p}c1${i}`;
    b.module(
      fa,
      { a: u[i] as string, b: t2[i] as string, cin: carry, s: s1[i] as string, cout: next },
      `${p}A${i}`,
    );
    carry = next;
  }
  // 8t：t 左移 3 位
  const t8 = Array.from({ length: 7 }, (_, j) => (j < 3 ? 'gnd' : (t[j - 3] as string)));
  // 第二级：bin = s1 + t8（7 位）
  carry = 'gnd';
  for (let i = 0; i < 7; i++) {
    const next = i === 6 ? `${p}c2` : `${p}c2${i}`;
    b.module(
      fa,
      {
        a: i < 5 ? (s1[i] as string) : 'gnd',
        b: t8[i] as string,
        cin: carry,
        s: bin[i] as string,
        cout: next,
      },
      `${p}B${i}`,
    );
    carry = next;
  }
}

/** double-dabble「加 3」单元（门版拼装块）：等价 plus3Into，逻辑完全一致 */
function plus3ModulesInto(
  b: DesignBuilder,
  p: string,
  a: string[],
  y: string[],
  family: LogicFamily = 'rtl',
): void {
  const not = hashOf('非门', family);
  const nand = hashOf('与非门', family);
  const xor = hashOf('异或门', family);
  const and = hashOf('与门', family);
  const na0 = `${p}na0`;
  const na1 = `${p}na1`;
  const na3 = `${p}na3`;
  b.module(not, { a: a[0] as string, y: na0 }, `${p}N0`);
  b.module(not, { a: a[1] as string, y: na1 }, `${p}N1`);
  b.module(not, { a: a[3] as string, y: na3 }, `${p}N3`);
  const o10 = `${p}o10`; // a1 ∨ a0
  b.module(nand, { a: na1, b: na0, y: o10 }, `${p}G10`);
  const na20 = `${p}na20`; // ¬(a2∧(a1∨a0))
  b.module(nand, { a: a[2] as string, b: o10, y: na20 }, `${p}G20`);
  const ge5 = `${p}ge5`; // a3 ∨ (a2∧(a1∨a0)) = ¬(¬a3 ∧ ¬(a2∧o10))
  b.module(nand, { a: na3, b: na20, y: ge5 }, `${p}G5`);
  // y0 = a0 ⊕ ge5
  b.module(xor, { a: a[0] as string, b: ge5, y: y[0] as string }, `${p}X0`);
  // y1 = a1 ⊕ (ge5·¬a0)
  const t1 = `${p}t1`;
  b.module(and, { a: ge5, b: na0, y: t1 }, `${p}A1`);
  b.module(xor, { a: a[1] as string, b: t1, y: y[1] as string }, `${p}X1`);
  // c2 = ge5·(a1∨a0)
  const c2 = `${p}c2`;
  b.module(and, { a: ge5, b: o10, y: c2 }, `${p}A2`);
  b.module(xor, { a: a[2] as string, b: c2, y: y[2] as string }, `${p}X2`);
  // c3 = a2·c2
  const c3 = `${p}c3`;
  b.module(and, { a: a[2] as string, b: c2, y: c3 }, `${p}A3`);
  b.module(xor, { a: a[3] as string, b: c3, y: y[3] as string }, `${p}X3`);
}

/** 二进制 → 两位 BCD（门版拼装块）：等价 bin2bcdInto（double-dabble 组合展开） */
/** 加 3 单元（复合积木 body）：a ≥ 5 时 y = a + 3，否则原样（double-dabble 核心一步） */
function plus3BrickRef(family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(`brick-plus3-${family}`, '加3单元');
  const a = Array.from({ length: 4 }, (_, i) => `a${i}`);
  const y = Array.from({ length: 4 }, (_, i) => `y${i}`);
  plus3ModulesInto(b, 'x', a, y, family);
  b.port('a', 'in', a);
  b.port('y', 'out', y);
  return b.build();
}

/**
 * 二进制 → 两位 BCD（门版拼装块）：14 个【加3单元】积木（7 步 × 个位/十位各 1）。
 * 初始零直接接地（与 bcd2bin 的 t2/t8 零位同模式），不再用电阻拉低——顶层盒数 14 ≤ 15。
 */
function bin2bcdModulesInto(
  b: DesignBuilder,
  p: string,
  bin: string[],
  t: string[],
  u: string[],
  family: LogicFamily = 'rtl',
): void {
  let tens = Array.from({ length: 4 }, () => 'gnd');
  let ones = Array.from({ length: 4 }, () => 'gnd');
  for (let step = 0; step < 7; step++) {
    const st = `${p}s${step + 1}`;
    const onesP = Array.from({ length: 4 }, (_, i) => `${st}u${i}`);
    const tensP = Array.from({ length: 4 }, (_, i) => `${st}t${i}`);
    b.module(hashOf('加3单元', family), { a: ones, y: onesP }, `${p}U${step}`);
    b.module(hashOf('加3单元', family), { a: tens, y: tensP }, `${p}T${step}`);
    const bit = bin[6 - step] as string;
    ones = [bit, onesP[0] as string, onesP[1] as string, onesP[2] as string];
    tens = [onesP[3] as string, tensP[0] as string, tensP[1] as string, tensP[2] as string];
  }
  // 输出。注意：最后一步移入的 bin[0] 直接以输入端口网名出现（ones[0] = bin[0]），
  // 顶层展开时 bin/bcd 端口位 0 恰好共享同一节点、语义正确；但封装成模块后两个端口
  // 绑定会互相覆盖 → 输出位悬空。这里用与门缓冲成独立新网（AND(x,x)=x，+8 半单位）。
  const ob = `${p}ob`;
  b.module(hashOf('与门', family), { a: ones[0] as string, b: ones[0] as string, y: ob }, `${p}O`);
  for (let i = 0; i < 4; i++) {
    t[i] = tens[i] as string;
    u[i] = i === 0 ? ob : (ones[i] as string);
  }
}

/** 8 位寄存器（门版）：8 个【主从D触发器】共用时钟（复用 s2-dff 产出模块，顶层 8 盒） */
function reg8ByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  const dff = hashOf('主从D触发器', family);
  for (let i = 0; i < 8; i++) {
    b.module(dff, { d: `d${i}`, clk: 'clk', q: `q${i}`, qn: `qn${i}` }, `F${i}`);
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

/** 两位 BCD → 二进制（门版参考解）：端口与 s3-bcd2bin 关卡一致（bcd[7:0] → bin[6:0]） */
function bcd2binByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  b.vcc('vcc');
  b.gnd('gnd');
  const t = Array.from({ length: 4 }, (_, i) => `bcd${i + 4}`);
  const u = Array.from({ length: 4 }, (_, i) => `bcd${i}`);
  const bin = Array.from({ length: 7 }, (_, i) => `bin${i}`);
  bcd2binModulesInto(b, 'x', t, u, bin, family);
  b.port(
    'bcd',
    'in',
    Array.from({ length: 8 }, (_, i) => `bcd${i}`),
  );
  b.port('bin', 'out', bin);
  return b.build();
}

/** 二进制 → 两位 BCD（门版参考解）：端口与 s3-bin2bcd 关卡一致（bin[6:0] → bcd[7:0] 十位 + bcd[3:0] 个位） */
function bin2bcdByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  b.vcc('vcc');
  b.gnd('gnd');
  const bin = Array.from({ length: 7 }, (_, i) => `bin${i}`);
  const t = Array.from({ length: 4 }, (_, i) => `bcd${i + 4}`);
  const u = Array.from({ length: 4 }, (_, i) => `bcd${i}`);
  bin2bcdModulesInto(b, 'x', bin, t, u, family);
  b.port('bin', 'in', bin);
  b.port('bcd', 'out', [...u, ...t]);
  return b.build();
}

/** 七段译码器（门版）：bcd[3:0] → seg[6:0]，43 个【与非门】积木，结构与单元参考解一致（共享积项） */
function seg7ByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  b.vcc('vcc');
  b.gnd('gnd');
  const nand = hashOf('与非门', family);
  let n = 0;
  const g = (a: string, c: string): string => {
    b.module(nand, { a, b: c, y: `t${n}` }, `G${n}`);
    return `t${n++}`;
  };
  // 输入补
  const nA = g('bcd0', 'bcd0');
  const nB = g('bcd1', 'bcd1');
  const nC = g('bcd2', 'bcd2');
  const nD = g('bcd3', 'bcd3');
  // 共享积项 ¬p
  const t1 = g(nA, 'bcd1'); // ¬(A'·B)
  const t2 = g(nA, nC); // ¬(A'·C')
  const t3 = g(nB, 'bcd2'); // ¬(B'·C)
  const t4 = g('bcd1', nC); // ¬(B·C')
  const t5 = g('bcd0', 'bcd2'); // ¬(A·C)
  const t6 = g(nA, nB); // ¬(A'·B')
  const t7 = g('bcd0', 'bcd1'); // ¬(A·B)
  const t3n = g(t3, t3); // B'·C
  const t8 = g('bcd0', t3n); // ¬(A·B'·C)
  const t9 = g(nA, 'bcd2'); // ¬(A'·C)
  // OR 链（与单元版 orN 一致）
  const orN = (terms: string[]): string => {
    if (terms.length === 2) return g(terms[0], terms[1]);
    let s = g(terms[0], terms[1]);
    for (let i = 2; i < terms.length; i++) {
      const inv = g(s, s);
      s = g(inv, terms[i]);
    }
    return s;
  };
  const seg = [
    orN([t2, t5, nB, nD]),
    orN([t6, t7, 'bcd2']),
    orN([nA, 'bcd1', nC]),
    orN([t1, t2, t8, t4, nD]),
    orN([t1, t2]),
    orN([t6, t9, t3, nD]),
    orN([t1, t3, t4, nD]),
  ];
  b.port('bcd', 'in', ['bcd0', 'bcd1', 'bcd2', 'bcd3']);
  b.port('seg', 'out', seg);
  return b.build();
}

/** 简易计算器（门版参考解）：端口与 s3-calc 关卡一致（a/b BCD、eq 按钮、disp_t/disp_u 十位/个位） */
/** 简易计算器（门版参考解，组装关）：2×【BCD→二进制】+ 8×【全加器】+ 1×【二进制→BCD】+ 1×【八位寄存器】+ 2×【七段译码器】= 14 盒 */
function calcByModules(id: string, name: string, family: LogicFamily = 'rtl'): Design {
  const b = new DesignBuilder(id, name);
  b.vcc('vcc');
  b.gnd('gnd');
  const fa = hashOf('全加器', family);
  // a、b（BCD）→ 二进制（两个 BCD→二进制 积木）
  const aT = Array.from({ length: 4 }, (_, i) => `a${i + 4}`);
  const aU = Array.from({ length: 4 }, (_, i) => `a${i}`);
  const bT = Array.from({ length: 4 }, (_, i) => `b${i + 4}`);
  const bU = Array.from({ length: 4 }, (_, i) => `b${i}`);
  const aBin = Array.from({ length: 7 }, (_, i) => `aBin${i}`);
  const bBin = Array.from({ length: 7 }, (_, i) => `bBin${i}`);
  b.module(hashOf('BCD→二进制', family), { bcd: [...aU, ...aT], bin: aBin }, 'BCD2BIN_A');
  b.module(hashOf('BCD→二进制', family), { bcd: [...bU, ...bT], bin: bBin }, 'BCD2BIN_B');
  // 8 位二进制加法（8× 全加器 积木）
  const sum = Array.from({ length: 8 }, (_, i) => `sum${i}`);
  let carry = 'gnd';
  for (let i = 0; i < 8; i++) {
    const next = i === 7 ? 'sumc' : `sumc${i}`;
    b.module(
      fa,
      {
        a: i < 7 ? (aBin[i] as string) : 'gnd',
        b: i < 7 ? (bBin[i] as string) : 'gnd',
        cin: carry,
        s: sum[i] as string,
        cout: next,
      },
      `S${i}`,
    );
    carry = next;
  }
  // sum → BCD（一个 二进制→BCD 积木；a+b ≤ 99 只需 7 位）
  const t = Array.from({ length: 4 }, (_, i) => `t${i}`);
  const u = Array.from({ length: 4 }, (_, i) => `u${i}`);
  b.module(hashOf('二进制→BCD', family), { bin: sum.slice(0, 7), bcd: [...u, ...t] }, 'BIN2BCD');
  // eq 上升沿锁存（一个 八位寄存器 积木：d = 个位 u + 十位 t）
  const dIn = [...u, ...t];
  const q = Array.from({ length: 8 }, (_, i) => `q${i}`);
  b.module(hashOf('八位寄存器', family), { d: dIn, clk: 'eq', q }, 'REG8');
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
  // 锁存后的 BCD 十位/个位 → 2×【七段译码器】→ 7 位段码显示
  const segT = Array.from({ length: 7 }, (_, i) => `segT${i}`);
  const segU = Array.from({ length: 7 }, (_, i) => `segU${i}`);
  b.module(
    hashOf('七段译码器', family),
    { bcd: [`q4`, `q5`, `q6`, `q7`], seg: segT },
    'DEC_T',
  );
  b.module(
    hashOf('七段译码器', family),
    { bcd: [`q0`, `q1`, `q2`, `q3`], seg: segU },
    'DEC_U',
  );
  b.port('disp_t', 'out', segT);
  b.port('disp_u', 'out', segU);
  return b.build();
}
