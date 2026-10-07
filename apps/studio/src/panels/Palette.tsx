import { BASIC_GATES } from '@lc/content';
import type { Level } from '@lc/schema';
import { UNIT_COST, UNIT_DELAY_PS } from '@lc/schema';
import { type ReactNode, useMemo, useState } from 'react';
import type { PlaceKind, StoredModule, UnitKind } from '../editor/model';
import { drawIcon } from '../editor/render';
import { usePortraitNarrow } from '../layout/viewport';
import { dedupeByNameForDisplay, producedInElementLevel } from '../level/library';
import { gateLevelUsable, gateProbeLibrary } from '../sim/gate-usable';

/**
 * 卡片上的「其余信息」（价格 / 说明 / 引脚数 / 延迟 / 锁定原因）。
 *
 * 竖屏下元件库是贴着画布底部的**精简形态**：卡片只留名字，这些信息一律不渲染 ——
 * 不是靠 CSS 藏起来，而是根本不进 DOM（既省掉一半高度，也让「只显示名字」这条
 * 能在 jsdom 里被测到，不只靠样式表文本）。
 * 桌面与横屏手机 compact = false，这里只是一个 Fragment：不产生任何 DOM 节点，
 * 原来的节点树逐字节不变。
 */
function CardExtra({
  compact,
  children,
}: {
  compact: boolean;
  children: ReactNode;
}): React.JSX.Element | null {
  if (compact) return null;
  return <>{children}</>;
}

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
  /** 判定/仿真口径：逻辑版抹平延迟，卡片上就不显示延迟（默认时序版） */
  mode?: 'logic' | 'timing';
  /**
   * **本关基础门的权威清单**（`gateCatalogFor(本关生效族)`，由 App 传入）：
   * 门是**契约实体**，逻辑关里「基础门」分组**直接照它渲染**，与库里有多少条同名条目、
   * hash 是哪个族的、有没有重复**完全无关**（用户第 ⑯ 轮："到了第 8 关，不该存在不同的非门"）。
   * 时机/自由模式不用它渲染（那里强弱/工艺是真实差异），只借它的次序给同名条目排序。
   * 不传时（自由模式/测试）退化回"库里有什么列什么 + 按名字去重"。
   */
  gateCatalog?: readonly StoredModule[];
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
  gates: 'gates',
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

/**
 * 左侧元件库：可折叠分组（我的元件 / 电源与端口 / 我的模块）+ 整体可收起（见 App 的 edge-strip）。
 * 「电源与端口」这一组**只在自由模式渲染**（关卡模式的依据见下方 Section 处的注释）。
 */
export function Palette({
  placing,
  onPick,
  library,
  level,
  header,
  mode = 'timing',
  gateCatalog,
}: PaletteProps): React.JSX.Element {
  const [openSections, toggleSection] = useOpenSections();
  const [hideLocked, toggleHideLocked] = useHideLocked();
  /** 竖屏窄屏 = 底部精简形态：卡片只留名字，且不渲染顶部那个「隐藏本关不可用」开关 */
  const compact = usePortraitNarrow();
  /**
   * 竖屏底部抽屉的卡片只有 44px 宽（用户第 ⑫ 轮：一行至少 8 张），名牌最多两行 +
   * 省略号 —— 所以把**全名**拼进 `title`，鼠标/长按都能看到完整名字。
   * 非竖屏（桌面/横屏）原样返回，`title` 逐字不变。
   */
  const cardTitle = (name: string, rest: string): string => (compact ? `${name}｜${rest}` : rest);
  /**
   * 竖屏底部形态**一律不套**「隐藏本关不可用」的持久化过滤（等于恒为「显示全部」）。
   *
   * 为什么：竖屏下那个开关根本不渲染（见下面 `!compact`），可它存在 localStorage 里 —— 如果
   * 玩家之前在桌面/横屏打开过它，手机上就会看到缺项的元件库、又没有开关能恢复，等于一个
   * 看不见也关不掉的隐藏态。所以竖屏下直接按「不过滤」算。
   * ⚠️ 只影响竖屏的**展示列表**：桌面/横屏照旧按持久化状态过滤，`hideLocked` 状态和
   * localStorage 键（lc-ui-palette-hide-locked）都没动，判定/仿真逻辑一行没碰。
   */
  const hideLockedActive = !compact && hideLocked;
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
  /**
   * 「电源与端口」这一组**只在自由模式出现**（见下面 Section 处的注释与审计结论）：
   * 关卡模式下整组不渲染，所以这里的锁定分支在两种模式下都到不了（自由模式 `level` 为空）。
   * 留着是为了不让这次改动扩散到自由模式的渲染代码 —— 那边与改动前逐字相同。
   */
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
  /** 勾选「隐藏本关不可用」后的展示列表（竖屏底部形态恒不过滤，见 hideLockedActive） */
  const filteredUnits = hideLockedActive ? UNITS.filter((u) => unitAllowed(u.unit)) : UNITS;
  /**
   * 「我的模块」= 库里的非教学条目，**不按名字合并**（用户第 ⑯ 轮的口径，我同意）：
   * 玩家自建模块是**内容实体**，同名不同内容就是他的两件不同作品（同名不同 hash 也正是
   * `dedupeLibrary` 要保留的语义：被画布引用的老版本不能删）。菜单里两张卡靠**成本/入出数/
   * 延迟**区分得开，玩家自己知道哪个是哪个；合并反而等于替他删掉一件作品。
   * （与「基础门」正好相反：那里门是**契约实体**，名字即身份，所以必须规范化成一张卡。）
   */
  const userModules = useMemo(() => library.filter((m) => !m.teaching), [library]);
  /**
   * 逻辑关（`judgeMode === 'logic'`，第 8 关起）里「我的模块」**只列门级口径跑得动的** ——
   * 第 1~7 关用元件搭的非门/与门这些**组合**老模块在门级口径下不成立（门级引擎递归展开时
   * 遇到身体里含元件的模块会如实放弃），所以**整条不渲染**（隐藏，不是置灰）。
   *
   * 判据不在这里维护，也不在别处维护名单：见 sim/gate-usable.ts —— 拿探针设计把**门级判定
   * 自己叫起来跑一遍**（`runGateVectors`，就是判定在逻辑关走的那条入口）：跑不了就不列；
   * 名字没写进 `GATE_SEQ_SPECS` 的**时序**积木（玩家自己起名的 D 锁存器/主从D触发器）按端口
   * 形状补一份声明再问 —— 否则会把玩家上一关的成果藏掉（用户实测 bug，见该文件头）。
   * 这样将来新增模块/关卡、引擎放宽或收紧，这里自动跟着对。
   *
   * 时序关与自由模式（`judgeMode !== 'logic'`）走的是同一个 `visibleUserModules = userModules`
   * 分支，列表、计数、提示语逐字不变（见 test/palette-logic-modules.test.tsx 的反证）。
   *
   * **不显示"已隐藏 N 个"这类说明文字**（用户明确不要）：隐藏就是安静地不渲染，
   * 组头计数照旧是本关实际列出的条数。别把它换个地方加回来。
   */
  const logicLevel = level?.judgeMode === 'logic';
  const probeLibrary = useMemo(() => gateProbeLibrary(library), [library]);
  // 探针不再做全局缓存（结论同时取决于模块名与库，按 hash 缓存会串味 —— 见 gate-usable.ts 文件头），
  // 所以这里按「库 + 是否逻辑关」记忆化，画布上的鼠标移动不会反复跑探针。
  /**
   * 逻辑关再拦一道（用户第 ⑰ 轮拍板）：「**1~7 关创建的模块不要往 8 关之后放**」。
   * 第 1~7 关（元件/时序关）产出的东西在逻辑关是"含元件的组合模块" —— 门级引擎如实拒绝、
   * 静默回落元件引擎，延迟与强弱语义就跟着回来了，所以第 8 关起干脆不列它们（不是置灰）。
   * 判据见 `producedInElementLevel`：**优先用产出处**（存档的 levelId → 那关的 judgeMode），
   * 存档没记 provenance 时用内容代理（身体含元件），两条都会在注释里写明会判错的情况。
   * 时序关与自由模式不拦（玩家在原关卡里的产出照旧列着，见反证用例）。
   */
  /**
   * 逻辑关还有第二件事：**同一份模块不要两组各出一张卡**（用户第 ⑰ 轮批准的建议 2）。
   *
   * 实测事实（第 ⑰ 轮）：rtl 玩家在第 1~7 关亲手封装的门，与「基础门」清单里的门**hash 逐字相同**
   * （非门 61fb0eb6 / 与门 ed7f885a / 或门 8ad8f9c0 / 与非门 761c6864 / 异或门 ec8958c7）——
   * "元件版 vs 门版"是**假二分**：同一份内容，只是名字是门名才被门级引擎当零延迟原子算。
   * 所以在逻辑关里，「我的模块」里凡是**与基础门同 hash** 的副本都不再重复列（基础门那份照旧在，
   * 信息不丢）；玩家**内容不同**的同名作品照旧列（那是他自己的东西，见第 ⑯ 轮口径与对应用例）。
   *
   * **只动显示层**：不动库、存档、判定、关卡数据、schema —— 隐藏的模块仍在 `progress.library` 里，
   * 「组件库与成绩」查得到，画布上已放置的实例照常工作，验收结论一字不变（见反证用例）。
   * 无 provenance 的老存档也覆盖得到（这里比的是 hash，不看来路）。
   *
   * ⚠️ deps 里的 `gateCatalog` 由 App 用 `useMemo` 按族算出来，是稳定引用；`userModules` 本来
   * 每次渲染都是新数组（既有情况），所以这个 memo 与它之前的开销特征一致。
   */
  const visibleUserModules = useMemo(() => {
    if (!logicLevel) return userModules; // 时序关/自由模式：库 + 按名字去重，一行不动
    // 与「基础门」渲染同一口径（catalog 本来就是 teaching + 白名单内的门，见下面的 inGateList）
    const gateHashes = new Set(
      (gateCatalog ?? [])
        .filter((m) => m.teaching === true && BASIC_GATES.includes(m.name))
        .map((m) => m.hash),
    );
    return userModules.filter(
      (m) =>
        !gateHashes.has(m.hash) && // ← 同 hash 跨组两张：只留基础门那一张
        !producedInElementLevel(m) &&
        gateLevelUsable(m, probeLibrary),
    );
  }, [logicLevel, userModules, probeLibrary, gateCatalog]);
  /** 基础门：本关提供的门（teaching 积木）。库里注入的是整族（复合门的身体会引用更底层的门），
   *  菜单只列本关允许的门，所以列表里不会出现被锁住的卡片。 */
  /** 本关是否允许在顶层画布摆元件（第 8 关起为 false） */
  const elementAllowed = level?.elementAccess !== 'none';
  /**
   * 基础门分组。两道过滤，顺序不能反：
   *   ① 只列**基础门**：teachingModulesFor 里还混着"一键出答案"用的复合积木
   *      （二进制→BCD 3084 元、显示控制 1500 元、七段译码器 430 元…），列出来等于把答案给玩家；
   *   ② **按名字去重**（`dedupeByNameForDisplay`，按 `gateOrder` 保留本关族那一份）：
   *      分组是**按名字**列的，而库是**内容寻址**的 —— 名字相同、族不同（rtl/cmos 的非门是
   *      两个 hash）就是两条 → 同名出两张卡（用户实测：本来 7 个，点一次「一键出答案」变 11 个）。
   *      存档瘦身故意保留全部教学积木（见 dedupeLibrary 注释），所以历史遗留条目必须在这里兜住。
   */
  // 不套 useMemo：moduleAllowed 依赖 level、每次渲染都是新函数（套上要么漏依赖要么每帧重算），
  // 而这里就是一次 O(库大小) 的过滤 + 去重（库几十条），直接算最省心也最不容易出错。
  const inGateList = (m: StoredModule): boolean =>
    m.teaching === true &&
    BASIC_GATES.includes(m.name) &&
    (level?.moduleAccess !== 'listed' || moduleAllowed(m.name));
  /**
   * 基础门分组。**逻辑关与时机/自由模式是两套口径**：
   *
   * · **逻辑关**（第 8 关起）= 照 App 给的**权威清单**渲染（`gateCatalog`）。门是契约实体，
   *   身份是**名字**：判定侧的 `gate-netlist.ts` 遇到 `isGateName(name)` 就按真值函数当原子算、
   *   根本不展开身体，`gate-logic.ts` 的 `evalGate` 也只认门名 —— 库里同名不同 hash 的「非门」
   *   在逻辑关**不该同时存在**（实测：把门版答案里的非门换成 ttl/cmos 版本，判定结论逐字一致，
   *   只有造价/评分跟着族变）。所以这一组与库内容**无关**：库里塞重复条目、塞别族同名门、
   *   塞乱七八糟的东西，这一组逐字不变。
   * · **时机 / 自由模式** = 库里有什么列什么（那里门槛由本关族注入、强弱是真实差异），
   *   但**按名字去重**：库是内容寻址的，历史遗留的别族同名门会让一个门出两张卡
   *   （用户实测 7 → 11）；去重时按 `gateCatalog` 的次序保留本关族那一份。
   */
  const gateModules = logicLevel
    ? (gateCatalog ?? []).filter(inGateList)
    : dedupeByNameForDisplay(library.filter(inGateList), {
        ...(gateCatalog ? { order: gateCatalog.map((m) => m.hash) } : {}),
      });
  const filteredModules = hideLockedActive
    ? visibleUserModules.filter((m) => modulesAllowed && moduleAllowed(m.name))
    : visibleUserModules;

  return (
    <aside className="palette">
      {header}
      {/* 「隐藏本关不可用」是过滤器：竖屏底部精简形态不需要它（开关本身是宽屏/横屏才有的） */}
      {level && !compact && (
        <label className="palette-filter">
          <input type="checkbox" checked={hideLocked} onChange={toggleHideLocked} />
          <span>隐藏本关不可用</span>
        </label>
      )}
      {/* 「只能用模块」的关卡（第 8 关起）不显示元件区 */}
      {elementAllowed && (
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
                title={cardTitle(
                  item.name,
                  locked ? lockReason(item.unit) : `${item.note}（拖到画布放置，或点击后点画布）`,
                )}
                className={isArmed('unit', item.unit) ? 'palette-item active' : 'palette-item'}
                onClick={() => pick('unit', item.unit)}
              >
                <span className="palette-row">
                  <span className="palette-name">
                    {item.name}{' '}
                    <CardExtra compact={compact}>
                      {locked && <em className="locked">本关不可用</em>}
                    </CardExtra>
                  </span>
                  <CardExtra compact={compact}>
                    <span className="palette-cost">价格 {UNIT_COST[item.unit]}</span>
                  </CardExtra>
                </span>
                <CardExtra compact={compact}>
                  <span className="palette-row">
                    <span className="palette-note">
                      {locked ? lockReason(item.unit) : item.note}
                    </span>
                    {mode !== 'logic' && (
                      <span className="palette-delay" title="在时序仿真里的信号延迟">
                        延迟 {((UNIT_DELAY_PS[item.unit] ?? 0) / 1000).toFixed(1)} ns
                      </span>
                    )}
                  </span>
                </CardExtra>
              </button>
            );
          })}
        </Section>
      )}

      {/* ---- 「电源与端口」：**只有自由模式才有这一组** ----
          关卡模式下整组**不渲染**（不是置灰、不是折叠：DOM 里连组头都没有）。
          依据（27 关逐关审计，见 test/palette-power-group.test.tsx 的同名守卫）：
            · `docForLevel` 对**每一关**都预置并锁定 rail-vcc / rail-gnd，以及关卡声明的所有
              in/out 端口（按钮 = 端口上的 `button` 标记、七段数码管 = 端口上的 `display` 标记，
              都由它一并预置）；
            · 27 关的**参考解**没有一关用到的 vcc/gnd/端口超出初始画布（最多的关也是 vcc1/gnd1，
              多数参考解连 vcc/gnd 都不声明，直接用预置轨）；
            · 该组的 4 个端口类条目（输入/输出引脚、按钮、七段数码管）在关卡模式下本来就是锁定态
              （「本关端口已预置」），唯一还能点的只有 VCC/GND，而它们同样已被预置。
          所以关卡模式下这一组对玩家是**纯冗余**（还会把"要不要自己加电源"当成伪问题），
          自由模式则照旧、逐字不变（没有 level 就没有预置，必须自己加电源与端口）。 */}
      {!level && (
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
            .filter(([kind]) => !hideLockedActive || !portLocked(kind))
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
                  title={cardTitle(name, locked ? portLockReason : `${note}（拖到画布放置）`)}
                  className={isArmed(kind) ? 'palette-item active' : 'palette-item'}
                  onClick={() => pick(kind)}
                >
                  <span className="palette-name">
                    {name}{' '}
                    <CardExtra compact={compact}>
                      {locked && <em className="locked">本关不可用</em>}
                    </CardExtra>
                  </span>
                  <CardExtra compact={compact}>
                    <span className="palette-note">{locked ? portLockReason : note}</span>
                  </CardExtra>
                </button>
              );
            })}
        </Section>
      )}

      {/* 基础门：本关提供的门。契约在门的内部，这里只按白名单列出来。
          库里注入的是整族（复合门的身体会引用更底层的门，只注入白名单会 unknown-module），
          菜单只列本关允许的门，所以不会出现"锁住"的卡片。 */}
      {level && modulesAllowed && gateModules.length > 0 && (
        <Section
          open={openSections.has(SECTIONS.gates)}
          onToggle={() => toggleSection(SECTIONS.gates)}
          title={`基础门（${gateModules.length}）`}
        >
          {gateModules.map((gate) => {
            // 基础门区只列本关允许的门，不存在被锁住的卡片
            const locked = false;
            return (
              <button
                key={gate.hash}
                type="button"
                className={isArmed('module', gate.hash) ? 'palette-item active' : 'palette-item'}
                disabled={locked}
                draggable={!locked}
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    DRAG_MIME,
                    dragPayload({ kind: 'module', hash: gate.hash }),
                  );
                  e.dataTransfer.effectAllowed = 'copy';
                  e.dataTransfer.setDragImage(dragImage('module'), 48, 48);
                }}
                onClick={() => pick('module', undefined, gate.hash)}
                title={cardTitle(gate.name, locked ? moduleLockReason(gate.name) : '拖到画布放置')}
              >
                <span className="palette-row">
                  <span className="palette-name">
                    {gate.name}{' '}
                    <CardExtra compact={compact}>{gate.isSequential && <em>时序</em>}</CardExtra>
                  </span>
                  <CardExtra compact={compact}>
                    <span className="palette-cost">成本 {gate.costHalf / 2}</span>
                  </CardExtra>
                </span>
                {/* 第二行：左边入/出，右边延迟（= 封装时实测的关键路径，任一输入 → 输出口最长路径）。
                  延迟并进这一行、不自己占一行，卡片始终两行高、加延迟不会变高 */}
                <CardExtra compact={compact}>
                  <span className="palette-row">
                    <span className="palette-note">
                      {gate.ports.filter((p) => p.dir === 'in').length} 入 /{' '}
                      {gate.ports.filter((p) => p.dir === 'out').length} 出
                    </span>
                    {mode !== 'logic' && (
                      <span
                        className="palette-delay"
                        title={
                          moduleCriticalPathPs(gate) > 0
                            ? '封装时实测：任一输入到输出口的最长路径'
                            : '封装时未记录时序（早期模块，重新封装即可得到）'
                        }
                      >
                        {moduleCriticalPathPs(gate) > 0
                          ? `延迟 ${(moduleCriticalPathPs(gate) / 1000).toFixed(1)} ns`
                          : '延迟 —'}
                      </span>
                    )}
                  </span>
                </CardExtra>
                <CardExtra compact={compact}>
                  {locked && <span className="palette-lock">{moduleLockReason(gate.name)}</span>}
                </CardExtra>
              </button>
            );
          })}
        </Section>
      )}

      <Section
        open={openSections.has(SECTIONS.modules)}
        onToggle={() => toggleSection(SECTIONS.modules)}
        title={`我的模块（${visibleUserModules.length}）`}
      >
        {level && !modulesAllowed && (
          <p className="palette-empty">本关要求从底层元件手搭，暂不开放组件库模块。</p>
        )}
        {userModules.length === 0 && (
          <p className="palette-empty">
            搭好电路后点「封装为模块」，就能像元件一样复用，造价会自动递归累加。
          </p>
        )}
        {/* 这个提示只在**过滤器真的过滤掉了东西**时说（visibleUserModules > filteredModules）：
            逻辑关里被门级判定挡掉的模块不算"已按…过滤"，否则会把"本关没有可用的模块"误报出来 */}
        {hideLockedActive && filteredModules.length === 0 && visibleUserModules.length > 0 && (
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
              title={cardTitle(mod.name, locked ? moduleLockReason(mod.name) : '拖到画布放置')}
            >
              <span className="palette-row">
                <span className="palette-name">
                  {mod.name}{' '}
                  <CardExtra compact={compact}>{mod.isSequential && <em>时序</em>}</CardExtra>
                </span>
                <CardExtra compact={compact}>
                  <span className="palette-cost">成本 {mod.costHalf / 2}</span>
                </CardExtra>
              </span>
              {/* 第二行：左边入/出，右边延迟（= 封装时实测的关键路径，任一输入 → 输出口最长路径）。
                  延迟并进这一行、不自己占一行，卡片始终两行高、加延迟不会变高 */}
              <CardExtra compact={compact}>
                <span className="palette-row">
                  <span className="palette-note">
                    {mod.ports.filter((p) => p.dir === 'in').length} 入 /{' '}
                    {mod.ports.filter((p) => p.dir === 'out').length} 出
                  </span>
                  {mode !== 'logic' && (
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
                  )}
                </span>
              </CardExtra>
              <CardExtra compact={compact}>
                {locked && <span className="palette-lock">{moduleLockReason(mod.name)}</span>}
              </CardExtra>
            </button>
          );
        })}
      </Section>
    </aside>
  );
}
