// @vitest-environment jsdom
/** 工具铺（方案 A 保守版）：钱真的能花出去，且只省操作、不代打。 */

import { describe, expect, it } from 'vitest';
import { buyEquipment, EQUIPMENT, ownsEquipment, spendableHalf } from '../src/level/equipment';
import { emptyProgress, recordClear } from '../src/level/progress';

describe('工具铺', () => {
  it('设备目录：只有省操作的探针与游标，没有一键测完', () => {
    expect(EQUIPMENT.map((e) => e.id)).toEqual(['probe', 'scope']);
  });

  it('购买会扣可用余额，不能重复买，钱不够会被拒绝', () => {
    // 挣到 10 元（20 半）：一次通关利润 16 半（款项 24 − 材料费 8）+ 手工加 4 半
    let progress = emptyProgress();
    progress = recordClear(progress, 's1-not', 100, 8, 3);
    progress.walletHalf += 4;
    expect(spendableHalf(progress)).toBe(20);

    // 探针 12 元买不起 → 拒绝
    const denied = buyEquipment(progress, 'probe');
    expect(denied.error).toContain('钱不够');
    expect(progress.equipment).toEqual([]);

    // 再挣够钱（同或门一单利润大：款项 111 半 − 材料 32 半）
    progress = recordClear(progress, 's1-and', 100, 8, 3);
    progress = recordClear(progress, 's1-or', 100, 8, 3);
    progress = recordClear(progress, 's1-xnor', 100, 32, 3);
    const bought = buyEquipment(progress, 'probe');
    expect(bought.error).toBeUndefined();
    const after = bought.progress;
    expect(ownsEquipment(after, 'probe')).toBe(true);
    expect(spendableHalf(after)).toBe(spendableHalf(progress) - 24);

    // 重复购买被拒绝
    expect(buyEquipment(after, 'probe').error).toBe('已经买过了');
  });
});
