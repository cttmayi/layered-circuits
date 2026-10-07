/**
 * 组件库的版本管理与溯源（M3-D），以及本地重挑战榜与存档导入导出（M3-E）。
 *
 * 为什么需要版本：复古复用关（GDD 4.4）要求「只许用早期版本的模块」——
 * 如果再次封装时直接把老版本覆盖掉，玩家就永远回不到早期手段了。
 * 所以同名模块再次封装 = **新版本入库，老版本保留**（minor +1），
 * 并且每个版本都记住自己用了哪些下层模块（溯源树），成本与依赖都能一路查下去。
 */

import type { LogicFamily } from '@lc/schema';
import type { StoredModule } from '../editor/model';

/** 模块的契约标注：封装时写进模板（wrapModule 按内部元件推导），这里读出来打标签 */
export function familyOfModule(mod: StoredModule): LogicFamily {
  const t = mod.template as { family?: LogicFamily } | null | undefined;
  return t?.family ?? 'rtl';
}

/** 版本号比较：'1.10' > '1.2'（按数值比，不按字符串比） */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 同名模块的当前最高版本 */
export function latestVersionOf(library: readonly StoredModule[], name: string): string | null {
  const versions = library.filter((m) => m.name === name).map((m) => m.version);
  if (versions.length === 0) return null;
  return versions.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
}

/** 下一版版本号：同名模块已存在就 minor +1，否则 1.0 */
export function nextVersion(library: readonly StoredModule[], name: string): string {
  const latest = latestVersionOf(library, name);
  if (!latest) return '1.0';
  const [major = '1', minor = '0'] = latest.split('.');
  return `${major}.${(Number.parseInt(minor, 10) || 0) + 1}`;
}

export interface StoreModuleInput {
  hash: string;
  name: string;
  costHalf: number;
  isSequential: boolean;
  ports: StoredModule['ports'];
  template: unknown;
  stage: number;
  /** 产出这一版时的关卡（自由模式传 undefined） */
  levelId?: string;
  /** 封装时用到的下层模块哈希（溯源子节点） */
  sources?: readonly string[];
}

/** 把一个新封装的模块整理成入库记录（版本号按同名模块自动递增） */
export function storeModule(
  library: readonly StoredModule[],
  input: StoreModuleInput,
  now = Date.now(),
): StoredModule {
  const sources = [...new Set(input.sources ?? [])].filter((hash) => hash !== input.hash).sort();
  return {
    hash: input.hash,
    name: input.name,
    version: nextVersion(library, input.name),
    stage: input.stage,
    costHalf: input.costHalf,
    isSequential: input.isSequential,
    ports: input.ports,
    template: input.template,
    ...(input.levelId !== undefined ? { levelId: input.levelId } : {}),
    sources,
    createdAt: now,
  };
}

/**
 * 入库：同一哈希（电路内容完全相同）不重复入库；
 * 同名不同内容则作为新版本追加，老版本保留。
 */
export function addModule(library: readonly StoredModule[], module: StoredModule): StoredModule[] {
  if (library.some((m) => m.hash === module.hash)) return [...library];
  return [...library, module];
}

/**
 * 批量入库（内容寻址去重）：`modules` 里同 hash 的一条都不重复加。
 *
 * 为什么必须有这个函数：库里是「一 hash 一条」，而菜单是「一条目一张卡」
 * （Palette 的基础门 = `library.filter(teaching && BASIC_GATES)`）—— 所以凡是写成
 * `[...library, ...extra]` 的「不去重追加」，只要被重复触发，玩家就会看到同一个门变出
 * 好几张卡（用户实测 bug：连点「一键出答案」，基础门 5 → 10 → 15 → 20）。
 * 库本来就是内容寻址的（hash = 电路内容），重复触发必须**逐字不改变库**。
 *
 * 一条都没加时返回**原数组本身**（引用不变）：调用方多是 React state / useMemo 的依赖，
 * 无谓的拷贝会让下面的 memo 与重渲染白白失效。
 */
export function mergeModules(
  library: readonly StoredModule[],
  modules: readonly StoredModule[],
): StoredModule[] {
  let out: StoredModule[] | null = null;
  for (const module of modules) {
    if ((out ?? library).some((m) => m.hash === module.hash)) continue;
    out = [...(out ?? library), module];
  }
  return out ?? (library as StoredModule[]);
}

export interface TraceNode {
  hash: string;
  name: string;
  version: string;
  costHalf: number;
  /** 这一版由哪一关产出（自由模式为空） */
  levelId?: string;
  children: TraceNode[];
  /** 溯源里出现了环（理论上不会，但存档被手改过就可能） */
  cyclic?: boolean;
}

/** 溯源树：把模块用到的下层模块一层层展开（组件库的「血统」） */
export function traceOf(
  library: readonly StoredModule[],
  hash: string,
  seen: readonly string[] = [],
): TraceNode | null {
  const module = library.find((m) => m.hash === hash);
  if (!module) return null;
  const cyclic = seen.includes(hash);
  const children = cyclic
    ? []
    : module.sources
        .map((child) => traceOf(library, child, [...seen, hash]))
        .filter((node): node is TraceNode => node !== null);
  return {
    hash: module.hash,
    name: module.name,
    version: module.version,
    costHalf: module.costHalf,
    ...(module.levelId !== undefined ? { levelId: module.levelId } : {}),
    children,
    ...(cyclic ? { cyclic: true } : {}),
  };
}

/** 同名模块的版本历史（新的在前） */
export function versionsOfName(library: readonly StoredModule[], name: string): StoredModule[] {
  return library
    .filter((m) => m.name === name)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * 存档瘦身：同名模块只保留版本号最高的一个（其余旧版移除），同一份内容（哈希）只留一条。
 *
 * **「同名」不等于「同一谱系」**：玩家可以把两个完全不同的电路都叫「非门」，而封装时的
 * 版本号（nextVersion）只按名字递增，于是"最新的非门"完全可能是另一个电路。只看名字删
 * 低版本会把仍在用的模块删掉 —— 画布上的实例随之解析不到、导线静默消失（编译器只会报
 * 一句"模块不在组件库中"）。所以被存档画布引用到的模块必须保留：调用方用
 * `referencedModuleHashes()` 算出引用哈希及其传递闭包，通过 `keep` 传进来；
 * 教学积木（teaching）也不删（内容包随时能重新注入，留着省事）。
 */
export function dedupeLibrary(
  library: readonly StoredModule[],
  keep: ReadonlySet<string> = new Set(),
): StoredModule[] {
  const newestVersionBy = new Map<string, string>();
  for (const m of library) {
    const current = newestVersionBy.get(m.name);
    if (current === undefined || compareVersions(m.version, current) > 0) {
      newestVersionBy.set(m.name, m.version);
    }
  }
  // 同一份内容（哈希）只留一条：留版本号最高的那条记录
  const byHash = new Map<string, StoredModule>();
  for (const m of library) {
    const current = byHash.get(m.hash);
    if (!current || compareVersions(m.version, current.version) > 0) byHash.set(m.hash, m);
  }
  return [...byHash.values()].filter((m) => {
    // 被画布引用到的（keep，含传递闭包）与教学积木一律保留
    if (m.teaching || keep.has(m.hash)) return true;
    return newestVersionBy.get(m.name) === m.version;
  });
}

/** 溯源树里出现的所有模块数量（含自身） */
export function traceSize(node: TraceNode): number {
  return 1 + node.children.reduce((sum, child) => sum + traceSize(child), 0);
}
