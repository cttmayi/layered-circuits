// @vitest-environment jsdom
/**
 * 端到端回归：一键出答案后点击按钮，非门输出电平必须跟着变。
 *
 * 曾复现的 bug：跨仿真恢复只还原 nodeSig 不还原 contrib（元素贡献缓存），
 * 门版/元件版状态电路在输入变化后被陈旧贡献毒化 —— 按钮松开后非门输出
 * 卡在强 0，画面电平不再变化。修复：快照同时携带 contrib，恢复时成对还原。
 * 本条用真实 UI 流程（进关 → 调试模式 → 一键出答案 → 点按钮 → 自动弹回）
 * 走 handleRequest spy 断言「非门输出网」电平 1 → 0 → 1 全程正确。
 */
import { ALL_LEVELS, teachingModulesFor, teachingSolutionOf } from '@lc/content';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { fromDesign, toDesign } from '../src/editor/model';
import { docForLevel } from '../src/level/progress';
import type { StudioRequestInput, StudioResponse } from '../src/sim/protocol';
import { seedTeachCleared } from './helpers';

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

const level = ALL_LEVELS.find((l) => l.id === 's2-btn-latch')!;
// 一键出答案默认给逻辑门版：btn → 非门 N1 → sn。从门版拓扑推出 sn 的顶层网。
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
const btnSym = answerDoc.syms.find((s) => s.label === 'btn')!;
const btnPortId = answerDoc.syms.find((s) => s.kind === 'input' && s.label === 'btn')!.id;
const answerDesign = toDesign(answerDoc);
const btnNet = answerDesign.nets.find((n) =>
  n.pins.some((p) => p.inst === btnPortId && p.pin === 'p'),
)!;
// btn 网上的模块 a 脚 → 该模块（非门）的 y 脚所在网 = sn
const aPin = btnNet.pins.find((p) => p.pin === 'a');
const notNet = aPin
  ? answerDesign.nets.find((n) => n.pins.some((p) => p.inst === aPin.inst && p.pin === 'y'))
  : undefined;
expect(notNet, '门版拓扑应存在 btn→非门→sn 连线').toBeDefined();

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
/** 松开：按钮端口按住 = 1、松开归 0 */
function releaseWorld(): void {
  fireEvent.mouseUp(canvas());
}

/** 进按钮锁存关：清存档 → 教学关通关 → 前置关全通关 → render → 点关 */
function enterBtnLatch(): void {
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
  fireEvent.click(screen.getByText('按钮锁存'));
}

const sigOf = (resp: StudioResponse | undefined, net: string): number | undefined =>
  resp?.snapshot?.netSignals.find(([k]) => k === net)?.[1];

describe('一键出答案后点按钮（端到端）', () => {
  beforeEach(() => {
    localStorage.clear();
    responses.length = 0;
  });

  it('非门输出随按压 1→0、自动弹回 0→1，锁存器全程正确', { timeout: 40_000 }, async () => {
    enterBtnLatch();
    await waitFor(() => expect(screen.getByText('调试模式')).toBeTruthy(), { timeout: 4000 });
    fireEvent.click(screen.getByText('调试模式'));
    fireEvent.click(screen.getByText('一键出答案'));
    await new Promise((r) => setTimeout(r, 300));
    const modal = screen.queryByText('逻辑门版（简洁）');
    if (modal) fireEvent.click(modal);
    // 等一键出答案的仿真跑完（至少一次 simulate 响应）
    await waitFor(() => expect(responses.length).toBeGreaterThan(0), { timeout: 4000 });
    const before = responses[responses.length - 1];
    const beforeSig = sigOf(before.resp, notNet!.id);
    expect(beforeSig).toBe(5); // 松开按钮：非门输出弱 1

    // 点按钮（按住）：必须发出 btn=1 的新仿真，且非门输出翻到强 0
    clickWorld(btnSym.x, btnSym.y);
    await waitFor(() => expect(responses.some((x) => x.req.inputs.btn === 1)).toBe(true), {
      timeout: 4000,
    });
    const press = responses.find((x) => x.req.inputs.btn === 1);
    expect(press).toBeDefined();
    expect(sigOf(press?.resp, notNet!.id)).toBe(8); // 非门输出强 0

    // 松开按钮 → 归 0：非门输出回到弱 1
    releaseWorld();
    await waitFor(() => expect(responses.some((x) => x.req.inputs.btn === 0)).toBe(true), {
      timeout: 4000,
    });
    const release = responses.find((x) => x.req.inputs.btn === 0);
    expect(release).toBeDefined();
    expect(sigOf(release?.resp, notNet!.id)).toBe(5);
  });
});
