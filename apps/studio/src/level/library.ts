/**
 * 组件库的版本管理与溯源（M3-D），以及本地重挑战榜与存档导入导出（M3-E）。
 *
 * 为什么需要版本：复古复用关（GDD 4.4）要求「只许用早期版本的模块」——
 * 如果再次封装时直接把老版本覆盖掉，玩家就永远回不到早期手段了。
 * 所以同名模块再次封装 = **新版本入库，老版本保留**（minor +1），
 * 并且每个版本都记住自己用了哪些下层模块（溯源树），成本与依赖都能一路查下去。
 */

import { BASIC_GATES, teachingModulesFor } from '@lc/content';
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

/** 教学积木（整个族）→ 画布库条目：`teaching: true` 使其不进「我的模块」（见 editor/model.ts） */
export function teachingCatalogFor(family: LogicFamily): StoredModule[] {
  return teachingModulesFor(family).map((m) => ({
    hash: m.hash,
    name: m.name,
    version: m.version,
    stage: m.stage,
    costHalf: m.costHalf,
    isSequential: m.isSequential,
    ports: m.ports,
    template: m,
    sources: [],
    createdAt: 0,
    teaching: true,
  }));
}

/**
 * **本关基础门的权威清单**（逻辑关的「基础门」分组直接照它渲染，与库里有什么无关）。
 *
 * 用户第 ⑯ 轮的口径：到了第 8 关（逻辑关）**不该存在"不同的非门"** —— 门是**契约实体**，
 * 身份由**名字**决定，内部怎么搭（rtl 的 NPN+电阻、TTL 的射极跟随器、CMOS 的互补对）
 * 与玩家无关。这条口径在引擎里本就是事实：
 *   · `sim-core/gate-netlist.ts` 遇到 `isGateName(mod.name)` 就**按真值函数当原子算、根本不展开身体**
 *     （`isPureCombinational` 同样判它"纯"）—— 判定读的是**名字**，不是 hash；
 *   · `gate-logic.ts` 的 `evalGate(name, inputs)` 只认 `GATE_NAMES`。
 * 实测（本轮）：同一个逻辑关的门版参考解，把里面的「非门」换成 ttl / cmos 版本
 * （hash 完全不同、身体完全不同）→ **判定结论逐字一致（pass + 错误列表）**；
 * 只有**造价/评分**会变（非门成本 rtl 32 / ttl 36 / cmos 24 半单位），因为评分按本关族
 * 的积木算。所以菜单必须给**本关族**那一份：给别族的同名门 = 让玩家用别族的成本去打本关的
 * 满分线（可能更便宜，也可能更贵），这与"关卡严格保证"的族契约相冲突。
 *
 * 于是逻辑关的清单 = `teachingModulesFor(本关族)` 里的基础门，**按族内教学顺序**排列 ——
 * 与库里有多少条同名、hash 是不是别族的、有没有重复**完全无关**。
 * 时机与自由模式不走这条（那里强弱/工艺是真实差异，见 Palette 的分支）。
 */
export function gateCatalogFor(family: LogicFamily): StoredModule[] {
  return teachingCatalogFor(family).filter((m) => BASIC_GATES.includes(m.name));
}

/**
 * **显示层**按名字去重：同一个名字只留一条，菜单里就只出一张卡。
 *
 * 为什么显示层也要去重（用户实测 bug：本来 7 个，点一次「一键出答案」变 11 个，之后不再涨）：
 *
 *  · 菜单的分组是**按名字**列的（Palette 的基础门 = `library.filter(teaching && BASIC_GATES)`），
 *    而库是**内容寻址**的（一 hash 一条）—— 名字相同、内容不同（族不同：rtl 的非门与 cmos 的
 *    非门是两个 hash）就是两条 → **同名出两张卡**。
 *  · `dedupeLibrary`（读档瘦身）**故意**不合并它们：`if (m.teaching || keep.has(m.hash)) return true`
 *    —— 教学积木一律保留（内容包随时能重新注入，删了反而可能让存档里引用它的电路解析不到）。
 *    所以历史遗留的同名条目会一直躺在库里，"看起来脏"。
 *  · 追加去重（`mergeModules`）只能防**新增**，清不掉**已有**的重复 —— 修前一版就漏了这一层。
 *
 * 取舍：**只动显示，不动库、不动存档、更不动判定**（判定按 hash 解析，与这里无关）。
 * 同名要留哪一份，按下面的优先级（`order` 最权威）：
 *   ① `order`（本关族的教学注入顺序）里出现的那一份 —— 它带**本关的契约**：逻辑关的判定与
 *      一键出答案用的都是本关族的门，显示另一族的同名门会让玩家摆上一个判不过去的变体；
 *   ② 版本号更高的（与 `dedupeLibrary` 「同名只留最新版」的口径一致）；
 *   ③ 更早出现的（先到先得，保证结果稳定、可解释）。
 * 返回顺序：命中的条目按 `order` 的次序排（有 order 时），否则保持库里的原始次序 ——
 * 这样干净存档的卡片顺序与去重前**逐字一致**（不会无谓地动排版）。
 */
export function dedupeByNameForDisplay(
  modules: readonly StoredModule[],
  options: { order?: readonly string[] } = {},
): StoredModule[] {
  const rank = new Map<string, number>();
  for (const [i, hash] of (options.order ?? []).entries()) rank.set(hash, i);
  const best = new Map<string, { module: StoredModule; index: number; rank: number }>();
  for (const [index, module] of modules.entries()) {
    const r = rank.get(module.hash) ?? Number.MAX_SAFE_INTEGER;
    const current = best.get(module.name);
    if (!current) {
      best.set(module.name, { module, index, rank: r });
      continue;
    }
    // order 里有的赢；都没有 order 名分时按版本号；再同则保留先到的
    const better =
      r < current.rank ||
      (r === current.rank &&
        current.rank === Number.MAX_SAFE_INTEGER &&
        compareVersions(module.version, current.module.version) > 0);
    if (better) best.set(module.name, { module, index, rank: r });
  }
  const kept = [...best.values()];
  if (!options.order || options.order.length === 0) {
    return kept.sort((a, b) => a.index - b.index).map((v) => v.module);
  }
  return kept
    .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
    .map((v) => v.module);
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
