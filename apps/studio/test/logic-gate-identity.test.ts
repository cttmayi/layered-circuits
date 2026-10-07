// @vitest-environment node
/**
 * 「逻辑关里门是契约实体，身份 = 名字」这条口径的**证据与守卫**（用户第 ⑯ 轮）。
 *
 * 用户原话：「到了第 8 关，应该就不存在不同的非门了。理论上也没有 hash 的必要性」。
 * 我认同前半句（门是契约实体），但要澄清后半句：
 *   · **hash 依然必要** —— 玩家自建模块靠它做内容寻址（存档瘦身、判定解析模块、缓存、
 *     溯源树）；且不同族的**真积木**（零件级成本/延迟不同）本来就是不同的内容。
 *   · 要改的是「**基础门的身份不该用 hash 表达**」：逻辑关里门由**名字**定身份，
 *     内部结构（rtl 的 NPN+电阻 / TTL 的射极跟随器 / CMOS 互补对）与玩家无关。
 *
 * 本文件把这条口径钉在测试里：
 *   ① 引擎侧：`isGateName(name)` 的模块被当**原子**（按真值算、不展开身体）；
 *   ② 判定侧实测：同一个逻辑关的门版参考解，把「非门」换成 ttl / cmos 版本
 *      （hash 与身体全都不同）→ **判定结论逐字一致**，只有造价/评分跟着族变；
 *   ③ 菜单侧：本关基础门清单 = 本关族 `teachingModulesFor` 里的基础门（与库无关），
 *      且清单里的每个 hash 都被「进关注入」保证在画布库里（卡片一定放得下）。
 */
import { judgeDesign } from '@lc/compiler';
import {
  ALL_LEVELS,
  BASIC_GATES,
  GATE_SEQ_SPECS,
  gateFastEnabledFor,
  teachingModulesFor,
  teachingSolutionOf,
} from '@lc/content';
import { type Design, DesignSchema, InMemoryModuleLibrary } from '@lc/schema';
import { isGateName } from '@lc/sim-core';
import { describe, expect, it } from 'vitest';
import { gateCatalogFor, teachingCatalogFor } from '../src/level/library';

const FAMILIES = ['rtl', 'ttl', 'cmos'] as const;
const hashOf = (family: (typeof FAMILIES)[number], name: string): string => {
  const m = teachingModulesFor(family).find((x) => x.name === name);
  if (!m) throw new Error(`${family} 族没有「${name}」`);
  return m.hash;
};

/** 把 design 里「名字 = name」的基础门实例都换成指定 hash（模拟菜单里摆了别族的同名门） */
function swapGate(design: Design, name: string, hash: string): Design {
  const rtlHash = hashOf('rtl', name);
  return {
    ...design,
    instances: design.instances.map((inst) =>
      inst.kind === 'module' && inst.module === rtlHash ? { ...inst, module: hash } : inst,
    ),
  } as Design;
}

const logicLevels = ALL_LEVELS.filter((l) => l.judgeMode === 'logic');

describe('逻辑关的门身份 = 名字（判定等价性实测）', () => {
  it('引擎把"门名"当原子：isGateName 认下基础门名（判定读名字、不读 hash/身体）', () => {
    for (const name of BASIC_GATES) expect(isGateName(name)).toBe(true);
    expect(isGateName('我的锁存器')).toBe(false);
  });

  it('三族的「非门」hash/身体各不相同，但门名相同（所以 hash 表达不了门的身份）', () => {
    const nots = FAMILIES.map((f) => teachingModulesFor(f).find((m) => m.name === '非门')!);
    const bodies = nots.map((m) =>
      JSON.stringify(m.body?.instances.map((i) => (i as { unit?: string }).unit ?? 'module')),
    );
    console.log(
      `[门身份] 三族非门 hash=${nots.map((m) => m.hash.slice(0, 8)).join(' / ')}｜身体=${bodies.join(' vs ')}`,
    );
    expect(new Set(nots.map((m) => m.hash)).size).toBe(3); // 三个不同 hash
    expect(new Set(nots.map((m) => m.name)).size).toBe(1); // 同一个门名
    expect(new Set(bodies).size).toBe(3); // 三套不同内部结构
  });

  it('判定实测：把门版答案的「非门」换成别族的同名门 → 结论逐字一致，只有造价/评分跟着族变', () => {
    const rows: string[] = [];
    let checked = 0;
    let verdictMismatch = 0;
    for (const level of logicLevels) {
      const ref = teachingSolutionOf(level.id, 'rtl');
      if (!ref) continue;
      if (!ref.instances.some((i) => i.kind === 'module' && i.module === hashOf('rtl', '非门')))
        continue;
      const fast = gateFastEnabledFor(level.id);
      const library = new InMemoryModuleLibrary(FAMILIES.flatMap((f) => teachingModulesFor(f)));
      const options = {
        library,
        mode: 'logic' as const,
        family: 'rtl' as const,
        ...(fast ? { gateSeqSpecs: GATE_SEQ_SPECS } : {}),
      };
      const judged = (design: Design) => judgeDesign(design as never, level as never, options);
      const base = judged(DesignSchema.parse(ref) as Design);
      const variants = FAMILIES.map((f) => {
        const r = judged(swapGate(DesignSchema.parse(ref) as Design, '非门', hashOf(f, '非门')));
        return {
          f,
          pass: r.pass,
          errors: JSON.stringify(r.errors),
          score: r.score,
          costHalf: r.costHalf,
        };
      });
      const sameVerdict = variants.every(
        (v) => v.pass === base.pass && v.errors === JSON.stringify(base.errors),
      );
      if (!sameVerdict) verdictMismatch++;
      checked++;
      rows.push(
        `${level.id}（门级快路=${fast ? '是' : '否'}）基准 pass=${base.pass} 成本=${base.costHalf} 分=${base.score}` +
          `｜非门@ttl pass=${variants[1].pass} 成本=${variants[1].costHalf} 分=${variants[1].score}` +
          `｜非门@cmos pass=${variants[2].pass} 成本=${variants[2].costHalf} 分=${variants[2].score}` +
          ` → 判定${sameVerdict ? '逐字一致' : '⚠ 不一致'}`,
      );
    }
    console.log(`[判定等价性] 门版答案用到非门的逻辑关 ${checked} 个：`);
    for (const row of rows) console.log(`[判定等价性]   ${row}`);
    expect(checked).toBeGreaterThanOrEqual(5);
    expect(verdictMismatch).toBe(0);
  }, 300000);

  it('本关基础门清单 = 本关族 teachingModulesFor 里的基础门，且清单 hash 全在进关注入里', () => {
    const rows: string[] = [];
    for (const level of logicLevels) {
      const catalog = gateCatalogFor('rtl');
      const names = catalog.map((m) => m.name);
      // 权威清单与库无关：名字顺序逐字等于本关族教学顺序里的基础门
      const expected = teachingModulesFor('rtl')
        .filter((m) => BASIC_GATES.includes(m.name))
        .map((m) => m.name);
      expect(names).toEqual(expected);
      expect(new Set(names).size).toBe(names.length); // 一个门名一张卡
      // 进关注入（withLevelGates 用整族）保证每个清单 hash 都在画布库里 → 卡片一定放得下
      const injected = new Set(teachingCatalogFor('rtl').map((m) => m.hash));
      for (const m of catalog) expect(injected.has(m.hash)).toBe(true);
      rows.push(`${level.id}: ${names.join('、')}（${names.length} 张卡）`);
    }
    console.log(`[基础门清单] 逻辑关 ${rows.length} 关，逐关清单：`);
    for (const row of rows) console.log(`[基础门清单]   ${row}`);
    expect(rows.length).toBe(logicLevels.length);
  }, 120000);
});
