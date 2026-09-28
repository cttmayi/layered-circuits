/**
 * spec → Level：补齐向量、算出最优与预算、生成参考解，并**真判定一遍**。
 *
 * 这个文件就是「30 分钟产出一个关卡」的核心：
 * 制作人写不到 30 行 spec，工具把剩下的事全干了，而且干完还会自己验收。
 */

import { judgeDesign, requiredPorts } from '@lc/compiler';
import { solveLevel } from '@lc/opt-solver';
import {
  budgetFromOptimal,
  type Design,
  InMemoryModuleLibrary,
  type Level,
  parseLevel,
} from '@lc/schema';
import type { LevelSpec } from './spec.js';
import { synthesizeSop } from './synth.js';

export interface BuildResult {
  level: Level;
  /** 追加到内容包里的 TypeScript 源码（parseLevel({...}) 形式） */
  source: string;
  notes: string[];
}

/** 由真值表展开成向量：按 inputs 顺序生成全组合 */
export function vectorsOf(spec: LevelSpec): Level['vectors'] {
  const entries = Object.entries(spec.truth);
  const expected = 2 ** spec.inputs.length;
  if (spec.inputs.length <= 2 && entries.length !== expected) {
    throw new Error(
      `真值表不完整：${spec.inputs.length} 个输入需要 ${expected} 行，实际 ${entries.length} 行`,
    );
  }
  const vectors: Level['vectors'] = entries.map(([key, outputs]) => {
    const values = key.split(',').map((v) => Number.parseInt(v.trim(), 10));
    if (values.length !== spec.inputs.length) {
      throw new Error(`真值表 key「${key}」与输入端口数不符（应为 ${spec.inputs.length} 个 0/1）`);
    }
    const inputs: Record<string, 0 | 1> = {};
    spec.inputs.forEach((name, i) => {
      const value = values[i];
      if (value !== 0 && value !== 1) throw new Error(`真值表 key「${key}」里出现了非 0/1 的值`);
      inputs[name] = value;
    });
    const reject: string[] = [];
    for (const out of spec.outputs) {
      if (outputs[out] === undefined) reject.push(out);
    }
    if (reject.length > 0) {
      throw new Error(`真值表 key「${key}」缺少输出端口：${reject.join('、')}`);
    }
    return { inputs, expect: { ...outputs } };
  });

  const extra = spec.extraVectors.map((vector) => ({
    inputs: { ...vector.inputs },
    ...(vector.expect ? { expect: { ...vector.expect } } : {}),
    ...(vector.settlePs !== undefined ? { settlePs: vector.settlePs } : {}),
    ...(vector.note !== undefined ? { note: vector.note } : {}),
  }));

  return [...vectors, ...extra] as Level['vectors'];
}

/** 组装关卡：先按 spec 出草案，再用求解器/参考解把成本口径钉死 */
export function buildLevel(spec: LevelSpec, library = new InMemoryModuleLibrary()): BuildResult {
  const notes: string[] = [];
  const vectors = vectorsOf(spec);

  // 1) 先用「最优 = 0，预算 = 0」出草案，好让求解器拿它当关卡（求解器只看 allowedUnits / 端口 / 向量）
  const draft = parseLevel({
    schemaVersion: 1,
    id: spec.id,
    stage: spec.stage,
    kind: spec.kind,
    title: spec.title,
    brief: spec.brief,
    teaching: spec.teaching,
    hint: spec.hint,
    mode: spec.mode,
    ...(spec.timingBudgetPs !== undefined ? { timingBudgetPs: spec.timingBudgetPs } : {}),
    allowedUnits: [...spec.allowedUnits],
    moduleAccess: spec.moduleAccess,
    allowedModules: [...spec.allowedModules],
    bannedModules: [...spec.bannedModules],
    // 草案阶段不设预算（只用来跑参考解与求解器），真实预算稍后按参考解成本算
    budgetHalf: 1_000_000_000,
    optimalHalf: 0,
    ...(spec.freqHz !== undefined ? { clock: { freqHz: spec.freqHz } } : {}),
    checks: { ...spec.checks },
    vectors,
    unlock: {
      name: spec.unlockName ?? spec.title,
      kind: spec.unlockKind,
      stage: spec.stage,
      ports: [
        ...spec.inputs.map((n) => ({ id: n, name: n, dir: 'in' as const, width: 1 })),
        ...spec.outputs.map((n) => ({ id: n, name: n, dir: 'out' as const, width: 1 })),
      ],
    },
  });

  // 2) 参考解：手写的优先；没有就用求解器搜出来的电路
  let reference = spec.reference;
  const report = solveLevel(draft, { library });
  if (report.referencePass === false) {
    throw new Error('手写的参考解过不了这一关的判定，请先修好参考解再生成关卡');
  }
  if (!reference) {
    if (report.best) {
      // 1~2 输入：求解器给出的是「门目录组合空间内的最省解」
      reference = report.best.design;
      notes.push(`参考解由求解器生成：成本 ${report.best.measuredHalf} 半单位（门目录空间内最省）`);
    } else {
      // 3 输入以上：用 SOP 综合兜底，功能一定对，但通常不是最省
      reference = synthesizeSop({
        id: `synth-${spec.id}`,
        name: `${spec.title}（SOP 参考解）`,
        inputs: spec.inputs,
        outputs: spec.outputs,
        truth: spec.truth,
        allowedUnits: spec.allowedUnits,
      });
      notes.push('3 输入以上：参考解由 SOP 综合生成（功能正确，通常不是最省）');
      notes.push('建议手写更优的 reference 覆盖它，让预算更紧、教学更明确');
    }
  }

  // 3) 成本口径：满分线 = 参考解成本；已知最省 = 求解器/手写的更省解（可小于满分线）
  const check = judgeDesign(reference, draft, { library, hardcore: true });
  if (!check.pass) {
    throw new Error(`参考解判定未通过：${check.errors.join('；')}`);
  }
  const optimalHalf = check.costHalf;
  // 满分线 = 参考解成本；只有求解器真的搜过（1~2 输入）才敢声明「已知最省」
  const bestKnownHalf = spec.bestKnownHalf ?? report.best?.measuredHalf ?? optimalHalf;
  if (spec.kind === 'cost') {
    notes.push('成本挑战关：不设预算上限（budgetHalf = 0），成绩记进重挑战榜');
  }

  const level = parseLevel({
    schemaVersion: 1,
    id: spec.id,
    stage: spec.stage,
    kind: spec.kind,
    title: spec.title,
    brief: spec.brief,
    teaching: spec.teaching,
    hint: spec.hint,
    mode: spec.mode,
    ...(spec.timingBudgetPs !== undefined ? { timingBudgetPs: spec.timingBudgetPs } : {}),
    allowedUnits: [...spec.allowedUnits],
    moduleAccess: spec.moduleAccess,
    allowedModules: [...spec.allowedModules],
    bannedModules: [...spec.bannedModules],
    budgetHalf: spec.kind === 'cost' ? 0 : budgetFromOptimal(optimalHalf, spec.overhead),
    optimalHalf,
    ...(bestKnownHalf < optimalHalf ? { bestKnownHalf } : {}),
    ...(spec.freqHz !== undefined ? { clock: { freqHz: spec.freqHz } } : {}),
    checks: { ...spec.checks },
    vectors,
    unlock: {
      name: spec.unlockName ?? spec.title,
      kind: spec.unlockKind,
      stage: spec.stage,
      ports: [
        ...spec.inputs.map((n) => ({ id: n, name: n, dir: 'in' as const, width: 1 })),
        ...spec.outputs.map((n) => ({ id: n, name: n, dir: 'out' as const, width: 1 })),
      ],
    },
    referenceSolution: reference,
  });

  const finalCheck = judgeDesign(reference, level, { library, hardcore: true });
  if (!finalCheck.pass) {
    throw new Error(`生成后的关卡判定不过关：${finalCheck.errors.join('；')}`);
  }
  notes.push(
    `满分线 ${optimalHalf / 2}，预算 ${level.budgetHalf / 2}，端口 ${requiredPorts(level).inputs.join('/')} → ${requiredPorts(level).outputs.join('/')}`,
  );

  return { level, source: toSource(spec, level, reference), notes };
}

/** 把结果写成可直接粘进内容包的 TypeScript 源码 */
export function toSource(spec: LevelSpec, level: Level, reference: Design): string {
  const lines: string[] = [];
  lines.push(`// 由 tools/level-editor 生成：spec → 关卡 + 参考解`);
  lines.push(`export const ${camel(spec.id)} = parseLevel({`);
  lines.push(`  schemaVersion: 1,`);
  lines.push(`  id: ${quote(level.id)},`);
  lines.push(`  stage: ${level.stage},`);
  lines.push(`  kind: ${quote(level.kind)},`);
  lines.push(`  title: ${quote(level.title)},`);
  lines.push(`  brief: ${quote(level.brief)},`);
  lines.push(`  teaching: ${quote(level.teaching)},`);
  lines.push(`  hint: ${quote(level.hint)},`);
  lines.push(`  mode: ${quote(level.mode)},`);
  if (level.timingBudgetPs !== undefined) {
    lines.push(`  timingBudgetPs: ${level.timingBudgetPs},`);
  }
  lines.push(`  allowedUnits: [${level.allowedUnits.map(quote).join(', ')}],`);
  lines.push(`  moduleAccess: ${quote(level.moduleAccess)},`);
  if (level.allowedModules.length > 0) {
    lines.push(`  allowedModules: [${level.allowedModules.map(quote).join(', ')}],`);
  }
  if (level.bannedModules.length > 0) {
    lines.push(`  bannedModules: [${level.bannedModules.map(quote).join(', ')}],`);
  }
  lines.push(`  budgetHalf: ${level.budgetHalf},`);
  lines.push(`  optimalHalf: ${level.optimalHalf},`);
  if (level.bestKnownHalf !== undefined) {
    lines.push(`  bestKnownHalf: ${level.bestKnownHalf},`);
  }
  if (level.clock) lines.push(`  clock: { freqHz: ${level.clock.freqHz} },`);
  if (Object.keys(level.checks).length > 0) {
    lines.push(`  checks: ${JSON.stringify(level.checks)},`);
  }
  lines.push(`  vectors: ${JSON.stringify(level.vectors, null, 2).split('\n').join('\n  ')},`);
  lines.push(`  unlock: ${JSON.stringify(level.unlock, null, 2).split('\n').join('\n  ')},`);
  lines.push(`});`);
  lines.push('');
  lines.push(`/** 参考解（求解器/制作人提供，已过真判定） */`);
  lines.push(`export const ${camel(spec.id)}Ref = ${JSON.stringify(reference)};`);
  return lines.join('\n');
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}

function camel(id: string): string {
  return id.replace(/[-_](\w)/g, (_, c: string) => c.toUpperCase());
}
