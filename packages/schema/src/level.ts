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

/**
 * 向量值：单 bit 端口用 0/1/X/Z；多 bit 端口（第三章总线）直接写数值（0~255），
 * 判定前按端口位宽展开成逐位 lane 键（如 a: 5 → a[0]=1, a[1]=0, a[2]=1, a[3]=0）。
 */
export const VectorValueSchema = z.union([LogicValueSchema, z.number().int().min(0).max(255)]);
export type VectorValue = z.infer<typeof VectorValueSchema>;

export const LevelVectorSchema = z.object({
  inputs: z.record(z.string(), VectorValueSchema).default({}),
  /** 期望输出；缺省则该向量只施加激励不判定 */
  expect: z.record(z.string(), VectorValueSchema).optional(),
  /** 时序模式采样前等待（ps） */
  settlePs: z.number().int().min(0).optional(),
  note: z.string().optional(),
});

/** 关卡端口规格：声明端口名、方向与位宽（第三章总线；1 位关卡可省略，缺省按 1 位） */
export const PortSpecSchema = z.object({
  name: z.string().min(1),
  dir: z.enum(['in', 'out']),
  width: z.number().int().min(1).max(8).default(1),
});
export type PortSpec = z.infer<typeof PortSpecSchema>;

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
  /** 这一关要教会玩家的东西（GDD「阶段核心教学」落到单关） */
  teaching: z.string().default(''),
  /** 卡关时的提示（玩家主动点开） */
  hint: z.string().default(''),
  /** 关卡端口规格（含位宽，第三章总线；缺省按向量推导、全部 1 位） */
  ports: z.array(PortSpecSchema).default([]),
  mode: z.enum(['logic', 'timing']).default('logic'),
  /** 硬核工程模式的额外约束：关键路径不得超过该延迟（ps）；缺省表示硬核模式也不查时序 */
  timingBudgetPs: z.number().int().positive().optional(),
  /** 可用素材（GDD 第 3 节的阶段约束） */
  allowedUnits: z.array(z.enum(UNITS)).default([...UNITS]),
  /** 模块可用性：none = 阶段 1 只能用手搭；all = 全部组件库；listed = 仅白名单 */
  moduleAccess: ModuleAccessSchema.default('none'),
  allowedModules: z.array(z.string()).default([]),
  /** 复古复用关：禁用后期优化版本（GDD 4.4） */
  bannedModules: z.array(z.string()).default([]),
  /** 预算上限（半分整数口径） */
  budgetHalf: z.number().int().min(0),
  /**
   * 满分线 / 标准解成本（半分整数口径）。
   * 约定：它等于「本关教的那套解法」的成本，必须由参考解证明可达（内容测试盯着）。
   */
  optimalHalf: z.number().int().min(0),
  /**
   * 已知最省成本（半分整数口径）：求解器或社区找到的更好解法。
   * 用途：重挑战榜的目标值、「还能更省」提示；不影响满分线（否则课上教的解法会拿不到高分）。
   */
  bestKnownHalf: z.number().int().min(0).optional(),
  clock: z.object({ freqHz: z.number().positive() }).optional(),
  /**
   * 时序检查（M2）：硬核模式下逐个执行。
   * 全部来自真仿真测量，不是数据手册里的标称值。
   */
  checks: z
    .object({
      /** 时钟端口名（建立/保持测量与空翻检查都要它） */
      clockPort: z.string().optional(),
      /** 数据端口名（建立/保持测量用） */
      dataPort: z.string().optional(),
      /** 每个向量窗口内输出允许的最大跳变次数；超出即判定竞争冒险/空翻 */
      maxGlitches: z.number().int().min(0).optional(),
      /** 建立时间预算（ps）：实测建立时间必须 ≤ 它 */
      setupBudgetPs: z.number().int().positive().optional(),
      /** 保持时间预算（ps）：实测保持时间必须 ≤ 它 */
      holdBudgetPs: z.number().int().positive().optional(),
    })
    .default({}),
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
