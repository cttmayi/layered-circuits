/**
 * CLI：把所有关卡的「声明最优 vs 求解器结论」打一张表。
 *
 * 用法：
 *   node --experimental-strip-types tools/opt-solver/src/cli.ts           # 全部关卡
 *   node --experimental-strip-types tools/opt-solver/src/cli.ts s1-xor    # 指定关卡，打印电路
 */

import { ALL_LEVELS } from '@lc/content';
import { InMemoryModuleLibrary } from '@lc/schema';
import { solveLevel } from './solver.js';

const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const levels = wanted.length > 0 ? ALL_LEVELS.filter((l) => wanted.includes(l.id)) : ALL_LEVELS;
const library = new InMemoryModuleLibrary();

const rows: string[][] = [];
for (const level of levels) {
  const report = solveLevel(level, { library });
  const best = report.best;
  const flag =
    best === null
      ? report.referencePass
        ? '—'
        : '参考解都不过！'
      : best.measuredHalf === level.optimalHalf
        ? '✓ 一致'
        : best.measuredHalf < level.optimalHalf
          ? `↓ 可以更省（${best.measuredHalf} < ${level.optimalHalf}）`
          : `↑ 声明的最优做不到（${best.measuredHalf} > ${level.optimalHalf}）`;
  rows.push([
    level.id,
    level.title,
    String(level.optimalHalf),
    best ? String(best.measuredHalf) : '—',
    best ? (best.measuredHalf / 2).toFixed(1) : '—',
    String(report.tried),
    flag,
  ]);
}

const header = ['关卡', '名称', '声明最优(半)', '求解器(半)', '显示成本', '候选数', '结论'];
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] as number)).join('  ');
console.log(line(header));
console.log(widths.map((w) => '─'.repeat(w)).join('  '));
for (const row of rows) console.log(line(row));

if (wanted.length > 0) {
  for (const level of levels) {
    const report = solveLevel(level, { library });
    if (!report.best) continue;
    console.log(
      `\n${level.id} 求解器电路（成本 ${report.best.measuredHalf} 半单位 = ${report.best.measuredHalf / 2}）`,
    );
    console.log(JSON.stringify(report.best.design, null, 2));
  }
}
