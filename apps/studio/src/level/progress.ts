/**
 * 关卡进度与玩家组件库（GDD 铁律 2：封装模块永久加入个人组件库）。
 *
 * 组件库是跨关卡资产：第 4 关封装的【与非门】在第 6 关搭异或门时直接当元件用。
 * 进度与组件库都存 localStorage，后续可以整体导出成存档 / 交给服务端校验。
 */

import { ALL_LEVELS, requiredPortsOf } from '@lc/content';
import type { Level, LogicFamily } from '@lc/schema';
import type { Doc, StoredModule, Sym } from '../editor/model';

export const PROGRESS_KEY = 'lc-studio-progress-v1';

export interface LevelRecord {
  /** 历史最好得分（0~100） */
  score: number;
  /** 历史最低成本（半单位） */
  bestCostHalf: number;
  /** 这一单赚到的钱（半单位口径：款项 − 材料费），取历史最好 */
  bestProfitHalf: number;
  /** 历史最好星级（0~3：功能 / 成本 / 时序） */
  stars: number;
  clearedAt: number;
}

/**
 * 三星目标：把「可选的硬核模式」变成玩家自己想要的追求。

/**
 * 星级（评星契约，用户定稿）：指标 = 成本 与 延迟，各自按「相对成本线/延迟线」分四档，
 * 取两者较差（两个指标都达到才有对应档的星）。
 *
 * 延迟 = 输入开始到输出稳定的时间（传播延迟，游戏里测的是关键路径那条）。
 *
 * 成本线 = 标准答案 × 2，因此：
 *  - ≤ 0.5 × 成本线（= 标准答案）        → 3 星
 *  - ≤ 0.75 × 成本线（= 1.5 × 标准答案）  → 2 星
 *  - ≤ 1 × 成本线（= 2 × 标准答案）       → 1 星
 *  - 超过成本线                          → 0 星（仍可交付，只是没星）
 * 延迟线同理（延迟线 = 参考解实测 × 2）。无时序预算的关只按成本评星（延迟视为达标）。
 */
export function starsOf(result: {
  pass: boolean;
  costHalf: number;
  budgetHalf: number;
  timingBudgetPs: number | null;
  criticalPathPs: number;
}): number {
  if (!result.pass) return 0;
  // 成本挑战关不设成本线（budgetHalf = 0）：成本档视为达标，只按传播延迟评星
  const costStars = result.budgetHalf > 0 ? ratioStars(result.costHalf, result.budgetHalf) : 3;
  const delayStars =
    result.timingBudgetPs !== null && result.timingBudgetPs > 0
      ? ratioStars(result.criticalPathPs, result.timingBudgetPs)
      : 3;
  return Math.min(costStars, delayStars);
}

/** 实际值 / 成本线 → 星级档位（成本越低越好） */
function ratioStars(actual: number, budget: number): number {
  const r = actual / budget;
  if (r <= 0.5) return 3;
  if (r <= 0.75) return 2;
  if (r <= 1) return 1;
  return 0;
}

export const MAX_STARS_PER_LEVEL = 3;

/** 评级（免费试错的压力来源）：分数 → S/A/B/C */
export type Grade = 'S' | 'A' | 'B' | 'C';

export function gradeOf(score: number): Grade {
  if (score >= 100) return 'S';
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  return 'C';
}

/** 这一单的款项（半单位）：成本挑战关没有成本线，按满分线结算 */
export function paymentOf(level: Level): number {
  return level.kind === 'cost' ? level.optimalHalf : level.budgetHalf;
}

/** 利润 = 款项 − 材料费（可为负：客户买的是「能用」，亏钱不拦你交付，但会记在账上） */
export function profitOf(level: Level, costHalf: number): number {
  return paymentOf(level) - costHalf;
}

export interface Progress {
  /** 新游戏时选定的逻辑族契约（RTL/DTL/TTL/CMOS），整个存档固定 */
  family: LogicFamily;
  /** 已通关记录（clearedAt > 0 才算真通关，失败尝试不写这里） */
  cleared: Record<string, LevelRecord>;
  /** 尝试次数（含失败），只用于展示 */
  attempts: Record<string, number>;
  library: StoredModule[];
  /** 钱包：每关最好一次的利润之和（不刷单：重挑战只抬高纪录，不重复发钱） */
  walletHalf: number;
  /** 黑盒侦察记录：关卡 id → measured（自主测绘）| skipped（看了答案） */
  recon: Record<string, ReconState>;
  /** 支线单完成记录：`关卡id:支线key` → 拿到的奖金（半单位）；也用于任务墙徽章 */
  sideJobs: Record<string, number>;
  /** 工具铺：已购买的设备 id */
  equipment: string[];
  /** 已经花掉的钱（半单位）；可用余额 = walletHalf − spentHalf */
  spentHalf: number;
  /** 已开工的关卡（点过「开工」）；用于刷新后恢复到工作台而不是重选 */
  started: Record<string, boolean>;
}

/** 钱包 = 每关最好一次的利润 + 各支线单奖金（都由存档推导，不重复发钱） */
export function walletOf(progress: Progress): number {
  const fromLevels = ALL_LEVELS.reduce(
    (sum, level) => sum + (progress.cleared[level.id]?.bestProfitHalf ?? 0),
    0,
  );
  const fromJobs = Object.values(progress.sideJobs).reduce((sum, bonus) => sum + bonus, 0);
  return fromLevels + fromJobs;
}

/** 支线单完成数 */
export function sideJobCount(progress: Progress): number {
  return Object.keys(progress.sideJobs).length;
}

export function recordSideJob(
  progress: Progress,
  levelId: string,
  key: string,
  bonusHalf: number,
): Progress {
  const id = `${levelId}:${key}`;
  const sideJobs = { ...progress.sideJobs, [id]: Math.max(progress.sideJobs[id] ?? 0, bonusHalf) };
  const next = { ...progress, sideJobs };
  return { ...next, walletHalf: walletOf(next) };
}

/** 自主测绘的关卡数（图纸全靠自己测出来的） */
export function reconCount(progress: Progress): number {
  return Object.values(progress.recon).filter((state) => state === 'measured').length;
}

export function setRecon(progress: Progress, levelId: string, state: ReconState): Progress {
  return { ...progress, recon: { ...progress.recon, [levelId]: state } };
}

/** 标记某关已开工（开工即持久化，刷新后直接回到工作台） */
export function setStarted(progress: Progress, levelId: string): Progress {
  return { ...progress, started: { ...progress.started, [levelId]: true } };
}

/** 这关是否需要弹「新委托」：没开工过、也没通关过才弹（重玩已通关的关不再接单） */
export function isNewJob(progress: Progress, levelId: string): boolean {
  return !progress.started?.[levelId] && !isCleared(progress, levelId);
}

export function emptyProgress(family: LogicFamily = 'rtl'): Progress {
  return {
    family,
    cleared: {},
    attempts: {},
    library: [],
    walletHalf: 0,
    recon: {},
    sideJobs: {},
    equipment: [],
    spentHalf: 0,
    started: {},
  };
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      family: parsed.family ?? 'rtl',
      cleared: parsed.cleared && typeof parsed.cleared === 'object' ? parsed.cleared : {},
      attempts: parsed.attempts && typeof parsed.attempts === 'object' ? parsed.attempts : {},
      library: Array.isArray(parsed.library) ? (parsed.library as StoredModule[]) : [],
      walletHalf: typeof parsed.walletHalf === 'number' ? parsed.walletHalf : 0,
      recon: (parsed.recon as Record<string, ReconState>) ?? {},
      sideJobs: (parsed.sideJobs as Record<string, number>) ?? {},
      equipment: Array.isArray(parsed.equipment) ? (parsed.equipment as string[]) : [],
      spentHalf: typeof parsed.spentHalf === 'number' ? parsed.spentHalf : 0,
      started: (parsed.started as Record<string, boolean>) ?? {},
    };
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    /* 存档失败不影响游戏 */
  }
}

/** 关卡解锁：第一关总是开放，之后要求前一关**真的通关**（失败尝试不算） */
export function isLevelUnlocked(progress: Progress, levelId: string): boolean {
  const index = ALL_LEVELS.findIndex((level) => level.id === levelId);
  if (index <= 0) return index === 0;
  const previous = ALL_LEVELS[index - 1] as Level;
  return isCleared(progress, previous.id);
}

export function isCleared(progress: Progress, levelId: string): boolean {
  return (progress.cleared[levelId]?.clearedAt ?? 0) > 0;
}

export function clearedCount(progress: Progress): number {
  return ALL_LEVELS.filter((level) => isCleared(progress, level.id)).length;
}

/** 记录一次通关：只保留历史最好成绩与最低成本 */
export function recordClear(
  progress: Progress,
  levelId: string,
  score: number,
  costHalf: number,
  stars = 1,
): Progress {
  const previous = progress.cleared[levelId];
  const level = ALL_LEVELS.find((l) => l.id === levelId);
  const profit = level ? profitOf(level, costHalf) : 0;
  const record: LevelRecord = {
    score: Math.max(previous?.score ?? 0, score),
    bestCostHalf: previous ? Math.min(previous.bestCostHalf, costHalf) : costHalf,
    bestProfitHalf: previous ? Math.max(previous.bestProfitHalf, profit) : profit,
    stars: Math.max(previous?.stars ?? 0, stars),
    clearedAt: previous?.clearedAt ?? Date.now(),
  };
  const cleared = { ...progress.cleared, [levelId]: record };
  const next = { ...progress, cleared };
  // 钱包 = 每关最好一次的利润 + 支线奖金（重挑战刷新纪录时会重算，不会重复发钱）
  return { ...next, walletHalf: walletOf(next) };
}

export function recordAttempt(progress: Progress, levelId: string): Progress {
  return {
    ...progress,
    attempts: { ...progress.attempts, [levelId]: (progress.attempts[levelId] ?? 0) + 1 },
  };
}

/**
 * 关卡初始画布：
 *  - 关卡规定端口名（a/b/y）：端口元件由系统预置并锁定；
 *  - **VCC / GND 电源轨同样预置并锁定** —— 没有电源和地，任何电路都不工作。
 * 玩家只需要在中间连出电路，端口约定与供电永远不是卡关原因。
 */
export function docForLevel(level: Level, library: StoredModule[]): Doc {
  const { inputs, outputs } = requiredPortsOf(level);
  // 端口位宽：关卡声明优先（第三章总线），缺省 1 位
  const widthOf = new Map(level.ports.map((p) => [p.name, p.width]));
  const syms: Sym[] = [
    // 电源轨：左上 VCC、右上 GND（避开中间 200 起排的信号端口）
    { id: 'rail-vcc', kind: 'vcc', x: 40, y: 60, rot: 0, label: 'VCC', locked: true },
    { id: 'rail-gnd', kind: 'gnd', x: 700, y: 60, rot: 0, label: 'GND', locked: true },
  ];
  inputs.forEach((name, i) => {
    syms.push({
      id: `in-${name}`,
      kind: 'input',
      x: 40,
      y: 200 + i * 140,
      rot: 0,
      value: 0,
      label: name,
      width: widthOf.get(name) ?? 1,
      locked: true,
    });
  });
  const outputTop = 200;
  outputs.forEach((name, i) => {
    const sym: Sym = {
      id: `out-${name}`,
      kind: 'output',
      x: 700,
      y: outputTop + i * 140,
      rot: 0,
      label: name,
      width: widthOf.get(name) ?? 1,
      locked: true,
    };
    syms.push(sym);
  });
  return {
    id: `level-${level.id}`,
    name: level.title,
    syms,
    wires: [],
    // 入门关（moduleAccess 'none'）根本用不到模块：初始画布不背全量组件库，
    // 免得一个非门关卡的存档里塞着十几二十个无关模块的模板（又大又乱）。
    library: level.moduleAccess === 'none' ? [] : library,
  };
}

export function symIsLocked(doc: Doc, id: string): boolean {
  return Boolean(doc.syms.find((s) => s.id === id)?.locked);
}

// ---- 本地重挑战榜与存档导入导出（M3-E，GDD 4.2 / 4.5 的单机版） ----

export interface LeaderboardRow {
  levelId: string;
  title: string;
  kind: Level['kind'];
  cleared: boolean;
  /** 历史最低成本（半单位）；没通关过为 null */
  bestCostHalf: number | null;
  bestScore: number;
  attempts: number;
  /** 满分线（标准解成本） */
  optimalHalf: number;
  /** 已知最省（求解器/社区结论），用于「还能更省」的追赶目标 */
  bestKnownHalf: number;
  /** 是否已经做到已知最省 */
  atBestKnown: boolean;
}

/** 称号（声望）：通关数与钱一起决定 —— 这是钱包的第一个用途（哪怕还不花钱） */
export interface Rank {
  title: string;
  /** 达到下一级还差什么（用于展示） */
  next: string | null;
}

// 阈值按「正常交付一单赚 1~7 元」的节奏标定：不要卡住正常玩家
const RANKS: Array<{ title: string; cleared: number; walletHalf: number }> = [
  { title: '学徒', cleared: 0, walletHalf: 0 },
  { title: '维修铺师傅', cleared: 3, walletHalf: 4 },
  { title: '高级技师', cleared: 6, walletHalf: 20 },
  { title: '研究所特聘', cleared: 9, walletHalf: 60 },
  { title: '总工程师', cleared: 13, walletHalf: 140 },
];

export function rankOf(progress: Progress): Rank {
  const cleared = clearedCount(progress);
  const wallet = progress.walletHalf;
  let current = RANKS[0] as { title: string; cleared: number; walletHalf: number };
  let next: { title: string; cleared: number; walletHalf: number } | null = null;
  for (const rank of RANKS) {
    if (cleared >= rank.cleared && wallet >= rank.walletHalf) current = rank;
    else if (!next) next = rank;
  }
  return {
    title: current.title,
    next: next
      ? `升到「${next.title}」还需 ${Math.max(0, next.cleared - cleared)} 单 + ${Math.max(0, (next.walletHalf - wallet) / 2)} 元`
      : null,
  };
}

/** 黑盒侦察状态：图纸是自己测出来的，还是直接看了答案 */
export type ReconState = 'measured' | 'skipped';

/** 本地重挑战榜：一关一行的历史最好成绩（通关的才知道成本） */
export function leaderboard(progress: Progress): LeaderboardRow[] {
  return ALL_LEVELS.map((level) => {
    const record = progress.cleared[level.id];
    const bestKnownHalf = level.bestKnownHalf ?? level.optimalHalf;
    const cleared = (record?.clearedAt ?? 0) > 0;
    return {
      levelId: level.id,
      title: level.title,
      kind: level.kind,
      cleared,
      bestCostHalf: cleared ? (record?.bestCostHalf ?? null) : null,
      bestScore: record?.score ?? 0,
      attempts: progress.attempts[level.id] ?? 0,
      optimalHalf: level.optimalHalf,
      bestKnownHalf,
      atBestKnown: cleared && (record?.bestCostHalf ?? Number.POSITIVE_INFINITY) <= bestKnownHalf,
    };
  });
}

/** 存档包格式：进度 + 导出时间 + 版本，便于以后迁移 */
export interface SaveFile {
  format: 'layered-circuits-save';
  schemaVersion: 1;
  exportedAt: number;
  progress: Progress;
}

export function exportSave(progress: Progress, now = Date.now()): string {
  const save: SaveFile = {
    format: 'layered-circuits-save',
    schemaVersion: 1,
    exportedAt: now,
    progress,
  };
  return JSON.stringify(save, null, 2);
}

/** 导入存档：认格式、认版本、逐个字段兜底，坏档不覆盖现有进度 */
export function importSave(text: string): { progress: Progress; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { progress: emptyProgress(), error: '存档不是合法的 JSON' };
  }
  const save = parsed as Partial<SaveFile>;
  if (save.format !== 'layered-circuits-save') {
    return { progress: emptyProgress(), error: '这不是本作的存档文件' };
  }
  if (typeof save.schemaVersion !== 'number' || save.schemaVersion > 1) {
    return {
      progress: emptyProgress(),
      error: `存档版本 ${String(save.schemaVersion)} 太新，当前版本读不了`,
    };
  }
  const raw = (save.progress ?? {}) as Partial<Progress>;
  const progress: Progress = {
    family: raw.family ?? 'rtl',
    cleared: raw.cleared && typeof raw.cleared === 'object' ? raw.cleared : {},
    attempts: raw.attempts && typeof raw.attempts === 'object' ? raw.attempts : {},
    library: Array.isArray(raw.library) ? (raw.library as StoredModule[]) : [],
    walletHalf: typeof raw.walletHalf === 'number' ? raw.walletHalf : 0,
    recon: (raw.recon as Record<string, ReconState>) ?? {},
    sideJobs: (raw.sideJobs as Record<string, number>) ?? {},
    equipment: Array.isArray(raw.equipment) ? (raw.equipment as string[]) : [],
    spentHalf: typeof raw.spentHalf === 'number' ? raw.spentHalf : 0,
    started: (raw.started as Record<string, boolean>) ?? {},
  };
  return { progress };
}
