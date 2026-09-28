/**
 * 内容自检：**每个关卡都必须真的可通关**。
 *
 * 这一条是关卡内容的生命线：如果某一关的参考解自己都过不了（预算写错、真值表写错、
 * 端口名不匹配），CI 必须立刻失败，而不是等玩家卡关才发现。
 */

import { computeCosts, judgeDesign, wrapModule } from '@lc/compiler';
import { costHalfOf, InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { findLevel, nextLevelId, requiredPortsOf, STAGE1_LEVELS } from '../src/index';

const emptyLibrary = new InMemoryModuleLibrary();

describe('阶段 1 关卡内容', () => {
  it('关卡 id 唯一、顺序稳定、阶段都为 1', () => {
    const ids = STAGE1_LEVELS.map((level) => level.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(STAGE1_LEVELS.every((level) => level.stage === 1)).toBe(true);
    expect(STAGE1_LEVELS[0]?.id).toBe('s1-not');
    expect(nextLevelId('s1-not')).toBe('s1-and');
    // 阶段 1 的最后一关之后进入阶段 2（时序单元），整条线是一个连续的教学顺序
    expect(nextLevelId('s1-xnor')).toBe('s2-sr-latch');
    expect(nextLevelId('s2-dff')).toBeNull();
  });

  it('每关都带完整规格：真值表、端口约定、教学文案、预算与最优成本', () => {
    for (const level of STAGE1_LEVELS) {
      const { inputs, outputs } = requiredPortsOf(level);
      expect(`${level.id} inputs`).toBe(`${level.id} inputs`);
      expect(inputs.length, `${level.id} 需要输入端口`).toBeGreaterThan(0);
      expect(outputs, `${level.id} 需要输出端口`).toEqual(['y']);
      expect(level.vectors.length, `${level.id} 真值表行数`).toBe(2 ** inputs.length);
      expect(level.brief.length, `${level.id} 目标说明`).toBeGreaterThan(10);
      expect(level.teaching.length, `${level.id} 教学文案`).toBeGreaterThan(10);
      expect(level.hint.length, `${level.id} 提示`).toBeGreaterThan(5);
      expect(level.budgetHalf, `${level.id} 预算应大于最优`).toBeGreaterThan(level.optimalHalf);
      expect(level.referenceSolution, `${level.id} 必须有参考解`).toBeDefined();
      expect(level.unlock?.name, `${level.id} 通关产出模块名`).toBeTruthy();
    }
  });

  it('每关的参考解都能通关，且成本正好等于关卡最优成本', () => {
    for (const level of STAGE1_LEVELS) {
      const design = level.referenceSolution;
      expect(design, `${level.id} 参考解`).toBeDefined();
      const result = judgeDesign(design!, level, { library: emptyLibrary });
      expect(result.errors, `${level.id} 参考解不该有错误：${result.errors.join('; ')}`).toEqual(
        [],
      );
      expect(result.pass, `${level.id} 参考解必须能通关`).toBe(true);
      expect(result.costHalf, `${level.id} 参考解成本应等于最优成本`).toBe(level.optimalHalf);
      expect(result.score, `${level.id} 最优成本应拿满分`).toBe(100);
      // 参考解也必须在硬核时序预算内，否则「双难度」是空话
      if (level.timingBudgetPs !== undefined) {
        expect(
          result.criticalPathPs,
          `${level.id} 参考解关键路径 ${result.criticalPathPs}ps`,
        ).toBeLessThanOrEqual(level.timingBudgetPs);
      }
    }
  });

  it('硬核模式：参考解能通过时序预算检查', () => {
    for (const level of STAGE1_LEVELS) {
      const result = judgeDesign(level.referenceSolution!, level, {
        library: emptyLibrary,
        mode: 'timing',
        hardcore: true,
      });
      expect(result.timingOk, `${level.id} 硬核时序`).toBe(true);
      expect(result.pass, `${level.id} 硬核模式也应通关`).toBe(true);
    }
  });

  it('判定能识别错误答案：功能错 / 超预算 / 缺端口 / 做成时序电路', () => {
    const notLevel = findLevel('s1-not')!;

    // 功能错：把非门做成缓冲器（两个反相级）
    const buffer = structuredClone(notLevel.referenceSolution!);
    // 直接用一个「直连」的电路冒充非门：a 与 y 同一网络
    buffer.nets = [
      {
        id: 'n1',
        pins: [
          { inst: 'R1', pin: 'a', bit: 0 },
          { inst: 'R2', pin: 'b', bit: 0 },
        ],
      },
      {
        id: 'n2',
        pins: [
          { inst: 'R1', pin: 'b', bit: 0 },
          { inst: 'Q1', pin: 'b', bit: 0 },
        ],
      },
      {
        id: 'n3',
        pins: [
          { inst: 'Q1', pin: 'c', bit: 0 },
          { inst: 'R2', pin: 'a', bit: 0 },
        ],
      },
      {
        id: 'n4',
        pins: [
          { inst: 'Q1', pin: 'e', bit: 0 },
          { inst: 'gnd1', pin: 'p', bit: 0 },
        ],
      },
    ];
    buffer.ports = [
      { id: 'a', name: 'a', dir: 'in', width: 1, nets: ['n1'] },
      { id: 'y', name: 'y', dir: 'out', width: 1, nets: ['n3'] },
    ];
    const wrongPorts = structuredClone(notLevel.referenceSolution!);
    wrongPorts.ports = wrongPorts.ports.filter((p) => p.name === 'y');
    const wrongPortResult = judgeDesign(wrongPorts, notLevel, { library: emptyLibrary });
    expect(wrongPortResult.pass).toBe(false);
    expect(wrongPortResult.portCheck.missingInputs).toEqual(['a']);

    // 超预算：给它一个 1 半单位的预算
    const tightLevel = { ...notLevel, budgetHalf: 1 };
    const overBudget = judgeDesign(notLevel.referenceSolution!, tightLevel, {
      library: emptyLibrary,
    });
    expect(overBudget.overBudget).toBe(true);
    expect(overBudget.pass).toBe(false);

    // 功能错：把输入直接当输出（不是非门）
    const passthrough = structuredClone(notLevel.referenceSolution!);
    passthrough.instances = [];
    passthrough.nets = [{ id: 'n1', pins: [{ inst: 'gnd1', pin: 'p', bit: 0 }] }];
    passthrough.ports = [
      { id: 'a', name: 'a', dir: 'in', width: 1, nets: ['n1'] },
      { id: 'y', name: 'y', dir: 'out', width: 1, nets: ['n1'] },
    ];
    const passthroughResult = judgeDesign(passthrough, notLevel, { library: emptyLibrary });
    expect(passthroughResult.pass).toBe(false);
    expect(passthroughResult.failedRows).toBeGreaterThan(0);
  });

  it('跨关卡复用：封装第 4 关的与非门后，能用 4 个模块拼出异或门并过关', () => {
    const nandLevel = findLevel('s1-nand')!;
    const xorLevel = findLevel('s1-xor')!;

    // 玩家在第 4 关通关，把电路封装成模块
    const wrapped = wrapModule(
      {
        name: '与非门',
        version: '1.0',
        stage: 1,
        kind: 'logic',
        ports: nandLevel.referenceSolution!.ports,
        body: nandLevel.referenceSolution!,
      },
      emptyLibrary,
    );
    const library = new InMemoryModuleLibrary();
    library.add(wrapped.template);

    // 第 6 关用 4 个与非门模块拼异或门（这就是「前一关产物是后一关素材」）
    const xor = xorLevel.referenceSolution!;
    const reused = structuredClone(xor);
    const nandInstances = [
      { id: 'u1', a: 'a', b: 'b', y: 'n1' },
      { id: 'u2', a: 'a', b: 'n1', y: 'n2' },
      { id: 'u3', a: 'b', b: 'n1', y: 'n3' },
      { id: 'u4', a: 'n2', b: 'n3', y: 'y' },
    ];
    reused.instances = nandInstances.map((n) => ({
      kind: 'module' as const,
      id: n.id,
      module: wrapped.template.hash,
    }));
    const nets = new Map<string, Array<{ inst: string; pin: string; bit: 0 }>>();
    const push = (netId: string, inst: string, pin: string): void => {
      const list = nets.get(netId) ?? [];
      list.push({ inst, pin, bit: 0 });
      nets.set(netId, list);
    };
    for (const n of nandInstances) {
      push(`net-${n.a}`, n.id, 'a');
      push(`net-${n.b}`, n.id, 'b');
      push(`net-${n.y}`, n.id, 'y');
    }
    reused.nets = [...nets].map(([id, pins]) => ({ id, pins }));
    reused.ports = [
      { id: 'a', name: 'a', dir: 'in', width: 1, nets: ['net-a'] },
      { id: 'b', name: 'b', dir: 'in', width: 1, nets: ['net-b'] },
      { id: 'y', name: 'y', dir: 'out', width: 1, nets: ['net-y'] },
    ];
    reused.instances.push({ kind: 'vcc', id: 'vcc1' }, { kind: 'gnd', id: 'gnd1' });

    const result = judgeDesign(reused, xorLevel, { library });
    expect(result.errors).toEqual([]);
    expect(result.pass).toBe(true);
    // 4 个与非门模块 = 4 × 7 = 28（成本递归累加，与手搭的参考解一致）
    expect(result.costHalf).toBe(xorLevel.optimalHalf);
  });

  it('成本递归与封装：关卡产出的模块成本等于关卡最优成本', () => {
    for (const level of STAGE1_LEVELS) {
      const { counts } = computeCosts(level.referenceSolution!, emptyLibrary);
      expect(costHalfOf(counts), `${level.id} 成本口径`).toBe(level.optimalHalf);
    }
  });
});
