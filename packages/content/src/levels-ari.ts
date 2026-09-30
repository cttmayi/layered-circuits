/**
 * 阶段 3（算术单元）关卡内容 —— GDD 阶段 3：位宽（总线）从这里正式登场。
 *
 * 三步走：半加器（会加 1 位）→ 全加器（进位也参与）→ 4/8 位加法器（把全加器串起来，端口变总线）。
 * 压轴：简易 ALU（加减一体，op 位选加法/减法）。
 *
 * 与阶段 1/2 的差别：
 *  - **端口带位宽**：a[3:0]、b[3:0]、y[3:0] 是 4 位总线（LevelVector 直接写数值：a: 5）；
 *  - **判定按数值**：加法器没有「逐行真值表」，向量就是几组代表性算式，比的是算术结果；
 *  - **模块复用是正道**：4/8 位加法器就该拖【全加器】出来拼，手搭反而贵。
 */

import {
  budgetFromOptimal,
  type Level,
  type LevelVector,
  type ModulePort,
  parseLevel,
} from '@lc/schema';
import { adder4Ref, adder8Ref, aluRef, fullAdderRef, halfAdderRef } from './references-ari.js';

/** 阶段 3 允许的元件：仍只用 npn/res/dio（电容留给时钟/存储章节） */
const STAGE3_UNITS = ['npn', 'res', 'dio'] as const;

/** 预算线 = 标准答案 × 2（评星契约：0.5×预算 = 标准答案 = 3 星档） */
const MAIN_OVERHEAD = 1.0;

function port(name: string, dir: 'in' | 'out', width = 1): ModulePort {
  return { id: name, name, dir, width };
}

/** 半加器：a+b → s（和）、c（进位），成本 84（异或 4 与非门 + 进位 2 与非门） */
const HALF_ADDER: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-half-adder',
  stage: 3,
  kind: 'main',
  title: '半加器',
  brief:
    '把两个 1 位二进制数加起来：s 是「和」，c 是「进位」。1+1=10：和是 0，进位 1。这就是所有加法的种子。',
  teaching:
    '半加器 = 异或门 + 与门：异或出「和」（两个输入不同才为 1），与门出「进位」（两个都是 1 才进位）。' +
    '用库里的【异或门】和【与门】拼最快——这正是封装模块的意义。注意：进位 c 是弱 1（二极管与门），' +
    '本关输出端能认；但下一关它要喂进别的门，就非换强驱动不可了。',
  hint: 's = a⊕b（异或门），c = a∧b（与门）。拖一个【异或门】接 s，拖一个【与门】接 c。',
  ports: [port('a', 'in'), port('b', 'in'), port('s', 'out'), port('c', 'out')],
  mode: 'logic',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(120, MAIN_OVERHEAD),
  optimalHalf: 120,
  checks: {},
  vectors: [
    { inputs: { a: 0, b: 0 }, expect: { s: 0, c: 0 }, note: '0+0=0' },
    { inputs: { a: 0, b: 1 }, expect: { s: 1, c: 0 }, note: '0+1=1' },
    { inputs: { a: 1, b: 0 }, expect: { s: 1, c: 0 }, note: '1+0=1' },
    { inputs: { a: 1, b: 1 }, expect: { s: 0, c: 1 }, note: '1+1=10（进 1）' },
  ] satisfies LevelVector[],
  unlock: {
    name: '半加器',
    kind: 'logic',
    stage: 3,
    ports: [port('a', 'in'), port('b', 'in'), port('s', 'out'), port('c', 'out')],
  },
  referenceSolution: halfAdderRef('ref-s3-ha'),
});

/** 全加器：a+b+cin → s、cout，成本 126（经典 9 与非门，强驱动可级联） */
const FULL_ADDER: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-full-adder',
  stage: 3,
  kind: 'main',
  title: '全加器',
  brief:
    '比半加器多一个 cin（低位的进位进来）。多位加法时，第 i 位的进位来自第 i-1 位——所以加法器必须会「吃进位、吐进位」。',
  teaching:
    's = a⊕b⊕cin，cout = (a∧b) ∨ (cin∧(a⊕b))。经典 TTL 搭法：9 个【与非门】。' +
    '先算 t1=¬(ab)、x=a⊕b（上关的异或套路），再 t4=¬(x·cin)，s = x⊕cin 同套路，' +
    'cout = ¬(t1·t4) = ab ∨ (x·cin)。注意：进位链必须强驱动——二极管门（弱 1）喂不进下一级。',
  hint:
    '9 个【与非门】：t1=¬(ab)，t2=¬(a·t1)，t3=¬(b·t1)，x=¬(t2·t3)=a⊕b；t4=¬(x·cin)，' +
    's 用 x 与 cin 再走一遍异或套路，cout=¬(t1·t4)。',
  ports: [
    port('a', 'in'),
    port('b', 'in'),
    port('cin', 'in'),
    port('s', 'out'),
    port('cout', 'out'),
  ],
  mode: 'logic',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(180, MAIN_OVERHEAD),
  optimalHalf: 180,
  checks: {},
  vectors: [
    { inputs: { a: 0, b: 0, cin: 0 }, expect: { s: 0, cout: 0 } },
    { inputs: { a: 0, b: 1, cin: 0 }, expect: { s: 1, cout: 0 } },
    { inputs: { a: 1, b: 0, cin: 0 }, expect: { s: 1, cout: 0 } },
    { inputs: { a: 1, b: 1, cin: 0 }, expect: { s: 0, cout: 1 } },
    { inputs: { a: 0, b: 0, cin: 1 }, expect: { s: 1, cout: 0 } },
    { inputs: { a: 0, b: 1, cin: 1 }, expect: { s: 0, cout: 1 } },
    { inputs: { a: 1, b: 0, cin: 1 }, expect: { s: 0, cout: 1 } },
    { inputs: { a: 1, b: 1, cin: 1 }, expect: { s: 1, cout: 1 } },
  ] satisfies LevelVector[],
  unlock: {
    name: '全加器',
    kind: 'logic',
    stage: 3,
    ports: [
      port('a', 'in'),
      port('b', 'in'),
      port('cin', 'in'),
      port('s', 'out'),
      port('cout', 'out'),
    ],
  },
  referenceSolution: fullAdderRef('ref-s3-fa'),
});

/** 4 位加法器：a[3:0] + b[3:0] → y[3:0], cout，成本 504（4 个全加器） */
const ADDER_4: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-adder-4',
  stage: 3,
  kind: 'main',
  title: '4位加法器',
  brief:
    '总线登场：a 和 b 是 4 位数值（0~15），y 是 4 位和，cout 是最高位进位。5+3=8、15+1=16（y 回到 0，cout=1）。',
  teaching:
    '把 4 个【全加器】串成行波进位：第 i 位的 cout 接第 i+1 位的 cin，最低位 cin 接地。' +
    'a 的每一位接一个全加器的 a，b 同理——这就是「把位数堆上去」的全部秘密。',
  hint:
    '拖 4 个【全加器】：最低位 cin 接地，逐级 cout→cin 串联；a[i]→FAi.a，b[i]→FAi.b，s→y[i]。' +
    '端口点一下会高亮这一位，别接错位。',
  ports: [port('a', 'in', 4), port('b', 'in', 4), port('y', 'out', 4), port('cout', 'out')],
  mode: 'logic',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(720, MAIN_OVERHEAD),
  optimalHalf: 720,
  checks: {},
  vectors: [
    { inputs: { a: 0, b: 0 }, expect: { y: 0, cout: 0 }, note: '0+0=0' },
    { inputs: { a: 5, b: 3 }, expect: { y: 8, cout: 0 }, note: '5+3=8' },
    { inputs: { a: 9, b: 6 }, expect: { y: 15, cout: 0 }, note: '9+6=15' },
    { inputs: { a: 7, b: 8 }, expect: { y: 15, cout: 0 }, note: '7+8=15' },
    { inputs: { a: 15, b: 1 }, expect: { y: 0, cout: 1 }, note: '15+1=16 溢出进位' },
    { inputs: { a: 12, b: 13 }, expect: { y: 9, cout: 1 }, note: '12+13=25=16+9' },
    { inputs: { a: 10, b: 5 }, expect: { y: 15, cout: 0 }, note: '10+5=15' },
    { inputs: { a: 3, b: 4 }, expect: { y: 7, cout: 0 }, note: '3+4=7' },
  ] satisfies LevelVector[],
  unlock: {
    name: '4位加法器',
    kind: 'logic',
    stage: 3,
    ports: [port('a', 'in', 4), port('b', 'in', 4), port('y', 'out', 4), port('cout', 'out')],
  },
  referenceSolution: adder4Ref('ref-s3-adder4'),
});

/** 8 位加法器：a[7:0] + b[7:0] → y[7:0], cout，成本 1008（8 个全加器） */
const ADDER_8: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-adder-8',
  stage: 3,
  kind: 'main',
  title: '8位加法器',
  brief:
    '位数翻倍：a、b 是 0~255。200+55=255、255+1=256（y 回到 0，cout=1）。8 位就是计算机里一个字节。',
  teaching:
    '跟上关完全一样的套路，只是把 4 个全加器换成 8 个。能堆 4 位就能堆 8 位——位数从来不改变原理，' +
    '只改变要拖的模块个数。',
  hint: '拖 8 个【全加器】串起来。a[i]、b[i] 都从左边总线端口引出（端口上标了位号），进位链 cout→cin 一路串到 cout 端口。',
  ports: [port('a', 'in', 8), port('b', 'in', 8), port('y', 'out', 8), port('cout', 'out')],
  mode: 'logic',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(1440, MAIN_OVERHEAD),
  optimalHalf: 1440,
  checks: {},
  vectors: [
    { inputs: { a: 0, b: 0 }, expect: { y: 0, cout: 0 }, note: '0+0=0' },
    { inputs: { a: 1, b: 1 }, expect: { y: 2, cout: 0 }, note: '1+1=2' },
    { inputs: { a: 100, b: 50 }, expect: { y: 150, cout: 0 }, note: '100+50=150' },
    { inputs: { a: 127, b: 1 }, expect: { y: 128, cout: 0 }, note: '127+1=128' },
    { inputs: { a: 200, b: 55 }, expect: { y: 255, cout: 0 }, note: '200+55=255' },
    { inputs: { a: 170, b: 85 }, expect: { y: 255, cout: 0 }, note: '170+85=255' },
    { inputs: { a: 255, b: 1 }, expect: { y: 0, cout: 1 }, note: '255+1=256 溢出进位' },
    { inputs: { a: 64, b: 64 }, expect: { y: 128, cout: 0 }, note: '64+64=128' },
  ] satisfies LevelVector[],
  unlock: {
    name: '8位加法器',
    kind: 'logic',
    stage: 3,
    ports: [port('a', 'in', 8), port('b', 'in', 8), port('y', 'out', 8), port('cout', 'out')],
  },
  referenceSolution: adder8Ref('ref-s3-adder8'),
});

/** 简易 ALU：op=0 → y=a+b；op=1 → y=a-b。成本 728 */
const ALU: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-alu',
  stage: 3,
  kind: 'main',
  title: '简易ALU',
  brief:
    '运算单元（Arithmetic Logic Unit）的雏形：一个 op 开关决定做加法还是减法。8-3=5、12-5=7——减法靠补码，原理还是加法。',
  teaching:
    'a-b = a + (~b) + 1。做法：op 接每个 b 位的异或门（op=1 时 b 取反），再把 op 接进最低位的进位——' +
    '同一个 op 同时完成了「取反」和「加 1」，这就是补码的精髓。',
  hint:
    '每个 b[i] 先过一个【异或门】（另一端接 op），输出 t[i]；然后 4 个【全加器】算 a + t，' +
    '最低位 cin 接 op（不是接地）。y 就是结果。',
  ports: [port('op', 'in'), port('a', 'in', 4), port('b', 'in', 4), port('y', 'out', 4)],
  mode: 'logic',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(1040, MAIN_OVERHEAD),
  optimalHalf: 1040,
  checks: {},
  vectors: [
    { inputs: { op: 0, a: 5, b: 3 }, expect: { y: 8 }, note: '加法 5+3=8' },
    { inputs: { op: 0, a: 9, b: 6 }, expect: { y: 15 }, note: '加法 9+6=15' },
    { inputs: { op: 0, a: 15, b: 1 }, expect: { y: 0 }, note: '加法 15+1=16 溢出回 0' },
    { inputs: { op: 1, a: 8, b: 3 }, expect: { y: 5 }, note: '减法 8-3=5' },
    { inputs: { op: 1, a: 15, b: 7 }, expect: { y: 8 }, note: '减法 15-7=8' },
    { inputs: { op: 1, a: 4, b: 4 }, expect: { y: 0 }, note: '减法 4-4=0' },
    { inputs: { op: 1, a: 12, b: 5 }, expect: { y: 7 }, note: '减法 12-5=7' },
    { inputs: { op: 1, a: 10, b: 9 }, expect: { y: 1 }, note: '减法 10-9=1' },
  ] satisfies LevelVector[],
  unlock: {
    name: '简易ALU',
    kind: 'logic',
    stage: 3,
    ports: [port('op', 'in'), port('a', 'in', 4), port('b', 'in', 4), port('y', 'out', 4)],
  },
  referenceSolution: aluRef('ref-s3-alu'),
});

/** 阶段 3 关卡，顺序即解锁顺序 */
export const STAGE3_LEVELS: Level[] = [HALF_ADDER, FULL_ADDER, ADDER_4, ADDER_8, ALU];
