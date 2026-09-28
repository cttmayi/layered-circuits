import type { PlaceKind, StoredModule, UnitKind } from '../editor/model';

export interface PaletteProps {
  placing: PlaceKind | null;
  onPick: (kind: PlaceKind) => void;
  library: StoredModule[];
}

const UNITS: Array<{ unit: UnitKind; name: string; cost: string; note: string }> = [
  { unit: 'npn', name: '三极管 NPN', cost: '2', note: '基极高电平导通，双向通路' },
  { unit: 'res', name: '电阻', cost: '1', note: '弱驱动：永远被强驱动压过' },
  { unit: 'dio', name: '二极管', cost: '1.5', note: '单向导通 + 逻辑隔离' },
  { unit: 'cap', name: '电容', cost: '3', note: '只计入成本，不参与逻辑仿真' },
];

/** 左侧元件库：4 种基础元件 + 电源/端口 + 玩家封装出来的模块 */
export function Palette({ placing, onPick, library }: PaletteProps): React.JSX.Element {
  const isArmed = (kind: string, extra?: string): boolean => {
    if (!placing) return false;
    if (placing.kind !== kind) return false;
    if (extra === undefined) return true;
    if (placing.kind === 'unit') return placing.unit === extra;
    if (placing.kind === 'module') return placing.hash === extra;
    return true;
  };

  const pick = (kind: string, unit?: UnitKind, hash?: string): void => {
    if (kind === 'unit' && unit) onPick({ kind: 'unit', unit });
    else if (kind === 'module' && hash) onPick({ kind: 'module', hash });
    else if (kind === 'vcc' || kind === 'gnd' || kind === 'input' || kind === 'output')
      onPick({ kind });
  };

  return (
    <aside className="palette">
      <h3>基础元件</h3>
      {UNITS.map((item) => (
        <button
          key={item.unit}
          type="button"
          className={isArmed('unit', item.unit) ? 'palette-item active' : 'palette-item'}
          onClick={() => pick('unit', item.unit)}
        >
          <span className="palette-name">{item.name}</span>
          <span className="palette-cost">成本 {item.cost}</span>
          <span className="palette-note">{item.note}</span>
        </button>
      ))}

      <h3>电源与端口</h3>
      {(
        [
          ['vcc', 'VCC 电源', '免费端口'],
          ['gnd', 'GND 地', '免费端口'],
          ['input', '输入引脚', '可点击切换电平'],
          ['output', '输出引脚', '显示实时电平'],
        ] as Array<[string, string, string]>
      ).map(([kind, name, note]) => (
        <button
          key={kind}
          type="button"
          className={isArmed(kind) ? 'palette-item active' : 'palette-item'}
          onClick={() => pick(kind)}
        >
          <span className="palette-name">{name}</span>
          <span className="palette-note">{note}</span>
        </button>
      ))}

      <h3>我的模块（{library.length}）</h3>
      {library.length === 0 && (
        <p className="palette-empty">
          搭好电路后点「封装为模块」，就能像元件一样复用，成本会自动递归累加。
        </p>
      )}
      {library.map((mod) => (
        <button
          key={mod.hash}
          type="button"
          className={isArmed('module', mod.hash) ? 'palette-item active' : 'palette-item'}
          onClick={() => pick('module', undefined, mod.hash)}
          title={`哈希 #${mod.hash}`}
        >
          <span className="palette-name">
            {mod.name} {mod.isSequential && <em>时序</em>}
          </span>
          <span className="palette-cost">成本 {mod.costHalf / 2}</span>
          <span className="palette-note">
            {mod.ports.filter((p) => p.dir === 'in').length} 入 /{' '}
            {mod.ports.filter((p) => p.dir === 'out').length} 出 · #{mod.hash.slice(0, 6)}
          </span>
        </button>
      ))}
    </aside>
  );
}
