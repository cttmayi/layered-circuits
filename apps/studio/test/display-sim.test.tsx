// @vitest-environment jsdom
/**
 * 端到端回归：s3-display（组合译码器关）点击 bcd 输入，seg 数码管必须跟随变化。
 *
 * 曾复现的 bug：组合关卡也复用上次终态（prevSignals/prevContribs），而快照只含
 * 顶层网、模块内部节点不恢复 —— 「部分恢复 + 输入变化再收敛」时深组合链（43 门
 * 译码器）收敛到错误状态，表现就是「改 BCD 值后 seg 经常不更新」。
 * 修复：组合关卡不复用终态（shouldReuseSimState=false），每次从全量重算；
 * 另加「重新计算」按钮兜底（丢弃终态强制全量重算）。
 */
import { ALL_LEVELS, teachingModulesFor, teachingSolutionOf } from '@lc/content';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { fromDesign, toDesign } from '../src/editor/model';
import { docForLevel } from '../src/level/progress';
import type { StudioRequestInput, StudioResponse } from '../src/sim/protocol';
import { shouldReuseSimState } from '../src/sim/sim-policy';
import { seedTeachCleared } from './helpers';

/** 记录每个 simulate 请求与其（同步）响应 */
const responses = vi.hoisted(
  () => [] as Array<{ req: StudioRequestInput; resp: StudioResponse }>,
);
vi.mock('../src/sim/handle', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/sim/handle')>();
  return {
    ...mod,
    handleRequest: vi.fn((req: StudioRequestInput) => {
      const resp = mod.handleRequest(req as never) as StudioResponse;
      responses.push({ req, resp });
      return resp;
    }),
  };
});

const level = ALL_LEVELS.find((l) => l.id === 's3-display')!;
const gateDesign = teachingSolutionOf(level.id, 'rtl')!;
const lib = teachingModulesFor('rtl').map((m) => ({
  hash: m.hash,
  name: m.name,
  version: m.version,
  stage: m.stage,
  costHalf: m.costHalf,
  isSequential: m.isSequential,
  ports: m.ports,
  template: m,
  sources: [] as unknown[],
  createdAt: 0,
}));
const answerDoc = fromDesign(gateDesign, docForLevel(level, lib));
const bcdSym = answerDoc.syms.find((s) => s.kind === 'input' && s.label === 'bcd')!;
// seg 数码管端口在答案电路里的网（t18…）——仿真响应里按这些顶层网名读段码
const segNets = toDesign(answerDoc).ports.find((p) => p.name === 'seg')!.nets;

/** 从仿真响应读 seg 段码（bit0=a..bit6=g） */
function readSeg(resp: StudioResponse | undefined): number {
  const sig = resp?.snapshot?.netSignals;
  if (!sig) return -1;
  const map = new Map(sig);
  let v = 0;
  segNets.forEach((n, i) => {
    if ((map.get(n)! & 0x03) === 1) v |= 1 << i;
  });
  return v;
}

const CAMERA = { x: 340, y: 220 };
const SIZE = 200;
const canvas = (): HTMLCanvasElement => document.querySelector('canvas') as HTMLCanvasElement;
function clickWorld(wx: number, wy: number): void {
  fireEvent.mouseDown(canvas(), {
    button: 0,
    clientX: wx - CAMERA.x + SIZE / 2,
    clientY: wy - CAMERA.y + SIZE / 2,
  });
}

/** 进数码管关：清存档 → 教学关通关 → 前置关全通关 → render → 点关 */
function enterDisplay(): void {
  localStorage.clear();
  seedTeachCleared();
  const key = 'lc-studio-progress-v1';
  const prev = JSON.parse(localStorage.getItem(key) ?? '{}');
  const cleared = { ...(prev.cleared ?? {}) };
  for (const l of ALL_LEVELS) {
    if (l.id === level.id) break;
    cleared[l.id] = { score: 100, bestProfitHalf: 999, bestCostHalf: 6, clearedAt: 1 };
  }
  localStorage.setItem(key, JSON.stringify({ ...prev, cleared }));
  render(<App />);
  fireEvent.click(screen.getByText('关卡模式'));
  fireEvent.click(screen.getByText(level.title));
}

describe('shouldReuseSimState：组合关不复用终态；时序/锁存器关与沙盒复用', () => {
  it('策略矩阵', () => {
    const byId = (id: string) => ALL_LEVELS.find((l) => l.id === id)!;
    // 组合关：无记忆 → 全量重算（避免部分恢复污染）
    expect(shouldReuseSimState(byId('s3-display'), 'level')).toBe(false);
    expect(shouldReuseSimState(byId('s3-alu'), 'level')).toBe(false);
    // 锁存器/寄存器/计算器：必须复用才能跨仿真保持状态
    expect(shouldReuseSimState(byId('s2-btn-latch'), 'level')).toBe(true);
    expect(shouldReuseSimState(byId('s3-reg-8'), 'level')).toBe(true);
    expect(shouldReuseSimState(byId('s3-calc'), 'level')).toBe(true);
    // 沙盒未知 → 按可能有锁存器处理
    expect(shouldReuseSimState(null, 'free')).toBe(true);
    expect(shouldReuseSimState(byId('s3-display'), 'free')).toBe(true);
  });
});

describe('数码管关：点 bcd 输入 seg 跟随 + 组合关不复用终态 + 重新计算', () => {
  beforeEach(() => {
    localStorage.clear();
    responses.length = 0;
  });

  it('一键出答案后点 bcd 0→1→2，seg 段码跟随；组合关 simulate 全程不带 prevSignals', { timeout: 40_000 }, async () => {
    enterDisplay();
    await waitFor(() => expect(screen.getByText('调试模式')).toBeTruthy(), { timeout: 4000 });
    fireEvent.click(screen.getByText('调试模式'));
    fireEvent.click(screen.getByText('一键出答案'));
    await new Promise((r) => setTimeout(r, 300));
    const modal = screen.queryByText('逻辑门版（简洁）');
    if (modal) fireEvent.click(modal);
    await waitFor(() => expect(responses.length).toBeGreaterThan(0), { timeout: 4000 });

    // 组合关：任何 simulate 请求都不应复用终态（否则部分恢复会污染结果）
    for (const r of responses) {
      expect(r.req.prevSignals, `组合关不复用 prevSignals（${r.req.inputs['bcd[0]']}）`).toBeUndefined();
      expect(r.req.prevContribs).toBeUndefined();
    }

    // 点 bcd：值 0 → 1（seg 0x3F → 0x06），再点 → 2（0x5B）
    clickWorld(bcdSym.x, bcdSym.y);
    await waitFor(
      () => expect(responses.some((x) => x.req.inputs['bcd[0]'] === 1)).toBe(true),
      { timeout: 4000 },
    );
    const v1 = [...responses].reverse().find((x) => x.req.inputs['bcd[0]'] === 1);
    expect(readSeg(v1?.resp)).toBe(0x06);

    clickWorld(bcdSym.x, bcdSym.y);
    await waitFor(
      () => expect(responses.some((x) => x.req.inputs['bcd[1]'] === 1)).toBe(true),
      { timeout: 4000 },
    );
    const v2 = [...responses].reverse().find((x) => x.req.inputs['bcd[1]'] === 1);
    expect(readSeg(v2?.resp)).toBe(0x5b);

    for (const r of responses) {
      expect(r.req.prevSignals).toBeUndefined();
      expect(r.req.prevContribs).toBeUndefined();
    }
  });

  it('「重新计算」按钮：丢弃终态，全量重新计算', { timeout: 40_000 }, async () => {
    enterDisplay();
    await waitFor(() => expect(screen.getByText('调试模式')).toBeTruthy(), { timeout: 4000 });
    fireEvent.click(screen.getByText('调试模式'));
    await waitFor(() => expect(screen.getByText('重新计算')).toBeTruthy(), { timeout: 4000 });
    const before = responses.length;
    fireEvent.click(screen.getByText('重新计算'));
    await waitFor(() => expect(responses.length).toBeGreaterThan(before), { timeout: 4000 });
    // 重新计算 = 全新仿真（带明确语义的全量重算，无终态复用）
    expect(screen.getByText('已重新计算：全部门逻辑重新求值')).toBeTruthy();
  });
});
