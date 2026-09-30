import type { JudgeResult } from '@lc/compiler';
import { ALL_LEVELS, findLevel } from '@lc/content';
import { useEffect, useMemo, useRef, useState } from 'react';
import { emptyDoc, notGateDemo } from './editor/demos';
import {
  createSym,
  type Doc,
  findSym,
  type InputDrive,
  inputValues,
  moduleBox,
  type PlaceKind,
  pinNames,
  pinOffsets,
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
import { buyEquipment, ownsEquipment } from './level/equipment';
import { addModule, storeModule } from './level/library';
import {
  docForLevel,
  exportSave,
  importSave,
  isCleared,
  isNewJob,
  leaderboard,
  type Progress,
  rankOf,
  reconCount,
  recordAttempt,
  recordClear,
  recordSideJob,
  saveProgress,
  setRecon,
  setStarted,
  starsOf,
} from './level/progress';
import { docFor, type GameMode, initialSession, levelOf, storageKeyFor } from './level/session';
import { applySideJob, findSideJob } from './level/sideJobs';
import { CommissionModal } from './panels/CommissionModal';
import { Inspector } from './panels/Inspector';
import { JudgePanel } from './panels/JudgePanel';
import { LevelCard } from './panels/LevelCard';
import { LevelMap } from './panels/LevelMap';
import { LibraryPanel } from './panels/LibraryPanel';
import { MainMenu } from './panels/MainMenu';
import { Modal } from './panels/Modal';
import { Palette } from './panels/Palette';
import { ReconPanel } from './panels/ReconPanel';
import { SettlementPanel } from './panels/SettlementPanel';
import { TruthTable } from './panels/TruthTable';
import { WaveformPanel } from './panels/WaveformPanel';
import { WorkshopPanel } from './panels/WorkshopPanel';
import { WorldMap } from './panels/WorldMap';
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
  const dragRef = useRef<DragState>({
    mode: 'none',
    originX: 0,
    originY: 0,
    cameraX: 0,
    cameraY: 0,
    moved: false,
    startSyms: new Map(),
  });

  // 会话（模式 / 当前关卡 / 存档）一次性装载
  const session = useMemo(() => initialSession(), []);
  const [doc, setDoc] = useState<Doc>(() => session.doc);
  const [progress, setProgress] = useState<Progress>(() => session.progress);
  const [gameMode, setGameMode] = useState<GameMode>(() => session.mode);
  const [levelId, setLevelId] = useState<string>(() => session.levelId);
  /** 画面：主菜单 / 关卡地图 / 工作台 —— 模式只在主菜单里选，进关后不能改 */
  const [screen, setScreen] = useState<'menu' | 'map' | 'bench'>('menu');
  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null);
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
  const [mode, setMode] = useState<'logic' | 'timing'>('logic');
  /** 时序挑战关（kind = 'timing'）强制硬核：科普模式会把延迟抹平，考不出时序问题 */
  const forcedHardcore = levelOf(gameMode, levelId)?.kind === 'timing';
  useEffect(() => {
    if (forcedHardcore) setMode('timing');
  }, [forcedHardcore]);

  // 换关时关掉上一单的结算页与过场（依赖 levelId 就是为了「换单即清屏」）
  useEffect(() => {
    void levelId;
    setSettlement(null);
    setChipDrop(null);
  }, [levelId]);

  const [showTruth, setShowTruth] = useState(true);
  const [showWave, setShowWave] = useState(false);
  /** 左右侧面板整体收起/展开（体验：布线时把侧栏收起来腾画布），选择记忆在 localStorage */
  const [leftOpen, setLeftOpen] = usePersistentBool('lc-ui-left-open', true);
  const [rightOpen, setRightOpen] = usePersistentBool('lc-ui-right-open', true);
  /** 低频面板弹窗：任务墙 / 工具铺 / 组件库 / 波形（点击启动，不用时不留侧栏） */
  const [panelOpen, setPanelOpen] = useState<null | 'map' | 'shop' | 'library' | 'wave'>(null);
  /** 画布探针：买下探针后可点连线钉读数 */
  const [probes, setProbes] = useState<
    Array<{ id: string; x: number; y: number; inst: string; pin: string }>
  >([]);
  const [showTiming, setShowTiming] = useState(false);
  const [snapshot, setSnapshot] = useState<SimSnapshot | null>(null);
  const [resultDoc, setResultDoc] = useState<Doc | null>(null);
  const [runnerKind, setRunnerKind] = useState(runner.kind);
  const [toast, setToast] = useState<string | null>(null);
  /** 结算页：交付并封装之后出现（客户验收报告 + 钱 + 评级） */
  const [settlement, setSettlement] = useState<JudgeResult | null>(null);
  /** 本次交付的星数（结算页展示） */
  const [settlementStars, setSettlementStars] = useState(0);
  /** 接单对话框：只对「新单」状态的关弹（开工/通关后刷新不再弹） */
  const [commissionOpen, setCommissionOpen] = useState(false);
  /** 中央提示对话框（图纸解开等小节点） */
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  /** 黑盒侦察对话框（开工后若图纸未测则直接进入） */
  const [reconOpen, setReconOpen] = useState(false);
  /** 当前接的支线单（同一时刻最多一条，验收按支线条件判） */
  const [sideJobKey, setSideJobKey] = useState<string | null>(null);
  /** 封装过场：电路被压成一颗芯片落进组件库 */
  const [chipDrop, setChipDrop] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });

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
  useEffect(() => {
    if (runner.kind !== runnerKind) setRunnerKind(runner.kind);
    const timer = setTimeout(() => {
      const design = toDesign(doc);
      runner
        .send({
          type: 'simulate',
          design,
          library: doc.library.map((m) => m.template),
          mode,
          inputs: inputValues(doc),
          withTiming: showTiming,
          withTruth: showTruth,
          maxTruthRows: 32,
        })
        .then((response: StudioResponse) => {
          if (response.error) {
            setToast(`仿真出错：${response.error}`);
            return;
          }
          if (response.snapshot) {
            setSnapshot(response.snapshot);
            setResultDoc(doc);
          }
        })
        .catch((error: unknown) => setToast(`仿真失败：${String(error)}`));
    }, 40);
    return () => clearTimeout(timer);
  }, [doc, mode, showTruth, showTiming, runner, runnerKind]);

  // ---- 本地自动存档（按模式 + 关卡分开存） ----
  const storageKey = storageKeyFor(gameMode, levelId);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(doc));
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
    probes,
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
      probes,
    });
  }, [
    doc,
    camera,
    size,
    pinSignals,
    selection,
    selectedWires,
    hover,
    pendingPin,
    pendingPoint,
    probes,
  ]);

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
        setProbes([]);
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

  // ---- 鼠标交互 ----
  const localPoint = (
    event: React.MouseEvent,
  ): { sx: number; sy: number; wx: number; wy: number } => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const w = screenToWorld(camera, size.width, size.height, sx, sy);
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
          : createSym(doc, kind.kind, undefined, snap(wx), snap(wy));
    next.syms.push(created);
    commit(next);
    setSelection([created.id]);
  };

  /** 双击连线 → 直接删除这根线（比「点选 + Delete」顺手） */
  const onDoubleClick = (event: React.MouseEvent): void => {
    if (placing) return;
    const { wx, wy } = localPoint(event);
    const target = hitTest(currentScene(), wx, wy);
    if (target?.kind === 'wire') {
      commit({ ...doc, wires: doc.wires.filter((w) => w.id !== target.id) });
      setSelectedWires([]);
      setSelection([]);
    }
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
    else if (tag === 'vcc' || tag === 'gnd' || tag === 'input' || tag === 'output')
      placeAt({ kind: tag }, w.x, w.y);
  };

  const onMouseDown = (event: React.MouseEvent): void => {
    const { sx, sy, wx, wy } = localPoint(event);
    const target = hitTest(currentScene(), wx, wy);

    if (placing) {
      placeAt(placing, wx, wy);
      setPlacing(null);
      return;
    }

    if (target?.kind === 'pin') {
      const sym = findSym(doc, target.id);
      if (!sym) return;
      if (!pendingPin) {
        setPendingPin({ inst: target.id, pin: target.pin as string, bit: target.bit ?? 0 });
        setPendingPoint({ x: wx, y: wy });
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
      return;
    }

    if (target?.kind === 'sym') {
      const sym = findSym(doc, target.id);
      if (sym?.kind === 'input') {
        if (event.altKey) cycleInput(sym.id);
        else toggleInput(sym.id);
      }
      if (!event.shiftKey && !selection.includes(target.id)) setSelection([target.id]);
      else if (event.shiftKey)
        setSelection((prev) =>
          prev.includes(target.id) ? prev.filter((id) => id !== target.id) : [...prev, target.id],
        );
      setSelectedWires([]);
      const startSyms = new Map<string, { x: number; y: number }>();
      const ids = event.shiftKey
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
        originX: sx,
        originY: sy,
        cameraX: camera.x,
        cameraY: camera.y,
        moved: false,
        startSyms,
      };
      return;
    }

    if (target?.kind === 'wire') {
      setSelectedWires([target.id]);
      setSelection([]);
      if (ownsEquipment(progress, 'probe')) {
        const wire = doc.wires.find((w) => w.id === target.id);
        if (wire) {
          const pid = `${target.id}@${Math.round(wx)}:${Math.round(wy)}`;
          setProbes((prev) =>
            prev.some((p) => p.id === pid)
              ? prev.filter((p) => p.id !== pid)
              : [...prev, { id: pid, x: wx, y: wy, inst: wire.a.inst, pin: wire.a.pin }],
          );
        }
      }
      return;
    }

    setSelection([]);
    setSelectedWires([]);
    setProbes([]);
    setPendingPin(null);
    dragRef.current = {
      mode: 'pan',
      originX: sx,
      originY: sy,
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
      if (Math.abs(sx - drag.originX) + Math.abs(sy - drag.originY) > 3) drag.moved = true;
      setCamera((prev) => ({
        ...prev,
        x: drag.cameraX - (sx - drag.originX) / prev.scale,
        y: drag.cameraY - (sy - drag.originY) / prev.scale,
      }));
      return;
    }
    if (drag.mode === 'move') {
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
      return;
    }
    setHover(hitTest(currentScene(), wx, wy));
    if (pendingPin) setPendingPoint({ x: wx, y: wy });
  };

  const onMouseUp = (): void => {
    const drag = dragRef.current;
    if (drag.mode === 'move' && drag.moved) {
      // 拖动结束后把「拖动前」的状态压入撤销栈
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
    commit({
      ...doc,
      syms: doc.syms.map((s) =>
        s.id === id ? { ...s, value: ((s.value ?? 0) === 1 ? 0 : 1) as InputDrive } : s,
      ),
    });
  };

  const cycleInput = (id: string): void => {
    commit({
      ...doc,
      syms: doc.syms.map((s) =>
        s.id === id ? { ...s, value: (((s.value ?? 0) + 1) % 4) as InputDrive } : s,
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

  // ---- 关卡 / 模式入口（模式只在主菜单选，进关后不可改） ----
  const currentLevel = levelOf(gameMode, levelId);

  /** 清掉跨关卡残留的临时状态 */
  const clearTransient = (): void => {
    setJudgeResult(null);
    setSelection([]);
    setSelectedWires([]);
    setPlacing(null);
    setPendingPin(null);
    setPendingPoint(null);
    setSideJobKey(null);
  };

  /** 进入关卡工作台；新单弹「新委托」，已开工/已通关的直接继续 */
  const enterLevel = (nextLevelId: string): void => {
    setGameMode('level');
    setLevelId(nextLevelId);
    setDoc(docFor('level', nextLevelId, progress.library));
    clearTransient();
    setScreen('bench');
    if (isNewJob(progress, nextLevelId)) setCommissionOpen(true);
  };

  /** 进入自由沙盒 */
  const enterFree = (): void => {
    setGameMode('free');
    setLevelId(levelId);
    setDoc(docFor('free', levelId, progress.library));
    clearTransient();
    setScreen('bench');
  };

  /** 重载当前关：丢弃草图回到本关初始画布（组件库保留），不改变所在关 */
  const reloadLevel = (): void => {
    if (gameMode !== 'level') return;
    setDoc(docFor('level', levelId, progress.library));
    clearTransient();
    setToast('已重载本关初始画布');
  };

  /** 回主菜单 */
  const goToMenu = (): void => setScreen('menu');
  /** 回关卡地图 */
  const goToMap = (): void => setScreen('map');

  // ---- 关卡校验：判定跑在 Worker/主线程，用的就是画布上这份电路 ----
  /** 判定用的关卡：接了支线单就套上支线条件（规则与主线同源，只是更严） */
  const activeSideJob = findSideJob(currentLevel, sideJobKey);
  const judgedLevel =
    currentLevel && activeSideJob ? applySideJob(currentLevel, activeSideJob) : currentLevel;

  const runJudge = async (): Promise<void> => {
    if (!judgedLevel) return;
    setJudging(true);
    setProgress((prev) => recordAttempt(prev, judgedLevel.id));
    try {
      const response = await runner.send({
        type: 'judge',
        design: toDesign(doc, { id: `level-${judgedLevel.id}`, name: judgedLevel.title }),
        library: doc.library.map((m) => m.template),
        level: judgedLevel,
        hardcore: forcedHardcore || mode === 'timing',
      });
      if (response.error || !response.judge) {
        setToast(`校验失败：${response.error ?? '未知错误'}`);
        return;
      }
      setJudgeResult(response.judge);
      const judge = response.judge;
      if (judge.pass) {
        setToast(
          judge.score >= 100
            ? `通过！成本 ${judge.costHalf / 2} 已是最优，满分 100`
            : `通过！成本 ${judge.costHalf / 2}（预算 ${judge.budgetHalf / 2}），得分 ${judge.score}`,
        );
      } else {
        setToast(judge.errors[0] ?? '还没通过，看看下方对比表');
      }
    } finally {
      setJudging(false);
    }
  };

  /** 通关：把当前电路封装成关卡产出的模块，永久加入个人组件库，并记录成绩 */
  const clearLevel = async (): Promise<void> => {
    if (!currentLevel || !judgeResult?.pass) return;
    const name = currentLevel.unlock?.name ?? currentLevel.title;
    const design = toDesign(doc, { id: `wrap-${currentLevel.id}`, name });
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
    commit({ ...doc, library: addModule(doc.library, stored) });
    // 星级：功能（交付成功）/ 成本（满分）/ 时序（硬核或时序达标）
    const stars = starsOf(judgeResult, forcedHardcore || mode === 'timing');
    setProgress((prev) => {
      const cleared = recordClear(
        { ...prev, library: addModule(prev.library, stored) },
        currentLevel.id,
        judgeResult.score,
        judgeResult.costHalf,
        stars,
      );
      // 支线单达成 → 额外奖金入钱包
      return activeSideJob
        ? recordSideJob(cleared, currentLevel.id, activeSideJob.key, activeSideJob.bonusHalf)
        : cleared;
    });
    const index = ALL_LEVELS.findIndex((l) => l.id === currentLevel.id);
    const next = ALL_LEVELS[index + 1];
    // 过场：芯片落进组件库 → 结算页（客户验收报告 + 钱 + 评级）
    setChipDrop(name);
    window.setTimeout(() => setChipDrop(null), 1400);
    setSettlement(judgeResult);
    setSettlementStars(stars);
    setToast(
      `已交付【${name}】：材料费 ${info.costHalf / 2} 元${next ? `，已解锁下一单「${next.title}」` : '，主线全部完成'}`,
    );
  };

  /** 复制当前电路 JSON：方便贴给我检查布线 / 分享 / 调试 */
  const copyCircuit = (): void => {
    void navigator.clipboard
      .writeText(JSON.stringify(doc))
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
    const { progress: imported, error } = importSave(text);
    if (error) {
      setToast(`导入失败：${error}`);
      return;
    }
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
      ] as Array<[UnitKind, number]>)
    : [];

  const selectedSyms = doc.syms.filter((s) => selection.includes(s.id));
  const levelRecord = currentLevel ? progress.cleared[currentLevel.id] : undefined;

  // ---- 主菜单（开场）：模式只在这是选 ----
  if (screen === 'menu') {
    const resumeLevel = findLevel(session.levelId);
    const canResume =
      session.mode === 'level' &&
      Boolean(resumeLevel) &&
      (Boolean(progress.started?.[session.levelId]) || isCleared(progress, session.levelId));
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
        onFreeMode={enterFree}
      />
    );
  }

  // ---- 关卡地图（选关）----
  if (screen === 'map') {
    return (
      <WorldMap
        progress={progress}
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
        <button type="button" onClick={copyCircuit} title="复制当前电路 JSON（贴给我检查布线）">
          复制电路
        </button>
        {gameMode === 'level' && (
          <div className="group">
            <button
              type="button"
              className="primary"
              onClick={() => void runJudge()}
              disabled={judging}
            >
              {judging ? '验收中…' : '交付验收'}
            </button>
            <span className="cleared-count">
              已通关 {ALL_LEVELS.filter((item) => isCleared(progress, item.id)).length}/
              {ALL_LEVELS.length} · 可用余额 {(progress.walletHalf - progress.spentHalf) / 2} 元 ·{' '}
              {rankOf(progress).title} · 自主测绘 {reconCount(progress)}
            </span>
          </div>
        )}
        <div className="group">
          <button
            type="button"
            className={mode === 'logic' ? 'active' : ''}
            onClick={() => setMode('logic')}
            disabled={forcedHardcore}
            title={forcedHardcore ? '本关强制硬核工程模式（时序挑战关）' : '忽略延迟，只看逻辑'}
          >
            科普模式
          </button>
          <button
            type="button"
            className={mode === 'timing' ? 'active' : ''}
            onClick={() => setMode('timing')}
            title="带 1ns/0.5ns/0.8ns 延迟的硬核模式"
          >
            硬核模式{forcedHardcore ? '（本关强制）' : ''}
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
          {gameMode === 'level' ? (
            <button
              type="button"
              onClick={reloadLevel}
              title="丢弃当前草图，回到本关初始画布（组件库保留）"
            >
              重载本关
            </button>
          ) : (
            <button type="button" onClick={() => loadDoc(notGateDemo())}>
              载入非门示例
            </button>
          )}
          <button type="button" onClick={() => loadDoc({ ...emptyDoc(), library: doc.library })}>
            清空
          </button>
          <button type="button" className="primary" onClick={() => void wrapSelection()}>
            封装为模块
          </button>
        </div>
        <div className="spacer" />
        <label className="check">
          <input
            type="checkbox"
            checked={showTruth}
            onChange={(e) => setShowTruth(e.target.checked)}
          />
          真值表
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={showTiming}
            onChange={(e) => setShowTiming(e.target.checked)}
          />
          时序分析
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={showWave}
            onChange={(e) => setShowWave(e.target.checked)}
          />
          波形常显
        </label>
        <span className="runner" title="纯 TS 内核跑在 Web Worker 里；file:// 打开时自动回退主线程">
          {runnerKind === 'worker' ? 'Worker 仿真' : '主线程仿真'}
        </span>
      </header>

      <div className="body">
        {leftOpen && (
          <Palette
            placing={placing}
            onPick={setPlacing}
            library={doc.library}
            level={currentLevel}
            header={
              currentLevel && (
                <LevelCard
                  level={currentLevel}
                  costHalf={snapshot?.cost.half ?? 0}
                  reconDone={Boolean(progress.recon[currentLevel.id])}
                  sideJob={sideJobKey}
                  doneSideJobs={Object.keys(progress.sideJobs)
                    .filter((id) => id.startsWith(`${currentLevel.id}:`))
                    .map((id) => id.slice(currentLevel.id.length + 1))}
                  onPickSideJob={setSideJobKey}
                  onShowHint={() => setToast(currentLevel.hint)}
                  onOpenRecon={() => setReconOpen(true)}
                />
              )
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
            onContextMenu={(e) => e.preventDefault()}
          />
          <div className="hint">
            {placing
              ? '点击画布放置元件（Esc 取消）'
              : pendingPin
                ? '再点一个引脚完成连线（Esc 取消）'
                : '拖动空白处平移 · 滚轮缩放 · 点两个引脚连线 · 双击连线删除 · 点输入符号切换 0/1（Alt 循环 X/Z）'}
          </div>
          {commissionOpen && currentLevel && (
            <CommissionModal
              key={currentLevel.id}
              level={currentLevel}
              onStart={(job) => {
                setSideJobKey(job);
                setCommissionOpen(false);
                // 开工即持久化：以后刷新直接回到工作台，不再重选
                setProgress((prev) => setStarted(prev, currentLevel.id));
              }}
            />
          )}
          {reconOpen && currentLevel && (
            <Modal title="黑盒侦察" onClose={() => setReconOpen(false)}>
              <ReconPanel
                key={currentLevel.id}
                level={currentLevel}
                state={progress.recon[currentLevel.id]}
                hasProbe={ownsEquipment(progress, 'probe')}
                onMeasured={() => {
                  setProgress((prev) => setRecon(prev, currentLevel.id, 'measured'));
                  setReconOpen(false);
                  setNotice({
                    title: '图纸解开了',
                    body: `这张单的答案是你自己一格格测出来的 —— 黑盒侦察完成，可以开工搭电路了。`,
                  });
                }}
                onSkip={() => {
                  setProgress((prev) => setRecon(prev, currentLevel.id, 'skipped'));
                  setReconOpen(false);
                  setNotice({
                    title: '图纸解开了',
                    body: '你选择了直接看答案 —— 左侧图纸卡的输出列现在能看了（? 变成了 0/1）。不过这一单不算「自主测绘」。',
                  });
                }}
              />
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
              <JudgePanel
                level={judgedLevel ?? currentLevel}
                result={judgeResult}
                busy={judging}
                record={levelRecord}
                attempts={progress.attempts[currentLevel.id] ?? 0}
                onJudge={() => void runJudge()}
                onClear={() => void clearLevel()}
              />
            )}
            {currentLevel && settlement && (
              <SettlementPanel
                level={currentLevel}
                stars={settlementStars}
                reconMeasured={progress.recon[currentLevel.id] === 'measured'}
                sideJob={activeSideJob}
                sideJobDone={Boolean(progress.sideJobs[`${currentLevel.id}:${activeSideJob?.key}`])}
                levelName={currentLevel.unlock?.name ?? currentLevel.title}
                result={settlement}
                previousScore={levelRecord?.score ?? null}
                walletHalf={progress.walletHalf}
                nextLevelTitle={
                  ALL_LEVELS[ALL_LEVELS.findIndex((l) => l.id === currentLevel.id) + 1]?.title
                }
                onNextLevel={() => {
                  const next =
                    ALL_LEVELS[ALL_LEVELS.findIndex((l) => l.id === currentLevel.id) + 1];
                  if (next) enterLevel(next.id);
                }}
                onDismiss={() => setSettlement(null)}
              />
            )}
            <div className="rail">
              <button type="button" onClick={() => setPanelOpen('map')} title="章节地图 / 选关">
                任务墙
              </button>
              <button type="button" onClick={() => setPanelOpen('shop')} title="花钱买设备">
                工具铺
              </button>
              <button type="button" onClick={() => setPanelOpen('library')} title="封装复用 / 存档">
                组件库
              </button>
              <button type="button" onClick={() => setPanelOpen('wave')} title="端口波形">
                波形
              </button>
            </div>
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
              pinTable={
                selectedSyms.length === 1
                  ? pinNames(selectedSyms[0] as Sym, doc.library).map((pin) => ({
                      pin,
                      text: signalText(pinSignals.get(`${(selectedSyms[0] as Sym).id}.${pin}[0]`)),
                    }))
                  : []
              }
            />
            {(showWave || panelOpen === 'wave') && judgeResult && (
              <WaveformPanel
                result={judgeResult}
                hasScope={ownsEquipment(progress, 'scope')}
                portNames={[
                  ...Object.keys(judgeResult.rows[0]?.inputs ?? {}),
                  ...new Set(judgeResult.rows.flatMap((r) => Object.keys(r.expected))),
                ]}
              />
            )}
            {showTruth && <TruthTable snapshot={snapshot} />}
          </div>
        )}

        {panelOpen === 'map' && currentLevel && (
          <Modal title="任务墙" onClose={() => setPanelOpen(null)}>
            <LevelMap
              progress={progress}
              currentLevelId={currentLevel.id}
              onPick={(id) => {
                setPanelOpen(null);
                enterLevel(id);
              }}
            />
          </Modal>
        )}
        {panelOpen === 'shop' && (
          <Modal title="工具铺" onClose={() => setPanelOpen(null)}>
            <WorkshopPanel
              progress={progress}
              onBuy={(id) => {
                const result = buyEquipment(progress, id);
                setProgress(result.progress);
                if (result.error) setToast(result.error);
                else
                  setToast(
                    `已买下设备（可用余额 ${(result.progress.walletHalf - result.progress.spentHalf) / 2} 元）`,
                  );
              }}
            />
          </Modal>
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
            <WaveformPanel
              result={judgeResult}
              hasScope={ownsEquipment(progress, 'scope')}
              portNames={[
                ...Object.keys(judgeResult.rows[0]?.inputs ?? {}),
                ...new Set(judgeResult.rows.flatMap((r) => Object.keys(r.expected))),
              ]}
            />
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
          {!rightOpen && (
            <div className="rail-mini">
              <button type="button" onClick={() => setPanelOpen('map')} title="章节地图 / 选关">
                任务墙
              </button>
              <button type="button" onClick={() => setPanelOpen('shop')} title="花钱买设备">
                工具铺
              </button>
              <button type="button" onClick={() => setPanelOpen('library')} title="封装复用 / 存档">
                组件库
              </button>
              <button type="button" onClick={() => setPanelOpen('wave')} title="端口波形">
                波形
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
  const set = (next: boolean): void => {
    setValue(next);
    try {
      localStorage.setItem(key, next ? '1' : '0');
    } catch {
      // 忽略写失败
    }
  };
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
