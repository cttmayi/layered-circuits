/**
 * 门目录：把「基础片段」和「玩家组件库里的模块」统一成『函数 + 成本 + 实例化方式』，
 * 后面的最短路径搜索就不用关心它到底是一个二极管与门还是一个封装好的异或门。
 *
 * 函数用 4 位掩码表示（约定 bit i 对应输入组合 i，i = a*2 + b 的二进制）。
 * 掩码不是手写的：把片段真的编译 + 仿真四条输入组合测出来，杜绝「表写错了」。
 */

import { compileDesign, computeCosts } from '@lc/compiler';
import { costHalfOf, DesignBuilder, InMemoryModuleLibrary, type ModuleTemplate } from '@lc/schema';
import { runVectors } from '@lc/sim-core';
import { BASE_FRAGMENTS, type Fragment, type FragmentContext } from './fragments.js';

/** 4 位真值表掩码：位 i = 输入组合 i 时的输出 */
export type Mask = number;

export interface Gate {
  id: string;
  name: string;
  arity: 1 | 2;
  /** 该门的真值表掩码（arity=1 时只用 x 那一维） */
  mask: Mask;
  /** 真实成本（半单位）：组装后由 compileDesign + computeCosts 算出来，不手写 */
  costHalf: number;
  /** 把一个门实例接到给定网络 */
  instantiate(b: DesignBuilder, inputs: string[], out: string, prefix: string): void;
  origin: 'fragment' | 'module';
}

/** 输入 a 的掩码：a=1 的组合是 i=2,3 */
export const MASK_A: Mask = 0b1100;
/** 输入 b 的掩码：b=1 的组合是 i=1,3 */
export const MASK_B: Mask = 0b1010;
export const MASK_ZERO: Mask = 0b0000;
export const MASK_ONE: Mask = 0b1111;

/** 掩码求值：把 gateMask 当成 (x,y) 的函数，套用到两个输入掩码上 */
export function applyMask(gateMask: Mask, x: Mask, y: Mask): Mask {
  let result = 0;
  for (let i = 0; i < 4; i++) {
    const bx = (x >> i) & 1;
    const by = (y >> i) & 1;
    if ((gateMask >> ((bx << 1) | by)) & 1) result |= 1 << i;
  }
  return result;
}

/** 单输入片段也要走「两输入组合」的完整掩码空间（另一维恒为 0），掩码才可比 */
const COMBOS = [
  { a: 0 as const, b: 0 as const },
  { a: 0 as const, b: 1 as const },
  { a: 1 as const, b: 0 as const },
  { a: 1 as const, b: 1 as const },
];

interface Probe {
  mask: Mask;
  costHalf: number;
  ok: boolean;
}

function probeDesign(
  design: Parameters<typeof compileDesign>[0],
  library: InMemoryModuleLibrary,
): Probe {
  try {
    const { net, diagnostics } = compileDesign(design, { library });
    if (diagnostics.some((d) => d.severity === 'error')) return { mask: 0, costHalf: 0, ok: false };
    // 只有真的存在的输入端口才能施加激励（单输入片段没有 b 端口）
    const inputNames = new Set(net.ports.filter((p) => p.dir === 'in').map((p) => p.name));
    const rows = COMBOS.map((combo) => {
      const inputs: Record<string, 0 | 1> = {};
      if (inputNames.has('a')) inputs.a = combo.a;
      if (inputNames.has('b')) inputs.b = combo.b;
      return { inputs };
    });
    const run = runVectors(net, rows, {
      mode: 'logic',
      maxIterations: 4000,
      maxEventsPerVector: 200_000,
    });
    if (run.unstable) return { mask: 0, costHalf: 0, ok: false };
    let mask = 0;
    run.rows.forEach((row, index) => {
      if (row.actual.y === 1) mask |= 1 << index;
      // 出现 X / Z 一律按 0 记：这种片段后面会被真判定淘汰
    });
    return { mask, costHalf: costHalfOf(computeCosts(design, library).counts), ok: true };
  } catch {
    return { mask: 0, costHalf: 0, ok: false };
  }
}

/** 测一个基础片段的函数与成本 */
export function probeFragment(fragment: Fragment): Probe {
  const b = new DesignBuilder(`probe-${fragment.id}`, fragment.id);
  b.vcc('vcc');
  b.gnd('gnd');
  const inputs = fragment.arity === 1 ? ['a'] : ['a', 'b'];
  const ctx: FragmentContext = { inputs, out: 'y', prefix: 'F', has: () => false };
  fragment.build(b, ctx);
  b.port('a', 'in', 'a');
  if (fragment.arity === 2) b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');
  return probeDesign(b.build(), new InMemoryModuleLibrary());
}

/** 测一个组件库模块的函数（成本直接取模板里已算好的 costHalf） */
export function probeModule(
  template: ModuleTemplate,
  library: InMemoryModuleLibrary,
): { mask: Mask; costHalf: number; ok: boolean } | null {
  const inputs = template.ports.filter((p) => p.dir === 'in');
  const output = template.ports.find((p) => p.dir === 'out');
  if (inputs.length < 1 || inputs.length > 2 || !output) return null;

  const b = new DesignBuilder(`probe-mod-${template.hash.slice(0, 8)}`, template.name);
  b.vcc('vcc');
  b.gnd('gnd');
  const pins: Record<string, string> = {};
  inputs.forEach((p, i) => {
    pins[p.name] = i === 0 ? 'a' : 'b';
  });
  pins[output.name] = 'y';
  b.module(template.hash, pins, template.name);
  b.port('a', 'in', 'a');
  if (inputs.length === 2) b.port('b', 'in', 'b');
  b.port('y', 'out', 'y');

  const probe = probeDesign(b.build(), library);
  return { mask: probe.mask, costHalf: template.costHalf, ok: probe.ok };
}

export interface CatalogOptions {
  /** 是否把组件库模块也算进来（默认算） */
  modules?: boolean;
  /** 覆写片段集合（默认全部基础片段） */
  fragments?: readonly Fragment[];
}

/**
 * 由基础片段 + 组件库模块组成完整门目录。
 * 同一「函数 + 成本」只留一个实现：否则搜索会把同义词翻来覆去地试。
 */
export function buildCatalog(library: InMemoryModuleLibrary, options: CatalogOptions = {}): Gate[] {
  const gates: Gate[] = [];
  const seen = new Set<string>();

  for (const fragment of options.fragments ?? BASE_FRAGMENTS) {
    const probe = probeFragment(fragment);
    if (!probe.ok) continue;
    const arity: 1 | 2 = fragment.arity;
    const key = `f:${arity}:${probe.mask}:${probe.costHalf}`;
    if (seen.has(key)) continue;
    seen.add(key);
    gates.push({
      id: fragment.id,
      name: fragment.name,
      arity,
      mask: probe.mask,
      costHalf: probe.costHalf,
      origin: 'fragment',
      instantiate(b, nets, out, prefix) {
        fragment.build(b, { inputs: nets, out, prefix, has: () => false });
      },
    });
  }

  if (options.modules !== false) {
    for (const template of library.list()) {
      const probe = probeModule(template, library);
      if (!probe?.ok) continue;
      const inputs = template.ports.filter((p) => p.dir === 'in');
      const output = template.ports.find((p) => p.dir === 'out');
      if (!output) continue;
      const arity: 1 | 2 = inputs.length === 1 ? 1 : 2;
      const key = `m:${arity}:${probe.mask}:${probe.costHalf}`;
      if (seen.has(key)) continue;
      seen.add(key);
      gates.push({
        id: `mod:${template.hash.slice(0, 10)}`,
        name: `${template.name} v${template.version}`,
        arity,
        mask: probe.mask,
        costHalf: probe.costHalf,
        origin: 'module',
        instantiate(b, nets, out, prefix) {
          const pins: Record<string, string> = {};
          inputs.forEach((p, i) => {
            pins[p.name] = nets[i] as string;
          });
          pins[output.name] = out;
          b.module(template.hash, pins, prefix);
        },
      });
    }
  }

  // 便宜的门优先：按成本从低到高组装，最先命中的就是最省解
  return gates.sort((x, y) => x.costHalf - y.costHalf || x.id.localeCompare(y.id));
}
