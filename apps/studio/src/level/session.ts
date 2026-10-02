/**
 * 会话装载：决定「打开工作台时是关卡模式还是自由模式、在第几关、画布是什么」。
 *
 * 画布按「模式 + 关卡」分别存档，所以在关卡之间来回切换不会丢草图；
 * 组件库是全局的（GDD 铁律 2），切关卡时始终带上玩家已封装的所有模块。
 */

import { ALL_LEVELS, findLevel, teachingModulesFor } from '@lc/content';
import type { Level } from '@lc/schema';
import { notGateDemo, teachingSeedDoc } from '../editor/demos';
import type { Doc, StoredModule, Sym } from '../editor/model';
import { docForLevel, isLevelUnlocked, loadProgress, type Progress } from './progress';

export type GameMode = 'level' | 'free';

export const FREE_STORAGE_KEY = 'lc-studio-doc-v1';

export function storageKeyFor(mode: GameMode, levelId: string): string {
  return mode === 'free' ? FREE_STORAGE_KEY : `lc-studio-level-${levelId}-v1`;
}

/** 默认进入「已解锁且还没通关」的第一关；全通了就停在最后一关优化成绩 */
export function defaultLevelId(progress: Progress): string {
  const pending = ALL_LEVELS.find(
    (level) => isLevelUnlocked(progress, level.id) && !progress.cleared[level.id]?.clearedAt,
  );
  if (pending) return pending.id;
  return (ALL_LEVELS[ALL_LEVELS.length - 1] as Level).id;
}

export function readStoredDoc(key: string): Doc | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Doc;
    if (parsed && Array.isArray(parsed.syms) && Array.isArray(parsed.wires)) return parsed;
  } catch {
    /* 损坏的存档直接忽略 */
  }
  return null;
}

/**
 * 读档时把「存档引用了、但注入库（玩家自有 progress.library 或空库）里没有」的
 * 教学模板补进 library。
 *
 * 背景：一键出答案（调试）会把教学模板（非门/与非门…，hash 按工艺族内容哈希）
 * 直接搭进画布；存档按设计只存画布不背库（见 App 存档注释），读档时用玩家的
 * 组件库重新注入 —— 玩家自有库没有这些教学 hash，于是模块在 pinOffsets 里查不到
 * 模板返回空 → 模块引脚消失、导线（pinWorld 定位失败）也跟着消失，只剩空盒。
 * 这里按需补上被引用的教学模板（跨工艺族按 hash 匹配），不背全量库。
 */
function resolveMissingModules(doc: Doc, library: readonly StoredModule[]): StoredModule[] {
  const needed = doc.syms
    .filter((s): s is Sym & { module: string } => s.kind === 'module' && Boolean(s.module))
    .map((s) => s.module);
  if (needed.length === 0) return [...library];
  const byHash = new Set(library.map((m) => m.hash));
  const missing = [...new Set(needed)].filter((h) => !byHash.has(h));
  if (missing.length === 0) return [...library];
  const teach = new Map<string, StoredModule>();
  for (const family of ['rtl', 'ttl', 'cmos'] as const) {
    for (const t of teachingModulesFor(family)) {
      if (teach.has(t.hash)) continue;
      teach.set(t.hash, {
        hash: t.hash,
        name: t.name,
        version: t.version,
        stage: t.stage,
        costHalf: t.costHalf,
        isSequential: t.isSequential,
        ports: t.ports,
        template: t,
        sources: [],
        createdAt: 0,
      });
    }
  }
  const extra = missing.map((h) => teach.get(h)).filter((m): m is StoredModule => Boolean(m));
  return extra.length === 0 ? [...library] : [...library, ...extra];
}

/** 取某一关/自由模式的画布：优先玩家自己的存档，否则关卡初始画布 */
export function docFor(mode: GameMode, levelId: string, library: StoredModule[]): Doc {
  const stored = readStoredDoc(storageKeyFor(mode, levelId));
  if (mode === 'free') {
    return stored ? { ...stored, library } : { ...notGateDemo(), library };
  }
  const level = findLevel(levelId);
  if (!level) return { ...notGateDemo(), library };
  if (stored?.syms.some((sym) => sym.kind === 'input' || sym.kind === 'output')) {
    // 入门关（moduleAccess 'none'）用不到任何模块：即使玩家画过这关、即使存档里
    // 有全量组件库，读档恢复时也不背（否则一个非门关卡会带着十几个无关模块）。
    return {
      ...stored,
      library: resolveMissingModules(stored, level.moduleAccess === 'none' ? [] : library),
      name: level.title,
    };
  }
  // 教学关半成品：无存档时画布预置搭到一半的电路（玩家补关键连接），
  // 而不是一张空白画布 —— 这就是「教学感」的核心：讲解后跟着模仿。
  // 画布布局用手写的教学 Doc（输入左、输出右、元件居中，一眼看到差哪步），
  // 判定仍靠 levels 的 seedDoc（Design）：玩家补完关键连接后就是参考解。
  if (level.seedDoc) {
    return {
      ...teachingSeedDoc(level.id),
      library: level.moduleAccess === 'none' ? [] : library,
      name: level.title,
    };
  }
  return docForLevel(level, library);
}

export interface Session {
  mode: GameMode;
  levelId: string;
  progress: Progress;
  doc: Doc;
}

export function initialSession(): Session {
  const progress = loadProgress();
  const levelId = defaultLevelId(progress);
  return {
    mode: 'level',
    levelId,
    progress,
    doc: docFor('level', levelId, progress.library),
  };
}

/** 当前关卡对象（自由模式为 null） */
export function levelOf(mode: GameMode, levelId: string): Level | null {
  if (mode === 'free') return null;
  return findLevel(levelId) ?? null;
}

export function unlockedLevelIds(progress: Progress): string[] {
  return ALL_LEVELS.filter((level) => isLevelUnlocked(progress, level.id)).map((level) => level.id);
}
