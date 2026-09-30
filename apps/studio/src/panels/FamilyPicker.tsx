/**
 * 新游戏 · 逻辑族契约选择（决策 2：新游戏时固定契约）。
 *
 * 真实工业界每个逻辑族（RTL/DTL/TTL/CMOS）都有自己的输入要求 / 输出保证规范，
 * 同一族内部互连可靠。玩家在这里选定「工艺契约」，整个存档固定：
 * - 契约决定工作台默认元件集；
 * - 契约决定输出强度规范（推挽 = 高低都强；RTL 风格 = 高弱 1）；
 * - 生成的模块会标注所属契约，方便识别兼容性；
 * - 关卡判定按契约硬约束检查。
 */

import type { LogicFamily } from '@lc/schema';
import { FAMILIES, FAMILY_CONTRACTS } from '@lc/schema';
import { useState } from 'react';

export interface FamilyPickerProps {
  onSelect: (family: LogicFamily) => void;
  onCancel: () => void;
}

export function FamilyPicker({ onSelect, onCancel }: FamilyPickerProps): React.JSX.Element {
  const [chosen, setChosen] = useState<LogicFamily>('cmos');

  return (
    <div className="screen screen-menu">
      <div className="menu-card family-picker">
        <div className="menu-brand">
          <h1>选择工艺契约</h1>
          <p className="menu-tagline">
            你选哪个逻辑族，就遵守哪个族的规范——输入输出从此有标准，多门级联不再打架。
          </p>
        </div>
        <div className="family-grid">
          {FAMILIES.map((id) => {
            const c = FAMILY_CONTRACTS[id];
            const active = chosen === id;
            return (
              <button
                type="button"
                key={id}
                className={`family-card${active ? ' active' : ''}`}
                onClick={() => setChosen(id)}
              >
                <div className="family-name">{c.name}</div>
                <div className="family-blurb">{c.blurb}</div>
                <ul className="family-points">
                  {c.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
        <div className="family-actions">
          <button type="button" className="menu-btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="menu-btn primary" onClick={() => onSelect(chosen)}>
            用 {FAMILY_CONTRACTS[chosen].name} 开始
          </button>
        </div>
      </div>
    </div>
  );
}
