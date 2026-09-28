/**
 * CLI：把一份 spec（JSON）变成「已验收的关卡源码」。
 *
 * 用法：
 *   node node_modules/.pnpm/vite-node@.../vite-node.mjs --config vitest.config.ts \
 *     tools/level-editor/src/cli.ts specs/t-flipflop.json out/t-flipflop.ts
 *
 * 用 `pnpm lc-level <spec.json> [out.ts]` 也行（见根 package.json 的脚本）。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { buildLevel } from './build.js';
import { parseSpec } from './spec.js';

const args = process.argv.slice(2).filter((arg) => arg !== '--print');
const print = process.argv.includes('--print');
const [specPath, outPath] = args;
if (!specPath) {
  console.error('用法：lc-level <spec.json> [out.ts]');
  process.exit(2);
}

const spec = parseSpec(JSON.parse(readFileSync(specPath, 'utf8')));
const { level, source, notes } = buildLevel(spec);

console.log(`关卡 ${level.id}（${level.title}）构建完成：`);
console.log(`  类型 ${level.kind} · 模式 ${level.mode} · 向量 ${level.vectors.length} 条`);
console.log(`  满分线 ${level.optimalHalf / 2} · 预算 ${level.budgetHalf / 2}`);
for (const note of notes) console.log(`  · ${note}`);

if (outPath) {
  writeFileSync(outPath, source);
  console.log(`已写出 ${outPath}（含参考解，可直接 import 进内容包）`);
}
if (print || !outPath) {
  console.log('\n---- 关卡源码 ----\n');
  console.log(source);
}
