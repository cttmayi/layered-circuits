/**
 * 编译器：原理图 Design → sim-core 扁平网表 FlatNet。
 *
 * 职责：
 * 1. 递归展开模块实例（含总线按位展开），把「网络」映射为 IR 节点；
 * 2. 基础元件 → NPN/RES/DIO/CAP 元素，电源轨 → POWER，顶层端口 → INPUT/OUTPUT；
 * 3. 产出编译诊断：引脚未连接、位宽不足、模块缺失、深度/规模超限等。
 *
 * M0 采用「递归展开」策略（关卡电路规模小、语义最直观）；
 * M4 起会切换成「模板编译一次 + 实例化多次」的黑盒执行（Tech-Plan 2.3），
 * 那时本文件产出的仍是同一种 FlatNet，只是元素来源换成模板实例。
 */

import { BASE_PINS, type Design, type ModuleLibrary, UNIT_DELAY_PS, type Unit } from '@lc/schema';
import { ElementKind, type FlatNet, FlatNetAssembler } from '@lc/sim-core';

export type CompileDiagnosticKind =
  | 'unconnected-pin'
  | 'unknown-module'
  | 'port-unbound'
  | 'depth-exceeded'
  | 'size-exceeded'
  | 'duplicate-instance'
  | 'width-mismatch';

export interface CompileDiagnostic {
  kind: CompileDiagnosticKind;
  /** info = 提示（不接也不影响过关，如未连接的引脚）；warning/error = 需要处理 */
  severity: 'error' | 'warning' | 'info';
  message: string;
  instanceId?: string;
}

export interface CompileOptions {
  library: ModuleLibrary;
  /** 最大模块嵌套深度 */
  maxDepth?: number;
  /** 最大展开元素数（安全阀，防止误接成爆炸电路） */
  maxElements?: number;
}

export interface CompileResult {
  net: FlatNet;
  diagnostics: CompileDiagnostic[];
  /** 顶层网络的网表节点编号（nodeIndex → 网 id），编辑器用它把节点电平映射回连线 */
  netIds: string[];
}

const UNIT_ELEMENT_KIND: Record<Unit, number> = {
  npn: ElementKind.NPN,
  res: ElementKind.RES,
  dio: ElementKind.DIO,
  cap: ElementKind.CAP,
  nmos: ElementKind.NMOS,
  pmos: ElementKind.PMOS,
};

function pinKey(inst: string, pin: string, bit: number): string {
  return `${inst}\u0000${pin}\u0000${bit}`;
}

export function compileDesign(design: Design, options: CompileOptions): CompileResult {
  const library = options.library;
  const maxDepth = options.maxDepth ?? 32;
  const maxElements = options.maxElements ?? 500_000;

  const asm = new FlatNetAssembler();
  const diagnostics: CompileDiagnostic[] = [];
  let aborted = false;

  const note = (d: CompileDiagnostic): void => {
    if (diagnostics.length < 200) diagnostics.push(d);
  };

  /** 建立「实例引脚位 → netId」索引 */
  const buildPinIndex = (d: Design): Map<string, string> => {
    const index = new Map<string, string>();
    for (const net of d.nets) {
      for (const ref of net.pins) index.set(pinKey(ref.inst, ref.pin, ref.bit ?? 0), net.id);
    }
    return index;
  };

  const flatten = (
    d: Design,
    path: string,
    outerBinding: Map<string, number[]> | null,
  ): Map<string, number> => {
    const pinIndex = buildPinIndex(d);
    const netNode = new Map<string, number>();
    const seenInstances = new Set<string>();

    const nodeForNet = (netId: string): number => {
      let node = netNode.get(netId);
      if (node === undefined) {
        node = asm.node(`${path}${netId}`);
        netNode.set(netId, node);
      }
      return node;
    };

    const dangling = (name: string): number => asm.node(`${path}${name}:floating`);

    const checkSize = (): void => {
      if (asm.elementCount > maxElements) {
        note({
          kind: 'size-exceeded',
          severity: 'error',
          message: `展开后元素数超过上限 ${maxElements}，编译中止（疑似模块嵌套爆炸）`,
        });
        aborted = true;
      }
    };

    // 1) 端口绑定：内部 net 直接复用外部节点（等价于并查集合并）
    for (const port of d.ports) {
      const outer = outerBinding?.get(port.id);
      for (let bit = 0; bit < port.width; bit++) {
        const netId = port.nets[bit];
        if (!netId) {
          note({
            kind: 'port-unbound',
            severity: 'error',
            message: `端口 ${port.name} 的第 ${bit} 位没有绑定网络`,
          });
          continue;
        }
        const bound = outer?.[bit];
        if (bound !== undefined) netNode.set(netId, bound);
        else nodeForNet(netId);
      }
    }

    // 2) 实例展开
    for (const inst of d.instances) {
      if (aborted) break;
      if (seenInstances.has(inst.id)) {
        note({
          kind: 'duplicate-instance',
          severity: 'error',
          message: `实例 id 重复：${inst.id}`,
          instanceId: inst.id,
        });
        continue;
      }
      seenInstances.add(inst.id);

      switch (inst.kind) {
        case 'unit': {
          const pins = BASE_PINS[inst.unit].map((pinName) => {
            const netId = pinIndex.get(pinKey(inst.id, pinName, 0));
            if (netId === undefined) {
              note({
                kind: 'unconnected-pin',
                // 单元引脚不是都必须接：悬空只影响仿真（显示 X），功能对不对由判定兜底
                severity: 'info',
                message: `基础元件 ${inst.label ?? inst.id} 的引脚「${pinName}」未连接，按悬空处理`,
                instanceId: inst.id,
              });
              return dangling(`${inst.id}.${pinName}`);
            }
            return nodeForNet(netId);
          });
          asm.add(
            UNIT_ELEMENT_KIND[inst.unit],
            pins,
            UNIT_DELAY_PS[inst.unit],
            `${path}${inst.label ?? inst.id}`,
          );
          checkSize();
          break;
        }
        case 'vcc':
        case 'gnd': {
          const netId = pinIndex.get(pinKey(inst.id, 'p', 0));
          const node = netId === undefined ? dangling(`${inst.id}.p`) : nodeForNet(netId);
          asm.add(
            ElementKind.POWER,
            [node],
            0,
            `${path}${inst.kind === 'vcc' ? 'VCC' : 'GND'}`,
            inst.kind === 'vcc' ? 1 : 0,
          );
          checkSize();
          break;
        }
        case 'module': {
          const tpl = library.get(inst.module);
          if (!tpl) {
            note({
              kind: 'unknown-module',
              severity: 'error',
              message: `模块实例 ${inst.label ?? inst.id} 引用的模块不在组件库中：${inst.module}`,
              instanceId: inst.id,
            });
            break;
          }
          const binding = new Map<string, number[]>();
          for (const port of tpl.ports) {
            const nodes: number[] = [];
            for (let bit = 0; bit < port.width; bit++) {
              const netId = pinIndex.get(pinKey(inst.id, port.name, bit));
              if (netId === undefined) {
                note({
                  kind: 'unconnected-pin',
                  // 模块端口同理：用不上的输出/位不接也行，悬空不判失败
                  severity: 'info',
                  message: `模块实例 ${inst.label ?? inst.id} 的端口「${port.name}」第 ${bit} 位未连接，按悬空处理`,
                  instanceId: inst.id,
                });
                nodes.push(dangling(`${inst.id}.${port.name}[${bit}]`));
              } else {
                nodes.push(nodeForNet(netId));
              }
            }
            binding.set(port.id, nodes);
          }
          if (path.split('/').length > maxDepth) {
            note({
              kind: 'depth-exceeded',
              severity: 'error',
              message: `模块嵌套深度超过上限 ${maxDepth}，编译中止`,
              instanceId: inst.id,
            });
            aborted = true;
            break;
          }
          flatten(tpl.body, `${path}${inst.id}/`, binding);
          break;
        }
      }
    }

    return netNode;
  };

  const topNetNode = flatten(design, '', null);

  // 3) 顶层端口 → INPUT / OUTPUT 元素
  for (const port of design.ports) {
    for (let bit = 0; bit < port.width; bit++) {
      const netId = port.nets[bit];
      const node = netId
        ? nodeForNetSafe(topNetNode, asm, netId, port.name)
        : asm.node(`${port.name}[${bit}]:floating`);
      const isSingle = port.width === 1;
      const name = isSingle ? port.name : `${port.name}[${bit}]`;
      const id = isSingle ? port.id : `${port.id}[${bit}]`;
      if (port.dir === 'in') {
        const elem = asm.add(ElementKind.INPUT, [node], 0, name, 3 /* 默认 Z */);
        asm.port({ id, name, dir: 'in', bit, node, elem });
      } else {
        const elem = asm.add(ElementKind.OUTPUT, [node], 0, name);
        asm.port({ id, name, dir: 'out', bit, node, elem });
      }
    }
  }

  // 4) 顶层网 id → 节点编号（编辑器用来把节点电平画回连线上）
  const net = asm.build();
  const netIds = new Array<string>(net.nodeCount).fill('');
  for (const [netId, node] of topNetNode) {
    if (node >= 0 && node < net.nodeCount) netIds[node] = netId;
  }

  return { net, diagnostics, netIds };
}

function nodeForNetSafe(
  netNode: Map<string, number>,
  asm: FlatNetAssembler,
  netId: string,
  portName: string,
): number {
  const existing = netNode.get(netId);
  if (existing !== undefined) return existing;
  const node = asm.node(`${portName}:${netId}`);
  netNode.set(netId, node);
  return node;
}
