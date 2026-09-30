/**
 * 关卡定义 —— GDD 第 3、4、6 节。
 *
 * 关卡唯一硬性条件：功能断言全通过 且 成本 ≤ 预算（GDD 2.2.3）。
 * 预算不以「拍脑袋」给出：optimalHalf 由离线最优解求解器（tools/opt-solver）产出，
 * budgetHalf = optimalHalf × 1.15~1.20（主线）/ × 1.05~1.10（挑战关），
 * 并且每个关卡都要带 referenceSolution 供 CI 校验「关卡仍然可通关」。
 */

import { z } from 'zod';
import { type Design, DesignSchema } from './design.js';
import { FAMILY_CONTRACTS, type LogicFamily } from './family.js';
import { ModuleKindSchema, ModulePortSchema } from './module.js';
import { UNITS, type Unit } from './units.js';

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

/** 单个逻辑族契约下的差异化关卡规格（referenceSolution 之外的工艺答案）。
 *
 *  两种用法：
 *  1. **功能关**：只填 reference / optimalHalf / (bestKnownHalf | timingBudgetPs) ——
 *     该契约工艺下的标准答案与满分线（一键出答案、判定、预算都按它）。
 *  2. **教学关**（有 classroom 的关）：可额外带 title / teaching / ports / vectors /
 *     seedDoc / guideSteps / classroom / allowedUnits / requiredUnits 等整套内容覆盖 ——
 *     让玩家在选定的契约下「教什么用什么」：CMOS 契约的教学关学 MOS 而不是三极管。
 */
export const FamilyLevelRefSchema = z.object({
  /** 该契约工艺下的参考解（例：CMOS 契约 = 互补 MOS 门，TTL 契约 = 跟随器推挽输出级） */
  reference: DesignSchema,
  /** 该契约下的满分线（半分整数）＝本参考解成本（与全局 optimalHalf 同口径） */
  optimalHalf: z.number().int().min(0),
  /** 该契约下的已知最省（半分整数）；缺省 = optimalHalf */
  bestKnownHalf: z.number().int().min(0).optional(),
  /** 该契约下的硬核时序预算（ps）；缺省沿用关卡 timingBudgetPs。
   *  为什么需要：各契约速度标准不同——CMOS 与门/或门是两级门（NAND/NOR + 反相），
   *  单级预算（如 s1-and 的 2ns）是按二极管与门定的，对 CMOS 太紧。 */
  timingBudgetPs: z.number().int().positive().optional(),

  // ---- 教学关按契约的内容覆盖（以下全部可选，缺省沿用关卡原值）----
  /** 教学关按契约的标题（例：CMOS 契约下「认识三极管」→「认识 MOS · N-MOS」） */
  title: z.string().min(1).optional(),
  /** 教学关按契约的委托简介 */
  brief: z.string().optional(),
  /** 教学关按契约的授课文案 */
  teaching: z.string().optional(),
  /** 教学关按契约的卡关提示 */
  hint: z.string().optional(),
  /** 教学关按契约的端口（换功能时端口可不同；缺省沿用关卡） */
  ports: z.array(PortSpecSchema).optional(),
  /** 教学关按契约的真值表（换功能时用；缺省沿用关卡） */
  vectors: z.array(LevelVectorSchema).optional(),
  /** 教学关按契约的半成品电路 */
  seedDoc: DesignSchema.optional(),
  /** 教学关按契约的引导步骤 */
  guideSteps: z.array(z.string()).optional(),
  /** 教学关按契约的「元件课堂」概念卡 */
  classroom: z
    .object({
      title: z.string().min(1),
      analogy: z.string().min(1),
      points: z.array(z.string()).min(1),
    })
    .optional(),
  /** 教学关按契约的可用元件（教学关不加契约元件并集，直接替换——「教什么用什么」） */
  allowedUnits: z.array(z.enum(UNITS)).optional(),
  /** 教学关按契约的必用元件 */
  requiredUnits: z.array(z.enum(UNITS)).optional(),
  /** 教学关按契约的判定契约（缺省沿用关卡声明；教学关默认宽松不查强度） */
  family: z.enum(['rtl', 'dtl', 'ttl', 'cmos']).optional(),
});

export type FamilyLevelRef = z.infer<typeof FamilyLevelRefSchema>;

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
  /** 本关的逻辑族契约（RTL/DTL/TTL/CMOS）：判定按它的输出强度规范硬约束（默认 rtl = 高弱 1 合法） */
  family: z.enum(['rtl', 'dtl', 'ttl', 'cmos']).default('rtl'),
  /** 硬核工程模式的额外约束：关键路径不得超过该延迟（ps）；缺省表示硬核模式也不查时序 */
  timingBudgetPs: z.number().int().positive().optional(),
  /** 可用素材（GDD 第 3 节的阶段约束） */
  allowedUnits: z.array(z.enum(UNITS)).default([...UNITS]),
  /** 教学关必用元件：电路里必须出现这些元件，否则验收打回（防止「直连导线」钻空子） */
  requiredUnits: z.array(z.enum(UNITS)).default([]),
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
  /**
   * 按逻辑族契约的差异化参考解与成本（每个契约一份「本契约工艺下的标准答案」）。
   * 缺省（没有对应 family 条目）回退 rtl 规格：referenceSolution / optimalHalf / budgetHalf。
   * 用途：一键出答案按玩家契约给对应工艺解；判定按契约检查元件与输出强度；
   * 满分线/预算按契约（CMOS 无电阻又便宜，TTL 推挽输出更贵——各契约自己定自己的标准）。
   */
  familyRefs: z.record(z.string(), FamilyLevelRefSchema).optional(),
  /**
   * 教学关「元件课堂」：进关先弹的概念卡（生活类比 + 要点）。
   * 有 classroom 的关 = 教学关，工作台顶部还会显示 guideSteps 引导条。
   */
  classroom: z
    .object({
      /** 课堂标题，如「三极管：电的水闸」 */
      title: z.string().min(1),
      /** 生活类比一句话 */
      analogy: z.string().min(1),
      /** 要点列表（三只脚 / 方向 / 上拉下拉等） */
      points: z.array(z.string()).min(1),
    })
    .optional(),
  /** 教学关半成品电路：画布预置搭到一半，玩家补关键 1~2 处连接 */
  seedDoc: DesignSchema.optional(),
  /** 教学关引导步骤：搭到一半时顶部提示条逐条引导 */
  guideSteps: z.array(z.string()).default([]),
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

/**
 * 由最优成本与上浮比例生成预算（半分整数，向上取整）。
 * 评星契约：预算线 = 标准答案 × 2（overhead = 1.0）——玩家做到标准答案即 0.5×预算 = 3 星档。
 */
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

/** 玩家契约生效后某关的实际规格：元件集 / 参考解 / 满分线 / 预算 / 契约 */
export interface FamilyLevelSpec {
  /** 生效契约（教学关固定为关卡声明，功能关跟随玩家选择） */
  family: LogicFamily;
  /** 可用元件集 = 关卡允许 ∪ 契约元件（教学关不加契约元件，保持「教什么用什么」） */
  units: readonly Unit[];
  /** 参考解（一键出答案用） */
  reference: Design;
  optimalHalf: number;
  budgetHalf: number;
  bestKnownHalf: number;
  timingBudgetPs: number | undefined;
}

/**
 * 由「关卡 + 玩家契约」算出生效规格：
 * - 教学关（有 classroom）：契约 = 关卡声明（教什么用什么），元件/参考解/成本都不变；
 * - 功能关：玩家契约有 familyRefs 条目 → 用该契约的参考解/满分线/预算，元件集 = 关卡允许 ∪ 契约元件；
 *   否则回退 rtl 规格（关卡原样）。
 */
/**
 * 教学关按契约的「内容视图」：玩家选定契约后，教学关换成该契约的教学内容
 * （标题/文案/端口/真值表/种子图/引导/概念卡/满分线/参考解），id 不变 →
 * 进度、解锁链、存档全部兼容。非教学关或没有对应契约变体时原样返回。
 * 功能关的差异化只影响判定/一键答案（familySpecOf），显示与内容不变。
 */
export function levelViewOf(level: Level, family: LogicFamily): Level {
  const ref = level.classroom ? level.familyRefs?.[family] : undefined;
  if (!ref) return level;
  return {
    ...level,
    title: ref.title ?? level.title,
    brief: ref.brief ?? level.brief,
    teaching: ref.teaching ?? level.teaching,
    hint: ref.hint ?? level.hint,
    ...(ref.ports ? { ports: ref.ports } : {}),
    ...(ref.vectors ? { vectors: ref.vectors } : {}),
    ...(ref.seedDoc ? { seedDoc: ref.seedDoc } : {}),
    ...(ref.guideSteps ? { guideSteps: ref.guideSteps } : {}),
    ...(ref.classroom ? { classroom: ref.classroom } : {}),
    ...(ref.allowedUnits ? { allowedUnits: ref.allowedUnits } : {}),
    ...(ref.requiredUnits ? { requiredUnits: ref.requiredUnits } : {}),
    ...(ref.family ? { family: ref.family } : {}),
    ...(ref.timingBudgetPs !== undefined ? { timingBudgetPs: ref.timingBudgetPs } : {}),
    referenceSolution: ref.reference,
    optimalHalf: ref.optimalHalf,
    budgetHalf: budgetFromOptimal(ref.optimalHalf, 1.0),
  };
}

export function familySpecOf(level: Level, family: LogicFamily): FamilyLevelSpec {
  const teaching = level.classroom !== undefined;
  if (teaching) {
    const ref = level.familyRefs?.[family];
    if (ref) {
      // 教学关按契约变体：内容/元件/参考解/满分线全套换（「教什么用什么」）
      return {
        family: ref.family ?? level.family,
        units: [...(ref.allowedUnits ?? level.allowedUnits)],
        reference: ref.reference,
        optimalHalf: ref.optimalHalf,
        budgetHalf: budgetFromOptimal(ref.optimalHalf, 1.0),
        bestKnownHalf: ref.bestKnownHalf ?? ref.optimalHalf,
        timingBudgetPs: ref.timingBudgetPs ?? level.timingBudgetPs,
      };
    }
    const f = level.family;
    return {
      family: f,
      units: [...level.allowedUnits],
      reference: level.referenceSolution!,
      optimalHalf: level.optimalHalf,
      budgetHalf: level.budgetHalf,
      bestKnownHalf: level.bestKnownHalf ?? level.optimalHalf,
      timingBudgetPs: level.timingBudgetPs,
    };
  }
  const ref = level.familyRefs?.[family];
  if (ref) {
    const units = new Set<Unit>([...level.allowedUnits, ...FAMILY_CONTRACTS[family].units]);
    return {
      family,
      units: [...units],
      reference: ref.reference,
      optimalHalf: ref.optimalHalf,
      budgetHalf: budgetFromOptimal(ref.optimalHalf, 1.0),
      bestKnownHalf: ref.bestKnownHalf ?? ref.optimalHalf,
      timingBudgetPs: ref.timingBudgetPs ?? level.timingBudgetPs,
    };
  }
  return {
    family: 'rtl',
    units: [...level.allowedUnits],
    reference: level.referenceSolution!,
    optimalHalf: level.optimalHalf,
    budgetHalf: level.budgetHalf,
    bestKnownHalf: level.bestKnownHalf ?? level.optimalHalf,
    timingBudgetPs: level.timingBudgetPs,
  };
}
