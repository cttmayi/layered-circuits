/**
 * fromDesign（Design → 画布 Doc）往返自检：「一键出答案」把参考解搭回画布后，
 * 再导出必须仍是一份能通关、成本不变的电路。
 */

import { findDependencyCycle, judgeDesign } from '@lc/compiler';
import {
  ALL_LEVELS,
  elementEdgeOf,
  TEACHING_MODULES,
  teachingModulesFor,
  teachingSolutionOf,
} from '@lc/content';
import { familySpecOf, InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { fromDesign, toDesign } from '../src/editor/model';
import { docForLevel } from '../src/level/progress';

/** 教学门积木 → 画布库条目（与 App 注入 doc.library 的方式一致） */
const stored = TEACHING_MODULES.map((m) => ({
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
}));

describe('fromDesign 还原器（一键出答案）', () => {
  it('每个有关卡参考解的关：还原 → 再导出 → 判定通关且满分', () => {
    // 教学库是超集：模块化参考解（如 s3-display2 = 2×七段译码器模块）引用教学积木哈希，
    // 需要教学库才能编译；纯元件参考解不受影响（多余条目不产生画布符号）。
    const library = new InMemoryModuleLibrary([...TEACHING_MODULES]);
    let checked = 0;
    for (const level of ALL_LEVELS) {
      const ref = level.referenceSolution;
      if (!ref) continue;
      checked++;
      // 模块化参考解需要教学积木才能布模块引脚；纯元件参考解用空库即可
      const base = docForLevel(level, ref.instances.some((i) => i.kind === 'module') ? stored : []);
      const doc = fromDesign(ref, base);
      // 端口保留：位宽与锁定继承自关卡预置
      expect(doc.syms.filter((s) => s.kind === 'input' || s.kind === 'output').length).toBe(
        base.syms.filter((s) => s.kind === 'input' || s.kind === 'output').length,
      );
      // 元件真的铺上去了
      expect(doc.syms.filter((s) => s.kind === 'unit' || s.kind === 'module').length).toBe(
        ref.instances.filter((i) => i.kind === 'unit' || i.kind === 'module').length,
      );
      // 多 bit 端口位宽保留
      for (const p of level.ports) {
        const sym = doc.syms.find(
          (s) => s.kind !== 'vcc' && s.kind !== 'gnd' && s.label === p.name,
        );
        expect(sym?.width, `${level.id} 端口 ${p.name} 位宽`).toBe(p.width);
      }
      // 端口不重叠：防遮挡按「输入组/输出组整体平移」保持组内间距——逐个端口各自
      // 挤到 need 会把大电路（简易计算器 6000+ 实例、元件带横跨几万像素）的按键
      // 挤到同一 x 叠成一层、七段显示端口也被推到同一位置盖住（回归锁死）。
      const seen = new Set<string>();
      for (const s of doc.syms.filter((x) => x.kind === 'input' || x.kind === 'output')) {
        const key = `${s.x},${s.y}`;
        expect(seen.has(key), `${level.id} 端口重叠 @ ${key}`).toBe(false);
        seen.add(key);
      }
      // 往返：导出 → 判定（硬核）→ 通过 + 满分
      const design = toDesign(doc);
      const r = judgeDesign(design, level, { library, hardcore: true });
      expect(r.pass, `${level.id} 还原后应通关：${r.errors.join('；')}`).toBe(true);
      expect(r.score, `${level.id} 还原后应满分`).toBe(100);
    }
    expect(checked).toBeGreaterThanOrEqual(15);
    // 计算器链大电路的时序行为探测较慢，放宽超时（全仓并发时 judgeDesign 会跑满这个窗口）
  }, 120_000);

  it('没有参考解的关返回空电路提示（不炸）', () => {
    const level = ALL_LEVELS[0]!;
    const base = docForLevel(level, []);
    // 空 design（无实例、无网络）也能还原成只剩端口的画布
    const doc = fromDesign(
      { schemaVersion: 1, id: 'empty', name: 'x', instances: [], nets: [], ports: [] },
      base,
    );
    expect(doc.syms.filter((s) => s.kind === 'input' || s.kind === 'output').length).toBe(
      base.syms.filter((s) => s.kind === 'input' || s.kind === 'output').length,
    );
    expect(doc.wires.length).toBe(0);
  });
});

describe('逻辑门版参考解（简洁版一键出答案）', () => {
  it('23 关都有门版；直接判定通关且满分，成本不高于元件版', () => {
    const library = new InMemoryModuleLibrary([...TEACHING_MODULES]);
    let checked = 0;
    for (const level of ALL_LEVELS) {
      const teaching = teachingSolutionOf(level.id);
      if (!teaching) continue;
      checked++;
      // 门版不得有模块循环依赖（答案用其他门搭，绝不自引用/互相引用）
      expect(findDependencyCycle(teaching, library), `${level.id} 门版不得循环依赖`).toBeNull();
      const r = judgeDesign(teaching, level, { library, hardcore: true });
      expect(r.pass, `${level.id} 门版应通关：${r.errors.join('；')}`).toBe(true);
      expect(r.score, `${level.id} 门版应满分`).toBe(100);
      expect(r.costHalf, `${level.id} 门版成本应 ≤ 元件版`).toBeLessThanOrEqual(level.optimalHalf);
    }
    // 23 关有门版：第 1 章 4（与非/或非/异或/同或）+ 第 2 章 4（SR/D锁存/按钮锁存/DFF）+ 第 3 章 15（算术+计算器链+段码×3+数码管显示）；
    // 非门/与门/或门 moduleAccess: 'none'（禁用模块）→ 不出门版
    expect(checked).toBe(23);
  });

  it('门版答案顶层盒数 ≤ 15（关卡设计规范：画布顶层可见盒子数上限）', () => {
    // 元件版（性能隐藏解）、教学关、模块详情弹窗内部电路豁免；门版答案必须 ≤ 15 盒。
    // 已批准例外：s3-calc（终局组装关）= 29 盒（8 位 ALU + 控制 + 显示，架构决定，docs §一豁免）；
    // s3-display/s3-seg-de/s3-seg-fg（段码×3，自包含 19/18/19 盒）= 答案即教学内容：
    // 段码关的输入输出必须自包含可读（BCD → 段线真值表），NAND 链 4 项 = 5 门是数学下限，
    // 砍掉「共享积项」中间关后每关至少 18 门（docs §一豁免）。
    const EXEMPT = new Set(['s3-calc', 's3-display', 's3-seg-de', 's3-seg-fg']);
    for (const level of ALL_LEVELS) {
      const teaching = teachingSolutionOf(level.id);
      if (!teaching) continue;
      if (EXEMPT.has(level.id)) continue;
      const boxes = teaching.instances.filter(
        (i) => i.kind === 'unit' || i.kind === 'module',
      ).length;
      expect(
        boxes,
        `${level.id} 门版应 ≤ 15 盒（现在是 ${boxes}）——见 docs/关卡设计规范（规模与积木复用）.md §二`,
      ).toBeLessThanOrEqual(15);
    }
  });

  it('门版 还原 → 再导出 → 判定通关且满分（App 的完整链路）', () => {
    const library = new InMemoryModuleLibrary([...TEACHING_MODULES]);
    let checked = 0;
    for (const level of ALL_LEVELS) {
      const teaching = teachingSolutionOf(level.id);
      if (!teaching) continue;
      checked++;
      const base = docForLevel(level, stored);
      const doc = fromDesign(teaching, base);
      // 门版用模块积木：画布上应该是 module sym 而不是几百个晶体管
      expect(
        doc.syms.filter((s) => s.kind === 'module').length,
        `${level.id} 门版应全是模块积木`,
      ).toBe(teaching.instances.filter((i) => i.kind === 'module').length);
      const design = toDesign(doc);
      const r = judgeDesign(design, level, { library, hardcore: true });
      expect(r.pass, `${level.id} 门版还原后应通关：${r.errors.join('；')}`).toBe(true);
      expect(r.score, `${level.id} 门版还原后应满分`).toBe(100);
    }
    expect(checked).toBe(23);
  });
});

describe('门版端口防遮挡', () => {
  /** 教学门积木 → 画布库条目（与 App 注入 doc.library 的方式一致） */
  const stored = TEACHING_MODULES.map((m) => ({
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
  }));
  it('一键答案的端口视觉不落入任何元件盒子（防遮挡）', () => {
    for (const level of ALL_LEVELS) {
      const teaching = teachingSolutionOf(level.id);
      if (!teaching) continue;
      const doc = fromDesign(teaching, docForLevel(level, stored));
      const mods = doc.syms.filter((s) => s.kind === 'module' || s.kind === 'unit');
      if (!mods.length) continue;
      for (const p of doc.syms.filter((s) => s.kind === 'input' || s.kind === 'output')) {
        // 端口视觉范围：输入矩形 [-20,26]、输出 [-26,20]，垂直 ±13（+标签到 +40）；
        // 元件盒子按最坏情况 ±46（模块半宽）× ±44（全加器半高）
        const xL = p.x + (p.kind === 'input' ? -20 : -26);
        const xR = p.x + (p.kind === 'input' ? 26 : 20);
        for (const m of mods) {
          const overlap =
            xR > m.x - 46 + 2 &&
            xL < m.x + 46 - 2 &&
            p.y + 40 > m.y - 44 + 2 &&
            p.y - 13 < m.y + 44 - 2;
          expect(
            overlap,
            `${level.id} 端口 ${p.label}@${p.x},${p.y} 视觉落入元件 ${m.label}@${m.x},${m.y} 盒子`,
          ).toBe(false);
        }
      }
    }
  });
});

describe('元件版布局：同深度同列（不许回退成单列长条）', () => {
  it('每列最多 10 个元件；同深度同列，超一屏的深度组拆多列并均分', () => {
    for (const level of ALL_LEVELS) {
      const ref = level.referenceSolution;
      if (!ref) continue;
      const doc = fromDesign(ref, docForLevel(level, []));
      const units = doc.syms.filter((s) => s.kind === 'unit' || s.kind === 'module');
      if (units.length === 0) continue;
      const perCol = new Map<number, number>();
      for (const s of units) perCol.set(s.x, (perCol.get(s.x) ?? 0) + 1);
      const maxPerCol = Math.max(...perCol.values());
      // 布局不允许单列超过 10 个（否则就是当初「一列长条」的回归）
      expect(maxPerCol, `${level.id} 单列元件数应 ≤ 10（现在是 ${maxPerCol}）`).toBeLessThanOrEqual(
        10,
      );
      // 超过 10 个元件就应当有多列
      if (units.length > 10) {
        expect(perCol.size, `${level.id} 大电路应切成多列`).toBeGreaterThan(1);
      }
      // 列之间无重叠：同一 x 的元件 y 各不同
      const seen = new Set<string>();
      for (const s of units) {
        const key = `${s.x},${s.y}`;
        expect(seen.has(key), `${level.id} 元件 ${s.id} 与其它元件重叠`).toBe(false);
        seen.add(key);
      }
    }
    // 计算器链参考解（600+ 元件）布局较慢，放宽超时
  }, 30_000);
});

describe('元件版 vs 门版：一键出答案的版本选择依据', () => {
  it('当前内容下没有任何关卡元件版在成本/延迟上占优（→ 不弹对话框，直接出门版）', () => {
    // 门版与元件版同结构时成本/延迟相同；只有某关元件版参考解更省/更快，
    // elementEdgeOf 才会返回 'cost'/'delay'（届时 App 会自动亮出元件版选项）。
    // 这个断言是当前内容的快照：如果未来加了「元件版更优」的关，这里要跟着改。
    for (const level of ALL_LEVELS) {
      if (!level.referenceSolution || !teachingSolutionOf(level.id)) continue;
      const edge = elementEdgeOf(level);
      // s1-nor 例外：或非门门版 = 或门+非门（两级），参考解 = 并联下拉（一级），
      // 元件版传播延迟必然更短 → 'delay'（弹窗二选一，符合「元件版占优才给选项」原则）
      if (level.id === 's1-nor') {
        expect(edge, 's1-nor 元件版（并联下拉）应延迟占优').toBe('delay');
        continue;
      }
      expect(edge, `${level.id} 元件版不应有优势（现在是 ${edge}）`).toBeNull();
    }
    // calc 门版是大电路（几百模块实例），analyzeTiming 较慢，放宽超时
  }, 60_000);

  it('TTL/CMOS 强输出契约：门版用工艺积木过强度；判定只看功能（成本/时序超标准仍过关），元件版更省时占优', () => {
    // 判定规则（用户定稿 2025-10）：功能正确即可过关——成本/时序超预算只降评分/星级，
    // 不判失败。门版答案（如 TTL 与非门 = 与门+非门 两门拼 44 > 预算 40）因此天然可交付。
    // elementEdgeOf：元件版参考解比门版更省/更快时 = 'cost'/'delay'（弹窗给更优解）。
    const families = ['ttl', 'cmos'] as const;
    let sawOverBudget = false; // 至少要有门版超预算（TTL 44 > 40）并仍可交付，测试才非空转
    for (const level of ALL_LEVELS) {
      for (const fam of families) {
        const spec = familySpecOf(level, fam);
        // 该契约没有独立参考解 → 判定回退 RTL，无需专门门版（RTL 门版已覆盖）
        if (spec.reference === level.referenceSolution) continue;
        const teach = teachingSolutionOf(level.id, spec.family);
        if (!teach) continue;
        const gateLib = new InMemoryModuleLibrary([...teachingModulesFor(spec.family)]);
        // 门版答案：功能 + 强度必须过；成本/时序超标不拦交付
        const r = judgeDesign(teach, level, {
          library: gateLib,
          family: spec.family,
          units: spec.units,
          optimalHalf: spec.optimalHalf,
          budgetHalf: spec.budgetHalf,
          hardcore: true,
        });
        expect(r.pass, `${level.id} ${fam} 门版应过关：${r.errors.join('；')}`).toBe(true);
        // 门版超出玩家预算（如 TTL 两门拼 44 > 预算 40）时照常过关，只是标记超预算/低星
        if (r.overBudget) {
          sawOverBudget = true;
          expect(r.warnings.join('；'), `${level.id} ${fam} 超预算应有提示`).toContain('超预算');
        }
        // 元件版参考解（工艺答案）仍是「更优解」：成本低于门版 → edge 'cost'（弹窗）
        if (r.costHalf > spec.optimalHalf) {
          expect(elementEdgeOf(level, fam), `${level.id} ${fam} 元件版应成本占优`).toBe('cost');
        } else {
          expect(elementEdgeOf(level, fam), `${level.id} ${fam} 元件版不应占优`).toBeNull();
        }
      }
    }
    expect(sawOverBudget, '至少一个契约门版应超预算（TTL 拼两门 44 > 40）').toBe(true);
  }, 60_000);
});
