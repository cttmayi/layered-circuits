import { describe, expect, it } from 'vitest';
import { GATE_SEQ_SPECS, seqSpecOf } from '../src/gate-seq-specs';

/**
 * 时序器件声明：端口名必须是**实测**的（D 锁存器 d/en/q/qn、主从 D 触发器 d/clk/q/qn），
 * 语义必须是"电平型 / 上升沿型"，qn 必须是反相输出。
 */
describe('时序器件声明（SeqSpec）', () => {
  it('D 锁存器：en 是电平型时钟，d 写 q，qn 是反相输出', () => {
    const s = seqSpecOf('D锁存器');
    expect(s).toBeDefined();
    expect(s?.clock).toBe('en');
    expect(s?.mode).toBe('level');
    expect(s?.map?.d).toEqual(['q', '!qn']);
  });

  it('主从 D 触发器：clk 是上升沿，d 写 q，qn 是反相输出', () => {
    const s = seqSpecOf('主从D触发器');
    expect(s?.clock).toBe('clk');
    expect(s?.mode).toBe('rising');
    expect(s?.map?.d).toEqual(['q', '!qn']);
  });

  it('没实测到端口的积木不声明（回落原引擎，不猜）', () => {
    expect(seqSpecOf('八位寄存器')).toBeUndefined();
    expect(seqSpecOf('数字输入寄存器')).toBeUndefined();
    expect(Object.keys(GATE_SEQ_SPECS)).toEqual(['D锁存器', '主从D触发器']);
  });
});
