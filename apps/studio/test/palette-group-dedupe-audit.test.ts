// @vitest-environment node
/**
 * **显示层**守卫（用户第 ⑮ 轮口径，第 ⑯ 轮更新）：从库派生的**显示列表**要么按名字规范化
 * （基础门：名字即身份），要么明确声明"同名并存是故意的"（我的模块：玩家的不同作品）。
 *
 * 与 `library-append-audit.test.ts`（那一份盯的是「裸数组展开入库」）互补：那份防的是
 * "库里长出重复条目"，这份防的是"库里已经有重复条目 + 分组按名字列 → 同名出两张卡"。
 * 两份加起来覆盖两层，缺任何一层都会漏（本轮就是漏了显示层）。
 *
 * 判定规则（数据驱动，不写死行号）——扫 `apps/studio/src/**` 里所有从库派生列表的点
 * （`library.filter(` / `library.map(` / `library.flatMap(` / `modules.map(`）：
 *   ① 被 `dedupeByNameForDisplay(` 包住 → **显示层去重，合规**；
 *   ② 回调返回 `.template` / `.hash` → 喂编译器/判定的数据，不是显示列表，合规；
 *   ③ 同文件里紧邻出现 `new Set(` + `.name`，或 `m.name ===` 的比较 → 按名字分组（自行去重），合规；
 *   ③b `!m.teaching`（我的模块：玩家自建条目）→ **同名并存是口径**（第 ⑯ 轮：那是玩家的不同作品，
 *      合并等于替他删掉一件），合规；
 *   ④ 其余 → **报红**：可能是一条"按名字分组但没去重"的新路径。
 * 规则②③是刻意留的窄口子：真正的目标是把**新的**违规点逼出来，而不是把现有代码全判红。
 */
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../src');
const PATTERN = /\b(library|modules|owned|doc\.library)\s*\.\s*(filter|map|flatMap)\s*\(/g;

interface Site {
  file: string;
  line: number;
  text: string;
  verdict: '显示层去重' | '喂编译器/判定' | '按名字分组' | '玩家作品（同名并存）' | '✗ 未去重';
}

function scan(): Site[] {
  const files = globSync('**/*.{ts,tsx}', { cwd: SRC }).filter((f) => !f.endsWith('.d.ts'));
  const sites: Site[] = [];
  for (const rel of files) {
    const abs = path.join(SRC, rel);
    const lines = readFileSync(abs, 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
      // 注释行不算：它们出现在文档里是为了解释规则，不构成渲染路径
      if (/^\s*(\*|\/\/)/.test(line)) continue;
      PATTERN.lastIndex = 0;
      if (!PATTERN.test(line)) continue;
      // 上下文：本行 + 后 6 行（多行表达式）与前 2 行（包住它的调用）
      const before = lines.slice(Math.max(0, i - 2), i).join('\n');
      const here = line;
      const after = lines.slice(i + 1, i + 7).join('\n');
      const context = `${before}\n${here}\n${after}`;
      const wrapped =
        /dedupeByNameForDisplay\s*\(/.test(before + here) ||
        /dedupeByNameForDisplay\s*\(/.test(context);
      const plumbing = /=>\s*m?\.(template|hash)\b/.test(here + after);
      const groupedByName =
        (/new Set\(/.test(context) && /\.name\b/.test(context)) || /m\.name\s*===/.test(context);
      // 我的模块 = 非教学条目：玩家自建模块同名不同内容是他的两件作品（第 ⑯ 轮口径，不合并）
      const playerWorks = /!\s*m\.teaching/.test(here + after);
      sites.push({
        file: `apps/studio/src/${rel}`,
        line: i + 1,
        text: here.trim(),
        verdict: wrapped
          ? '显示层去重'
          : plumbing
            ? '喂编译器/判定'
            : groupedByName
              ? '按名字分组'
              : playerWorks
                ? '玩家作品（同名并存）'
                : '✗ 未去重',
      });
    }
  }
  return sites;
}

/** 允许出现"未去重"的文件（本轮全是库自身与历史面板，且都逐条说明了理由） */
const ALLOWED_FILES = new Set([
  // 库/会话自身的实现（去重函数、瘦身、溯源都在这）
  'apps/studio/src/level/library.ts',
  'apps/studio/src/level/session.ts',
]);

describe('显示层守卫：按名字分组必须去重（用户第 ⑮ 轮）', () => {
  it('扫描所有从库派生列表的点，逐个判定', () => {
    const sites = scan();
    const offenders = sites.filter((s) => s.verdict === '✗ 未去重' && !ALLOWED_FILES.has(s.file));
    console.log(`[显示层扫描] 共 ${sites.length} 处：`);
    for (const s of sites) {
      console.log(`[显示层扫描]   ${s.verdict}｜${s.file}:${s.line}｜${s.text.slice(0, 90)}`);
    }
    console.log(
      `[显示层扫描] 违规 ${offenders.length} 处${
        offenders.length
          ? `：\n${offenders.map((o) => `  ✗ ${o.file}:${o.line}｜${o.text}`).join('\n')}`
          : '（无）'
      }`,
    );
    expect(offenders).toEqual([]);
  });

  it('基础门分组：逻辑关走本关权威清单（不读库），时机关不渲染该组，自由模式按名字去重', () => {
    const palette = readFileSync(path.join(SRC, 'panels/Palette.tsx'), 'utf8');
    // ① 逻辑关分支：直接照 App 给的权威清单渲染 —— 这一支**不碰库**，
    //    所以库里塞重复/同名不同 hash/垃圾条目都不会影响这一组（第 ⑯ 轮）。
    expect(palette).toContain('const gateModules =');
    expect(palette).toMatch(/logicLevel\s*\?\s*\(gateCatalog \?\? \[\]\)\.filter\(/);
    // ② 时机关（第 1~7 关）：整组不渲染（用户第 ⑳ 轮：「基础门只在 8 关开始才有」）
    expect(palette).toMatch(/level && !logicLevel\s*\?\s*\[\]/);
    // ③ 自由模式分支：仍从库里取（那里强弱与工艺是真实差异）+ 按名字去重
    expect(palette).toContain('dedupeByNameForDisplay(');
    // ③ 我的模块：**不**合并同名（玩家作品）
    expect(palette).not.toMatch(
      /dedupeByNameForDisplay\(\s*library\.filter\(\(m\) => !m\.teaching\)/,
    );
    // 行为侧的守卫在 palette-gate-catalog.test.tsx（逐关 + 污染库 + 点击不变）里
  });

  it('反证：`dedupeByNameForDisplay` 本身按名字去重、且顺序可解释', async () => {
    const { dedupeByNameForDisplay } = await import('../src/level/library');
    const mod = (hash: string, name: string, version = '1.0.0', kind = 'player') => ({
      hash,
      name,
      version,
      stage: 1,
      costHalf: 10,
      isSequential: false,
      ports: [],
      template: null,
      sources: [],
      createdAt: 0,
      ...(kind === 'teaching' ? { teaching: true as const } : {}),
    });
    // 同名三条：order 里有的赢
    const lib = [mod('a', '非门'), mod('b', '非门'), mod('c', '非门')];
    expect(dedupeByNameForDisplay(lib, { order: ['a', 'c'] }).map((m) => m.hash)).toEqual(['a']);
    // 没有 order 时按版本号，同版本保留先到的
    expect(dedupeByNameForDisplay(lib).map((m) => m.hash)).toEqual(['a']);
    expect(
      dedupeByNameForDisplay([mod('x', 'M', '1.0.0'), mod('y', 'M', '2.0.0')]).map((m) => m.hash),
    ).toEqual(['y']);
    // 顺序：有 order 时按 order 排；没有时保持库里的原始次序
    const ordered = dedupeByNameForDisplay([mod('a', '甲'), mod('b', '乙'), mod('c', '丙')], {
      order: ['c', 'b', 'a'],
    });
    expect(ordered.map((m) => m.name)).toEqual(['丙', '乙', '甲']);
    expect(
      dedupeByNameForDisplay([mod('a', '甲'), mod('b', '乙'), mod('c', '丙')]).map((m) => m.name),
    ).toEqual(['甲', '乙', '丙']);
    // 不同名字一个不删
    expect(dedupeByNameForDisplay([mod('a', '甲'), mod('b', '乙')])).toHaveLength(2);
  });
});
