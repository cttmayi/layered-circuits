/**
 * 关卡规格（spec）：给制作人用的「一句话关卡」，比 Level JSON 短得多。
 *
 * 设计目标（GDD 4.x 的内容基建）：**30 分钟内产出一个能玩、能被自动校验的新关卡**。
 * 所以 spec 只要求写「功能真值表 + 元件范围」，剩下的都由工具补齐：
 *   - 由真值表生成向量（0/1 全组合；时序关卡另加手写向量）
 *   - 由求解器算出最优成本与预算
 *   - 生成参考解并**真跑一遍判定**（不过关就直接报错，避免把坏关卡塞进内容包）
 */

import { type Design, z } from '@lc/schema';

/** 真值表：key = 输入组合（'0,1'），value = 输出端口 → 0/1 */
export type TruthRow = Record<string, 0 | 1>;
export type TruthTable = Record<string, TruthRow>;

export const LevelSpecSchema = z.object({
  /** 关卡 id：建议 stage 前缀，例如 s3-mux */
  id: z.string().min(1),
  stage: z.number().int().min(1).max(6),
  title: z.string().min(1),
  brief: z.string().min(1),
  teaching: z.string().min(1),
  hint: z.string().default(''),
  kind: z.enum(['main', 'cost', 'timing', 'retro']).default('main'),
  /** 输入端口名（1~2 个走组合最优搜索；更多输入请手写向量） */
  inputs: z.array(z.string().min(1)).min(1).max(4),
  outputs: z.array(z.string().min(1)).min(1).max(2),
  /** 功能定义：key = 输入组合（按 inputs 顺序，如 '0,1'），value = 各输出端口的值 */
  truth: z.record(
    z.string(),
    z.record(z.string(), z.union([z.literal(0), z.literal(1)])),
  ) as z.ZodType<TruthTable>,
  /** 时序关卡：额外手写向量（带时钟电平），工具会与真值表向量合并 */
  extraVectors: z
    .array(
      z.object({
        inputs: z.record(z.string(), z.union([z.literal(0), z.literal(1)])),
        expect: z.record(z.string(), z.union([z.literal(0), z.literal(1)])).optional(),
        settlePs: z.number().int().positive().optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  mode: z.enum(['logic', 'timing']).default('logic'),
  allowedUnits: z
    .array(z.enum(['npn', 'res', 'dio', 'cap', 'nmos', 'pmos']))
    .default(['npn', 'res', 'dio']),
  moduleAccess: z.enum(['none', 'all', 'listed']).default('all'),
  allowedModules: z.array(z.string()).default([]),
  bannedModules: z.array(z.string()).default([]),
  /** 硬核模式的关键路径上限（ps） */
  timingBudgetPs: z.number().int().positive().optional(),
  /** 时钟频率（时序关卡） */
  freqHz: z.number().positive().optional(),
  /** 采样等待（ps）：时序关卡每个时钟电平保持多久 */
  settlePs: z.number().int().positive().optional(),
  /** 结构 / 时序检查 */
  checks: z
    .object({
      clockPort: z.string().optional(),
      dataPort: z.string().optional(),
      maxGlitches: z.number().int().min(0).optional(),
      setupBudgetPs: z.number().int().positive().optional(),
      holdBudgetPs: z.number().int().positive().optional(),
    })
    .default({}),
  /** 通关产出的模块名（默认 = title） */
  unlockName: z.string().optional(),
  unlockKind: z.enum(['logic', 'seq', 'arith', 'mem', 'cpu']).default('logic'),
  /** 参考解：手写电路（可选）。不给时由求解器生成（组合关卡） */
  reference: z.custom<Design>().optional(),
  /** 预算上浮（默认 0.2 = 20%） */
  overhead: z.number().min(0).max(2).default(0.2),
  /** 已知最省（不填则由求解器给出） */
  bestKnownHalf: z.number().int().min(0).optional(),
});

export type LevelSpec = z.infer<typeof LevelSpecSchema>;

export function parseSpec(input: unknown): LevelSpec {
  return LevelSpecSchema.parse(input);
}
