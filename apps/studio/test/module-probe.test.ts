// @vitest-environment node
/**
 * 模块自测：跑一遍组合真值表，输入变、输出不变就点名 —— 自制模块功能不对时，
 * 界面本来完全看不出来（编译合法、画布上毫无异常）。
 */
import { teachingModulesFor } from '@lc/content';
import type { ModuleTemplate } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import type { StoredModule } from '../src/editor/model';
import { handleRequest } from '../src/sim/handle';
import { probeModule } from '../src/sim/probe';

const stored: StoredModule[] = teachingModulesFor('rtl').map((m) => ({
  hash: m.hash,
  name: m.name,
  version: m.version,
  stage: m.stage,
  costHalf: m.costHalf,
  isSequential: m.isSequential,
  ports: m.ports,
  template: m,
  sources: [] as string[],
  createdAt: 0,
}));

const byName = (name: string) => stored.find((m) => m.name === name)!;
const tplOf = (name: string): ModuleTemplate => byName(name).template as ModuleTemplate;

describe('模块自测', () => {
  it('标准非门：a=0 → y=1·弱，a=1 → y=0·强（输出是活的）', () => {
    const probe = probeModule(tplOf('非门'), stored);
    expect(probe.skipped).toBeNull();
    expect(probe.stuck).toEqual([]);
    expect(probe.rows.map((r) => r.outputs.y)).toEqual(['1·弱', '0·强']);
  });

  it('与非门：四行真值表，只有 a=b=1 时为 0·强', () => {
    const probe = probeModule(tplOf('与非门'), stored);
    expect(probe.skipped).toBeNull();
    expect(probe.rows).toHaveLength(4);
    expect(probe.stuck).toEqual([]);
    const low = probe.rows.filter((r) => r.outputs.y?.startsWith('0')).map((r) => r.inputs);
    expect(low).toEqual([{ a: 1, b: 1 }]);
  });

  it('坏模块（y 那根网里什么都没有）：点名 stuck', () => {
    const badDesign = {
      schemaVersion: 1 as const,
      id: 'bad-not',
      name: '坏非门',
      instances: [{ kind: 'unit' as const, id: 'r1', unit: 'res' as const }],
      nets: [
        { id: 'n1', pins: [{ inst: 'r1', pin: 'a', bit: 0 }] },
        { id: 'n2', pins: [] },
      ],
      ports: [
        { id: 'a', name: 'a', dir: 'in' as const, width: 1, nets: ['n1'] },
        { id: 'y', name: 'y', dir: 'out' as const, width: 1, nets: ['n2'] },
      ],
    };
    const w = handleRequest({
      id: 1,
      type: 'wrap',
      design: badDesign,
      library: [],
      name: '坏非门',
      stage: 1,
    }).wrapped!;
    const bad: StoredModule = {
      hash: w.hash,
      name: w.name,
      version: (w.template as { version: string }).version,
      stage: 1,
      costHalf: w.costHalf,
      isSequential: w.isSequential,
      ports: w.ports,
      template: w.template as StoredModule['template'],
      sources: [] as string[],
      createdAt: 0,
    };
    const probe = probeModule(bad.template as never, [...stored, bad]);
    expect(probe.stuck).toContain('y');
    expect(probe.rows.map((r) => r.outputs.y)).toEqual(['Z（悬空）', 'Z（悬空）']);
  });

  it('时序模块不做组合自测（D 锁存器的输出不只取决于当前输入）', () => {
    const probe = probeModule(tplOf('D锁存器'), stored);
    expect(probe.skipped).toContain('时序模块');
    expect(probe.rows).toEqual([]);
  });

  it('输入位太多就跳过（八位寄存器 9 位输入）', () => {
    const probe = probeModule(tplOf('八位寄存器'), stored);
    expect(probe.skipped ?? '').toMatch(/时序模块|超过 4 位/);
  });
});
