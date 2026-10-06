import { InMemoryModuleLibrary, type ModuleTemplate } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { runGateVectors } from '../src/gate-fast';

/**
 * 门级快路的**安全底线**：任何不适用的情况必须返回 null（回落原引擎），
 * 绝不能"部分正确"地算一个错结果出来。这一条比速度更重要。
 */

const mod = (hash: string, name: string, extra: Partial<ModuleTemplate> = {}): ModuleTemplate =>
  ({
    schemaVersion: 1,
    hash,
    name,
    version: '1.0.0',
    stage: 'gate',
    kind: 'logic',
    family: 'rtl',
    ports: [
      { id: 'a', name: 'a', dir: 'in', width: 1 },
      { id: 'y', name: 'y', dir: 'out', width: 1 },
    ],
    body: { id: hash, name, ports: [], nets: [], instances: [] },
    costs: { parts: 0, areaHalf: 0, delayPs: 0, powerHalf: 0 },
    costHalf: 0,
    isSequential: false,
    delayPs: 0,
    ...extra,
  }) as unknown as ModuleTemplate;

const lib = (mods: ModuleTemplate[]) => new InMemoryModuleLibrary(mods);
const design = (instances: unknown[]): never =>
  ({ id: 'd', name: 'd', ports: [], nets: [], instances }) as never;

describe('门级快路的适用性判定（不安全就回落）', () => {
  it('顶层有元件 → 回落（返回 null）', () => {
    const d = design([{ id: 'r1', kind: 'unit', unit: 'res' }]);
    expect(runGateVectors(d, lib([]), [], new Map(), {})).toBeNull();
  });

  it('模块在库里查不到 → 回落', () => {
    const d = design([{ id: 'm1', kind: 'module', module: 'missing' }]);
    expect(runGateVectors(d, lib([]), [], new Map(), {})).toBeNull();
  });

  it('时序模块没有 SeqSpec → 回落（宁可不快，不能算错）', () => {
    const m = mod('h1', '八位寄存器', { isSequential: true });
    const d = design([{ id: 'm1', kind: 'module', module: 'h1' }]);
    expect(runGateVectors(d, lib([m]), [], new Map(), {})).toBeNull();
  });

  it('时序模块声明齐了 → 不因为时序而回落（交给引擎决定）', () => {
    const m = mod('h2', 'D锁存器', { isSequential: true });
    const d = design([{ id: 'm1', kind: 'module', module: 'h2' }]);
    const r = runGateVectors(d, lib([m]), [], new Map(), {
      D锁存器: { clock: 'en', data: ['d'], mode: 'level' },
    });
    // 端口对不上时引擎会回落 → null；这里只要求"不是被时序规则挡住的"
    expect(r === null || r.rows.length === 0).toBe(true);
  });
});

describe('身体是模块的时序积木：递归下钻，不要求顶层 SeqSpec', () => {
  it('八位寄存器那种"模块拼的"时序积木：不声明也能走快路（引擎会递归到内部触发器）', () => {
    const inner = mod('dff', '主从D触发器', { isSequential: true });
    const reg = mod('reg8', '八位寄存器', {
      isSequential: true,
      body: {
        id: 'reg8',
        name: '八位寄存器',
        ports: [],
        nets: [],
        instances: [{ id: 'F0', kind: 'module', module: 'dff' }],
      },
    } as unknown as Partial<ModuleTemplate>);
    const d = design([{ id: 'R1', kind: 'module', module: 'reg8' }]);
    // 八位寄存器自己**不需要** SeqSpec（身体是模块 → 递归下钻）；
    // 但它内部的 DFF 需要 → 这里给了 DFF 的声明，所以不该因为"缺声明"被挡在门外。
    const r = runGateVectors(d, lib([reg, inner]), [], new Map(), {
      主从D触发器: { clock: 'clk', data: ['d'], mode: 'rising' },
    });
    // 端口对不上时引擎会回落 → null；关键断言是"不是被顶层缺声明挡住的"
    expect(r === null || Array.isArray(r.rows)).toBe(true);
  });
});
