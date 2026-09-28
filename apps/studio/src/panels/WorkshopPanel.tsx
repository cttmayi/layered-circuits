/**
 * 工具铺：花钱包里的钱买实验设备（省操作，不代打）。
 */

import { EQUIPMENT, spendableHalf } from '../level/equipment';
import type { Progress } from '../level/progress';

export interface WorkshopPanelProps {
  progress: Progress;
  onBuy: (id: string) => void;
}

export function WorkshopPanel({ progress, onBuy }: WorkshopPanelProps): React.JSX.Element {
  const budget = spendableHalf(progress);
  return (
    <section className="panel workshop">
      <h3>工具铺</h3>
      <p className="panel-note">可用余额 {budget / 2} 元（钱包 = 毛收入，买东西会花掉它）</p>
      <ul className="equip-list">
        {EQUIPMENT.map((item) => {
          const owned = progress.equipment.includes(item.id);
          const afford = budget >= item.priceHalf;
          return (
            <li key={item.id} className={`equip ${owned ? 'owned' : ''}`}>
              <div className="equip-head">
                <span>{item.title}</span>
                <em>{owned ? '已装备' : `${item.priceHalf / 2} 元`}</em>
              </div>
              <p className="equip-note">{item.note}</p>
              <button
                type="button"
                disabled={owned || !afford}
                title={
                  owned ? '已经买过了' : afford ? '' : `还差 ${(item.priceHalf - budget) / 2} 元`
                }
                onClick={() => onBuy(item.id)}
              >
                {owned ? '✓' : '购买'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
