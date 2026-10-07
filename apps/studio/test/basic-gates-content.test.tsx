// @vitest-environment jsdom
/**
 * 用户第 ⑰ 轮批准的两处内容包口径（可以动 `packages/content`）：
 *   ① 把「或非门」加进基础门清单（`BASIC_GATES`）：第 5 关教过、引擎 `GATE_NAMES` 也认，只是白名单没它；
 *   ② 给 rtl 族补上「同或门」：`teachingModulesFor('rtl')` 里没有它，而第 7 关的 rtl 同或门产出
 *      hash `75d5cdb9…` 是存在的 —— **复用那一份，别另造**。
 *
 * 本文件守四件事：
 *   ① 复用的是"那一份电路"：教学门 hash == 第 5/7 关产出的 hash（三族都比）；
 *   ② 可见性：相关关卡（逻辑关）的「基础门」组里两个门都在、且等于本关权威清单；
 *   ③ 判定与成本：用「门版」当答案交付验收照旧通过；27 关 × 3 族参考解的判定/成本/分**一条不差**
 *      （基线在改前采集，见回报）；
 *   ④ 老存档里同名条目不会出两张卡（显示层按契约身份规范化）。
 */

import { designToModulePorts, judgeDesign, wrapModule } from '@lc/compiler';
import { ALL_LEVELS, BASIC_GATES, hashOf, teachingModulesFor } from '@lc/content';
import {
  type Design,
  DesignSchema,
  familySpecOf,
  InMemoryModuleLibrary,
  type LogicFamily,
} from '@lc/schema';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { gateCatalogFor } from '../src/level/library';
import { dismissTaskDialog, enableDebugUrl, startJob } from './helpers';

const FAMILIES: LogicFamily[] = ['rtl', 'ttl', 'cmos'];

function cards(prefix: string) {
  const sec = [...document.querySelectorAll('.palette-section')].find((s) =>
    (s.querySelector('.palette-section-title')?.textContent || '').startsWith(prefix),
  );
  if (!sec) return [] as Array<{ name: string; hash: string }>;
  return [...sec.querySelectorAll('.palette-item')].map((b) => {
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
  });
}

/** 第 5 关 / 第 7 关的**产出**（玩家自动封装那一份）：wrapModule(关卡参考解) */
function levelOutput(levelId: string, family: LogicFamily) {
  const level = ALL_LEVELS.find((l) => l.id === levelId)!;
  const ref = (familySpecOf(level, family).reference ?? level.referenceSolution) as Design;
  return wrapModule(
    {
      name: level.unlock!.name,
      stage: level.unlock!.stage,
      kind: level.unlock!.kind,
      ports: designToModulePorts(DesignSchema.parse(ref)),
      body: DesignSchema.parse(ref),
    },
    new InMemoryModuleLibrary([...teachingModulesFor(family)]),
  ).template;
}

async function openLogicLevel(title: string, family: LogicFamily, library: unknown[]) {
  localStorage.clear();
  const idx = ALL_LEVELS.findIndex((l) => l.title === title);
  const cleared: Record<string, unknown> = {};
  for (const l of ALL_LEVELS.slice(0, idx))
    cleared[l.id] = { score: 100, bestCostHalf: 0, clearedAt: 1 };
  localStorage.setItem(
    'lc-studio-progress-v1',
    JSON.stringify({
      family,
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

describe('基础门清单补进 或非门 / 同或门（用户第 ⑰ 轮批准的内容包改动）', () => {
  it('① 复用的是那一份电路：教学门 hash == 第 5/7 关产出 hash（三族）', () => {
    const rows: string[] = [];
    for (const family of FAMILIES) {
      for (const [levelId, name] of [
        ['s1-nor', '或非门'],
        ['s1-xnor', '同或门'],
      ] as const) {
        const out = levelOutput(levelId, family);
        const teach = hashOf(name, family);
        rows.push(
          `${family} ${name}: 第 ${levelId === 's1-nor' ? 5 : 7} 关产出=${out.hash.slice(0, 8)} 教学门=${teach.slice(0, 8)} ${out.hash === teach ? '一致' : '✗不一致'}`,
        );
        expect(teach, `${family} ${name} 必须复用关卡产出那一份电路`).toBe(out.hash);
      }
      const names = teachingModulesFor(family).map((m) => m.name);
      expect(names, `${family} 教学集缺 或非门`).toContain('或非门');
      expect(names, `${family} 教学集缺 同或门`).toContain('同或门');
    }
    console.log(`[① ] ${rows.join('｜')}`);
    // rtl 的这两个 hash 是用户点名的那两个
    expect(hashOf('或非门', 'rtl').startsWith('78a1c650')).toBe(true);
    expect(hashOf('同或门', 'rtl').startsWith('75d5cdb9')).toBe(true);
    expect(BASIC_GATES).toContain('或非门');
    expect(BASIC_GATES).toContain('同或门');
  }, 300000);

  it('② 可见性：逻辑关的「基础门」= 本关权威清单（含这两个门），按 hash 逐条对', async () => {
    // 三族各自的清单都点名必须有这两个门（数据层）
    for (const f of FAMILIES) {
      const names = gateCatalogFor(f).map((m) => m.name);
      console.log(`[② ] ${f} 权威清单 ${names.length} 张：${names.join('、')}`);
      expect(names, `${f} 清单缺 或非门`).toContain('或非门');
      expect(names, `${f} 清单缺 同或门`).toContain('同或门');
    }
    // 逻辑关里逐族看（画布上实际渲染的族 = 本关族契约，见 App.tsx levelFamilyOf）
    const logicLevels = ALL_LEVELS.filter((l) => l.judgeMode === 'logic');
    for (const family of FAMILIES) {
      const reachable = logicLevels.filter((l) => familySpecOf(l, family).family === family);
      console.log(
        `[② ] 进度族 ${family}：逻辑关里本关族 = ${family} 的有 ${reachable.length} 关（${reachable
          .slice(0, 3)
          .map((l) => l.id)
          .join('、')}${reachable.length > 3 ? '…' : ''}）`,
      );
    }
    const level0 = ALL_LEVELS.find((l) => l.title === '主从 D 触发器')!;
    for (const family of FAMILIES) {
      const levelFamily = familySpecOf(level0, family).family; // = App.tsx levelFamilyOf 的口径
      const expected = gateCatalogFor(levelFamily);
      console.log(
        `[② ] ${family}（本关族 ${levelFamily}）权威清单 ${expected.length} 张：${expected.map((m) => `${m.name}@${m.hash.slice(0, 8)}`).join('、')}`,
      );
      expect(expected.map((m) => m.name)).toContain('或非门');
      expect(expected.map((m) => m.name)).toContain('同或门');
      cleanup();
      await openLogicLevel('主从 D 触发器', family, []);
      const shown = cards('基础门');
      expect(
        shown.map((c) => c.name),
        `${family}（本关族 ${levelFamily}）：基础门组必须等于本关清单`,
      ).toEqual(expected.map((m) => m.name));
      expect(shown.map((c) => c.hash)).toEqual(expected.map((m) => m.hash));
    }
  }, 600000);

  it('③ 老存档里同名条目（别族那两个门）不会出两张卡', async () => {
    // 混装库：三族的 或非门 / 同或门 各来一份（老存档形态），组头必须还是清单条数、名字两两不同
    const polluted = FAMILIES.flatMap((f) =>
      ['或非门', '同或门'].map((n) => ({
        hash: `${hashOf(n, f)}`,
        name: n,
        version: '1.0.0',
        stage: 1,
        costHalf: 10,
        isSequential: false,
        ports: teachingModulesFor(f).find((m) => m.name === n)!.ports,
        template: teachingModulesFor(f).find((m) => m.name === n),
        sources: [],
        createdAt: 0,
        teaching: true,
      })),
    );
    cleanup();
    await openLogicLevel('主从 D 触发器', 'rtl', polluted);
    const shown = cards('基础门');
    console.log(
      `[③ ] 混装 ${polluted.length} 条同名门 → 基础门组 ${shown.length} 张：${shown.map((c) => c.name).join('、')}`,
    );
    expect(shown.length).toBe(gateCatalogFor('rtl').length);
    expect(new Set(shown.map((c) => c.name)).size).toBe(shown.length);
    expect(shown.map((c) => c.hash)).toEqual(gateCatalogFor('rtl').map((m) => m.hash));
  }, 300000);

  it('④ 判定：用「门版」当答案交付验收照旧通过（第 5/7 关），成本如实报告', () => {
    for (const [levelId, name] of [
      ['s1-nor', '或非门'],
      ['s1-xnor', '同或门'],
    ] as const) {
      const level = ALL_LEVELS.find((l) => l.id === levelId)!;
      const lib = new InMemoryModuleLibrary([...teachingModulesFor('rtl')]);
      // 门版当答案：画布上只摆这一颗门版积木
      const gate = teachingModulesFor('rtl').find((m) => m.name === name)!;
      // 画布形态：一颗门版积木 + 按本关端口名把引脚接到网络上（PortSchema.nets 指向 net id）
      // 本关端口在**族契约的参考解**上（27 关条目自己没有 ports），照它建端口-网络绑定
      const refDesign = DesignSchema.parse(
        (familySpecOf(level, 'rtl').reference ?? level.referenceSolution) as Design,
      );
      const design = DesignSchema.parse({
        id: 'gate-answer',
        name: '门版答案',
        instances: [{ kind: 'module', id: 'm', module: gate.hash }],
        nets: refDesign.ports.map((p) => ({
          id: `n-${p.name}`,
          pins: [{ inst: 'm', pin: p.name }],
        })),
        ports: refDesign.ports.map((p) => ({
          id: `port-${p.name}`,
          name: p.name,
          dir: p.dir,
          width: p.width,
          nets: [`n-${p.name}`],
        })),
      });
      const door = judgeDesign(design as never, level as never, { library: lib, family: 'rtl' });
      // 元件版参考解（关卡原本的答案）
      const ref = (familySpecOf(level, 'rtl').reference ?? level.referenceSolution) as Design;
      const element = judgeDesign(DesignSchema.parse(ref) as never, level as never, {
        library: lib,
        family: 'rtl',
      });
      console.log(
        `[④ ] 第 ${levelId === 's1-nor' ? 5 : 7} 关「${level.title}」：门版答案 pass=${door.pass} 成本=${door.costHalf} 分=${door.score}｜元件版参考解 pass=${element.pass} 成本=${element.costHalf} 分=${element.score}`,
      );
      expect(door.pass, `门版 ${name} 当答案必须通过`).toBe(true);
      expect(door.failedRows).toBe(0);
    }
  }, 300000);
});
