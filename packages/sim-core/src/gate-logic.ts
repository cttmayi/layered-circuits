/**
 * 逻辑版的门级求值核心 —— **7 个基础门是原子，没有「强/弱」**。
 *
 * 为什么单独一层：逻辑版（第 8 关起 20 关的判定口径）此前仍然把画布上的门展开成
 * NPN / RES / DIO 去算，还带着强/弱驱动那一套（强压弱、同强度冲突判 X）。那条路算的是
 * "真实电路的电气行为"，在逻辑版里是多余复杂度 —— s3-calc 展开后有 6191 个元件。
 *
 * 这一层的规矩：
 *  - 值域只有 4 个：0 / 1 / X（不确定）/ Z（悬空）；**没有强度、没有优先级**；
 *  - 7 个基础门直接按真值函数算，**不再往下钻到元件**；
 *  - 复合模块 = 门之间的连线（由调用方按 Design.nets 连起来，见 docs/design-gates.md）；
 *  - 多驱动冲突（0 撞 1）→ X，不比强弱；
 *  - 时序器件（锁存器 / DFF / 寄存器）在无延迟下是代数环，必须由调用方用
 *    「状态 + 时钟沿」模型处理 —— 本文件只管组合门。
 *
 * 逻辑是 Kleene 三值（+ Z）：AND 遇到 0 就是 0（另一个输入是 X 也不影响），OR 遇到 1 就是 1。
 * 这与时序版在电路稳定后的结论一致，也正是"逻辑版只判逻辑"该有的口径。
 */

/** 逻辑版的 4 个值：0 / 1 / X（不确定）/ Z（悬空，没有驱动） */
export type Bit = 0 | 1 | 'X' | 'Z';

export const B0: Bit = 0;
export const B1: Bit = 1;
export const BX: Bit = 'X';
export const BZ: Bit = 'Z';

/** 门输入上的 Z 当 X 处理：悬空的输入决定不了结果 */
export const asValue = (b: Bit): Bit => (b === 'Z' ? 'X' : b);

export const notBit = (a: Bit): Bit => {
  const x = asValue(a);
  return x === 'X' ? 'X' : x === 1 ? 0 : 1;
};

export const andBit = (a: Bit, b: Bit): Bit => {
  const x = asValue(a);
  const y = asValue(b);
  if (x === 0 || y === 0) return 0;
  if (x === 'X' || y === 'X') return 'X';
  return 1;
};

export const orBit = (a: Bit, b: Bit): Bit => {
  const x = asValue(a);
  const y = asValue(b);
  if (x === 1 || y === 1) return 1;
  if (x === 'X' || y === 'X') return 'X';
  return 0;
};

export const xorBit = (a: Bit, b: Bit): Bit => {
  const x = asValue(a);
  const y = asValue(b);
  if (x === 'X' || y === 'X') return 'X';
  return x === y ? 0 : 1;
};

/**
 * 同一节点上多个驱动的合并 —— **不比强弱**：
 *  - 所有驱动一致 → 该值；
 *  - 0 与 1 撞上 → X（没有"强驱动压过弱驱动"这回事）；
 *  - 有 X → X；
 *  - 没有任何驱动 → Z。
 */
export const mergeDrivers = (values: readonly Bit[]): Bit => {
  if (values.length === 0) return 'Z';
  let acc: Bit = 'Z';
  for (const v of values) {
    if (v === 'Z') continue;
    if (acc === 'Z') {
      acc = v;
      continue;
    }
    if (acc !== v) return 'X';
  }
  return acc; // 全是 Z 时仍是 Z（悬空）
};

/** 逻辑版认的 7 个基础门（与 content 的 BASIC_GATES 一致） */
export const GATE_NAMES = ['非门', '与非门', '或非门', '与门', '或门', '异或门', '同或门'] as const;
export type GateName = (typeof GATE_NAMES)[number];

const GATE_SET: ReadonlySet<string> = new Set(GATE_NAMES);

export const isGateName = (name: string): name is GateName => GATE_SET.has(name);

/**
 * 求一个基础门的值。输入个数不足时按 X 补齐（悬空端口），多输入按逐对折叠
 * （与门/或门支持 3 个以上输入，对应内容里的「多输入或门」）。
 */
export const evalGate = (name: GateName, inputs: readonly Bit[]): Bit => {
  const arity = name === '非门' ? 1 : 2;
  const pad = (i: number): Bit => inputs[i] ?? 'X';
  const fold = (f: (a: Bit, b: Bit) => Bit): Bit => {
    let acc = pad(0);
    for (let i = 1; i < Math.max(inputs.length, arity); i++) acc = f(acc, pad(i));
    return acc;
  };
  switch (name) {
    case '非门':
      return notBit(pad(0));
    case '与非门':
      return notBit(andBit(pad(0), pad(1)));
    case '或非门':
      return notBit(orBit(pad(0), pad(1)));
    case '与门':
      return fold(andBit);
    case '或门':
      return fold(orBit);
    case '异或门':
      return fold(xorBit);
    case '同或门':
      return notBit(fold(xorBit));
  }
};

/** 把 Bit 转成调试/断言用的字符 */
export const bitToText = (b: Bit): string => (b === 'X' ? 'X' : b === 'Z' ? 'Z' : String(b));
