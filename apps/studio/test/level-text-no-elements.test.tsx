// @vitest-environment jsdom
/**
 * **数据驱动护栏：不允许元件的关卡，提示/教学文案里不得提到元件**（用户第 ⑱ 轮拍板）。
 *
 * 为什么要有它：第 11 关（主从 D 触发器）的提示原本写着「时钟反相用一个**单管反相器**即可
 * （成本 98 元）」，但该关 `elementAccess: 'none'` —— 调色板里根本没有元件，
 * 提示在教玩家用一个**拿不到**的东西。这类错误会随新关卡再犯，所以钉成自动用例。
 *
 * 判据（全部从关卡数据里读，不硬编码关卡清单）：
 *   · `elementAccess !== 'all'` 的关卡：**任何文本字段**都不得出现元件词（三极管/电阻/二极管/
 *     单管/NPN/PNP/上拉/下拉/VCC/GND/元件）；
 *   · 反向对照：`elementAccess === 'all'` 的时序关卡**必须**提到元件（否则这条护栏等于没测东西）；
 *   · 外加一条界面断言：真的把第 11 关渲染出来，对话框里显示的是**改后**文案、不再是旧文案。
 */
import { ALL_LEVELS } from '@lc/content';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';

const ELEMENT_WORDS = [
  '三极管',
  '电阻',
  '二极管',
  '单管',
  'NPN',
  'PNP',
  '上拉',
  '下拉',
  'VCC',
  'GND',
  '元件',
] as const;

/** 递归收集对象里所有字符串字段（带路径），跳过纯标识字段 */
const collectText = (o: unknown, path: string, out: Array<[string, string]>): void => {
  if (typeof o === 'string') {
    out.push([path, o]);
    return;
  }
  if (Array.isArray(o)) {
    o.forEach((v, i) => {
      collectText(v, `${path}[${i}]`, out);
    });
    return;
  }
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (/^(id|hash|family|judgeMode|elementAccess|moduleAccess|stage|mode)$/.test(k)) continue;
      collectText(v, path ? `${path}.${k}` : k, out);
    }
  }
};

const elementHits = (level: unknown): Array<[string, string]> => {
  const all: Array<[string, string]> = [];
  collectText(level, '', all);
  return all.filter(([, t]) => ELEMENT_WORDS.some((w) => t.includes(w)));
};

describe('关卡文案：无元件的关卡不许提元件（数据驱动）', () => {
  it('逐关扫全部文本字段：elementAccess=none 的关卡命中 0 处', () => {
    const lines: string[] = [];
    const offenders: string[] = [];
    for (const [i, level] of ALL_LEVELS.entries()) {
      const acc = (level as { elementAccess?: string }).elementAccess ?? '(未设)';
      const hits = elementHits(level);
      lines.push(
        `#${String(i + 1).padStart(2)} ${level.id.padEnd(15)} elementAccess=${acc.padEnd(5)} 元件词命中=${hits.length}`,
      );
      if (acc !== 'all' && hits.length > 0) {
        offenders.push(
          `#${i + 1} ${level.id}（${acc}）：${hits.map(([p, t]) => `${p}=「${t.slice(0, 60)}…」`).join('；')}`,
        );
      }
    }
    console.log(`\n${lines.join('\n')}\n`);
    expect(offenders, '不许元件的关卡却提到了元件').toEqual([]);
  }, 900_000);

  it('反向对照：elementAccess=all 的时序关卡确实会提到元件（护栏不是空转）', () => {
    const timing = ALL_LEVELS.filter(
      (l) => (l as { elementAccess?: string }).elementAccess === 'all',
    );
    expect(timing.length, '时序关卡数量').toBe(7);
    const withElements = timing.filter((l) => elementHits(l).length > 0);
    console.log(
      `[1b] 可自由用元件的关卡 ${timing.length} 个，其中提到元件的 ${withElements.length} 个`,
    );
    expect(withElements.length).toBeGreaterThanOrEqual(6);
  }, 900_000);
});

/** 通关前置关卡，好让第 11 关解锁（关卡地图里锁着的关点不进去）*/
const seedClearedBefore = (id: string): void => {
  localStorage.clear();
  const key = 'lc-studio-progress-v1';
  const cleared: Record<
    string,
    { score: number; bestProfitHalf: number; bestCostHalf: number; clearedAt: number }
  > = {};
  for (const l of ALL_LEVELS) {
    if (l.id === id) break;
    cleared[l.id] = { score: 100, bestProfitHalf: 999, bestCostHalf: 6, clearedAt: 1 };
  }
  localStorage.setItem(key, JSON.stringify({ cleared }));
};

describe('第 11 关界面文案（改前 → 改后）', () => {
  it('对话框显示新文案、且不再出现「单管反相器 / 成本 98 元」这种拿不到的做法', () => {
    seedClearedBefore('s2-dff');
    render(<App />);
    fireEvent.click(screen.getByText('关卡模式'));
    fireEvent.click(screen.getByText('主从 D 触发器'));
    const dialogText = document.body.textContent ?? '';
    const shown =
      /\u65f6\u949f\u53cd\u76f8\u7528\u4e00\u4e2a\u3010\u975e\u95e8\u3011\u5373\u53ef/.test(
        dialogText,
      );
    console.log(
      `[1c] 对话框里出现「时钟反相用一个【非门】即可」=${shown}｜出现「单管反相器」=${dialogText.includes('单管反相器')}`,
    );
    expect(shown, '对话框应当显示改后的文案').toBe(true);
    expect(dialogText.includes('单管反相器'), '不许再出现「单管反相器」').toBe(false);
  }, 900_000);
});
