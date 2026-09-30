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
import { dffRef, dLatchRef, srLatchRef } from './references-seq.js';

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
      'sn / rn 是低有效的置位与复位端。把两个与非门的输出互相接到对方的输入，电路就会「记住」最后一次操作 —— 两个输入都为高时，输出不该跟着输入跑。',
    teaching:
      '交叉耦合是记忆的源头：每个门的输出都去喂另一个门的输入，于是存在两个自洽的稳定状态（q=1 或 q=0）。' +
      '输入只是「把电路推倒某一侧」，推完松手它自己会稳住。',
    hint: '与非门的输出 q 通过电阻接到另一个与非门的一个输入，另一路同理接成 q → 与门 2、qn → 与门 1。低成本做法：直接手搭两个与非门（成本 14）。',
    mode: 'logic',
    allowedUnits: [...STAGE2_UNITS],
    moduleAccess: 'all',
    budgetHalf: budgetFromOptimal(40, MAIN_OVERHEAD),
    optimalHalf: 40,
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

  // ---- 挑战关（GDD 4.2 / 4.3）：同样的功能，换一种考核方式 ----
  parseLevel({
    schemaVersion: 1,
    id: 's2-dff-cost',
    stage: 2,
    kind: 'cost',
    title: 'D 触发器·极限成本',
    brief:
      '功能要求与主从 D 触发器完全相同，**但没有元件成本上限**：造得再贵也能通关，比的是谁更省。' +
      '成绩会记进本地的重挑战榜。',
    teaching:
      '成本挑战关考的是「能不能再用少一个元件」：把每个三极管、每个电阻的用途都想清楚，' +
      '经常能发现某一级其实可以合并。',
    hint: '参考解用了 68（两个 D 锁存器 + 一个单管反相器）。想更省，可以试试主锁存器只保留必要的门控管，或者复用同一个反相器给两级用。',
    mode: 'timing',
    timingBudgetPs: 13_000,
    allowedUnits: [...STAGE2_UNITS],
    moduleAccess: 'all',
    budgetHalf: 0,
    optimalHalf: 196,
    clock: { freqHz: 20_000_000 },
    checks: { clockPort: 'clk', dataPort: 'd', maxGlitches: 1 },
    vectors: DFF_VECTORS,
    unlock: {
      name: 'D触发器（极限版）',
      kind: 'seq',
      stage: 2,
      ports: DFF_PORTS,
    },
    referenceSolution: dffRef('ref-s2-dff-cost'),
  }),

  parseLevel({
    schemaVersion: 1,
    id: 's2-dff-fast',
    stage: 2,
    kind: 'timing',
    title: 'D 触发器·高频挑战',
    brief:
      '本关**强制硬核工程模式**：必须在 20MHz（周期 50ns）时钟下正确工作 —— 传播延迟 + 建立时间要装得下一个时钟周期，而且输出不许有任何空翻。',
    teaching:
      '时序电路的「快」不是感觉出来的：数据路径传播延迟 + 建立时间必须小于时钟周期，' +
      '这条不等式就是硬核模式里那把尺子。',
    hint: '参考解的传播延迟链路是 d → 主锁存器 → 从锁存器 → q，约 6.5ns；把门级数压下来（例如两级都用最少的门控结构）才能腾出更多时序裕量。',
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
      name: 'D触发器（高频版）',
      kind: 'seq',
      stage: 2,
      ports: DFF_PORTS,
    },
    referenceSolution: dffRef('ref-s2-dff-fast'),
  }),
];
