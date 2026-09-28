/**
 * DesignBuilder：用接近「画电路」的方式手写 Design，供关卡、参考解、测试使用。
 *
 *   const b = new DesignBuilder('not-gate', '非门');
 *   b.vcc('vcc'); b.gnd('gnd');
 *   b.unit('res', { a: 'vcc', b: 'out' });
 *   b.unit('npn', { c: 'out', b: 'base', e: 'gnd' });
 *   b.unit('res', { a: 'in', b: 'base' });
 *   b.port('in', 'in', 'IN'); b.port('out', 'out', 'OUT');
 *   const design = b.build();
 *
 * netKey（字符串）就是网络 id：同一个 key 出现在多个引脚上 = 电气相连。
 * 引脚值可以是字符串（宽度 1）或字符串数组（总线按位连接，第 i 位 → nets[i]）。
 */

import type { z } from 'zod';
import type { Design, Instance, PinRef, Port } from './design.js';
import type { Unit } from './units.js';

export const DESIGN_SCHEMA_VERSION_OUT = 1;

type Nets = string | readonly string[];

export class DesignBuilder {
  private readonly instances: Instance[] = [];
  private readonly netPins = new Map<string, PinRef[]>();
  private readonly ports: Port[] = [];
  private readonly counters = new Map<string, number>();

  constructor(
    private readonly id: string,
    private readonly name: string = id,
  ) {}

  private nextId(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}${n}`;
  }

  private connect(inst: string, pins: Record<string, Nets>): void {
    for (const [pin, value] of Object.entries(pins)) {
      if (value === undefined) continue;
      const list = typeof value === 'string' ? [value] : [...value];
      for (let bit = 0; bit < list.length; bit++) {
        const key = list[bit] as string;
        let bucket = this.netPins.get(key);
        if (!bucket) {
          bucket = [];
          this.netPins.set(key, bucket);
        }
        bucket.push({ inst, pin, bit });
      }
    }
  }

  unit(unit: Unit, pins: Record<string, Nets>, label?: string): string {
    const id = this.nextId(unit);
    this.instances.push(label ? { kind: 'unit', id, unit, label } : { kind: 'unit', id, unit });
    this.connect(id, pins);
    return id;
  }

  module(moduleHash: string, pins: Record<string, Nets>, label?: string): string {
    const id = this.nextId('mod');
    this.instances.push(
      label
        ? { kind: 'module', id, module: moduleHash, label }
        : { kind: 'module', id, module: moduleHash },
    );
    this.connect(id, pins);
    return id;
  }

  vcc(netKey: string): string {
    const id = this.nextId('vcc');
    this.instances.push({ kind: 'vcc', id });
    this.connect(id, { p: netKey });
    return id;
  }

  gnd(netKey: string): string {
    const id = this.nextId('gnd');
    this.instances.push({ kind: 'gnd', id });
    this.connect(id, { p: netKey });
    return id;
  }

  port(name: string, dir: 'in' | 'out', nets: Nets): void {
    const list = typeof nets === 'string' ? [nets] : [...nets];
    this.ports.push({ id: name, name, dir, width: list.length, nets: list });
  }

  netKeys(): string[] {
    const keys = new Set<string>(this.netPins.keys());
    for (const port of this.ports) for (const n of port.nets) keys.add(n);
    return [...keys];
  }

  build(): Design {
    const nets = this.netKeys().map((key) => ({ id: key, pins: this.netPins.get(key) ?? [] }));
    return {
      schemaVersion: 1,
      id: this.id,
      name: this.name,
      instances: [...this.instances],
      nets,
      ports: [...this.ports],
    };
  }
}

/** 便捷校验：Zod 解析一遍，确保手写的 Design 合法 */
export function validateDesign(design: Design, schema: z.ZodType<Design>): void {
  schema.parse(design);
}
