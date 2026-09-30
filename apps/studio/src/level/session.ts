/**
 * 会话装载：决定「打开工作台时是关卡模式还是自由模式、在第几关、画布是什么」。
 *
 * 画布按「模式 + 关卡」分别存档，所以在关卡之间来回切换不会丢草图；
 * 组件库是全局的（GDD 铁律 2），切关卡时始终带上玩家已封装的所有模块。
 */

import { ALL_LEVELS, findLevel } from '@lc/content';
import type { Level } from '@lc/schema';
import { notGateDemo } from '../editor/demos';
import type { Doc, StoredModule } from '../editor/model';
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
