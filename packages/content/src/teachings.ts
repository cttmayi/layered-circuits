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
 * 注意：这些 Design 引用了模块 hash，必须带 TEACHING_MODULES 建库才能编译/判定，
 * 因此**不能**放进关卡数据的 referenceSolution（那必须空库可编译）——只给「一键出答案」用。
 */
import { wrapModule } from '@lc/compiler';
import {
  type Design,
  DesignBuilder,
  InMemoryModuleLibrary,
  type ModuleKind,
  type ModuleTemplate,
} from '@lc/schema';
import { andGateRef, nandGateRef, notGateRef, xorGateRef } from './references.js';
import { fullAdderRef } from './references-ari.js';

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

/** 教学用门级模块（内容哈希确定） */
export const TEACHING_MODULES: readonly ModuleTemplate[] = [
  wrapGate('非门', notGateRef(), 'logic'),
  wrapGate('与非门', nandGateRef(), 'logic'),
  wrapGate('异或门', xorGateRef(), 'logic'),
  wrapGate('与门', andGateRef(), 'logic'),
  wrapGate('D锁存器', dLatchQnRef(), 'seq'),
  wrapGate('全加器', fullAdderRef(), 'arith'),
];

const MODULE_BY_NAME = new Map(TEACHING_MODULES.map((m) => [m.name, m]));

function hashOf(name: string): string {
  const m = MODULE_BY_NAME.get(name);
  if (!m) throw new Error(`教学模块缺失：${name}`);
  return m.hash;
}

/** 半加器（门版）：s = a⊕b（异或门），c = a∧b（与门） */
function halfAdderByModules(id: string, name: string): Design {
  const b = new DesignBuilder(id, name);
  b.module(hashOf('异或门'), { a: 'a', b: 'b', y: 's' }, 'X1');
  b.module(hashOf('与门'), { a: 'a', b: 'b', y: 'c' }, 'A1');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('s', 'out', 's');
  b.port('c', 'out', 'c');
  return b.build();
}

/** 全加器（门版）：经典 9 与非门，结构同参考解，但每个与非门都是模块积木 */
function fullAdderByModules(id: string, name: string): Design {
  const b = new DesignBuilder(id, name);
  const nand = hashOf('与非门');
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
function adderByModules(width: number, id: string, name: string): Design {
  const b = new DesignBuilder(id, name);
  const aNets = Array.from({ length: width }, (_, i) => `a${i}`);
  const bNets = Array.from({ length: width }, (_, i) => `b${i}`);
  const yNets = Array.from({ length: width }, (_, i) => `y${i}`);
  let carry = 'gnd';
  for (let i = 0; i < width; i++) {
    const next = i === width - 1 ? 'cout' : `c${i}`;
    b.module(
      hashOf('全加器'),
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
function aluByModules(id: string, name: string): Design {
  const b = new DesignBuilder(id, name);
  const aNets = Array.from({ length: 4 }, (_, i) => `a${i}`);
  const bNets = Array.from({ length: 4 }, (_, i) => `b${i}`);
  const tNets = Array.from({ length: 4 }, (_, i) => `t${i}`);
  const yNets = Array.from({ length: 4 }, (_, i) => `y${i}`);
  const xor = hashOf('异或门');
  for (let i = 0; i < 4; i++)
    b.module(xor, { a: 'op', b: bNets[i] as string, y: tNets[i] as string }, `X${i}`);
  let carry = 'op';
  const fa = hashOf('全加器');
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
function xorByModules(id: string, name: string): Design {
  const b = new DesignBuilder(id, name);
  const nand = hashOf('与非门');
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
function xnorByModules(id: string, name: string): Design {
  const b = new DesignBuilder(id, name);
  b.module(hashOf('异或门'), { a: 'a', b: 'b', y: 'x' }, 'X1');
  b.module(hashOf('非门'), { a: 'x', y: 'y' }, 'N1');
  b.port('a', 'in', 'a');
  b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return b.build();
}

/** 与非门 SR 锁存器（门版）：2 个【与非门】交叉耦合，低有效置位/复位 */
function srLatchByModules(id: string, name: string): Design {
  const b = new DesignBuilder(id, name);
  const nand = hashOf('与非门');
  b.module(nand, { a: 'sn', b: 'qn', y: 'q' }, 'G1');
  b.module(nand, { a: 'rn', b: 'q', y: 'qn' }, 'G2');
  b.port('sn', 'in', 'sn');
  b.port('rn', 'in', 'rn');
  b.port('q', 'out', 'q');
  b.port('qn', 'out', 'qn');
  return b.build();
}

/** 门控 D 锁存器（门版）：【非门】造 d̄ + 4 个【与非门】（2 门控 + 2 锁存） */
function dLatchByModules(id: string, name: string): Design {
  const b = new DesignBuilder(id, name);
  const nand = hashOf('与非门');
  b.module(hashOf('非门'), { a: 'd', y: 'nd' }, 'N1');
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
function dffByModules(id: string, name: string): Design {
  const b = new DesignBuilder(id, name);
  b.module(hashOf('非门'), { a: 'clk', y: 'nclk' }, 'N1');
  b.module(hashOf('D锁存器'), { d: 'd', en: 'nclk', q: 'm', qn: 'mqn' }, 'MASTER');
  b.module(hashOf('D锁存器'), { d: 'm', en: 'clk', q: 'q', qn: 'qn' }, 'SLAVE');
  b.port('d', 'in', 'd');
  b.port('clk', 'in', 'clk');
  b.port('q', 'out', 'q');
  b.port('qn', 'out', 'qn');
  return b.build();
}

/** 某关卡有没有逻辑门版参考解；没有返回 null（此时退元件版即可） */
export function teachingSolutionOf(levelId: string): Design | null {
  switch (levelId) {
    case 's1-xor':
      return xorByModules('teach-s1-xor', '异或门（门版）');
    case 's1-xnor':
      return xnorByModules('teach-s1-xnor', '同或门（门版）');
    case 's2-sr-latch':
      return srLatchByModules('teach-s2-sr', 'SR锁存器（门版）');
    case 's2-d-latch':
      return dLatchByModules('teach-s2-dl', 'D锁存器（门版）');
    case 's2-dff':
    case 's2-dff-cost':
    case 's2-dff-fast':
      return dffByModules(`teach-${levelId}`, 'D触发器（门版）');
    case 's3-half-adder':
      return halfAdderByModules('teach-s3-ha', '半加器（门版）');
    case 's3-full-adder':
      return fullAdderByModules('teach-s3-fa', '全加器（门版）');
    case 's3-adder-4':
      return adderByModules(4, 'teach-s3-a4', '4位加法器（门版）');
    case 's3-adder-8':
      return adderByModules(8, 'teach-s3-a8', '8位加法器（门版）');
    case 's3-alu':
      return aluByModules('teach-s3-alu', '简易ALU（门版）');
    default:
      return null;
  }
}
