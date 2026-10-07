/**
 * 模块详情弹窗（双击画布上的模块展开）：
 * - 元信息：类型 / 工艺 / 成本 / 是否时序 / 关键路径 / 端口 / 内容哈希；
 * - 内部电路：把封装时的 Design 还原成画布 Doc，只读渲染（fromDesign 布局复用）；
 * - 成本明细：buildCostTree 递归拆到底层元件（GDD 2.4「点击模块展开树状结构查看成本明细」）。
 *
 * 纯展示组件：不修改画布、不改存档。
 */

import { buildCostTree, type CostTree } from '@lc/compiler';
import { formatCounts, InMemoryModuleLibrary, type ModuleTemplate } from '@lc/schema';
import { isFunctionAtom, isGateName } from '@lc/sim-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Doc,
  fromDesign,
  moduleBox,
  pinOffsets,
  type StoredModule,
  type Sym,
} from '../editor/model';
import { type Camera, drawScene } from '../editor/render';
import { type ProbeResult, probeModule } from '../sim/probe';
import { Modal } from './Modal';

const KIND_LABEL: Record<string, string> = {
  logic: '组合逻辑',
  seq: '时序单元',
  arith: '算术单元',
  mem: '存储器',
  cpu: '处理器',
};

const FAMILY_LABEL: Record<string, string> = {
  rtl: 'RTL 电阻-三极管',
  dtl: 'DTL 二极管逻辑',
  ttl: 'TTL 推挽输出',
  cmos: 'CMOS 互补 MOS',
};

/**
 * 收集展开某个模块所需的全部模板：从画布库出发，把 body 里引用的子模块模板
 * 一层层挖出来（子模块的子模块……），保证内部电路渲染时每个模块实例都有端口定义。
 */
export function libraryWithNested(root: StoredModule, library: StoredModule[]): StoredModule[] {
  const byHash = new Map<string, StoredModule>();
  for (const m of library) byHash.set(m.hash, m);
  const out = new Map<string, StoredModule>();
  const queue: StoredModule[] = [root];
  while (queue.length > 0) {
    const cur = queue.pop() as StoredModule;
    if (out.has(cur.hash)) continue;
    out.set(cur.hash, cur);
    const tpl = cur.template as ModuleTemplate | null | undefined;
    const body = tpl?.body;
    if (body && Array.isArray(body.instances)) {
      for (const inst of body.instances) {
        if (inst.kind !== 'module') continue;
        const child = byHash.get(inst.module) ?? out.get(inst.module);
        if (child) queue.push(child);
      }
    }
  }
  return [...out.values()];
}

/** 模块内部电路的「基准画布」：按模板端口预置 input/output（左边输入、右边输出），
 *  电源轨放左上/右上（fromDesign 只保留设计里真实出现的电源实例，这里仅兜底）。 */
export function docForModuleBody(template: ModuleTemplate, library: StoredModule[]): Doc {
  const syms: Sym[] = [
    { id: 'rail-vcc', kind: 'vcc', x: 60, y: 60, rot: 0, label: 'VCC', locked: true },
    { id: 'rail-gnd', kind: 'gnd', x: 720, y: 60, rot: 0, label: 'GND', locked: true },
  ];
  const ins = template.ports.filter((p) => p.dir === 'in');
  const outs = template.ports.filter((p) => p.dir === 'out');
  ins.forEach((p, i) => {
    syms.push({
      id: `in-${p.name}`,
      kind: 'input',
      x: 40,
      y: 200 + i * 140,
      rot: 0,
      value: 0,
      label: p.name,
      width: p.width,
      locked: true,
    });
  });
  outs.forEach((p, i) => {
    syms.push({
      id: `out-${p.name}`,
      kind: 'output',
      x: 700,
      y: 200 + i * 140,
      rot: 0,
      label: p.name,
      width: p.width,
      locked: true,
    });
  });
  return {
    id: `preview-${template.hash.slice(0, 8)}`,
    name: template.name,
    syms,
    wires: [],
    library,
  };
}

/** 画布内容的包围盒（引脚 + 符号半径都算进去，模块按盒尺寸取半径） */
export function docBounds(doc: Doc): { x: number; y: number; w: number; h: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const sym of doc.syms) {
    let r = 26;
    if (sym.kind === 'module') {
      const b = moduleBox(sym, doc.library);
      r = Math.max(b.w, b.h) / 2;
    }
    for (const off of pinOffsets(sym, doc.library)) {
      minX = Math.min(minX, sym.x + off.x);
      maxX = Math.max(maxX, sym.x + off.x);
      minY = Math.min(minY, sym.y + off.y);
      maxY = Math.max(maxY, sym.y + off.y);
    }
    minX = Math.min(minX, sym.x - r);
    maxX = Math.max(maxX, sym.x + r);
    minY = Math.min(minY, sym.y - r);
    maxY = Math.max(maxY, sym.y + r);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 640, h: 360 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 让整个电路刚好装进预览窗口（世界中心对准视口中心，按需缩放） */
export function fitCamera(doc: Doc, viewW: number, viewH: number): Camera {
  const b = docBounds(doc);
  const pad = 40;
  const scale = Math.max(
    0.1,
    Math.min(1.5, (viewW - pad * 2) / Math.max(1, b.w), (viewH - pad * 2) / Math.max(1, b.h)),
  );
  return { x: b.x + b.w / 2, y: b.y + b.h / 2, scale };
}

/**
 * 只读电路预览：把 Doc 画到小画布上（静态结构图，**pinSignals 是空 Map、没有电平文字**）。
 * 仍把 `showStrength` 透给 drawScene，只为"口径只有一个来源"（将来这里若开始画电平，
 * 不会出现「大画布显示 1、小画布显示 1·强」的不一致）。
 */
function SchematicView({
  doc,
  showStrength = true,
}: {
  doc: Doc;
  showStrength?: boolean;
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 340;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, {
      doc,
      camera: fitCamera(doc, w, h),
      width: w,
      height: h,
      pinSignals: new Map(),
      selection: [],
      selectedWires: [],
      hover: null,
      pendingPin: null,
      pendingPoint: null,
      grid: true,
      showStrength,
    });
  }, [doc, showStrength]);
  return <canvas ref={ref} className="schematic-canvas" aria-label="模块内部电路图" />;
}

/** 成本明细树节点（带稳定 key，递归渲染用） */
type KeyedCostTree = Omit<CostTree, 'children'> & { key: string; children: KeyedCostTree[] };

function keyedTree(tree: CostTree, path = 'root'): KeyedCostTree {
  return {
    ...tree,
    key: path,
    children: tree.children.map((child, i) => keyedTree(child, `${path}/${i}`)),
  };
}

/** 成本明细树：递归渲染每一层的元件构成与成本 */
function CostTreeView({ tree }: { tree: KeyedCostTree }): React.JSX.Element {
  return (
    <div className="cost-tree-node">
      <div className="cost-tree-row">
        <span className="cost-tree-label">{tree.label}</span>
        <span className="cost-tree-cost">{tree.costHalf / 2} 元</span>
        <span className="cost-tree-counts">{formatCounts(tree.counts)}</span>
      </div>
      {tree.children.length > 0 && (
        <div className="cost-tree-children">
          {tree.children.map((child) => (
            <CostTreeView key={child.key} tree={child} />
          ))}
        </div>
      )}
    </div>
  );
}

export interface ModuleDetailModalProps {
  /**
   * **展开只到门**：逻辑版关卡下，基础门（7 个基础门 + 2 个功能原子）不再往下展开到元件。
   * 逻辑版的语义就是"按门算"，玩家要看的是门级结构，不是三极管 —— 这就是"简化"的落点。
   * （时序版关卡保持原样：那里元件本身就是主角，展开看内部是有意义的。）
   */
  stopAtGates?: boolean;
  /**
   * 电平文字要不要带「·强 / ·弱」（缺省 true = 老行为）。逻辑关传 false：
   * 那里的判定是零延迟布尔口径，`0·强` 是噪音 → 只显示 `1` / `0`。
   * 时序关与自由模式保持 true（强/弱在那里有意义）。
   */
  showStrength?: boolean;
  module: StoredModule;
  /** 画布库（含嵌套模块模板时一并解析；缺省的子模块渲染成空盒，不影响查看） */
  library: StoredModule[];
  onClose: () => void;
}

export function ModuleDetailModal({
  stopAtGates = false,
  showStrength = true,
  module,
  library,
  onClose,
}: ModuleDetailModalProps): React.JSX.Element {
  const template = (module.template ?? null) as ModuleTemplate | null;
  const isBasicGate =
    template !== null && (isGateName(template.name) || isFunctionAtom(template.name));
  const gateStop = stopAtGates && isBasicGate;
  const merged = useMemo(() => libraryWithNested(module, library), [module, library]);
  const previewDoc = useMemo(() => {
    if (gateStop || !template?.body) return null;
    return fromDesign(template.body, docForModuleBody(template, merged));
  }, [template, merged, gateStop]);
  const costTree = useMemo(() => {
    if (!template?.body) return null;
    const lib = new InMemoryModuleLibrary(
      merged
        .map((m) => m.template as ModuleTemplate)
        .filter((t): t is ModuleTemplate => Boolean(t)),
    );
    return keyedTree(buildCostTree(template.body, lib, template.name));
  }, [template, merged]);
  const instCount = template?.body?.instances.length ?? 0;
  const probe: ProbeResult = useMemo(() => {
    if (!template?.body) return { rows: [], stuck: [], skipped: '这个模块没有内部电路' };
    return probeModule(template, merged, { showStrength });
  }, [template, merged, showStrength]);

  // 复制模块 JSON：模块内部电路出问题时（例如画布上放的是「我的模块」里早先封装的坏模块），
  // 玩家可以把这一整份贴出来离线复现 —— 画布导出（复制电路）只带模块哈希，不带模块本体。
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const copyModule = (): void => {
    const text = JSON.stringify(module);
    if (!navigator.clipboard?.writeText) {
      setCopied('fail');
      return;
    }
    void navigator.clipboard
      .writeText(text)
      .then(() => setCopied('ok'))
      .catch(() => setCopied('fail'));
  };

  return (
    <Modal
      title={`${module.name} · 模块详情`}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={copyModule}
          title="把这个模块的端口与内部电路整份复制出来（贴给开发者可直接离线复现）"
        >
          {copied === 'ok' ? '已复制 ✓' : copied === 'fail' ? '复制失败' : '复制模块 JSON'}
        </button>
      }
    >
      <div className="module-detail">
        <table className="kv">
          <tbody>
            <tr>
              <td>类型</td>
              <td>{KIND_LABEL[template?.kind ?? 'logic'] ?? template?.kind ?? '—'}</td>
            </tr>
            <tr>
              <td>工艺</td>
              <td>{FAMILY_LABEL[template?.family ?? 'rtl'] ?? template?.family}</td>
            </tr>
            <tr>
              <td>成本</td>
              <td className="num">
                {module.costHalf / 2} 元（{module.costHalf} 半单位）
              </td>
            </tr>
            <tr>
              <td>性质</td>
              <td>{template?.isSequential ? '时序电路（有记忆）' : '组合电路'}</td>
            </tr>
            <tr>
              <td>关键路径</td>
              <td className="num">{((template?.criticalPathPs ?? 0) / 1000).toFixed(2)} ns</td>
            </tr>
            <tr>
              <td>端口</td>
              <td className="mono small">
                {template && template.ports.length > 0
                  ? template.ports
                      .map(
                        (p) =>
                          `${p.name}${p.width > 1 ? `[${p.width - 1}:0]` : ''}(${p.dir === 'in' ? '入' : '出'})`,
                      )
                      .join(' · ')
                  : '—'}
              </td>
            </tr>
            <tr>
              <td>内容哈希</td>
              <td className="mono small break">{module.hash}</td>
            </tr>
          </tbody>
        </table>

        {gateStop && (
          <p className="hint">
            逻辑版按门计算：<b>{template?.name}</b> 是基础门（原子），它的功能就是它本身，
            这里不再展开到元件。看元件实现请到时序版关卡，或把它的行为直接当成一个黑盒来用。
          </p>
        )}

        {previewDoc && (
          <>
            <h4>内部电路（{instCount} 个元件 · 只读）</h4>
            <SchematicView doc={previewDoc} showStrength={showStrength} />
            <p className="dim small">
              这是封装那一刻的电路：模块可以随时拆开看它由什么拼成，成本与延迟也由此递归而来。
            </p>
          </>
        )}

        <h4>自测（把它当电路跑一遍）</h4>
        {probe.error ? (
          <p className="small bad">自测没跑起来：{probe.error}</p>
        ) : probe.skipped ? (
          <p className="small dim">{probe.skipped}</p>
        ) : (
          <>
            <table className="kv probe">
              <thead>
                <tr>
                  <th>输入</th>
                  <th>输出</th>
                </tr>
              </thead>
              <tbody>
                {probe.rows.map((row) => (
                  <tr key={JSON.stringify(row.inputs)}>
                    <td className="mono small">
                      {Object.entries(row.inputs)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(' · ')}
                    </td>
                    <td className="mono small">
                      {Object.entries(row.outputs)
                        .map(([k, v]) => `${k} → ${v}`)
                        .join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {probe.stuck.length > 0 ? (
              <p className="small bad">
                ⚠ {probe.stuck.join('、')} 在输入变化时一直没动 —— 这个模块现在不是你以为的那个功能
                （展开下面的内部电路看哪根线接错了，或者重新封装一个）。
              </p>
            ) : (
              <p className="small dim">输出会随输入变化，看起来是活的 ✓</p>
            )}
          </>
        )}

        {costTree && (
          <>
            <h4>成本明细（递归拆到底层元件）</h4>
            <CostTreeView tree={costTree} />
          </>
        )}
      </div>
    </Modal>
  );
}
