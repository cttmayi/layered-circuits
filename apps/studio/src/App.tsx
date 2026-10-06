import type { JudgeResult } from '@lc/compiler';
import {
  ALL_LEVELS,
  elementEdgeOf,
  findLevel,
  findTeachLevel,
  isTeachLevel,
  teachingModulesFor,
  teachingSolutionOf,
} from '@lc/content';
import {
  type Design,
  familySpecOf,
  type LogicFamily,
  levelViewOf,
  type ModuleTemplate,
} from '@lc/schema';
import type { Waveform } from '@lc/sim-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notGateDemo } from './editor/demos';
import {
  INITIAL_TOUCH,
  isDoubleTap,
  LONG_PRESS_MS,
  type Point,
  type PressTarget,
  pairOf,
  pinchCamera,
  pointerKindOf,
  reduceTouch,
  type TapRecord,
  type TouchEffect,
  type TouchEvent,
  type TouchState,
} from './editor/gesture';
import {
  createDeviceSym,
  createSym,
  type Doc,
  findSym,
  fromDesign,
  type InputDrive,
  inputValues,
  moduleBox,
  type PlaceKind,
  pinNames,
  pinOffsets,
  type StoredModule,
  type Sym,
  samePin,
  toDesign,
  UNIT_LABEL,
  type UnitKind,
} from './editor/model';
import {
  type Camera,
  drawScene,
  type HoverTarget,
  hitTest,
  type Scene,
  screenToWorld,
  signalText,
} from './editor/render';
import { addModule, dedupeLibrary, storeModule } from './level/library';
import {
  docForLevel,
  emptyProgress,
  exportSave,
  importSave,
  isCleared,
  isNewJob,
  leaderboard,
  PROGRESS_KEY,
  type Progress,
  rankOf,
  recordAttempt,
  recordClear,
  saveProgress,
  setStarted,
  starsOf,
} from './level/progress';
import {
  docFor,
  FREE_STORAGE_KEY,
  freshDocFor,
  type GameMode,
  initialSession,
  levelOf,
  referencedModuleHashes,
  storageKeyFor,
} from './level/session';
import { ClassroomModal } from './panels/ClassroomModal';
import { FamilyPicker } from './panels/FamilyPicker';
import { Inspector } from './panels/Inspector';
import { JudgePanel } from './panels/JudgePanel';
import { LevelCard } from './panels/LevelCard';
import { LibraryPanel } from './panels/LibraryPanel';
import { MainMenu } from './panels/MainMenu';
import { Modal } from './panels/Modal';
import { ModuleDetailModal } from './panels/ModuleDetailModal';
import { Palette } from './panels/Palette';
import { SettlementPanel } from './panels/SettlementPanel';
import { TeachPanel } from './panels/TeachPanel';
import { WaveformPanel } from './panels/WaveformPanel';
import { WorldMap } from './panels/WorldMap';
import { probeModule } from './sim/probe';
import type { SimSnapshot, StudioResponse } from './sim/protocol';
import { createRunner } from './sim/runner';

interface DragState {
  mode: 'pan' | 'move' | 'none';
  originX: number;
  originY: number;
  cameraX: number;
  cameraY: number;
  moved: boolean;
  startSyms: Map<string, { x: number; y: number }>;
}

export function App(): React.JSX.Element {
  const runner = useMemo(() => createRunner(), []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** 上次仿真的节点信号 + 电路指纹（锁存器/寄存器状态跨仿真保持） */
  const prevSimRef = useRef<{
    key: string;
    signals: Record<string, number>;
    contribs: Record<string, number[]>;
    /** 全节点电平（含模块内部节点）：恢复用的完整状态 */
    nodes: number[];
  } | null>(null);
  /** 「重新计算」触发计数：+1 强制全量重算（丢弃上次终态） */
  const [recomputeNonce, setRecomputeNonce] = useState(0);
  const dragRef = useRef<DragState>({
    mode: 'none',
    originX: 0,
    originY: 0,
    cameraX: 0,
    cameraY: 0,
    moved: false,
    startSyms: new Map(),
  });
  /** 当前按住的按钮端口（按住 = 1，onMouseUp 松开归 0） */
  const heldButtonRef = useRef<string | null>(null);

  // 会话（模式 / 当前关卡 / 存档）一次性装载
  const session = useMemo(() => initialSession(), []);
  const [doc, setDoc] = useState<Doc>(() => session.doc);
  // 模块库瘦身已在 initialSession 里做过（同名只留最新版本，但被画布引用到的模块一律保留；
  // 持久化 effect 会把瘦身结果写回 localStorage，存档自动变小）
  const [progress, setProgress] = useState<Progress>(() => session.progress);
  const [gameMode, setGameMode] = useState<GameMode>(() => session.mode);
  const [levelId, setLevelId] = useState<string>(() => session.levelId);
  /** 画面：主菜单 / 关卡地图 / 教学模式列表 / 工作台 —— 模式只在主菜单里选，进关后不能改 */
  const [screen, setScreen] = useState<'menu' | 'map' | 'teach' | 'bench'>('menu');
  const [pickingFamily, setPickingFamily] = useState(false);
  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null);
  /** 判定波形的画图参数（与「时序视图」的实时波形共用同一个面板组件） */
  const judgeWaveform = judgeResult?.waveform ?? null;
  const judgePortNames = judgeResult
    ? [
        ...Object.keys(judgeResult.rows[0]?.inputs ?? {}),
        ...new Set(judgeResult.rows.flatMap((r) => Object.keys(r.expected))),
      ]
    : [];
  const judgeMarks = judgeResult
    ? judgeResult.rows.map((r) => ({ label: `#${r.index + 1}`, atPs: r.window.fromPs }))
    : [];
  const [judging, setJudging] = useState(false);
  const [undoStack, setUndoStack] = useState<Doc[]>([]);
  const [redoStack, setRedoStack] = useState<Doc[]>([]);
  const [camera, setCamera] = useState<Camera>({ x: 340, y: 220, scale: 1 });
  const [selection, setSelection] = useState<string[]>([]);
  const [selectedWires, setSelectedWires] = useState<string[]>([]);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [placing, setPlacing] = useState<PlaceKind | null>(null);
  const [pendingPin, setPendingPin] = useState<{ inst: string; pin: string; bit?: number } | null>(
    null,
  );
  const [pendingPoint, setPendingPoint] = useState<{ x: number; y: number } | null>(null);

  // 换关时关掉上一单的结算页与过场（依赖 levelId 就是为了「换单即清屏」）
  useEffect(() => {
    void levelId;
    setSettlement(null);
    setChipDrop(null);
    setLiveWave(null);
  }, [levelId]);

  /** 左右侧面板整体收起/展开（体验：布线时把侧栏收起来腾画布），选择记忆在 localStorage */
  const [leftOpen, setLeftOpen] = usePersistentBool('lc-ui-left-open', true);
  const [rightOpen, setRightOpen] = usePersistentBool('lc-ui-right-open', true);
  /** 调试开关是否可见：只有 URL 带 ?debug=1 才显示「调试模式」按钮 —— 正式玩法里
   *  连这个按钮都不该出现（存档里残留 lc-ui-debug=true 也不行）。挂载时判一次即可。 */
  const [debugFlag] = useState(
    () => new URLSearchParams(window.location.search).get('debug') === '1',
  );
  /** 调试模式：解锁「一键出答案」等开发辅助（不参与正式玩法） */
  const [debugMode, setDebugMode] = usePersistentBool('lc-ui-debug', false);
  /** 一键出答案的版本选择（仅当元件版有造价/延迟优势时才弹；单一版本直接执行） */
  const [answerCandidates, setAnswerCandidates] = useState<
    { kind: 'element' | 'gate'; note?: string }[] | null
  >(null);
  // URL 带 ?debug=1：进入即强制开调试模式并记住（重启/刷新后保持），普通玩法不受影响
  useEffect(() => {
    if (debugFlag) setDebugMode(true);
  }, [debugFlag, setDebugMode]);
  /** 低频面板弹窗：组件库 / 波形（点击启动，不用时不留侧栏） */
  const [panelOpen, setPanelOpen] = useState<null | 'library' | 'wave'>(null);
  /** 「时序视图」：在画布上画出真实波形（竞争/毛刺/传播延迟）。
   *  仿真本身**恒按真实时序跑**（判定也是）—— 这个开关只决定画不画波形，绝不改判定结果。
   *  默认打开；玩家的选择跨关卡保留。 */
  // 「时序视图」按钮已按用户要求移除：默认值保持 true（与移除前的默认行为一致，
  // 时序版关卡照旧在画布上画真实波形），只是不再提供开关。
  const timingView = true;
  /** 最近一次仿真的端口级波形（时序视图用）；逻辑模式没有时间轴，恒为 null */
  const [liveWave, setLiveWave] = useState<Waveform | null>(null);
  /** 这次仿真与判定用的口径。**时序版**（默认）：按真实元件延迟跑，主线的硬核口径；
   *  **逻辑版**：抹平延迟、只看逻辑对不对 —— 判定器把 timingBudgetPs 置空，
   *  于是评星只按成本（延迟档视为达标），毛刺与建立/保持也都不查。
   *  画布与判定共用同一口径，切换后立刻重新仿真；选择持久化、跨关卡保留。 */
  const [logicMode, setLogicMode] = usePersistentBool('lc.logicMode', false);
  // 本关自带的判定口径：1~7 关 = timing（走真实时序），第 8 关起 = logic（只判逻辑）。
  // 自由/教学模式没有关卡口径，仍听工具栏那个总开关。
  const levelJudgeMode = levelOf(gameMode, levelId)?.judgeMode;
  const simMode: 'logic' | 'timing' = levelJudgeMode ?? (logicMode ? 'logic' : 'timing');
  const [snapshot, setSnapshot] = useState<SimSnapshot | null>(null);
  const [resultDoc, setResultDoc] = useState<Doc | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** 结算页：交付并封装之后出现（客户验收报告 + 钱 + 评级） */
  const [settlement, setSettlement] = useState<JudgeResult | null>(null);
  /** 本次交付的星数（结算页展示） */
  const [settlementStars, setSettlementStars] = useState(0);
  /** 教学关「元件课堂」概念卡：进教学关先讲课（有 classroom 的关才弹） */
  const [classroomOpen, setClassroomOpen] = useState(false);
  /** 中央提示对话框（图纸解开等小节点） */
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  /** 黑盒侦察对话框（开工后若图纸未测则直接进入） */
  /** 当前接的支线单（同一时刻最多一条，验收按支线条件判） */
  /** 封装过场：电路被压成一颗芯片落进组件库 */
  const [chipDrop, setChipDrop] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  /** 双击模块展开的模块详情（null = 弹窗关闭） */
  const [expandedModule, setExpandedModule] = useState<StoredModule | null>(null);

  // ---- 画布尺寸自适应（含 HiDPI）：主菜单→工作台时容器才出现，所以要跟 screen 重新量 ----
  useEffect(() => {
    void screen; // 进工作台（screen 变化）时重测容器尺寸
    const el = containerRef.current;
    if (!el) return;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      setSize({ width: Math.max(200, rect.width), height: Math.max(200, rect.height) });
    };
    measure();
    // ResizeObserver 在老浏览器/测试环境（jsdom）里可能不存在，退回窗口 resize 事件
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [screen]);

  // ---- 自动仿真（Worker 优先，防抖 40ms） ----
  // currentLevel/gameMode 声明在本 effect 之后（TDZ，不能进 deps 数组）；关卡/教学模式切换
  // 必然产生新 doc，由 doc 依赖覆盖重跑。
  useEffect(() => {
    // recomputeNonce 只作「重新计算」按钮的触发信号：值本身不参与计算，仅靠它在依赖
    // 列表里变化来重跑仿真（读一下避免被判定为多余依赖——删除它会让按钮失效）。
    void recomputeNonce;
    const timer = setTimeout(() => {
      const design = toDesign(doc);
      // 电路指纹：只在拓扑/布线没变时复用上次信号（锁存器/寄存器状态跨仿真保持）；
      // 拓扑一变就回到上电默认，避免用旧网的信号污染新电路。
      const designKey = JSON.stringify(design);
      const prev = prevSimRef.current;
      // 恒定复用上次终态：真实时序看法下必须复用才能跨点击保持锁存器/寄存器状态
      // （不再有"稳定值看法"那条不satisfy复用的分支）。
      const prevSignals = prev && prev.key === designKey ? prev.signals : undefined;
      const prevContribs = prev && prev.key === designKey ? prev.contribs : undefined;
      // 全节点状态（含模块内部节点）：只恢复顶层网会让模块内部停在「上电态」，
      // 内部节点贡献不变、事件不再往下传，输出冻住（两级串联模块在 seq 关卡里点不动）
      const prevNodeSignals = prev && prev.key === designKey ? prev.nodes : undefined;
      runner
        .send({
          type: 'simulate',
          design,
          library: doc.library.map((m) => m.template),
          mode: simMode,
          inputs: inputValues(doc),
          // 瞬时按钮端口：仿真先按 0 稳定、再置 1（上升沿锁存正确值）
          buttonPorts: doc.syms.filter((s) => s.kind === 'input' && s.button).map((s) => s.label),
          prevSignals,
          prevContribs,
          prevNodeSignals,
          withTiming: false, // 「时序分析」开关已移除
          withWaveform: simMode === 'timing',
        })
        .then((response: StudioResponse) => {
          if (response.error) {
            setToast(`仿真出错：${response.error}`);
            return;
          }
          if (response.snapshot) {
            setSnapshot(response.snapshot);
            setLiveWave(response.snapshot.waveform ?? null);
            setResultDoc(doc);
            // 记住这次的信号与电路指纹，供下一次仿真续用（信号与贡献出自同一终态，
            // 恢复时必须一起还原，否则元素求值读到上电旧贡献会把状态电路毒化）
            prevSimRef.current = {
              key: designKey,
              signals: Object.fromEntries(response.snapshot.netSignals),
              contribs: Object.fromEntries(response.snapshot.contrib),
              nodes: response.snapshot.nodeSignals,
            };
          }
        })
        .catch((error: unknown) => setToast(`仿真失败：${String(error)}`));
    }, 40);
    return () => clearTimeout(timer);
  }, [doc, simMode, runner, recomputeNonce]);

  // ---- 本地自动存档（按模式 + 关卡分开存） ----
  const storageKey = storageKeyFor(gameMode, levelId);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        // 画布存档不背组件库：模块是全局进度（progress.library）的一部分，
        // 读档时 docFor 会重新注入。一个非门关卡带着 16 个无关模块的模板
        // 序列化，既占 localStorage 又让导出数据又大又乱。
        const { library: _library, ...canvas } = doc;
        localStorage.setItem(storageKey, JSON.stringify(canvas));
      } catch {
        /* 存档失败无所谓 */
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [doc, storageKey]);

  // ---- 关卡进度与组件库持久化 ----
  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  // ---- 引脚电平映射：netId → signal，再展开到 pinKey ----
  const pinSignals = useMemo(() => {
    const map = new Map<string, number>();
    if (!snapshot || !resultDoc) return map;
    const byNet = new Map(snapshot.netSignals);
    for (const net of toDesign(resultDoc).nets) {
      const signal = byNet.get(net.id);
      if (signal === undefined) continue;
      for (const pin of net.pins) map.set(`${pin.inst}.${pin.pin}[${pin.bit ?? 0}]`, signal);
    }
    return map;
  }, [snapshot, resultDoc]);

  const buildScene = (): Scene => ({
    doc,
    camera,
    width: size.width,
    height: size.height,
    pinSignals,
    selection,
    selectedWires,
    hover,
    pendingPin,
    pendingPoint,
    grid: true,
  });

  // 事件处理里要用最新的场景做命中测试，但不希望它成为 effect 依赖
  const sceneRef = useRef<Scene | null>(null);
  sceneRef.current = buildScene();
  const currentScene = (): Scene => sceneRef.current as Scene;

  // ---- 重绘：任何影响画面的状态变化都会重画（电平变化 → 颜色跟着变） ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, {
      doc,
      camera,
      width: size.width,
      height: size.height,
      pinSignals,
      selection,
      selectedWires,
      hover,
      pendingPin,
      pendingPoint,
      grid: true,
    });
  }, [doc, camera, size, pinSignals, selection, selectedWires, hover, pendingPin, pendingPoint]);

  // ---- 文档变更辅助 ----
  const commit = (next: Doc, options: { history?: boolean } = {}): void => {
    if (options.history !== false) {
      setUndoStack((stack) => [...stack.slice(-49), doc]);
      setRedoStack([]);
    }
    setDoc(next);
  };

  const undo = (): void => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1] as Doc;
      setRedoStack((redo) => [...redo, doc]);
      setDoc(prev);
      return stack.slice(0, -1);
    });
  };

  const redo = (): void => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1] as Doc;
      setUndoStack((undoStackPrev) => [...undoStackPrev, doc]);
      setDoc(next);
      return stack.slice(0, -1);
    });
  };

  const deleteSelection = (): void => {
    if (selection.length === 0 && selectedWires.length === 0) return;
    const ids = new Set(selection);
    const lockedHit = doc.syms.some((s) => ids.has(s.id) && s.locked);
    if (lockedHit) setToast('关卡规定的端口元件不能删除（它们是本关的接口约定）');
    const next: Doc = {
      ...doc,
      syms: doc.syms.filter((s) => !(ids.has(s.id) && !s.locked)),
      wires: doc.wires.filter(
        (w) =>
          !selectedWires.includes(w.id) &&
          (!ids.has(w.a.inst) || doc.syms.find((s) => s.id === w.a.inst)?.locked) &&
          (!ids.has(w.b.inst) || doc.syms.find((s) => s.id === w.b.inst)?.locked),
      ),
    };
    commit(next);
    setSelection([]);
    setSelectedWires([]);
  };

  const rotateSelection = (): void => {
    if (selection.length === 0) return;
    const ids = new Set(selection);
    commit({
      ...doc,
      syms: doc.syms.map((s) =>
        ids.has(s.id) ? { ...s, rot: ((s.rot + 1) % 4) as 0 | 1 | 2 | 3 } : s,
      ),
    });
  };

  // ---- 键盘快捷键 ----
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (event.key === 'Escape') {
        setPlacing(null);
        setPendingPin(null);
        setPendingPoint(null);
        setSelection([]);
        setSelectedWires([]);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
      } else if (event.key === 'r' || event.key === 'R') {
        rotateSelection();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- 画布交互：鼠标 + 触屏 ----
  const worldOf = (sx: number, sy: number): { x: number; y: number } =>
    screenToWorld(camera, size.width, size.height, sx, sy);

  const localPoint = (event: {
    clientX: number;
    clientY: number;
    currentTarget: Element;
  }): { sx: number; sy: number; wx: number; wy: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const w = worldOf(sx, sy);
    return { sx, sy, wx: w.x, wy: w.y };
  };

  /** 在画布 (wx, wy) 放置一个元件/模块/端口（点击与拖拽共用） */
  const placeAt = (kind: PlaceKind, wx: number, wy: number): void => {
    const next = { ...doc, syms: [...doc.syms] };
    const created =
      kind.kind === 'unit'
        ? createSym(doc, 'unit', kind.unit, snap(wx), snap(wy))
        : kind.kind === 'module'
          ? createSym(doc, 'module', undefined, snap(wx), snap(wy), kind.hash)
          : kind.kind === 'button' || kind.kind === 'segment'
            ? createDeviceSym(doc, kind.kind, snap(wx), snap(wy))
            : createSym(doc, kind.kind, undefined, snap(wx), snap(wy));
    next.syms.push(created);
    commit(next);
    setSelection([created.id]);
  };

  /** 双击语义：删除连线 / 展开模块（鼠标 dblclick、触屏双击、触屏长按松手共用同一套） */
  const applyDoubleClick = (wx: number, wy: number): void => {
    if (placing) return;
    const target = hitTest(currentScene(), wx, wy);
    if (target?.kind === 'sym') {
      const sym = findSym(doc, target.id);
      if (sym?.kind === 'module' && sym.module) {
        const stored = doc.library.find((m) => m.hash === sym.module);
        if (stored) setExpandedModule(stored);
      }
      return;
    }
    if (target?.kind === 'wire') {
      commit({ ...doc, wires: doc.wires.filter((w) => w.id !== target.id) });
      setSelectedWires([]);
      setSelection([]);
    }
  };

  const onDoubleClick = (event: React.MouseEvent): void => {
    const { wx, wy } = localPoint(event);
    applyDoubleClick(wx, wy);
  };

  /** 从元件库拖拽到画布放置 */
  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault();
    const raw = event.dataTransfer.getData('application/x-lc-place');
    if (!raw) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // 真实浏览器 DropEvent 必带坐标；测试环境缺省时兜底到画布中心
    const sx = (event.clientX ?? rect.left + rect.width / 2) - rect.left;
    const sy = (event.clientY ?? rect.top + rect.height / 2) - rect.top;
    const w = screenToWorld(camera, size.width, size.height, sx, sy);
    const [tag, extra] = raw.split(':');
    if (tag === 'unit' && extra) placeAt({ kind: 'unit', unit: extra as UnitKind }, w.x, w.y);
    else if (tag === 'module' && extra) placeAt({ kind: 'module', hash: extra }, w.x, w.y);
    else if (
      tag === 'vcc' ||
      tag === 'gnd' ||
      tag === 'input' ||
      tag === 'output' ||
      tag === 'button' ||
      tag === 'segment'
    )
      placeAt({ kind: tag }, w.x, w.y);
  };

  /**
   * 「按下 / 轻点」共用的命中处理：鼠标按下与触屏轻点走同一套语义，避免两条路各写一遍后漂移。
   * 返回 true = 这一下已被消费（调用方不要再进入平移）；false = 点在空白处。
   * - beginDrag：鼠标按下即可拖元件；触屏轻点不拖（拖元件交给「长按后拖动」手势）
   * - togglePort：点输入端口切 0/1；长按拖元件时关掉，免得手指一放值就跳
   */
  const applyPressHit = (
    p: { sx: number; sy: number; wx: number; wy: number },
    opts: { beginDrag: boolean; altKey: boolean; shiftKey: boolean; togglePort: boolean },
  ): boolean => {
    const target = hitTest(currentScene(), p.wx, p.wy);

    if (placing) {
      placeAt(placing, p.wx, p.wy);
      setPlacing(null);
      return true;
    }

    if (target?.kind === 'pin') {
      const sym = findSym(doc, target.id);
      if (!sym) return true;
      if (!pendingPin) {
        setPendingPin({ inst: target.id, pin: target.pin as string, bit: target.bit ?? 0 });
        setPendingPoint({ x: p.wx, y: p.wy });
      } else {
        const from = pendingPin;
        const samePinClicked =
          from.inst === target.id &&
          from.pin === target.pin &&
          (from.bit ?? 0) === (target.bit ?? 0);
        if (!samePinClicked) {
          addWire(from, { inst: target.id, pin: target.pin as string, bit: target.bit ?? 0 });
        }
        setPendingPin(null);
        setPendingPoint(null);
      }
      return true;
    }

    if (target?.kind === 'sym') {
      const sym = findSym(doc, target.id);
      if (sym?.kind === 'input' && opts.togglePort) {
        if (opts.altKey) stepInput(sym.id, -1);
        else toggleInput(sym.id);
      }
      if (!opts.shiftKey && !selection.includes(target.id)) setSelection([target.id]);
      else if (opts.shiftKey)
        setSelection((prev) =>
          prev.includes(target.id) ? prev.filter((id) => id !== target.id) : [...prev, target.id],
        );
      setSelectedWires([]);
      if (!opts.beginDrag) return true;
      const startSyms = new Map<string, { x: number; y: number }>();
      const ids = opts.shiftKey
        ? [...selection, target.id]
        : selection.includes(target.id)
          ? selection
          : [target.id];
      for (const id of ids) {
        const s = findSym(doc, id);
        if (s) startSyms.set(id, { x: s.x, y: s.y });
      }
      dragRef.current = {
        mode: 'move',
        originX: p.sx,
        originY: p.sy,
        cameraX: camera.x,
        cameraY: camera.y,
        moved: false,
        startSyms,
      };
      return true;
    }

    if (target?.kind === 'wire') {
      setSelectedWires([target.id]);
      setSelection([]);
      return true;
    }

    return false;
  };

  /** 平移：鼠标拖动、触屏单指拖动、双指一起拖都走这里（相机算法只有这一份） */
  const applyPan = (sx: number, sy: number): void => {
    const drag = dragRef.current;
    if (Math.abs(sx - drag.originX) + Math.abs(sy - drag.originY) > 3) drag.moved = true;
    setCamera((prev) => ({
      ...prev,
      x: drag.cameraX - (sx - drag.originX) / prev.scale,
      y: drag.cameraY - (sy - drag.originY) / prev.scale,
    }));
  };

  /** 拖动选中元件：鼠标按下即拖、触屏长按后拖（算法只有这一份） */
  const applySymMove = (sx: number, sy: number): void => {
    const drag = dragRef.current;
    drag.moved = true;
    const dx = (sx - drag.originX) / camera.scale;
    const dy = (sy - drag.originY) / camera.scale;
    setDoc((prev) => ({
      ...prev,
      syms: prev.syms.map((s) => {
        const start = drag.startSyms.get(s.id);
        return start ? { ...s, x: snap(start.x + dx), y: snap(start.y + dy) } : s;
      }),
    }));
  };

  /** 拖动收尾：把「拖动前」的状态压入撤销栈（鼠标松手 / 触屏抬手 / 手势被打断共用） */
  const finishSymMove = (): void => {
    const drag = dragRef.current;
    if (drag.mode === 'move' && drag.moved) {
      setUndoStack((stack) => [
        ...stack.slice(-49),
        {
          ...doc,
          syms: doc.syms.map((s) => {
            const start = drag.startSyms.get(s.id);
            return start ? { ...s, x: start.x, y: start.y } : s;
          }),
        },
      ]);
      setRedoStack([]);
    }
    dragRef.current = { ...drag, mode: 'none', moved: false, startSyms: new Map() };
  };

  /** 瞬时按钮端口松手归 0（鼠标松手 / 触屏手指抬起共用） */
  const releaseHeldButton = (): void => {
    const held = heldButtonRef.current;
    if (!held) return;
    heldButtonRef.current = null;
    setDoc((prev) => ({
      ...prev,
      syms: prev.syms.map((s) => (s.id === held ? { ...s, value: 0 as InputDrive } : s)),
    }));
  };

  /** 点在空白处：清掉选中与半截连线（鼠标按下空白处、触屏轻点空白处共用） */
  const clearPressSelection = (): void => {
    setSelection([]);
    setSelectedWires([]);
    setPendingPin(null);
  };

  const onMouseDown = (event: React.MouseEvent): void => {
    const p = localPoint(event);
    // 鼠标：按下即拖元件（与触屏改造前逐字一致）
    if (
      applyPressHit(p, {
        beginDrag: true,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        togglePort: true,
      })
    )
      return;

    clearPressSelection();
    dragRef.current = {
      mode: 'pan',
      originX: p.sx,
      originY: p.sy,
      cameraX: camera.x,
      cameraY: camera.y,
      moved: false,
      startSyms: new Map(),
    };
  };

  const onMouseMove = (event: React.MouseEvent): void => {
    const { sx, sy, wx, wy } = localPoint(event);
    const drag = dragRef.current;
    if (drag.mode === 'pan') {
      applyPan(sx, sy);
      return;
    }
    if (drag.mode === 'move') {
      applySymMove(sx, sy);
      return;
    }
    setHover(hitTest(currentScene(), wx, wy));
    if (pendingPin) setPendingPoint({ x: wx, y: wy });
  };

  const onMouseUp = (): void => {
    // 松开按住的按钮 → 归 0（按住 = 1、松开 = 0）
    releaseHeldButton();
    finishSymMove();
  };

  const onWheel = (event: React.WheelEvent): void => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const before = screenToWorld(camera, size.width, size.height, sx, sy);
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    const scale = Math.min(2.6, Math.max(0.35, camera.scale * factor));
    const after = screenToWorld({ ...camera, scale }, size.width, size.height, sx, sy);
    setCamera({ x: camera.x + (before.x - after.x), y: camera.y + (before.y - after.y), scale });
  };

  // ---- 触屏手势：pointerdown/move/up/cancel → 状态机（editor/gesture.ts）→ 动作 ----
  // 鼠标不经过这里（pointerdown 里 pointerType === 'mouse' 直接返回），老路径一行不动。
  /** 手势状态（纯状态机持有一份，App 只负责执行效果） */
  const touchRef = useRef<TouchState>(INITIAL_TOUCH);
  /** 当前按着的手指：指针 id → 画布内坐标（双指缩放要两根一起看） */
  const pointersRef = useRef(new Map<number, Point>());
  /** 长按计时器（按住不动 420ms → 长按就绪） */
  const longPressTimerRef = useRef<number | null>(null);
  /** 上一次轻点（触屏双击判定用；鼠标走原生 dblclick） */
  const lastTapRef = useRef<TapRecord | null>(null);
  /** 长按就绪：底部提示换成「拖动＝移动元件 / 松手＝双击」，给手指一点反馈 */
  const [longPressReady, setLongPressReady] = useState(false);

  const clearLongPressTimer = (): void => {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  /** 指针事件 → 画布内屏幕坐标（与鼠标路径同源：都用画布 rect） */
  const pointerScreen = (event: { clientX: number; clientY: number }): Point => {
    const canvas = canvasRef.current;
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const pressTargetOf = (hit: HoverTarget | null): PressTarget => {
    if (!hit) return 'none';
    return hit.kind === 'pin' ? 'pin' : hit.kind === 'sym' ? 'sym' : 'wire';
  };

  /** 长按就绪后拖动命中的元件：选中并开始拖（不切输入端口的 0/1，免得一拖值就跳） */
  const beginTouchSymDrag = (point: Point): void => {
    const w = worldOf(point.x, point.y);
    applyPressHit(
      { sx: point.x, sy: point.y, wx: w.x, wy: w.y },
      { beginDrag: true, altKey: false, shiftKey: false, togglePort: false },
    );
  };

  /** 触屏轻点 → 单击语义；两次轻点在同一点 → 双击语义（删除连线 / 展开模块） */
  const handleTouchTap = (point: Point): void => {
    const w = worldOf(point.x, point.y);
    const target = hitTest(currentScene(), w.x, w.y);
    const now = Date.now();
    const onSymOrWire = target?.kind === 'sym' || target?.kind === 'wire';
    if (onSymOrWire && isDoubleTap(lastTapRef.current, { time: now, x: point.x, y: point.y })) {
      lastTapRef.current = null; // 双击用完即弃，免得三连击又触发一次
      applyDoubleClick(w.x, w.y);
      return;
    }
    lastTapRef.current = { time: now, x: point.x, y: point.y };
    // 瞬时按钮端口：按下已置 1、抬手已归 0（真的"按了一下"），这里不再重复触发
    const sym = target?.kind === 'sym' ? findSym(doc, target.id) : null;
    if (sym?.kind === 'input' && sym.button) return;
    const consumed = applyPressHit(
      { sx: point.x, sy: point.y, wx: w.x, wy: w.y },
      { beginDrag: false, altKey: false, shiftKey: false, togglePort: true },
    );
    // 轻点空白处 = 清选中（与鼠标按下空白处一致）；拖动平移不改选中（触屏上平移纯属导航）
    if (!consumed) clearPressSelection();
  };

  const applyTouchEffects = (effects: TouchEffect[]): void => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'delegate-mouse':
          break; // 鼠标：交给原生鼠标事件，什么都不做
        case 'arm-longpress':
          longPressTimerRef.current = window.setTimeout(() => {
            dispatchTouch({ type: 'longpress' });
          }, LONG_PRESS_MS);
          break;
        case 'longpress-ready':
          setLongPressReady(true);
          break;
        case 'cancel-longpress':
          break; // 计时器已在 dispatchTouch 入口清掉
        case 'begin-pan':
          dragRef.current = {
            mode: 'pan',
            originX: effect.point.x,
            originY: effect.point.y,
            cameraX: camera.x,
            cameraY: camera.y,
            moved: false,
            startSyms: new Map(),
          };
          break;
        case 'pan':
          applyPan(effect.point.x, effect.point.y);
          break;
        case 'begin-move':
          // 用按下点起算：长按期间手指没怎么动，命中对象与按下时一致
          beginTouchSymDrag(touchRef.current.origin);
          break;
        case 'move-sym':
          applySymMove(effect.point.x, effect.point.y);
          break;
        case 'end-move':
          finishSymMove();
          break;
        case 'tap':
          handleTouchTap(effect.point);
          break;
        case 'double-click': {
          const w = worldOf(effect.point.x, effect.point.y);
          applyDoubleClick(w.x, w.y);
          break;
        }
        case 'pinch':
          // 函数式更新：手指快速划动时多次 move 能连续叠加，不会丢帧跳变
          setCamera((prev) =>
            pinchCamera(
              prev,
              size.width,
              size.height,
              { a: effect.fromA, b: effect.fromB },
              { a: effect.toA, b: effect.toB },
            ),
          );
          break;
      }
    }
  };

  /** 事件 → 状态机 → 效果。非长按事件先撤掉长按计时（手指一动/一抬就不再算长按） */
  const dispatchTouch = (event: TouchEvent): void => {
    if (event.type !== 'longpress') {
      clearLongPressTimer();
      setLongPressReady(false);
    }
    const { state, effects } = reduceTouch(touchRef.current, event);
    touchRef.current = state;
    applyTouchEffects(effects);
  };

  const capturePointer = (pointerId: number, on: boolean): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fn = on ? canvas.setPointerCapture : canvas.releasePointerCapture;
    if (typeof fn !== 'function') return; // 测试环境（jsdom）没有指针捕获
    try {
      fn.call(canvas, pointerId);
    } catch {
      /* 指针已经抬起，忽略 */
    }
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const kind = pointerKindOf(event.pointerType);
    if (kind === 'mouse') return; // 鼠标继续走 onMouseDown/Move/Up，行为与改造前逐字一致

    const point = pointerScreen(event);
    // 把指针钉在画布上：手指滑出画布也能继续收到 move/up
    capturePointer(event.pointerId, true);
    pointersRef.current.set(event.pointerId, point);
    const w = worldOf(point.x, point.y);

    // 放置模式：按下即放置（与鼠标一致），这一下不算手势
    if (placing) {
      placeAt(placing, w.x, w.y);
      setPlacing(null);
      pointersRef.current.delete(event.pointerId);
      return;
    }

    const hit = hitTest(currentScene(), w.x, w.y);
    // 瞬时按钮端口：按住 = 1、抬手 = 0（触屏也要真按一会儿，仿真才吃得到上升沿）
    if (hit?.kind === 'sym') {
      const sym = findSym(doc, hit.id);
      if (sym?.kind === 'input' && sym.button) {
        heldButtonRef.current = sym.id;
        setDoc((prev) => ({
          ...prev,
          syms: prev.syms.map((s) => (s.id === sym.id ? { ...s, value: 1 as InputDrive } : s)),
        }));
      }
    }

    dispatchTouch({
      type: 'down',
      kind,
      point,
      target: pressTargetOf(hit),
      pair: pairOf(pointersRef.current),
    });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (pointerKindOf(event.pointerType) === 'mouse') return;
    if (!pointersRef.current.has(event.pointerId)) return; // 没按着（触控笔悬停等）不动画布
    const point = pointerScreen(event);
    pointersRef.current.set(event.pointerId, point);
    dispatchTouch({ type: 'move', point, pair: pairOf(pointersRef.current) });
  };

  const firstPointerPoint = (): Point | null => {
    for (const point of pointersRef.current.values()) return point;
    return null;
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (pointerKindOf(event.pointerType) === 'mouse') return;
    if (!pointersRef.current.has(event.pointerId)) return;
    const point = pointerScreen(event);
    pointersRef.current.delete(event.pointerId);
    // 瞬时按钮端口：手指全抬起来才归 0（另一根手指还按着按钮时不能提前松手）
    if (pointersRef.current.size === 0) releaseHeldButton();
    dispatchTouch({
      type: 'up',
      point,
      remaining: firstPointerPoint(),
      pair: pairOf(pointersRef.current),
    });
    capturePointer(event.pointerId, false);
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (pointerKindOf(event.pointerType) === 'mouse') return;
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.clear(); // 系统抢走指针（来电/切后台）：这一轮手势整体作废
    releaseHeldButton();
    dispatchTouch({ type: 'cancel' });
    capturePointer(event.pointerId, false);
  };

  // ---- 编辑动作 ----
  /** 端口位宽（端口符号 / 模块端口，用于总线接线） */
  const pinWidth = (inst: string, pin: string): number => {
    const sym = findSym(doc, inst);
    if (!sym) return 1;
    if (sym.kind === 'input' || sym.kind === 'output') return sym.width ?? 1;
    if (sym.kind === 'module') {
      const stored = doc.library.find((m) => m.hash === sym.module);
      return stored?.ports.find((p) => p.name === pin)?.width ?? 1;
    }
    return 1;
  };

  const addWire = (
    a: { inst: string; pin: string; bit?: number },
    b: { inst: string; pin: string; bit?: number },
  ): void => {
    const widthA = pinWidth(a.inst, a.pin);
    const widthB = pinWidth(b.inst, b.pin);
    // 总线对总线（同宽 >1）：lane 对齐一次连整根（第三章）；其余按单 lane
    const pairs =
      widthA > 1 && widthA === widthB
        ? Array.from({ length: widthA }, (_, bit) => ({
            a: { inst: a.inst, pin: a.pin, bit },
            b: { inst: b.inst, pin: b.pin, bit },
          }))
        : [
            {
              a: { inst: a.inst, pin: a.pin, bit: a.bit ?? 0 },
              b: { inst: b.inst, pin: b.pin, bit: b.bit ?? 0 },
            },
          ];
    const news = pairs.filter(({ a: pa, b: pb }) => {
      const refA = { inst: pa.inst, pin: pa.pin, bit: pa.bit };
      const refB = { inst: pb.inst, pin: pb.pin, bit: pb.bit };
      return !doc.wires.some(
        (w) =>
          (samePin(w.a, refA) && samePin(w.b, refB)) || (samePin(w.a, refB) && samePin(w.b, refA)),
      );
    });
    if (news.length === 0) return;
    const base = doc.wires.length;
    const wires = news.map((n, i) => ({
      id: `w${base + i + 1}-${n.a.inst}.${n.a.pin}[${n.a.bit}]-${n.b.inst}.${n.b.pin}[${n.b.bit}]`,
      a: { inst: n.a.inst, pin: n.a.pin, bit: n.a.bit },
      b: { inst: n.b.inst, pin: n.b.pin, bit: n.b.bit },
    }));
    commit({ ...doc, wires: [...doc.wires, ...wires] });
  };

  const toggleInput = (id: string): void => {
    const sym = doc.syms.find((s) => s.id === id);
    if (sym?.button) {
      // 瞬时按键（按钮端口）：按住 = 1，松开（onMouseUp）归 0——真实计算器手感，
      // 不是点击后 400ms 自动弹回。用函数式更新，避免闭包捕获旧 doc 覆盖其它操作。
      heldButtonRef.current = id;
      setDoc((prev) => ({
        ...prev,
        syms: prev.syms.map((s) => (s.id === id ? { ...s, value: 1 as InputDrive } : s)),
      }));
      return;
    }
    // 普通输入端口：点击 = 驱动值 +1（1 bit 下等价 0↔1 切换；多 bit 走 0,1,2,…2^width-1）
    stepInput(id, 1);
  };

  /** 输入端口驱动值步进：click/+1、Alt/-1（按位宽取模环绕） */
  const stepInput = (id: string, delta: number): void => {
    const sym = doc.syms.find((s) => s.id === id);
    if (!sym) return;
    const width = sym.width ?? 1;
    const max = width >= 31 ? 2 ** 31 : 1 << width;
    commit({
      ...doc,
      syms: doc.syms.map((s) =>
        s.id === id
          ? { ...s, value: (((((s.value ?? 0) + delta) % max) + max) % max) as InputDrive }
          : s,
      ),
    });
  };

  const wrapSelection = async (): Promise<void> => {
    if (doc.syms.length === 0) {
      setToast('电路是空的，先搭点东西');
      return;
    }
    const name = window.prompt('给这个模块起个名字：', '我的模块');
    if (!name) return;
    const design = toDesign(doc, { id: `wrap-${name}`, name });
    const response = await runner.send({
      type: 'wrap',
      design,
      library: doc.library.map((m) => m.template),
      name,
      stage: 1,
    });
    if (response.error || !response.wrapped) {
      setToast(`封装失败：${response.error ?? '未知错误'}`);
      return;
    }
    const info = response.wrapped;
    // 封装前先自测一遍：输出不随输入变，多半是接错了（上拉接到地、输入没接进去…）——
    // 这种模块放回画布后编译合法、界面上毫无异常，只有"结果不对"。不硬拦（常量输出是合法的），
    // 但让玩家明确知道自己在封什么。
    const probe = probeModule(info.template as ModuleTemplate, doc.library);
    if (probe.stuck.length > 0) {
      const sample = probe.rows[0]?.outputs[probe.stuck[0] as string] ?? '';
      const ok = window.confirm(
        `这个模块的输出不随输入变化：${probe.stuck.join('、')} 一直是 ${sample}。\n` +
          '它可能不是你想的那个功能（检查上拉是不是接到了地、输入有没有真的接到东西上）。\n\n还要封装吗？',
      );
      if (!ok) return;
    }
    const stored = storeModule(
      progress.library,
      {
        hash: info.hash,
        name: info.name,
        costHalf: info.costHalf,
        isSequential: info.isSequential,
        ports: info.ports,
        template: info.template,
        stage: currentLevel?.stage ?? 1,
        sources: design.instances
          .filter((inst) => inst.kind === 'module')
          .map((inst) => (inst.kind === 'module' ? inst.module : '')),
      },
      Date.now(),
    );
    commit({ ...doc, library: addModule(doc.library, stored) });
    // 组件库是全局资产：自由模式封装的模块，之后进关卡也能直接用
    setProgress((prev) => ({ ...prev, library: addModule(prev.library, stored) }));
    setToast(
      `已封装「${info.name}」：成本 ${info.costHalf / 2}（半单位 ${info.costHalf}），哈希 #${info.hash.slice(0, 8)}${info.isSequential ? '，判定为时序电路' : ''}`,
    );
  };

  const loadDoc = (next: Doc): void => {
    setUndoStack((stack) => [...stack.slice(-49), doc]);
    setRedoStack([]);
    setDoc(next);
    setSelection([]);
    setSelectedWires([]);
  };

  /** 调试模式：一键把本关参考解搭到画布上（可改、可直接验收）。
   *  优先逻辑门版；元件版只在它有造价/延迟优势时作为选项（弹窗二选一）；
   *  只有一种版本就直接搭，不弹对话框。 */
  const applyAnswer = (kind: 'element' | 'gate'): void => {
    if (!currentLevel) return;
    // 元件版 = 按玩家契约的参考解（每个契约自己的工艺答案；缺省 rtl = 关卡参考解）
    const spec = familySpecOf(currentLevel, progress.family);
    const ref = kind === 'gate' ? teachingSolutionOf(currentLevel.id, spec.family) : spec.reference;
    if (!ref) {
      setToast(kind === 'gate' ? '本关没有逻辑门版参考解' : '本关没有参考解，无法一键出答案');
      return;
    }
    // 参考解若引用了教学门积木（门版必引；模块化参考解如 s3-display2 的「2×七段译码器」
    // 也会引），并入画布库供渲染/判定编译用；这些积木标记 teaching，不出现在
    // 左侧「我的模块」（玩家没亲手搭，不算他的资产）。hash 内容稳定，重复注入无害。
    // 复合积木的身体还会引用更早的积木（传递闭包，如 显示控制→七段译码器→与非门），
    // 只注入直接引用会在展开时 unknown-module，因此只要参考解用到任何教学积木就注入整族。
    const refUsesModule = ref.instances.some((inst) => inst.kind === 'module');
    const extra = refUsesModule ? teachingStoredFor(spec.family) : [];
    const library = [...doc.library, ...extra];
    const next = fromDesign(ref, docForLevel(currentLevel, library));
    const nextDoc = { ...next, library };
    loadDoc(nextDoc);
    if (kind === 'gate') {
      // 元件版相对门版占优（更省/更快）时如实提示：门版是默认答案，元件版是更优解
      const edge = elementEdgeOf(currentLevel, spec.family);
      setToast(
        edge
          ? `逻辑门版已搭好（可直接验收）—— 元件版${edge === 'cost' ? '造价更低' : '延迟更短'}，需要可重新一键出答案选择`
          : '逻辑门版已搭好（造价不高于元件版，可直接验收）',
      );
    } else {
      setToast('参考解已搭好（调试模式）—— 可以直接交付验收');
    }
  };

  /** 重新计算：丢弃上次仿真终态，全量重算所有门逻辑（组合电路每次本来就会全量算；
   *  这里给时序电路/沙盒一个「状态复位、从头算」的手动出口）。 */
  const recompute = (): void => {
    prevSimRef.current = null;
    setRecomputeNonce((n) => n + 1);
    setToast('已重新计算：全部门逻辑重新求值');
  };

  const solveOneKey = (): void => {
    if (!currentLevel) {
      setToast('调试模式的「一键出答案」只在关卡模式有效');
      return;
    }
    const spec = familySpecOf(currentLevel, progress.family);
    const teach = teachingSolutionOf(currentLevel.id, spec.family);
    const candidates: { kind: 'element' | 'gate'; note?: string }[] = [];
    // 门版按玩家工艺取（TTL/CMOS 用强输出积木，判定能过强度检查）；无该工艺门版时
    // 此处为空 → 只给契约元件版（spec.reference 一定是该契约能过的工艺答案）。
    // 门版是默认答案（排在前，弹窗默认选中）；元件版仅在相对门版占优（更省/更快）时
    // 作为「更优解」追加在后并标注。无门版 → 元件版兜底。
    if (teach) candidates.push({ kind: 'gate' });
    if (spec.reference) {
      const edge = elementEdgeOf(currentLevel, spec.family);
      if (edge)
        candidates.push({ kind: 'element', note: edge === 'cost' ? '造价更低' : '延迟更短' });
      else if (!teach) candidates.push({ kind: 'element' });
    }
    if (candidates.length === 0) {
      setToast('本关没有参考解，无法一键出答案');
      return;
    }
    if (candidates.length === 1) {
      applyAnswer((candidates[0] as { kind: 'element' | 'gate' }).kind);
      return;
    }
    setAnswerCandidates(candidates);
  };

  // ---- 关卡 / 模式入口（模式只在主菜单选，进关后不可改） ----
  const currentLevelRaw = levelOf(gameMode, levelId);
  // 教学关按玩家契约换内容（CMOS 契约下「认识三极管」→「认识 MOS」等）；id 不变
  const currentLevel = currentLevelRaw ? levelViewOf(currentLevelRaw, progress.family) : null;

  /** 清掉跨关卡残留的临时状态 */
  const clearTransient = (): void => {
    setJudgeResult(null);
    setSelection([]);
    setSelectedWires([]);
    setPlacing(null);
    setPendingPin(null);
    setPendingPoint(null);
  };

  /** 进入关卡/教学关工作台：教学关走「教学模式」（独立入口，不评星不锁链）；
   *  进教学关先讲课：弹「元件课堂」概念卡 */
  const enterLevel = (nextLevelId: string): void => {
    const teach = isTeachLevel(nextLevelId);
    const mode: GameMode = teach ? 'teach' : 'level';
    setGameMode(mode);
    setLevelId(nextLevelId);
    setDoc(
      docFor(mode, nextLevelId, withLevelGates(progress.library, nextLevelId, progress.family)),
    );
    clearTransient();
    setScreen('bench');
    if (!teach) {
      // 进关即开工并持久化：刷新直接回工作台；支线等委托选项在左侧图纸卡上随时可选
      setProgress((prev) => (isNewJob(prev, nextLevelId) ? setStarted(prev, nextLevelId) : prev));
    }
    const levelObj = teach ? findTeachLevel(nextLevelId) : findLevel(nextLevelId);
    setClassroomOpen(Boolean(levelObj?.classroom));
  };

  /** 进入教学模式（元件图鉴列表页） */
  const enterTeachMode = (): void => {
    setGameMode('teach');
    setScreen('teach');
  };

  /** 进入自由沙盒 */
  const enterFree = (): void => {
    setGameMode('free');
    setLevelId(levelId);
    setDoc(docFor('free', levelId, withLevelGates(progress.library, levelId, progress.family)));
    clearTransient();
    setScreen('bench');
  };

  /** 重载当前关：清空画布并回到本关初始画布（组件库保留），不改变所在关 */
  const reloadLevel = (): void => {
    if (gameMode === 'free') return;
    setDoc(freshDocFor(gameMode, levelId, progress.library));
    clearTransient();
    setToast('已清空并重载本关初始画布');
  };

  /** 回主菜单 */
  const goToMenu = (): void => setScreen('menu');
  /** 回关卡地图 */
  const goToMap = (): void => setScreen('map');
  /** 回教学模式（元件图鉴） */
  const goToTeach = (): void => setScreen('teach');

  /** 新游戏第一步：确认后进入「逻辑族契约选择」（决策 2：新游戏固定契约） */
  const startNewGame = (): void => {
    if (!window.confirm('确定重头开始？当前进度、钱包与组件库都会被清空。')) return;
    setPickingFamily(true);
  };

  /** 新游戏第二步：选定逻辑族契约后清档，整个存档固定该契约 */
  const confirmNewGame = (family: LogicFamily): void => {
    localStorage.removeItem(PROGRESS_KEY);
    localStorage.removeItem(FREE_STORAGE_KEY);
    for (const lvl of ALL_LEVELS) localStorage.removeItem(storageKeyFor('level', lvl.id));
    setProgress(emptyProgress(family));
    setSettlement(null);
    setSettlementStars(0);
    setChipDrop(null);
    clearTransient();
    setPickingFamily(false);
    setScreen('menu');
  };

  // ---- 关卡校验：判定跑在 Worker/主线程，用的就是画布上这份电路 ----
  /** 判定用的关卡：接了支线单就套上支线条件（规则与主线同源，只是更严） */
  // 验收判定用的关卡：与当前关一致（无支线单后不再替换判定条件）
  const judgedLevel = currentLevel;

  const runJudge = async (): Promise<void> => {
    if (!judgedLevel) return;
    setJudging(true);
    // 知识卡片（原教学关）不算成绩：不记尝试次数，也不记通关
    const isKnowledgeCard = Boolean(judgedLevel.classroom);
    if (!isKnowledgeCard) setProgress((prev) => recordAttempt(prev, judgedLevel.id));
    try {
      const design = toDesign(doc, { id: `level-${judgedLevel.id}`, name: judgedLevel.title });
      // 判定规则（用户定稿）：功能正确即可过关——成本/时序超预算只降评分/星级，
      // 不判失败；强度契约/端口/素材等结构检查仍硬性。门版答案照常过关。
      const response = await runner.send({
        type: 'judge',
        design,
        library: doc.library.map((m) => m.template),
        level: judgedLevel,
        // 判定恒按真实时序：建立/保持等时序检查一律生效（不再由玩家的看法开关决定）
        mode: simMode,
        hardcore: simMode === 'timing',
        family: progress.family,
      });
      if (response.error || !response.judge) {
        setToast(`校验失败：${response.error ?? '未知错误'}`);
        return;
      }
      setJudgeResult(response.judge);
      const judge = response.judge;
      if (judge.pass) {
        // 验收通过 → 自动封装进组件库并弹出结算（不用再点「交付并封装」）
        await wrapAndSettle(judge);
      } else {
        setToast(judge.errors[0] ?? '还没通过，看看下方对比表');
      }
    } finally {
      setJudging(false);
    }
  };

  /** 封装 + 结算：验收通过后自动执行 —— 把当前电路封装成关卡产出的模块，
   *  永久加入个人组件库、记录成绩，并弹出「验收报告」对话框（含「接着做下一单」）。
   *  教学关例外：它是「学元件」，通过只记「已学会」，不封装模块、不往组件库塞东西。 */
  const wrapAndSettle = async (judge: JudgeResult): Promise<void> => {
    if (!currentLevel) return;
    // 知识卡片（原教学关）：对上了就给一句反馈，**不记成绩、不弹结算、不产出积木** ——
    // 它是随时可以翻看的知识卡，不是订单。对照表本身就在工作台下方，那就是学习反馈。
    if (currentLevel.classroom) {
      setToast(`对上了【${currentLevel.title}】：知识卡片不计进度与成绩，随时可以回来翻看`);
      return;
    }
    // 同一关已结算过（结算对话框还开着）就不再重复封装
    if (settlement && judgeResult === judge && levelRecord) return;
    const name = currentLevel.unlock?.name ?? currentLevel.title;
    const design = toDesign(doc, { id: `wrap-${currentLevel.id}`, name });
    /** 本单要写进组件库的模块：本关产出的模块 + 它身体引用到的教学积木（见下） */
    let toAdd: StoredModule[] = [];
    const response = await runner.send({
      type: 'wrap',
      design,
      library: doc.library.map((m) => m.template),
      name,
      stage: currentLevel.stage,
    });
    if (response.error || !response.wrapped) {
      setToast(`封装失败：${response.error ?? '未知错误'}`);
      return;
    }
    const info = response.wrapped;
    const stored = storeModule(
      progress.library,
      {
        hash: info.hash,
        name: info.name,
        costHalf: info.costHalf,
        isSequential: info.isSequential,
        ports: info.ports,
        template: info.template,
        stage: currentLevel.stage,
        levelId: currentLevel.id,
        sources: design.instances
          .filter((inst) => inst.kind === 'module')
          .map((inst) => (inst.kind === 'module' ? inst.module : '')),
      },
      Date.now(),
    );
    // 封装出的复合模块身体会引用子积木哈希（玩家自己的模块 + 教学积木）。教学积木不在
    // 玩家库里 → 跨关复用会 unknown-module：把身体传递引用到的教学积木一并持久化进玩家库
    // （teaching 标记，仍不出现在「我的模块」，但库里有 → 编译可解析）。幂等：重复无害。
    const deps = teachingDepsOf(
      (info.template as ModuleTemplate).body,
      doc.library,
      progress.family,
    );
    toAdd = [stored, ...deps];
    let library = doc.library;
    for (const m of toAdd) library = addModule(library, m);
    commit({ ...doc, library });
    // 星级：元件成本与传播延迟各按基准线四档（0.5/0.75/1 倍），取较差
    const stars = starsOf(judge);
    setProgress((prev) => {
      let next = prev.library;
      for (const m of toAdd) next = addModule(next, m);
      return recordClear(
        { ...prev, library: next },
        currentLevel.id,
        judge.score,
        judge.costHalf,
        stars,
      );
    });
    const index = ALL_LEVELS.findIndex((l) => l.id === currentLevel.id);
    const next = index >= 0 ? ALL_LEVELS[index + 1] : undefined;
    // 过场：芯片落进组件库 → 结算页（客户验收报告 + 钱 + 评级）
    setChipDrop(name);
    window.setTimeout(() => setChipDrop(null), 1400);
    setSettlement(judge);
    setSettlementStars(stars);
    setToast(
      `已交付【${name}】：材料费 ${judge.costHalf / 2} 元${next ? `，已解锁下一单「${next.title}」` : '，主线全部完成'}`,
    );
  };

  /** 复制当前电路 JSON：方便贴给我检查布线 / 分享 / 调试 */
  const copyCircuit = (): void => {
    // 复制的是「电路」，不背全局组件库（模块是进度的一部分，与布线无关）
    const { library: _library, ...canvas } = doc;
    void navigator.clipboard
      .writeText(JSON.stringify(canvas))
      .then(() => setToast('当前电路已复制到剪贴板（粘贴给我即可检查）'))
      .catch(() => setToast('复制失败：请用控制台 copy(localStorage.getItem(KEY))'));
  };

  /** 导出存档：直接把 JSON 交给浏览器下载（file:// 打开时也能用） */
  const doExport = (): void => {
    const text = exportSave(progress);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `layered-circuits-save-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(
      `已导出存档：${ALL_LEVELS.filter((l) => isCleared(progress, l.id)).length} 关通关记录、${progress.library.length} 个模块版本`,
    );
  };

  /** 导入存档：覆盖当前进度（坏档直接提示，不动现有数据） */
  const doImport = (text: string): void => {
    const { progress: raw, error } = importSave(text);
    if (error) {
      setToast(`导入失败：${error}`);
      return;
    }
    // 导入的存档同样瘦身：同名只留最新版本，但存档画布（可能还留在本机）引用到的一律保留
    const imported = {
      ...raw,
      library: dedupeLibrary(raw.library, referencedModuleHashes(raw.library)),
    };
    saveProgress(imported);
    setProgress(imported);
    const level = levelOf(gameMode, levelId) ?? ALL_LEVELS[0];
    if (level) loadDoc(docForLevel(level, imported.library));
    setToast(
      `已导入存档：${imported.library.length} 个模块版本，${Object.keys(imported.cleared).length} 关通关记录`,
    );
  };

  // ---- 面板数据 ----
  const units: Array<[UnitKind, number]> = snapshot
    ? ([
        ['npn', snapshot.cost.counts.npn ?? 0],
        ['res', snapshot.cost.counts.res ?? 0],
        ['dio', snapshot.cost.counts.dio ?? 0],
        ['cap', snapshot.cost.counts.cap ?? 0],
        ['nmos', snapshot.cost.counts.nmos ?? 0],
        ['pmos', snapshot.cost.counts.pmos ?? 0],
      ] as Array<[UnitKind, number]>)
    : [];

  const selectedSyms = doc.syms.filter((s) => selection.includes(s.id));
  const levelRecord = currentLevel ? progress.cleared[currentLevel.id] : undefined;
  /** 单选中的模块（Inspector 里给出「展开内部电路」入口） */
  const selectedModule =
    selectedSyms.length === 1 && selectedSyms[0]?.kind === 'module' && selectedSyms[0]?.module
      ? (doc.library.find((m) => m.hash === (selectedSyms[0] as Sym).module) ?? null)
      : null;

  // ---- 主菜单（开场）：模式只在这是选 ----
  if (screen === 'menu') {
    const resumeLevelRaw = findLevel(session.levelId);
    const resumeLevel = resumeLevelRaw ? levelViewOf(resumeLevelRaw, progress.family) : null;
    const canResume =
      session.mode === 'level' &&
      Boolean(resumeLevel) &&
      (Boolean(progress.started?.[session.levelId]) || isCleared(progress, session.levelId));
    if (pickingFamily) {
      return <FamilyPicker onSelect={confirmNewGame} onCancel={() => setPickingFamily(false)} />;
    }
    return (
      <MainMenu
        progress={progress}
        canResume={canResume}
        resumeLabel={
          resumeLevel
            ? `第 ${ALL_LEVELS.findIndex((l) => l.id === session.levelId) + 1} 关 · ${resumeLevel.title}`
            : ''
        }
        onContinue={() => enterLevel(session.levelId)}
        onLevelMode={goToMap}
        onTeachMode={enterTeachMode}
        onFreeMode={enterFree}
        onNewGame={startNewGame}
      />
    );
  }

  // ---- 关卡地图（选关）----
  if (screen === 'map') {
    return (
      <WorldMap
        progress={progress}
        family={progress.family}
        currentLevelId={levelId}
        onPick={enterLevel}
        onBack={goToMenu}
      />
    );
  }

  // ---- 教学模式（元件图鉴：认识各个元件）----
  if (screen === 'teach') {
    return (
      <TeachPanel
        family={progress.family}
        currentLevelId={levelId}
        onPick={enterLevel}
        onBack={goToMenu}
      />
    );
  }

  // ---- 工作台 ----
  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          逐层电路 <span>· 电路工作台</span>
        </div>
        {gameMode === 'level' ? (
          <button
            type="button"
            className="back-btn"
            onClick={goToMap}
            title="回到关卡地图（草图已自动保存）"
          >
            ← 返回地图
          </button>
        ) : gameMode === 'teach' ? (
          <button
            type="button"
            className="back-btn"
            onClick={goToTeach}
            title="回到知识卡片列表（草图已自动保存）"
          >
            ← 返回知识卡片
          </button>
        ) : (
          <button
            type="button"
            className="back-btn"
            onClick={goToMenu}
            title="回到主菜单（草图已自动保存）"
          >
            ← 主菜单
          </button>
        )}
        {debugFlag && (
          <div className="group debug-group">
            <button
              type="button"
              className={debugMode ? 'active' : ''}
              onClick={() => setDebugMode(!debugMode)}
              title="调试模式：解锁「一键出答案」等开发辅助，不影响正常玩法"
            >
              调试模式
            </button>
            {debugMode && (
              <>
                <button
                  type="button"
                  onClick={copyCircuit}
                  title="复制当前电路 JSON（贴给我检查布线）"
                >
                  复制电路
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={solveOneKey}
                  title="把本关参考解直接搭到画布上（调试用）。优先逻辑门版；元件版仅在造价/延迟占优时才会弹窗让你选"
                >
                  一键出答案
                </button>
                <button
                  type="button"
                  onClick={recompute}
                  title="丢弃上次仿真终态，从头重新计算全部门逻辑（组合电路每次本来就会全量算）"
                >
                  重新计算
                </button>
              </>
            )}
          </div>
        )}
        {gameMode !== 'free' && (
          <div className="group">
            <button
              type="button"
              className="primary"
              onClick={() => void runJudge()}
              disabled={judging}
            >
              {currentLevel?.classroom
                ? judging
                  ? '对照中…'
                  : '对照答案'
                : judging
                  ? '验收中…'
                  : '交付验收'}
            </button>
            <span className="cleared-count">
              已通关 {ALL_LEVELS.filter((item) => isCleared(progress, item.id)).length}/
              {ALL_LEVELS.length} · 可用余额 {(progress.walletHalf - progress.spentHalf) / 2} 元 ·{' '}
              {rankOf(progress).title}
            </span>
          </div>
        )}
        <div className="group">
          <button
            type="button"
            className={logicMode ? 'active' : ''}
            title="逻辑版：抹平元件延迟、只看逻辑对不对（不评延迟档，只按成本评星）"
            onClick={() => setLogicMode(!logicMode)}
            disabled={Boolean(levelJudgeMode)}
          >
            {logicMode ? '逻辑版' : '时序版'}
          </button>
        </div>
        <div className="group">
          <button type="button" onClick={undo} disabled={undoStack.length === 0}>
            撤销
          </button>
          <button type="button" onClick={redo} disabled={redoStack.length === 0}>
            重做
          </button>
          <button type="button" onClick={rotateSelection} disabled={selection.length === 0}>
            旋转 (R)
          </button>
          <button
            type="button"
            onClick={deleteSelection}
            disabled={selection.length === 0 && selectedWires.length === 0}
          >
            删除
          </button>
        </div>
        <div className="group">
          {gameMode === 'free' ? (
            <button type="button" onClick={() => loadDoc(notGateDemo())}>
              载入非门示例
            </button>
          ) : (
            <button
              type="button"
              onClick={reloadLevel}
              title="清空画布，回到本关初始画布（组件库保留）"
            >
              重载本关
            </button>
          )}
          {gameMode === 'free' && (
            <button type="button" className="primary" onClick={() => void wrapSelection()}>
              封装为模块
            </button>
          )}
        </div>
        <div className="spacer" />
      </header>

      <div className="body">
        {leftOpen && (
          <Palette
            mode={simMode}
            placing={placing}
            onPick={setPlacing}
            library={doc.library}
            level={
              currentLevel
                ? {
                    ...currentLevel,
                    allowedUnits: [...familySpecOf(currentLevel, progress.family).units],
                  }
                : null
            }
          />
        )}
        <div className={`edge-strip left${leftOpen ? '' : ' closed'}`}>
          <button
            type="button"
            onClick={() => setLeftOpen(!leftOpen)}
            title={leftOpen ? '收起元件库（腾出画布空间）' : '展开元件库'}
            aria-label={leftOpen ? '收起元件库' : '展开元件库'}
          >
            {leftOpen ? '◀' : '▶'}
          </button>
        </div>

        <div className="canvas-wrap" ref={containerRef}>
          <canvas
            ref={canvasRef}
            style={{ width: size.width, height: size.height }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={onDrop}
            onDoubleClick={onDoubleClick}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onContextMenu={(e) => e.preventDefault()}
          />
          <div className="hint">
            <div>
              {placing
                ? '点击/轻点画布放置元件（Esc 取消）'
                : pendingPin
                  ? '再点/再轻点一个引脚完成连线（Esc 或再轻点同一个引脚取消）'
                  : '拖动空白处平移 · 滚轮缩放 · 点两个引脚连线 · 双击连线删除 · 双击模块展开内部电路 · 点输入符号切换 0/1（Alt 循环 X/Z）'}
            </div>
            {/* 触屏手势说明：手机上没有滚轮/右键/键盘，手势与鼠标一一对应（详见 editor/gesture.ts） */}
            <div className="hint-touch">
              {longPressReady
                ? '长按已就绪：拖动 ＝ 移动元件 · 原地松手 ＝ 删除连线 / 展开模块'
                : '触屏：单指拖动 ＝ 平移 · 双指捏合 ＝ 缩放（两指一起拖也是平移）· 轻点引脚 ＝ 选中/连线 · 双击或长按后松手 ＝ 删除连线/展开模块 · 长按后拖动 ＝ 移动元件'}
            </div>
          </div>
          {classroomOpen && currentLevel?.classroom && (
            <ClassroomModal
              level={currentLevel}
              family={progress.family}
              onStart={() => setClassroomOpen(false)}
            />
          )}
          {answerCandidates && (
            <Modal title="一键出答案" onClose={() => setAnswerCandidates(null)}>
              <p className="answer-choices-hint">这一关两种版本都可以搭到画布上，选一个：</p>
              <div className="answer-choices">
                {answerCandidates.map((c) => (
                  <button
                    key={c.kind}
                    type="button"
                    className={c.kind === 'element' ? 'primary' : ''}
                    onClick={() => {
                      setAnswerCandidates(null);
                      applyAnswer(c.kind);
                    }}
                  >
                    <span className="answer-choices-name">
                      {c.kind === 'gate' ? '逻辑门版（简洁）' : '元件版（晶体管级）'}
                    </span>
                    {c.note && <span className="answer-choices-note">· {c.note}</span>}
                  </button>
                ))}
              </div>
            </Modal>
          )}

          {notice && (
            <Modal title={notice.title} onClose={() => setNotice(null)}>
              <p>{notice.body}</p>
              <div className="group-row">
                <button type="button" className="primary" onClick={() => setNotice(null)}>
                  知道了
                </button>
              </div>
            </Modal>
          )}
          {chipDrop && (
            <div className="chip-drop">
              <div className="chip">
                <span>{chipDrop}</span>
              </div>
              <p>交付完成 · 已封装进组件库</p>
            </div>
          )}
          {expandedModule && (
            <ModuleDetailModal
              module={expandedModule}
              library={doc.library}
              stopAtGates={currentLevel?.judgeMode === 'logic'}
              onClose={() => setExpandedModule(null)}
            />
          )}
          {toast && (
            <button type="button" className="toast" onClick={() => setToast(null)}>
              {toast}
            </button>
          )}
          {snapshot && (
            <div className="legend">
              <span style={{ color: '#38d67a' }}>■ 强 1</span>
              <span style={{ color: '#1d7a48' }}>■ 弱 1</span>
              <span style={{ color: '#7d8ea3' }}>■ 强 0</span>
              <span style={{ color: '#414c59' }}>■ 弱 0</span>
              <span style={{ color: '#ff5f56' }}>┅ X</span>
              <span style={{ color: '#b99530' }}>┅ 悬空</span>
            </div>
          )}
        </div>

        {rightOpen && (
          <div className="side">
            {currentLevel && (
              <LevelCard level={currentLevel} costHalf={snapshot?.cost.half ?? 0} mode={simMode} />
            )}
            {currentLevel && (
              <JudgePanel
                mode={simMode}
                level={judgedLevel ?? currentLevel}
                result={judgeResult}
                record={levelRecord}
                attempts={progress.attempts[currentLevel.id] ?? 0}
              />
            )}
            {currentLevel && settlement && (
              <SettlementPanel
                level={currentLevel}
                stars={settlementStars}
                levelName={currentLevel.unlock?.name ?? currentLevel.title}
                result={settlement}
                previousScore={levelRecord?.score ?? null}
                walletHalf={progress.walletHalf}
                nextLevelTitle={
                  ALL_LEVELS.findIndex((l) => l.id === currentLevel.id) >= 0
                    ? ALL_LEVELS[ALL_LEVELS.findIndex((l) => l.id === currentLevel.id) + 1]?.title
                    : undefined // 教学关：没有下一关
                }
                onNextLevel={() => {
                  // 教学关不在关卡链上：结算页的按钮是「回到教学模式」
                  if (currentLevel.classroom) {
                    goToTeach();
                    return;
                  }
                  const next =
                    ALL_LEVELS.findIndex((l) => l.id === currentLevel.id) >= 0
                      ? ALL_LEVELS[ALL_LEVELS.findIndex((l) => l.id === currentLevel.id) + 1]
                      : undefined;
                  if (next) enterLevel(next.id);
                }}
                onDismiss={() => setSettlement(null)}
              />
            )}
            <Inspector
              snapshot={snapshot}
              units={units}
              selectionLabel={
                selectedSyms.length === 0
                  ? null
                  : selectedSyms.length === 1
                    ? describeSym(selectedSyms[0] as Sym, doc)
                    : `已选中 ${selectedSyms.length} 个元件`
              }
              selectedModule={selectedModule}
              onExpandModule={selectedModule ? () => setExpandedModule(selectedModule) : undefined}
              pinTable={
                selectedSyms.length === 1
                  ? pinNames(selectedSyms[0] as Sym, doc.library).map((pin) => ({
                      pin,
                      text: signalText(pinSignals.get(`${(selectedSyms[0] as Sym).id}.${pin}[0]`)),
                    }))
                  : []
              }
            />
            {timingView && simMode === 'timing' && (
              <WaveformPanel
                waveform={liveWave}
                portNames={Object.keys(snapshot?.portValues ?? {})}
                emptyHint="点一下输入（或在画布上改电平），这里画真实延迟下每个端口的跳变。"
              />
            )}
            {panelOpen === 'wave' && judgeResult && (
              <WaveformPanel
                waveform={judgeWaveform}
                portNames={judgePortNames}
                marks={judgeMarks}
              />
            )}
          </div>
        )}

        {panelOpen === 'library' && (
          <Modal title="组件库与成绩" onClose={() => setPanelOpen(null)}>
            <LibraryPanel
              library={doc.library}
              rows={leaderboard(progress)}
              currentLevelId={currentLevel?.id}
              onExport={doExport}
              onImport={doImport}
              onJumpToLevel={(id) => {
                setPanelOpen(null);
                enterLevel(id);
              }}
            />
          </Modal>
        )}
        {panelOpen === 'wave' && judgeResult && (
          <Modal title="波形" onClose={() => setPanelOpen(null)}>
            <WaveformPanel waveform={judgeWaveform} portNames={judgePortNames} marks={judgeMarks} />
          </Modal>
        )}
        <div className={`edge-strip right${rightOpen ? '' : ' closed'}`}>
          <button
            type="button"
            onClick={() => setRightOpen(!rightOpen)}
            title={rightOpen ? '收起右侧面板（验收/属性）' : '展开右侧面板（验收/属性）'}
            aria-label={rightOpen ? '收起右侧面板' : '展开右侧面板'}
          >
            {rightOpen ? '▶' : '◀'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 教学用门级模块 → 画布库条目（按玩家工艺给对应工艺的积木，hash 内容稳定，重复注入无害；
 *  teaching: true 标记使其不出现在「我的模块」与放置面板，见 editor/model.ts StoredModule） */
const teachingStoredFor = (family: LogicFamily): StoredModule[] =>
  teachingModulesFor(family).map((m) => ({
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
    teaching: true,
  }));

/**
 * 设计传递引用到的教学积木（复合积木的身体还会引用更早的积木）。
 * 封装出的复合模块要跨关复用，其身体引用的教学积木必须也在玩家库里；
 * 这里把它们找出来（保持 teaching 标记，不出现在「我的模块」，但库里有 → 编译可解析）。
 */
/**
 * 本关开放模块库时（`moduleAccess !== 'none'`，第 1 章起），把该契约的**门整族**注入画布库，
 * 玩家不必再从元件手搭门。
 *
 * 为什么注入整族而不是只注入白名单：复合门的身体会引用更底层的门（异或门 → 与非门…），
 * 只注入白名单会在展开时 unknown-module。菜单（Palette）只列出 `allowedModules` 里的门，
 * 判定器也按同一名单把关，所以"库里多、菜单里少"是刻意的。
 */
const withLevelGates = (
  library: StoredModule[],
  levelId: string | null,
  family: LogicFamily,
): StoredModule[] => {
  const level = levelId ? findLevel(levelId) : null;
  if (!level || level.moduleAccess === 'none') return library;
  return [...library, ...teachingStoredFor(family)];
};

const teachingDepsOf = (
  design: Design,
  library: readonly StoredModule[],
  family: LogicFamily,
): StoredModule[] => {
  const all = teachingStoredFor(family);
  const byHash = new Map<string, ModuleTemplate>();
  // 模板在存档/画布库里是纯 JSON（结构化克隆），按 familyOfModule 的既有模式窄化成 ModuleTemplate
  for (const m of library) byHash.set(m.hash, m.template as ModuleTemplate);
  for (const m of all) byHash.set(m.hash, m.template as ModuleTemplate);
  const found = new Map<string, StoredModule>();
  const seen = new Set<string>();
  const walk = (d: Design): void => {
    for (const inst of d.instances) {
      if (inst.kind !== 'module') continue;
      if (seen.has(inst.module)) continue;
      seen.add(inst.module);
      const t = byHash.get(inst.module);
      if (!t) continue;
      walk(t.body);
      const teach = all.find((m) => m.hash === inst.module);
      if (teach) found.set(inst.module, teach);
    }
  };
  walk(design);
  return [...found.values()];
};

/** 面板开合等 UI 偏好的持久化：刷新后保持用户上次的选择 */
function usePersistentBool(key: string, def: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return raw === '1';
    } catch {
      // 忽略读失败
    }
    return def;
  });
  const set = useCallback(
    (next: boolean): void => {
      setValue(next);
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        // 忽略写失败
      }
    },
    [key],
  );
  return [value, set];
}

function snap(v: number): number {
  return Math.round(v / 10) * 10;
}

function describeSym(sym: Sym, doc: Doc): string {
  if (sym.kind === 'unit' && sym.unit) {
    const pins = pinOffsets(sym, doc.library)
      .map((p) => p.name)
      .join('/');
    return `${sym.label}（${UNIT_LABEL[sym.unit]}，引脚 ${pins}）`;
  }
  if (sym.kind === 'module') {
    const stored = doc.library.find((m) => m.hash === sym.module);
    const box = moduleBox(sym, doc.library);
    return `${sym.label}（模块 ${box.w}×${box.h}，成本 ${stored ? stored.costHalf / 2 : '?'}）`;
  }
  return sym.label;
}
