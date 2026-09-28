/**
 * 参考解自动综合（SOP：积之和）。
 *
 * 掩码空间的最优搜索只覆盖 1~2 输入；3 输入以上关卡用这里兜底：
 * 按真值表把「输出为 1 的每一行」做成最小项（与项），再 OR 起来。
 * 结论一定**功能正确**，但通常不是最省 —— 所以工具会明确提示制作人手写更优的参考解。
 *
 * **实现选择（踩过的坑）**：二极管门虽然便宜，但它的输出是「弱 1」，
 * 再串一级二极管门时两个弱驱动会打平（电阻平局 → X）。
 * 实测：`二极管与门 → 二极管或门` 级联在「两个最小项」的用例上直接出 X；
 * 换成「与非门 + 反相器」的可恢复实现后 8 组输入全对。
 * 所以 SOP 兜底默认用可恢复实现（implementation = 'restoring'），
 * 便宜的二极管实现只在确定单级、无级联的场合用。
 */

import { andDiode, nandRtl, notCommonEmitter, orDiode } from '@lc/opt-solver';
import { type Design, DesignBuilder, type Unit } from '@lc/schema';

export type SynthImplementation = 'restoring' | 'diode';

export interface SynthOptions {
  id: string;
  name: string;
  inputs: string[];
  outputs: string[];
  /** 真值表：key = 输入组合（'0,1,0'），value = 每个输出端口的值 */
  truth: Record<string, Record<string, 0 | 1>>;
  allowedUnits: readonly Unit[];
  /**
   * 实现方式：'restoring'（默认，与非门 + 反相器，驱动能力可恢复）
   * 或 'diode'（二极管门，便宜但级联会衰减驱动能力）。
   */
  implementation?: SynthImplementation;
}

/** 综合一个多输入多输出的组合电路（SOP） */
export function synthesizeSop(options: SynthOptions): Design {
  const b = new DesignBuilder(options.id, options.name);
  b.vcc('vcc');
  b.gnd('gnd');
  for (const name of options.inputs) b.port(name, 'in', name);

  const useDiodes = options.implementation === 'diode' && options.allowedUnits.includes('dio');
  let counter = 0;
  const freshPrefix = (): string => `u${++counter}`;
  const freshNet = (prefix: string): string => `${prefix}${++counter}`;

  const notOf = (net: string): string => {
    const out = freshNet('n');
    notCommonEmitter.build(b, { inputs: [net], out, prefix: freshPrefix(), has: () => false });
    return out;
  };
  const andOf = (x: string, y: string): string => {
    const out = freshNet('a');
    if (useDiodes) {
      andDiode.build(b, { inputs: [x, y], out, prefix: freshPrefix(), has: () => false });
    } else {
      const nand = freshNet('m');
      nandRtl.build(b, { inputs: [x, y], out: nand, prefix: freshPrefix(), has: () => false });
      notCommonEmitter.build(b, { inputs: [nand], out, prefix: freshPrefix(), has: () => false });
    }
    return out;
  };
  const orOf = (x: string, y: string): string => {
    const out = freshNet('o');
    if (useDiodes) {
      orDiode.build(b, { inputs: [x, y], out, prefix: freshPrefix(), has: () => false });
    } else {
      // 德摩根：a OR b = NOT(NOT a AND NOT b) —— 这里用与非门一次到位
      const notX = notOf(x);
      const notY = notOf(y);
      nandRtl.build(b, { inputs: [notX, notY], out, prefix: freshPrefix(), has: () => false });
    }
    return out;
  };

  for (const output of options.outputs) {
    const ones = Object.entries(options.truth).filter(([, values]) => values[output] === 1);
    const zeros = Object.entries(options.truth).filter(([, values]) => values[output] !== 1);

    if (ones.length === 0) {
      const zero = freshNet('z');
      b.gnd(zero);
      b.port(output, 'out', zero);
      continue;
    }
    if (zeros.length === 0) {
      const one = freshNet('e');
      b.vcc(one);
      b.port(output, 'out', one);
      continue;
    }

    let net: string | null = null;
    for (const [key] of ones) {
      const bits = key.split(',').map((v) => Number.parseInt(v.trim(), 10));
      const literals = options.inputs.map((name, i) => (bits[i] === 1 ? name : notOf(name)));
      let term = literals[0] as string;
      for (const literal of literals.slice(1)) term = andOf(term, literal);
      net = net === null ? term : orOf(net, term);
    }
    b.port(output, 'out', net as string);
  }

  return b.build();
}
