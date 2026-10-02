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
import { adder4Ref, adder8Ref, aluRef, fullAdderRef, halfAdderRef, seg7Ref } from './references-ari.js';
import { bcd2binRef, bin2bcdRef, calcRef, reg8Ref } from './references-calc.js';

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

/** 数码管显示关（译码器）：bcd[3:0]（0-9）→ 7 根段信号（a-g）。七段数码管有 7 根线，每根点亮一段。 */
const S3_DISPLAY: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-display',
  stage: 3,
  kind: 'main',
  title: '数码管显示',
  brief:
    '七段数码管是计算器的屏幕，它有 7 根线（a-g），每根点亮一段。这一关把 0-9 的 BCD 码译成 7 段信号，亲手搭一个 BCD→七段译码器。',
  teaching:
    '数码管不理解数字，只认 7 根线：a 是顶横、b 是右上竖、c 是右下竖、d 是底横、e 是左下竖、f 是左上竖、g 是中横。' +
    '每个数字 = 点亮其中几段（0 亮 a-f、1 亮 b-c、2 亮 a,b,g,e,d……）。译码器就是查这张表：' +
    'bcd[3:0] 是 4 位输入，7 根段线是输出，每根都是一个 4 输入布尔函数，用与非门搭出它的最简与或式。',
  hint:
    '先写 0-9 的段码表，逐段求最简与或式，再全部用与非门搭（与非门输出可级联不会衰减）。' +
    '参考解 43 个与非门（共享中间项），成本 860 半单位。',
  ports: [
    port('bcd', 'in', 4),
    { id: 'seg', name: 'seg', dir: 'out', width: 7, display: 'segment' },
  ],
  mode: 'logic',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(860, MAIN_OVERHEAD),
  optimalHalf: 860,
  checks: {},
  vectors: [
    { inputs: { bcd: 0 }, expect: { seg: 0x3f }, note: '0 → 亮 a-f' },
    { inputs: { bcd: 1 }, expect: { seg: 0x06 }, note: '1 → 亮 b-c' },
    { inputs: { bcd: 2 }, expect: { seg: 0x5b }, note: '2 → 亮 a,b,g,e,d' },
    { inputs: { bcd: 3 }, expect: { seg: 0x4f }, note: '3 → 亮 a,b,c,d,g' },
    { inputs: { bcd: 4 }, expect: { seg: 0x66 }, note: '4 → 亮 f,g,b,c' },
    { inputs: { bcd: 5 }, expect: { seg: 0x6d }, note: '5 → 亮 a,f,g,c,d' },
    { inputs: { bcd: 6 }, expect: { seg: 0x7d }, note: '6 → 亮 a,f,e,d,c,g' },
    { inputs: { bcd: 7 }, expect: { seg: 0x07 }, note: '7 → 亮 a,b,c' },
    { inputs: { bcd: 8 }, expect: { seg: 0x7f }, note: '8 → 全亮' },
    { inputs: { bcd: 9 }, expect: { seg: 0x6f }, note: '9 → 亮 a,b,c,d,f,g' },
  ] satisfies LevelVector[],
  unlock: {
    name: '七段译码器',
    kind: 'logic',
    stage: 3,
    ports: [port('bcd', 'in', 4), port('seg', 'out', 7)],
  },
  referenceSolution: seg7Ref('ref-s3-display'),
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
 * 简易计算器（压轴）：a、b 是两位 BCD（0-99），按一下【等号】按钮，
 * 十位/个位两个七段数码管显示 a+b。eq 是按钮端口：画布上点击 = 电平 1 自动弹回 0（上升沿锁存）。
 */
const CALC: Level = parseLevel({
  schemaVersion: 1,
  id: 's3-calc',
  stage: 3,
  kind: 'main',
  title: '简易计算器',
  brief:
    '数字电路课的毕业设计：两位数加法计算器。拨好 a、b（BCD），按下【等号】按钮，' +
    '两个七段数码管亮出结果。23+5=28、81+16=97。',
  teaching:
    '整条流水线：a、b（BCD）→ bcd2bin 转二进制 → 8 位二进制加法 → bin2bcd 转回十进制 →' +
    '8 位寄存器在等号上升沿锁存 → 两个【七段译码器】把十位/个位 BCD 点亮成数码管。每一步都是前面关卡练过的模块。',
  hint:
    '把上一关的 bcd2bin、bin2bcd、七段译码器、八位寄存器当成模块拖出来拼：两个 bcd2bin 接 a/b，' +
    '结果进 8 位加法器，再进 bin2bcd，寄存器在 eq 上升沿锁存，最后两个七段译码器点亮数码管。',
  ports: [
    port('a', 'in', 8),
    port('b', 'in', 8),
    { id: 'eq', name: 'eq', dir: 'in', button: true },
    { id: 'disp_t', name: 'disp_t', dir: 'out', width: 7, display: 'segment' },
    { id: 'disp_u', name: 'disp_u', dir: 'out', width: 7, display: 'segment' },
  ],
  mode: 'timing',
  allowedUnits: [...STAGE3_UNITS],
  moduleAccess: 'all',
  budgetHalf: budgetFromOptimal(16920, MAIN_OVERHEAD),
  optimalHalf: 16920,
  checks: {},
  vectors: [
    { inputs: { a: 0x00, b: 0x00, eq: 0 }, settlePs: 1_000_000, note: '0+0 待命' },
    {
      inputs: { a: 0x00, b: 0x00, eq: 1 },
      expect: { disp_t: 0x3f, disp_u: 0x3f },
      settlePs: 1_000_000,
      note: '按下等号：0+0=00',
    },
    {
      inputs: { a: 0x23, b: 0x05, eq: 0 },
      expect: { disp_t: 0x3f, disp_u: 0x3f },
      settlePs: 1_000_000,
      note: '改 23+5，不按等号显示不变',
    },
    {
      inputs: { a: 0x23, b: 0x05, eq: 1 },
      expect: { disp_t: 0x5b, disp_u: 0x7f },
      settlePs: 1_000_000,
      note: '按下等号：23+5=28',
    },
    {
      inputs: { a: 0x51, b: 0x10, eq: 0 },
      expect: { disp_t: 0x5b, disp_u: 0x7f },
      settlePs: 1_000_000,
      note: '改 51+16，显示保持 28',
    },
    {
      inputs: { a: 0x51, b: 0x10, eq: 1 },
      expect: { disp_t: 0x7d, disp_u: 0x06 },
      settlePs: 1_000_000,
      note: '按下等号：51+10=61',
    },
    {
      inputs: { a: 0x51, b: 0x10, eq: 0 },
      expect: { disp_t: 0x7d, disp_u: 0x06 },
      settlePs: 1_000_000,
      note: '松开等号，61 保持',
    },
    {
      inputs: { a: 0x50, b: 0x19, eq: 0 },
      expect: { disp_t: 0x7d, disp_u: 0x06 },
      settlePs: 1_000_000,
      note: '改 50+19，显示保持 61',
    },
    {
      inputs: { a: 0x50, b: 0x19, eq: 1 },
      expect: { disp_t: 0x7d, disp_u: 0x6f },
      settlePs: 1_000_000,
      note: '按下等号：50+19=69',
    },
    {
      inputs: { a: 0x12, b: 0x34, eq: 0 },
      expect: { disp_t: 0x7d, disp_u: 0x6f },
      settlePs: 1_000_000,
      note: '改 12+34，显示保持 69',
    },
    {
      inputs: { a: 0x12, b: 0x34, eq: 1 },
      expect: { disp_t: 0x66, disp_u: 0x7d },
      settlePs: 1_000_000,
      note: '按下等号：12+34=46',
    },
  ] satisfies LevelVector[],
  unlock: {
    name: '简易计算器',
    kind: 'seq',
    stage: 3,
    ports: [
      port('a', 'in', 8),
      port('b', 'in', 8),
      port('eq', 'in'),
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
  REG_8,
  CALC,
];
