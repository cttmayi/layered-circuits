/**
 * 关卡进度与玩家组件库（GDD 铁律 2：封装模块永久加入个人组件库）。
 *
 * 组件库是跨关卡资产：第 4 关封装的【与非门】在第 6 关搭异或门时直接当元件用。
 * 进度与组件库都存 localStorage，后续可以整体导出成存档 / 交给服务端校验。
 */

import { requiredPortsOf, STAGE1_LEVELS } from '@lc/content';
import type { Level } from '@lc/schema';
import type { Doc, StoredModule, Sym } from '../editor/model';

export const PROGRESS_KEY = 'lc-studio-progress-v1';

export interface LevelRecord {
  /** 历史最好得分（0~100） */
  score: number;
  /** 历史最低成本（半单位） */
  bestCostHalf: number;
  clearedAt: number;
}

export interface Progress {
  /** 已通关记录（clearedAt > 0 才算真通关，失败尝试不写这里） */
  cleared: Record<string, LevelRecord>;
  /** 尝试次数（含失败），只用于展示 */
  attempts: Record<string, number>;
  library: StoredModule[];
}

export function emptyProgress(): Progress {
  return { cleared: {}, attempts: {}, library: [] };
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      cleared: parsed.cleared && typeof parsed.cleared === 'object' ? parsed.cleared : {},
      attempts: parsed.attempts && typeof parsed.attempts === 'object' ? parsed.attempts : {},
      library: Array.isArray(parsed.library) ? (parsed.library as StoredModule[]) : [],
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
  const index = STAGE1_LEVELS.findIndex((level) => level.id === levelId);
  if (index <= 0) return index === 0;
  const previous = STAGE1_LEVELS[index - 1] as Level;
  return isCleared(progress, previous.id);
}

export function isCleared(progress: Progress, levelId: string): boolean {
  return (progress.cleared[levelId]?.clearedAt ?? 0) > 0;
}

export function clearedCount(progress: Progress): number {
  return STAGE1_LEVELS.filter((level) => isCleared(progress, level.id)).length;
}

/** 记录一次通关：只保留历史最好成绩与最低成本 */
export function recordClear(
  progress: Progress,
  levelId: string,
  score: number,
  costHalf: number,
): Progress {
  const previous = progress.cleared[levelId];
  const record: LevelRecord = {
    score: Math.max(previous?.score ?? 0, score),
    bestCostHalf: previous ? Math.min(previous.bestCostHalf, costHalf) : costHalf,
    clearedAt: previous?.clearedAt ?? Date.now(),
  };
  return { ...progress, cleared: { ...progress.cleared, [levelId]: record } };
}

export function recordAttempt(progress: Progress, levelId: string): Progress {
  return {
    ...progress,
    attempts: { ...progress.attempts, [levelId]: (progress.attempts[levelId] ?? 0) + 1 },
  };
}

/**
 * 关卡初始画布：关卡规定端口名（a/b/y），所以端口元件由系统预置并锁定，
 * 玩家只需要在中间连出电路 —— 这样「端口约定」永远不会成为卡关原因。
 */
export function docForLevel(level: Level, library: StoredModule[]): Doc {
  const { inputs, outputs } = requiredPortsOf(level);
  const syms: Sym[] = [];
  inputs.forEach((name, i) => {
    syms.push({
      id: `in-${name}`,
      kind: 'input',
      x: 40,
      y: 200 + i * 140,
      rot: 0,
      value: 0,
      label: name,
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
      locked: true,
    };
    syms.push(sym);
  });
  return {
    id: `level-${level.id}`,
    name: level.title,
    syms,
    wires: [],
    library,
  };
}

export function symIsLocked(doc: Doc, id: string): boolean {
  return Boolean(doc.syms.find((s) => s.id === id)?.locked);
}
