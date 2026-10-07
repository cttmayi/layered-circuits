// @vitest-environment node
/**
 * **数据驱动审计**（用户第 ⑬ 轮要求）：把"玩家可能已经拥有的模块"逐关过一遍，检查
 * 「该关是不是都会把它们列出来」。这组用例是**守卫**：口径一旦失效立刻报红。
 *
 * 背景（用户报的 bug）：第 10 关「D 锁存器」通关后封装出来的模块，到第 11 关「主从 D 触发器」
 * 的「我的模块」里没有了 —— 根因是门级引擎**按模块名**查 `GATE_SEQ_SPECS`，玩家自己起的名字
 * 对不上表（手动封装默认名「我的模块」、老版本用关卡标题「D 锁存器」带空格），于是探针返回 null、
 * 被整条藏掉。修法见 apps/studio/src/sim/gate-usable.ts（**时序模块一律列**，名字不参与判据）。
 *
 * 审计三件事：
 *  ① **上一关的成果**：对每一关、每一个"更早关卡会解锁的模块名"，算出它在该关列不列，并按
 *     文档化的期望核对（时序积木必须列；第 1~7 关那种含元件的**组合**老模块在逻辑关按设计隐藏）；
 *  ② **声明表里的每一个时序积木**：换成玩家自己起的名字后，仍必须列出来（名字不许当判据）；
 *  ③ **参考解用到的模块**：对每一关，算出参考解引用到的模块，检查它们在该关是否都列得出来
 *     （结论：全部关卡用到的模块 = 0，因为参考解都是元件版 —— 这条一旦变化会被下面的断言抓到）。
 */
import { designToModulePorts, runGateVectors, wrapModule } from '@lc/compiler';
import { ALL_LEVELS, GATE_SEQ_SPECS, hashOf, teachingModulesFor } from '@lc/content';
import { DesignSchema, InMemoryModuleLibrary, type ModuleTemplate } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import type { StoredModule } from '../src/editor/model.ts';
import { gateLevelUsable, gateProbeLibrary, specByShape } from '../src/sim/gate-usable.ts';

const TPL = teachingModulesFor('rtl');
const TPL_LIB = new InMemoryModuleLibrary([...TPL]);
const NAME_OF_HASH = new Map(TPL.map((t) => [t.hash, t.name]));

const asStored = (t: ModuleTemplate, teaching = false): StoredModule => ({
  hash: t.hash,
  name: t.name,
  version: t.version,
  stage: t.stage,
  costHalf: t.costHalf,
  isSequential: t.isSequential,
  ports: t.ports.map((p) => ({ id: p.id, name: p.name, dir: p.dir, width: p.width })),
  template: t,
  sources: [],
  createdAt: 0,
  ...(teaching ? { teaching: true as const } : {}),
});

/** 与 Palette 的 `moduleAllowed` 同口径（白名单/复古关禁用都算上） */
function moduleAllowed(levelId: string, name: string): boolean {
  const level = ALL_LEVELS.find((l) => l.id === levelId);
  if (!level) return true;
  if (level.moduleAccess === 'none') return false;
  if (level.bannedModules.includes(name)) return false;
  if (level.kind === 'retro' && level.moduleAccess === 'listed') {
    return level.allowedModules.includes(name);
  }
  return level.allowedModules.length === 0 || level.allowedModules.includes(name);
}

/**
 * 玩家在某一关交付时会被封装出来的模块（`App.tsx` 的 wrapAndSettle：名字 = `unlock.name`，
 * 身体 = 当时画布上的电路）。审计里用两具身体做代理：
 *   · 教学族里有同名积木 → 直接用它的身体（最贴近"玩家按关卡思路搭出来的"）；
 *   · 否则用该关参考解的身体（`referenceSolution`）。
 */
function playerProductOf(levelId: string): StoredModule | undefined {
  const level = ALL_LEVELS.find((l) => l.id === levelId);
  const name = level?.unlock?.name;
  if (!level || !name) return undefined;
  const canonical = TPL.find((t) => t.name === name);
  if (canonical) return asStored(canonical);
  const ref = level.referenceSolution;
  if (!ref) return undefined;
  const parsed = DesignSchema.safeParse(ref);
  if (!parsed.success) return undefined;
  const { template } = wrapModule(
    {
      name,
      stage: level.stage,
      kind: 'logic',
      ports: designToModulePorts(parsed.data),
      body: parsed.data,
    },
    TPL_LIB,
  );
  return asStored(template);
}

/** 旧口径的原样判定：门级入口直接返回 null 就算"跑不动"（名字不匹配时就是 null） */
function gateProbeRawVerdict(mod: StoredModule, library: InMemoryModuleLibrary): boolean {
  const probe = DesignSchema.parse({
    id: '__raw-probe__',
    name: '旧口径探针',
    instances: [{ kind: 'module', id: '__x__', module: mod.hash }],
  });
  return (
    runGateVectors(probe, library, [{ inputs: {} }], new Map<string, number>(), GATE_SEQ_SPECS) !==
    null
  );
}

/** 把整族教学积木 + 这些玩家模块装进画布库（与 App 注入的口径一致） */
const libraryOf = (playerModules: readonly StoredModule[]) =>
  gateProbeLibrary([...TPL.map((t) => asStored(t, true)), ...playerModules]);

describe('审计：玩家已有的模块在每一关都列得出来吗', () => {
  it('① 上一关的成果：时序积木必列，含元件的组合老模块按设计隐藏', () => {
    const violations: string[] = [];
    const rows: string[] = [];
    for (const [index, level] of ALL_LEVELS.entries()) {
      if (level.moduleAccess === 'none') continue; // 这关本来就不收模块
      const earlier = ALL_LEVELS.slice(0, index);
      const products = earlier
        .map((l) => playerProductOf(l.id))
        .filter((m): m is StoredModule => Boolean(m));
      if (products.length === 0) continue;
      const lib = libraryOf(products);
      for (const mod of products) {
        const sequential = mod.isSequential || specByShape(mod) !== undefined;
        const gateOnly = gateLevelUsable(mod, lib) && !sequential; // 门级直接跑得动 = 纯门/原子
        const listed = moduleAllowed(level.id, mod.name) && gateLevelUsable(mod, lib);
        const expectListed = sequential || gateOnly;
        rows.push(
          `第${index + 1}关 ${level.id}｜「${mod.name}」isSeq=${mod.isSequential} 形状认领=${sequential ? '有' : '无'}｜列出=${listed}｜期望=${expectListed}`,
        );
        if (listed !== expectListed) {
          violations.push(
            `${level.id}「${level.title}」：上一关成果「${mod.name}」(isSeq=${mod.isSequential}) 列出=${listed}，期望=${expectListed}`,
          );
        }
        // 硬要求：带声明的时序积木（D 锁存器/主从D触发器）在任何收模块的关卡都必须列
        if (sequential && !listed) {
          violations.push(`【必修】${level.id}：时序积木「${mod.name}」被藏掉了`);
        }
      }
    }
    console.log(`[audit] ① 上一关成果逐关核对 ${rows.length} 条，违规 ${violations.length} 条`);
    if (violations.length > 0) console.log(`[audit] ✗ ${violations.join('\n[audit] ✗ ')}`);
    expect(violations).toEqual([]);
  });

  it('② 声明表里的每个时序积木：换成玩家自己起的名字也必须列出来', () => {
    const violations: string[] = [];
    for (const [canonicalName] of Object.entries(GATE_SEQ_SPECS)) {
      const canonical = TPL_LIB.get(hashOf(canonicalName));
      if (!canonical) {
        violations.push(`GATE_SEQ_SPECS 里的【${canonicalName}】在教学族里找不到`);
        continue;
      }
      // 玩家自己的名字（手动封装默认名 / 带空格的老标题名）
      for (const playerName of ['我的模块', 'D 锁存器', '锁存器（我搭的）']) {
        const { template } = wrapModule(
          {
            name: playerName,
            stage: 2,
            kind: 'logic',
            ports: designToModulePorts(canonical.body),
            body: canonical.body,
          },
          TPL_LIB,
        );
        const mod = asStored(template);
        for (const level of ALL_LEVELS) {
          if (level.moduleAccess === 'none') continue;
          const listed =
            moduleAllowed(level.id, playerName) && gateLevelUsable(mod, libraryOf([mod]));
          if (!listed) {
            violations.push(
              `${canonicalName} 的玩家版「${playerName}」在 ${level.id}「${level.title}」里列不出来`,
            );
          }
        }
      }
    }
    console.log(
      `[audit] ② 声明表 ${Object.keys(GATE_SEQ_SPECS).length} 个积木 × 玩家名字 × 全部关卡，违规 ${violations.length} 条`,
    );
    if (violations.length > 0) console.log(`[audit] ✗ ${violations.join('\n[audit] ✗ ')}`);
    expect(violations).toEqual([]);
  });

  it('③ 参考解用到的模块：全部关卡都列得出来（实测：只有 s3-display2 的参考解引用了积木）', () => {
    const violations: string[] = [];
    let refModuleUses = 0;
    const perLevel: string[] = [];
    for (const level of ALL_LEVELS) {
      const ref = level.referenceSolution as unknown as {
        instances?: Array<{ kind?: string; module?: string }>;
      } | null;
      const names = new Set(
        (ref?.instances ?? [])
          .filter((i) => i.kind === 'module' && typeof i.module === 'string')
          .map(
            (i) =>
              NAME_OF_HASH.get(i.module as string) ??
              `未知hash:${(i.module as string).slice(0, 8)}`,
          ),
      );
      refModuleUses += names.size;
      perLevel.push(`${level.id}:${names.size === 0 ? '0' : [...names].join('+')}`);
      for (const name of names) {
        const canonical = TPL_LIB.get(hashOf(name));
        if (!canonical) {
          violations.push(`${level.id} 参考解引用了教学族里没有的模块【${name}】`);
          continue;
        }
        const mod = asStored(canonical);
        if (level.moduleAccess === 'none') continue;
        const listed = moduleAllowed(level.id, name) && gateLevelUsable(mod, libraryOf([mod]));
        if (!listed)
          violations.push(`${level.id}「${level.title}」参考解要用【${name}】，但它列不出来`);
      }
    }
    console.log(
      `[audit] ③ 参考解引用到的模块总数 ${refModuleUses}｜逐关=${perLevel.join(' ')}｜违规 ${violations.length} 条`,
    );
    if (violations.length > 0) console.log(`[audit] ✗ ${violations.join('\n[audit] ✗ ')}`);
    // 不变式：这条审计**必须真的覆盖到东西**（当前实测：只有 s3-display2 的参考解用了积木
    // 「七段译码器」）—— 若哪天参考解不再引用任何模块，这条会提醒复核审计是否还有效。
    expect(refModuleUses).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it('反证：旧口径（"runGateVectors 返回 null 就隐藏"）会误藏多少条 —— 守卫确实咬得住', () => {
    const oldRuleHides: string[] = [];
    for (const [index, level] of ALL_LEVELS.entries()) {
      if (level.moduleAccess === 'none') continue;
      const earlier = ALL_LEVELS.slice(0, index);
      const products = earlier
        .map((l) => playerProductOf(l.id))
        .filter((m): m is StoredModule => Boolean(m));
      if (products.length === 0) continue;
      const lib = libraryOf(products);
      for (const mod of products) {
        // 旧口径 = 直接看门级入口的返回值（不看名字/形状）
        const gateRunnable = gateProbeRawVerdict(mod, lib);
        if (!gateRunnable) {
          oldRuleHides.push(`${level.id} 会藏掉「${mod.name}」(isSeq=${mod.isSequential})`);
        }
      }
    }
    console.log(
      `[audit] 反证：旧口径下逐关核对 ${oldRuleHides.length} 条会被误藏，例：${oldRuleHides.slice(0, 6).join('、')}`,
    );
    // 至少要咬到 s2-dff（用户报的那一关）与它的上游关卡，证明这条守卫不是空转
    expect(oldRuleHides.some((x) => x.startsWith('s2-dff '))).toBe(true);
    expect(oldRuleHides.length).toBeGreaterThan(0);
  });
});
