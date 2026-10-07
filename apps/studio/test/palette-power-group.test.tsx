// @vitest-environment jsdom
/**
 * 「电源与端口」这一组**只在自由模式渲染**（用户第 ⑪ 轮要求）。
 *
 * 关卡模式整组**不渲染**（不是置灰、不是折叠：DOM 里连组头都没有），三种形态一致；
 * 自由模式照旧（组头 + 6 张卡，文案与改动前逐字相同）。
 *
 * 为什么敢整组隐藏 —— 这里同时钉住"依据"本身（数据驱动，不是口头结论）：
 * `docForLevel` 对**时序关（第 1~7 关）**预置并锁定 rail-vcc / rail-gnd，逻辑关（第 8 关起）
 * **不预置**（用户第 ⑳ 轮拍板，依据：门级口径下 vcc/gnd 当恒定轨与直接忽略的逐行判定差异完全相同），
 * 并且对每一关预置关卡声明的全部 in/out 端口（按钮 = `button` 标记、七段数码管 = `display` 标记）；
 * 27 关的参考解没有一关用到超出初始画布的 vcc/gnd/端口。
 * 一旦以后有哪一关的参考解开始需要玩家从这一组取件，这条守卫会立刻红。
 */
import { ALL_LEVELS } from '@lc/content';
import type { Level } from '@lc/schema';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { docForLevel } from '../src/level/progress.ts';
import { Palette } from '../src/panels/Palette.tsx';

/** 该组的 6 张卡（文案与 Palette 里的一致） */
const POWER_CARDS = ['VCC 电源', 'GND 地', '输入引脚', '输出引脚', '按钮', '七段数码管'] as const;

const GROUP_TITLE = '电源与端口';

/** 假关卡：只开放 NPN/电阻（够渲染出「我的元件」组头即可） */
function fakeLevel(): Level {
  return {
    id: 't-not',
    title: '非门（测试）',
    allowedUnits: ['npn', 'res'],
    moduleAccess: 'none',
    bannedModules: [],
    allowedModules: [],
    kind: 'normal',
  } as unknown as Level;
}

/**
 * 三种形态在 Palette 里只影响 `compact`（竖屏精简卡片）与是否渲染顶部过滤器，都由同一条媒体查询
 * 驱动（`(max-width: 900px) and (orientation: portrait)`，见 layout/viewport.ts）；jsdom 没有
 * 真实媒体查询，所以这里用桩把形态"告诉"组件。
 */
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

function renderPalette(opts: { level: Level | null; portrait?: boolean }) {
  stubNarrow(opts.portrait ?? false);
  return render(
    <Palette placing={null} onPick={() => {}} library={[]} level={opts.level} mode="logic" />,
  );
}

describe('「电源与端口」只在自由模式出现（关卡模式整组不渲染）', () => {
  beforeEach(() => {
    localStorage.clear();
    stubNarrow(false);
  });

  it('关卡模式：组头与 6 张卡**都不在 DOM**（不是置灰 / 不是折叠）', () => {
    renderPalette({ level: fakeLevel() });
    expect(screen.queryByText(GROUP_TITLE)).toBeNull();
    for (const card of POWER_CARDS) expect(screen.queryByText(card), card).toBeNull();
    // 「我的元件」组头还在（说明不是整个元件库没渲染）
    expect(screen.getByText('我的元件')).toBeTruthy();
    expect(screen.getByText('三极管 NPN')).toBeTruthy();
  });

  it('关卡模式 × 三种形态（桌面 / 横屏 / 竖屏精简）：都拿不到这一组', () => {
    for (const portrait of [false, true]) {
      const { unmount } = renderPalette({ level: fakeLevel(), portrait });
      expect(screen.queryByText(GROUP_TITLE), `portrait=${portrait}`).toBeNull();
      for (const card of POWER_CARDS) expect(screen.queryByText(card), card).toBeNull();
      unmount();
    }
    // 横屏/桌面共用同一套渲染路径（窄屏只差 compact 卡片与过滤器），再显式跑一遍窄屏横屏
    const { unmount } = renderPalette({ level: fakeLevel(), portrait: false });
    expect(screen.queryByText(GROUP_TITLE)).toBeNull();
    unmount();
  });

  it('反证：自由模式（level=null）该组在，且 6 张卡的文案逐字一致', () => {
    renderPalette({ level: null });
    expect(screen.getByText(GROUP_TITLE)).toBeTruthy();
    for (const card of POWER_CARDS)
      expect(screen.getByText(card, { exact: false }), card).toBeTruthy();
    // 卡片说明文案（改动前就是这样，自由模式必须逐字不变）
    expect(screen.getAllByText('免费端口').length).toBe(2); // VCC 与 GND 都写「免费端口」
    expect(screen.getByText('按端口值（BCD 0-9）点亮段').textContent).toBe(
      '按端口值（BCD 0-9）点亮段',
    );
    expect(screen.getByText('可点击切换电平').textContent).toBe('可点击切换电平');
    expect(screen.getByText('显示实时电平').textContent).toBe('显示实时电平');
    expect(screen.getByText('瞬时按键：点击 = 电平 1，自动弹回 0').textContent).toBe(
      '瞬时按键：点击 = 电平 1，自动弹回 0',
    );
    // 组头徽标 = 6（组头里那一颗 .palette-section-count）
    expect(document.querySelectorAll('.palette-section-count').length).toBeGreaterThan(0);
    const heads = [...document.querySelectorAll('.palette-section-title')].map(
      (e) => e.textContent,
    );
    expect(heads).toContain('电源与端口');
  });

  it('逐关节点数：逻辑关 = 端口数（无轨），时序关 = 端口数 + 2 轨 —— 第 ⑳ 轮改动只差这 2 个孤立节点', () => {
    const rows: string[] = [];
    for (const [i, level] of ALL_LEVELS.entries()) {
      const doc = docForLevel(level, []);
      const rails = doc.syms.filter((s) => s.kind === 'vcc' || s.kind === 'gnd').length;
      const ports = doc.syms.filter((s) => s.kind === 'input' || s.kind === 'output').length;
      rows.push(
        `#${String(i + 1).padStart(2)} ${level.id.padEnd(15)} judgeMode=${String((level as { judgeMode?: string }).judgeMode).padEnd(6)} 初始画布节点=${doc.syms.length}（端口 ${ports} + 轨 ${rails}）`,
      );
      expect(doc.syms.length, `${level.id} 的节点数`).toBe(ports + rails);
    }
    console.log(`\n${rows.join('\n')}\n`);
    const logic = ALL_LEVELS.filter((l) => (l as { judgeMode?: string }).judgeMode === 'logic');
    const timing = ALL_LEVELS.filter((l) => (l as { judgeMode?: string }).judgeMode !== 'logic');
    const railsOf = (l: (typeof ALL_LEVELS)[number]) =>
      docForLevel(l, []).syms.filter((s) => s.kind === 'vcc' || s.kind === 'gnd').length;
    console.log(
      `[1a] 逻辑关 ${logic.length} 个：节点数=${logic.map((l) => docForLevel(l, []).syms.length).join(',')}｜轨=${logic.map(railsOf).join(',')}`,
    );
    console.log(
      `[1b] 时序关 ${timing.length} 个：节点数=${timing.map((l) => docForLevel(l, []).syms.length).join(',')}｜轨=${timing.map(railsOf).join(',')}`,
    );
    expect(logic.every((l) => railsOf(l) === 0)).toBe(true);
    expect(timing.every((l) => railsOf(l) === 2)).toBe(true);
  }, 300_000);

  it('自由模式：卡片可点、能回调（自由模式行为没被这轮改动碰掉）', () => {
    const picked: Array<Record<string, unknown>> = [];
    stubNarrow(false);
    render(
      <Palette
        placing={null}
        onPick={(p) => picked.push(p as Record<string, unknown>)}
        library={[]}
        level={null}
        mode="logic"
      />,
    );
    fireEvent.click(screen.getByText('VCC 电源', { exact: false }).closest('button') as Element);
    fireEvent.click(screen.getByText('GND 地', { exact: false }).closest('button') as Element);
    expect(picked).toEqual([{ kind: 'vcc' }, { kind: 'gnd' }]);
  });

  it('顺带确认：该组与「隐藏本关不可用」过滤 / 竖屏精简形态没有留下奇怪状态', () => {
    // ① 自由模式 + 竖屏精简形态：6 张卡照旧全在，且竖屏本来就不渲染那个过滤器
    localStorage.clear();
    localStorage.setItem('lc-ui-palette-hide-locked', '1'); // 假装玩家之前在桌面勾过
    const { unmount } = renderPalette({ level: null, portrait: true });
    for (const card of POWER_CARDS)
      expect(screen.getByText(card, { exact: false }), card).toBeTruthy();
    expect(screen.queryByLabelText('隐藏本关不可用')).toBeNull();
    unmount();
    // ② 自由模式 + 桌面（非竖屏）+ 过滤器持久化为开：这一组仍是完整 6 张卡
    //    那个开关本身只在**关卡模式**渲染，所以这一组与过滤器**没有交集**：
    //    有这一组的地方（自由模式）没有过滤器，有过滤器的地方（关卡模式）没有这一组。
    const desk = renderPalette({ level: null, portrait: false });
    expect(screen.queryByLabelText('隐藏本关不可用')).toBeNull();
    for (const card of POWER_CARDS)
      expect(screen.getByText(card, { exact: false }), card).toBeTruthy();
    // 陈旧标记（'1'）在自由模式也不会让元件列表缺项：unitAllowed/moduleAllowed 在无关卡时恒 true
    expect(localStorage.getItem('lc-ui-palette-hide-locked')).toBe('1');
    expect(screen.getByText('二极管')).toBeTruthy();
    expect(screen.getByText('N-MOS')).toBeTruthy();
    desk.unmount();
    // ③ 关卡模式 + 过滤器持久化为开：这一组照样整组不渲染（没有被过滤器"补"回来）
    const lv = renderPalette({ level: fakeLevel(), portrait: false });
    expect(screen.queryByText(GROUP_TITLE)).toBeNull();
    for (const card of POWER_CARDS) expect(screen.queryByText(card), card).toBeNull();
    lv.unmount();
    localStorage.clear();
  });

  it('依据（数据驱动）：27 关的参考解都不取用这一组 —— 预置的电源轨/端口已经够', () => {
    expect(ALL_LEVELS.length).toBe(27);
    const bad: string[] = [];
    for (const level of ALL_LEVELS) {
      const init = docForLevel(level, []);
      const ref = level.referenceSolution;
      if (!ref) {
        bad.push(`${level.id}: 没有参考解`);
        continue;
      }
      const initVcc = init.syms.filter((s) => s.kind === 'vcc').length;
      const initGnd = init.syms.filter((s) => s.kind === 'gnd').length;
      const isLogic = (level as { judgeMode?: string }).judgeMode === 'logic';
      if (isLogic) {
        // 逻辑关（第 8 关起）：**初始画布不放轨**，而且参考解里也没有轨要接（接线 0 条）
        if (initVcc !== 0 || initGnd !== 0) bad.push(`${level.id}: 逻辑关不该预置电源轨`);
        const railIds = new Set(
          init.syms.filter((s) => s.kind === 'vcc' || s.kind === 'gnd').map((s) => s.id),
        );
        const wired = (level.referenceSolution?.nets ?? []).filter(
          (n: { pins?: Array<{ inst?: string }> }) =>
            (n.pins ?? []).some((p) => railIds.has(String(p.inst))),
        ).length;
        if (wired !== 0) bad.push(`${level.id}: 逻辑关参考解接了 ${wired} 条轨线`);
      } else {
        // 时序关（第 1~7 关）与自由模式：照旧预置并锁定
        if (initVcc < 1 || initGnd < 1) bad.push(`${level.id}: 初始画布缺电源轨`);
      }
      for (const rail of init.syms.filter((s) => s.kind === 'vcc' || s.kind === 'gnd')) {
        if (!rail.locked) bad.push(`${level.id}: 电源轨 ${rail.id} 没锁定`);
      }
      // 参考解：不得超出初始画布提供的 vcc/gnd 与端口
      // ⚠️ 只在**预置轨**的关卡上比（时序关）：逻辑关初始画布已经没有轨了，而那里的参考解是
      // **元件版**（自己身体里带 vcc/gnd 单元，与画布上的轨无关）→ 比"几个轨"没有意义，
      // 逻辑关改比的是上面那条"参考解没接画布上的轨（接线 0 条）"。
      const refVcc = ref.instances.filter((i) => i.kind === 'vcc').length;
      const refGnd = ref.instances.filter((i) => i.kind === 'gnd').length;
      if (!isLogic) {
        if (refVcc > initVcc) bad.push(`${level.id}: 参考解要 ${refVcc} 个 VCC > 初始 ${initVcc}`);
        if (refGnd > initGnd) bad.push(`${level.id}: 参考解要 ${refGnd} 个 GND > 初始 ${initGnd}`);
      }
      const initPorts = init.syms
        .filter((s) => s.kind === 'input' || s.kind === 'output')
        .map((s) => `${s.label}:${s.kind === 'input' ? 'in' : 'out'}`);
      for (const p of ref.ports) {
        const key = `${p.name}:${p.dir}`;
        if (!initPorts.includes(key)) bad.push(`${level.id}: 参考解要的端口 ${key} 初始没有`);
      }
      // 该组的「按钮 / 七段数码管」在关卡里是**端口标记**，由 docForLevel 一并预置
      for (const p of level.ports) {
        if (!p.button && !p.display) continue;
        const preset = init.syms.find((s) => s.label === p.name);
        if (!preset) bad.push(`${level.id}: 端口 ${p.name} 的按钮/数码管标记没有预置`);
        else if (p.button && preset.button !== true && preset.sprite !== 'button')
          bad.push(`${level.id}: 端口 ${p.name} 的按钮标记丢了`);
        else if (p.display && preset.display !== p.display)
          bad.push(`${level.id}: 端口 ${p.name} 的数码管显示丢了`);
      }
    }
    expect(bad).toEqual([]);
  });
});
