/**
 * 阶段 1（底层逻辑门）关卡内容 —— GDD 第 3 节。
 *
 * 关卡的三条硬信息都在这里：
 *  1. **功能规格** = vectors（真值表），判定就是逐行比对；端口名（a/b/y）是关卡与玩家电路的接口约定；
 *  2. **成本线** = optimalHalf（参考解成本，CI 校验它真的能过关）与 budgetHalf（最优 × 2）；
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
  cmosInvRef,
  cmosInvSeed,
  cmosNandRef,
  cmosNandSeed,
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
import {
  cmosAndRef,
  cmosNorRef,
  cmosOrRef,
  cmosXnorRef,
  cmosXorRef,
  nmosIntroRef,
  nmosIntroSeed,
  pmosIntroRef,
  pmosIntroSeed,
  ttlAndRef,
  ttlNandRef,
  ttlNorRef,
  ttlNotRef,
  ttlOrRef,
} from './references-family.js';

/** 阶段 1 允许的元件：电容是时钟专用，本阶段不开放 */
const STAGE1_UNITS = ['npn', 'res', 'dio'] as const;

/** 预算线 = 标准答案 × 2（评星契约：0.5×预算 = 标准答案 = 3 星档） */
const MAIN_OVERHEAD = 1.0;

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
  /** 本关逻辑族契约（默认 rtl）；CMOS 教学关声明 cmos，判定按输出强度硬约束 */
  family?: Level['family'];
  /** 按契约的差异化参考解/满分线/时序预算（一键出答案按玩家契约给对应工艺解） */
  familyRefs?: Level['familyRefs'];
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
    ...(input.family !== undefined ? { family: input.family } : {}),
    ...(input.familyRefs !== undefined ? { familyRefs: input.familyRefs } : {}),
    budgetHalf: budgetFromOptimal(input.optimalHalf, MAIN_OVERHEAD),
    ...(input.bestKnownHalf !== undefined ? { bestKnownHalf: input.bestKnownHalf } : {}),
    optimalHalf: input.optimalHalf,
    clock: { freqHz: input.freqHz },
    vectors,
    unlock: { name: input.unlockName, kind: 'logic', stage: 1, ports },
    referenceSolution: input.reference,
  });
}

export const TEACH_LEVELS: Level[] = [
  // ---- 元件教学模式：认识各个元件（教学关从关卡链拆出，5 关，点开引导搭建）----
  gateLevel({
    id: 's1-npn',
    title: '认识三极管',
    brief:
      '三极管天生是个「反着来的开关」：基极一通电就导通，把输出拉低。做一扇门磁警示灯：门窗关好灯亮，门窗一开灯就灭。',
    teaching:
      '三极管（NPN）有三只脚：基极（b）、集电极（c）、发射极（e）。它最大的脾气就是「反相」：基极一通电，集电极→发射极导通、把输出拉低（1 → 0）；基极不通电就截止，输出靠上拉电阻钉回 1（0 → 1）。这一关做「反相」：门窗关（0）灯亮（1）、门窗开（1）灯灭（0）。那颗上拉电阻很关键：没人导通时输出会「悬空」乱跳，它把默认值稳稳钉在 1。注意输入的区别：a 是「弱信号源」（像按钮带上拉、带内阻），可以直接接基极；但 VCC 是强电源，直怼基极会过流（真实电路 b-e 只有约 0.7V）——强电源接基极必须经限流电阻。灯有两只脚：一只接输出信号、一只接公共地（地线半成品已帮你接好）——两只脚都接对、回路通了灯才亮。想让灯随输入亮灭，靠的是三极管和电阻这条真正的电路。',
    hint: '基极接输入 a；集电极接输出 y；发射极接 GND；输出再经一个上拉电阻接到 VCC。',
    inputs: 1,
    fn: (a) => (a ? 0 : 1),
    optimalHalf: 8,
    timingBudgetPs: 2000,
    allowedUnits: ['npn', 'res'],
    requiredUnits: ['npn'],
    family: 'rtl', // 契约：本关教学规范
    classroom: {
      title: '三极管：反相开关',
      analogy: '三极管像个「反着来的开关」：基极一通电就导通、把输出拉低 —— 像门一开就把灯拉灭。',
      points: [
        '三只脚各管一摊：基极（b）是开关把手、集电极（c）是进水口、发射极（e）是出水口',
        '基极一通电，集电极到发射极就导通，输出被拉低（1→0）—— 天生的「反相」',
        '没人导通时输出会「悬空」乱跳，要挂上拉电阻把默认值稳稳钉在 1',
        '输入 a 是弱信号源（带内阻），可直接接基极；VCC 是强电源，直连基极要经电阻限流（b-e 只有约 0.7V）',
      ],
    },
    seedDoc: npnIntroSeed(),
    guideSteps: [
      '第一步：把三极管的基极（b）接到输入 a —— 这就是「开关把手」（输入是弱信号源，可以直接接）',
      '第二步：确认输出 y 挂着上拉电阻到 VCC（没有就补一个）',
      '第三步：点「交付验收」，门窗关（0）灯亮、门窗开（1）灯灭就对了',
    ],
    moduleAccess: 'none',
    reference: npnIntroRef('ref-npn-intro'),
    // 教学关按契约变体：CMOS 契约玩家从「认识 MOS」学起（教什么用什么）
    familyRefs: {
      cmos: {
        reference: nmosIntroRef('ref-nmos-intro'),
        optimalHalf: 6, // 1 N-MOS + 1 上拉电阻 = 2 + 4 半分（显示 3）
        title: '认识 MOS · N-MOS',
        allowedUnits: ['nmos', 'res'],
        requiredUnits: ['nmos'],
        brief:
          'MOS 管是电压控制的开关：栅极一给高电平就导通、把输出拉低；栅极几乎不取电流。这一关用 N-MOS 做反相开关。',
        teaching:
          'N-MOS 有三只脚：栅极（g）、漏极（d）、源极（s）。它的脾气和 NPN 三极管很像——栅极高电平就导通（漏→源），把输出拉低（1 → 0）；栅极低电平截止，输出靠上拉电阻钉回 1（0 → 1）。和 NPN 最大的区别：MOS 是「电压控制」，栅极不取电流（NPN 的基极要电流），所以弱信号源直接接栅极毫无压力。这一关做「反相」：a=1 灯灭、a=0 灯亮。',
        hint: 'N-MOS 栅极（g）接输入 a；漏极（d）接输出 y；源极（s）接 GND；输出再经一个上拉电阻接到 VCC。',
        ports: [
          { name: 'a', dir: 'in', width: 1 },
          { name: 'y', dir: 'out', width: 1 },
        ],
        vectors: vectors1((a) => (a ? 0 : 1)),
        seedDoc: nmosIntroSeed(),
        guideSteps: [
          '第一步：把 N-MOS 的栅极（g）接到输入 a —— MOS 是电压控制，弱信号源直接接就行',
          '第二步：确认输出 y 挂着上拉电阻到 VCC（没有就补一个）',
          '第三步：点「交付验收」，a=0 亮、a=1 灭就对了',
        ],
        classroom: {
          title: 'N-MOS：电压开关',
          analogy:
            '水龙头——栅极是把手，给高电平（开水）就导通，水（电流）从漏极流到源极；拧上（低电平）就断流。',
          points: [
            '三只脚：栅极（g）是开关把手、漏极（d）是进水口、源极（s）是出水口',
            '栅极高电平导通，把输出拉低（1→0）；栅极低电平截止，靠上拉电阻把输出钉回 1',
            'MOS 是电压控制：栅极不取电流——弱信号源直接接栅极毫无压力（对比 NPN 基极要电流）',
          ],
        },
      },
    },
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
    timingBudgetPs: 3200,
    allowedUnits: ['dio', 'res'],
    requiredUnits: ['dio'],
    family: 'dtl', // 契约：本关教学规范
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
    // 教学关按契约变体：CMOS 契约下这关换成「认识 MOS · P-MOS」（用户指定：二极管关换 CMOS 概念关）
    familyRefs: {
      cmos: {
        reference: pmosIntroRef('ref-pmos-intro'),
        optimalHalf: 6, // 1 P-MOS + 1 下拉电阻 = 2 + 4 半分（显示 3）
        title: '认识 MOS · P-MOS',
        allowedUnits: ['pmos', 'res'],
        requiredUnits: ['pmos'],
        brief:
          'P-MOS 和 N-MOS 正好相反：栅极给低电平才导通，把输出拉高到 VCC。它是 CMOS 互补对的另一半。',
        teaching:
          'P-MOS 也是三只脚（栅极 g / 漏极 d / 源极 s），但脾气和 N-MOS 相反：栅极**低电平**才导通，把输出拉高到 VCC；栅极高电平截止，输出靠下拉电阻钉回 0。N-MOS 栅高导通、P-MOS 栅低导通——一对互补：CMOS 反相器就是上面 P 下面 N，任何时刻恰有一个导通。栅极悬空是 CMOS 大忌：悬空的栅极没人驱动，电平不确定，受噪声影响乱跳（不像三极管基极悬空只是截止）。',
        hint: 'P-MOS 栅极（g）接输入 a；漏极（d）接输出 y；源极（s）接 VCC；输出再经一个下拉电阻接到 GND。',
        ports: [
          { name: 'a', dir: 'in', width: 1 },
          { name: 'y', dir: 'out', width: 1 },
        ],
        vectors: vectors1((a) => (a ? 0 : 1)),
        seedDoc: pmosIntroSeed(),
        guideSteps: [
          '第一步：把 P-MOS 的栅极（g）接到输入 a',
          '第二步：确认输出 y 挂着下拉电阻到 GND（没有就补一个）',
          '第三步：点「交付验收」，a=0 亮、a=1 灭就对了',
        ],
        classroom: {
          title: 'P-MOS：反着来的开关',
          analogy:
            '电闸——栅极给低电平（拉闸）才导通，把输出顶到 VCC；栅极一松（高电平）就断流，靠下拉电阻兜底。',
          points: [
            '栅极低电平导通、高电平截止——和 N-MOS 正好相反，互补对的另一半',
            '导通时把输出拉到 VCC（高）；没人导通时靠下拉电阻把输出钉回 0',
            '栅极悬空是 CMOS 大忌：没人驱动、电平不确定，受噪声影响乱跳',
          ],
        },
      },
    },
    unlockName: '二极管或门',
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-float',
    title: '悬空与默认电平',
    brief:
      '没人驱动的线会「悬空」乱跳。用电阻把输出稳稳接到 VCC（默认 1）或 GND（默认 0）—— 像弹簧门没人推时自己关着。',
    teaching:
      '上拉电阻 = 把输出默认钉在 1；下拉电阻 = 默认钉在 0。这一关用上拉：平时输出默认 1，输入 a 一给电，三极管就把输出拉低（0）—— 也就是把 a「反」了一下。输入 a 是弱信号源，直接接基极没问题；VCC 强电源直连基极才要限流（b-e 只有约 0.7V）。下一关非门就用这个原理。',
    hint: '输出 y 经一个电阻接到 VCC（上拉，默认 1）；三极管集电极接 y、发射极接 GND、基极接输入 a。',
    inputs: 1,
    fn: (a) => (a ? 0 : 1),
    optimalHalf: 8,
    timingBudgetPs: 2000,
    allowedUnits: ['npn', 'res'],
    requiredUnits: ['npn'],
    family: 'rtl', // 契约：本关教学规范
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
      '第一步：挂一个上拉电阻，把输出 y 接到 VCC（默认 1）',
      '第二步：点「交付验收」，a=0 亮、a=1 灭就对了',
    ],
    moduleAccess: 'none',
    reference: floatIntroRef('ref-float-intro'),
    // 教学关按契约变体：CMOS 契约下这关做 CMOS 反相器，讲「栅极悬空大忌」+ 推挽无电阻
    familyRefs: {
      cmos: {
        reference: cmosInvRef('ref-float-cmos'),
        optimalHalf: 4, // 1 pMOS + 1 nMOS = 2 + 2 半分（显示 2）：互补对推挽，不需要电阻
        title: '悬空与默认电平（CMOS）',
        allowedUnits: ['nmos', 'pmos', 'res'],
        requiredUnits: ['nmos', 'pmos'],
        brief:
          '没人驱动的线会悬空乱跳——CMOS 里更危险：栅极悬空时 p/n 都可能微导通，VCC 直通 GND。这一关做 CMOS 反相器：互补对推挽，任何时刻都有管子强驱动，根本不需要电阻。',
        teaching:
          'CMOS 反相器 = 上 pMOS + 下 nMOS：输入 a 同时接两个栅极——a=0 时 pMOS 导通把输出拉到 VCC（强 1）、nMOS 截止；a=1 时反过来。这就是「推挽」：任何时刻都有一个管子强驱动输出，不用上拉/下拉电阻。对比前面：栅极悬空是 CMOS 大忌——悬空的栅极没人驱动，电平不确定（受噪声影响乱跳），CMOS 里还可能 p/n 同时微导通、VCC 直通 GND 发热。所以每个栅极都必须接点什么。',
        hint: '把输入 a 分别接到 P1 的栅极和 N1 的栅极——两个栅极并在一起，就是互补对（不需要任何电阻）。',
        ports: [
          { name: 'a', dir: 'in', width: 1 },
          { name: 'y', dir: 'out', width: 1 },
        ],
        vectors: vectors1((a) => (a ? 0 : 1)),
        seedDoc: cmosInvSeed(),
        guideSteps: [
          '第一步：看——两个管子都放好了，但栅极悬空，输出 y 谁也驱动不了（悬空 = 没人驱动）',
          '第二步：把输入 a 接到 P1 的栅极（pMOS 栅低才导通）',
          '第三步：把输入 a 也接到 N1 的栅极（nMOS 栅高才导通）——两个栅极并在一起，互补对完成',
          '第四步：点「交付验收」：a=0 亮、a=1 灭，强驱动、无电阻',
        ],
        classroom: {
          title: '悬空与默认电平（CMOS 版）',
          analogy:
            '跷跷板——pMOS 压高、nMOS 压低，任何时刻都有一边落地（推挽）；没人坐上去就悬空乱晃（悬空）。',
          points: [
            '互补对推挽：上 pMOS + 下 nMOS，任何时刻恰有一个导通，输出被强驱动',
            'CMOS 反相器不需要上拉/下拉电阻——这是它比 RTL 便宜又稳的原因',
            '栅极悬空是 CMOS 大忌：没人驱动、电平不确定，还可能 p/n 同时微导通、VCC 直通 GND',
          ],
        },
      },
    },
    unlockName: '上拉反相器',
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-cmos-inv',
    title: 'CMOS 反相器',
    brief:
      '告别上拉电阻——上 pMOS 下 nMOS 的「互补对」：一个导通另一个必截止，输出被直接钉到 VCC 或 GND（轨到轨强驱动），还没有电阻拖累。',
    teaching:
      'CMOS 是工业界的终极答案：无电阻、推挽强输出、不耗静态电。这一关把输入 a 同时接到两个栅极：a=0 时 pMOS 导通、nMOS 截止 → y 强 1；a=1 时反过来 → y 强 0。判定的 CMOS 契约会检查你的输出必须是强 1（弱上拉凑出来的过不了关）。',
    hint: '把输入 a 分别接到 P1 的栅极和 N1 的栅极——两个栅极并在一起，就是互补对。',
    inputs: 1,
    fn: (a: 0 | 1) => (a ? 0 : 1),
    optimalHalf: 4, // 1 pMOS + 1 nMOS = 2 + 2 半分（显示 2）
    timingBudgetPs: 2800,
    allowedUnits: ['nmos', 'pmos'],
    requiredUnits: ['nmos', 'pmos'],
    family: 'cmos',
    classroom: {
      title: 'CMOS：互补 MOS 工艺',
      analogy:
        '跷跷板两端各坐一个人——pMOS 管管「拉高」、nMOS 管管「拉低」，栅极一给信号，永远只有一边落地。',
      points: [
        '互补对：上 pMOS（栅低导通）下 nMOS（栅高导通），输入并接两个栅极',
        '输出轨到轨：高 = 强 1（拉到 VCC）、低 = 强 0（拉到 GND），推挽驱动',
        '没有电阻：CMOS 门不靠上拉凑电平，又便宜又不耗静态电——这就是它取代 RTL/DTL/TTL 的原因',
      ],
    },
    seedDoc: cmosInvSeed(),
    guideSteps: [
      '第一步：看——两个管子都放好了，但栅极悬空、输入 a 没接，输出 y 谁也驱动不了',
      '第二步：把输入 a 接到 P1 的栅极（pMOS 栅低才导通）',
      '第三步：把输入 a 也接到 N1 的栅极（nMOS 栅高才导通）——两个栅极并在一起',
      '第四步：点「交付验收」：a=0 亮、a=1 灭，且输出是强驱动（CMOS 契约检查）',
    ],
    moduleAccess: 'none',
    reference: cmosInvRef('ref-cmos-inv'),
    unlockName: 'CMOS 反相器',
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-cmos-nand',
    title: 'CMOS 与非门',
    brief:
      '上 pMOS 并联、下 nMOS 串联的互补结构：任一输入为 0 → 输出被强拉到 1；两个输入都为 1 → 下管串联导通，输出强拉到 0。4 个管子拼出与非门，比 2 三极管 + 3 电阻省一半。',
    teaching:
      'CMOS 门怎么搭：把「拉高网络」和「拉低网络」做成互补——与非门要「全 1 才拉低」，所以下管（拉低）串联、上管（拉高）并联。记住口诀：**串联导通 = 与，并联导通 = 或**；与非 = 拉低网络串联。',
    hint: '两个 pMOS 并联接 VCC→y（任一输入 0 都拉高）；两个 nMOS 串联接 y→GND（两输入都为 1 才拉低）。把 a 接到 P1 和 N1 的栅极，b 接到 P2 和 N2 的栅极。',
    inputs: 2,
    fn: (a: 0 | 1, b: 0 | 1) => (a === 1 && b === 1 ? 0 : 1),
    optimalHalf: 8, // 2 pMOS + 2 nMOS = 4 × 2 半分（显示 4）
    timingBudgetPs: 4200,
    allowedUnits: ['nmos', 'pmos'],
    requiredUnits: ['nmos', 'pmos'],
    family: 'cmos',
    classroom: {
      title: 'CMOS 与非门：互补结构',
      analogy:
        '两道闸门串联（下管）才能把水放掉，两条旁路并联（上管）只要开一条就把水位顶上去——串联导通 = 与，并联导通 = 或。',
      points: [
        '拉低网络（nMOS）串联：两个输入都为 1 才导通 → 输出才被拉低 = 与非',
        '拉高网络（pMOS）并联：任一输入为 0 就拉高 → 高电平是强 1',
        '4 个管子无电阻：CMOS 与非门成本 8 半分，比 RTL 的 20 省一半还多',
      ],
    },
    seedDoc: cmosNandSeed(),
    guideSteps: [
      '第一步：看——四个管子摆好了但全悬空，输出 y 谁也驱动不了',
      '第二步：把输入 a 接到 P1 和 N1 的栅极；输入 b 接到 P2 和 N2 的栅极',
      '第三步：核对结构——上管 pMOS 并联（都接 VCC→y），下管 nMOS 串联（y→N1→N2→GND）',
      '第四步：点「交付验收」：全 1 才灭，其余全亮',
    ],
    moduleAccess: 'none',
    reference: cmosNandRef('ref-cmos-nand'),
    unlockName: 'CMOS 与非门',
    freqHz: 100_000,
  }),
];

/** 第一章主线：基础门电路（教学关已拆入 TEACH_LEVELS 教学模式，s1-not 起） */
export const STAGE1_LEVELS: Level[] = [
  gateLevel({
    id: 's1-not',
    title: '非门',
    brief: '输入为高时输出低、输入为低时输出高。',
    teaching:
      '三极管当开关：基极给高电平就导通，把集电极拉低。输出高电平是「上拉电阻给的弱 1」，这是 RTL 的典型特征。',
    hint: '一个 NPN + 基极限流电阻 + 集电极上拉电阻就够了（成本 4）。想要输出更强的 1，可以在后面加一级射极跟随器（成本 7）。',
    inputs: 1,
    fn: (a) => (a ? 0 : 1),
    optimalHalf: 12,
    // 更优解：省掉基极限流电阻（基极直连输入，1 NPN + 1 上拉电阻 = 6）功能仍正确——
    // 输入 a 是弱信号源，可以直接接基极；满分线仍按标准做法（带基极电阻）8 定。
    bestKnownHalf: 8,
    timingBudgetPs: 3000,
    moduleAccess: 'none',
    reference: notGateRef('ref-not'),
    unlockName: '非门',
    familyRefs: {
      cmos: { reference: cmosInvRef('ref-s1-not-cmos'), optimalHalf: 4, timingBudgetPs: 2800 },
      ttl: { reference: ttlNotRef('ref-s1-not-ttl'), optimalHalf: 16, timingBudgetPs: 4000 },
    },
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-and',
    title: '与门',
    brief: '两个输入都为高时输出才为高；任一输入为低，输出就为低。',
    teaching: '二极管构成「线或/线与」逻辑：只要有一个阴极被拉低，公共阳极就被压到低。',
    hint: '两个二极管的阳极并在一起接输出，输出再用一个电阻上拉到 VCC；两个阴极分别接输入。',
    inputs: 2,
    fn: (a, b) => (a && b ? 1 : 0),
    optimalHalf: 8,
    timingBudgetPs: 3200,
    moduleAccess: 'none',
    reference: andGateRef('ref-and'),
    unlockName: '与门',
    familyRefs: {
      cmos: { reference: cmosAndRef('ref-s1-and-cmos'), optimalHalf: 12, timingBudgetPs: 4200 },
      ttl: { reference: ttlAndRef('ref-s1-and-ttl'), optimalHalf: 28, timingBudgetPs: 8000 },
    },
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-or',
    title: '或门',
    brief: '只要有一个输入为高，输出就为高。',
    teaching: '输出改成下拉电阻、二极管阳极接输入：任一路拉高就把输出顶上去。',
    hint: '两个二极管阳极分别接输入、阴极并在一起接输出，输出再用一个电阻下拉到 GND。',
    inputs: 2,
    fn: (a, b) => (a || b ? 1 : 0),
    optimalHalf: 8,
    timingBudgetPs: 3200,
    moduleAccess: 'none',
    reference: orGateRef('ref-or'),
    unlockName: '或门',
    familyRefs: {
      cmos: { reference: cmosOrRef('ref-s1-or-cmos'), optimalHalf: 12, timingBudgetPs: 5600 },
      ttl: { reference: ttlOrRef('ref-s1-or-ttl'), optimalHalf: 28, timingBudgetPs: 6000 },
    },
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-nand',
    title: '与非门',
    brief: '与门取反：只有两个输入都为高时输出才为低。',
    teaching: '两个三极管**串联**下拉：必须两个都导通，输出才会被拉低 —— 这就是「与非」。',
    hint: 'Q1 的发射极接到 Q2 的集电极（串联），Q2 的发射极接 GND；输出从 Q1 集电极取出并上拉。',
    inputs: 2,
    fn: (a, b) => (a && b ? 0 : 1),
    optimalHalf: 20,
    bestKnownHalf: 12,
    timingBudgetPs: 5000,
    moduleAccess: 'all',
    reference: nandGateRef('ref-nand'),
    unlockName: '与非门',
    familyRefs: {
      cmos: { reference: cmosNandRef('ref-s1-nand-cmos'), optimalHalf: 8, timingBudgetPs: 4200 },
      ttl: { reference: ttlNandRef('ref-s1-nand-ttl'), optimalHalf: 20, timingBudgetPs: 6000 },
    },
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
    optimalHalf: 20,
    bestKnownHalf: 12,
    timingBudgetPs: 3000,
    moduleAccess: 'all',
    reference: norFastRef('ref-nor'),
    unlockName: '或非门',
    familyRefs: {
      cmos: { reference: cmosNorRef('ref-s1-nor-cmos'), optimalHalf: 8, timingBudgetPs: 4200 },
      ttl: { reference: ttlNorRef('ref-s1-nor-ttl'), optimalHalf: 20, timingBudgetPs: 4000 },
    },
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-xor',
    title: '异或门',
    brief: '两个输入不同时输出为高，相同时为低。',
    teaching:
      '这一关验收的是模块复用：用自己封装好的与非门当积木，比手搭省心得多（成本一样是 4 个与非门）。',
    hint: '标准接法：n1 = NAND(a,b)；n2 = NAND(a,n1)；n3 = NAND(b,n1)；y = NAND(n2,n3)。四个与非门共 8 个三极管 + 12 个电阻（成本 28）。',
    inputs: 2,
    fn: (a, b) => (a !== b ? 1 : 0),
    // 满分线 = 标准解（4 个与非门 = 56 半单位）；求解器找到过更省的 42（弱输出与门 + 两个或非门），
    // 记在 bestKnownHalf 里：谁能做到谁就破榜，但课上教的解法照样满分。
    optimalHalf: 80,
    bestKnownHalf: 44,
    timingBudgetPs: 13000,
    allowedUnits: ['npn', 'res'],
    // 不锁积木：玩家想用刚封装的【或非门】【与门】自己组，就让他组——「用什么搭」也是
    // 解题的一部分。只有考点本身就是「手搭/指定元件」的关（s1-not/and/or、教学关）
    // 才用 moduleAccess 'none' 收窄。
    moduleAccess: 'all',
    reference: xorGateRef('ref-xor'),
    unlockName: '异或门',
    familyRefs: {
      cmos: { reference: cmosXorRef('ref-s1-xor-cmos'), optimalHalf: 32, timingBudgetPs: 9800 },
    },
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-xnor',
    title: '同或门',
    brief: '异或门取反：两个输入相同时输出为高。',
    teaching: '组合已有模块是本作的核心玩法：异或门 + 非门，成本 28 + 4 = 32。',
    hint: '把异或门的输出再接一级单管反相器即可（求解器确认这就是最省的做法）。',
    inputs: 2,
    fn: (a: 0 | 1, b: 0 | 1) => (a === b ? 1 : 0),
    optimalHalf: 92,
    // 求解器结论：异或门 + 无基极限流电阻的反相器 = 54（输入 a 是弱信号源可直接接
    // 基极；比带基极电阻的反相器省 2）——记作已知最省。
    bestKnownHalf: 48,
    timingBudgetPs: 16000,
    allowedUnits: ['npn', 'res'],
    moduleAccess: 'all', // 同 s1-xor：不锁积木，只给推荐解法
    reference: xnorGateRef('ref-xnor'),
    unlockName: '同或门',
    familyRefs: {
      cmos: { reference: cmosXnorRef('ref-s1-xnor-cmos'), optimalHalf: 36, timingBudgetPs: 11200 },
    },
    freqHz: 100_000,
  }),
];

/** 全部关卡（阶段 1 逻辑门 + 阶段 2 时序单元 + 阶段 3 算术单元），顺序即解锁顺序。
 *  不含教学关——教学关在 TEACH_LEVELS，走独立「教学模式」（认识元件，不评星不锁链）。 */
export const ALL_LEVELS: Level[] = [...STAGE1_LEVELS, ...STAGE2_LEVELS, ...STAGE3_LEVELS];

/** 元件教学模式：认识各个元件（5 关：三极管/二极管/悬空与默认电平/CMOS 反相器/CMOS 与非门）。
 *  与关卡链并列：不评星、不参与解锁链，点开引导搭建，交付标「已掌握」。 */
export function findTeachLevel(id: string): Level | undefined {
  return TEACH_LEVELS.find((level) => level.id === id);
}

export function isTeachLevel(id: string): boolean {
  return TEACH_LEVELS.some((level) => level.id === id);
}

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
