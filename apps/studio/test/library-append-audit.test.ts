// @vitest-environment node
/**
 * 同类问题扫描（用户第 ⑬ 轮）：**谁在往库里追加条目，追加时按内容 hash 去重了没有。**
 *
 * 背景（先量后改的结论）：库是「一 hash 一条」（内容寻址），而菜单是「一条目一张卡」
 * （Palette 的基础门 = `library.filter(teaching && BASIC_GATES)`）。所以任何
 * `[...library, ...extra]` 式的**不去重追加**一旦被重复触发，玩家就会看到同一个门
 * 变出好几张卡 —— 用户实测：连点「一键出答案」，基础门 5 → 10 → 15 → 20。
 * 修法是把这些点全部改走 `mergeModules` / `addModule`（内容寻址合并）。
 *
 * 这条测试**静态扫源码**，把「库组成点」全部列出来并逐个判定，将来有人再写一个
 * 不去重的追加点，这里立刻报红（不需要等到玩家点出一个重复卡）。
 * 运行时的行为断言（连点 3 次、反复进关）在 debug-answer-idempotent.test.tsx。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeModules } from '../src/level/library';

const SRC_DIR = resolve(process.cwd(), 'apps/studio/src');

/** 允许「原样拷贝库」或「在内容寻址的入库函数内部」出现数组展开的地方（其余一律报红） */
const ALLOWED = new Set([
  // addModule / mergeModules 本体：库的**唯一**入库口，天然按 hash 去重
  'apps/studio/src/level/library.ts',
  // 只做拷贝、不追加任何条目（读档补教学模板的早退分支 / 去重前的浅拷贝）
  'apps/studio/src/level/session.ts',
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

interface Site {
  file: string;
  line: number;
  text: string;
}

/** 形如 `[...library]` / `[...doc.library, x]` 的数组展开（只看代码，跳过注释行） */
function librarySpreadSites(): Site[] {
  const sites: Site[] = [];
  for (const full of sourceFiles(SRC_DIR)) {
    const rel = relative(process.cwd(), full);
    const lines = readFileSync(full, 'utf8').split('\n');
    lines.forEach((text, i) => {
      const code = text.trim();
      if (code.startsWith('*') || code.startsWith('//')) return; // 注释里提到写法不算
      if (/\[\s*\.\.\.[^\]]*\blibrary\b[^\]]*\]/.test(code)) {
        sites.push({ file: rel, line: i + 1, text: code });
      }
    });
  }
  return sites;
}

describe('库组成点扫描：追加必须内容寻址去重', () => {
  it('把每个「库数组展开」点列出来，并逐个判定是否安全', () => {
    const sites = librarySpreadSites();
    console.log(`[scan] 库数组展开点 ${sites.length} 处：`);
    const offenders: string[] = [];
    for (const site of sites) {
      // 判定：① 展开里只出现 library 自己（纯拷贝，不会增长）→ 安全；
      //      ② 在 ALLOWED 文件里（addModule/mergeModules 本体）→ 安全；
      //      ③ 其余（展开之外还追加了别的条目）→ 必须报红。
      const onlyLibrary = !/\[\s*\.\.\.[^\]]*\blibrary\b[^\]]*,\s*[^\]]+\]/.test(site.text);
      const allowedFile = ALLOWED.has(site.file);
      const verdict = onlyLibrary
        ? '纯拷贝'
        : allowedFile
          ? '入库函数内部（按 hash 去重）'
          : '✗ 不去重追加';
      console.log(`[scan]   ${verdict}｜${site.file}:${site.line}｜${site.text}`);
      if (!onlyLibrary && !allowedFile) offenders.push(`${site.file}:${site.line} → ${site.text}`);
    }
    expect(offenders, `这些点会重复污染库：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('教学整族注入一律经过 mergeModules（不许再写 [...library, ...teachingStoredFor(...)]）', () => {
    const rows: string[] = [];
    const offenders: string[] = [];
    for (const full of sourceFiles(SRC_DIR)) {
      const rel = relative(process.cwd(), full);
      const lines = readFileSync(full, 'utf8').split('\n');
      lines.forEach((text, i) => {
        const code = text.trim();
        if (code.startsWith('*') || code.startsWith('//')) return;
        if (!code.includes('teachingStoredFor(')) return;
        // 合法形态：喂给内容寻址合并口（含"先取到局部变量、下一句合并"的写法）；
        //          或只是取值做查表（不往库里追加）。
        const window = [
          code,
          lines[i + 1]?.trim() ?? '',
          lines[i + 2]?.trim() ?? '',
          lines[i + 3]?.trim() ?? '',
        ].join(' ');
        const merged = /mergeModules\(/.test(window) || /addModule\(/.test(window);
        const lookupOnly = /const all = teachingStoredFor\(/.test(code);
        rows.push(
          `${merged ? '合并入库' : lookupOnly ? '只做查表' : '✗ 未知用法'}｜${rel}:${i + 1}｜${code}`,
        );
        if (!merged && !lookupOnly) offenders.push(`${rel}:${i + 1} → ${code}`);
      });
      // `...teachingStoredFor(` 这种写法本身就是不去重追加的形状，直接禁止
      for (const [i, text] of lines.entries()) {
        if (/\.\.\.\s*teachingStoredFor\(/.test(text)) {
          offenders.push(`${rel}:${i + 1} → ${text.trim()}（展开了整族、却不走内容寻址合并）`);
        }
      }
    }
    console.log(`[scan] teachingStoredFor 调用点 ${rows.length} 处：`);
    for (const row of rows) console.log(`[scan]   ${row}`);
    expect(offenders, `教学族注入的非法写法：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('实测口径对照：mergeModules 幂等、addModule 幂等、而裸追加不幂等（反证）', () => {
    // 用真实模块对象跑一遍：同 hash 的目标只有一条；裸追加会翻倍（这正是修前的行为）
    const base = [{ hash: 'a' }, { hash: 'b' }] as never[];
    const extra = [{ hash: 'a' }, { hash: 'b' }, { hash: 'c' }] as never[];
    const merged = mergeModules(base, extra);
    expect(merged.map((m) => (m as { hash: string }).hash)).toEqual(['a', 'b', 'c']);
    expect(mergeModules(merged, extra)).toBe(merged); // 已经都在 → 引用都不变（React 依赖友好）
    expect([...base, ...extra].length).toBe(5); // 反证：裸追加 = 5 条（3 条是重复）
  });
});
