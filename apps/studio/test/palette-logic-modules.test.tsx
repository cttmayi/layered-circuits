// @vitest-environment jsdom
/**
 * 逻辑关（`judgeMode === 'logic'`，第 8 关起）里「我的模块」**只列门级判定跑得了的模块**。
 *
 * 用户第 ⑫ 轮要求：第 1~7 关用**元件**搭的老模块（非门/与门这些）在逻辑关里"看着能用、
 * 其实门级判定不认"（门级引擎遇到**身体里含元件**的模块会如实放弃），所以整条**不渲染**
 * （隐藏，不是置灰）；「基础门」那组一个字不动；时序关与自由模式逐字不变。
 *
 * 判据本身（`sim/gate-usable.ts`：拿探针设计把门级判定自己叫起来跑一遍）在这里也被钉住：
 *  - 含元件的**组合**模块 → 用不了（含**递归**：身体里嵌了含元件模块的也不行）；
 *  - 全由基础门搭的复合模块 → 能用；
 *  - 时序积木（D锁存器 / 主从D触发器）→ **能用**（不被一刀切成"非纯门就隐藏"）。
 *
 * ⚠️ 用户随后报的 bug（本文件最后一组用例）：门级引擎认时序积木**按模块名**查
 * `GATE_SEQ_SPECS`，而玩家给模块起的名字五花八门（手动封装的默认名就是「我的模块」，
 * 老版本还可能用关卡标题「D 锁存器」——带空格）。名字对不上表，同一个电路就被判成"跑不动"
 * 而**被整条藏掉**，其中就包括玩家上一关产出的 D 锁存器。修法：**名字不参与判据** —— 端口形状
 * 是已声明的时序积木（`d/en/q`、`clk/d/q`）就必列。这组用例把「同一具身体、不同名字」的对照表固化。
 */

import { designToModulePorts, wrapModule } from '@lc/compiler';
import { ALL_LEVELS, GATE_SEQ_SPECS, hashOf, teachingModulesFor } from '@lc/content';
import {
  type Design,
  DesignSchema,
  InMemoryModuleLibrary,
  type Level,
  type ModuleTemplate,
} from '@lc/schema';
import { GateStateStore, settleGateSteps } from '@lc/sim-core';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StoredModule } from '../src/editor/model.ts';
import { Palette } from '../src/panels/Palette.tsx';
import { gateLevelUsable, gateProbeLibrary, specByShape } from '../src/sim/gate-usable.ts';

/** 与 App 注入画布库的口径一致：整族教学积木（含嵌套用到的下层门） */
const RTL_LIB = new InMemoryModuleLibrary([...teachingModulesFor('rtl')]);

/**
 * App 的 `teachingStoredFor` + `withLevelGates` 的口径：开放模块库的关卡会把**整族**教学积木
 * 注入画布库（`teaching: true` → 不出现在「我的模块」，但探针/编译要靠它们解析嵌套引用）。
 * 这里照抄一份，保证测试里的库与真机同形 —— 少了它，"全门模块"会因为库里查不到底层门
 * 被判成不可用（那是**假红**，不是这条口径要挡的东西）。
 */
const teachingLibrary = (): StoredModule[] =>
  teachingModulesFor('rtl').map((m) => ({ ...stored(m), teaching: true }));

/** 把模板包成画布库里的 StoredModule（字段与 App 存档里的模块同形） */
function stored(template: ModuleTemplate): StoredModule {
  return {
    hash: template.hash,
    name: template.name,
    version: template.version,
    stage: template.stage,
    costHalf: template.costHalf,
    isSequential: template.isSequential,
    ports: template.ports.map((p) => ({ id: p.id, name: p.name, dir: p.dir, width: p.width })),
    template,
    sources: [],
    createdAt: 0,
  };
}

function wrap(name: string, body: Design): StoredModule {
  const { template } = wrapModule(
    { name, stage: 1, kind: 'logic', ports: designToModulePorts(body), body },
    RTL_LIB,
  );
  return stored(template);
}

/** 第 1~7 关那种"用元件搭的非门"：两个电阻 + 一只 NPN（**身体里含元件**） */
function unitNotModule(): StoredModule {
  const body = DesignSchema.parse({
    id: 'm-not-unit',
    name: '非门（元件版）',
    instances: [
      { kind: 'unit', id: 'r1', unit: 'res', pos: { x: 0, y: 0 } },
      { kind: 'unit', id: 'r2', unit: 'res', pos: { x: 0, y: 80 } },
      { kind: 'unit', id: 'q1', unit: 'npn', pos: { x: 80, y: 40 } },
      { kind: 'vcc', id: 'v1', pos: { x: 100, y: 0 } },
      { kind: 'gnd', id: 'g1', pos: { x: 40, y: 160 } },
    ],
    nets: [
      {
        id: 'n1',
        pins: [
          { inst: 'r1', pin: 'b' },
          { inst: 'q1', pin: 'b' },
        ],
      },
      { id: 'n2', pins: [{ inst: 'q1', pin: 'c' }] },
    ],
    ports: [
      { id: 'a', name: 'a', dir: 'in', width: 1, nets: ['n1'] },
      { id: 'y', name: 'y', dir: 'out', width: 1, nets: ['n2'] },
    ],
  });
  return wrap('非门（元件版）', body);
}

/** 全由基础门搭的模块：一只与非门的两个输入并起来 = 非门（**只有 module 实例**） */
function gateNotModule(): StoredModule {
  const nand = RTL_LIB.get(hashOf('与非门'));
  const body = DesignSchema.parse({
    id: 'm-not-gate',
    name: '非门（门版）',
    instances: [
      { kind: 'module', id: 'g1', module: nand?.hash },
      { kind: 'module', id: 'g2', module: nand?.hash },
    ],
    nets: [
      {
        id: 'n1',
        pins: [
          { inst: 'g1', pin: 'a' },
          { inst: 'g2', pin: 'a' },
        ],
      },
      {
        id: 'n2',
        pins: [
          { inst: 'g1', pin: 'b' },
          { inst: 'g2', pin: 'b' },
        ],
      },
      {
        id: 'n3',
        pins: [
          { inst: 'g1', pin: 'y' },
          { inst: 'g2', pin: 'a' },
        ],
      },
    ],
    ports: [
      { id: 'a', name: 'a', dir: 'in', width: 1, nets: ['n1'] },
      { id: 'y', name: 'y', dir: 'out', width: 1, nets: ['n3'] },
    ],
  });
  return wrap('非门（门版）', body);
}

/** 递归反证：身体里嵌了上面那个**含元件**模块的模块（自己一个元件都没有） */
function nestedOverUnitModule(): StoredModule {
  const inner = unitNotModule();
  const body = DesignSchema.parse({
    id: 'm-nested',
    name: '套在元件版外面的缓冲',
    instances: [{ kind: 'module', id: 'u1', module: inner.hash }],
    nets: [{ id: 'n1', pins: [{ inst: 'u1', pin: 'y' }] }],
    ports: [
      { id: 'a', name: 'a', dir: 'in', width: 1, nets: ['n1'] },
      { id: 'y', name: 'y', dir: 'out', width: 1, nets: ['n1'] },
    ],
  });
  return wrap('套在元件版外面的缓冲', body);
}

/** 时序积木（带 SeqSpec）当积木用：本身是复合积木，不是"含元件" */
function dffModule(): StoredModule {
  const dff = RTL_LIB.get(hashOf('主从D触发器'));
  const body = DesignSchema.parse({
    id: 'm-dff',
    name: '主从D触发器（包一层）',
    instances: [{ kind: 'module', id: 'f1', module: dff?.hash }],
    nets: [{ id: 'n1', pins: [{ inst: 'f1', pin: 'q' }] }],
    ports: [
      { id: 'd', name: 'd', dir: 'in', width: 1, nets: ['n1'] },
      { id: 'y', name: 'y', dir: 'out', width: 1, nets: ['n1'] },
    ],
  });
  return wrap('主从D触发器（包一层）', body);
}

/**
 * 玩家上一关的成果：D 锁存器。身体照抄教学积木（元件版双极锁存电路，`isSequential` 为真），
 * 但**名字由玩家自己起**（手动封装时 window.prompt 的默认值就是「我的模块」）。
 */
function playerLatchNamed(name: string): StoredModule {
  const tpl = RTL_LIB.get(hashOf('D锁存器')) as ModuleTemplate;
  const { template } = wrapModule(
    { name, stage: 2, kind: 'logic', ports: designToModulePorts(tpl.body), body: tpl.body },
    RTL_LIB,
  );
  return stored(template);
}

function fakeLevel(judgeMode: 'logic' | 'timing', bannedModules: string[] = []): Level {
  return {
    id: 't-logic',
    title: '逻辑关（测试）',
    allowedUnits: ['npn', 'res'],
    moduleAccess: 'all',
    bannedModules,
    allowedModules: [],
    kind: 'normal',
    judgeMode,
  } as unknown as Level;
}

function stubNarrow(portrait: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: portrait && /orientation:\s*portrait/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderPalette(opts: {
  level: Level | null;
  library: StoredModule[];
  portrait?: boolean;
}): ReturnType<typeof render> {
  stubNarrow(opts.portrait ?? false);
  return render(
    <Palette
      placing={null}
      onPick={() => {}}
      library={[...teachingLibrary(), ...opts.library]}
      level={opts.level}
      mode={opts.level?.judgeMode === 'logic' ? 'logic' : 'timing'}
    />,
  );
}

/** 某一组的卡片名字（按组头前缀找那一组，避开与组头文字撞名） */
function sectionCardNames(head: string): string[] {
  const section = [...document.querySelectorAll('.palette-section')].find((sec) =>
    (sec.querySelector('.palette-section-title')?.textContent?.trim() ?? '').startsWith(head),
  );
  return [...(section?.querySelectorAll('.palette-name') ?? [])].map((el) =>
    (el.textContent?.trim() ?? '').replace(/\s+(时序|组合|模块)$/, ''),
  );
}

/** 「我的模块」组的卡片名字 */
const cardNames = (): string[] => sectionCardNames('我的模块');

/**
 * 用户第 ⑫ 轮追加裁定：**不要**"已隐藏 N 个"这类说明文字（隐藏就是安静地不渲染），
 * 所以下面一律断言它**不存在**；组头计数照旧是本关实际列出的条数。
 */
const NO_HINT = /已隐藏|本关判定走门级|含元件的模块用不了/;

/**
 * 「门级判定为什么跑不了这个模块」——**引擎本人给的理由**（只在测试里取，产品代码不依赖理由字符串）。
 * 探针与 `sim/gate-usable.ts` 完全同形，只是这里把 reason 打出来，证明挡住的是"身体里含元件"
 * 这一类，而不是碰巧库里没查到模块（那样会假红）。
 */
function probeReason(mod: StoredModule, lib: InMemoryModuleLibrary): string {
  const gateLib = {
    get: (hash: string) => {
      const m = lib.get(hash);
      if (!m) return undefined;
      return {
        name: m.name,
        isSequential: m.isSequential,
        seq: GATE_SEQ_SPECS[m.name],
        ports: m.ports.map((p) => ({ name: p.name, dir: p.dir, width: p.width })),
        body: m.body,
      };
    },
  };
  const probe = DesignSchema.parse({
    id: '__probe__',
    name: '探针',
    instances: [{ kind: 'module', id: 'x', module: mod.hash }],
  });
  const out = settleGateSteps(probe, gateLib, new Map(), new GateStateStore());
  return out.ok ? '' : (out.reason ?? '');
}

describe('逻辑关隐藏元件级老模块（门级判定跑不了的不列）', () => {
  beforeEach(() => {
    localStorage.clear();
    stubNarrow(false);
  });

  it('逻辑关：含元件的老模块不在 DOM，全由基础门搭的模块仍在', () => {
    const unitMod = unitNotModule();
    const gateMod = gateNotModule();
    renderPalette({ level: fakeLevel('logic'), library: [unitMod, gateMod] });

    // 含元件的 → 整条不渲染（不是置灰、不是折叠）
    expect(screen.queryByText(unitMod.name)).toBeNull();
    expect(screen.queryByText(unitMod.name, { exact: false })).toBeNull();
    // 全门模块 → 照旧在
    expect(screen.getByText(gateMod.name, { exact: false })).toBeTruthy();
    // 计数只数列出来的（组头照旧是实际列出的条数）
    expect(screen.getByText('我的模块（1）')).toBeTruthy();
    // 但**不**给"隐藏了几个"的说明文字
    expect(screen.queryByText(NO_HINT)).toBeNull();
    // 「基础门」那组一个字没动（逻辑关的合法积木清单）
    expect(screen.getByText(/^基础门（\d+）$/)).toBeTruthy();
    expect(screen.getByText('与非门', { exact: false })).toBeTruthy();
  });

  it('递归也挡：身体里嵌了含元件模块的模块，自己一个元件都没有也不列', () => {
    const unitMod = unitNotModule();
    const nested = nestedOverUnitModule();
    const gateMod = gateNotModule();
    renderPalette({ level: fakeLevel('logic'), library: [unitMod, nested, gateMod] });
    expect(screen.queryByText(nested.name, { exact: false })).toBeNull();
    expect(screen.getByText(gateMod.name, { exact: false })).toBeTruthy();
    expect(screen.getByText('我的模块（1）')).toBeTruthy();
  });

  it('带 SeqSpec 的时序积木不被一刀切（"非纯门就隐藏"不是这条口径）', () => {
    const dff = dffModule();
    renderPalette({ level: fakeLevel('logic'), library: [dff] });
    expect(screen.getByText(dff.name, { exact: false })).toBeTruthy();
    expect(screen.getByText('我的模块（1）')).toBeTruthy();
    expect(screen.queryByText(NO_HINT)).toBeNull();
  });

  it('反证：时序关（judgeMode = timing）三个模块都在，计数 3，没有隐藏说明', () => {
    const mods = [unitNotModule(), nestedOverUnitModule(), gateNotModule()];
    renderPalette({ level: fakeLevel('timing'), library: mods });
    for (const m of mods) expect(screen.getByText(m.name, { exact: false }), m.name).toBeTruthy();
    expect(screen.getByText('我的模块（3）')).toBeTruthy();
    expect(screen.queryByText(NO_HINT)).toBeNull();
  });

  it('反证：自由模式（level = null）三个模块都在，逐字不变', () => {
    const mods = [unitNotModule(), nestedOverUnitModule(), gateNotModule()];
    renderPalette({ level: null, library: mods });
    for (const m of mods) expect(screen.getByText(m.name, { exact: false }), m.name).toBeTruthy();
    expect(screen.getByText('我的模块（3）')).toBeTruthy();
    expect(screen.queryByLabelText('隐藏本关不可用')).toBeNull(); // 自由模式没有那个过滤器
    expect(screen.queryByText(NO_HINT)).toBeNull();
  });

  it('三形态一致：桌面 / 横屏 / 竖屏精简下逻辑关都不列含元件的模块', () => {
    const unitMod = unitNotModule();
    const gateMod = gateNotModule();
    for (const portrait of [false, true]) {
      const { unmount } = renderPalette({
        level: fakeLevel('logic'),
        library: [unitMod, gateMod],
        portrait,
      });
      expect(screen.queryByText(unitMod.name, { exact: false }), `portrait=${portrait}`).toBeNull();
      expect(screen.getByText(gateMod.name, { exact: false })).toBeTruthy();
      unmount();
    }
  });

  it('与「隐藏本关不可用」的交互：门级挡掉的不算"已按…过滤"，也不留任何说明文字', () => {
    // ① 逻辑关 + 过滤器持久化为开 + **所有**玩家模块都被门级挡掉：
    //    不该说"已按「隐藏本关不可用」过滤"（过滤器没干这事），也不该说"隐藏了几个" —— 安静空着
    localStorage.setItem('lc-ui-palette-hide-locked', '1');
    const onlyUnit = renderPalette({ level: fakeLevel('logic'), library: [unitNotModule()] });
    expect(screen.queryByText(/已按「隐藏本关不可用」过滤/)).toBeNull();
    expect(screen.queryByText(NO_HINT)).toBeNull();
    expect(screen.getByText('我的模块（0）')).toBeTruthy();
    onlyUnit.unmount();

    // ② 过滤器**真的**过滤掉了东西（模块被关卡禁用）→ 那句提示照旧出现
    const gateMod = gateNotModule();
    const banned = renderPalette({
      level: fakeLevel('logic', [gateMod.name]),
      library: [gateMod],
    });
    expect(screen.getByText(/已按「隐藏本关不可用」过滤/)).toBeTruthy();
    banned.unmount();

    // ③ 时序关 + 过滤器：口径与改动前一致（visible == 全部玩家模块）
    const timing = renderPalette({ level: fakeLevel('timing'), library: [unitNotModule()] });
    expect(screen.queryByText(/已按「隐藏本关不可用」过滤/)).toBeNull();
    expect(screen.getByText('非门（元件版）', { exact: false })).toBeTruthy();
    timing.unmount();
  });

  it('口径守卫（数据驱动）：判据就是门级判定本人 —— 基础门全过，含元件的全挡', () => {
    const probeLib = gateProbeLibrary([
      ...teachingModulesFor('rtl').map((t) => stored(t)),
      unitNotModule(),
      nestedOverUnitModule(),
    ]);
    const checks: string[] = [];
    for (const name of ['非门', '与非门', '与门', '或门', '异或门', '同或门', '加3单元']) {
      const t = RTL_LIB.get(hashOf(name));
      if (!t) continue; // 该工艺族没有这个门
      if (!gateLevelUsable(stored(t), probeLib)) checks.push(`基础门「${name}」被判成不可用`);
    }
    expect(checks).toEqual([]);

    // 含元件的（含递归嵌套）→ 不可用，而且**是引擎自己说的理由**（不是"库里查不到"这种假红）
    const unitMod = unitNotModule();
    const nested = nestedOverUnitModule();
    const gateMod2 = gateNotModule();
    const dff = dffModule();
    const lib = gateProbeLibrary([
      ...teachingModulesFor('rtl').map((t) => stored(t)),
      unitMod,
      nested,
      gateMod2,
      dff,
    ]);
    expect(gateLevelUsable(unitMod, lib)).toBe(false);
    expect(gateLevelUsable(nested, lib)).toBe(false);
    expect(probeReason(unitMod, lib)).toContain('身体里含元件');
    expect(probeReason(nested, lib)).toContain('身体里含元件');
    // 反证：全门模块**没有**理由（门级判定接得住）
    expect(probeReason(gateMod2, lib)).toBe('');
    expect(probeReason(dff, lib)).toBe('');
  });

  /**
   * 用户报的 bug（最高优先级）：第 10 关「D 锁存器」通关后封装出来的模块，到第 11 关
   * 「主从 D 触发器」里**不见了** —— 因为门级引擎按**名字**查 `GATE_SEQ_SPECS`，而玩家的模块名
   * 对不上表（手动封装默认「我的模块」、老版本用关卡标题「D 锁存器」带空格）→ 探针返回 null
   * → 被当成"门级跑不动"整条藏掉。实测口径（本用例固化的对照表）：
   *   名字「D锁存器」（= 关卡 unlock.name）→ 跑得动；「D 锁存器」/「我的模块」/「D锁存器2」→ 曾经 null。
   */
  it('上一关产出的 D 锁存器，换个名字也必须列出来（用户报的 bug）', () => {
    for (const name of ['D锁存器', 'D 锁存器', '我的模块', 'D锁存器2']) {
      const latch = playerLatchNamed(name);
      const lib = gateProbeLibrary([...teachingLibrary(), latch]);
      // 判据层面：形状就是本关要用的时序积木 → 必须判成"跑得动"
      expect(gateLevelUsable(latch, lib), name).toBe(true);
      // 渲染层面：必须在「我的模块」里（卡片的 title 也按竖屏口径给全名）
      const view = renderPalette({ level: fakeLevel('logic'), library: [latch] });
      expect(cardNames(), name).toEqual([name]);
      expect(screen.getByText('我的模块（1）'), name).toBeTruthy();
      expect(screen.queryByText(NO_HINT), name).toBeNull();
      view.unmount();
    }
  });

  it('对照表：同形不同名，两个模块各判各的（按 hash 缓存的旧实现会串味）', () => {
    const namedLatch = playerLatchNamed('D锁存器');
    const renamedLatch = playerLatchNamed('我的模块');
    // 同形 → 同 hash（wrapModule 的 hash 不含名字，所以旧缓存必然把两者混成一个结论）
    expect(renamedLatch.hash).toBe(namedLatch.hash);
    // 先拿一个**缺依赖**的库问一次（真答案 false），再用完整库问 —— 结论不许被上一次污染
    const brokenLib = gateProbeLibrary([gateNotModule()]);
    const goodLib = gateProbeLibrary([...teachingLibrary(), gateNotModule()]);
    const gateMod = gateNotModule();
    expect(gateLevelUsable(gateMod, brokenLib)).toBe(false);
    expect(gateLevelUsable(gateMod, goodLib)).toBe(true);
    // 时序积木：名字对不上表也要 true（形状兜底），且两个名字结论一致
    expect(gateLevelUsable(renamedLatch, goodLib)).toBe(true);
    expect(gateLevelUsable(namedLatch, goodLib)).toBe(true);
  });

  it('原来该挡的还挡着：含元件的**组合**老模块（含递归）一律不列', () => {
    const unitMod = unitNotModule();
    const nested = nestedOverUnitModule();
    const latch = playerLatchNamed('我的模块');
    renderPalette({ level: fakeLevel('logic'), library: [unitMod, nested, latch] });
    expect(screen.queryByText(unitMod.name, { exact: false })).toBeNull();
    expect(screen.queryByText(nested.name, { exact: false })).toBeNull();
    expect(cardNames()).toEqual(['我的模块']);
    expect(screen.getByText('我的模块（1）')).toBeTruthy();
    // 口径：**形状对不上任何时序声明**的组合模块 → 才问门级探针
    const lib = gateProbeLibrary([...teachingLibrary(), unitMod, nested, latch]);
    expect(specByShape(unitMod)).toBeUndefined();
    expect(specByShape(nested)).toBeUndefined();
    expect(specByShape(latch)).toBeDefined();
    expect(gateLevelUsable(unitMod, lib)).toBe(false);
    expect(gateLevelUsable(nested, lib)).toBe(false);
  });

  it('真实关卡复现（第 11 关「主从 D 触发器」）：D锁存器在、老非门不在、基础门的非门照旧', () => {
    const dffLevel = ALL_LEVELS.find((l) => l.id === 's2-dff') as Level;
    const playerLatch = playerLatchNamed('我的模块'); // 上一关的成果（玩家自己起的名字）
    const oldUnitNot = unitNotModule(); // 第 1~7 关那种元件版非门
    renderPalette({ level: dffLevel, library: [playerLatch, oldUnitNot] });
    expect(cardNames()).toEqual(['我的模块']);
    expect(screen.getByText('我的模块（1）')).toBeTruthy();
    expect(screen.queryByText('非门（元件版）', { exact: false })).toBeNull();
    // 「基础门」那组照旧（本关给的门，非门在里面）
    expect(screen.getByText('基础门（5）')).toBeTruthy();
    expect(sectionCardNames('基础门')).toContain('非门');
    expect(screen.queryByText(NO_HINT)).toBeNull();
  });

  it('点击仍然有效：逻辑关里全门模块照旧能回调（没被这轮改动碰掉）', () => {
    const gateMod = gateNotModule();
    const picked: Array<Record<string, unknown>> = [];
    stubNarrow(false);
    render(
      <Palette
        placing={null}
        onPick={(p) => picked.push(p as Record<string, unknown>)}
        library={[...teachingLibrary(), gateMod, unitNotModule()]}
        level={fakeLevel('logic')}
        mode="logic"
      />,
    );
    const card = screen.getByText(gateMod.name, { exact: false }).closest('button');
    fireEvent.click(card as HTMLButtonElement);
    expect(picked).toEqual([{ kind: 'module', hash: gateMod.hash }]);
  });
});
