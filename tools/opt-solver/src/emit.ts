/**
 * 把关目录搜索出来的构造树组装成一份真正的 Design，并用**真实判定**复核。
 *
 * 复核这一步不能省：成本模型只看「门成本之和」，不看驱动能力。
 * 例如「二极管或门 → 二极管与门」级联在成本上很便宜，但弱 1 一级级衰减下去可能根本不对。
 * 所以最终结论永远是「**通过真仿真的最省电路**」，而不是成本模型的想当然。
 */

import { compileDesign, computeCosts, judgeDesign } from '@lc/compiler';
import {
  costHalfOf,
  type Design,
  DesignBuilder,
  type InMemoryModuleLibrary,
  type Level,
} from '@lc/schema';
import type { Build, Plan } from './search.js';

export interface EmitOptions {
  id: string;
  name: string;
  /** 关卡输入端口名（构造树里的 a / b 落到这两个端口） */
  inputNames: string[];
  outputName: string;
}

/** 把构造树展开成电路：同一棵子树只建一次（共享网络 = 天然扇出） */
export function emitDesign(plan: Plan, options: EmitOptions): Design {
  const b = new DesignBuilder(options.id, options.name);
  b.vcc('vcc');
  b.gnd('gnd');
  for (const name of options.inputNames) b.port(name, 'in', name);

  let counter = 0;
  const memo = new Map<Build, string>();
  const netOf = (build: Build): string => {
    const cached = memo.get(build);
    if (cached !== undefined) return cached;
    if (build.kind === 'input') {
      const net = (options.inputNames[build.port === 'a' ? 0 : 1] ??
        options.inputNames[0]) as string;
      memo.set(build, net);
      return net;
    }
    if (build.kind === 'const') {
      const net = `k${++counter}`;
      if (build.value === 1) b.vcc(net);
      else b.gnd(net);
      memo.set(build, net);
      return net;
    }
    const inputs = build.args.map(netOf);
    counter++;
    const out = `g${counter}`;
    build.gate.instantiate(b, inputs, out, `u${counter}`);
    memo.set(build, out);
    return out;
  };

  const finalNet = netOf(plan.build);
  const base = b.build();
  const nets = base.nets.some((n) => n.id === finalNet)
    ? base.nets
    : [...base.nets, { id: finalNet, pins: [] }];
  return {
    ...base,
    nets,
    ports: [
      ...base.ports,
      { id: options.outputName, name: options.outputName, dir: 'out', width: 1, nets: [finalNet] },
    ],
  };
}

export interface VerifiedPlan {
  plan: Plan;
  design: Design;
  pass: boolean;
  costHalf: number;
  /** 实际编译出来的成本（可能高于成本模型，比如模块展开） */
  measuredHalf: number;
  errors: string[];
}

/** 用关卡的真实判定复核一份构造（功能 + 成本 + 硬核时序） */
export function verifyPlan(
  plan: Plan,
  level: Level,
  library: InMemoryModuleLibrary,
  options: Pick<EmitOptions, 'inputNames' | 'outputName'>,
): VerifiedPlan {
  const design = emitDesign(plan, {
    id: `solved-${level.id}`,
    name: `${level.title}（求解器）`,
    ...options,
  });
  const result = judgeDesign(design, level, { library, hardcore: true });
  let measuredHalf = result.costHalf;
  try {
    const { net, diagnostics } = compileDesign(design, { library });
    if (!diagnostics.some((d) => d.severity === 'error') && net.elemCount > 0) {
      measuredHalf = costHalfOf(computeCosts(design, library).counts);
    }
  } catch {
    // 编译不了就用判定里的成本
  }
  return {
    plan,
    design,
    pass: result.pass,
    costHalf: result.costHalf,
    measuredHalf,
    errors: [...result.errors],
  };
}
