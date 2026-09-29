/**
 * 总线显示：把「逐位 lane 键」（a[0]..a[3]）拼成端口数值（小端：第 i 位 = 2^i），
 * 单 bit 端口保持原样。真值表 / 判定结果表都用它，第三章加法器直接显示 3+5=8。
 */

export type BusValue = 0 | 1 | 2 | 3 | 'X' | 'Z' | string | number;

export interface BusColumn {
  /** 端口名（a / y / cout…） */
  name: string;
  /** 位宽：>1 = 总线 */
  width: number;
}

/** 把一行 {a[0]:1, a[1]:0, a[2]:1, a[3]:0, cout:1} 按端口分组显示 */
export function groupBusRow(
  rec: Record<string, BusValue>,
  columns: readonly BusColumn[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of columns) {
    if (col.width > 1) {
      let value = 0;
      let valid = true;
      for (let bit = 0; bit < col.width; bit++) {
        const v = rec[`${col.name}[${bit}]`];
        if (v === 1) value |= 1 << bit;
        else if (v !== 0) {
          valid = false;
          break;
        }
      }
      out[col.name] = valid ? String(value) : 'X';
    } else {
      out[col.name] = String(rec[col.name] ?? '?');
    }
  }
  return out;
}

/**
 * 从一行数据推导端口列（含位宽）：键名 a[i] → 端口 a 宽度 = max(i)+1；纯名 → 1 位。
 * 顺序按首次出现；输出列由调用方传入顺序更可控，此函数主要服务输入端。
 */
export function columnsFromKeys(rec: Record<string, BusValue> | undefined): BusColumn[] {
  if (!rec) return [];
  const byName = new Map<string, number>();
  const order: string[] = [];
  for (const key of Object.keys(rec)) {
    const m = /^(.*)\[(\d+)\]$/.exec(key);
    const base = m ? (m[1] as string) : key;
    const idx = m ? Number(m[2]) : 0;
    if (!byName.has(base)) {
      byName.set(base, 0);
      order.push(base);
    }
    byName.set(base, Math.max(byName.get(base) as number, idx + 1));
  }
  return order.map((name) => ({ name, width: byName.get(name) as number }));
}

/** 端口名显示：宽度 >1 时加 [N-1:0] 后缀 */
export function portLabel(name: string, width: number): string {
  return width > 1 ? `${name}[${width - 1}:0]` : name;
}
