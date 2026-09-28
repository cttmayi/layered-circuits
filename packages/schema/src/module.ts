/**
 * 自定义封装模块（玩家产出的组件库条目）—— GDD 2.1.2 / 2.2。
 *
 * 模块身份 = 内容哈希（Merkle）：自身结构 + 所有子模块哈希。
 * 于是「禁止逆向修改」「同功能多版本」「同版本去重」「存档完整性」都是数据结构的天然性质，
 * 成本与延迟在封装那一刻算好，运行期只查表（GDD 6.2 的性能要求）。
 */

import { z } from 'zod';
import { DesignSchema } from './design.js';

export const UnitCountsSchema = z.object({
  npn: z.number().int().min(0).default(0),
  res: z.number().int().min(0).default(0),
  dio: z.number().int().min(0).default(0),
  cap: z.number().int().min(0).default(0),
});

export const ModuleKindSchema = z.enum(['logic', 'seq', 'arith', 'mem', 'cpu']);
export type ModuleKind = z.infer<typeof ModuleKindSchema>;

export const ModulePortSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  dir: z.enum(['in', 'out']),
  width: z.number().int().min(1).default(1),
});
export type ModulePort = z.infer<typeof ModulePortSchema>;

export const ModuleTemplateSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** 内容哈希（sha256 前缀），同时是组件库主键 */
  hash: z.string().min(1),
  name: z.string().min(1),
  /** 同名不同版本的区分（标准版 / 极简版 / 高稳定版） */
  version: z.string().default('1.0'),
  stage: z.number().int().min(1).max(6),
  kind: ModuleKindSchema,
  ports: z.array(ModulePortSchema),
  /** 内部电路（黑盒时隐藏，溯源时展开） */
  body: DesignSchema,
  /** 递归展开到基础元件后的构成 */
  costs: UnitCountsSchema,
  /** 成本（半分整数口径） */
  costHalf: z.number().int().min(0),
  isSequential: z.boolean().default(false),
  /** 输出端口 → 从任一输入到该端口的最长路径延迟（ps） */
  delayPs: z.record(z.string(), z.number()).default({}),
  criticalPathPs: z.number().int().min(0).default(0),
  createdAt: z.string().default(() => new Date().toISOString()),
  note: z.string().optional(),
});

export type ModuleTemplate = z.infer<typeof ModuleTemplateSchema>;

export interface ModuleLibrary {
  get(hash: string): ModuleTemplate | undefined;
  list(): ModuleTemplate[];
}

/** 内存版组件库（M0 用；后续换 IndexedDB 实现，接口不变） */
export class InMemoryModuleLibrary implements ModuleLibrary {
  private readonly modules = new Map<string, ModuleTemplate>();

  constructor(modules: readonly ModuleTemplate[] = []) {
    for (const m of modules) this.add(m);
  }

  add(template: ModuleTemplate): void {
    this.modules.set(template.hash, template);
  }

  get(hash: string): ModuleTemplate | undefined {
    return this.modules.get(hash);
  }

  list(): ModuleTemplate[] {
    return [...this.modules.values()];
  }

  get size(): number {
    return this.modules.size;
  }
}
