import { costOf, emptyCounts, InMemoryModuleLibrary } from '@lc/schema';
import { runVectors, type TestVector } from '@lc/sim-core';
import { describe, expect, it } from 'vitest';
import { buildCostTree, computeCosts } from '../src/cost.js';
import { compileDesign } from '../src/flatten.js';
import { designToModulePorts, hashModule, verifyTemplate, wrapModule } from '../src/wrap.js';
import {
  bufferDesign,
  busTopDesign,
  danglingPinDesign,
  notGateDesign,
  srLatchDesign,
  twoBitPassDesign,
} from './helpers/designs.js';

describe('编译：Design → FlatNet', () => {
  it('非门设计编译后真值表正确（逻辑模式 + 时序模式）', () => {
    const { net, diagnostics } = compileDesign(notGateDesign(), {
      library: new InMemoryModuleLibrary(),
    });
    expect(diagnostics).toEqual([]);
    const vectors: TestVector[] = [
      { inputs: { in: 0 }, expect: { out: 1 } },
      { inputs: { in: 1 }, expect: { out: 0 } },
    ];
    expect(runVectors(net, vectors, { mode: 'logic' }).pass).toBe(true);
    expect(runVectors(net, vectors, { mode: 'timing' }).pass).toBe(true);
  });

  it('未连接的引脚产生 unconnected-pin 警告，并按悬空处理', () => {
    const { diagnostics } = compileDesign(danglingPinDesign(), {
      library: new InMemoryModuleLibrary(),
    });
    const unconnected = diagnostics.filter((d) => d.kind === 'unconnected-pin');
    expect(unconnected).toHaveLength(1);
    expect(unconnected[0]!.message).toContain('b');
  });

  it('引用不存在的模块 → unknown-module 错误', () => {
    const b = bufferDesign('deadbeef');
    const { diagnostics } = compileDesign(b, { library: new InMemoryModuleLibrary() });
    expect(diagnostics.some((d) => d.kind === 'unknown-module')).toBe(true);
  });
});

describe('成本：递归到 4 种基础元件', () => {
  it('非门 = 2 三极管 + 3 电阻，成本 7（与 GDD 2.2.2 示例一致）', () => {
    const { counts, costHalf } = computeCosts(notGateDesign(), new InMemoryModuleLibrary());
    expect(counts).toEqual({ npn: 2, res: 3, dio: 0, cap: 0 });
    expect(costHalf).toBe(14);
    expect(costOf(counts)).toBe(7);
  });

  it('模块成本在封装时固化，实例化 N 次即 N 倍（不再递归展开）', () => {
    const library = new InMemoryModuleLibrary();
    const { template: notModule } = wrapModule(
      {
        name: '非门',
        stage: 1,
        kind: 'logic',
        ports: designToModulePorts(notGateDesign()),
        body: notGateDesign(),
      },
      library,
    );
    library.add(notModule);

    const buffer = bufferDesign(notModule.hash);
    const { counts } = computeCosts(buffer, library);
    expect(counts).toEqual({ npn: 4, res: 6, dio: 0, cap: 0 });
    expect(costOf(counts)).toBe(14);

    // 再封装一层：模块套模块，成本依然是「查表 + 相加」
    const { template: bufferModule } = wrapModule(
      { name: '缓冲器', stage: 1, kind: 'logic', ports: designToModulePorts(buffer), body: buffer },
      library,
    );
    expect(bufferModule.costHalf).toBe(28);
    expect(bufferModule.costs).toEqual({ npn: 4, res: 6, dio: 0, cap: 0 });
  });

  it('溯源树能展开到基础元件并给出各分支成本', () => {
    const library = new InMemoryModuleLibrary();
    const { template } = wrapModule(
      {
        name: '非门',
        stage: 1,
        kind: 'logic',
        ports: designToModulePorts(notGateDesign()),
        body: notGateDesign(),
      },
      library,
    );
    library.add(template);
    const tree = buildCostTree(bufferDesign(template.hash), library);
    expect(tree.costHalf).toBe(28);
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0]!.kind).toBe('module');
  });
});

describe('内容寻址（Merkle 哈希）', () => {
  it('同样的电路 → 同样的哈希；改了电路 → 换哈希（= 不可逆向修改）', () => {
    const h1 = hashModule(designToModulePorts(notGateDesign()), notGateDesign());
    const h2 = hashModule(designToModulePorts(notGateDesign()), notGateDesign());
    expect(h1).toBe(h2);

    const modified = notGateDesign();
    modified.instances.push({ kind: 'unit', id: 'cap99', unit: 'cap' });
    const h3 = hashModule(designToModulePorts(modified), modified);
    expect(h3).not.toBe(h1);
  });

  it('标签与画布坐标不参与哈希（挪动元件不产生新模块）', () => {
    const a = notGateDesign();
    for (const inst of a.instances) {
      inst.label = '随便改个名字';
      inst.pos = { x: 123, y: 456 };
    }
    const h1 = hashModule(designToModulePorts(notGateDesign()), notGateDesign());
    const h2 = hashModule(designToModulePorts(a), a);
    expect(h2).toBe(h1);
    expect(
      verifyTemplate(
        wrapModule(
          { name: '非门', stage: 1, kind: 'logic', ports: designToModulePorts(a), body: a },
          new InMemoryModuleLibrary(),
        ).template,
      ),
    ).toBe(true);
  });

  it('子模块内容进入父模块哈希（Merkle 传递性）', () => {
    const other = twoBitPassDesign();
    const portsA = designToModulePorts(notGateDesign());
    const inner1 = hashModule(portsA, notGateDesign());
    const inner2 = hashModule(designToModulePorts(other), other);
    expect(inner1).not.toBe(inner2);

    const parent1 = hashModule(designToModulePorts(bufferDesign(inner1)), bufferDesign(inner1));
    const parent2 = hashModule(designToModulePorts(bufferDesign(inner2)), bufferDesign(inner2));
    expect(parent1).not.toBe(parent2);
  });
});

describe('总线（位宽 > 1）', () => {
  it('2 位端口按位展开为独立节点，各路互不干扰', () => {
    const library = new InMemoryModuleLibrary();
    const { template: pass2 } = wrapModule(
      {
        name: '两位直通',
        stage: 3,
        kind: 'logic',
        ports: designToModulePorts(twoBitPassDesign()),
        body: twoBitPassDesign(),
      },
      library,
    );
    library.add(pass2);
    expect(pass2.ports.map((p) => p.width)).toEqual([2, 2]);

    const { net, diagnostics } = compileDesign(busTopDesign(pass2.hash), { library });
    expect(diagnostics).toEqual([]);
    expect(net.ports.map((p) => p.name).sort()).toEqual(['in[0]', 'in[1]', 'out[0]', 'out[1]']);

    const result = runVectors(
      net,
      [
        { inputs: { 'in[0]': 1, 'in[1]': 0 }, expect: { 'out[0]': 1, 'out[1]': 0 } },
        { inputs: { 'in[0]': 0, 'in[1]': 1 }, expect: { 'out[0]': 0, 'out[1]': 1 } },
      ],
      { mode: 'logic' },
    );
    expect(result.pass).toBe(true);
  });
});

describe('成本模型本身', () => {
  it('diode 的 1.5 用半分整数记账，不产生浮点误差', () => {
    const counts = { ...emptyCounts(), dio: 3 };
    expect(costOf(counts)).toBe(4.5);
  });

  it('电容计入成本但不参与仿真（GDD 只把它当时钟器件）', () => {
    const b = notGateDesign();
    b.instances.push({ kind: 'unit', id: 'capX', unit: 'cap' });
    const { counts } = computeCosts(b, new InMemoryModuleLibrary());
    expect(counts.cap).toBe(1);
    expect(costOf(counts)).toBe(10); // 7 + 3
  });
});

describe('SR 锁存器编译', () => {
  it('锁存器在顶层设计里保持状态，且被判定为时序电路', () => {
    const library = new InMemoryModuleLibrary();
    const body = srLatchDesign();
    const { template } = wrapModule(
      { name: 'SR锁存器', stage: 2, kind: 'seq', ports: designToModulePorts(body), body },
      library,
    );
    expect(template.isSequential).toBe(true);
    expect(template.costs).toEqual({ npn: 4, res: 6, dio: 0, cap: 0 });
  });
});
