/**
 * 关卡期望值生成器 / 校验器（**唯一出口**）
 *
 * 用法（仓库根目录）：
 *   pnpm exec vite-node --config vitest.config.ts tools/level-expect/generate-expect.ts <关卡id> [--write] [--mode=timing|logic]
 *   例：pnpm exec vite-node --config vitest.config.ts tools/level-expect/generate-expect.ts s3-calc --write
 *
 * 背景（为什么必须有这个脚本）：
 *   门级引擎是**第二套仿真器**：7 个基础门当原子、无强弱、时序器件用「状态 + 时钟沿」。
 *   它的读数在 logic / timing 两种判定口径下**完全一样**（`runGateVectors` 根本不接 mode），
 *   且与元件级引擎的**时序口径**逐行相同 —— 也就是"真实电路稳定后"该有的语义。
 *   元件级引擎的 logic 口径是**无延迟定点求解**：交叉耦合回路会收敛到与 timing 不同的不动点
 *   （s3-calc 实测：元件级 logic=0x3f / 元件级 timing=0x6f，**定点不唯一**），因此它不能作为
 *   期望值的来源。
 *
 *   结论：**关卡期望值一律按门级口径生成**。改关卡（改电路 / 改向量 / 改答案）之后必须用本
 *   脚本再生一遍 —— 手改 `expect` 会和引擎口径脱钩，下一轮就没人说得清谁对。
 *
 * 口径与边界：
 *   · 只用**门级引擎**（gateSeqSpecs）跑 teachingSolutionOf 参考解；判定口径固定为 **logic**
 *     —— 这是本脚本**唯一有效的口径**，理由见下面的「假绿坑」。
 *   · **只写 `expect`**：输入、note、顺序、条数、settlePs 一律不动。
 *   · 原本没有 `expect` 的向量（"松开"行）**保持不检查**，不凭空补期望值；
 *     `expect` 里没列的端口也保持不检查。
 *   · 默认只校验并报告差异；`--write` 才改写关卡源文件里的 expect 字面量。
 *
 * ⚠️ 假绿坑（本脚本直接拒绝踩）：
 *   judge 里门级快路**只在 `mode === 'logic'` 时才会被执行**（见 judge.ts 的分派）；
 *   若传 `mode:'timing'`，judge 会**静默回落到元件级引擎**。于是
 *   `--mode=timing` 会得到"元件级跑了一遍"的读数，却看起来像"门级结论"——
 *   实测同一关：门级 pass=false 且逐行 58/67 有差异，而 timing 口径下 0 差异"完全一致"。
 *   一次这样的假绿会让人得出"门级已经能算这一关了"的错误结论。
 *   所以：本脚本**不接受** `--mode=timing`（直接报错退出），要复核就复核逻辑口径。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gateFastSupportReason, judgeDesign } from '@lc/compiler';
import { ALL_LEVELS, GATE_SEQ_SPECS, teachingModulesFor, teachingSolutionOf } from '@lc/content';
import { familySpecOf, InMemoryModuleLibrary } from '@lc/schema';

const args = process.argv.slice(2);
const write = args.includes('--write');
const levelId = args.find((a) => !a.startsWith('--'));
if (!levelId) {
  console.error('用法：… generate-expect.ts <关卡id> [--write]');
  process.exit(2);
}

const level = ALL_LEVELS.find((l) => l.id === levelId);
if (!level) {
  console.error(`找不到关卡 ${levelId}`);
  process.exit(2);
}
const design = teachingSolutionOf(levelId, 'rtl');
if (!design) {
  console.error(`关卡 ${levelId} 没有门版参考解（teachingSolutionOf 返回空）—— 期望值无从生成`);
  process.exit(2);
}

const ports = level.ports as { name: string; dir: string; width?: number }[];

const modeArg = args.find((a) => a.startsWith('--mode='))?.slice('--mode='.length);
// ⚠️ 只认 logic：timing 口径下 judge 不会走门级快路（静默回落元件级）→ 假绿。见文件头。
if (modeArg !== undefined && modeArg !== 'logic') {
  console.error(
    `拒绝 --mode=${modeArg}：门级快路只在 mode='logic' 下执行，timing 口径会**静默回落元件级**，\n` +
      '拿到的不是门级读数（实测同一关 timing 0 差异"完全一致" vs 门级真实 58/67 有差异）。\n' +
      '要门级期望值就用 `pnpm lc-expect <关卡id>`（默认 logic），不要覆盖口径。',
  );
  process.exit(2);
}
const mode = 'logic' as const;
const spec = familySpecOf(level, 'rtl');
const library = new InMemoryModuleLibrary([...teachingModulesFor('rtl')]);
// 门级引擎吃不下这份设计（含元件 / 缺 SeqSpec / 库缺模块）→ 报错，别拿元件级读数冒充门级
const unsupported = gateFastSupportReason(design, library, GATE_SEQ_SPECS);
if (unsupported !== null) {
  console.error(
    `关卡 ${levelId} 的门级快路不适用：${unsupported}\n门级期望值无从生成，本脚本只用于门级口径。`,
  );
  process.exit(2);
}
const result = judgeDesign(design, level, {
  library,
  mode,
  family: spec.family,
  units: spec.units,
  timingBudgetPs: spec.timingBudgetPs,
  optimalHalf: spec.optimalHalf,
  budgetHalf: spec.budgetHalf,
  gateSeqSpecs: GATE_SEQ_SPECS, // ← 只要门级：不给元件级
}) as unknown as { pass?: boolean; rows?: { index: number; actual: Record<string, unknown> }[] };

const rows = result.rows ?? [];
console.log(
  `关卡 ${levelId}：口径 mode=${mode}（门级引擎），${rows.length} 个向量，参考解 pass=${String(result.pass)}`,
);
if (rows.length !== level.vectors.length) {
  console.error(
    `向量条数不一致：判定跑了 ${rows.length} 行，关卡声明 ${level.vectors.length} 个 —— 先修这个`,
  );
  process.exit(2);
}

type Expected = Record<string, number | undefined>;
/** 把某一行的实际读数按端口打包成数值（位宽 1 = 单值；位宽 n = 按位拼数值） */
const pack = (lane: Record<string, unknown>, port: string, width: number): number | undefined => {
  if (width === 1) {
    const v = lane[port];
    return v === undefined ? undefined : Number(v);
  }
  let x = 0;
  for (let b = 0; b < width; b++) {
    const v = lane[`${port}[${b}]`];
    if (v === undefined) return undefined;
    if (String(v) === '1') x |= 1 << b;
  }
  return x;
};

const outPorts = ports.filter((p) => p.dir === 'out');
/** 依次算出"该有的 expect"（只覆盖原来 expect 里出现过的端口） */
const wanted: Expected[] = level.vectors.map((raw, i) => {
  const vec = raw as { expect?: Expected };
  const next: Expected = {};
  if (vec.expect === undefined) return next;
  const row = rows[i];
  if (!row) throw new Error(`向量 #${i} 没有对应的判定行`);
  for (const port of outPorts) {
    if (!(port.name in vec.expect)) continue;
    const val = pack(row.actual, port.name, port.width ?? 1);
    if (val !== undefined) next[port.name] = val;
  }
  return next;
});

/** 与当前 expect 比对 */
const diffs: { i: number; note: string; before: Expected; after: Expected }[] = [];
for (let i = 0; i < level.vectors.length; i++) {
  const vec = level.vectors[i] as { expect?: Expected; note?: string };
  const before = vec.expect ?? {};
  const after = wanted[i] as Expected;
  if (JSON.stringify(before) !== JSON.stringify(after))
    diffs.push({ i, note: vec.note ?? '', before, after });
}

if (diffs.length === 0) {
  console.log('✅ 现有关卡期望值与门级口径**逐向量一致**（没有要改的）');
  process.exit(0);
}

console.log(`\n⚠️ 有 ${diffs.length} 个向量的期望值与门级口径不一致：`);
for (const d of diffs) {
  console.log(`  #${d.i} ${d.note}`);
  console.log(`     关卡现值 ${JSON.stringify(d.before)}`);
  console.log(`     门级实读 ${JSON.stringify(d.after)}`);
}

if (!write) {
  console.log('\n（只校验：加 --write 才会改写关卡源文件）');
  process.exit(1);
}

// ── --write：把关卡源文件里对应向量的 expect 字面量换掉 ──
const src = levelSourceOf(levelId);
const text = readFileSync(src, 'utf8');
let out = text;
let missed = 0;
for (const d of diffs) {
  const before = JSON.stringify(d.before);
  // expect 在源码里是对象字面量；用"去空格后等价"的形式定位（源码里可能有空格/换行）
  const found = replaceExpectLiteral(out, d.before, d.after);
  if (!found) {
    missed++;
    console.log(`  ✗ #${d.i} 在源码里没定位到 ${before}（可能被表达式/变量表示，需手工改）`);
  } else out = found;
}
if (missed > 0) {
  console.log(`\n有 ${missed} 条没自动改写：请手工改，或扩展本脚本的定位规则。未写文件。`);
  process.exit(3);
}
writeFileSync(src, out);
console.log(
  `\n已改写 ${src}（${diffs.length} 处）。记得跑 pnpm exec biome check --write 格式化 + pnpm check。`,
);

/** 关卡定义所在的源文件（按关卡 id 在 content 包里找） */
function levelSourceOf(id: string): string {
  const dir = new URL('../../packages/content/src/', import.meta.url);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const p = new URL(f, dir);
    const t = readFileSync(p, 'utf8');
    if (t.includes(`id: '${id}'`)) return p.pathname;
  }
  throw new Error(`找不到关卡 ${id} 的源文件`);
}

/** 把 `expect: {...before}` 原样替换成 `expect: {...after}`（按"去掉所有空白后相同"匹配） */
function replaceExpectLiteral(
  text: string,
  before: Record<string, number | undefined>,
  after: Record<string, number | undefined>,
): string | undefined {
  const norm = (s: string) => s.replace(/\s+/g, '');
  const target = norm(JSON.stringify(before));
  // 扫描所有 "expect" 后面的对象字面量
  const re = /expect\s*:\s*\{/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    const start = m.index + m[0].length - 1; // 指向 '{'
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end > 0) {
      const body = text.slice(start, end + 1);
      if (norm(body) === target) {
        const body2 = `{ ${Object.entries(after)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join(', ')} }`;
        return text.slice(0, start) + body2 + text.slice(end + 1);
      }
    }
    m = re.exec(text);
  }
  return undefined;
}
