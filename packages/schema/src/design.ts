/**
 * 原理图 / 网表的持久化 DTO（@lc/schema）。
 *
 * 这是「作者态」数据模型：UI 编辑它、存档保存它、编译器把它编译成 sim-core 的扁平 IR。
 * 用 zod 做唯一真源，类型全部 z.infer 出来，避免类型与校验漂移。
 *
 * 关键设计：
 * - 连接关系用 Net（一条网络挂多个引脚），不用 wire 列表：UI 的导线经并查集合并成 Net。
 * - Port 声明 width（位宽），nets 数组按位排列 —— 这是 GDD 缺失但必需的总线能力（Tech-Plan 第 9 节）。
 * - 电源轨 VCC/GND 是免费端口实例（不计成本），因为 GDD 的 4 种元件里没有电源。
 */

import { z } from 'zod';
import { BASE_PINS, UNITS } from './units.js';

export const UnitSchema = z.enum(UNITS);

/** 引脚引用：实例 id + 引脚名 + 位序号（总线按位连接） */
export const PinRefSchema = z.object({
  inst: z.string().min(1),
  pin: z.string().min(1),
  bit: z.number().int().min(0).default(0),
});

export const NetSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  pins: z.array(PinRefSchema).default([]),
});

export const PosSchema = z.object({ x: z.number(), y: z.number() });

export const InstanceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('unit'),
    id: z.string().min(1),
    unit: UnitSchema,
    label: z.string().optional(),
    pos: PosSchema.optional(),
  }),
  z.object({
    kind: z.literal('module'),
    id: z.string().min(1),
    /** 被引用的模块内容哈希（Merkle） */
    module: z.string().min(1),
    label: z.string().optional(),
    pos: PosSchema.optional(),
  }),
  z.object({
    kind: z.literal('vcc'),
    id: z.string().min(1),
    label: z.string().optional(),
    pos: PosSchema.optional(),
  }),
  z.object({
    kind: z.literal('gnd'),
    id: z.string().min(1),
    label: z.string().optional(),
    pos: PosSchema.optional(),
  }),
]);

export const PortSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  dir: z.enum(['in', 'out']),
  /** 位宽；必须等于 nets.length */
  width: z.number().int().min(1).default(1),
  /** 每个位绑定的 net id */
  nets: z.array(z.string().min(1)).default([]),
});

export const DesignSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  name: z.string().default('未命名电路'),
  instances: z.array(InstanceSchema).default([]),
  nets: z.array(NetSchema).default([]),
  ports: z.array(PortSchema).default([]),
});

export type PinRef = z.infer<typeof PinRefSchema>;
export type Net = z.infer<typeof NetSchema>;
export type Instance = z.infer<typeof InstanceSchema>;
export type Port = z.infer<typeof PortSchema>;
export type Design = z.infer<typeof DesignSchema>;

export type UnitInstance = Extract<Instance, { kind: 'unit' }>;
export type ModuleInstance = Extract<Instance, { kind: 'module' }>;

export const DESIGN_SCHEMA_VERSION = 1;

export function parseDesign(input: unknown): Design {
  return DesignSchema.parse(input);
}

export function safeParseDesign(input: unknown) {
  return DesignSchema.safeParse(input);
}

/** 基础元件 / 电源轨实例的引脚名表 */
export function instancePinNames(
  instance: Instance,
  modulePorts?: readonly { name: string; width: number }[],
): string[] {
  switch (instance.kind) {
    case 'unit':
      return [...BASE_PINS[instance.unit]];
    case 'vcc':
    case 'gnd':
      return ['p'];
    case 'module':
      return (modulePorts ?? []).map((p) => p.name);
  }
}
