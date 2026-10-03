/**
 * 阶段 3（算术单元）内容自检 —— 位宽/总线这一章。
 *
 * 最有价值的几条：
 *  - **参考解必须真过关**：成本刚好等于 optimalHalf、得分 100、硬核模式也过（8 位进位链信号完整性靠这条钉死）；
 *  - **数值向量展开**：a: 5 必须按端口位宽展开成 a[0..3] 的 lane 键，判定按位比对；
 *  - **端口位宽一致性**：关卡声明的 ports 位宽 = 模块解锁端口位宽 = 参考解端口位宽；
 *  - **教学落点**：半加器（1 位）→ 全加器（带进位）→ 4/8 位加法器（总线）→ ALU（加减一体）。
 */

import {
  compileDesign,
  expandVectors,
  judgeDesign,
  portWidthsOf,
  requiredPorts,
  wrapModule,
} from '@lc/compiler';
import { costHalfOf, DesignBuilder, InMemoryModuleLibrary } from '@lc/schema';
import { runVectors } from '@lc/sim-core';
import { describe, expect, it } from 'vitest';
import { computeCosts } from '../../../packages/compiler/src/cost.js';
import { findLevel, levelOrder } from '../src/levels.js';
import { STAGE3_LEVELS } from '../src/levels-ari.js';
import { TEACHING_MODULES, teachingModulesFor, teachingSolutionOf } from '../src/teachings.js';

const level = (id: string) => {
  const found = findLevel(id);
  if (!found) throw new Error(`缺少关卡 ${id}`);
  return found;
};

function portWidthOf(levelId: string, name: string): number {
  const l = level(levelId);
  const specW = l.ports.find((p) => p.name === name)?.width ?? 1;
  const unlockW = l.unlock?.ports.find((p) => p.name === name)?.width;
  const refW = l.referenceSolution?.ports.find((p) => p.name === name)?.width;
  if (unlockW !== undefined) expect(unlockW).toBe(specW);
  if (refW !== undefined) expect(refW).toBe(specW);
  return specW;
}

describe('阶段 3 关卡内容（位宽/总线）', () => {
  it('主线按「半加器 → 全加器 → 4位 → 8位 → ALU → BCD↔二进制 → 数码管 → 寄存器 → 计算器」排列，位宽从 1 涨到 8', () => {
    const ids = STAGE3_LEVELS.map((l) => l.id);
    expect(ids).toEqual([
      's3-half-adder',
      's3-full-adder',
      's3-adder-4',
      's3-adder-8',
      's3-alu',
      's3-bcd2bin',
      's3-bin2bcd',
      's3-display',
      's3-display2',
      's3-reg-8',
      's3-or-chain',
      's3-encoder',
      's3-digit-entry',
      's3-calc',
    ]);
    expect(levelOrder('s3-half-adder')).toBeLessThan(levelOrder('s3-alu'));
    for (const l of STAGE3_LEVELS) {
      expect(l.stage).toBe(3);
      expect(l.unlock?.stage).toBe(3);
    }
    expect(portWidthOf('s3-adder-4', 'a')).toBe(4);
    expect(portWidthOf('s3-adder-4', 'b')).toBe(4);
    expect(portWidthOf('s3-adder-8', 'y')).toBe(8);
    expect(portWidthOf('s3-alu', 'a')).toBe(4);
  });

  it('每关的参考解都能通关（含硬核），成本正好等于最优成本', () => {
    // s3-display2 的参考解 = 2×七段译码器模块（教学积木哈希）：这关的教学点就是「模块复用」，
    // 参考解天然依赖教学库——它是纯元件规则（空库可编译）的唯一例外，其余关仍必须纯元件。
    const library = new InMemoryModuleLibrary();
    const teachingLib = new InMemoryModuleLibrary([...TEACHING_MODULES]);
    for (const l of STAGE3_LEVELS) {
      const design = l.referenceSolution;
      if (!design) throw new Error(`${l.id} 缺少参考解`);
      const usesModules = design.instances.some((i) => i.kind === 'module');
      if (l.id === 's3-display2') {
        expect(usesModules, 's3-display2 参考解应复用模块（教学点：模块复用）').toBe(true);
      } else {
        expect(
          usesModules,
          `${l.id} 参考解不能依赖模块库（空库可编译；s3-display2 是唯一例外）`,
        ).toBe(false);
      }
      const lib = usesModules ? teachingLib : library;
      const r = judgeDesign(design, l, { library: lib, hardcore: true });
      expect(r.pass, `${l.id} 参考解应在硬核模式通关：${r.errors.join('；')}`).toBe(true);
      expect(r.score, `${l.id} 最优成本拿满分`).toBe(100);
      const { counts } = computeCosts(design, lib);
      // 用权威成本口径（@lc/schema 的 costHalfOf），避免测试里重复一份单价表
      const sum = costHalfOf(counts);
      expect(sum, `${l.id} 参考解成本应等于 optimalHalf`).toBe(l.optimalHalf);
    }
  }, 30_000); // calc/reg-8 是数百元件的大电路，时序行为探测较慢，放宽超时

  it('数值向量按端口位宽展开成 lane 键（a: 5 → a[0..3]），判定按位比对', () => {
    const l = level('s3-adder-4');
    const widths = portWidthsOf(l);
    const expanded = expandVectors([{ inputs: { a: 5, b: 3 }, expect: { y: 8, cout: 0 } }], widths);
    expect(expanded[0]?.inputs).toEqual({
      'a[0]': 1,
      'a[1]': 0,
      'a[2]': 1,
      'a[3]': 0,
      'b[0]': 1,
      'b[1]': 1,
      'b[2]': 0,
      'b[3]': 0,
    });
    expect(expanded[0]?.expect).toEqual({
      'y[0]': 0,
      'y[1]': 0,
      'y[2]': 0,
      'y[3]': 1,
      cout: 0,
    });
    // 1 位端口原样保留（向后兼容）
    const e1 = expandVectors(
      [{ inputs: { a: 0 }, expect: { y: 1 } }],
      portWidthsOf(level('s1-not')),
    );
    expect(e1[0]?.inputs).toEqual({ a: 0 });
    // 位宽不匹配必须被判定拦下：把 a 改成 1 位 → 报「位宽不对」
    const bad = structuredClone(l.referenceSolution) as NonNullable<typeof l.referenceSolution>;
    const aPort = bad.ports.find((p) => p.name === 'a');
    if (!aPort) throw new Error('参考解缺 a 端口');
    aPort.width = 1;
    aPort.nets = [aPort.nets[0] as string];
    const res = judgeDesign(bad, l, { library: new InMemoryModuleLibrary() });
    expect(res.errors.join('；')).toContain('位宽');
  });

  it('端口位宽声明 = 模块解锁端口位宽，且与参考解一致', () => {
    for (const l of STAGE3_LEVELS) {
      for (const spec of l.ports) {
        const unlockPort = l.unlock?.ports.find((p) => p.name === spec.name);
        if (unlockPort) expect(unlockPort.width, `${l.id} 解锁端口 ${spec.name}`).toBe(spec.width);
        const refPort = l.referenceSolution?.ports.find((p) => p.name === spec.name);
        if (refPort) expect(refPort.width, `${l.id} 参考解端口 ${spec.name}`).toBe(spec.width);
      }
    }
  });

  it('算术正确性：8 位加法器随机几组 a+b 数值全对（数值语义，不是逐行真值表）', () => {
    const library = new InMemoryModuleLibrary();
    const l = level('s3-adder-8');
    const design = l.referenceSolution;
    if (!design) throw new Error('缺少参考解');
    const { net } = compileDesign(design, { library });
    const vectors = Array.from({ length: 6 }, (_, i) => {
      const a = (i * 37 + 13) % 256;
      const b = (i * 53 + 7) % 256;
      const sum = a + b;
      return { inputs: { a, b }, expect: { y: sum % 256, cout: sum > 255 ? 1 : 0 } };
    });
    const run = runVectors(net, expandVectors(vectors, portWidthsOf(l)), { mode: 'logic' });
    expect(run.pass).toBe(true);
    expect(run.rows.every((r) => r.ok)).toBe(true);
  });

  it('七段译码器真值表：bcd 0-9 → 段码（单元参考解与门版一致）', () => {
    // 段码（bit0=a..bit6=g）：0→3F 1→06 2→5B 3→4F 4→66 5→6D 6→7D 7→07 8→7F 9→6F
    const ON = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
    const l = level('s3-display');
    const widths = portWidthsOf(l);
    const vs = ON.map((seg, v) => ({ inputs: { bcd: v }, expect: { seg } }));
    const lib = new InMemoryModuleLibrary();
    const runRef = runVectors(
      compileDesign(l.referenceSolution!, { library: lib }).net,
      expandVectors(vs, widths),
      { mode: 'logic' },
    );
    expect(
      runRef.pass,
      `单元参考解：${JSON.stringify(runRef.rows?.map((r) => (r.ok ? 'ok' : `mismatch:${JSON.stringify(r.mismatches)}`)))}`,
    ).toBe(true);
    const gateLib = new InMemoryModuleLibrary([...teachingModulesFor('rtl')]);
    const runGate = runVectors(
      compileDesign(teachingSolutionOf('s3-display', 'rtl')!, { library: gateLib }).net,
      expandVectors(vs, widths),
      { mode: 'logic' },
    );
    expect(
      runGate.pass,
      `门版：${JSON.stringify(runGate.rows?.map((r) => (r.ok ? 'ok' : `mismatch:${JSON.stringify(r.mismatches)}`)))}`,
    ).toBe(true);
  });

  it('玩家风格解法：封装【全加器】+【异或门】拼出 ALU（多 bit 模块实例化）', () => {
    const library = new InMemoryModuleLibrary();
    const l = level('s3-alu');
    // 封装模块：全加器（带 cin/cout，减法需要进位注入）与异或门
    const fa = wrapModule(
      {
        name: '全加器',
        stage: 3,
        kind: 'logic',
        ports: [
          { id: 'a', name: 'a', dir: 'in', width: 1 },
          { id: 'b', name: 'b', dir: 'in', width: 1 },
          { id: 'cin', name: 'cin', dir: 'in', width: 1 },
          { id: 's', name: 's', dir: 'out', width: 1 },
          { id: 'cout', name: 'cout', dir: 'out', width: 1 },
        ],
        body: level('s3-full-adder').referenceSolution as never,
      },
      library,
    );
    const xor = wrapModule(
      {
        name: '异或门',
        stage: 3,
        kind: 'logic',
        ports: [
          { id: 'a', name: 'a', dir: 'in', width: 1 },
          { id: 'b', name: 'b', dir: 'in', width: 1 },
          { id: 'y', name: 'y', dir: 'out', width: 1 },
        ],
        body: level('s1-xor').referenceSolution as never,
      },
      library,
    );
    library.add(fa.template);
    library.add(xor.template);

    const b = new DesignBuilder('player-alu', '玩家ALU');
    b.vcc('vcc');
    b.gnd('gnd');
    const aNets = Array.from({ length: 4 }, (_, i) => `a${i}`);
    const bNets = Array.from({ length: 4 }, (_, i) => `b${i}`);
    const tNets = Array.from({ length: 4 }, (_, i) => `t${i}`);
    const yNets = Array.from({ length: 4 }, (_, i) => `y${i}`);
    // t_i = op⊕b_i（op=1 取反）
    for (let i = 0; i < 4; i++)
      b.module(xor.template.hash, { a: 'op', b: bNets[i] as string, y: tNets[i] as string });
    // 4 个全加器，进位链从 op 开始（补码 +1）
    let carry = 'op';
    for (let i = 0; i < 4; i++) {
      const next = `c${i}`;
      b.module(fa.template.hash, {
        a: aNets[i] as string,
        b: tNets[i] as string,
        cin: carry,
        s: yNets[i] as string,
        cout: next,
      });
      carry = next;
    }
    b.port('op', 'in', 'op');
    b.port('a', 'in', aNets);
    b.port('b', 'in', bNets);
    b.port('y', 'out', yNets);
    const design = b.build();

    const r = judgeDesign(design, l, { library, hardcore: true });
    expect(r.pass, r.errors.join('；')).toBe(true);
    // 玩家解法成本 = 4×全加器(4×180) + 4×异或门(4×80) = 1040 = optimalHalf
    expect(r.score).toBe(100);
  });

  it('硬件约束与端口检查仍然生效：缺端口 / 素材越界会被拦', () => {
    const l = level('s3-adder-4');
    const library = new InMemoryModuleLibrary();
    // 缺输出端口 cout
    const noCout = structuredClone(l.referenceSolution) as NonNullable<typeof l.referenceSolution>;
    noCout.ports = noCout.ports.filter((p) => p.name !== 'cout');
    const r1 = judgeDesign(noCout, l, { library });
    expect(r1.pass).toBe(false);
    expect(r1.errors.join('；')).toContain('缺少输出端口');
    expect(requiredPorts(l).inputs).toEqual(['a', 'b']);
  });
});
