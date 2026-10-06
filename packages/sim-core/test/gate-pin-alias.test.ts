import { describe, expect, it } from 'vitest';
import { evalGateNetlist, type GateLibrary, type GateModuleInfo } from '../src/gate-netlist';

/**
 * **同一引脚接多条网名**（s3-calc 门级/元件级差异 58/67 的根因之一）。
 *
 * 门版参考解里一个引脚同时挂多条网名是常态（八位寄存器的 `q0..q7` 同时挂在顶层
 * `acc0..acc7` 上、数字输入寄存器的 `q0..q7` 挂在 `er0..er7` 上…）。
 * 元件级编译（flatten）会把同一引脚上的各条网名**并成同一个节点**——电气上就是一根线；
 * 门级如果只认一条（Map.set 后写覆盖前写），别的网名就永远没有驱动、读出来恒 0，
 * 于是门级读数与元件级整片相反。
 *
 * 这里手搭最小用例：A 门的输出脚 y 同时接 `mid` 与 `out` 两条网，A 输出 1；
 * `mid` 必须也读到 1（修之前它是 0 —— 被 `out` 顶掉了）。
 */
const notGate = (): GateModuleInfo => ({
  name: '非门',
  ports: [
    { name: 'a', dir: 'in' },
    { name: 'y', dir: 'out' },
  ],
  body: { instances: [], nets: [], ports: [] },
});

const lib = (mods: Record<string, GateModuleInfo>): GateLibrary => ({ get: (h) => mods[h] });

describe('门级引擎：同一引脚接多条网名（网名别名）', () => {
  it('一个输出脚挂两条网：两条都要拿到同一个驱动', () => {
    const design = {
      id: 'pin-alias',
      name: '引脚别名',
      schemaVersion: 1,
      instances: [{ id: 'A', kind: 'module', module: 'not1' }],
      nets: [
        { id: 'in', pins: [{ inst: 'A', pin: 'a' }] },
        { id: 'mid', pins: [{ inst: 'A', pin: 'y' }] },
        { id: 'out', pins: [{ inst: 'A', pin: 'y' }] },
      ],
      ports: [
        { id: 'a', name: 'a', dir: 'in', width: 1, nets: ['in'] },
        { id: 'out', name: 'out', dir: 'out', width: 1, nets: ['out'] },
        { id: 'mid', name: 'mid', dir: 'out', width: 1, nets: ['mid'] },
      ],
    };
    // a=0 → 非门输出 1：out 与 mid 都必须读到 1
    const r = evalGateNetlist(design as never, lib({ not1: notGate() }), new Map([['a', [0]]]));
    expect(r.ok).toBe(true);
    expect(r.outPorts.get('out')).toEqual([1]);
    expect(r.outPorts.get('mid')).toEqual([1]);
    expect(r.nets.get('out')).toBe(1);
    expect(r.nets.get('mid')).toBe(1);

    // a=1 → 输出 0：两条网也都必须是 0（这一半在修之前"恰好"是对的，
    // 因为被顶掉的那条 net 默认就是 0 —— 所以只测 1 的那半才抓得住 bug）
    const r0 = evalGateNetlist(design as never, lib({ not1: notGate() }), new Map([['a', [1]]]));
    expect(r0.outPorts.get('out')).toEqual([0]);
    expect(r0.outPorts.get('mid')).toEqual([0]);

    // 输入侧同理：一个输入脚挂两条网名时，读值取两条的合并（同值同值）
    const inAlias = {
      ...design,
      instances: [{ id: 'B', kind: 'module', module: 'not1' }],
      nets: [
        { id: 'w1', pins: [{ inst: 'B', pin: 'a' }] },
        { id: 'w2', pins: [{ inst: 'B', pin: 'a' }] },
        { id: 'out2', pins: [{ inst: 'B', pin: 'y' }] },
      ],
      ports: [{ id: 'out2', name: 'out2', dir: 'out', width: 1, nets: ['out2'] }],
    };
    const rIn = evalGateNetlist(inAlias as never, lib({ not1: notGate() }), new Map());
    expect(rIn.ok).toBe(true);
    // 两个网名都没驱动 → 按 0 处理 → 非门输出 1（不会因为"只认一条"而读出 X/0）
    expect(rIn.outPorts.get('out2')).toEqual([1]);
  });
});
