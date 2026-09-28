import type { Level } from '@lc/schema';
import type { PlaceKind, StoredModule, UnitKind } from '../editor/model';

export interface PaletteProps {
  placing: PlaceKind | null;
  onPick: (kind: PlaceKind) => void;
  library: StoredModule[];
  /** 关卡素材约束：不在白名单里的元件会被锁住（自由模式传 null） */
  level: Level | null;
  /** 面板顶部的附加内容（关卡模式下放本关目标卡片） */
  header?: React.ReactNode;
}

const UNITS: Array<{ unit: UnitKind; name: string; cost: string; note: string }> = [
  { unit: 'npn', name: '三极管 NPN', cost: '2', note: '基极高电平导通，双向通路' },
  { unit: 'res', name: '电阻', cost: '1', note: '弱驱动：永远被强驱动压过' },
  { unit: 'dio', name: '二极管', cost: '1.5', note: '单向导通 + 逻辑隔离' },
  { unit: 'cap', name: '电容', cost: '3', note: '只计入成本，不参与逻辑仿真' },
];

/** 左侧元件库：4 种基础元件 + 电源/端口 + 玩家封装出来的模块（关卡的素材约束在这里生效） */
export function Palette({
  placing,
  onPick,
  library,
  level,
  header,
}: PaletteProps): React.JSX.Element {
  const unitAllowed = (unit: UnitKind): boolean => !level || level.allowedUnits.includes(unit);
  const modulesAllowed = level?.moduleAccess !== 'none';
  /** 模块关卡的可用性：白名单 / 复古关禁用（与判定里的策略保持一致） */
  const moduleAllowed = (name: string): boolean => {
    if (!level) return true;
    if (level.moduleAccess === 'none') return false;
    if (level.bannedModules.includes(name)) return false;
    if (level.kind === 'retro' && level.moduleAccess === 'listed') {
      return level.allowedModules.includes(name);
    }
    return level.allowedModules.length === 0 || level.allowedModules.includes(name);
  };
  const moduleLockReason = (name: string): string => {
    if (!level) return '不可用';
    if (level.bannedModules.includes(name)) return '复古复用关禁用了这个后期积木';
    if (level.allowedModules.length > 0) return `本关只允许：${level.allowedModules.join('、')}`;
    return '本关不允许使用模块';
  };
  const lockReason = (unit: UnitKind): string => {
    if (unit === 'cap') return '电容是时钟专用元件，本阶段不开放';
    return '本关卡不允许使用该元件';
  };

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
      {header}
      <h3>基础元件</h3>
      {UNITS.map((item) => {
        const locked = !unitAllowed(item.unit);
        return (
          <button
            key={item.unit}
            type="button"
            disabled={locked}
            title={locked ? lockReason(item.unit) : item.note}
            className={isArmed('unit', item.unit) ? 'palette-item active' : 'palette-item'}
            onClick={() => pick('unit', item.unit)}
          >
            <span className="palette-name">
              {item.name} {locked && <em className="locked">本关不可用</em>}
            </span>
            <span className="palette-cost">成本 {item.cost}</span>
            <span className="palette-note">{locked ? lockReason(item.unit) : item.note}</span>
          </button>
        );
      })}

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
      {level && !modulesAllowed && (
        <p className="palette-empty">本关要求从底层元件手搭，暂不开放组件库模块。</p>
      )}
      {library.length === 0 && (
        <p className="palette-empty">
          搭好电路后点「封装为模块」，就能像元件一样复用，成本会自动递归累加。
        </p>
      )}
      {library.map((mod) => {
        const locked = !modulesAllowed || !moduleAllowed(mod.name);
        return (
          <button
            key={mod.hash}
            type="button"
            className={isArmed('module', mod.hash) ? 'palette-item active' : 'palette-item'}
            disabled={locked}
            onClick={() => pick('module', undefined, mod.hash)}
            title={locked ? moduleLockReason(mod.name) : `哈希 #${mod.hash}`}
          >
            <span className="palette-name">
              {mod.name} v{mod.version} {mod.isSequential && <em>时序</em>}
            </span>
            <span className="palette-cost">成本 {mod.costHalf / 2}</span>
            <span className="palette-note">
              {mod.ports.filter((p) => p.dir === 'in').length} 入 /{' '}
              {mod.ports.filter((p) => p.dir === 'out').length} 出 · #{mod.hash.slice(0, 6)}
            </span>
            {locked && <span className="palette-lock">{moduleLockReason(mod.name)}</span>}
          </button>
        );
      })}
    </aside>
  );
}
