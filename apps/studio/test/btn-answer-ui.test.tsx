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
  sources: [] as string[],
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

const canvas = (): HTMLCanvasElement => document.querySelector('canvas') as HTMLCanvasElement;
/** 世界坐标 → client 坐标：用 App 当前相机（进关自适应后相机不是固定值了） */
function clickWorld(wx: number, wy: number): void {
  fireEvent.mouseDown(canvas(), { button: 0, ...atWorld(wx, wy) });
}
/** 松开：按钮端口按住 = 1、松开归 0 */
function releaseWorld(): void {
  fireEvent.mouseUp(canvas());
}

/** 进按钮锁存关：清存档 → 教学关通关 → 前置关全通关 → render → 点关 */
function enterBtnLatch(): void {
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
  fireEvent.click(screen.getByText('按钮锁存'));
}

const sigOf = (resp: StudioResponse | undefined, net: string): number | undefined =>
  resp?.snapshot?.netSignals.find(([k]) => k === net)?.[1];

/**
 * **逻辑关画布自第 ㉑ 轮起走有延迟门级**（白名单 18 关），门级口径**没有强弱**
 * （用户早已拍板"逻辑关去掉强/弱"）—— 门级输出一律按**强驱动**打包，所以画布上的电平
 * 只剩下**逻辑值**这一个自由维度。这里按逻辑位判定，不再断言"弱 1/强 0"的强度编码
 * （改动前的读数：松开=5 弱 1、按住=8 强 0；改动后：松开=9 强 1、按住=8 强 0）。
 */
const logicOf = (resp: StudioResponse | undefined, net: string): number | undefined => {
  const sig = sigOf(resp, net);
  return sig === undefined ? undefined : sig & 1;
};

describe('一键出答案后点按钮（端到端）', () => {
  beforeEach(() => {
    localStorage.clear();
    responses.length = 0;
    stubCanvasSize(1280, 754); // jsdom 兜底只有 200×200：给个真实画布尺寸，世界坐标才落在画布内
  });

  it('非门输出随按压 1→0、自动弹回 0→1，锁存器全程正确', { timeout: 40_000 }, async () => {
    enterBtnLatch();
    await waitFor(() => expect(screen.getByText('调试模式')).toBeTruthy(), { timeout: 4000 });
    fireEvent.click(screen.getByText('一键出答案')); // ?debug=1：进入即已开
    await new Promise((r) => setTimeout(r, 300));
    const modal = screen.queryByText('逻辑门版（简洁）');
    if (modal) fireEvent.click(modal);
    // 等一键出答案的仿真跑完（至少一次 simulate 响应）
    await waitFor(() => expect(responses.length).toBeGreaterThan(0), { timeout: 4000 });
    const before = responses[responses.length - 1];
    expect(logicOf(before.resp, notNet!.id), '松开按钮：非门输出 = 逻辑 1').toBe(1);

    // 点按钮（按住）：必须发出 btn=1 的新仿真，且非门输出翻到强 0
    clickWorld(btnSym.x, btnSym.y);
    await waitFor(
      () => expect(responses.some((x) => 'inputs' in x.req && x.req.inputs.btn === 1)).toBe(true),
      {
        timeout: 4000,
      },
    );
    const press = responses.find((x) => 'inputs' in x.req && x.req.inputs.btn === 1);
    expect(press).toBeDefined();
    expect(logicOf(press?.resp, notNet!.id), '按住按钮：非门输出 = 逻辑 0').toBe(0);

    // 松开按钮 → 归 0：非门输出回到弱 1
    releaseWorld();
    await waitFor(
      () => expect(responses.some((x) => 'inputs' in x.req && x.req.inputs.btn === 0)).toBe(true),
      {
        timeout: 4000,
      },
    );
    const release = responses.find((x) => 'inputs' in x.req && x.req.inputs.btn === 0);
    expect(release).toBeDefined();
    expect(logicOf(release?.resp, notNet!.id), '松开：回到逻辑 1').toBe(1);
  });
});
