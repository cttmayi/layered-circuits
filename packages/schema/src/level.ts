/**
 * 关卡定义 —— GDD 第 3、4、6 节。
 *
 * 关卡唯一硬性条件：功能断言全通过 且 成本 ≤ 预算（GDD 2.2.3）。
 * 预算不以「拍脑袋」给出：optimalHalf 由离线最优解求解器（tools/opt-solver）产出，
 * budgetHalf = optimalHalf × 1.15~1.20（主线）/ × 1.05~1.10（挑战关），
 * 并且每个关卡都要带 referenceSolution 供 CI 校验「关卡仍然可通关」。
 */

import { z } from 'zod';
import { DesignSchema } from './design.js';
import { ModuleKindSchema, ModulePortSchema } from './module.js';
import { UNITS } from './units.js';

export const LogicValueSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal('X'),
  z.literal('Z'),
]);

export const LevelVectorSchema = z.object({
  inputs: z.record(z.string(), LogicValueSchema).default({}),
  /** 期望输出；缺省则该向量只施加激励不判定 */
  expect: z.record(z.string(), LogicValueSchema).optional(),
  /** 时序模式采样前等待（ps） */
  settlePs: z.number().int().min(0).optional(),
  note: z.string().optional(),
});

export const LevelKindSchema = z.enum(['main', 'cost', 'timing', 'retro']);
export type LevelKind = z.infer<typeof LevelKindSchema>;

export const ModuleAccessSchema = z.enum(['none', 'all', 'listed']);
export type ModuleAccess = z.infer<typeof ModuleAccessSchema>;

export const LevelSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  stage: z.number().int().min(1).max(6),
  kind: LevelKindSchema,
  title: z.string().min(1),
  brief: z.string().default(''),
  mode: z.enum(['logic', 'timing']).default('logic'),
  /** 可用素材（GDD 第 3 节的阶段约束） */
  allowedUnits: z.array(z.enum(UNITS)).default([...UNITS]),
  /** 模块可用性：none = 阶段 1 只能用手搭；all = 全部组件库；listed = 仅白名单 */
  moduleAccess: ModuleAccessSchema.default('none'),
  allowedModules: z.array(z.string()).default([]),
  /** 复古复用关：禁用后期优化版本（GDD 4.4） */
  bannedModules: z.array(z.string()).default([]),
  /** 预算上限（半分整数口径） */
  budgetHalf: z.number().int().min(0),
  /** 理论最优成本（求解器产出，半分整数口径） */
  optimalHalf: z.number().int().min(0),
  clock: z.object({ freqHz: z.number().positive() }).optional(),
  vectors: z.array(LevelVectorSchema).default([]),
  /** 通关后解锁并封装为模块的元信息 */
  unlock: z
    .object({
      name: z.string().min(1),
      kind: ModuleKindSchema,
      stage: z.number().int().min(1).max(6),
      ports: z.array(ModulePortSchema),
    })
    .optional(),
  referenceSolution: DesignSchema.optional(),
});

export type Level = z.infer<typeof LevelSchema>;
export type LevelVector = z.infer<typeof LevelVectorSchema>;

export function parseLevel(input: unknown): Level {
  return LevelSchema.parse(input);
}

/** 预算相对理论最优的上浮比例 */
export function budgetOverhead(level: Level): number {
  if (level.optimalHalf <= 0) return Number.POSITIVE_INFINITY;
  return level.budgetHalf / level.optimalHalf - 1;
}

/** 由最优成本与上浮比例生成预算（半分整数，向上取整） */
export function budgetFromOptimal(optimalHalf: number, overhead: number): number {
  return Math.ceil(optimalHalf * (1 + overhead));
}

/**
 * 通关评分（0~100）：成本越接近理论最优越高。
 * cost ≤ optimal → 100；cost ≥ budget → 0。
 */
export function scoreOf(level: Level, costHalf: number): number {
  if (costHalf <= level.optimalHalf) return 100;
  const span = level.budgetHalf - level.optimalHalf;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((100 * (level.budgetHalf - costHalf)) / span)));
}
