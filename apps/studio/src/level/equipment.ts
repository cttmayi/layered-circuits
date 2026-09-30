/**
 * 工具铺：钱包的第一个真正花销 —— 买实验设备。
 *
 * 保守版（只卖「省操作」，不卖「代打」）：
 *  - 测试探针：画布上点任意连线，钉一个电平+强度读数（调试用）；
 *  - 示波器游标：波形面板里点两个时间点，直接读出 Δt（延迟测量）。
 */

import type { Progress, ReconState } from './progress';

export interface Equipment {
  id: string;
  title: string;
  /** 价格（半单位口径，1 元 = 2） */
  priceHalf: number;
  note: string;
}

export const EQUIPMENT: Equipment[] = [
  {
    id: 'probe',
    title: '测试探针',
    priceHalf: 24,
    note: '画布上点任意连线，钉一个电平+强度读数（调试神器）。',
  },
  { id: 'scope', title: '示波器游标', priceHalf: 60, note: '波形面板点两个时间点，直接读出 Δt。' },
];

export function equipmentOf(id: string): Equipment | undefined {
  return EQUIPMENT.find((item) => item.id === id);
}

export function ownsEquipment(progress: Progress, id: string): boolean {
  return progress.equipment.includes(id);
}

/** 可用余额 = 挣到的钱 − 已经花掉的（钱包本身是毛收入，用于称号） */
export function spendableHalf(progress: Progress): number {
  return progress.walletHalf - progress.spentHalf;
}

export function buyEquipment(
  progress: Progress,
  id: string,
): { progress: Progress; error?: string } {
  const item = equipmentOf(id);
  if (!item) return { progress, error: '没有这件设备' };
  if (ownsEquipment(progress, id)) return { progress, error: '已经买过了' };
  if (spendableHalf(progress) < item.priceHalf) {
    return {
      progress,
      error: `钱不够：探针要 ${item.priceHalf / 2} 元，还差 ${(item.priceHalf - spendableHalf(progress)) / 2} 元`,
    };
  }
  return {
    progress: {
      ...progress,
      equipment: [...progress.equipment, id],
      spentHalf: progress.spentHalf + item.priceHalf,
    },
  };
}

export type { ReconState };
