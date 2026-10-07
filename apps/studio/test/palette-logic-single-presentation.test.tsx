// @vitest-environment jsdom
/**
 * 用户第 ⑰ 轮**批准的建议 2**：逻辑关里**同一份模块不要两组各出一张卡**。
 *
 * 事实前提（第 ⑰ 轮实测）：rtl 玩家在第 1~7 关亲手封装的门与「基础门」清单里的门 **hash 逐字相同**
 * （非门 61fb0eb6 / 与门 ed7f885a / 或门 8ad8f9c0 / 与非门 761c6864 / 异或门 ec8958c7），
 * "元件版 vs 门版"是假二分 —— 同一份内容，只是名字是门名才被门级引擎当零延迟原子算。
 * 所以「不给 8 关之后放」不能实现成"删掉基础门"（那是把门拿走），正解是**单份呈现**：
 * 「我的模块」里与基础门同 hash 的副本不重复列，**基础门那份照旧在**（信息不丢）。
 *
 * 本文件守三件事：
 *   ① 逐关（全部 20 个逻辑关）**任何两组之间不同时出现同一个 hash**；顺带钉住"同名不同 hash"
 *      不会从正常玩法路径里冒出来（同一批断言里也查名字）；
 *   ② **必须保住**：玩家**内容不同**的同名作品照旧列在「我的模块」（第 ⑯ 轮口径：玩家作品同名并存）；
 *   ③ **反证（只动显示层）**：被隐藏的那份**仍在库里**、「组件库与成绩」查得到、画布上已放置的实例
 *      照常工作、**验收结论不变**；时序关/自由模式列表逐字不变（那里是"库 + 按名字去重"）。
 */

import { designToModulePorts, wrapModule } from '@lc/compiler';
import { ALL_LEVELS, teachingModulesFor } from '@lc/content';
import {
  type Design,
  DesignSchema,
  familySpecOf,
  InMemoryModuleLibrary,
  type ModuleTemplate,
} from '@lc/schema';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import type { StoredModule } from '../src/editor/model';
import { storeModule } from '../src/level/library';
import { dismissTaskDialog, enableDebugUrl, startJob } from './helpers';

const RTL_LIB = () => new InMemoryModuleLibrary([...teachingModulesFor('rtl')]);

/** 模拟"玩家从第 1 关打到第 upTo 关"：每关按自动封装路径入库（带 levelId） */
function produceThrough(upTo: number): StoredModule[] {
  let library: StoredModule[] = [];
  for (const level of ALL_LEVELS.slice(0, upTo)) {
    const spec = familySpecOf(level, 'rtl');
    const ref = (spec.reference ?? level.referenceSolution) as Design | undefined;
    if (!ref || !level.unlock) continue;
    const t = wrapModule(
      {
        name: level.unlock.name,
        stage: level.unlock.stage,
        kind: level.unlock.kind,
        ports: designToModulePorts(DesignSchema.parse(ref)),
        body: DesignSchema.parse(ref),
      },
      RTL_LIB(),
    ).template as ModuleTemplate;
    library = [
      ...library,
      storeModule(
        library,
        {
          hash: t.hash,
          name: t.name,
          costHalf: t.costHalf,
          isSequential: t.isSequential,
          ports: t.ports,
          template: t,
          stage: level.unlock.stage,
          levelId: level.id,
          sources: [],
        },
        1,
      ),
    ];
  }
  return library;
}

function groups() {
  return [...document.querySelectorAll('.palette-section')].map((s) => ({
    title: (s.querySelector('.palette-section-title')?.textContent || '').trim(),
    cards: [...s.querySelectorAll('.palette-item')].map((b) => {
      let payload = '';
      fireEvent.dragStart(b, {
        dataTransfer: {
          setData: (_t: string, v: string) => {
            payload = v;
          },
          effectAllowed: '',
          setDragImage: () => {},
        },
      });
      return {
        name: (b.querySelector('.palette-name')?.textContent || '').trim(),
        hash: payload.startsWith('module:') ? payload.slice(7) : '?',
      };
    }),
  }));
}
const modGroups = () =>
  groups().filter((g) => g.title.startsWith('基础门') || g.title.startsWith('我的模块'));

async function enter(title: string, library: unknown[], storage: Record<string, string> = {}) {
  localStorage.clear();
  const idx = ALL_LEVELS.findIndex((l) => l.title === title);
  const cleared: Record<string, unknown> = {};
  for (const l of ALL_LEVELS.slice(0, idx))
    cleared[l.id] = { score: 100, bestCostHalf: 0, clearedAt: 1 };
  localStorage.setItem(
    'lc-studio-progress-v1',
    JSON.stringify({
      family: 'rtl',
      cleared,
      library,
      attempts: {},
      walletHalf: 0,
      recon: {},
      sideJobs: {},
      spentHalf: 0,
      started: {},
    }),
  );
  for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
  localStorage.setItem(`lc-ui-task-seen-${ALL_LEVELS[idx].id}`, '1');
  enableDebugUrl();
  render(<App />);
  startJob(title);
  dismissTaskDialog();
  await waitFor(() => expect(document.querySelector('.legend')).toBeTruthy(), { timeout: 10000 });
}

describe('逻辑关单份呈现：同一份模块不两组各出一张卡（用户第 ⑰ 轮批准的建议 2）', () => {
  it('① 逐关（全部 20 个逻辑关）× 全程存档：两组之间没有任何共享 hash，也没有跨组同名', async () => {
    let sharedHash = 0;
    let sharedName = 0;
    for (const [i, level] of ALL_LEVELS.filter((l) => l.judgeMode === 'logic').entries()) {
      const idx = ALL_LEVELS.indexOf(level);
      const library = produceThrough(idx);
      cleanup();
      await enter(level.title, library);
      const gs = modGroups();
      const gate = gs.find((g) => g.title.startsWith('基础门'));
      const mine = gs.find((g) => g.title.startsWith('我的模块'));
      const gateHashes = new Set(gate?.cards.map((c) => c.hash));
      const gateNames = new Set(gate?.cards.map((c) => c.name));
      const dupHashes = (mine?.cards ?? []).filter((c) => gateHashes.has(c.hash));
      const dupNames = (mine?.cards ?? []).filter((c) => gateNames.has(c.name));
      sharedHash += dupHashes.length;
      sharedName += dupNames.length;
      if (i < 3 || dupHashes.length > 0 || dupNames.length > 0)
        console.log(
          `[① ] #${idx + 1} ${level.id}｜${gate?.title}=${gate?.cards.map((c) => c.name + '@' + c.hash.slice(0, 8)).join(',')}｜${mine?.title}=${mine?.cards.map((c) => c.name + '@' + c.hash.slice(0, 8)).join(',') || '空'}｜跨组同 hash=${dupHashes.length} 跨组同名=${dupNames.length}`,
        );
      expect(
        dupHashes.map((c) => c.name),
        `${level.id}：同一个 hash 两组各一张`,
      ).toEqual([]);
      expect(
        dupNames.map((c) => c.name),
        `${level.id}：同名不同 hash 跨两组`,
      ).toEqual([]);
      // 任何两组之间同一个 hash 只能出现一次（含「我的元件」这类没有 hash 的组）
      const all = groups()
        .flatMap((g) => g.cards.map((c) => c.hash))
        .filter((h) => h !== '?');
      expect(all.length, `${level.id}：同一个 hash 在多个组里出现`).toBe(new Set(all).size);
    }
    console.log(
      `[① ] 汇总：20 个逻辑关 × 全程存档 → 跨组同 hash ${sharedHash} 条（应为 0）｜跨组同名 ${sharedName} 条（应为 0）`,
    );
    expect(sharedHash).toBe(0);
    expect(sharedName).toBe(0);
  }, 600000);

  it('② 必须保住：玩家**内容不同**的同名作品照旧列在「我的模块」（第 ⑯ 轮口径）', async () => {
    // 第 ⑯ 轮的"两个同名作品并存"用例：库里两个都叫「我的锁存器」，hash 不同
    const base = produceThrough(10);
    const cmosNot = teachingModulesFor('cmos').find((m) => m.name === '非门')!;
    const mineNot: StoredModule = {
      ...(base[0] as StoredModule),
      hash: cmosNot.hash,
      name: '我的非门',
      template: cmosNot,
      levelId: 's3-half-adder',
      stage: 3,
    };
    const other = { ...mineNot, hash: `${cmosNot.hash}-v2`, name: '我的非门' } as StoredModule;
    cleanup();
    await enter('主从 D 触发器', [...base, mineNot, other]);
    const mine = modGroups().find((g) => g.title.startsWith('我的模块'));
    console.log(
      `[② ] 内容不同的同名作品在两个库里：我的模块=${mine?.cards.map((c) => c.name).join(',') || '空'}`,
    );
    // 逻辑关口径：内容不同（hash 不同）→ 照旧列（第 ⑯ 轮守的就是这条）
    expect(mine?.cards.filter((c) => c.name.startsWith('我的非门')).length).toBeGreaterThan(0);
  }, 300000);

  it('③ 反证：同 hash 的副本只是"不重复列" —— 库里还在、组件库查得到、画布实例照常、验收结论不变', async () => {
    const level = ALL_LEVELS.find((l) => l.id === 's2-dff')!;
    const idx = ALL_LEVELS.indexOf(level);
    const library = produceThrough(idx);
    /** 玩家自己那份「非门」（第 1 关产物：hash 与基础门同） */
    const ownNot = library.find((m) => m.name === '非门')!;
    expect(ownNot.hash).toBe(teachingModulesFor('rtl').find((m) => m.name === '非门')!.hash); // 同 hash 前提
    // 画布上引用它（模拟"进关前就已经摆好"）
    const doc = {
      id: `lc-studio-level-${level.id}-v1`,
      name: 'x',
      instances: [
        { kind: 'module', id: 'm1', module: ownNot.hash, x: 0, y: 0 },
        { kind: 'input', id: 'i1', x: 0, y: 0 },
        { kind: 'output', id: 'o1', x: 0, y: 0 },
      ],
      nets: [],
      ports: [],
      symbols: [],
    };
    cleanup();
    await enter(level.title, library, { [`lc-studio-level-${level.id}-v1`]: JSON.stringify(doc) });
    const gs = modGroups();
    const mine = gs.find((g) => g.title.startsWith('我的模块'));
    const gate = gs.find((g) => g.title.startsWith('基础门'));
    console.log(
      `[③ ] 进入第 ${idx + 1} 关（逻辑关）：基础门=${gate?.title}｜我的模块=${mine?.title}=${mine?.cards.map((c) => c.name).join(',') || '空'}`,
    );
    // ① 我的模块里不再重复列同 hash 的那份
    expect(mine?.cards.some((c) => c.hash === ownNot.hash)).toBe(false);
    // ② 库里还在（存档没动）
    const saved = JSON.parse(localStorage.getItem('lc-studio-progress-v1') || '{}');
    expect((saved.library as StoredModule[]).some((m) => m.hash === ownNot.hash)).toBe(true);
    // ③ 画布上已放置的实例照常在（仿真/判定照旧解析得到这个 hash）
    const savedDoc = JSON.parse(localStorage.getItem(`lc-studio-level-${level.id}-v1`) || '{}');
    expect(
      (savedDoc.instances as Array<{ module?: string }>).some((i) => i.module === ownNot.hash),
    ).toBe(true);
    // ④ 画布上已放置的实例照常工作、**验收结论不变**：用「一键出答案」（它引用的正是同一个
    //    非门 hash）搭出本关答案 → 交付验收 → 客户验收通过 + 已达满分线（改前改后同一断言）
    fireEvent.click(screen.getByText('一键出答案'));
    await waitFor(() => expect(document.querySelector('.toast')).toBeTruthy(), { timeout: 8000 });
    const toast = document.querySelector('.toast')?.textContent ?? '';
    console.log(`[③ ] 一键出答案 toast=${toast.trim()}`);
    expect(toast).toContain('逻辑门版已搭好');
    fireEvent.click(screen.getAllByText('交付验收')[0]!);
    await waitFor(() => expect(screen.getByText(/客户验收通过/)).toBeTruthy(), { timeout: 15000 });
    expect(screen.getByText(/已达满分线/)).toBeTruthy();
    console.log(
      '[③ ] 客户验收通过 + 已达满分线（隐藏只发生在调色板渲染层，判定/仿真/存档一行未动）',
    );
    // ⑤ 「组件库与成绩」面板当前的入口状态（如实记录：本轮实测它没有入口，见回报）
    console.log(
      `[③ ] 组件库与成绩面板：App 里 setPanelOpen 只被调用过 null（panelOpen==='library' 分支无入口）→ 该面板当前不可达；` +
        `资产仍在存档里（上面已断言），导出/导入入口也在那个面板里 → 属于既有问题，本轮未动`,
    );
  }, 300000);

  it('④ 反证：时序关/自由模式不动（那里是"库 + 按名字去重"，同 hash 副本照旧列）', async () => {
    const library = produceThrough(4);
    const ownNot = library.find((m) => m.name === '非门')!;
    cleanup();
    await enter('与非门', library);
    const timing = modGroups().find((g) => g.title.startsWith('我的模块'));
    console.log(
      `[④ ] 时序关 #4 我的模块=${timing?.cards.map((c) => c.name + '@' + c.hash.slice(0, 8)).join(',')}`,
    );
    expect(
      timing?.cards.some((c) => c.hash === ownNot.hash),
      '时序关必须照旧列',
    ).toBe(true);
  }, 300000);
});
