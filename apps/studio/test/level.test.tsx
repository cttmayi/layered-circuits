// @vitest-environment jsdom
/**
 * 关卡闭环的端到端测试：从「进入关卡」到「校验 → 通关 → 封装 → 解锁下一关」。
 *
 * 这里刻意不在画布上手工连线（那是鼠标交互），而是把「关卡初始画布 + 参考解」两条路都压住：
 *  - 画布一侧验证关卡端口是预置且锁定的、素材约束生效；
 *  - 判定一侧验证关卡数据能通过工作台自己的请求通道（Worker/主线程共用）判定通过。
 */

import { ALL_LEVELS, findLevel, TEACHING_MODULES } from '@lc/content';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { type Doc, toDesign } from '../src/editor/model';
import {
  docForLevel,
  emptyProgress,
  isCleared,
  isLevelUnlocked,
  recordAttempt,
  recordClear,
} from '../src/level/index';
import { docFor } from '../src/level/session';
import { LevelCard } from '../src/panels/LevelCard';
import { handleRequest } from '../src/sim/handle';
import { goToLevel, renderApp, startJob, teachCleared } from './helpers';

beforeEach(() => {
  localStorage.clear();
});

/** 关卡总数直接取内容包，避免每加一关就回来改测试 */
const LEVEL_TOTAL = ALL_LEVELS.length;

describe('关卡内容与进度', () => {
  it('关卡初始画布预置锁定的输入/输出端口（端口名就是判定接口）', () => {
    const notLevel = findLevel('s1-not')!;
    const doc = docForLevel(notLevel, []);
    const inputs = doc.syms.filter((s) => s.kind === 'input');
    const outputs = doc.syms.filter((s) => s.kind === 'output');
    expect(inputs.map((s) => s.label)).toEqual(['a']);
    expect(outputs.map((s) => s.label)).toEqual(['y']);
    expect([...inputs, ...outputs].every((s) => s.locked)).toBe(true);

    const xorLevel = findLevel('s1-xor')!;
    expect(
      docForLevel(xorLevel, [])
        .syms.filter((s) => s.kind === 'input')
        .map((s) => s.label),
    ).toEqual(['a', 'b']);
  });

  it('SR 锁存器：真值表带「说明」列，sn=rn=1 出现两次也能看懂哪次是保持', () => {
    const srLevel = findLevel('s2-sr-latch')!;
    render(<LevelCard level={srLevel} costHalf={0} />);
    // 任务卡正面是大白话（高中生读得懂）：先说清这是什么功能，再说规则
    const brief = document.querySelector('.level-card .task-brief')?.textContent ?? '';
    expect(brief).toContain('一个会记忆的开关');
    expect(brief).toContain('sn 和 rn 地位一样');
    expect(brief).toContain('都为 1 时 q 保持不动');
    expect(brief).toContain('都为 0 时没有正确答案');
    expect(brief).not.toContain('低有效');
    fireEvent.click(screen.getByText(/任务详情/));
    const table = document.querySelector('.task-full .truth') as HTMLTableElement;
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'sn',
      'rn',
      'q',
      'qn',
      '说明',
    ]);
    expect(
      [...table.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => td.textContent),
      ),
    ).toEqual([
      ['0', '1', '1', '0', '置位：sn 拉低 → q=1'],
      ['1', '1', '1', '0', '保持：沿用上一次的 q=1'],
      ['1', '0', '0', '1', '复位：rn 拉低 → q=0'],
      ['1', '1', '0', '1', '保持：沿用上一次的 q=0'],
    ]);
  });

  it('解锁顺序：第一关开放，之后必须前一关真的通关（失败尝试不解锁）', () => {
    let progress = emptyProgress();
    // 教学关不在关卡链上（走独立教学模式）：关卡链第一关是「非门」，总是开放
    expect(isLevelUnlocked(progress, 's1-not')).toBe(true);
    expect(isLevelUnlocked(progress, 's1-and')).toBe(false);
    // 教学关不解锁、不在链上
    expect(isLevelUnlocked(progress, 's1-npn')).toBe(false);

    // 失败尝试只累加次数，不解锁
    progress = recordAttempt(progress, 's1-not');
    expect(progress.attempts['s1-not']).toBe(1);
    expect(isCleared(progress, 's1-not')).toBe(false);
    expect(isLevelUnlocked(progress, 's1-and')).toBe(false);

    // 通关后解锁下一关，并记住最好成绩
    progress = recordClear(progress, 's1-not', 100, 6);
    expect(isCleared(progress, 's1-not')).toBe(true);
    expect(isLevelUnlocked(progress, 's1-and')).toBe(true);
    progress = recordClear(progress, 's1-not', 60, 8);
    expect(progress.cleared['s1-not']?.score).toBe(100); // 只保留最好成绩
    expect(progress.cleared['s1-not']?.bestCostHalf).toBe(6); // 保留最低成本
  });

  it('组件库跨关卡保留：切关卡时玩家的模块始终在画布上下文里', () => {
    const stored = {
      hash: 'abc123',
      name: '与非门',
      costHalf: 20,
      isSequential: false,
      ports: [
        { id: 'a', name: 'a', dir: 'in' as const, width: 1 },
        { id: 'b', name: 'b', dir: 'in' as const, width: 1 },
        { id: 'y', name: 'y', dir: 'out' as const, width: 1 },
      ],
      template: {
        schemaVersion: 1 as const,
        hash: 'abc123',
        name: '与非门',
        version: '1.0',
        stage: 1,
        kind: 'logic' as const,
        ports: [
          { id: 'a', name: 'a', dir: 'in' as const, width: 1 },
          { id: 'b', name: 'b', dir: 'in' as const, width: 1 },
          { id: 'y', name: 'y', dir: 'out' as const, width: 1 },
        ],
        counts: { npn: 2, res: 3, dio: 0, cap: 0, nmos: 0, pmos: 0 },
        costHalf: 20,
        delayPs: 2500,
        criticalPathPs: 2500,
        isSequential: false,
        body: { schemaVersion: 1 as const, id: 'x', name: 'x', instances: [], nets: [], ports: [] },
      },
    };
    const doc = docFor('level', 's1-xor', [stored]);
    expect(doc.library.map((m) => m.name)).toEqual(['与非门']);
    expect(doc.syms.filter((s) => s.kind === 'input').length).toBe(2);
  });

  it('工作台判定通道：每个关卡的参考解都能通过（含硬核时序）', () => {
    for (const level of ALL_LEVELS) {
      const ref = level.referenceSolution!;
      // 模块化参考解（如 s3-display2 = 2×七段译码器模块）引用教学积木哈希，
      // 通道库需含教学模块才能编译；纯元件参考解空库即可。
      const library = ref.instances.some((i) => i.kind === 'module') ? [...TEACHING_MODULES] : [];
      const response = handleRequest({
        id: 1,
        type: 'judge',
        design: ref,
        library,
        level,
        hardcore: true,
      });
      expect(response.error, `${level.id} 不该报错`).toBeUndefined();
      expect(response.judge?.pass, `${level.id} 参考解应在硬核模式通关`).toBe(true);
      expect(response.judge?.score, `${level.id} 最优成本拿满分`).toBe(100);
    }
    // 计算器链参考解（600+ 元件、10 输入）的时序行为探测较慢，放宽超时
  }, 30_000);

  it('判定通道能识别失败：功能不符时给出具体行数与错误说明', () => {
    const level = findLevel('s1-not')!;
    const design = structuredClone(level.referenceSolution!);
    // 把输出接到输入上（变成直通），功能必然不符
    design.nets = [{ id: 'n1', pins: [{ inst: 'gnd1', pin: 'p', bit: 0 }] }];
    design.instances = [];
    design.ports = [
      { id: 'a', name: 'a', dir: 'in', width: 1, nets: ['n1'] },
      { id: 'y', name: 'y', dir: 'out', width: 1, nets: ['n1'] },
    ];
    const response = handleRequest({
      id: 1,
      type: 'judge',
      design,
      library: [],
      level,
      hardcore: false,
    });
    expect(response.judge?.pass).toBe(false);
    expect(response.judge?.failedRows).toBeGreaterThan(0);
    expect(response.judge?.errors.join('')).toContain('功能');
  });
});

describe('关卡判定：第 1 关标准解（单管反相器，成本 6）', () => {
  const doc: Doc = {
    id: 'level-s1-not',
    name: '非门',
    library: [],
    syms: [
      { id: 'in-a', kind: 'input', x: 40, y: 240, rot: 0, value: 0, label: 'a', locked: true },
      { id: 'r1', kind: 'unit', unit: 'res', x: 280, y: 240, rot: 0, label: 'R1' },
      { id: 'q1', kind: 'unit', unit: 'npn', x: 470, y: 340, rot: 0, label: 'Q1' },
      { id: 'r2', kind: 'unit', unit: 'res', x: 690, y: 180, rot: 0, label: 'R2' },
      { id: 'vcc1', kind: 'vcc', x: 690, y: 80, rot: 0, label: 'VCC' },
      { id: 'gnd1', kind: 'gnd', x: 470, y: 460, rot: 0, label: 'GND' },
      { id: 'out-y', kind: 'output', x: 880, y: 340, rot: 0, label: 'y', locked: true },
    ],
    wires: [
      { id: 'w1', a: { inst: 'in-a', pin: 'p', bit: 0 }, b: { inst: 'r1', pin: 'a', bit: 0 } },
      { id: 'w2', a: { inst: 'r1', pin: 'b', bit: 0 }, b: { inst: 'q1', pin: 'b', bit: 0 } },
      { id: 'w3', a: { inst: 'q1', pin: 'c', bit: 0 }, b: { inst: 'out-y', pin: 'p', bit: 0 } },
      { id: 'w4', a: { inst: 'q1', pin: 'c', bit: 0 }, b: { inst: 'r2', pin: 'b', bit: 0 } },
      { id: 'w5', a: { inst: 'r2', pin: 'a', bit: 0 }, b: { inst: 'vcc1', pin: 'p', bit: 0 } },
      { id: 'w6', a: { inst: 'q1', pin: 'e', bit: 0 }, b: { inst: 'gnd1', pin: 'p', bit: 0 } },
    ],
  };

  it('能通过校验：成本正好等于最优 6，满分，硬核时序也达标', () => {
    const level = findLevel('s1-not')!;
    const design = toDesign(doc, { id: 'level-s1-not', name: '非门' });
    const response = handleRequest({
      id: 1,
      type: 'judge',
      design,
      library: [],
      level,
      hardcore: true,
    });
    expect(response.judge?.pass).toBe(true);
    expect(response.judge?.costHalf).toBe(level.optimalHalf);
    expect(response.judge?.score).toBe(100);
    expect(response.judge?.criticalPathPs).toBeLessThanOrEqual(level.timingBudgetPs ?? 0);
    expect(response.judge?.isSequential).toBe(false);
  });

  it('单管反相器的代价：输入 0 时输出是「弱 1」（上拉电阻给的），所以关卡提示推荐加一级射极跟随器', () => {
    const design = toDesign(doc, { id: 'level-s1-not', name: '非门' });
    const response = handleRequest({
      id: 2,
      type: 'simulate',
      design,
      library: [],
      mode: 'logic',
      inputs: { a: 0 },
    });
    const y = toDesign(doc).ports.find((p) => p.name === 'y');
    const netId = y?.nets[0] as string;
    const signal = response.snapshot?.netSignals.find(([id]) => id === netId)?.[1] ?? 0;
    // 编码 (strength << 2) | value：弱 1 = (1 << 2) | 1 = 5；强 1 应该是 6
    expect(signal).toBe(5);
    expect(signal).not.toBe(6);
  });
});

describe('关卡界面', () => {
  it('第 1 关：直接显示任务、真值表收进详情弹窗；锁住未开放元件；地图上只有第一关可点', async () => {
    renderApp();
    startJob('非门');

    // 关卡卡片：任务标题 + 直接需求（不做场景话术）；真值表放「任务详情」弹窗
    expect(screen.getByText(/任务 · 非门/)).toBeTruthy();
    expect(document.querySelector('.level-card .truth')).toBeNull();
    fireEvent.click(screen.getByText(/任务详情/));
    const targetTable = document.querySelector('.task-full .truth') as HTMLTableElement;
    expect(targetTable).toBeTruthy();
    const cells = [...targetTable.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    );
    expect(cells).toEqual([
      ['0', '1'], // 输入 0 → 输出 1（反相）
      ['1', '0'],
    ]);

    // 阶段 1 不开放电容：按钮被禁用并给出原因
    const capButton = screen.getByText('电容').closest('button') as HTMLButtonElement;
    expect(capButton.disabled).toBe(true);
    expect(capButton.getAttribute('title')).toContain('时钟专用');

    // 用料进度：材料费 0 / 款项 12 元（成本线 = 满分线 6 × 2）
    const budgetText = document.querySelector('.budget-text')?.textContent ?? '';
    expect(budgetText).toContain('款项');
    expect(budgetText).toContain('12');
    expect(screen.getByText(new RegExp(`已通关 0/${LEVEL_TOTAL}`))).toBeTruthy(); // 教学关不在关卡链：主线从零开始

    // 关卡地图：非门是进行中（已开工可继续），与门是锁定的灰态（不能点）
    fireEvent.click(screen.getByText('← 返回地图'));
    const notNode = screen.getByText('非门').closest('button');
    const andNode = screen.getByText('与门').closest('button');
    expect(notNode?.getAttribute('class')).toContain('working');
    expect(andNode?.getAttribute('class')).toContain('locked');
  });

  it('点「交付验收」会走判定通道并报告被打回（空电路）', async () => {
    renderApp();
    startJob('非门');
    const judgeButtons = screen.getAllByText('交付验收');
    judgeButtons[0]?.click();
    await waitFor(() => expect(screen.getByText(/客户打回了|还没验收/)).toBeTruthy(), {
      timeout: 5000,
    });
    // 空电路缺输出端口接法 → 至少给出功能或端口层面的错误
    expect(document.querySelectorAll('.diags .error').length).toBeGreaterThan(0);

    // 模式只能在主菜单切换：回地图 → 主菜单 → 自由搭建
    fireEvent.click(screen.getByText('← 返回地图'));
    fireEvent.click(screen.getByText('← 返回主菜单'));
    fireEvent.click(screen.getByText('自由搭建'));
    await waitFor(() => expect(screen.queryByText('交付验收')).toBeNull());
    // 「电容」在元件库按钮和成本表里都会出现，取按钮那个（避免跑并发时的时序差异）
    const capButton = screen
      .getAllByText('电容')
      .map((node) => node.closest('button'))
      .find((node): node is HTMLButtonElement => node !== null);
    expect(capButton?.disabled).toBe(false);
  });

  it('通关后解锁下一关：进度写入 localStorage，地图上第二关点亮', async () => {
    // 预置「第 1 关已通关」的存档，模拟玩家已经过关
    localStorage.setItem(
      'lc-studio-progress-v1',
      JSON.stringify({
        cleared: {
          ...teachCleared(),
          's1-not': { score: 100, bestCostHalf: 8, clearedAt: Date.now() },
        },
        attempts: { 's1-not': 2 },
        library: [],
      }),
    );
    render(<App />);
    // 主菜单应显示「继续上次」直达第 2 关之前的会话？没有开工记录时走地图选关
    goToLevel('与门'); // 进关即开工（不再弹「新委托」）
    await waitFor(() => expect(screen.getByText(/任务 · 与门/)).toBeTruthy(), {
      timeout: 5000,
    });
    expect(screen.getByText(new RegExp(`已通关 1/${LEVEL_TOTAL}`))).toBeTruthy(); // 只有非门在关卡链上
    // 地图：非门已通关，与门是进行中（已解锁可接）
    fireEvent.click(screen.getByText('← 返回地图'));
    const notNode = screen.getByText('非门').closest('button');
    const andNode = screen.getByText('与门').closest('button');
    expect(notNode?.getAttribute('class')).toContain('cleared');
    expect(andNode?.getAttribute('class')).toContain('working');
  });
});
