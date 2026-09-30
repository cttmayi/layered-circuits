/**
 * 阶段 1（底层逻辑门）关卡内容 —— GDD 第 3 节。
 *
 * 关卡的三条硬信息都在这里：
 *  1. **功能规格** = vectors（真值表），判定就是逐行比对；端口名（a/b/y）是关卡与玩家电路的接口约定；
 *  2. **成本预算** = optimalHalf（参考解成本，CI 校验它真的能过关）与 budgetHalf（最优 × 1.2）；
 *  3. **素材约束** = allowedUnits / moduleAccess —— 阶段 1 只能用手搭，且电容是时钟专用，先不给。
 *
 * 阶段 1 的关卡顺序刻意体现「越省越弱、越稳越贵」的取舍：
 * 单管反相器成本 4（输出弱 1），加射极跟随器成本 7（输出强 1，级联更稳）。
 */

import {
  budgetFromOptimal,
  type Design,
  type Level,
  type LevelVector,
  parseLevel,
  type Unit,
} from '@lc/schema';
import { STAGE3_LEVELS } from './levels-ari.js';
import { STAGE2_LEVELS } from './levels-seq.js';
import {
  andGateRef,
  dioIntroRef,
  dioIntroSeed,
  floatIntroRef,
  floatIntroSeed,
  nandGateRef,
  norFastRef,
  notGateRef,
  npnIntroRef,
  npnIntroSeed,
  orGateRef,
  xnorGateRef,
  xorGateRef,
} from './references.js';

/** 阶段 1 允许的元件：电容是时钟专用，本阶段不开放 */
const STAGE1_UNITS = ['npn', 'res', 'dio'] as const;

const MAIN_OVERHEAD = 0.2;

function vectors1(fn: (a: 0 | 1) => 0 | 1): LevelVector[] {
  return ([0, 1] as const).map((a) => ({ inputs: { a }, expect: { y: fn(a) } }));
}

function vectors2(fn: (a: 0 | 1, b: 0 | 1) => 0 | 1): LevelVector[] {
  return (
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as Array<[0 | 1, 0 | 1]>
  ).map(([a, b]) => ({ inputs: { a, b }, expect: { y: fn(a, b) } }));
}

export interface LevelDef {
  level: Level;
  /** 参考解成本（半单位），与 optimalHalf 一致，由测试校验 */
  referenceHalf: number;
}

function gateLevel(input: {
  id: string;
  title: string;
  brief: string;
  teaching: string;
  hint: string;
  inputs: number;
  fn: (a: 0 | 1, b: 0 | 1) => 0 | 1;
  optimalHalf: number;
  /** 已知最省成本（求解器结论） */
  bestKnownHalf?: number;
  /** 覆写关卡类型（默认 main） */
  kind?: Level['kind'];
  timingBudgetPs: number;
  /** 覆写本关可用元件（例如「只发三极管和电阻」） */
  allowedUnits?: readonly Unit[];
  /** 教学关必用元件（防止直连导线钻空子） */
  requiredUnits?: readonly Unit[];
  /** 教学关「元件课堂」概念卡（有 classroom 的关 = 教学关） */
  classroom?: { title: string; analogy: string; points: string[] };
  /** 教学关半成品电路（画布预置，玩家补关键连接） */
  seedDoc?: Design;
  /** 教学关引导步骤（工作台顶部提示条） */
  guideSteps?: readonly string[];
  /** 覆写白名单（moduleAccess = 'listed' 时生效） */
  allowedModules?: readonly string[];
  /** 复古复用关禁用的模块名 */
  bannedModules?: readonly string[];
  moduleAccess: 'none' | 'all' | 'listed';
  reference: Level['referenceSolution'];
  unlockName: string;
  freqHz: number;
}): Level {
  const vectors =
    input.inputs === 1 ? vectors1(input.fn as (a: 0 | 1) => 0 | 1) : vectors2(input.fn);
  const ports = [
    ...(input.inputs === 1
      ? [{ id: 'a', name: 'a', dir: 'in' as const, width: 1 }]
      : [
          { id: 'a', name: 'a', dir: 'in' as const, width: 1 },
          { id: 'b', name: 'b', dir: 'in' as const, width: 1 },
        ]),
    { id: 'y', name: 'y', dir: 'out' as const, width: 1 },
  ];
  return parseLevel({
    schemaVersion: 1,
    id: input.id,
    stage: 1,
    kind: input.kind ?? 'main',
    title: input.title,
    brief: input.brief,
    teaching: input.teaching,
    hint: input.hint,
    mode: 'logic',
    timingBudgetPs: input.timingBudgetPs,
    allowedUnits: [...(input.allowedUnits ?? STAGE1_UNITS)],
    requiredUnits: [...(input.requiredUnits ?? [])],
    ...(input.classroom ? { classroom: input.classroom } : {}),
    ...(input.seedDoc ? { seedDoc: input.seedDoc } : {}),
    guideSteps: [...(input.guideSteps ?? [])],
    moduleAccess: input.moduleAccess,
    allowedModules: [...(input.allowedModules ?? [])],
    bannedModules: [...(input.bannedModules ?? [])],
    budgetHalf: budgetFromOptimal(input.optimalHalf, MAIN_OVERHEAD),
    ...(input.bestKnownHalf !== undefined ? { bestKnownHalf: input.bestKnownHalf } : {}),
    optimalHalf: input.optimalHalf,
    clock: { freqHz: input.freqHz },
    vectors,
    unlock: { name: input.unlockName, kind: 'logic', stage: 1, ports },
    referenceSolution: input.reference,
  });
}

export const STAGE1_LEVELS: Level[] = [
  // ---- 三个「元件入门」教学关（面向高中生：大白话 + 生活类比，先建立元件直觉）----
  gateLevel({
    id: 's1-npn',
    title: '认识三极管',
    brief:
      '三极管天生是个「反着来的开关」：基极一通电就导通，把输出拉低。做一扇门磁警示灯：门窗关好灯亮，门窗一开灯就灭。',
    teaching:
      '三极管（NPN）有三只脚：基极（b）、集电极（c）、发射极（e）。它最大的脾气就是「反相」：基极一通电，集电极→发射极导通、把输出拉低（1 → 0）；基极不通电就截止，输出靠上拉电阻钉回 1（0 → 1）。这一关做「反相」：门窗关（0）灯亮（1）、门窗开（1）灯灭（0）。那颗上拉电阻很关键：没人导通时输出会「悬空」乱跳，它把默认值稳稳钉在 1。基极不能直接吃强信号：真实电路里基极-发射极只有约 0.7V，直接接电源会电流过大，所以要经限流电阻 R2（半成品已把 R2 放好，你补 R2 到基极这条短线）。灯有两只脚：一只接输出信号、一只接公共地（地线半成品已帮你接好）——两只脚都接对、回路通了灯才亮。想让灯随输入亮灭，靠的是三极管和电阻这条真正的电路。',
    hint: '基极经电阻 R2 接输入 a；集电极接输出 y；发射极接 GND；输出再经一个上拉电阻接到 VCC。',
    inputs: 1,
    fn: (a) => (a ? 0 : 1),
    optimalHalf: 8,
    timingBudgetPs: 2000,
    allowedUnits: ['npn', 'res'],
    requiredUnits: ['npn'],
    classroom: {
      title: '三极管：反相开关',
      analogy: '三极管像个「反着来的开关」：基极一通电就导通、把输出拉低 —— 像门一开就把灯拉灭。',
      points: [
        '三只脚各管一摊：基极（b）是开关把手、集电极（c）是进水口、发射极（e）是出水口',
        '基极一通电，集电极到发射极就导通，输出被拉低（1→0）—— 天生的「反相」',
        '没人导通时输出会「悬空」乱跳，要挂上拉电阻把默认值稳稳钉在 1',
        '基极不能直接吃强信号：真实电路 b-e 只有约 0.7V，直接接电源会过流——经电阻 R2 限流',
      ],
    },
    seedDoc: npnIntroSeed(),
    guideSteps: [
      '第一步：把基极电阻 R2 的另一端接到三极管基极（b）—— 这就是「开关把手」（限流：真实 b-e 只有约 0.7V）',
      '第二步：确认输出 y 挂着上拉电阻到 VCC（没有就补一个）',
      '第三步：点「交付验收」，门窗关（0）灯亮、门窗开（1）灯灭就对了',
    ],
    moduleAccess: 'none',
    reference: npnIntroRef('ref-npn-intro'),
    unlockName: '跟随器',
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-dio',
    title: '认识二极管',
    brief:
      '两节电池并联给设备供电，一节没电会把另一节「倒灌」拖垮（甚至漏液）。二极管只许电流往外走，挡住倒灌——这一关用二极管做「防倒灌」。',
    teaching:
      '二极管有两个方向：阳极（a）和阴极（k），电流只许从阳极流向阴极；接反了电路就不通。这一关做「防倒灌」：两节电池各串一个二极管再并到设备，每节电池的电流只许往外流，没电的电池被二极管挡住、拖不垮另一节——这就是「或」：任一节电池有电，设备就有电。那盏「设备灯」也有两只脚：一只接输出、一只接公共地（地线半成品已接好）——和电池、电阻一起构成完整的回路。',
    hint: '每节电池后面串一个二极管：阳极朝电池、阴极朝设备；输出 y 再挂一个电阻到 GND。',
    inputs: 2,
    fn: (a, b) => (a || b ? 1 : 0),
    optimalHalf: 8,
    timingBudgetPs: 2000,
    allowedUnits: ['dio', 'res'],
    requiredUnits: ['dio'],
    classroom: {
      title: '二极管：单向门',
      analogy:
        '二极管只许电流从阳极流向阴极 —— 像单向门只能推开不能往回拉。两节电池直接并联会「倒灌」：没电的电池把有电的拖垮；二极管只许电流往外流，挡住倒灌。',
      points: [
        '两个方向：阳极（a）进、阴极（k）出，接反了电流就被挡',
        '防倒灌是二极管的看家本领：每节电池后串一个，没电的电池不会拖垮有电的',
        '这一关的电路就是「或」：任一节电池有电，设备就有电',
      ],
    },
    seedDoc: dioIntroSeed(),
    guideSteps: [
      '第一步：看——两节电池直接并在一起，一节没电就把设备拖乱（信号冲突）',
      '第二步：在每节电池后面串一个二极管（阳极朝电池、阴极朝设备），挡住倒灌',
      '第三步：点「交付验收」，任一节电池有电设备就工作',
    ],
    moduleAccess: 'none',
    reference: dioIntroRef('ref-dio-intro'),
    unlockName: '二极管或门',
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-float',
    title: '悬空与默认电平',
    brief:
      '没人驱动的线会「悬空」乱跳。用电阻把输出稳稳接到 VCC（默认 1）或 GND（默认 0）—— 像弹簧门没人推时自己关着。',
    teaching:
      '上拉电阻 = 把输出默认钉在 1；下拉电阻 = 默认钉在 0。这一关用上拉：平时输出默认 1，输入 a 一给电，三极管就把输出拉低（0）—— 也就是把 a「反」了一下。基极要经限流电阻 R2 接输入（真实电路 b-e 只有约 0.7V，不能直接吃强信号，半成品已把 R2 接好）。下一关非门就用这个原理。',
    hint: '输出 y 经一个电阻接到 VCC（上拉，默认 1）；三极管集电极接 y、发射极接 GND、基极经限流电阻接输入 a。',
    inputs: 1,
    fn: (a) => (a ? 0 : 1),
    optimalHalf: 8,
    timingBudgetPs: 2000,
    allowedUnits: ['npn', 'res'],
    requiredUnits: ['npn'],
    classroom: {
      title: '悬空与默认电平',
      analogy: '没人推的弹簧门自己关着 —— 没人驱动的线是「悬空」的，会乱跳；电阻把它稳稳钉住。',
      points: [
        '上拉电阻：输出接到 VCC → 默认是 1',
        '下拉电阻：输出接到 GND → 默认是 0',
        '这一关输出默认 1：输入 a 一给电，三极管把输出拉低 —— 就是「反」了一下',
      ],
    },
    seedDoc: floatIntroSeed(),
    guideSteps: [
      '第一步：挂一个上拉电阻，把输出 y 接到 VCC（默认 1）——基极限流电阻 R2 半成品已接好',
      '第二步：点「交付验收」，a=0 亮、a=1 灭就对了',
    ],
    moduleAccess: 'none',
    reference: floatIntroRef('ref-float-intro'),
    unlockName: '上拉反相器',
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-not',
    title: '非门',
    brief: '输入为高时输出低、输入为低时输出高。用最少的三极管搭出反相器，并让它稳定级联。',
    teaching:
      '三极管当开关：基极给高电平就导通，把集电极拉低。输出高电平是「上拉电阻给的弱 1」，这是 RTL 的典型特征。',
    hint: '一个 NPN + 基极限流电阻 + 集电极上拉电阻就够了（成本 4）。想要输出更强的 1，可以在后面加一级射极跟随器（成本 7）。',
    inputs: 1,
    fn: (a) => (a ? 0 : 1),
    optimalHalf: 8,
    // 基极限流电阻是强制规则（真实 b-e 只有约 0.7V，强信号直怼基极会过流），
    // 所以最优解就是标准做法：1 NPN + 1 基极限流 + 1 上拉 = 8，没有更省的省法。
    timingBudgetPs: 2500,
    moduleAccess: 'none',
    reference: notGateRef('ref-not'),
    unlockName: '非门',
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-and',
    title: '与门',
    brief: '两个输入都为高时输出才为高。试试二极管：它只能单向导通。',
    teaching: '二极管构成「线或/线与」逻辑：只要有一个阴极被拉低，公共阳极就被压到低。',
    hint: '两个二极管的阳极并在一起接输出，输出再用一个电阻上拉到 VCC；两个阴极分别接输入。',
    inputs: 2,
    fn: (a, b) => (a && b ? 1 : 0),
    optimalHalf: 8,
    timingBudgetPs: 2000,
    moduleAccess: 'none',
    reference: andGateRef('ref-and'),
    unlockName: '与门',
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-or',
    title: '或门',
    brief: '只要有一个输入为高，输出就为高。把与门的结构反过来用。',
    teaching: '输出改成下拉电阻、二极管阳极接输入：任一路拉高就把输出顶上去。',
    hint: '两个二极管阳极分别接输入、阴极并在一起接输出，输出再用一个电阻下拉到 GND。',
    inputs: 2,
    fn: (a, b) => (a || b ? 1 : 0),
    optimalHalf: 8,
    timingBudgetPs: 2000,
    moduleAccess: 'none',
    reference: orGateRef('ref-or'),
    unlockName: '或门',
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-nand',
    title: '与非门',
    brief: '与门取反：只有两个输入都为高时输出才为低。这是最经典的三极管门电路。',
    teaching: '两个三极管**串联**下拉：必须两个都导通，输出才会被拉低 —— 这就是「与非」。',
    hint: 'Q1 的发射极接到 Q2 的集电极（串联），Q2 的发射极接 GND；输出从 Q1 集电极取出并上拉。',
    inputs: 2,
    fn: (a, b) => (a && b ? 0 : 1),
    optimalHalf: 14,
    timingBudgetPs: 3500,
    moduleAccess: 'all',
    reference: nandGateRef('ref-nand'),
    unlockName: '与非门',
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-nor',
    title: '或非门',
    brief: '或门取反：两个输入都为低时输出才为高。',
    teaching:
      '两种思路都行：把「或」当一级再接反相器（成本 8，模块化组合的思路），' +
      '或者干脆让两个三极管并联下拉、任一路导通就把输出拉低（成本 7，更省）。' +
      '最省的那个是求解器搜出来的结论，你也可以自己找找看。',
    hint: '最省的做法：两个三极管的集电极都接输出、发射极都接 GND、基极各经一个电阻接 a / b，输出再上拉到 VCC（成本 7）。',
    inputs: 2,
    fn: (a, b) => (a || b ? 0 : 1),
    optimalHalf: 14,
    timingBudgetPs: 4000,
    moduleAccess: 'all',
    reference: norFastRef('ref-nor'),
    unlockName: '或非门',
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-xor',
    title: '异或门',
    brief:
      '两个输入不同时输出为高，相同时为低。本关**只发三极管和电阻**，模块也只许用【非门】【与非门】—— 请用与非门把它拼出来。',
    teaching:
      '这一关验收的是模块复用：用自己封装好的与非门当积木，比手搭省心得多（成本一样是 4 个与非门）。',
    hint: '标准接法：n1 = NAND(a,b)；n2 = NAND(a,n1)；n3 = NAND(b,n1)；y = NAND(n2,n3)。四个与非门共 8 个三极管 + 12 个电阻（成本 28）。',
    inputs: 2,
    fn: (a, b) => (a !== b ? 1 : 0),
    // 满分线 = 标准解（4 个与非门 = 56 半单位）；求解器找到过更省的 42（弱输出与门 + 两个或非门），
    // 记在 bestKnownHalf 里：谁能做到谁就破榜，但课上教的解法照样满分。
    optimalHalf: 56,
    bestKnownHalf: 42,
    timingBudgetPs: 7000,
    allowedUnits: ['npn', 'res'],
    moduleAccess: 'listed',
    allowedModules: ['非门', '与非门'],
    reference: xorGateRef('ref-xor'),
    unlockName: '异或门',
    freqHz: 100_000,
  }),
  // 复古复用关（GDD 4.4）：只能用早期手段重做异或门 —— 禁止调用后期封装的与非门模块
  gateLevel({
    id: 's1-xor-retro',
    kind: 'retro',
    title: '异或门·复古版',
    brief:
      '同样的异或门，但这一关**禁用【与非门】模块**：模拟早期版本还没把它封装出来。' +
      '只能手搭，或者用当时已有的【与门】【或门】模块。',
    teaching:
      '复古复用关考的是「被拿走顺手的积木之后还能不能做出来」：' +
      '组件库的版本管理（M3）就是为了让你随时能回到早期版本重做一遍。',
    hint: '手搭 4 个 RTL 与非门是标准解（成本 28）；也可以想想用与门/或门拼。',
    inputs: 2,
    fn: (a: 0 | 1, b: 0 | 1) => (a !== b ? 1 : 0),
    optimalHalf: 56,
    bestKnownHalf: 42,
    timingBudgetPs: 7000,
    allowedUnits: ['npn', 'res'],
    moduleAccess: 'listed',
    allowedModules: ['非门', '与门', '或门'],
    bannedModules: ['与非门'],
    reference: xorGateRef('ref-xor-retro'),
    unlockName: '异或门（复古版）',
    freqHz: 20_000_000,
  }),

  gateLevel({
    id: 's1-xnor',
    title: '同或门',
    brief: '异或门取反：两个输入相同时输出为高。这一关用「异或 + 反相」最省。',
    teaching: '组合已有模块是本作的核心玩法：异或门 + 非门，成本 28 + 4 = 32。',
    hint: '把异或门的输出再接一级单管反相器即可（求解器确认这就是最省的做法）。',
    inputs: 2,
    fn: (a: 0 | 1, b: 0 | 1) => (a === b ? 1 : 0),
    optimalHalf: 64,
    // 求解器结论：异或门 + 无基极限流电阻的反相器 = 54（比带限流电阻的反相器省 2）
    bestKnownHalf: 54,
    timingBudgetPs: 9000,
    allowedUnits: ['npn', 'res'],
    moduleAccess: 'listed',
    allowedModules: ['非门', '与非门', '异或门'],
    reference: xnorGateRef('ref-xnor'),
    unlockName: '同或门',
    freqHz: 100_000,
  }),
];

/** 全部关卡（阶段 1 逻辑门 + 阶段 2 时序单元 + 阶段 3 算术单元），顺序即解锁顺序 */
export const ALL_LEVELS: Level[] = [...STAGE1_LEVELS, ...STAGE2_LEVELS, ...STAGE3_LEVELS];

/** 关卡要求的端口（判定与内容自检共用；实现见 @lc/compiler 的 requiredPorts） */
export { requiredPorts as requiredPortsOf } from '@lc/compiler';

export function levelsOfStage(stage: number): Level[] {
  return ALL_LEVELS.filter((level) => level.stage === stage);
}

export function findLevel(id: string): Level | undefined {
  return ALL_LEVELS.find((level) => level.id === id);
}

/** 关卡顺序（解锁顺序 = 数组顺序） */
export function levelOrder(id: string): number {
  return ALL_LEVELS.findIndex((level) => level.id === id);
}

export function nextLevelId(id: string): string | null {
  const index = levelOrder(id);
  if (index < 0 || index + 1 >= ALL_LEVELS.length) return null;
  return (ALL_LEVELS[index + 1] as Level).id;
}
