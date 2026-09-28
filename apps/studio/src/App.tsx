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
import { Inspector } from './panels/Inspector';
import { Palette } from './panels/Palette';
import { TruthTable } from './panels/TruthTable';
import type { SimSnapshot, StudioResponse } from './sim/protocol';
import { createRunner } from './sim/runner';

const STORAGE_KEY = 'lc-studio-doc-v1';

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

  const [doc, setDoc] = useState<Doc>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Doc;
        if (parsed && Array.isArray(parsed.syms)) return parsed;
      }
    } catch {
      /* 忽略损坏的本地存档 */
    }
    return notGateDemo();
  });
  const [undoStack, setUndoStack] = useState<Doc[]>([]);
  const [redoStack, setRedoStack] = useState<Doc[]>([]);
  const [camera, setCamera] = useState<Camera>({ x: 340, y: 220, scale: 1 });
  const [selection, setSelection] = useState<string[]>([]);
  const [selectedWires, setSelectedWires] = useState<string[]>([]);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [placing, setPlacing] = useState<PlaceKind | null>(null);
  const [pendingPin, setPendingPin] = useState<{ inst: string; pin: string } | null>(null);
  const [pendingPoint, setPendingPoint] = useState<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<'logic' | 'timing'>('logic');
  const [showTruth, setShowTruth] = useState(true);
  const [showTiming, setShowTiming] = useState(false);
  const [snapshot, setSnapshot] = useState<SimSnapshot | null>(null);
  const [resultDoc, setResultDoc] = useState<Doc | null>(null);
  const [runnerKind, setRunnerKind] = useState(runner.kind);
  const [toast, setToast] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });

  // ---- 画布尺寸自适应（含 HiDPI） ----
  useEffect(() => {
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
  }, []);

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

  // ---- 本地自动存档 ----
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
      } catch {
        /* 存档失败无所谓 */
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [doc]);

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
    const next: Doc = {
      ...doc,
      syms: doc.syms.filter((s) => !ids.has(s.id)),
      wires: doc.wires.filter(
        (w) => !selectedWires.includes(w.id) && !ids.has(w.a.inst) && !ids.has(w.b.inst),
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

  const onMouseDown = (event: React.MouseEvent): void => {
    const { sx, sy, wx, wy } = localPoint(event);
    const target = hitTest(currentScene(), wx, wy);

    if (placing) {
      const next = { ...doc, syms: [...doc.syms] };
      const created =
        placing.kind === 'unit'
          ? createSym(doc, 'unit', placing.unit, snap(wx), snap(wy))
          : placing.kind === 'module'
            ? createSym(doc, 'module', undefined, snap(wx), snap(wy), placing.hash)
            : createSym(doc, placing.kind, undefined, snap(wx), snap(wy));
      next.syms.push(created);
      commit(next);
      setSelection([created.id]);
      setPlacing(null);
      return;
    }

    if (target?.kind === 'pin') {
      const sym = findSym(doc, target.id);
      if (!sym) return;
      if (!pendingPin) {
        setPendingPin({ inst: target.id, pin: target.pin as string });
        setPendingPoint({ x: wx, y: wy });
      } else {
        const from = pendingPin;
        const samePinClicked = from.inst === target.id && from.pin === target.pin;
        if (!samePinClicked) {
          addWire(from, { inst: target.id, pin: target.pin as string });
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
      return;
    }

    setSelection([]);
    setSelectedWires([]);
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
  const addWire = (a: { inst: string; pin: string }, b: { inst: string; pin: string }): void => {
    const refA = { inst: a.inst, pin: a.pin, bit: 0 };
    const refB = { inst: b.inst, pin: b.pin, bit: 0 };
    const exists = doc.wires.some(
      (w) =>
        (samePin(w.a, refA) && samePin(w.b, refB)) || (samePin(w.a, refB) && samePin(w.b, refA)),
    );
    if (exists) return;
    const id = `w${doc.wires.length + 1}-${a.inst}.${a.pin}-${b.inst}.${b.pin}`;
    commit({ ...doc, wires: [...doc.wires, { id, a: refA, b: refB }] });
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
    const response = await runner.send({
      type: 'wrap',
      design: toDesign(doc, { id: `wrap-${name}`, name }),
      library: doc.library.map((m) => m.template),
      name,
      stage: 1,
    });
    if (response.error || !response.wrapped) {
      setToast(`封装失败：${response.error ?? '未知错误'}`);
      return;
    }
    const info = response.wrapped;
    const stored = {
      hash: info.hash,
      name: info.name,
      costHalf: info.costHalf,
      isSequential: info.isSequential,
      ports: info.ports,
      template: info.template,
    };
    commit({ ...doc, library: [...doc.library.filter((m) => m.hash !== info.hash), stored] });
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

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          逐层电路 <span>· 电路工作台</span>
        </div>
        <div className="group">
          <button
            type="button"
            className={mode === 'logic' ? 'active' : ''}
            onClick={() => setMode('logic')}
            title="忽略延迟，只看逻辑"
          >
            科普模式
          </button>
          <button
            type="button"
            className={mode === 'timing' ? 'active' : ''}
            onClick={() => setMode('timing')}
            title="带 1ns/0.5ns/0.8ns 延迟的硬核模式"
          >
            硬核模式
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
          <button type="button" onClick={() => loadDoc(notGateDemo())}>
            载入非门示例
          </button>
          <button type="button" onClick={() => loadDoc(emptyDoc())}>
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
        <span className="runner" title="纯 TS 内核跑在 Web Worker 里；file:// 打开时自动回退主线程">
          {runnerKind === 'worker' ? 'Worker 仿真' : '主线程仿真'}
        </span>
      </header>

      <div className="body">
        <Palette placing={placing} onPick={setPlacing} library={doc.library} />

        <div className="canvas-wrap" ref={containerRef}>
          <canvas
            ref={canvasRef}
            style={{ width: size.width, height: size.height }}
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
                : '拖动空白处平移 · 滚轮缩放 · 点两个引脚连线 · 点输入符号切换 0/1（Alt 循环 X/Z）'}
          </div>
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

        <div className="side">
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
          {showTruth && <TruthTable snapshot={snapshot} />}
        </div>
      </div>
    </div>
  );
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
