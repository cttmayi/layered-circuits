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

import { budgetFromOptimal, type Level, type LevelVector, parseLevel, type Unit } from '@lc/schema';
import { STAGE3_LEVELS } from './levels-ari.js';
import { STAGE2_LEVELS } from './levels-seq.js';
import {
  andGateRef,
  nandGateRef,
  norFastRef,
  notGateRef,
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
    // 更优解：省掉基极限流电阻（基极直连输入，1 NPN + 1 上拉电阻 = 6）功能仍正确，
    // 求解器/玩家发现过 —— 满分线仍按标准做法（带限流电阻）8 定，这里记下已知最优。
    bestKnownHalf: 6,
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
