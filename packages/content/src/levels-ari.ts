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
import { or4Ref } from './references.js';
import {
  adder4Ref,
  adder8Ref,
  aluRef,
  fullAdderRef,
  halfAdderRef,
  segABCRef,
  segDERef,
  segFGRef,
  segTermRef,
} from './references-ari.js';
import { bcd2binRef, bin2bcdRef, calcRef, reg8Ref, seg7x2Ref } from './references-calc.js';
import { digitEntryRef, encoderOrRef } from './references-keypad.js';

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

/**
 * BCD → 二进制：bcd[7:4] 是十位、bcd[3:0] 是个位（各 4 位 BCD，0-9），bin 是 7 位二进制（0-99）。
 * 算术真相：十进制 23 的 BCD 编码是 0010 0011，它作为「总线数值」是 0x23（=35 十进制）——
 * 向量里 bcd: 0x23 表示「数字 23」。bin = 十位×10 + 个位 = 十位×8 + 十位×2 + 个位（移位加权）。
 */
const BCD2BIN: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-bcd2bin',
  stage: 3,
  kind: 'main',
  title: 'BCD → 二进制',
  brief:
    '把十进制数（每位 0~9 的 BCD 编码）翻译成真正的二进制数，为计算器铺路。数字 23 在 BCD 里是 0010 0011，翻译后是 10111。',
  teaching:
    'bin = 十位×10 + 个位，而 ×10 = ×8 + ×2——把十位左移 3 位（×8）再左移 1 位（×2），' +
    '和个位一起用加法器合并。移位不用元件，只是把线接对位置。',
  hint:
    '十位 t 接两处：t 左移 1 位（bit1~4）和 t 左移 3 位（bit3~6）；先用 5 位加法器算 个位+2t，' +
    '再算 8t 相加（接在 bit3~6），结果就是 bin。',
  ports: [port('bcd', 'in', 8), port('bin', 'out', 7)],
  mode: 'logic',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(2160, MAIN_OVERHEAD),
  optimalHalf: 2160,
  checks: {},
  vectors: [
    { inputs: { bcd: 0x00 }, expect: { bin: 0 }, note: '0 → 0' },
    { inputs: { bcd: 0x05 }, expect: { bin: 5 }, note: '5 → 5' },
    { inputs: { bcd: 0x09 }, expect: { bin: 9 }, note: '9 → 9' },
    { inputs: { bcd: 0x10 }, expect: { bin: 10 }, note: '10 → 10(0b1010)' },
    { inputs: { bcd: 0x23 }, expect: { bin: 23 }, note: '23 → 23(0b10111)' },
    { inputs: { bcd: 0x50 }, expect: { bin: 50 }, note: '50 → 50(0b110010)' },
    { inputs: { bcd: 0x67 }, expect: { bin: 67 }, note: '67 → 67(0b1000011)' },
    { inputs: { bcd: 0x99 }, expect: { bin: 99 }, note: '99 → 99(0b1100011)' },
  ] satisfies LevelVector[],
  unlock: {
    name: 'BCD→二进制',
    kind: 'logic',
    stage: 3,
    ports: [port('bcd', 'in', 8), port('bin', 'out', 7)],
  },
  referenceSolution: bcd2binRef('ref-s3-bcd2bin'),
});

/**
 * 二进制 → BCD：7 位二进制（0-99）拆成十位/个位两个 BCD 数字，计算器显示端。
 * double-dabble「加 3 移位」：每步左移 1 位，若某 4 位组 ≥5 就加 3（等价于进位纠正）。
 */
const BIN2BCD: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-bin2bcd',
  stage: 3,
  kind: 'main',
  title: '二进制 → BCD',
  brief:
    '把二进制结果变回十进制的 BCD 编码，好让七段数码管能显示。二进制 10111（23）变回 0010 0011。',
  teaching:
    'double-dabble 算法：寄存器左移 1 位，移入二进制的一位；每移完一次，检查每个 BCD 位组，' +
    '若 ≥5 就加 3（因为 4 位组移位会把 5~9 顶出界，加 3 是进位纠正）。',
  hint:
    '搭「加 3 单元」：a≥5 时输出 a+3，否则原样（门控进位：y0=a0⊕ge5，逐位异或进位链）。' +
    '然后把 7 个「左移 + 两路加 3」的台阶串起来，最后一位从 bin 最低位移入。',
  ports: [port('bin', 'in', 7), port('bcd', 'out', 8)],
  mode: 'logic',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(7872, MAIN_OVERHEAD),
  optimalHalf: 7872,
  checks: {},
  vectors: [
    { inputs: { bin: 0 }, expect: { bcd: 0x00 }, note: '0 → 00' },
    { inputs: { bin: 5 }, expect: { bcd: 0x05 }, note: '5 → 05' },
    { inputs: { bin: 9 }, expect: { bcd: 0x09 }, note: '9 → 09' },
    { inputs: { bin: 16 }, expect: { bcd: 0x16 }, note: '16 → 16(BCD)' },
    { inputs: { bin: 35 }, expect: { bcd: 0x35 }, note: '35 → 35(BCD)' },
    { inputs: { bin: 50 }, expect: { bcd: 0x50 }, note: '50 → 50' },
    { inputs: { bin: 67 }, expect: { bcd: 0x67 }, note: '67 → 67' },
    { inputs: { bin: 99 }, expect: { bcd: 0x99 }, note: '99 → 99' },
  ] satisfies LevelVector[],
  unlock: {
    name: '二进制→BCD',
    kind: 'logic',
    stage: 3,
    ports: [port('bin', 'in', 7), port('bcd', 'out', 8)],
  },
  referenceSolution: bin2bcdRef('ref-s3-bin2bcd'),
});

/** 段码积项：译码器第一步 = 4 个反相信号 + 10 个共享积项（14 个与非门，答案即教学内容） */
const S3_DISPLAY: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-display',
  stage: 3,
  kind: 'main',
  title: '段码积项',
  brief:
    '七段译码器按 0-9 的 BCD 码点亮 7 根段线，直接用与非门搭要 43 个。先拆第一步：' +
    '把 4 个输入反相信号和 10 个共享积项算出来——后面每条段线都从这 14 个中间信号取，这就是「化简靠共享中间项」。',
  teaching:
    '7 条段线是 7 个布尔函数，它们共用很多子表达式。这一关先算 4 个反相信号（nA=¬bcd0…，' +
    '与非门两输入接同一条线就是反相器：¬(x·x)=¬x）和 10 个共享积项（t1..t9、t3n）。' +
    '下一关的每条段线都从这 14 个中间信号里挑几路做与非链。',
  hint:
    '反相 4 个：nA=¬(bcd0·bcd0)、nB=¬(bcd1·bcd1)、nC=¬(bcd2·bcd2)、nD=¬(bcd3·bcd3)。' +
    '积项 10 个：t1=¬(nA·bcd1)、t2=¬(nA·nC)、t3=¬(nB·bcd2)、t4=¬(bcd1·nC)、t5=¬(bcd0·bcd2)、' +
    't6=¬(nA·nB)、t7=¬(bcd0·bcd1)、t3n=¬(t3·t3)、t8=¬(bcd0·t3n)、t9=¬(nA·bcd2)。' +
    '参考解 14 个与非门，成本 280 半单位。',
  ports: [
    port('bcd0', 'in'),
    port('bcd1', 'in'),
    port('bcd2', 'in'),
    port('bcd3', 'in'),
    port('nA', 'out'),
    port('nB', 'out'),
    port('nC', 'out'),
    port('nD', 'out'),
    port('t1', 'out'),
    port('t2', 'out'),
    port('t3', 'out'),
    port('t4', 'out'),
    port('t5', 'out'),
    port('t6', 'out'),
    port('t7', 'out'),
    port('t8', 'out'),
    port('t9', 'out'),
    port('t3n', 'out'),
  ],
  mode: 'logic',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(280, MAIN_OVERHEAD),
  optimalHalf: 280,
  checks: {},
  vectors: [
    {
      inputs: { bcd0: 0, bcd1: 0, bcd2: 0, bcd3: 0 },
      expect: {
        nA: 1,
        nB: 1,
        nC: 1,
        nD: 1,
        t1: 1,
        t2: 0,
        t3: 1,
        t4: 1,
        t5: 1,
        t6: 0,
        t7: 1,
        t8: 1,
        t9: 1,
        t3n: 0,
      },
      note: '0',
    },
    {
      inputs: { bcd0: 1, bcd1: 0, bcd2: 0, bcd3: 0 },
      expect: {
        nA: 0,
        nB: 1,
        nC: 1,
        nD: 1,
        t1: 1,
        t2: 1,
        t3: 1,
        t4: 1,
        t5: 1,
        t6: 1,
        t7: 1,
        t8: 1,
        t9: 1,
        t3n: 0,
      },
      note: '1',
    },
    {
      inputs: { bcd0: 0, bcd1: 1, bcd2: 0, bcd3: 0 },
      expect: {
        nA: 1,
        nB: 0,
        nC: 1,
        nD: 1,
        t1: 0,
        t2: 0,
        t3: 1,
        t4: 0,
        t5: 1,
        t6: 1,
        t7: 1,
        t8: 1,
        t9: 1,
        t3n: 0,
      },
      note: '2',
    },
    {
      inputs: { bcd0: 1, bcd1: 0, bcd2: 1, bcd3: 0 },
      expect: {
        nA: 0,
        nB: 1,
        nC: 0,
        nD: 1,
        t1: 1,
        t2: 1,
        t3: 0,
        t4: 1,
        t5: 0,
        t6: 1,
        t7: 1,
        t8: 0,
        t9: 1,
        t3n: 1,
      },
      note: '5',
    },
    {
      inputs: { bcd0: 0, bcd1: 0, bcd2: 0, bcd3: 1 },
      expect: {
        nA: 1,
        nB: 1,
        nC: 1,
        nD: 0,
        t1: 1,
        t2: 0,
        t3: 1,
        t4: 1,
        t5: 1,
        t6: 0,
        t7: 1,
        t8: 1,
        t9: 1,
        t3n: 0,
      },
      note: '8',
    },
    {
      inputs: { bcd0: 1, bcd1: 0, bcd2: 0, bcd3: 1 },
      expect: {
        nA: 0,
        nB: 1,
        nC: 1,
        nD: 0,
        t1: 1,
        t2: 1,
        t3: 1,
        t4: 1,
        t5: 1,
        t6: 1,
        t7: 1,
        t8: 1,
        t9: 1,
        t3n: 0,
      },
      note: '9',
    },
  ] satisfies LevelVector[],
  unlock: {
    name: '段码积项',
    kind: 'logic',
    stage: 3,
    ports: [
      port('bcd0', 'in'),
      port('bcd1', 'in'),
      port('bcd2', 'in'),
      port('bcd3', 'in'),
      port('nA', 'out'),
      port('nB', 'out'),
      port('nC', 'out'),
      port('nD', 'out'),
      port('t1', 'out'),
      port('t2', 'out'),
      port('t3', 'out'),
      port('t4', 'out'),
      port('t5', 'out'),
      port('t6', 'out'),
      port('t7', 'out'),
      port('t8', 'out'),
      port('t9', 'out'),
      port('t3n', 'out'),
    ],
  },
  referenceSolution: segTermRef('ref-s3-seg-term'),
});

/** 段码·abc：BCD → a/b/c 三条段线（1×【段码积项】 + 链 11 = 12 盒） */
const S3_SEG_ABC: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-seg-abc',
  stage: 3,
  kind: 'main',
  title: '段码·abc',
  brief:
    '数码管上半部分的 3 条段线（a 顶横、b 右上竖、c 右下竖）各是一个布尔函数。从上一关的 14 个中间信号里挑几路做与非链，把它们搭出来。',
  teaching:
    '每条段线 = 从中间信号里挑几路做「链式与非」：先两两与非，需要时中间反相，最后得到 ¬(几个信号的与)。' +
    '比如 a = ¬(t2·t5·nB·nD)、b = ¬(t6·t7·bcd2)、c = ¬(nA·bcd1·nC)。这就是「把多个条件合并成一个输出」的技巧。',
  hint: '拖 1 个【段码积项】模块 + 11 个【与非门】：a=¬(t2·t5·nB·nD)、b=¬(t6·t7·bcd2)、c=¬(nA·bcd1·nC)。参考解 12 盒，成本 500 半单位。',
  ports: [
    port('bcd0', 'in'),
    port('bcd1', 'in'),
    port('bcd2', 'in'),
    port('bcd3', 'in'),
    port('a', 'out'),
    port('b', 'out'),
    port('c', 'out'),
  ],
  mode: 'logic',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(500, MAIN_OVERHEAD),
  optimalHalf: 500,
  checks: {},
  vectors: [
    { inputs: { bcd0: 0, bcd1: 0, bcd2: 0, bcd3: 0 }, expect: { a: 1, b: 1, c: 1 }, note: '0' },
    { inputs: { bcd0: 1, bcd1: 0, bcd2: 0, bcd3: 0 }, expect: { a: 0, b: 1, c: 1 }, note: '1' },
    { inputs: { bcd0: 0, bcd1: 1, bcd2: 0, bcd3: 0 }, expect: { a: 1, b: 1, c: 0 }, note: '2' },
    { inputs: { bcd0: 1, bcd1: 1, bcd2: 0, bcd3: 0 }, expect: { a: 1, b: 1, c: 1 }, note: '3' },
    { inputs: { bcd0: 0, bcd1: 0, bcd2: 1, bcd3: 0 }, expect: { a: 0, b: 1, c: 1 }, note: '4' },
    { inputs: { bcd0: 1, bcd1: 0, bcd2: 1, bcd3: 0 }, expect: { a: 1, b: 0, c: 1 }, note: '5' },
    { inputs: { bcd0: 0, bcd1: 1, bcd2: 1, bcd3: 0 }, expect: { a: 1, b: 0, c: 1 }, note: '6' },
    { inputs: { bcd0: 1, bcd1: 1, bcd2: 1, bcd3: 0 }, expect: { a: 1, b: 1, c: 1 }, note: '7' },
    { inputs: { bcd0: 0, bcd1: 0, bcd2: 0, bcd3: 1 }, expect: { a: 1, b: 1, c: 1 }, note: '8' },
    { inputs: { bcd0: 1, bcd1: 0, bcd2: 0, bcd3: 1 }, expect: { a: 1, b: 1, c: 1 }, note: '9' },
  ] satisfies LevelVector[],
  unlock: {
    name: '段码abc',
    kind: 'logic',
    stage: 3,
    ports: [
      port('bcd0', 'in'),
      port('bcd1', 'in'),
      port('bcd2', 'in'),
      port('bcd3', 'in'),
      port('a', 'out'),
      port('b', 'out'),
      port('c', 'out'),
    ],
  },
  referenceSolution: segABCRef('ref-s3-seg-abc'),
});

/** 段码·de：BCD → d/e 两条段线（1×【段码积项】 + 链 8 = 9 盒） */
const S3_SEG_DE: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-seg-de',
  stage: 3,
  kind: 'main',
  title: '段码·de',
  brief: '中段的 2 条段线（d 底横、e 左下竖）。和前两关同样的手法：挑中间信号做与非链。',
  teaching: 'd = ¬(t1·t2·t8·t4·nD)、e = ¬(t1·t2)。e 只要 2 路，一条链 2 个与非门就行。',
  hint: '拖 1 个【段码积项】+ 8 个【与非门】：d=¬(t1·t2·t8·t4·nD)、e=¬(t1·t2)。参考解 9 盒，成本 440 半单位。',
  ports: [
    port('bcd0', 'in'),
    port('bcd1', 'in'),
    port('bcd2', 'in'),
    port('bcd3', 'in'),
    port('d', 'out'),
    port('e', 'out'),
  ],
  mode: 'logic',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(440, MAIN_OVERHEAD),
  optimalHalf: 440,
  checks: {},
  vectors: [
    { inputs: { bcd0: 0, bcd1: 0, bcd2: 0, bcd3: 0 }, expect: { d: 1, e: 1 }, note: '0' },
    { inputs: { bcd0: 1, bcd1: 0, bcd2: 0, bcd3: 0 }, expect: { d: 0, e: 0 }, note: '1' },
    { inputs: { bcd0: 0, bcd1: 1, bcd2: 0, bcd3: 0 }, expect: { d: 1, e: 1 }, note: '2' },
    { inputs: { bcd0: 1, bcd1: 1, bcd2: 0, bcd3: 0 }, expect: { d: 1, e: 0 }, note: '3' },
    { inputs: { bcd0: 0, bcd1: 0, bcd2: 1, bcd3: 0 }, expect: { d: 0, e: 0 }, note: '4' },
    { inputs: { bcd0: 1, bcd1: 0, bcd2: 1, bcd3: 0 }, expect: { d: 1, e: 0 }, note: '5' },
    { inputs: { bcd0: 0, bcd1: 1, bcd2: 1, bcd3: 0 }, expect: { d: 1, e: 1 }, note: '6' },
    { inputs: { bcd0: 1, bcd1: 1, bcd2: 1, bcd3: 0 }, expect: { d: 0, e: 0 }, note: '7' },
    { inputs: { bcd0: 0, bcd1: 0, bcd2: 0, bcd3: 1 }, expect: { d: 1, e: 1 }, note: '8' },
    { inputs: { bcd0: 1, bcd1: 0, bcd2: 0, bcd3: 1 }, expect: { d: 1, e: 0 }, note: '9' },
  ] satisfies LevelVector[],
  unlock: {
    name: '段码de',
    kind: 'logic',
    stage: 3,
    ports: [
      port('bcd0', 'in'),
      port('bcd1', 'in'),
      port('bcd2', 'in'),
      port('bcd3', 'in'),
      port('d', 'out'),
      port('e', 'out'),
    ],
  },
  referenceSolution: segDERef('ref-s3-seg-de'),
});

/** 段码·fg：BCD → f/g 两条段线（1×【段码积项】 + 链 10 = 11 盒） */
const S3_SEG_FG: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-seg-fg',
  stage: 3,
  kind: 'main',
  title: '段码·fg',
  brief: '低段的 2 条段线（f 左上竖、g 中横）。7 条段线全部搭完，译码器就齐了。',
  teaching: 'f = ¬(t6·t9·t3·nD)、g = ¬(t1·t3·t4·nD)。',
  hint: '拖 1 个【段码积项】+ 10 个【与非门】：f=¬(t6·t9·t3·nD)、g=¬(t1·t3·t4·nD)。参考解 11 盒，成本 480 半单位。',
  ports: [
    port('bcd0', 'in'),
    port('bcd1', 'in'),
    port('bcd2', 'in'),
    port('bcd3', 'in'),
    port('f', 'out'),
    port('g', 'out'),
  ],
  mode: 'logic',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(480, MAIN_OVERHEAD),
  optimalHalf: 480,
  checks: {},
  vectors: [
    { inputs: { bcd0: 0, bcd1: 0, bcd2: 0, bcd3: 0 }, expect: { f: 1, g: 0 }, note: '0' },
    { inputs: { bcd0: 1, bcd1: 0, bcd2: 0, bcd3: 0 }, expect: { f: 0, g: 0 }, note: '1' },
    { inputs: { bcd0: 0, bcd1: 1, bcd2: 0, bcd3: 0 }, expect: { f: 0, g: 1 }, note: '2' },
    { inputs: { bcd0: 1, bcd1: 1, bcd2: 0, bcd3: 0 }, expect: { f: 0, g: 1 }, note: '3' },
    { inputs: { bcd0: 0, bcd1: 0, bcd2: 1, bcd3: 0 }, expect: { f: 1, g: 1 }, note: '4' },
    { inputs: { bcd0: 1, bcd1: 0, bcd2: 1, bcd3: 0 }, expect: { f: 1, g: 1 }, note: '5' },
    { inputs: { bcd0: 0, bcd1: 1, bcd2: 1, bcd3: 0 }, expect: { f: 1, g: 1 }, note: '6' },
    { inputs: { bcd0: 1, bcd1: 1, bcd2: 1, bcd3: 0 }, expect: { f: 0, g: 0 }, note: '7' },
    { inputs: { bcd0: 0, bcd1: 0, bcd2: 0, bcd3: 1 }, expect: { f: 1, g: 1 }, note: '8' },
    { inputs: { bcd0: 1, bcd1: 0, bcd2: 0, bcd3: 1 }, expect: { f: 1, g: 1 }, note: '9' },
  ] satisfies LevelVector[],
  unlock: {
    name: '段码fg',
    kind: 'logic',
    stage: 3,
    ports: [
      port('bcd0', 'in'),
      port('bcd1', 'in'),
      port('bcd2', 'in'),
      port('bcd3', 'in'),
      port('f', 'out'),
      port('g', 'out'),
    ],
  },
  referenceSolution: segFGRef('ref-s3-seg-fg'),
});

/** 数码管显示：2 位数码管 = 2× 七段译码器模块（复用上一关产物），教学点 = 模块复用/位宽扩展 */
const S3_DISPLAY2: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-display2',
  stage: 3,
  kind: 'main',
  title: '数码管显示',
  brief:
    '一台两位数计算器需要 2 个数码管。7 条段线前面已经分 4 关搭完了——这一关把 3 个段模块各复制一份，一个管十位、一个管个位。',
  teaching:
    '组件库里现在有【段码abc】【段码de】【段码fg】三个段模块，合起来就是完整的七段译码器。' +
    '这一关放两组：D1 接十位 bcd1、D2 接个位 bcd2，各自的 7 根段线接到对应数码管。' +
    '这就是「模块复用」——逻辑只搭一遍，位宽从 1 位扩到 2 位只靠复制粘贴加并线。',
  hint: '从左侧「我的模块」拖 2 组【段码abc】【段码de】【段码fg】：bcd1 → D1、bcd2 → D2，D1 的 a-g → seg1、D2 的 a-g → seg2。参考解 = 2× 七段译码器（或 6 个段模块），成本 1720 半单位（2×860）。',
  ports: [
    port('bcd1', 'in', 4),
    port('bcd2', 'in', 4),
    { id: 'seg1', name: 'seg1', dir: 'out', width: 7, display: 'segment' },
    { id: 'seg2', name: 'seg2', dir: 'out', width: 7, display: 'segment' },
  ],
  mode: 'logic',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(1720, MAIN_OVERHEAD),
  optimalHalf: 1720,
  checks: {},
  vectors: [
    { inputs: { bcd1: 0, bcd2: 0 }, expect: { seg1: 0x3f, seg2: 0x3f }, note: '00 → 两个 0' },
    { inputs: { bcd1: 1, bcd2: 2 }, expect: { seg1: 0x06, seg2: 0x5b }, note: '12 → 1 和 2' },
    { inputs: { bcd1: 3, bcd2: 4 }, expect: { seg1: 0x4f, seg2: 0x66 }, note: '34' },
    { inputs: { bcd1: 5, bcd2: 6 }, expect: { seg1: 0x6d, seg2: 0x7d }, note: '56' },
    { inputs: { bcd1: 7, bcd2: 8 }, expect: { seg1: 0x07, seg2: 0x7f }, note: '78' },
    { inputs: { bcd1: 9, bcd2: 9 }, expect: { seg1: 0x6f, seg2: 0x6f }, note: '99' },
  ] satisfies LevelVector[],
  unlock: {
    name: '双数码管显示',
    kind: 'logic',
    stage: 3,
    ports: [
      port('bcd1', 'in', 4),
      port('bcd2', 'in', 4),
      { id: 'seg1', name: 'seg1', dir: 'out', width: 7 },
      { id: 'seg2', name: 'seg2', dir: 'out', width: 7 },
    ],
  },
  referenceSolution: seg7x2Ref('ref-s3-display2'),
});

/** 计算器链的锁存台阶：8 个 D 触发器并排共用 clk，数据「存下来」。 */
const REG_8: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-reg-8',
  stage: 3,
  kind: 'main',
  title: '八位寄存器',
  brief:
    '把 8 位数据锁存住：clk 上升沿把 d[7:0] 整体搬进 q[7:0]，其它时候 q 纹丝不动。这是计算器「按完等号结果留下」的存储器。',
  teaching:
    '寄存器 = 8 个 D 触发器并排：所有 clk 接同一个时钟，每一位的 d[i]→q[i]。' +
    '「位宽扩展」到此完全自动化——从 1 位到 8 位只是复制粘贴加并线。',
  hint:
    '拖 8 个【D触发器】：clk 全部接到 clk 端口，d[i] 接各自位、q[i] 输出。' +
    '参考解约 1568 半单位（8 个触发器 × 196）。',
  mode: 'timing',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(1568, MAIN_OVERHEAD),
  optimalHalf: 1568,
  ports: [port('d', 'in', 8), port('clk', 'in'), port('q', 'out', 8)],
  checks: { clockPort: 'clk' },
  vectors: [
    { inputs: { clk: 0, d: 0x00 }, settlePs: 25_000, note: '建立初态' },
    { inputs: { clk: 1, d: 0x00 }, expect: { q: 0x00 }, settlePs: 25_000, note: '上升沿锁存 0' },
    {
      inputs: { clk: 0, d: 0xa5 },
      expect: { q: 0x00 },
      settlePs: 25_000,
      note: '低电平改数据，不影响',
    },
    {
      inputs: { clk: 1, d: 0xa5 },
      expect: { q: 0xa5 },
      settlePs: 25_000,
      note: '上升沿锁存 10100101',
    },
    {
      inputs: { clk: 1, d: 0x3c },
      expect: { q: 0xa5 },
      settlePs: 25_000,
      note: '高电平改数据，纹丝不动',
    },
    { inputs: { clk: 0, d: 0x3c }, expect: { q: 0xa5 }, settlePs: 25_000, note: '下降沿不搬运' },
    { inputs: { clk: 1, d: 0x3c }, expect: { q: 0x3c }, settlePs: 25_000, note: '再锁存 00111100' },
  ] satisfies LevelVector[],
  unlock: {
    name: '八位寄存器',
    kind: 'seq',
    stage: 3,
    ports: [port('d', 'in', 8), port('clk', 'in'), port('q', 'out', 8)],
  },
  referenceSolution: reg8Ref('ref-s3-reg8'),
});

/**
 * 数字键盘编码器：10 个数字键（d0-d9，一次按一个）→ 4 位 BCD 码 + 任意键脉冲。
 * 与 s3-display 的译码器正好对称：译码器把 4 位码展开成 7 段，编码器把 10 根线缩成 4 位码。
 */
/**
 * 多输入或门：a+b+c+d → y。s3-or-chain 教「或门支持任意多输入」——或门 = 二极管并联，
 * 多输入 = 更多二极管并联（或门原理的直接扩展）。编码器要把很多键「或」成一根线，
 * 就是这种多输入或门；产出【多输入或门】积木供编码器拼 or 矩阵。
 */
const S3_OR_CHAIN: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-or-chain',
  stage: 3,
  kind: 'main',
  title: '多输入或门',
  brief:
    '或门你已经会了：a 或 b 为 1 输出就是 1。现在把它扩展成 4 输入：a、b、c、d 任意一个为 1，' +
    'y 就是 1。多输入或门是编码器（键盘 → 4 位码）的砖块——每条输出码线都要把好几根键线「或」起来。',
  teaching:
    '或门的原理是二极管并联：每根输入接一个二极管、共用下拉电阻，任一输入为 1 就把输出拉高。' +
    '多输入或门没有新知识——只是并联更多二极管（或把几个或门级联）。想一想：4 输入或门和 2 输入或门，' +
    '电路差在哪里？',
  hint: '参考解就是 4 个二极管 + 1 个下拉电阻（和 s2 或门一模一样，只是二极管多两个）。成本 6 半单位。',
  ports: [
    { id: 'a', name: 'a', dir: 'in' },
    { id: 'b', name: 'b', dir: 'in' },
    { id: 'c', name: 'c', dir: 'in' },
    { id: 'd', name: 'd', dir: 'in' },
    { id: 'y', name: 'y', dir: 'out' },
  ],
  mode: 'logic',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(12, MAIN_OVERHEAD),
  optimalHalf: 12,
  checks: {},
  vectors: [
    { inputs: { a: 0, b: 0, c: 0, d: 0 }, expect: { y: 0 }, note: '全 0 → 0' },
    { inputs: { a: 1, b: 0, c: 0, d: 0 }, expect: { y: 1 }, note: 'a=1 → 1' },
    { inputs: { a: 0, b: 1, c: 0, d: 0 }, expect: { y: 1 }, note: 'b=1 → 1' },
    { inputs: { a: 0, b: 0, c: 1, d: 0 }, expect: { y: 1 }, note: 'c=1 → 1' },
    { inputs: { a: 0, b: 0, c: 0, d: 1 }, expect: { y: 1 }, note: 'd=1 → 1' },
    { inputs: { a: 1, b: 0, c: 1, d: 0 }, expect: { y: 1 }, note: 'a∨c → 1' },
    { inputs: { a: 1, b: 1, c: 1, d: 1 }, expect: { y: 1 }, note: '全 1 → 1' },
  ],
  unlock: {
    name: '多输入或门',
    kind: 'logic',
    stage: 3,
    ports: [port('a', 'in'), port('b', 'in'), port('c', 'in'), port('d', 'in'), port('y', 'out')],
  },
  referenceSolution: or4Ref('ref-s3-or-chain'),
});

const S3_ENCODER: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-encoder',
  stage: 3,
  kind: 'main',
  title: '数字键盘编码器',
  brief:
    '计算器键盘按下数字键时，要把它变成电路认识的 4 位 BCD 码。10 根数字键线（d0-d9）一次只按一根，' +
    '把它们编码成 4 位数字码 code[3:0]，外加一根 any 脉冲（只要按了任意键就是 1）。',
  teaching:
    '编码器和译码器正好相反：译码器把 4 位码展开成很多线，编码器把很多线缩成 4 位码。' +
    '一次只按一键，所以不用仲裁优先级——每根输出线直接是相关按键的「或」：' +
    'code0 = d1∨d3∨d5∨d7∨d9、code1 = d2∨d3∨d6∨d7、code2 = d4∨d5∨d6∨d7、code3 = d8∨d9，' +
    'any = d0∨…∨d9。这就是一张或门矩阵：拖【多输入或门】【或门】积木，把每条输出线相关的键线或起来。',
  hint:
    '每根输出 = 几个按键的或，用 or 积木拼（s3-or-chain 产出的【多输入或门】正好 4 输入）。' +
    '参考解 8 个 or 积木：code0=or4+or2、code1/2=or4、code3=or2、any=or4+or4+or2。',
  ports: [
    { id: 'd7', name: 'd7', dir: 'in', button: true },
    { id: 'd8', name: 'd8', dir: 'in', button: true },
    { id: 'd9', name: 'd9', dir: 'in', button: true },
    { id: 'd4', name: 'd4', dir: 'in', button: true },
    { id: 'd5', name: 'd5', dir: 'in', button: true },
    { id: 'd6', name: 'd6', dir: 'in', button: true },
    { id: 'd1', name: 'd1', dir: 'in', button: true },
    { id: 'd2', name: 'd2', dir: 'in', button: true },
    { id: 'd3', name: 'd3', dir: 'in', button: true },
    { id: 'd0', name: 'd0', dir: 'in', button: true },
    { id: 'code', name: 'code', dir: 'out', width: 4 },
    { id: 'any', name: 'any', dir: 'out' },
  ],
  inputGridCols: 3,
  mode: 'logic',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(88, MAIN_OVERHEAD),
  optimalHalf: 88,
  checks: {},
  vectors: (() => {
    // 判定器只设置向量里列出的输入、其余默认 Z —— 组合关必须显式写全所有键位
    const all = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`d${i}`, 0]));
    const none: LevelVector = {
      inputs: { ...all },
      expect: { code: 0, any: 0 },
      note: '不按键：code=0、any=0',
    };
    const keys: LevelVector[] = Array.from({ length: 10 }, (_, k) => ({
      inputs: { ...all, [`d${k}`]: 1 },
      expect: { code: k, any: 1 },
      note: `按 ${k} → code=${k.toString(2).padStart(4, '0')}`,
    }));
    return [none, ...keys];
  })(),
  unlock: {
    name: '数字键盘编码器',
    kind: 'logic',
    stage: 3,
    ports: [
      port('d0', 'in'),
      port('d1', 'in'),
      port('d2', 'in'),
      port('d3', 'in'),
      port('d4', 'in'),
      port('d5', 'in'),
      port('d6', 'in'),
      port('d7', 'in'),
      port('d8', 'in'),
      port('d9', 'in'),
      port('code', 'out', 4),
      port('any', 'out'),
    ],
  },
  referenceSolution: encoderOrRef('ref-s3-encoder'),
});

/**
 * 数字输入寄存器：wr 上升沿把数字码 d[3:0]「左移一位插入」——旧个位变成十位，新数字进个位
 * （q ← {旧个位, d}，两位封顶滚动）。计算器按 1 再按 2 得 12、再按 5 得 25 就是它干的。
 */
const S3_DIGIT_ENTRY: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-digit-entry',
  stage: 3,
  kind: 'main',
  title: '数字输入寄存器',
  brief:
    '真实计算器按数字键时，新数字要「排到旧数字后面」：按 1 显示 1，按 2 变成 12，再按 5 变成 25。' +
    '这就是左移一位插入——写脉冲 wr 上升沿，q 的高 4 位变成旧低 4 位，低 4 位变成新数字码。' +
    '还有换新端 fresh：fresh=1 时十位钳 0、只进个位（按运算符/等号后，新输入从零开始）。',
  teaching:
    '上一关八位寄存器学会「上升沿锁存」。这一关给它加一个回接：个位（低 4 位）的输出接回十位（高 4 位）的输入，' +
    '同时个位输入接新数字码。于是每个 wr 上升沿，旧个位顶到十位、新数字进个位。' +
    '两位封顶：再按第三位时十位被顶掉（12 再按 5 → 25）。' +
    '换新端 fresh 不用碰内部状态：把十位每个 D 都变成「旧个位 ∧ ¬fresh」（与门钳位），' +
    'fresh=1 时十位进 0、个位进新数字，就是「从头开始」。' +
    '为什么不做「清零 clr」：清零的 D 在时钟沿上才变 0，主锁存器会采到旧数据（建立时间竞态）；' +
    '换新载入的 D 在沿前就是 0，天然正确。',
  hint:
    '8 个主从 D 触发器共用 wr 时钟：低 4 位锁存 d[3:0]，高 4 位锁存旧低 4 位∧¬fresh（回接 + 与门）。' +
    '参考解成本 1748 半单位。',
  ports: [
    port('d', 'in', 4),
    port('wr', 'in'),
    port('fresh', 'in'),
    { id: 'q', name: 'q', dir: 'out', width: 8 },
  ],
  mode: 'timing',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(1748, MAIN_OVERHEAD),
  optimalHalf: 1748,
  checks: { clockPort: 'wr' },
  vectors: [
    // 建立时间：d / fresh 只能在 wr=0 期间更换（主锁存器低电平透明跟随 D），wr 上升沿采样。
    // DFF 上电 Q=1：一记 fresh=1 + d=0 的脉冲即可归零（fresh 直接钳十位、个位进 0）。
    { inputs: { wr: 0, d: 0, fresh: 1 }, settlePs: 60_000, note: '待命' },
    {
      inputs: { wr: 1, d: 0, fresh: 1 },
      expect: { q: 0x00 },
      settlePs: 60_000,
      note: 'fresh 载入 0：归零',
    },
    {
      inputs: { wr: 0, d: 0x05, fresh: 1 },
      expect: { q: 0x00 },
      settlePs: 60_000,
      note: '释放并备好 5（仍换新）',
    },
    {
      inputs: { wr: 1, d: 0x05, fresh: 1 },
      expect: { q: 0x05 },
      settlePs: 60_000,
      note: '按 5 → 05（换新：十位 0）',
    },
    {
      inputs: { wr: 0, d: 0x03, fresh: 0 },
      expect: { q: 0x05 },
      settlePs: 60_000,
      note: '释放并切回插入模式',
    },
    {
      inputs: { wr: 1, d: 0x03, fresh: 0 },
      expect: { q: 0x53 },
      settlePs: 60_000,
      note: '再按 3 → 53（5 顶到十位）',
    },
    {
      inputs: { wr: 0, d: 0x07, fresh: 0 },
      expect: { q: 0x53 },
      settlePs: 60_000,
      note: '释放并备好 7',
    },
    {
      inputs: { wr: 1, d: 0x07, fresh: 0 },
      expect: { q: 0x37 },
      settlePs: 60_000,
      note: '再按 7 → 37（3 顶到十位、5 顶掉）',
    },
    {
      inputs: { wr: 0, d: 0x09, fresh: 1 },
      expect: { q: 0x37 },
      settlePs: 60_000,
      note: '释放并切回换新模式',
    },
    {
      inputs: { wr: 1, d: 0x09, fresh: 1 },
      expect: { q: 0x09 },
      settlePs: 60_000,
      note: '再按 9 → 09（换新：从头开始）',
    },
    { inputs: { wr: 0, d: 0x09, fresh: 1 }, expect: { q: 0x09 }, settlePs: 60_000, note: '释放' },
  ] satisfies LevelVector[],
  unlock: {
    name: '数字输入寄存器',
    kind: 'seq',
    stage: 3,
    ports: [port('d', 'in', 4), port('wr', 'in'), port('fresh', 'in'), port('q', 'out', 8)],
  },
  referenceSolution: digitEntryRef('ref-s3-digit-entry'),
});

/**
 * 简易计算器（压轴）：13 键数字键盘 + 两位数码管，真实链式立即执行模型。
 *  - 10 个数字键 0-9 + ＋ － ＝ C（C 清除一切，= 计算结果、也保留减法模式供负结果判定）；
 *  - 立即执行：12＋5＋ 时已经算出 17，再按 3＝ 得 20；= 后直接 ＋5＝ 接着算（15+…）；
 *  - 负数显示错误标志：5－8＝ 时两位数码管亮 E（EE，段码 0x79）；
 *  - 键盘布局 4 列：7 8 9 ＋ / 4 5 6 － / 1 2 3 ＝ / 0 C。
 */
const CALC: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-calc',
  stage: 3,
  kind: 'main',
  title: '简易计算器',
  brief:
    '数字电路课的毕业设计：十三键计算器。拨好数字按运算，屏幕立刻出中间结果：' +
    '12＋5＋ 显示 17，再按 3＝ 得 20。按错？C 清屏重来；减出负数（5－8＝）屏幕亮 E。',
  teaching:
    '把前面三关的模块拼起来：数字键盘编码器把按键变成 4 位码 + any（有键按下）；' +
    '数字输入寄存器在 any 上升沿把新数字码左移插入（按 1 再按 2 得 12）；' +
    '运算控制记住 ＋/－/= 与「有前值」标志，用八位寄存器当累加器（A）；' +
    'ALU 把累加器和输入寄存器（BCD）转二进制相加/相减，再转回 BCD；' +
    '显示控制选「正在输入显示输入、否则显示结果」，负数亮 E。' +
    '立即执行的关键：按下运算键那一刻就把 A±输入 算好存回 A，所以 12＋5＋ 已经等于 17。',
  hint:
    '把【数字键盘编码器】【数字输入寄存器】【运算控制】【八位寄存器】【BCD→二进制】【全加器】【异或门】' +
    '【二进制→BCD】【七段译码器】【显示控制】当模块拖出来拼。数字输入寄存器用 any 的延迟作写脉冲' +
    '（建立时间），减法模式（op_minus∧有前值）只从第二个运算起生效，= 的借位锁存成负号标志亮 E。' +
    '参考解 24764 半单位（豁免：真实计算器远超课时量级）。',
  ports: [
    port('d7', 'in'),
    port('d8', 'in'),
    port('d9', 'in'),
    { id: 'plus', name: 'plus', dir: 'in', button: true },
    port('d4', 'in'),
    port('d5', 'in'),
    port('d6', 'in'),
    { id: 'minus', name: 'minus', dir: 'in', button: true },
    port('d1', 'in'),
    port('d2', 'in'),
    port('d3', 'in'),
    { id: 'eq', name: 'eq', dir: 'in', button: true },
    port('d0', 'in'),
    { id: 'c', name: 'c', dir: 'in', button: true },
    { id: 'disp_t', name: 'disp_t', dir: 'out', width: 7, display: 'segment' },
    { id: 'disp_u', name: 'disp_u', dir: 'out', width: 7, display: 'segment' },
  ],
  inputGridCols: 4,
  mode: 'timing',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(24764, MAIN_OVERHEAD),
  optimalHalf: 24764,
  checks: {},
  vectors: (() => {
    // 判定器只设置向量里列出的输入、其余默认 Z —— 时序关每个向量必须写全全部 13 个键位
    const base = {
      d0: 0,
      d1: 0,
      d2: 0,
      d3: 0,
      d4: 0,
      d5: 0,
      d6: 0,
      d7: 0,
      d8: 0,
      d9: 0,
      plus: 0,
      minus: 0,
      eq: 0,
      c: 0,
    };
    /** 按键序列 → 按下/松开两向量；press expect 只在给定按下键时检查（松开向量检查保持） */
    const seq = (keys: Array<[string, number, string]>): LevelVector[] => {
      const rows: LevelVector[] = [];
      for (const [key, code, note] of keys) {
        rows.push({
          inputs: { ...base, [key]: 1 },
          expect: { disp_t: code >> 8, disp_u: code & 0xff },
          settlePs: 1_000_000,
          note,
        });
        rows.push({ inputs: { ...base }, settlePs: 1_000_000, note: `${note} 松开` });
      }
      return rows;
    };
    /** 段码对 '20'/'EE' → 打包数值（高字节十位、低字节个位） */
    const SEG = {
      0: 0x3f,
      1: 0x06,
      2: 0x5b,
      3: 0x4f,
      4: 0x66,
      5: 0x6d,
      6: 0x7d,
      7: 0x07,
      8: 0x7f,
      9: 0x6f,
      E: 0x79,
    } as Record<string, number>;
    const d = (s: string) => (SEG[s[0] ?? ''] << 8) | SEG[s[1] ?? ''];
    return [
      { inputs: { ...base }, settlePs: 1_000_000, note: '待命（上电先按 C 清零）' },
      // A. 主链 12＋5＋3＝20（立即执行）
      ...seq([
        ['c', d('00'), 'C 清屏'],
        ['d1', d('01'), '按 1'],
        ['d2', d('12'), '按 2 → 12'],
        ['plus', d('12'), '按 ＋（12 待命）'],
        ['d5', d('05'), '按 5'],
        ['plus', d('17'), '按 ＋：12＋5=17'],
        ['d3', d('03'), '按 3'],
        ['eq', d('20'), '按 ＝：17＋3=20'],
      ]),
      // B. = 结算：9＋1＝10，然后 C 清屏再验证 0＋7＝7（不覆盖「= 后直接 op」链——
      //    立即执行模型用旧操作数重算，属简化语义）
      ...seq([
        ['c', d('00'), 'C 清屏'],
        ['d9', d('09'), '按 9'],
        ['plus', d('09'), '按 ＋'],
        ['d1', d('01'), '按 1'],
        ['eq', d('10'), '按 ＝：9＋1=10'],
        ['c', d('00'), 'C 清屏'],
        ['d0', d('00'), '按 0'],
        ['plus', d('00'), '按 ＋'],
        ['d7', d('07'), '按 7'],
        ['eq', d('07'), '按 ＝：0＋7=7'],
      ]),
      // C. 减法负例：5－8＝ 亮 E
      ...seq([
        ['c', d('00'), 'C 清屏'],
        ['d5', d('05'), '按 5'],
        ['minus', d('05'), '按 －（5 待命，不报错）'],
        ['d8', d('08'), '按 8'],
        ['eq', d('EE'), '按 ＝：5－8 负数 → E'],
      ]),
      // D. 减法正例：9－4＝5
      ...seq([
        ['c', d('00'), 'C 清屏'],
        ['d9', d('09'), '按 9'],
        ['minus', d('09'), '按 －'],
        ['d4', d('04'), '按 4'],
        ['eq', d('05'), '按 ＝：9－4=5'],
      ]),
      // E. 进位：7＋8＝15
      ...seq([
        ['c', d('00'), 'C 清屏'],
        ['d7', d('07'), '按 7'],
        ['plus', d('07'), '按 ＋'],
        ['d8', d('08'), '按 8'],
        ['eq', d('15'), '按 ＝：7＋8=15'],
      ]),
    ];
  })(),
  unlock: {
    name: '简易计算器',
    kind: 'seq',
    stage: 3,
    ports: [
      port('d7', 'in'),
      port('d8', 'in'),
      port('d9', 'in'),
      port('plus', 'in'),
      port('d4', 'in'),
      port('d5', 'in'),
      port('d6', 'in'),
      port('minus', 'in'),
      port('d1', 'in'),
      port('d2', 'in'),
      port('d3', 'in'),
      port('eq', 'in'),
      port('d0', 'in'),
      port('c', 'in'),
      port('disp_t', 'out', 7),
      port('disp_u', 'out', 7),
    ],
  },
  referenceSolution: calcRef('ref-s3-calc'),
});

/** 阶段 3 关卡，顺序即解锁顺序 */
export const STAGE3_LEVELS: Level[] = [
  HALF_ADDER,
  FULL_ADDER,
  ADDER_4,
  ADDER_8,
  ALU,
  BCD2BIN,
  BIN2BCD,
  S3_DISPLAY,
  S3_SEG_ABC,
  S3_SEG_DE,
  S3_SEG_FG,
  S3_DISPLAY2,
  REG_8,
  S3_OR_CHAIN,
  S3_ENCODER,
  S3_DIGIT_ENTRY,
  CALC,
];
