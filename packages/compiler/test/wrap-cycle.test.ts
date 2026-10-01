/**
 * 模块循环依赖检测（GDD：模块定义不能互相引用，会无限展开）。
 *
 * 典型错误（玩家容易踩的「隐蔽循环」）：
 *   与非门 = 与门 + 非门  且  与门 = 与非门 + 非门  —— 两个定义互相引用成环。
 * 允许的用法（不同门互搭、无环）：非门 = 与非门（输入并接）；异或门 = 4×与非门。
 */
import { DesignBuilder, InMemoryModuleLibrary, type ModuleTemplate } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { designToModulePorts, findDependencyCycle, wrapModule } from '../src/wrap.js';
import { notGateDesign } from './helpers/designs.js';

/** 手工伪造模板（内容寻址哈希无法静态构造互相引用，测试里直接填 hash） */
function fakeTemplate(
  hash: string,
  name: string,
  body: ReturnType<DesignBuilder['build']>,
): ModuleTemplate {
  return {
    schemaVersion: 1,
    hash,
    name,
    version: '1.0',
    stage: 1,
    kind: 'logic',
    family: 'rtl',
    ports: body.ports,
    body,
    costs: { npn: 0, res: 0, dio: 0, cap: 0, nmos: 0, pmos: 0 },
    costHalf: 0,
    isSequential: false,
    delayPs: {},
    criticalPathPs: 0,
  } as unknown as ModuleTemplate;
}

describe('模块循环依赖检测', () => {
  it('无环的用法（不同门互搭）不误报：非门 = 与非门输入并接', () => {
    const library = new InMemoryModuleLibrary();
    const { template: notTpl } = wrapModule(
      {
        name: '非门',
        stage: 1,
        kind: 'logic',
        ports: designToModulePorts(notGateDesign()),
        body: notGateDesign(),
      },
      library,
    );
    library.add(notTpl);
    // 非门 = 与非门（两输入并接成反相器）—— 与门积木无关，纯元件无环
    expect(findDependencyCycle(notGateDesign(), library)).toBeNull();
  });

  it('与非门 ↔ 与门 互相引用成环：检出完整环路径', () => {
    const library = new InMemoryModuleLibrary();
    const { template: notTpl } = wrapModule(
      {
        name: '非门',
        stage: 1,
        kind: 'logic',
        ports: designToModulePorts(notGateDesign()),
        body: notGateDesign(),
      },
      library,
    );
    library.add(notTpl);

    // 与门 = 与非门 + 非门
    const andBody = new DesignBuilder('and', '与门');
    andBody.module('h-nand', { a: 'a', b: 'b', y: 'm' }, 'N1');
    andBody.module(notTpl.hash, { a: 'm', y: 'y' }, 'N2');
    andBody.port('a', 'in', 'a');
    andBody.port('b', 'in', 'b');
    andBody.port('y', 'out', 'y');
    library.add(fakeTemplate('h-and', '与门', andBody.build()));

    // 与非门 = 与门 + 非门（互相引用 → 环）
    const nandBody = new DesignBuilder('nand', '与非门');
    nandBody.module('h-and', { a: 'a', b: 'b', y: 'm' }, 'A1');
    nandBody.module(notTpl.hash, { a: 'm', y: 'y' }, 'N2');
    nandBody.port('a', 'in', 'a');
    nandBody.port('b', 'in', 'b');
    nandBody.port('y', 'out', 'y');
    library.add(fakeTemplate('h-nand', '与非门', nandBody.build()));

    // 顶层电路用了与非门 → 依赖链 h-nand → h-and → h-nand = 环
    const top = new DesignBuilder('top', '顶层');
    top.module('h-nand', { a: 'a', b: 'b', y: 'y' }, 'N1');
    top.port('a', 'in', 'a');
    top.port('b', 'in', 'b');
    top.port('y', 'out', 'y');
    const cycle = findDependencyCycle(top.build(), library);
    expect(cycle).not.toBeNull();
    expect(cycle?.length).toBeGreaterThanOrEqual(3);
    expect(cycle?.[0]).toBe(cycle?.[cycle.length - 1]); // 首尾相同 = 闭合
  });

  it('wrapModule 把环写成明确诊断（不再只有模糊的 depth-exceeded）', () => {
    const library = new InMemoryModuleLibrary();
    const { template: notTpl } = wrapModule(
      {
        name: '非门',
        stage: 1,
        kind: 'logic',
        ports: designToModulePorts(notGateDesign()),
        body: notGateDesign(),
      },
      library,
    );
    library.add(notTpl);
    // 与门 = 与非门 + 非门（与非门占位 hash）
    const andBody = new DesignBuilder('and', '与门');
    andBody.module('h-nand', { a: 'a', b: 'b', y: 'm' }, 'N1');
    andBody.module(notTpl.hash, { a: 'm', y: 'y' }, 'N2');
    andBody.port('a', 'in', 'a');
    andBody.port('b', 'in', 'b');
    andBody.port('y', 'out', 'y');
    library.add(fakeTemplate('h-and', '与门', andBody.build()));
    // 与非门 = 与门 + 非门
    const nandBody = new DesignBuilder('nand', '与非门');
    nandBody.module('h-and', { a: 'a', b: 'b', y: 'm' }, 'A1');
    nandBody.module(notTpl.hash, { a: 'm', y: 'y' }, 'N2');
    nandBody.port('a', 'in', 'a');
    nandBody.port('b', 'in', 'b');
    nandBody.port('y', 'out', 'y');
    library.add(fakeTemplate('h-nand', '与非门', nandBody.build()));

    // 封装一个用了与非门的电路 → diagnostics 应包含「模块循环依赖」明确报错
    const top = new DesignBuilder('top', '顶层');
    top.module('h-nand', { a: 'a', b: 'b', y: 'y' }, 'N1');
    top.port('a', 'in', 'a');
    top.port('b', 'in', 'b');
    top.port('y', 'out', 'y');
    const result = wrapModule(
      { name: '缓冲器', stage: 1, kind: 'logic', ports: top.build().ports, body: top.build() },
      library,
    );
    const cycleDiag = result.diagnostics.find((d) => d.message.includes('模块循环依赖'));
    expect(cycleDiag).toBeTruthy();
    expect(cycleDiag?.message).toContain('与非门');
    expect(cycleDiag?.severity).toBe('error');
  });
});
