/**
 * 模块自测：把模块的身体当电路跑一遍组合真值表，看输出会不会随输入变。
 *
 * 为什么需要它：模块是可以自己封装的，界面完全不知道"非门"这个名字底下接的是什么。
 * 玩家把输入/输出接错、或者上拉接到地，封装出来的模块照样能放回画布 —— 编译合法、
 * 判定只表现为"结果不对"，而画布上那个模块看起来毫无异常（曾经有玩家因此以为游戏有 BUG）。
 * 这里直接跑给对方看：输入变、输出不变 → 这个模块不是你以为的功能。
 */

import type { ModuleTemplate } from '@lc/schema';
import type { StoredModule } from '../editor/model';
import { handleRequest } from './handle';
import type { DriveValue } from './protocol';

export interface ProbeRow {
  /** 输入端口名（多 bit 用 名字[位]）→ 取值 */
  inputs: Record<string, number>;
  /** 输出端口名（多 bit 用 名字[位]）→ 电平文字，如「0·强」/「Z（悬空）」 */
  outputs: Record<string, string>;
}

export interface ProbeResult {
  rows: ProbeRow[];
  /** 输入变了、但它一直不动的输出端口（多 bit 记 名字[位]） */
  stuck: string[];
  /** 没做自测的原因；null = 做过 */
  skipped: string | null;
  error?: string;
}

/** 组合自测的输入位上限：2^n 行真值表，超过就不跑（模块内部元件会爆） */
const MAX_INPUT_BITS = 4;

/**
 * 电平文字。逻辑关（`showStrength: false`，第 8 关起）只给 `1` / `0`：
 * 那里判定是零延迟布尔口径，`0·强` 这种后缀是噪音（用户第 ⑭ 轮）。
 * 悬空 / 冲突照旧保留（那是状态，不是强度描述）；时序关与自由模式一个字不改。
 */
function textOf(signal: number | undefined, showStrength: boolean): string {
  if (signal === undefined) return '—';
  if (signal === 0) return 'Z（悬空）';
  const value = ['0', '1', 'X（冲突）'][signal & 3] ?? '?';
  if (!showStrength) return value;
  const strength = ['', '·弱', '·强', '·供电'][signal >> 2] ?? '';
  return `${value}${strength}`;
}

/** 模块输入端口的逐位键名（与编译器命名一致：单 bit 用端口名，多 bit 用 名字[位]） */
function inputBits(template: ModuleTemplate): Array<{ key: string; port: string; bit: number }> {
  const out: Array<{ key: string; port: string; bit: number }> = [];
  for (const port of template.ports) {
    if (port.dir !== 'in') continue;
    for (let bit = 0; bit < port.width; bit++) {
      out.push({ key: port.width > 1 ? `${port.name}[${bit}]` : port.name, port: port.name, bit });
    }
  }
  return out;
}

export function probeModule(
  template: ModuleTemplate,
  library: StoredModule[],
  options: { showStrength?: boolean } = {},
): ProbeResult {
  const showStrength = options.showStrength !== false;
  const bits = inputBits(template);
  // 输出端口的「网」在身体（body）的端口表上 —— 模板自己的端口表只有名字/方向/位宽
  const outPorts = template.body.ports.filter((p) => p.dir === 'out');
  const empty: ProbeResult = { rows: [], stuck: [], skipped: null };
  if (outPorts.length === 0) return { ...empty, skipped: '这个模块没有输出端口' };
  if (bits.length === 0) return { ...empty, skipped: '这个模块没有输入端口' };
  if (bits.length > MAX_INPUT_BITS) {
    return {
      ...empty,
      skipped: `输入有 ${bits.length} 位（超过 ${MAX_INPUT_BITS} 位），不做组合自测`,
    };
  }
  if (template.isSequential) {
    return { ...empty, skipped: '时序模块（有记忆），它的输出不只看当前输入，不做组合自测' };
  }

  const lib = library
    .map((m) => m.template)
    .filter((t): t is ModuleTemplate => Boolean(t)) as unknown[];
  const rows: ProbeRow[] = [];
  const seen = new Map<string, Set<string>>();
  for (let combo = 0; combo < 1 << bits.length; combo++) {
    const inputs: Record<string, DriveValue> = {};
    const shown: Record<string, number> = {};
    bits.forEach((b, i) => {
      const value = (combo >> i) & 1;
      inputs[b.key] = value as DriveValue;
      shown[b.key] = value;
    });
    const resp = handleRequest({
      id: combo,
      type: 'simulate',
      design: template.body,
      library: [...lib, template],
      mode: 'logic',
      inputs,
      buttonPorts: [],
      // 与画布**同口径**（有延迟门级；含元件/缺 SeqSpec 的设计由引擎侧原样回落元件引擎），
      // 否则"画布上看起来正常 / 自测说不通"又会变成两套读数打架。
      // `gateFresh`：逐行独立的组合真值表，上一行的内部状态不能漏进下一行。
      gateCanvas: true,
      gateFresh: true,
    });
    if (resp.error || !resp.snapshot) return { ...empty, error: resp.error ?? '仿真没有返回结果' };
    const signals = new Map(resp.snapshot.netSignals);
    const outputs: Record<string, string> = {};
    for (const port of outPorts) {
      const width = port.width;
      for (let bit = 0; bit < width; bit++) {
        const label = width > 1 ? `${port.name}[${bit}]` : port.name;
        const text = textOf(signals.get(port.nets[bit] ?? ''), showStrength);
        outputs[label] = text;
        const set = seen.get(label) ?? new Set<string>();
        set.add(text);
        seen.set(label, set);
      }
    }
    rows.push({ inputs: shown, outputs });
  }
  const stuck = [...seen.entries()].filter(([, set]) => set.size === 1).map(([label]) => label);
  return { rows, stuck, skipped: null };
}
