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

import { budgetFromOptimal, type Level, type LevelVector, parseLevel } from '@lc/schema';
import { STAGE2_LEVELS } from './levels-seq.js';
import {
  andGateRef,
  nandGateRef,
  norGateRef,
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
  timingBudgetPs: number;
  moduleAccess: 'none' | 'all';
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
    kind: 'main',
    title: input.title,
    brief: input.brief,
    teaching: input.teaching,
    hint: input.hint,
    mode: 'logic',
    timingBudgetPs: input.timingBudgetPs,
    allowedUnits: [...STAGE1_UNITS],
    moduleAccess: input.moduleAccess,
    budgetHalf: budgetFromOptimal(input.optimalHalf, MAIN_OVERHEAD),
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
      '把已经搭好的「或」当作一级，再接一级反相器，就是模块化组合的思路（这一关之后你也能这么做）。',
    hint: '二极管或门的输出再串一个电阻到 NPN 基极，集电极上拉就是输出（成本 8）。',
    inputs: 2,
    fn: (a, b) => (a || b ? 0 : 1),
    optimalHalf: 16,
    timingBudgetPs: 4000,
    moduleAccess: 'all',
    reference: norGateRef('ref-nor'),
    unlockName: '或非门',
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-xor',
    title: '异或门',
    brief: '两个输入不同时输出为高，相同时为低。试试用 4 个与非门拼出来。',
    teaching: '同一个逻辑功能可以有完全不同的实现；只要功能对、成本在预算内就算过关。',
    hint: '标准接法：n1 = NAND(a,b)；n2 = NAND(a,n1)；n3 = NAND(b,n1)；y = NAND(n2,n3)。四级共 8 个三极管 + 12 个电阻（成本 28）。',
    inputs: 2,
    fn: (a, b) => (a !== b ? 1 : 0),
    optimalHalf: 56,
    timingBudgetPs: 7000,
    moduleAccess: 'all',
    reference: xorGateRef('ref-xor'),
    unlockName: '异或门',
    freqHz: 100_000,
  }),
  gateLevel({
    id: 's1-xnor',
    title: '同或门',
    brief: '异或门取反：两个输入相同时输出为高。这一关用「异或 + 反相」最省。',
    teaching: '组合已有模块是本作的核心玩法：异或门 + 非门，成本 28 + 4 = 32。',
    hint: '把异或门的输出再接一级单管反相器即可。',
    inputs: 2,
    fn: (a: 0 | 1, b: 0 | 1) => (a === b ? 1 : 0),
    optimalHalf: 64,
    timingBudgetPs: 9000,
    moduleAccess: 'all',
    reference: xnorGateRef('ref-xnor'),
    unlockName: '同或门',
    freqHz: 100_000,
  }),
];

/** 全部关卡（阶段 1 组合逻辑 + 阶段 2 时序单元），顺序即解锁顺序 */
export const ALL_LEVELS: Level[] = [...STAGE1_LEVELS, ...STAGE2_LEVELS];

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
