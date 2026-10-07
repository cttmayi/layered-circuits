// @vitest-environment jsdom
/**
 * 用户第 ⑰ 轮拍板：「**1~7 关创建的模块就不要往 8 关之后放了**」。
 *
 * 口径：逻辑关（`judgeMode === 'logic'`，第 8 关起）的「我的模块」**不得出现元件/时序关
 * （第 1~7 关、教学关、自由模式的元件画布）产出的模块** —— 它们在门级引擎里是"含元件的组合
 * 模块"，会被如实拒绝并静默回落元件引擎（延迟/强弱语义跟着变），不是逻辑关的积木。
 *
 * 判据（见 `level/library.ts` 的 `producedInElementLevel`）：
 *   ① **产出处 provenance**（优先）：自动封装会往存档写 `levelId`（= 交付验收时那一关的 id）
 *      → 查那关的 `judgeMode`，非 `logic` 就隐藏。事实判据，不猜内容。
 *   ② **内容代理**（没有 `levelId` 时：自由模式手动封装 / 加字段之前的老存档）：
 *      `stage === 1 && 身体含元件`。仅看"含元件"会误伤 —— rtl 族连门版积木的身体都是元件搭的，
 *      实测会把玩家第 10 关产出的 D 锁存器一起藏掉，所以必须叠加 stage。
 *
 * 本文件同时守住**不许被推翻**的两条：
 *   · 逻辑关产出的时序模块（D 锁存器等）必须照旧可见（真实玩家路径：wrapModule + storeModule）；
 *   · 反证：1~7 关本身进入时，这些模块照旧列着（玩家在原关卡里的东西不许被藏）。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { designToModulePorts, wrapModule } from '@lc/compiler';
import { ALL_LEVELS, teachingModulesFor } from '@lc/content';
import {
  type Design,
  DesignSchema,
  familySpecOf,
  InMemoryModuleLibrary,
  type ModuleTemplate,
} from '@lc/schema';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import type { StoredModule } from '../src/editor/model';
import {
  bodyHasUnit,
  builtOutsideLevels,
  gateCatalogFor,
  producedInElementLevel,
  storeModule,
} from '../src/level/library';
import { gateLevelUsable, gateProbeLibrary } from '../src/sim/gate-usable';
import { dismissTaskDialog, enableDebugUrl, startJob } from './helpers';

const RTL_LIB = () => new InMemoryModuleLibrary([...teachingModulesFor('rtl')]);

/** 教学积木转成 StoredModule 形态（`teaching: true`，只用来建"画布库"给探针） */
function teachingAsStored(family: 'rtl' | 'ttl' | 'cmos'): StoredModule[] {
  return teachingModulesFor(family).map(
    (m) =>
      ({
        hash: m.hash,
        name: m.name,
        version: m.version,
        stage: m.stage,
        costHalf: m.costHalf,
        isSequential: m.isSequential,
        ports: m.ports,
        template: m,
        sources: [],
        createdAt: 0,
        teaching: true,
      }) as unknown as StoredModule,
  );
}

/** 模拟"玩家从第 1 关打到第 upTo 关"的产出：每关按自动封装路径入库（**带 levelId**） */
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

function cards(prefix: string) {
  const sec = [...document.querySelectorAll('.palette-section')].find((s) =>
    (s.querySelector('.palette-section-title')?.textContent || '').startsWith(prefix),
  );
  if (!sec) return { title: '(无)', cards: [] as Array<{ name: string; hash: string }> };
  return {
    title: (sec.querySelector('.palette-section-title')?.textContent || '').trim(),
    cards: [...sec.querySelectorAll('.palette-item')].map((b) => {
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
  };
}

async function enter(title: string, library: unknown[]): Promise<void> {
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
  localStorage.setItem(`lc-ui-task-seen-${ALL_LEVELS[idx].id}`, '1');
  enableDebugUrl();
  render(<App />);
  startJob(title);
  dismissTaskDialog();
  await waitFor(() => expect(document.querySelector('.legend')).toBeTruthy(), { timeout: 10000 });
}

const logicLevels = ALL_LEVELS.filter((l) => l.judgeMode === 'logic');

describe('逻辑关不列"元件/时序关产出的模块"（用户第 ⑰ 轮）', () => {
  it('① 数据前提：没有任何逻辑关是 stage 1（内容代理的前提，内容改了这条先红）', () => {
    const stage1Logic = logicLevels.filter((l) => l.stage === 1).map((l) => l.id);
    const stage1Timing = ALL_LEVELS.filter((l) => l.judgeMode !== 'logic').map((l) => l.stage);
    console.log(
      `[前提] 逻辑关 ${logicLevels.length} 个的 stage=${[...new Set(logicLevels.map((l) => l.stage))].join('/')}｜'stage=1 的逻辑关'=${stage1Logic.length}｜非逻辑关 ${
        ALL_LEVELS.length - logicLevels.length
      } 个的 stage=${[...new Set(stage1Timing)].join('/')}`,
    );
    expect(stage1Logic).toEqual([]);
  });

  it('② 逐关（全部 20 个逻辑关）：我的模块不含任何元件/时序关产出的模块，且含逻辑关产出的时序模块', async () => {
    let listedElementLevel = 0;
    let missingLogicProduce = 0;
    for (const [i, level] of logicLevels.entries()) {
      const idx = ALL_LEVELS.indexOf(level);
      const library = produceThrough(idx);
      const byHash = new Map(library.map((m) => [m.hash, m]));
      cleanup();
      await enter(level.title, library);
      const mine = cards('我的模块');
      const rows = mine.cards.map((c) => {
        const p = byHash.get(c.hash);
        const from = p?.levelId ?? '(无 provenance)';
        const mode = p?.levelId
          ? (ALL_LEVELS.find((l) => l.id === p.levelId)?.judgeMode ?? 'timing')
          : '-';
        return `${c.name}@${c.hash.slice(0, 8)}[产出关=${from}(${mode})]`;
      });
      const badOnes = mine.cards.filter((c) => {
        const p = byHash.get(c.hash);
        return Boolean(p) && producedInElementLevel(p as StoredModule);
      });
      listedElementLevel += badOnes.length;
      /**
       * 「逻辑关产出的模块必须可见」按**两条规则合起来**算期望值（不是复述实现）：
       *   · 第 ⑰ 轮规则：元件/时序关产出的 → 不列；
       *   · 第 ⑫ 轮规则（用户明确要求保留）：门级判定**跑不动**的组合模块不列 —— rtl 族连
       *     半加器/4位加法器/段码这些逻辑关产出的东西都是**元件搭的**（身体里没有子模块、
       *     `isPureCombinational=false`），门级引擎吃不下，所以它们本来就不该进逻辑关的画布库。
       * 期望值 = 逐条按这两条算，再与渲染结果逐字比对（渲染有没有正确接上规则）。
       */
      // 探针库要跟真机一致：真机传的是**画布库**（教学门注入 + 玩家库），少了教学门会把
      // 复合积木判成"跑不动"（实测：双数码管显示会假红）
      const probeLib = gateProbeLibrary([
        ...teachingAsStored('rtl'),
        ...(library as StoredModule[]),
      ]);
      const shouldList = library.filter(
        (m) => !producedInElementLevel(m) && gateLevelUsable(m, probeLib),
      );
      const missing = shouldList.filter((m) => !mine.cards.some((c) => c.hash === m.hash));
      missingLogicProduce += missing.length;
      if (i < 3 || i === logicLevels.length - 1)
        console.log(
          `[② ] #${idx + 1} ${level.id} 库=${library.length} 条｜${mine.title}｜${rows.join('、')}`,
        );
      expect(
        badOnes.map((c) => c.name),
        `${level.id}：逻辑关列出了元件/时序关产出的模块`,
      ).toEqual([]);
      expect(
        missing.map((m) => m.name),
        `${level.id}：逻辑关产出的可用模块被藏了`,
      ).toEqual([]);
      // 按 hash 逐条比对（卡片名会带「 时序」后缀，名字比对会假红）
      expect(mine.cards.map((c) => c.hash).sort()).toEqual(shouldList.map((m) => m.hash).sort());
    }
    console.log(
      `[② ] 汇总：${logicLevels.length} 个逻辑关 × 全程存档 → 元件/时序关产出被列出 ${listedElementLevel} 条（应为 0）｜逻辑关产出被误藏 ${missingLogicProduce} 条（应为 0）`,
    );
    expect(listedElementLevel).toBe(0);
    expect(missingLogicProduce).toBe(0);
  }, 600000);

  it('③ 反证：1~7 关（时序关）本身进入时，这些模块照旧列在「我的模块」（玩家原关卡的东西不许藏）', async () => {
    for (const idx of [3, 6]) {
      const level = ALL_LEVELS[idx]!;
      const library = produceThrough(idx);
      cleanup();
      await enter(level.title, library);
      const mine = cards('我的模块');
      console.log(
        `[③ ] #${idx + 1} ${level.id}「${level.title}」(judgeMode=${level.judgeMode ?? 'timing'})：${mine.title}｜${mine.cards.map((c) => `${c.name}@${c.hash.slice(0, 8)}`).join('、') || '空'}`,
      );
      expect(mine.cards.length, `${level.id} 是元件关，产出的模块必须照旧列出`).toBe(
        library.length,
      );
      expect(mine.cards.map((c) => c.name)).toEqual(library.map((m) => m.name));
    }
  }, 300000);

  it('④ 必须保住：第 10 关产出的「D 锁存器」在第 11 关照旧可见（真实玩家路径）', async () => {
    const library = produceThrough(10);
    const latch = library.find((m) => m.name === 'D锁存器')!;
    console.log(
      `[④ ] 第 10 关产出：name=${latch.name} hash=${latch.hash.slice(0, 8)} levelId=${latch.levelId} stage=${latch.stage} isSequential=${latch.isSequential} 端口=${latch.ports.map((p) => p.name).join('/')}｜身体含元件=${bodyHasUnit(latch.template)}`,
    );
    cleanup();
    await enter('主从 D 触发器', library);
    const mine = cards('我的模块');
    console.log(
      `[④ ] 第 11 关「我的模块」${mine.title}｜${mine.cards.map((c) => `${c.name}@${c.hash.slice(0, 8)}`).join('、')}`,
    );
    expect(
      mine.cards.some((c) => c.hash === latch.hash),
      'D 锁存器被藏了（口径被推翻）',
    ).toBe(true);
    // 第 10 关之前的逻辑关产出（SR 锁存器 / 按钮锁存器）也照旧在
    for (const name of ['SR锁存器', '按钮锁存器']) {
      expect(
        mine.cards.some((c) => c.name.startsWith(name)),
        `${name} 被藏了`,
      ).toBe(true);
    }
    // 逻辑关产出全在，且 1~7 关产出的元件门全不在
    expect(mine.cards.some((c) => c.name === '非门')).toBe(false);
    // 基础门组照旧 = 本关权威清单
    expect(cards('基础门').cards.map((c) => c.name)).toEqual(
      gateCatalogFor('rtl').map((m) => m.name),
    );
  }, 300000);

  it('⑤ 判据单测：产出处 provenance 优先；"关卡之外搭的"用 stage 兜（含明确的反例）', () => {
    const mk = (over: Partial<StoredModule> & { hash: string }): StoredModule =>
      ({
        name: 'x',
        version: '1.0.0',
        stage: 1,
        costHalf: 1,
        isSequential: false,
        ports: [],
        template: { body: { instances: [{ kind: 'unit' }] } },
        sources: [],
        createdAt: 0,
        ...over,
      }) as StoredModule;
    /** 逻辑关不做跨族隐藏的判据：只看产出那一关的 judgeMode */
    const cases: Array<[string, StoredModule, boolean]> = [
      ['教学积木（不参与）', mk({ hash: 't', teaching: true }), false],
      [
        'levelId=元件关（s1-not, timing）→ 逻辑关不列',
        mk({ hash: 'a', levelId: 's1-not', stage: 1 }),
        true,
      ],
      [
        'levelId=逻辑关时序（s2-d-latch）→ 逻辑关照旧列（即使身体含元件）',
        mk({ hash: 'b', levelId: 's2-d-latch', stage: 2 }),
        false,
      ],
      // 关卡 id 在本版内容里查不到（跨版本/导入存档）→ 按"非逻辑关"处理（保守：宁可少列，不误导）
      [
        'levelId 查不到（跨版本存档）→ 保守地按非逻辑关处理',
        mk({ hash: 'b2', levelId: 'zz-gone', stage: 2 }),
        true,
      ],
      [
        '无 provenance（关卡模式里已被 builtOutsideLevels 拦掉）→ 这里返回 false',
        mk({ hash: 'c', stage: 1 }),
        false,
      ],
    ];
    for (const [tag, mod, expected] of cases) {
      console.log(
        `[⑤ ] producedInElementLevel：${tag} → ${producedInElementLevel(mod)}（期望 ${expected}）`,
      );
      expect(producedInElementLevel(mod), tag).toBe(expected);
    }
    /** 关卡模式"只列有 levelId 的"判据（第 ⑰ 轮用户拍板：自由模式搭的在关卡中全面不可见） */
    const outside: Array<[string, StoredModule, boolean]> = [
      [
        '自由模式搭的（无 levelId + stage1 + 全用门搭）',
        mk({ hash: 'f1', stage: 1, template: { body: { instances: [{ kind: 'module' }] } } }),
        true,
      ],
      ['自由模式搭的（无 levelId + stage1 + 元件搭）', mk({ hash: 'f2', stage: 1 }), true],
      [
        '老存档：无 levelId + stage2（逻辑关产出的 D 锁存器）→ 例外，照旧列',
        mk({ hash: 'l1', stage: 2 }),
        false,
      ],
      ['老存档：无 levelId + stage3 → 例外，照旧列', mk({ hash: 'l2', stage: 3 }), false],
      [
        '关卡产出（有 levelId）→ 不是"关卡之外搭的"',
        mk({ hash: 'k1', levelId: 's2-dff', stage: 2 }),
        false,
      ],
      ['教学积木（本来就不进我的模块）', mk({ hash: 'k2', teaching: true }), false],
    ];
    for (const [tag, mod, expected] of outside) {
      console.log(
        `[⑤ ] builtOutsideLevels：${tag} → ${builtOutsideLevels(mod)}（期望 ${expected}）`,
      );
      expect(builtOutsideLevels(mod), tag).toBe(expected);
    }
  });

  it('⑥ 前提断言：关卡封装一定写 levelId、自由模式封装 stage 恒为 1（内容/代码改了会先红）', () => {
    // ① 代码前提（App.tsx 原文断言）：
    //    · 交付验收后的**自动封装**写 `levelId: currentLevel.id` → 关卡产出带得到 provenance；
    //    · **手动封装**不写 levelId，stage = `currentLevel?.stage ?? 1` → 在关卡里手动封的是
    //      stage 2/3（落进"老存档例外"那一档，照旧列）；在**自由模式**里封的就是 stage 1
    //      （与电路内容是元件搭的还是全用门搭的**无关**，stage 来自当前关卡）。
    const app = readFileSync(path.resolve(import.meta.dirname, '../src/App.tsx'), 'utf8');
    expect(
      (app.match(/levelId: currentLevel\.id/g) ?? []).length,
      '自动封装写 levelId 的路径数',
    ).toBeGreaterThanOrEqual(1);
    expect(app, '封装时的 stage 口径').toContain('stage: currentLevel?.stage ?? 1');
    // ② 内容前提：关卡产出必有 stage（>=1），且逻辑关的 stage 全是 2/3（"stage=1 只可能来自关卡之外"）
    const stages = new Set(ALL_LEVELS.map((l) => l.stage));
    const logicStages = new Set(logicLevels.map((l) => l.stage));
    console.log(
      `[⑥ ] 全部关卡 stage=${[...stages].join('/')}｜逻辑关 stage=${[...logicStages].join('/')}｜关卡数=${ALL_LEVELS.length}`,
    );
    expect(ALL_LEVELS.every((l) => l.stage >= 1)).toBe(true);
    expect(logicLevels.filter((l) => l.stage === 1)).toEqual([]);
  });
});
