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
import { andGateRef, nandGateRef, xorGateRef } from './references.js';
import { fullAdderRef } from './references-ari.js';

/** 门级参考解都是纯底层元件，空库即可封装（hash 由内容决定，稳定可复现） */
const EMPTY_LIB = new InMemoryModuleLibrary();

function wrapGate(name: string, body: Design, kind: ModuleKind): ModuleTemplate {
  const { template } = wrapModule({ name, stage: 3, kind, ports: body.ports, body }, EMPTY_LIB);
  return template;
}

/** 教学用门级模块（内容哈希确定） */
export const TEACHING_MODULES: readonly ModuleTemplate[] = [
  wrapGate('与非门', nandGateRef(), 'logic'),
  wrapGate('异或门', xorGateRef(), 'logic'),
  wrapGate('与门', andGateRef(), 'logic'),
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

/** 某关卡有没有逻辑门版参考解；没有返回 null（此时退元件版即可） */
export function teachingSolutionOf(levelId: string): Design | null {
  switch (levelId) {
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
