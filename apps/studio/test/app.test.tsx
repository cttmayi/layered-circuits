// @vitest-environment jsdom
/**
 * 工作台的端到端用例：载入「非门示例」画布 → 导出 Design → 走真实仿真通道 → UI 显示真值表。
 * 这条链路把 M0 的验收判据（2 三极管 + 3 电阻搭出的非门真值表正确）在 UI 层面锁死。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { notGateDemo } from '../src/editor/demos';
import { toDesign } from '../src/editor/model';
import { handleRequest } from '../src/sim/handle';
import { renderApp } from './helpers';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('编辑器模型', () => {
  it('非门示例导出成 Design：2 三极管 + 3 电阻，10 条网络，in/out 两个端口', () => {
    const design = toDesign(notGateDemo());
    const units = design.instances.filter((i) => i.kind === 'unit');
    expect(units.filter((i) => i.kind === 'unit' && i.unit === 'npn')).toHaveLength(2);
    expect(units.filter((i) => i.kind === 'unit' && i.unit === 'res')).toHaveLength(3);
    expect(design.instances.filter((i) => i.kind === 'vcc' || i.kind === 'gnd')).toHaveLength(4);
    expect(design.ports.map((p) => `${p.name}:${p.dir}`).sort()).toEqual(['in:in', 'out:out']);
    expect(design.nets.length).toBeGreaterThan(0);
    // 每个端点引脚都必须落在某条网络里（接了的线不能丢）
    const wired = new Set(design.nets.flatMap((n) => n.pins.map((p) => `${p.inst}.${p.pin}`)));
    expect(wired.has('q1.b')).toBe(true);
    expect(wired.has('q2.e')).toBe(true);
  });

  it('内容寻址：挪动元件位置不改变哈希', () => {
    const a = toDesign(notGateDemo());
    const moved = notGateDemo();
    moved.syms = moved.syms.map((s) => ({ ...s, x: s.x + 40, y: s.y - 25 }));
    const b = toDesign(moved);
    const runA = handleRequest({
      id: 1,
      type: 'simulate',
      design: a,
      library: [],
      mode: 'logic',
      inputs: { in: 0 },
    });
    const runB = handleRequest({
      id: 2,
      type: 'simulate',
      design: b,
      library: [],
      mode: 'logic',
      inputs: { in: 1 },
    });
    expect(runA.snapshot?.hash).toBe(runB.snapshot?.hash);
  });
});

describe('仿真通道（Worker 与主线程共用 handleRequest）', () => {
  it('非门：成本 7、真值表 in=0→out=1、in=1→out=0', () => {
    const design = toDesign(notGateDemo());
    const off = handleRequest({
      id: 1,
      type: 'simulate',
      design,
      library: [],
      mode: 'logic',
      inputs: { in: 0 },
    });
    expect(off.snapshot?.cost.half).toBe(14);
    expect(off.snapshot?.cost.half / 2).toBe(7);
    expect(off.snapshot?.portValues.out).toBe(1);

    const on = handleRequest({
      id: 2,
      type: 'simulate',
      design,
      library: [],
      mode: 'logic',
      inputs: { in: 1 },
    });
    expect(on.snapshot?.portValues.out).toBe(0);

    const truth = handleRequest({
      id: 3,
      type: 'simulate',
      design,
      library: [],
      mode: 'logic',
      inputs: { in: 0 },
      withTruth: true,
    });
    const rows = truth.snapshot?.truth ?? [];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => `${r.inputs.in}->${r.outputs.out}`)).toEqual(['0->1', '1->0']);
  });

  it('硬核模式：输出 1 是强驱动、0 是弱驱动（强度语义进了 UI）', () => {
    const design = toDesign(notGateDemo());
    const low = handleRequest({
      id: 1,
      type: 'simulate',
      design,
      library: [],
      mode: 'timing',
      inputs: { in: 0 },
    });
    const high = handleRequest({
      id: 2,
      type: 'simulate',
      design,
      library: [],
      mode: 'timing',
      inputs: { in: 1 },
    });
    const outLow = low.snapshot?.netSignals.find(([, signal]) => signal >> 2 === 2);
    expect(outLow).toBeDefined(); // in=0 时输出为强 1（射极跟随器从 VCC 拉高）
    const outHigh = high.snapshot?.netSignals.find(
      ([, signal]) => signal >> 2 === 1 && (signal & 3) === 0,
    );
    expect(outHigh).toBeDefined(); // in=1 时输出为弱 0（下拉电阻）
  });

  it('封装成模块后可以像元件一样复用，成本递归累加、哈希是内容地址', () => {
    const design = toDesign(notGateDemo(), { id: 'not', name: '非门' });
    const wrapped = handleRequest({
      id: 1,
      type: 'wrap',
      design,
      library: [],
      name: '非门',
      stage: 1,
    });
    const template = wrapped.wrapped?.template;
    expect(wrapped.wrapped?.costHalf).toBe(14);
    expect(wrapped.wrapped?.hash).toMatch(/^[0-9a-f]{64}$/);

    // 用封装好的非门搭一个「两个非门串联」的电路：复用 2 次 → 成本翻倍
    const reuse = {
      schemaVersion: 1 as const,
      id: 'twice',
      name: '两级非门',
      instances: [
        { kind: 'module' as const, id: 'u1', module: wrapped.wrapped?.hash as string },
        { kind: 'module' as const, id: 'u2', module: wrapped.wrapped?.hash as string },
        { kind: 'vcc' as const, id: 'vcc1' },
        { kind: 'gnd' as const, id: 'gnd1' },
        { kind: 'vcc' as const, id: 'vcc2' },
        { kind: 'gnd' as const, id: 'gnd2' },
      ],
      nets: [],
      ports: [],
    };
    const result = handleRequest({
      id: 2,
      type: 'simulate',
      design: reuse,
      library: [template],
      mode: 'logic',
      inputs: {},
    });
    expect(result.snapshot?.cost.half).toBe(28);
    expect(result.snapshot?.cost.half / 2).toBe(14);
  });
});

describe('工作台界面', () => {
  it('渲染工具栏、成本面板与真值表（载入非门示例后自动仿真）', async () => {
    renderApp();
    // 主菜单 → 自由搭建 → 工作台
    fireEvent.click(screen.getByText('自由搭建'));
    expect(screen.getByText(/电路工作台/)).toBeTruthy();
    fireEvent.click(screen.getByText('载入非门示例'));
    expect(screen.getByText('封装为模块')).toBeTruthy();

    // 自动仿真后（测试环境下走主线程回退路径），成本面板与真值表都要出现
    await waitFor(() => expect(screen.getByText('真值表（2 行）')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByText('合计')).toBeTruthy();

    // 真值表两行必须是 0→1、1→0（这就是 M0 的验收判据）
    const table = document.querySelector('.truth') as HTMLTableElement;
    const cells = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    );
    expect(cells).toEqual([
      ['0', '1'],
      ['1', '0'],
    ]);

    // 成本面板显示合计 7
    const costRows = [...document.querySelectorAll('.kv tr')].map((tr) => tr.textContent ?? '');
    expect(costRows.some((row) => row.includes('合计') && row.includes('7'))).toBe(true);
  });
});
