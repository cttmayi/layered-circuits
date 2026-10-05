import type { Level } from '@lc/schema';
import { UNIT_COST, UNIT_DELAY_PS } from '@lc/schema';
import { type ReactNode, useState } from 'react';
import type { PlaceKind, StoredModule, UnitKind } from '../editor/model';
import { drawIcon } from '../editor/render';

/**
 * 模块封装时实测的关键路径（ps）—— 存在模板里（`StoredModule.template` 是完整模板的纯 JSON），
 * 而 `StoredModule` 本身没有这个字段，所以这里按 App 里既有的做法窄化取值。
 * 取不到（早期封装的模块、旧存档）返回 0，由调用方显示占位而不是「0.00 ns」。
 */
function moduleCriticalPathPs(mod: StoredModule): number {
  const tpl = mod.template as { criticalPathPs?: unknown } | null | undefined;
  const v = tpl?.criticalPathPs;
  return typeof v === 'number' && v > 0 ? v : 0;
}

export interface PaletteProps {
  placing: PlaceKind | null;
  onPick: (kind: PlaceKind) => void;
  library: StoredModule[];
  /** 关卡素材约束：不在白名单里的元件会被锁住（自由模式传 null） */
  level: Level | null;
  /** 面板顶部的附加内容（关卡模式下放本关目标卡片） */
  header?: React.ReactNode;
}

/** 拖拽编码：把「放什么」写进 dataTransfer */
const DRAG_MIME = 'application/x-lc-place';

export function dragPayload(pickKind: PlaceKind): string {
  return pickKind.kind === 'unit'
    ? `unit:${pickKind.unit}`
    : pickKind.kind === 'module'
      ? `module:${pickKind.hash}`
      : pickKind.kind;
}

/** 拖影：把符号画到小画布上，跟随鼠标（默认是整张卡片）。
 * Chrome 对「未挂载的 canvas」作拖影经常显示成小圆点，所以画完后转成 <img> 再当拖影。 */
export function dragImage(kind: string): HTMLImageElement | HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (ctx) drawIcon(kind, ctx, 96);
  try {
    const url = canvas.toDataURL('image/png');
    if (url.startsWith('data:image')) {
      const img = new Image();
      img.src = url;
      img.width = 96;
      img.height = 96;
      return img;
    }
  } catch {
    // jsdom 等环境不支持 toDataURL，退回原始 canvas
  }
  return canvas;
}

const UNITS: Array<{ unit: UnitKind; name: string; note: string }> = [
  { unit: 'npn', name: '三极管 NPN', note: '基极高电平导通' },
  { unit: 'res', name: '电阻', note: '弱驱动，最占面积' },
  { unit: 'dio', name: '二极管', note: '单向导通' },
  { unit: 'cap', name: '电容', note: '只计费，不参与仿真' },
  { unit: 'nmos', name: 'N-MOS', note: '栅极高电平导通' },
  { unit: 'pmos', name: 'P-MOS', note: '栅极低电平导通' },
];

/** 分组折叠的持久化键：值为数组（当前展开的分组 key） */
const SECTIONS_KEY = 'lc-ui-palette-sections';

const SECTIONS = {
  parts: 'parts',
  power: 'power',
  modules: 'modules',
} as const;

function useOpenSections(): [Set<string>, (key: string) => void] {
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(SECTIONS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) return new Set(parsed);
      }
    } catch {
      // 忽略坏存档
    }
    return new Set(Object.values(SECTIONS));
  });
  const toggle = (key: string): void => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(SECTIONS_KEY, JSON.stringify([...next]));
      } catch {
        // 忽略写入失败
      }
      return next;
    });
  };
  return [open, toggle];
}

/** 「隐藏本关不可用」筛选条的持久化键：值为 '1' / '0' */
const HIDE_LOCKED_KEY = 'lc-ui-palette-hide-locked';

function useHideLocked(): [boolean, () => void] {
  const [hide, setHide] = useState<boolean>(() => {
    try {
      return localStorage.getItem(HIDE_LOCKED_KEY) === '1';
    } catch {
      // 忽略坏存档
    }
    return false;
  });
  const toggle = (): void => {
    setHide((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(HIDE_LOCKED_KEY, next ? '1' : '0');
      } catch {
        // 忽略写入失败
      }
      return next;
    });
  };
  return [hide, toggle];
}

function SectionHead({
  title,
  badge,
  open,
  onToggle,
}: {
  title: string;
  badge?: string;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="palette-section-head"
      onClick={onToggle}
      title={open ? '收起本组' : '展开本组'}
      aria-expanded={open}
    >
      <span className={`palette-caret${open ? ' open' : ''}`}>▸</span>
      <span className="palette-section-title">{title}</span>
      {badge !== undefined && <span className="palette-section-count">{badge}</span>}
    </button>
  );
}

function Section({
  open,
  onToggle,
  title,
  badge,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  badge?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="palette-section">
      <SectionHead title={title} badge={badge} open={open} onToggle={onToggle} />
      {open && <div className="palette-section-body">{children}</div>}
    </section>
  );
}

/** 左侧元件库：可折叠分组（我的元件 / 电源与端口 / 我的模块）+ 整体可收起（见 App 的 edge-strip） */
export function Palette({
  placing,
  onPick,
  library,
  level,
  header,
}: PaletteProps): React.JSX.Element {
  const [openSections, toggleSection] = useOpenSections();
  const [hideLocked, toggleHideLocked] = useHideLocked();
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
    // 只剩「考点就是手搭元件」的关（入门关/教学关）会走到这里
    return '本关考点是用元件手搭，不收积木模块';
  };
  const lockReason = (unit: UnitKind): string => {
    if (unit === 'cap') return '时钟专用元件，本阶段不开放';
    return '本关卡不允许使用该元件';
  };
  /** 输入/输出引脚：关卡模式下端口已预置（a/b/y 是契约），不开放自加 */
  const portLockReason = '本关端口已预置（a/b/y），不能自己加';

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
    else if (
      kind === 'vcc' ||
      kind === 'gnd' ||
      kind === 'input' ||
      kind === 'output' ||
      kind === 'button' ||
      kind === 'segment'
    )
      onPick({ kind });
  };

  const availableUnits = UNITS.filter((u) => unitAllowed(u.unit)).length;
  /** 电源/端口锁定判定：关卡模式下端口已预置（a/b/y 是契约），不开放自加；VCC/GND 保留就近取电 */
  const portLocked = (kind: string): boolean =>
    (kind === 'input' || kind === 'output' || kind === 'button' || kind === 'segment') &&
    Boolean(level);
  /** 勾选「隐藏本关不可用」后的展示列表 */
  const filteredUnits = hideLocked ? UNITS.filter((u) => unitAllowed(u.unit)) : UNITS;
  const userModules = library.filter((m) => !m.teaching);
  const filteredModules = hideLocked
    ? userModules.filter((m) => modulesAllowed && moduleAllowed(m.name))
    : userModules;

  return (
    <aside className="palette">
      {header}
      {level && (
        <label className="palette-filter">
          <input type="checkbox" checked={hideLocked} onChange={toggleHideLocked} />
          <span>隐藏本关不可用</span>
        </label>
      )}
      <Section
        open={openSections.has(SECTIONS.parts)}
        onToggle={() => toggleSection(SECTIONS.parts)}
        title="我的元件"
        badge={level ? `可用 ${availableUnits}/${UNITS.length}` : String(UNITS.length)}
      >
        {filteredUnits.length === 0 && <p className="palette-empty">本关没有可用元件。</p>}
        {filteredUnits.map((item) => {
          const locked = !unitAllowed(item.unit);
          return (
            <button
              key={item.unit}
              type="button"
              disabled={locked}
              draggable={!locked}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, dragPayload({ kind: 'unit', unit: item.unit }));
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setDragImage(dragImage(item.unit), 48, 48);
              }}
              title={
                locked ? lockReason(item.unit) : `${item.note}（拖到画布放置，或点击后点画布）`
              }
              className={isArmed('unit', item.unit) ? 'palette-item active' : 'palette-item'}
              onClick={() => pick('unit', item.unit)}
            >
              <span className="palette-row">
                <span className="palette-name">
                  {item.name} {locked && <em className="locked">本关不可用</em>}
                </span>
                <span className="palette-cost">价格 {UNIT_COST[item.unit]}</span>
              </span>
              <span className="palette-row">
                <span className="palette-note">{locked ? lockReason(item.unit) : item.note}</span>
                <span className="palette-delay" title="在时序仿真里的信号延迟">
                  延迟 {((UNIT_DELAY_PS[item.unit] ?? 0) / 1000).toFixed(1)} ns
                </span>
              </span>
            </button>
          );
        })}
      </Section>

      <Section
        open={openSections.has(SECTIONS.power)}
        onToggle={() => toggleSection(SECTIONS.power)}
        title="电源与端口"
        badge="6"
      >
        {(
          [
            ['vcc', 'VCC 电源', '免费端口'],
            ['gnd', 'GND 地', '免费端口'],
            ['input', '输入引脚', '可点击切换电平'],
            ['output', '输出引脚', '显示实时电平'],
            ['button', '按钮', '瞬时按键：点击 = 电平 1，自动弹回 0'],
            ['segment', '七段数码管', '按端口值（BCD 0-9）点亮段'],
          ] as Array<[string, string, string]>
        )
          .filter(([kind]) => !hideLocked || !portLocked(kind))
          .map(([kind, name, note]) => {
            const locked = portLocked(kind);
            return (
              <button
                key={kind}
                type="button"
                disabled={locked}
                draggable={!locked}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_MIME, kind);
                  e.dataTransfer.effectAllowed = 'copy';
                  e.dataTransfer.setDragImage(dragImage(kind), 48, 48);
                }}
                title={locked ? portLockReason : `${note}（拖到画布放置）`}
                className={isArmed(kind) ? 'palette-item active' : 'palette-item'}
                onClick={() => pick(kind)}
              >
                <span className="palette-name">
                  {name} {locked && <em className="locked">本关不可用</em>}
                </span>
                <span className="palette-note">{locked ? portLockReason : note}</span>
              </button>
            );
          })}
      </Section>

      <Section
        open={openSections.has(SECTIONS.modules)}
        onToggle={() => toggleSection(SECTIONS.modules)}
        title={`我的模块（${userModules.length}）`}
      >
        {level && !modulesAllowed && (
          <p className="palette-empty">本关要求从底层元件手搭，暂不开放组件库模块。</p>
        )}
        {userModules.length === 0 && (
          <p className="palette-empty">
            搭好电路后点「封装为模块」，就能像元件一样复用，造价会自动递归累加。
          </p>
        )}
        {hideLocked && filteredModules.length === 0 && userModules.length > 0 && (
          <p className="palette-empty">已按「隐藏本关不可用」过滤，本关没有可用的模块。</p>
        )}
        {filteredModules.map((mod) => {
          const locked = !modulesAllowed || !moduleAllowed(mod.name);
          return (
            <button
              key={mod.hash}
              type="button"
              className={isArmed('module', mod.hash) ? 'palette-item active' : 'palette-item'}
              disabled={locked}
              draggable={!locked}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, dragPayload({ kind: 'module', hash: mod.hash }));
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setDragImage(dragImage('module'), 48, 48);
              }}
              onClick={() => pick('module', undefined, mod.hash)}
              title={locked ? moduleLockReason(mod.name) : '拖到画布放置'}
            >
              <span className="palette-row">
                <span className="palette-name">
                  {mod.name} {mod.isSequential && <em>时序</em>}
                </span>
                <span className="palette-cost">成本 {mod.costHalf / 2}</span>
              </span>
              {/* 第二行：左边入/出，右边延迟（= 封装时实测的关键路径，任一输入 → 输出口最长路径）。
                  延迟并进这一行、不自己占一行，卡片始终两行高、加延迟不会变高 */}
              <span className="palette-row">
                <span className="palette-note">
                  {mod.ports.filter((p) => p.dir === 'in').length} 入 /{' '}
                  {mod.ports.filter((p) => p.dir === 'out').length} 出
                </span>
                <span
                  className="palette-delay"
                  title={
                    moduleCriticalPathPs(mod) > 0
                      ? '封装时实测：任一输入到输出口的最长路径'
                      : '封装时未记录时序（早期模块，重新封装即可得到）'
                  }
                >
                  {moduleCriticalPathPs(mod) > 0
                    ? `延迟 ${(moduleCriticalPathPs(mod) / 1000).toFixed(1)} ns`
                    : '延迟 —'}
                </span>
              </span>
              {locked && <span className="palette-lock">{moduleLockReason(mod.name)}</span>}
            </button>
          );
        })}
      </Section>
    </aside>
  );
}
