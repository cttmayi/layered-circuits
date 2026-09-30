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
 * 存档瘦身：同名模块只保留版本号最高的一个（其余旧版移除）。
 *
 * 注意这会让「版本历史」展示变少，但当前玩法里旧版没有独立用途：
 * 复古复用关靠 bannedModules 按模块**名字**禁用，不依赖旧版本回退；
 * 库面板里的版本列表只是展示，没有「用回旧版」的入口。所以清理是安全的。
 */
export function dedupeLibrary(library: readonly StoredModule[]): StoredModule[] {
  const newestVersionBy = new Map<string, string>();
  for (const m of library) {
    const current = newestVersionBy.get(m.name);
    if (current === undefined || compareVersions(m.version, current) > 0) {
      newestVersionBy.set(m.name, m.version);
    }
  }
  return library.filter((m) => newestVersionBy.get(m.name) === m.version);
}

/** 溯源树里出现的所有模块数量（含自身） */
export function traceSize(node: TraceNode): number {
  return 1 + node.children.reduce((sum, child) => sum + traceSize(child), 0);
}
