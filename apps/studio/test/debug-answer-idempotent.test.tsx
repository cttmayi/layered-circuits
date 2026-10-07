// @vitest-environment jsdom
/**
 * 「一键出答案」幂等闸门（用户实测 bug：每点一次，基础门里的门就变多）。
 *
 * 根因（先量后改，实测原始输出见提交信息）：
 *   · `applyAnswer` 用 `[...doc.library, ...extra]` **不去重追加**整族教学积木
 *     → 每点一次多 5 张：基础门 5 → 10 → 15 → 20（Palette 是"一条目一张卡"）；
 *   · `withLevelGates` 也是不去重追加 → 玩家通完一关后（progress.library 里已存教学依赖），
 *     再进下一关基础门就带重复（实测第 7 关 8 张里 3 张是重复）——**正式玩法也会中招**。
 * 修法：两处都改成 `mergeModules`（内容寻址合并，库本来就是按 hash 寻址的）。
 *
 * 这里的断言是**逐字不变**：组头（含计数）、卡片名字列表（含顺序）、我的模块条数，
 * 重复操作前后必须完全相等。同时保留反证：点一次确实把答案搭出来了
 * （toast + 图例 = 仿真拿到快照），否则"不变"没有意义。
 *
 * 覆盖的重复操作（用户要求"扫同类问题别只修一个症状"）：
 *   A 连点 3 次「一键出答案」（有基础门的关卡）
 *   B 第 11 关（我的模块非空）连点 3 次
 *   C 反复进同一关（每一次进关都会 withLevelGates 注入整族）
 *   D 存档里已经在教学依赖时进下一关（正式玩法路径，不是 debug）
 *   E 一键出答案 → 交付验收 → 再点一次
 */

import { ALL_LEVELS, teachingModulesFor } from '@lc/content';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { disableDebugUrl, dismissTaskDialog, enableDebugUrl, startJob } from './helpers';

interface GroupSnapshot {
  head: string;
  names: string[];
}

/** 关心这几组：基础门（教学内容）、我的模块（玩家资产）、我的元件 */
const WATCHED = ['基础门', '我的模块', '我的元件'] as const;

/** 组快照：组头（含计数）+ 卡片名字列表（去掉徽章后缀、剔除置灰的"本关不可用"） */
function snapshot(): Record<string, GroupSnapshot> {
  const out: Record<string, GroupSnapshot> = {};
  for (const sec of document.querySelectorAll('.palette-section')) {
    const head = (sec.querySelector('.palette-section-title')?.textContent || '').trim();
    const key = head.replace(/（\d+）$/, '');
    if (!(WATCHED as readonly string[]).includes(key)) continue;
    const names = [...sec.querySelectorAll('.palette-name')]
      .map((n) => (n.textContent || '').replace(/\s+(时序|组合|模块)$/, '').trim())
      .filter((n) => !n.includes('本关不可用'));
    out[key] = { head, names };
  }
  return out;
}

/** 把关卡之前的所有关都标成已通关（cleared 必须是对象，数字会被 App 丢掉） */
function seedUpTo(title: string, library: unknown[] = []): void {
  const idx = ALL_LEVELS.findIndex((l) => l.title === title);
  const cleared: Record<string, { score: number; bestCostHalf: number; clearedAt: number }> = {};
  for (const l of ALL_LEVELS.slice(0, idx)) {
    cleared[l.id] = { score: 100, bestCostHalf: 0, clearedAt: 1 };
  }
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
}

/**
 * 教学依赖条目（通完一关后 wrapAndSettle 会存进 progress.library 的那种：
 * teaching: true + 真 hash）—— 用来复现"正式玩法进下一关"的场景 D
 */
function teachingDeps(names: readonly string[]): unknown[] {
  return teachingModulesFor('rtl')
    .filter((t) => names.includes(t.name))
    .map((t) => ({
      hash: t.hash,
      name: t.name,
      version: t.version,
      stage: t.stage,
      costHalf: t.costHalf,
      isSequential: t.isSequential,
      ports: t.ports,
      template: t,
      sources: [],
      createdAt: 0,
      teaching: true,
    }));
}

/** 玩家自制模块（拿教学 D 锁存器的身体，名字自己起 → 让「我的模块」非空） */
function playerModule(name: string): unknown {
  const latch = teachingModulesFor('rtl').find((t) => t.name === 'D锁存器');
  if (!latch) throw new Error('教学族里没有 D锁存器');
  return {
    hash: latch.hash,
    name,
    version: '1.0',
    stage: 2,
    costHalf: latch.costHalf,
    isSequential: latch.isSequential,
    ports: latch.ports,
    template: latch,
    sources: [],
    createdAt: 0,
  };
}

/** 点一次「一键出答案」（弹出二选一就选逻辑门版），等图例出现 = 答案确实搭好了、仿真跑过 */
async function clickAnswer(): Promise<void> {
  fireEvent.click(screen.getByText('一键出答案'));
  const modal = document.querySelector('.modal-box');
  if (modal) {
    const gate = [...modal.querySelectorAll('button')].find((b) =>
      /逻辑门版|门版/.test(b.textContent || ''),
    );
    if (gate) fireEvent.click(gate);
  }
  await waitFor(() => expect(document.querySelector('.legend')).toBeTruthy(), { timeout: 5000 });
}

describe('「一键出答案」幂等：重复点不改变库', () => {
  beforeEach(() => {
    localStorage.clear();
    enableDebugUrl();
  });

  it('A 第 6 关「与非门」连点 3 次：基础门计数与名字列表逐字不变 + 反证答案确实搭出来了', async () => {
    seedUpTo('与非门');
    render(<App />);
    startJob('与非门');
    dismissTaskDialog();

    const before = snapshot();
    console.log(
      `[幂等 A] 初始：基础门「${before['基础门']?.head}」=${JSON.stringify(before['基础门']?.names)}`,
    );
    // 反证：这一关确实有门版答案可搭（否则下面的"不变"可能是"什么都没发生"）
    expect(before['基础门']?.names.length).toBe(5);

    for (let i = 1; i <= 3; i++) {
      await clickAnswer();
      // 答案确实搭上去了：toast 说「逻辑门版已搭好…」
      expect(document.querySelector('.toast')?.textContent ?? '').toContain('逻辑门版已搭好');
      const now = snapshot();
      console.log(
        `[幂等 A] 第${i}次点击后：基础门「${now['基础门']?.head}」｜我的模块「${now['我的模块']?.head}」｜元件组卡数=${now['我的元件']?.names.length}`,
      );
      expect(now, `第 ${i} 次点击后菜单必须逐字不变`).toEqual(before);
    }
  }, 60000);

  it('B 第 11 关「主从 D 触发器」（我的模块非空）连点 3 次：基础门与我的模块都不变', async () => {
    seedUpTo('主从 D 触发器', [playerModule('我的锁存器')]);
    render(<App />);
    startJob('主从 D 触发器');
    dismissTaskDialog();

    const before = snapshot();
    console.log(
      `[幂等 B] 初始：基础门「${before['基础门']?.head}」｜我的模块「${before['我的模块']?.head}」=${JSON.stringify(before['我的模块']?.names)}`,
    );
    expect(before['我的模块']?.names).toEqual(['我的锁存器']);

    for (let i = 1; i <= 3; i++) {
      await clickAnswer();
      expect(document.querySelector('.toast')?.textContent ?? '').toContain('逻辑门版已搭好');
      const now = snapshot();
      console.log(
        `[幂等 B] 第${i}次点击后：基础门「${now['基础门']?.head}」｜我的模块「${now['我的模块']?.head}」=${JSON.stringify(now['我的模块']?.names)}`,
      );
      expect(now, `第 ${i} 次点击后菜单必须逐字不变`).toEqual(before);
    }
  }, 60000);

  it('C 反复进同一关 3 次（每次进关都注入整族）：基础门名字列表逐字不变', async () => {
    seedUpTo('与非门');
    const rows: string[] = [];
    let first: Record<string, GroupSnapshot> | null = null;
    for (let i = 1; i <= 3; i++) {
      render(<App />); // 每次都是全新挂载 = 从地图再进这一关
      startJob('与非门');
      dismissTaskDialog();
      const now = snapshot();
      rows.push(`第${i}次进关：${JSON.stringify(now['基础门']?.names)}`);
      if (first === null) first = now;
      else expect(now, `第 ${i} 次进关后必须逐字不变`).toEqual(first);
      document.body.innerHTML = '';
    }
    for (const row of rows) console.log(`[幂等 C] ${row}`);
    expect(rows[0]).toContain('与非门');
  }, 60000);

  it('D 正式玩法（不用 debug）：存档里已有教学依赖时进下一关，基础门不带重复', async () => {
    // 模拟"刚通完第 6 关"：progress.library 里躺着 3 条真实教学依赖
    seedUpTo('异或门', teachingDeps(['非门', '与非门', '与门']));
    disableDebugUrl();
    render(<App />);
    startJob('异或门');
    dismissTaskDialog();

    const now = snapshot();
    console.log(
      `[幂等 D] 第 7 关：基础门「${now['基础门']?.head}」=${JSON.stringify(now['基础门']?.names)}`,
    );
    // 修前实测：8 张里 3 张重复（非门×2 / 与非门×2 / 与门×2）
    const names = now['基础门']?.names ?? [];
    expect(names.length).toBe(5);
    expect(new Set(names).size, `出现重复卡片：${JSON.stringify(names)}`).toBe(names.length);
  }, 60000);

  it('E 一键出答案 → 交付验收 → 再点一次：基础门与我的模块都不变', async () => {
    seedUpTo('与非门');
    render(<App />);
    startJob('与非门');
    dismissTaskDialog();
    await clickAnswer();
    const afterAnswer = snapshot();

    // 交付验收 → 自动封装（这一步会往 progress.library 里存教学依赖）→ 结算出现
    const judgeButtons = screen.getAllByText('交付验收');
    judgeButtons[judgeButtons.length - 1]?.click();
    await waitFor(() => expect(screen.getByText(/验收报告 · 与非门/)).toBeTruthy(), {
      timeout: 8000,
    });
    const afterWrap = snapshot();
    console.log(
      `[幂等 E] 验收后：基础门「${afterWrap['基础门']?.head}」｜我的模块「${afterWrap['我的模块']?.head}」=${JSON.stringify(afterWrap['我的模块']?.names)}`,
    );
    expect(afterWrap['基础门']).toEqual(afterAnswer['基础门']);

    // 结算对话框关掉后再点一次「一键出答案」：库不许再变
    const settleClose = document.querySelector('.modal-box .modal-close, .modal-box button');
    if (settleClose instanceof HTMLElement) fireEvent.click(settleClose);
    await clickAnswer();
    const afterSecond = snapshot();
    console.log(
      `[幂等 E] 再点一次：基础门「${afterSecond['基础门']?.head}」｜我的模块「${afterSecond['我的模块']?.head}」`,
    );
    expect(afterSecond['基础门']).toEqual(afterAnswer['基础门']);
    expect(afterSecond['我的模块']).toEqual(afterWrap['我的模块']);
  }, 60000);
});
