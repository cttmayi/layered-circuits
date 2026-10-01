/**
 * 模块封装：把玩家电路固化成组件库条目（GDD 2.1.2）。
 *
 * - 身份：hashModule() = 端口声明 + 电路结构（递归含子模块内容哈希，Merkle）；
 *   名称/版本/位置等元数据不参与哈希，因此可以改名、可以同内容多版本。
 * - 成本：computeCosts() 递归到基础元件后缓存进模板（O(1) 查表）；
 * - 时序：analyzeTiming() 实测端口延迟矩阵 + 是否时序电路，同样缓存。
 *
 * 封装后模块内容即不可变（改内容 = 换哈希 = 新模块），这正是 GDD 2.1.2「禁止逆向修改」的技术实现。
 */

import {
  costHalfOf,
  type Design,
  type LogicFamily,
  type ModuleKind,
  type ModuleLibrary,
  type ModulePort,
  type ModuleTemplate,
  ModuleTemplateSchema,
} from '@lc/schema';
import { computeCosts } from './cost.js';
import { type CompileDiagnostic, compileDesign } from './flatten.js';
import { sha256Hex, stableStringify } from './sha256.js';
import { analyzeTiming } from './timing.js';

function pinSortKey(inst: string, pin: string, bit: number): string {
  return `${inst}\u0000${pin}\u0000${bit}`;
}

/**
 * 从 body 直接引用的模块出发，DFS 库内模块依赖图；若访问路径上重复遇到某模块
 * （visiting 集合里再次出现）即为环，返回环的 hash 链（首尾相同）。无环返回 null。
 */
export function findDependencyCycle(body: Design, library: ModuleLibrary): string[] | null {
  const depsOf = (hash: string): string[] => {
    const tpl = library.get(hash);
    if (!tpl) return [];
    const out: string[] = [];
    for (const inst of tpl.body.instances) {
      if (inst.kind === 'module' && !out.includes(inst.module)) out.push(inst.module);
    }
    return out;
  };

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  const dfs = (hash: string): string[] | null => {
    if (visiting.has(hash)) {
      const start = path.indexOf(hash);
      return [...path.slice(start), hash];
    }
    if (visited.has(hash)) return null;
    visiting.add(hash);
    path.push(hash);
    for (const dep of depsOf(hash)) {
      const cycle = dfs(dep);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(hash);
    visited.add(hash);
    return null;
  };

  for (const inst of body.instances) {
    if (inst.kind !== 'module') continue;
    const cycle = dfs(inst.module);
    if (cycle) return cycle;
  }
  return null;
}

/** 规范化端口声明（排序 + 去噪） */
export function canonicalPorts(ports: readonly ModulePort[]): ModulePort[] {
  return [...ports]
    .map((p) => ({ id: p.id, name: p.name, dir: p.dir, width: p.width }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * 电路结构规范化：只保留电气语义（连接关系、元件种类、子模块哈希），
 * 丢掉标签与画布坐标 —— 挪一下元件位置不应该产生新模块。
 */
export function canonicalDesign(design: Design): unknown {
  const instances = [...design.instances]
    .map((inst) => {
      switch (inst.kind) {
        case 'unit':
          return { kind: 'unit', id: inst.id, unit: inst.unit };
        case 'module':
          return { kind: 'module', id: inst.id, module: inst.module };
        default:
          return { kind: inst.kind, id: inst.id };
      }
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const nets = [...design.nets]
    .map((net) => ({
      id: net.id,
      pins: [...net.pins]
        .map((p) => ({ inst: p.inst, pin: p.pin, bit: p.bit ?? 0 }))
        .sort((a, b) =>
          pinSortKey(a.inst, a.pin, a.bit) < pinSortKey(b.inst, b.pin, b.bit) ? -1 : 1,
        ),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const ports = [...design.ports]
    .map((p) => ({ id: p.id, name: p.name, dir: p.dir, width: p.width, nets: [...p.nets] }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { instances, nets, ports };
}

/** 模块内容哈希（Merkle）：端口声明 + 电路结构 */
export function hashModule(ports: readonly ModulePort[], body: Design): string {
  return sha256Hex(stableStringify({ ports: canonicalPorts(ports), body: canonicalDesign(body) }));
}

/** 顶层电路（关卡作答）的哈希，用于排行榜指纹与存档校验 */
export function hashDesign(design: Design): string {
  return sha256Hex(stableStringify(canonicalDesign(design)));
}

/** 从电路自身的端口声明推导模块端口（封装时最常用） */
export function designToModulePorts(design: Design): ModulePort[] {
  return design.ports.map((p) => ({ id: p.id, name: p.name, dir: p.dir, width: p.width }));
}

export interface WrapModuleInput {
  name: string;
  version?: string;
  stage: number;
  kind: ModuleKind;
  ports: readonly ModulePort[];
  body: Design;
  note?: string;
}

export interface WrapModuleResult {
  template: ModuleTemplate;
  diagnostics: CompileDiagnostic[];
}

/** 把一个电路封装成模块模板（通关封装的唯一入口） */
export function wrapModule(input: WrapModuleInput, library: ModuleLibrary): WrapModuleResult {
  const ports = canonicalPorts(input.ports);
  const hash = hashModule(ports, input.body);
  const { counts } = computeCosts(input.body, library);
  const costHalfValue = costHalfOf(counts);

  const { net, diagnostics } = compileDesign(input.body, { library });
  const timing = analyzeTiming(net);

  // 模块循环依赖检测（用户封装时最常见的不合法用法）：
  //   非门 = 与非门（输入并接）是允许的（不同门互搭）；但不允许
  //   与非门 = 与门 + 非门 与 与门 = 与非门 + 非门 同时成立（互相引用成环）。
  // 从 body 引用的模块出发 DFS 依赖图，visiting 中再次遇到 = 环。
  const cycle = findDependencyCycle(input.body, library);
  if (cycle && cycle.length > 1) {
    diagnostics.push({
      kind: 'depth-exceeded',
      severity: 'error',
      message: `模块循环依赖：${cycle
        .map((h) => library.get(h)?.name ?? h)
        .join(' → ')}。模块定义不能互相引用（会无限展开），请把循环拆开`,
    });
  }

  const template = ModuleTemplateSchema.parse({
    schemaVersion: 1,
    hash,
    name: input.name,
    version: input.version ?? '1.0',
    stage: input.stage,
    kind: input.kind,
    family: inferFamily(counts),
    ports,
    body: input.body,
    costs: counts,
    costHalf: costHalfValue,
    isSequential: timing.isSequential,
    delayPs: timing.portDelayPs,
    criticalPathPs: timing.criticalPathPs,
    ...(input.note !== undefined ? { note: input.note } : {}),
  });

  if (timing.uncertain) {
    diagnostics.push({
      kind: 'unconnected-pin',
      severity: 'warning',
      message: '时序分析中出现 X/悬空/冲突，端口延迟仅供参考',
    });
  }

  return { template, diagnostics };
}

/** 校验模板内容未被篡改（存档载入时使用） */
export function verifyTemplate(template: ModuleTemplate): boolean {
  return hashModule(template.ports, template.body) === template.hash;
}

/** 从底层元件构成推导逻辑族契约（内容寻址：同样的电路 → 同样的族） */
export function inferFamily(counts: {
  npn: number;
  res: number;
  dio: number;
  cap: number;
  nmos: number;
  pmos: number;
}): LogicFamily {
  if (counts.nmos > 0 || counts.pmos > 0) return 'cmos';
  if (counts.dio > 0 && counts.npn > 0) return 'ttl'; // 二极管 + 三极管：DTL/RTL 混合，按推挽族处理
  if (counts.dio > 0) return 'dtl';
  return 'rtl';
}
