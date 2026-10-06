// @vitest-environment jsdom
/**
 * 端到端回归：s3-display2（数码管显示关，模块复用 2× 译码器）点击 bcd 输入，seg 数码管必须跟随变化。
 *
 * 曾复现的 bug：复用上次终态时（prevSignals/prevContribs），快照只含顶层网、模块内部节点
 * 不恢复 —— 「部分恢复 + 输入变化再收敛」时深组合链（43 门译码器）收敛到错误状态，表现就是
 * 「改 BCD 值后 seg 经常不更新」。根因（快照不含模块内部节点）已修：现在复用会带上全节点
 * 电平，见 reuse-module-chain.test.ts；「重新计算」按钮仍可丢弃终态强制全量重算。
 *
 * 注：终态复用只在「电路指纹（拓扑 + 输入）相同」时发生，点输入这类操作本来就不走复用路径 ——
 * 这条测试守的是玩家看得见的那件事：seg 跟着输入变。
 */
import { ALL_LEVELS, teachingModulesFor, teachingSolutionOf } from '@lc/content';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { fromDesign, toDesign } from '../src/editor/model';
import { docForLevel } from '../src/level/progress';
import type { StudioRequestInput, StudioResponse } from '../src/sim/protocol';
import { atWorld, stubCanvasSize } from './camera-probe';
import { enableDebugUrl, seedTeachCleared } from './helpers';

vi.mock('../src/editor/render.ts', async (importOriginal) => {
  const { withCameraProbe } = await import('./camera-probe');
  return withCameraProbe(await importOriginal<typeof import('../src/editor/render.ts')>());
});

/** 记录每个 simulate 请求与其（同步）响应 */
const responses = vi.hoisted(() => [] as Array<{ req: StudioRequestInput; resp: StudioResponse }>);
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

const level = ALL_LEVELS.find((l) => l.id === 's3-display2')!;
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
  sources: [] as string[],
  createdAt: 0,
}));
const answerDoc = fromDesign(gateDesign, docForLevel(level, lib));
const bcdSym = answerDoc.syms.find((s) => s.kind === 'input' && s.label === 'bcd1')!;
// seg1 数码管端口在答案电路里的网——仿真响应里按这些顶层网名读段码
const segNets = toDesign(answerDoc).ports.find((p) => p.name === 'seg1')!.nets;

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

const canvas = (): HTMLCanvasElement => document.querySelector('canvas') as HTMLCanvasElement;
/** 世界坐标 → client 坐标：用 App 当前相机（进关自适应后相机不是固定值了） */
function clickWorld(wx: number, wy: number): void {
  fireEvent.mouseDown(canvas(), { button: 0, ...atWorld(wx, wy) });
}

/** 进数码管关：清存档 → 教学关通关 → 前置关全通关 → render → 点关 */
function enterDisplay(): void {
  enableDebugUrl(); // 「调试模式」按钮只在 ?debug=1 时出现（挂载时判定，必须在 render 前）
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

describe('数码管关：点 bcd 输入 seg 跟随 + 重新计算', () => {
  beforeEach(() => {
    localStorage.clear();
    responses.length = 0;
    stubCanvasSize(1280, 754); // jsdom 兜底只有 200×200：给个真实画布尺寸，世界坐标才落在画布内
  });

  it('一键出答案后点 bcd 0→1→2，seg 段码跟随', {
    timeout: 40_000,
  }, async () => {
    enterDisplay();
    await waitFor(() => expect(screen.getByText('调试模式')).toBeTruthy(), { timeout: 4000 });
    fireEvent.click(screen.getByText('一键出答案')); // ?debug=1：进入即已开
    await new Promise((r) => setTimeout(r, 300));
    const modal = screen.queryByText('逻辑门版（简洁）');
    if (modal) fireEvent.click(modal);
    await waitFor(() => expect(responses.length).toBeGreaterThan(0), { timeout: 4000 });

    // 画布恒按真实时序跑（2026-01 移除科普模式）。终态复用只在"电路指纹相同"时发生
    // （输入一变指纹就变），所以这里不查 prevSignals —— 守的是玩家看得见的那件事：
    // 点一下 bcd 输入，seg 段码照样跟着变（复用路径不能把输出冻住）。

    // 点 bcd1：值 0 → 1（seg 0x3F → 0x06），再点 → 2（0x5B）
    clickWorld(bcdSym.x, bcdSym.y);
    await waitFor(
      () =>
        expect(
          responses.some(
            (x) =>
              ('inputs' in x.req ? x.req.inputs : ({} as Record<string, number>))['bcd1[0]'] === 1,
          ),
        ).toBe(true),
      {
        timeout: 4000,
      },
    );
    const v1 = [...responses]
      .reverse()
      .find(
        (x) => ('inputs' in x.req ? x.req.inputs : ({} as Record<string, number>))['bcd1[0]'] === 1,
      );
    expect(readSeg(v1?.resp)).toBe(0x06);

    clickWorld(bcdSym.x, bcdSym.y);
    await waitFor(
      () =>
        expect(
          responses.some(
            (x) =>
              ('inputs' in x.req ? x.req.inputs : ({} as Record<string, number>))['bcd1[1]'] === 1,
          ),
        ).toBe(true),
      {
        timeout: 4000,
      },
    );
    const v2 = [...responses]
      .reverse()
      .find(
        (x) => ('inputs' in x.req ? x.req.inputs : ({} as Record<string, number>))['bcd1[1]'] === 1,
      );
    expect(readSeg(v2?.resp)).toBe(0x5b);
  });

  it('「重新计算」按钮：丢弃终态，全量重新计算', { timeout: 40_000 }, async () => {
    enterDisplay();
    // ?debug=1：进入即已开，直接等「重新计算」出现
    await waitFor(() => expect(screen.getByText('重新计算')).toBeTruthy(), { timeout: 4000 });
    const before = responses.length;
    fireEvent.click(screen.getByText('重新计算'));
    await waitFor(() => expect(responses.length).toBeGreaterThan(before), { timeout: 4000 });
    // 重新计算 = 全新仿真（带明确语义的全量重算，无终态复用）
    expect(screen.getByText('已重新计算：全部门逻辑重新求值')).toBeTruthy();
  });
});
