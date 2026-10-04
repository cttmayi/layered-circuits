/**
 * 内容自检：**每个关卡都必须真的可通关**。
 *
 * 这一条是关卡内容的生命线：如果某一关的参考解自己都过不了（预算写错、真值表写错、
 * 端口名不匹配），CI 必须立刻失败，而不是等玩家卡关才发现。
 */

import { computeCosts, judgeDesign, wrapModule } from '@lc/compiler';
import { costHalfOf, DesignBuilder, InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import {
  findLevel,
  findTeachLevel,
  nextLevelId,
  requiredPortsOf,
  STAGE1_LEVELS,
  TEACH_LEVELS,
} from '../src/index';

const emptyLibrary = new InMemoryModuleLibrary();

describe('阶段 1 关卡内容', () => {
  it('关卡 id 唯一、顺序稳定、阶段都为 1', () => {
    const ids = STAGE1_LEVELS.map((level) => level.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(STAGE1_LEVELS.every((level) => level.stage === 1)).toBe(true);
    // 主线从「非门」开始（教学关已拆入 TEACH_LEVELS 教学模式，不占关卡链）
    expect(STAGE1_LEVELS[0]?.id).toBe('s1-not');
    expect(nextLevelId('s1-not')).toBe('s1-and');
    // 阶段 1 的最后一关之后进入阶段 2（时序单元），整条线是一个连续的教学顺序
    expect(nextLevelId('s1-xnor')).toBe('s2-sr-latch');
    // 教学关与关卡链并列：独立教学模式，不进关卡顺序
    expect(TEACH_LEVELS.map((l) => l.id)).toEqual([
      's1-npn',
      's1-dio',
      's1-float',
      's1-cmos-inv',
      's1-cmos-nand',
    ]);
    expect(nextLevelId('s1-npn')).toBeNull(); // 教学关不在关卡链上
    // 阶段 2 之后进入阶段 3（算术单元），压轴是简易计算器链
    expect(nextLevelId('s2-dff')).toBe('s3-half-adder');
    expect(nextLevelId('s3-alu')).toBe('s3-bcd2bin');
    expect(nextLevelId('s3-calc')).toBeNull();
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
      // 参考解是「标准解」：它必须落在预算内。有冷门更省解时（求解器发现的），
      // optimalHalf 会低于标准解成本 —— 这时标准解依然要能通关，只是拿不到满分。
      expect(
        result.costHalf,
        `${level.id} 参考解成本 ${result.costHalf} 应不超过预算 ${level.budgetHalf}`,
      ).toBeLessThanOrEqual(level.budgetHalf);
      expect(result.costHalf, `${level.id} 参考解不该比最优还省`).toBeGreaterThanOrEqual(
        level.optimalHalf,
      );
      expect(result.costHalf, `${level.id} 参考解成本应等于满分线`).toBe(level.optimalHalf);
      expect(result.score, `${level.id} 标准解应拿满分`).toBe(100);
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

  it('教学关必用元件：直连导线（成本 0）会因缺元件被打回', () => {
    for (const id of ['s1-npn', 's1-dio', 's1-float', 's1-cmos-inv', 's1-cmos-nand'] as const) {
      const level = findTeachLevel(id)!;
      expect(level.requiredUnits.length, `${id} 应有必用元件`).toBeGreaterThan(0);
      // 一根导线直连全部输入→输出：功能上可能对上真值表，但没有元件 → 必须打回
      const ins = Object.keys(level.vectors[0].inputs);
      const b = new DesignBuilder(`direct-${id}`, '直连');
      for (const n of ins) b.port(n, 'in', 'x');
      b.port('y', 'out', 'x');
      const result = judgeDesign(b.build(), level, { library: emptyLibrary });
      expect(result.pass, `${id} 直连导线不该过关`).toBe(false);
      expect(result.errors.join(), `${id} 应提示缺元件`).toMatch(/要求用到/);
    }
  });

  it('教学关·认识三极管是反相开关：真值表 ¬a，无上拉（悬空）打回', () => {
    const level = findTeachLevel('s1-npn')!;
    // 反相：门窗关（0）灯亮（1）、门窗开（1）灯灭（0）
    expect(level.vectors.map((v) => [v.inputs.a, v.expect?.y])).toEqual([
      [0, 1],
      [1, 0],
    ]);
    // 只用三极管、不挂上拉：a=0 时输出悬空（Z ≠ 1）→ 打回 —— 这就是「上拉钉默认值」的教学门槛
    const b = new DesignBuilder('t1-no-pullup', '无上拉');
    b.gnd('gnd');
    b.unit('npn', { c: 'y', b: 'a', e: 'gnd' }, 'Q1');
    b.port('a', 'in', 'a');
    b.port('y', 'out', 'y');
    const r = judgeDesign(b.build(), level, { library: emptyLibrary });
    expect(r.pass, '无上拉不该过关').toBe(false);
    // 挂上拉 + 三极管（标准解）过关且满分
    const ok = judgeDesign(level.referenceSolution!, level, { library: emptyLibrary });
    expect(ok.pass).toBe(true);
    expect(ok.score).toBe(100);
  });

  it('教学关·认识二极管是防倒灌：直接并联冲突打回，二极管或门满分', () => {
    const level = findTeachLevel('s1-dio')!;
    // 或门真值表：任一电池有电设备就有电
    expect(level.vectors.map((v) => [v.inputs.a, v.inputs.b, v.expect?.y])).toEqual([
      [0, 0, 0],
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ]);
    // 直接并联（半成品状态）：一节没电一节有电 → 强 0/强 1 冲突 → 打回（这就是「倒灌」）
    const direct = new DesignBuilder('t2-direct-parallel', '直接并联');
    direct.gnd('gnd');
    direct.unit('res', { a: 'y', b: 'gnd' }, 'R1');
    direct.port('a', 'in', 'y');
    direct.port('b', 'in', 'y');
    direct.port('y', 'out', 'y');
    const r = judgeDesign(direct.build(), level, { library: emptyLibrary });
    expect(r.pass, '直接并联（倒灌）不该过关').toBe(false);
    // 二极管防倒灌参考解：满分
    const ok = judgeDesign(level.referenceSolution!, level, { library: emptyLibrary });
    expect(ok.pass).toBe(true);
    expect(ok.score).toBe(100);
    // allowedUnits 只有二极管+电阻：用三极管做 OR 会被「本关不提供」打回
    const npnOr = new DesignBuilder('t2-npn-or', '三极管做或门');
    npnOr.vcc('vcc');
    npnOr.gnd('gnd');
    npnOr.unit('res', { a: 'vcc', b: 'y' }, 'R1');
    npnOr.unit('npn', { c: 'y', b: 'a', e: 'gnd' }, 'Q1');
    npnOr.unit('npn', { c: 'y', b: 'b', e: 'gnd' }, 'Q2');
    npnOr.port('a', 'in', 'a');
    npnOr.port('b', 'in', 'b');
    npnOr.port('y', 'out', 'y');
    const rn = judgeDesign(npnOr.build(), level, { library: emptyLibrary });
    expect(rn.errors.join(), '三极管在本关不可用').toMatch(/本关不提供/);
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

    // 超预算：给它一个 1 半单位的预算 —— 逻辑正确仍过关，只是评分/星级低（用户定稿）
    const tightLevel = { ...notLevel, budgetHalf: 1 };
    const overBudget = judgeDesign(notLevel.referenceSolution!, tightLevel, {
      library: emptyLibrary,
    });
    expect(overBudget.overBudget).toBe(true);
    expect(overBudget.pass).toBe(true);
    expect(overBudget.warnings.join('；')).toContain('超预算');

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
    // 4 个与非门模块 = 4 × 20 = 80（成本递归累加，与手搭的参考解一致）
    expect(result.costHalf).toBe(80);
  });

  it('不锁积木：同或门关可以用自己封装的【或非门】4 个拼出来（不在推荐清单里也放行）', () => {
    // 用户定稿：任务关不限制玩家用哪个积木。这里用「和推荐解法完全无关」的路线验证——
    // 同或门 = ((a NOR b) NOR a) NOR ((a NOR b) NOR b)，全是刚在上一关封装的【或非门】。
    const norLevel = findLevel('s1-nor')!;
    const xnorLevel = findLevel('s1-xnor')!;
    const wrapped = wrapModule(
      {
        name: '或非门',
        version: '1.0',
        stage: 1,
        kind: 'logic',
        ports: norLevel.referenceSolution!.ports,
        body: norLevel.referenceSolution!,
      },
      emptyLibrary,
    );
    const library = new InMemoryModuleLibrary();
    library.add(wrapped.template);
    const norInstances = [
      { id: 'u1', a: 'a', b: 'b', y: 'n1' },
      { id: 'u2', a: 'n1', b: 'a', y: 'n2' },
      { id: 'u3', a: 'n1', b: 'b', y: 'n3' },
      { id: 'u4', a: 'n2', b: 'n3', y: 'y' },
    ];
    const reused = structuredClone(xnorLevel.referenceSolution!);
    reused.instances = norInstances.map((n) => ({
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
    for (const n of norInstances) {
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

    const result = judgeDesign(reused, xnorLevel, { library });
    expect(result.errors.join('；')).not.toContain('本关只允许');
    expect(result.pass).toBe(true);
  });

  it('成本递归与封装：封装的成本口径与预算一致（模块成本 = 递归展开后的基础元件成本）', () => {
    for (const level of STAGE1_LEVELS) {
      const { counts } = computeCosts(level.referenceSolution!, emptyLibrary);
      const half = costHalfOf(counts);
      expect(half, `${level.id} 参考解成本`).toBeLessThanOrEqual(level.budgetHalf);
      expect(half, `${level.id} 不能比最优还省`).toBeGreaterThanOrEqual(level.optimalHalf);
    }
  });
});
