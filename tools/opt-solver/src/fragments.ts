/**
 * 基础门级片段（骨架空间的「零件」）。
 *
 * 每个片段都是本作里真实可搭的最小结构，写成代码而不是数据：
 *  - 端口名里的 net 由求解器在组装时分配，片段内部自建中间节点（用 prefix 保证唯一）；
 *  - 成本不在这里硬编码，而是组装后由 `computeCosts` 真算（避免两套账）。
 *
 * 注意：判定强制「三极管基极回路必须有限流电阻」（真实电路 b-e 只有约 0.7V，
 * 强信号直怼基极会过流；基极直连输入会被打回），所以这里**不**再枚举
 * 省略基极限流电阻的片段（旧 notNoBaseResistor 的「更省解」非门 8→6、同或门
 * 56→54 在现行规则下都搭不出来）。
 */

import type { DesignBuilder, Unit } from '@lc/schema';

export interface FragmentContext {
  /** 片段的输入网络（数量 = arity） */
  inputs: string[];
  /** 片段的输出网络 */
  out: string;
  /** 内部节点名前缀（保证同一电路里多个同型片段不撞名） */
  prefix: string;
  has(label: string): boolean;
}

export interface Fragment {
  id: string;
  name: string;
  arity: 1 | 2;
  /** 用到的基础元件种类（求解器据此遵守关卡的 allowedUnits 约束） */
  units: readonly Unit[];
  /** 片段实例化：把 inputs 接到 out */
  build(b: DesignBuilder, ctx: FragmentContext): void;
}

function internal(ctx: FragmentContext, name: string): string {
  return `${ctx.prefix}_${name}`;
}

/** 单管共射反相器：输出高为弱 1（成本 4） */
export const notCommonEmitter: Fragment = {
  id: 'not-ce',
  units: ['npn', 'res'],
  name: '单管共射反相器',
  arity: 1,
  build(b, ctx) {
    const [a] = ctx.inputs as [string];
    b.unit('res', { a, b: internal(ctx, 'b') }, `${ctx.prefix}R1`);
    b.unit('npn', { c: ctx.out, b: internal(ctx, 'b'), e: 'gnd' }, `${ctx.prefix}Q1`);
    b.unit('res', { a: 'vcc', b: ctx.out }, `${ctx.prefix}R2`);
  },
};

/** 反相器 + 射极跟随器：输出强 1，级联更稳（成本 7） */
export const notFollower: Fragment = {
  id: 'not-follower',
  units: ['npn', 'res'],
  name: '反相器+射极跟随器',
  arity: 1,
  build(b, ctx) {
    notCommonEmitter.build(b, { ...ctx, out: internal(ctx, 'x') });
    b.unit('npn', { c: 'vcc', b: internal(ctx, 'x'), e: ctx.out }, `${ctx.prefix}QF`);
  },
};

/** 二极管与门（成本 4） */
export const andDiode: Fragment = {
  id: 'and-diode',
  units: ['dio', 'res'],
  name: '二极管与门',
  arity: 2,
  build(b, ctx) {
    const [a, c] = ctx.inputs as [string, string];
    b.unit('res', { a: 'vcc', b: ctx.out }, `${ctx.prefix}R1`);
    b.unit('dio', { a: ctx.out, k: a }, `${ctx.prefix}D1`);
    b.unit('dio', { a: ctx.out, k: c }, `${ctx.prefix}D2`);
  },
};

/** 二极管或门（成本 4） */
export const orDiode: Fragment = {
  id: 'or-diode',
  units: ['dio', 'res'],
  name: '二极管或门',
  arity: 2,
  build(b, ctx) {
    const [a, c] = ctx.inputs as [string, string];
    b.unit('res', { a: ctx.out, b: 'gnd' }, `${ctx.prefix}R1`);
    b.unit('dio', { a, k: ctx.out }, `${ctx.prefix}D1`);
    b.unit('dio', { a: c, k: ctx.out }, `${ctx.prefix}D2`);
  },
};

/** RTL 与非门：两个三极管串联下拉（成本 7） */
export const nandRtl: Fragment = {
  id: 'nand-rtl',
  units: ['npn', 'res'],
  name: 'RTL 与非门（串联下拉）',
  arity: 2,
  build(b, ctx) {
    const [a, c] = ctx.inputs as [string, string];
    b.unit('res', { a, b: internal(ctx, 'b1') }, `${ctx.prefix}R1`);
    b.unit('res', { a: c, b: internal(ctx, 'b2') }, `${ctx.prefix}R2`);
    b.unit('npn', { c: ctx.out, b: internal(ctx, 'b1'), e: internal(ctx, 'm') }, `${ctx.prefix}Q1`);
    b.unit('npn', { c: internal(ctx, 'm'), b: internal(ctx, 'b2'), e: 'gnd' }, `${ctx.prefix}Q2`);
    b.unit('res', { a: 'vcc', b: ctx.out }, `${ctx.prefix}R3`);
  },
};

/** RTL 或非门：两个三极管并联下拉（成本 7，比「二极管或 + 反相」更省） */
export const norRtlParallel: Fragment = {
  id: 'nor-rtl-parallel',
  units: ['npn', 'res'],
  name: 'RTL 或非门（并联下拉）',
  arity: 2,
  build(b, ctx) {
    const [a, c] = ctx.inputs as [string, string];
    b.unit('res', { a, b: internal(ctx, 'b1') }, `${ctx.prefix}R1`);
    b.unit('res', { a: c, b: internal(ctx, 'b2') }, `${ctx.prefix}R2`);
    b.unit('npn', { c: ctx.out, b: internal(ctx, 'b1'), e: 'gnd' }, `${ctx.prefix}Q1`);
    b.unit('npn', { c: ctx.out, b: internal(ctx, 'b2'), e: 'gnd' }, `${ctx.prefix}Q2`);
    b.unit('res', { a: 'vcc', b: ctx.out }, `${ctx.prefix}R3`);
  },
};

/** 或非门：二极管或门 + 单管反相器（成本 8） */
export const norDiodeCommonEmitter: Fragment = {
  id: 'nor-diode-ce',
  units: ['npn', 'res', 'dio'],
  name: '二极管或门+反相器',
  arity: 2,
  build(b, ctx) {
    const [a, c] = ctx.inputs as [string, string];
    const o = internal(ctx, 'o');
    b.unit('res', { a: o, b: 'gnd' }, `${ctx.prefix}R1`);
    b.unit('dio', { a, k: o }, `${ctx.prefix}D1`);
    b.unit('dio', { a: c, k: o }, `${ctx.prefix}D2`);
    b.unit('res', { a: o, b: internal(ctx, 'b1') }, `${ctx.prefix}R2`);
    b.unit('npn', { c: ctx.out, b: internal(ctx, 'b1'), e: 'gnd' }, `${ctx.prefix}Q1`);
    b.unit('res', { a: 'vcc', b: ctx.out }, `${ctx.prefix}R3`);
  },
};

/** 线与：两个三极管串成共基结构，用于「与」逻辑（成本 6）—— 探索性片段 */
export const andRtlSeries: Fragment = {
  id: 'and-rtl-starved',
  units: ['npn', 'res'],
  name: '串联通路的与（弱 1 输出）',
  arity: 2,
  build(b, ctx) {
    const [a, c] = ctx.inputs as [string, string];
    b.unit('res', { a, b: internal(ctx, 'b1') }, `${ctx.prefix}R1`);
    b.unit('res', { a: c, b: internal(ctx, 'b2') }, `${ctx.prefix}R2`);
    b.unit('npn', { c: 'vcc', b: internal(ctx, 'b1'), e: internal(ctx, 'm') }, `${ctx.prefix}Q1`);
    b.unit('npn', { c: internal(ctx, 'm'), b: internal(ctx, 'b2'), e: ctx.out }, `${ctx.prefix}Q2`);
    b.unit('res', { a: ctx.out, b: 'gnd' }, `${ctx.prefix}R3`);
  },
};

export const BASE_FRAGMENTS: readonly Fragment[] = [
  notCommonEmitter,
  notFollower,
  andDiode,
  orDiode,
  nandRtl,
  norRtlParallel,
  norDiodeCommonEmitter,
  andRtlSeries,
];
