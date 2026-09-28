/**
 * 唯一底层基础元件（成本根节点）—— GDD 2.1.1。
 *
 * 成本用「半分」整数记账（diode = 1.5 → 3 半分），避免浮点误差影响关卡预算判定。
 * 延迟用皮秒整数（ps）。
 */

export const UNITS = ['npn', 'res', 'dio', 'cap'] as const;
export type Unit = (typeof UNITS)[number];

/** 固定单价（GDD 表格，展示用；内部用 UNIT_COST_HALF 记账） */
export const UNIT_COST: Record<Unit, number> = {
  npn: 2,
  res: 1,
  dio: 1.5,
  cap: 3,
};

/** 固定单价 × 2（整数记账） */
export const UNIT_COST_HALF: Record<Unit, number> = {
  npn: 4,
  res: 2,
  dio: 3,
  cap: 6,
};

/** 信号延迟（时序仿真用，ps） */
export const UNIT_DELAY_PS: Record<Unit, number> = {
  npn: 1000,
  res: 500,
  dio: 800,
  cap: 0,
};

export const UNIT_LABEL: Record<Unit, string> = {
  npn: 'NPN 三极管',
  res: '电阻',
  dio: '二极管',
  cap: '电容',
};

/** 基础元件的引脚名（模块实例的引脚名来自模块端口声明） */
export const BASE_PINS: Record<Unit, readonly string[]> = {
  npn: ['c', 'b', 'e'],
  res: ['a', 'b'],
  dio: ['a', 'k'],
  cap: ['a', 'b'],
};

export const BASE_PIN_LABEL: Record<Unit, Record<string, string>> = {
  npn: { c: '集电极', b: '基极', e: '发射极' },
  res: { a: 'A', b: 'B' },
  dio: { a: '阳极', k: '阴极' },
  cap: { a: 'A', b: 'B' },
};

/** 递归成本的载体：任意模块的底层元件构成 */
export interface UnitCounts {
  npn: number;
  res: number;
  dio: number;
  cap: number;
}

export function emptyCounts(): UnitCounts {
  return { npn: 0, res: 0, dio: 0, cap: 0 };
}

export function addCounts(a: UnitCounts, b: UnitCounts): UnitCounts {
  return { npn: a.npn + b.npn, res: a.res + b.res, dio: a.dio + b.dio, cap: a.cap + b.cap };
}

export function scaleCounts(c: UnitCounts, n: number): UnitCounts {
  return { npn: c.npn * n, res: c.res * n, dio: c.dio * n, cap: c.cap * n };
}

export function countTotal(c: UnitCounts): number {
  return c.npn + c.res + c.dio + c.cap;
}

/** 成本（半分整数）：唯一权威口径 */
export function costHalfOf(c: UnitCounts): number {
  return (
    c.npn * UNIT_COST_HALF.npn +
    c.res * UNIT_COST_HALF.res +
    c.dio * UNIT_COST_HALF.dio +
    c.cap * UNIT_COST_HALF.cap
  );
}

/** 成本（展示口径，可能是 .5） */
export function costOf(c: UnitCounts): number {
  return costHalfOf(c) / 2;
}

export function formatCost(c: UnitCounts): string {
  return costOf(c).toFixed(1).replace(/\.0$/, '');
}

export function formatCounts(c: UnitCounts): string {
  const parts = UNITS.filter((u) => c[u] > 0).map((u) => `${UNIT_LABEL[u]}×${c[u]}`);
  return parts.length > 0 ? parts.join(' + ') : '空电路';
}
