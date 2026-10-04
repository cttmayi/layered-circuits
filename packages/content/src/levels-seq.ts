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
      'sn / rn 是低有效的置位与复位端：sn 拉低就把输出置位（q=1、qn=0），rn 拉低就复位（q=0、qn=1）；' +
      '两个都回到高时输出保持不动 —— 记住上一次的结果，就是这一关的全部要求。要交的端口是 sn、rn（输入）和 q、qn（输出，互补）。',
    teaching:
      '记忆来自交叉耦合：把两个门的输出各自接回另一个门的输入，电路就有了两个自洽的稳定状态（q=1 或 q=0）——' +
      '输入只负责把电路推到其中一侧，推完松手它自己停在那儿，这就是「锁存」。' +
      '用与非门交叉耦合时，有效动作天生是低电平（任一输入为 0 就把它顶成 1），所以端口是低有效的 sn / rn。' +
      '注意 sn、rn 同时被拉低时两边都想置位、输出不确定：这个状态既不要求也不测，别依赖它。',
    hint:
      '照着参考解搭两个与非门交叉耦合：G1 = NAND(sn, qn) 输出 q，G2 = NAND(rn, q) 输出 qn（qn 直接取自 G2，不用再加非门）。' +
      'RTL 与非门：两个三极管串联下拉（Q1 集电极接输出、发射极接 Q2 集电极，Q2 发射极接 GND），两个基极各经一个电阻接输入，输出再上拉到 VCC。' +
      '成本 4 个三极管 + 6 个电阻 = 20 元（40 半单位），正好是本关最省做法。',
    mode: 'logic',
    allowedUnits: [...STAGE2_UNITS],
    moduleAccess: 'all',
    budgetHalf: budgetFromOptimal(40, MAIN_OVERHEAD),
    optimalHalf: 40,
    timingBudgetPs: 8000,
    clock: { freqHz: 100_000 },
    checks: {},
    vectors: [
      { inputs: { sn: 0, rn: 1 }, expect: { q: 1, qn: 0 }, note: '置位：sn 拉低 → q=1' },
      { inputs: { sn: 1, rn: 1 }, expect: { q: 1, qn: 0 }, note: '保持：沿用上一次的 q=1' },
      { inputs: { sn: 1, rn: 0 }, expect: { q: 0, qn: 1 }, note: '复位：rn 拉低 → q=0' },
      { inputs: { sn: 1, rn: 1 }, expect: { q: 0, qn: 1 }, note: '保持：沿用上一次的 q=0' },
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
