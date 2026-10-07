// @vitest-environment jsdom
/**
 * **「基础门」只在第 8 关起才出现**（用户第 ⑳ 轮逐字口径）：
 *   「基础门只在 8 关开始才有。1~7 关中，1~3 关只有元件，4-7 关可以有前面关卡添加的模块
 *    （我的模块中）。8 关开始，才有基础门，不用 1~7 关元件组成的模块。全部改成逻辑门模块」
 *
 * 这条护栏逐关（27 关）钉三件事：
 *   ① 基础门组：**逻辑关（第 8 关起）才有**，1~7 关连组头都不渲染；
 *   ② 4~7 关：看不到基础门，但「我的模块」里**能拿到前面关卡产出的模块**（带 levelId 的那些）；
 *   ③ 第 8 关起：看得到基础门（= 本关权威清单），**看不到 1~7 关产出的元件模块**。
 *
 * 顺带回答那个取舍：这样一来**不需要"逐关门表"** —— 分界就是判定的 `judgeMode`
 * （实测 27 关里 #1~#7 = timing、#8~#27 = logic，与"第 8 关"完全重合；见 ④ 的断言）。
 */
import { ALL_LEVELS, teachingModulesFor } from '@lc/content';
import type { Level } from '@lc/schema';
import { cleanup, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StoredModule } from '../src/editor/model';
import { gateCatalogFor } from '../src/level/library';
import { Palette } from '../src/panels/Palette.tsx';

const mod = (over: Partial<StoredModule> & { hash: string; name: string }): StoredModule =>
  ({
    version: '1.0.0',
    stage: 1,
    costHalf: 10,
    isSequential: false,
    ports: [{ name: 'a', dir: 'in', width: 1 }],
    template: null,
    sources: [],
    createdAt: 0,
    ...over,
  }) as StoredModule;

/** 第 1~3 关（时序关）产出的元件模块：带 levelId、stage=1 */
const timingBuilt = [
  mod({ hash: 'lv-1', name: '第 1 关产的非门', levelId: 's1-not', stage: 1 }),
  mod({ hash: 'lv-2', name: '第 2 关产的与门', levelId: 's1-and', stage: 1 }),
  mod({ hash: 'lv-3', name: '第 3 关产的或门', levelId: 's1-or', stage: 1 }),
];
/** 第 10 关（逻辑关）产出的模块：带 levelId、stage=2 */
const logicBuilt = mod({
  hash: 'lv-10',
  name: '第 10 关产的 D 锁存器',
  levelId: 's2-d-latch',
  stage: 2,
  isSequential: true,
});
/** 自由模式搭的：无 levelId + stage=1 → 关卡里一律不列 */
const freeBuilt = mod({ hash: 'free-1', name: '自由搭的', stage: 1 });
/** 教学积木（基础门那种）：teaching=true，永远不进「我的模块」 */
const teaching = {
  ...mod({ hash: teachingModulesFor('rtl')[0]!.hash, name: '非门', stage: 3 }),
  teaching: true,
} as StoredModule;

const LIBRARY: StoredModule[] = [...timingBuilt, logicBuilt, freeBuilt, teaching];

/** 关卡的 section 标题列表（DOM 顺序） */
const sectionTitles = (): string[] =>
  [...document.querySelectorAll('.palette-section-title')].map((s) => (s.textContent ?? '').trim());

const hasSection = (prefix: string): boolean => sectionTitles().some((t) => t.startsWith(prefix));

const moduleNames = (): string[] => {
  const sec = [...document.querySelectorAll('.palette-section')].find((s) =>
    (s.querySelector('.palette-section-title')?.textContent ?? '').startsWith('我的模块'),
  );
  return sec
    ? [...sec.querySelectorAll('.palette-item .palette-name')].map((n) =>
        (n.textContent ?? '').trim(),
      )
    : [];
};

const renderPaletteFor = (level: Level | null) =>
  render(
    <Palette
      placing={null}
      onPick={() => {}}
      library={LIBRARY}
      level={level}
      mode="logic"
      gateCatalog={gateCatalogFor('rtl')}
    />,
  );

describe('基础门只在第 8 关起出现（逐关 27 关）', () => {
  beforeEach(() => localStorage.clear());

  it('① + ② + ③ 逐关：基础门组的有无、前关产出可见性、1~7 关产出在 8 关起不可见', () => {
    const rows: string[] = [];
    const bad: string[] = [];
    for (const [i, level] of ALL_LEVELS.entries()) {
      const isLogic = (level as { judgeMode?: string }).judgeMode === 'logic';
      cleanup();
      renderPaletteFor(level);
      const titles = sectionTitles();
      const gates = hasSection('基础门');
      const names = moduleNames();
      rows.push(
        `#${String(i + 1).padStart(2)} ${level.id.padEnd(15)} judgeMode=${String((level as { judgeMode?: string }).judgeMode).padEnd(6)} 基础门组=${gates ? '有' : '无'}｜我的模块=[${names.join('、')}]｜组=[${titles.map((t) => t.split('（')[0]).join('|')}]`,
      );
      // ① 基础门组只有当关是逻辑关才有
      if (gates !== isLogic) bad.push(`#${i + 1} ${level.id}: 基础门组=${gates}，应为 ${isLogic}`);
      // ② 1~7 关（时序关）：不许有基础门，但必须能看到第 1~3 关的产出
      if (!isLogic) {
        if (gates) bad.push(`#${i + 1} ${level.id}: 时序关不该有基础门组`);
        for (const m of timingBuilt)
          if (!names.includes(m.name))
            bad.push(`#${i + 1} ${level.id}: 看不到前关产出「${m.name}」`);
      } else {
        // ③ 8 关起：看得到基础门，看不到 1~7 关产出的元件模块
        for (const m of timingBuilt)
          if (names.includes(m.name))
            bad.push(`#${i + 1} ${level.id}: 不该列出元件关产出「${m.name}」`);
      }
      // 自由模式搭的：任何关卡里都不许出现
      if (names.includes(freeBuilt.name)) bad.push(`#${i + 1} ${level.id}: 列出了自由模式搭的模块`);
    }
    cleanup();
    console.log(`\n${rows.join('\n')}\n`);
    expect(bad).toEqual([]);
  }, 300_000);

  it('④ 分界核对：judgeMode==="logic" 的关卡编号连续且正好从第 8 关开始', () => {
    const timing = ALL_LEVELS.map((l, i) => ({
      i: i + 1,
      logic: (l as { judgeMode?: string }).judgeMode === 'logic',
    }));
    const firstLogic = timing.find((r) => r.logic)?.i;
    const lastTiming = [...timing].reverse().find((r) => !r.logic)?.i;
    const contiguous = timing
      .filter((r) => r.logic)
      .every((r, k, arr) => k === 0 || r.i === (arr[k - 1]?.i ?? 0) + 1);
    console.log(
      `[2d] 第一个逻辑关=#${String(firstLogic)}｜最后一个时序关=#${String(lastTiming)}｜逻辑关编号连续=${contiguous}｜逻辑关数=${timing.filter((r) => r.logic).length}`,
    );
    expect(firstLogic, '“第 8 关起”与 judgeMode 分界必须重合，否则停下回报').toBe(8);
    expect(lastTiming).toBe(7);
    expect(contiguous).toBe(true);
  }, 300_000);

  it('⑤ 自由模式（没有关卡）：照旧「库里有什么列什么」，我的模块全列 —— 不受本改动影响', () => {
    cleanup();
    renderPaletteFor(null);
    const titles = sectionTitles();
    const names = moduleNames();
    console.log(
      `[2e] 自由模式组=[${titles.map((t) => t.split('（')[0]).join('|')}]｜我的模块=[${names.join('、')}]`,
    );
    // 卡片文字里带「时序」之类徽标 → 用前缀匹配
    for (const want of [freeBuilt.name, logicBuilt.name, ...timingBuilt.map((m) => m.name)])
      expect(
        names.some((n) => n.startsWith(want)),
        `自由模式应当列出「${want}」，实际=[${names.join('、')}]`,
      ).toBe(true);
    // 注：自由模式**本来就没有**「基础门」组（渲染条件里带 `level &&`，改动前就如此）——
    // 所以"基础门只在第 8 关起"这条改动按定义波及不到自由模式；这里只钉它照旧不受影响。
    expect(titles.some((t) => t.startsWith('基础门'))).toBe(false);
    expect(titles.some((t) => t.startsWith('电源与端口'))).toBe(true);
  }, 300_000);
});
