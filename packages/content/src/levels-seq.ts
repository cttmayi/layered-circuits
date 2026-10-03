/**
 * 阶段 2（时序单元）关卡内容 —— GDD 第 3 节。
 *
 * 三步走：SR 锁存器（能记 1 比特）→ D 锁存器（由使能端决定何时记）→ 主从 D 触发器（只在时钟沿记一次）。
 *
 * 与阶段 1 的差别：
 *  - 端口约束里有**时钟/使能**端口，向量带 settlePs，判定在「时间」上做；
 *  - 判定不再是纯组合：同一组输入在不同历史下输出不同（保持行就是专门考记忆的）；
 *  - 硬核模式额外查**空翻**（每个向量窗口内输出跳变次数）与**建立/保持时间**（真仿真扫出来的）。
 */

import {
  budgetFromOptimal,
  type Level,
  type LevelVector,
  type ModulePort,
  parseLevel,
} from '@lc/schema';
import { btnLatchRef, dffRef, dLatchRef, srLatchRef } from './references-seq.js';

/** 阶段 2 允许的元件：还是只能用手搭（时钟/使能由端口给出，电容仍不开放） */
const STAGE2_UNITS = ['npn', 'res', 'dio'] as const;

/** 预算线 = 标准答案 × 2（评星契约：0.5×预算 = 标准答案 = 3 星档） */
const MAIN_OVERHEAD = 1.0;

/** 时序关卡的采样等待：锁存器/触发器关卡的向量是「时钟电平保持一段」，按 20MHz 取半周期 25ns */
const DFF_SETTLE_PS = 25_000;

/** D 触发器的端口与向量（主关、成本挑战关、时序挑战关共用同一套功能规格） */
const DFF_PORTS = [port('d', 'in'), port('clk', 'in'), port('q', 'out'), port('qn', 'out')];

const DFF_VECTORS = [
  { inputs: { clk: 0, d: 0 }, settlePs: DFF_SETTLE_PS, note: '建立初态（主锁存器透明）' },
  {
    inputs: { clk: 1, d: 0 },
    expect: { q: 0, qn: 1 },
    settlePs: DFF_SETTLE_PS,
    note: '上升沿把 0 搬到输出',
  },
  {
    inputs: { clk: 0, d: 1 },
    expect: { q: 0, qn: 1 },
    settlePs: DFF_SETTLE_PS,
    note: '时钟低电平期间数据变化不影响输出',
  },
  {
    inputs: { clk: 1, d: 1 },
    expect: { q: 1, qn: 0 },
    settlePs: DFF_SETTLE_PS,
    note: '上升沿把 1 搬到输出',
  },
  {
    inputs: { clk: 1, d: 0 },
    expect: { q: 1, qn: 0 },
    settlePs: DFF_SETTLE_PS,
    note: '时钟高电平期间改数据，输出纹丝不动（无空翻）',
  },
  {
    inputs: { clk: 0, d: 0 },
    expect: { q: 1, qn: 0 },
    settlePs: DFF_SETTLE_PS,
    note: '下降沿不搬运',
  },
  {
    inputs: { clk: 1, d: 0 },
    expect: { q: 0, qn: 1 },
    settlePs: DFF_SETTLE_PS,
    note: '下一个上升沿把 0 搬到输出',
  },
] satisfies LevelVector[];

function port(name: string, dir: 'in' | 'out'): ModulePort {
  return { id: name, name, dir, width: 1 };
}

export const STAGE2_LEVELS: Level[] = [
  parseLevel({
    schemaVersion: 1,
    id: 's2-sr-latch',
    stage: 2,
    kind: 'main',
    title: 'SR 锁存器',
    brief:
      'sn / rn 是低有效的置位与复位端：置位/复位过后，电路要「记住」最后一次操作 —— 两个输入都为高时，输出不该跟着输入跑。',
    teaching:
      '交叉耦合是记忆的源头：每个门的输出都去喂另一个门的输入，于是存在两个自洽的稳定状态（q=1 或 q=0）。' +
      '输入只是「把电路推倒某一侧」，推完松手它自己会稳住。',
    hint: '与非门的输出 q 通过电阻接到另一个与非门的一个输入，另一路同理接成 q → 与门 2、qn → 与门 1。低成本做法：直接手搭两个与非门（成本 14）。',
    mode: 'logic',
    allowedUnits: [...STAGE2_UNITS],
    moduleAccess: 'all',
    budgetHalf: budgetFromOptimal(40, MAIN_OVERHEAD),
    optimalHalf: 40,
    timingBudgetPs: 8000,
    clock: { freqHz: 100_000 },
    checks: {},
    vectors: [
      { inputs: { sn: 0, rn: 1 }, expect: { q: 1, qn: 0 }, note: '置位（低有效）' },
      { inputs: { sn: 1, rn: 1 }, expect: { q: 1, qn: 0 }, note: '松手保持' },
      { inputs: { sn: 1, rn: 0 }, expect: { q: 0, qn: 1 }, note: '复位（低有效）' },
      { inputs: { sn: 1, rn: 1 }, expect: { q: 0, qn: 1 }, note: '松手保持' },
    ] satisfies LevelVector[],
    unlock: {
      name: 'SR锁存器',
      kind: 'seq',
      stage: 2,
      ports: [port('sn', 'in'), port('rn', 'in'), port('q', 'out'), port('qn', 'out')],
    },
    referenceSolution: srLatchRef('ref-s2-sr'),
  }),

  parseLevel({
    schemaVersion: 1,
    id: 's2-btn-latch',
    stage: 2,
    kind: 'main',
    title: '按钮锁存',
    brief:
      '按钮是瞬时按键：按下去电平变 1，一松手就自动弹回 0。要把「按过」这件事记住：按一下置位、rst 清零。',
    teaching:
      '按钮本身不保持状态，锁存器才保持。把按钮接到 SR 锁存器的置位端（S）、rst 接复位端（R）：' +
      '按钮按下（S=1）→ q=1 并保持；rst=1 → q=0 并保持。与 s2-sr-latch 同一结构，只是置位端变成按钮 —— ' +
      '先把高有效的 btn/rst 反相成低有效端，再进与非门交叉耦合（或非门交叉耦合在弱电平保持态不稳，勿用）。',
    hint: '两个【非门】把 btn/rst 反相成 sn/rn，再拖 2 个【与非门】交叉耦合（G1: sn+qn→q，G2: rn+q→qn）；或用【SR锁存器】积木把低有效端反相。参考解成本 64。',
    ports: [
      { id: 'btn', name: 'btn', dir: 'in', button: true },
      port('rst', 'in'),
      port('q', 'out'),
    ],
    mode: 'logic',
    allowedUnits: [...STAGE2_UNITS],
    moduleAccess: 'all',
    budgetHalf: budgetFromOptimal(64, MAIN_OVERHEAD),
    optimalHalf: 64,
    timingBudgetPs: 11000,
    clock: { freqHz: 100_000 },
    checks: {},
    vectors: [
      { inputs: { btn: 0, rst: 1 }, expect: { q: 0 }, note: 'rst 复位：初始为 0' },
      { inputs: { btn: 0, rst: 0 }, expect: { q: 0 }, note: '松开 rst：保持 0' },
      { inputs: { btn: 1, rst: 0 }, expect: { q: 1 }, note: '按下按钮：置位' },
      { inputs: { btn: 0, rst: 0 }, expect: { q: 1 }, note: '松开按钮：保持 1' },
      { inputs: { btn: 0, rst: 1 }, expect: { q: 0 }, note: '再按 rst：清零' },
    ] satisfies LevelVector[],
    // 时序电路（输出依赖历史）：unlock.kind='seq' 让判定器放行；解锁「按钮锁存器」积木供后续复用
    unlock: {
      name: '按钮锁存器',
      kind: 'seq',
      stage: 2,
      ports: [port('btn', 'in'), port('rst', 'in'), port('q', 'out')],
    },
    referenceSolution: btnLatchRef('ref-s2-btn-latch'),
  }),

  parseLevel({
    schemaVersion: 1,
    id: 's2-d-latch',
    stage: 2,
    kind: 'main',
    title: 'D 锁存器',
    brief:
      '只有一个数据端 d 和一个使能端 en：en 为高时输出跟着 d 变（透明），en 变低后输出保持住（锁存），此时 d 再怎么变都不影响输出。',
    teaching:
      '把 SR 锁存器的两个输入换成「d 与 d 的反相」，再用 en 做门控 —— 这样就不会出现两个输入同时有效的非法状态，' +
      '一条数据线就能控制记忆。透明与锁存的分界，就是 en 的跳变沿。',
    hint: '先做一个单管反相器得到 d 的反相，再用两个与非门做门控（NAND(d,en) 与 NAND(d′,en)），最后接上 SR 锁存器的两个与非门。共 4 个与非门 + 1 个反相器（成本 32）。',
    mode: 'logic',
    allowedUnits: [...STAGE2_UNITS],
    moduleAccess: 'all',
    budgetHalf: budgetFromOptimal(92, MAIN_OVERHEAD),
    optimalHalf: 92,
    timingBudgetPs: 14000,
    clock: { freqHz: 100_000 },
    checks: {},
    vectors: [
      { inputs: { en: 1, d: 1 }, expect: { q: 1 }, note: '透明：跟着 d' },
      { inputs: { en: 0, d: 1 }, expect: { q: 1 }, note: '锁存：保持 1' },
      { inputs: { en: 0, d: 0 }, expect: { q: 1 }, note: '锁存期间 d 变化不影响' },
      { inputs: { en: 1, d: 0 }, expect: { q: 0 }, note: '透明：跟着 d' },
      { inputs: { en: 0, d: 1 }, expect: { q: 0 }, note: '锁存：保持 0' },
    ] satisfies LevelVector[],
    unlock: {
      name: 'D锁存器',
      kind: 'seq',
      stage: 2,
      ports: [port('d', 'in'), port('en', 'in'), port('q', 'out')],
    },
    referenceSolution: dLatchRef('ref-s2-dlatch'),
  }),

  parseLevel({
    schemaVersion: 1,
    id: 's2-dff',
    stage: 2,
    kind: 'main',
    title: '主从 D 触发器',
    brief:
      '时钟为高电平期间改数据，输出必须纹丝不动；只有在 clk 上升沿，d 才会被搬到输出。这是「边沿触发」与「锁存器」的分水岭。',
    teaching:
      '两个锁存器一主一从、使能互补：clk 低时主锁存器采样、从锁存器关着；clk 高时反过来，' +
      '数据被整体搬运一次。所以整个时钟周期里输出只会跳一次，抖动（空翻）被挡在主锁存器里。',
    hint: '主锁存器用「反相的 clk」使能、从锁存器用 clk 使能，再把主的输出送到从的数据端；时钟反相用一个单管反相器即可（成本 68）。',
    mode: 'timing',
    timingBudgetPs: 13_000,
    allowedUnits: [...STAGE2_UNITS],
    moduleAccess: 'all',
    budgetHalf: budgetFromOptimal(196, MAIN_OVERHEAD),
    optimalHalf: 196,
    clock: { freqHz: 20_000_000 },
    checks: {
      clockPort: 'clk',
      dataPort: 'd',
      maxGlitches: 1,
      setupBudgetPs: 5_000,
      holdBudgetPs: 5_000,
    },
    vectors: DFF_VECTORS,
    unlock: {
      name: 'D触发器',
      kind: 'seq',
      stage: 2,
      ports: DFF_PORTS,
    },
    referenceSolution: dffRef('ref-s2-dff'),
  }),
];
