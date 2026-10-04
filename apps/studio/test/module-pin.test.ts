// @vitest-environment jsdom
/**
 * 模块引脚外引：引脚不再落在方框边缘，而是从边缘向外引出一段引线（MODULE_PIN_LEAD=12），
 * 导线接引线外端；引脚偏移随模块旋转（与 input/output/unit 一致），
 * 方框本体（moduleBox）尺寸不变。
 */
import { describe, expect, it } from 'vitest';
import {
  type Doc,
  MODULE_HALF_WIDTH,
  MODULE_PIN_LEAD,
  moduleBox,
  pinOffsets,
} from '../src/editor/model';
import { drawScene, type Scene } from '../src/editor/render';

const lib = [
  {
    hash: 'h',
    name: '非门',
    version: 1,
    stage: 1,
    costHalf: 2,
    isSequential: false,
    ports: [
      { name: 'a', dir: 'in', width: 1 },
      { name: 'y', dir: 'out', width: 1 },
    ],
    template: {},
    sources: [],
    createdAt: 0,
  },
] as never[];

const sym = (rot: 0 | 1 | 2 | 3) =>
  ({
    id: 'm',
    kind: 'module',
    x: 100,
    y: 100,
    module: 'h',
    label: 'N1',
    rot,
  }) as never;

const doc: Doc = {
  syms: [sym(0)],
  wires: [],
  library: lib,
  backdrops: [],
  zoom: 1,
} as unknown as Doc;

describe('模块引脚外引', () => {
  it('rot0：引脚在框外 ±(半宽+引线)，不在框边上', () => {
    const o = pinOffsets(sym(0), lib);
    expect(o.find((p) => p.name === 'a')).toMatchObject({
      x: -(MODULE_HALF_WIDTH + MODULE_PIN_LEAD),
      y: 0,
    });
    expect(o.find((p) => p.name === 'y')).toMatchObject({
      x: MODULE_HALF_WIDTH + MODULE_PIN_LEAD,
      y: 0,
    });
  });

  it('旋转：输出引脚 rot1 转上方、rot2 转左侧', () => {
    const L = MODULE_HALF_WIDTH + MODULE_PIN_LEAD;
    const y1 = pinOffsets(sym(1), lib).find((p) => p.name === 'y')!;
    expect(y1.x === 0).toBe(true);
    expect(y1.y).toBe(L);
    const y2 = pinOffsets(sym(2), lib).find((p) => p.name === 'y')!;
    expect(y2.x).toBe(-L);
    expect(y2.y === 0).toBe(true);
    const y3 = pinOffsets(sym(3), lib).find((p) => p.name === 'y')!;
    expect(y3.x === 0).toBe(true);
    expect(y3.y).toBe(-L);
  });

  it('方框本体尺寸不变', () => {
    expect(moduleBox(sym(0), lib).w).toBe(MODULE_HALF_WIDTH * 2);
  });

  it('多 bit 端口按占位高度排布：8 位口不会压到下一个端口上', () => {
    // 回归：旧实现按「端口序号 × 24」排 y，而 8 位端口自身占 7×14=98px，
    // 于是 acc/alu 两排引脚互相交错，mod7 的 er.bit7 与 plus 只差 1px —— 布线时
    // 该引脚四个方向全被邻脚（半径 8）挡死，只能穿盒。
    const wide = [
      {
        hash: 'w',
        name: '计算器 ALU',
        version: 1,
        stage: 3,
        costHalf: 9,
        isSequential: false,
        ports: [
          { name: 'acc', dir: 'in', width: 8 },
          { name: 'alu', dir: 'in', width: 8 },
          { name: 'plus', dir: 'in', width: 1 },
          { name: 'minus', dir: 'in', width: 1 },
          { name: 'aSrc', dir: 'out', width: 8 },
          { name: 'accClk', dir: 'out', width: 1 },
        ],
        template: {},
        sources: [],
        createdAt: 0,
      },
    ] as never[];
    const s = { id: 'm', kind: 'module', x: 0, y: 0, module: 'w', label: 'M1', rot: 0 } as never;
    const pins = pinOffsets(s, wide);
    const box = moduleBox(s, wide);
    // 1) 任意两个不同引脚（含同端口不同 bit）至少隔一个 lane 间距
    for (let i = 0; i < pins.length; i += 1) {
      for (let j = i + 1; j < pins.length; j += 1) {
        const p = pins[i]!;
        const q = pins[j]!;
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        expect(
          d,
          `${p.name}[${p.bit}] 与 ${q.name}[${q.bit}] 只隔 ${d.toFixed(1)}px`,
        ).toBeGreaterThanOrEqual(14);
      }
    }
    // 2) 引脚全在方框内（方框高度由端口占位算出来，两边必须一致）
    for (const p of pins) {
      expect(Math.abs(p.y), `${p.name}[${p.bit}] 露在方框外`).toBeLessThanOrEqual(box.h / 2);
    }
    // 3) 同一个 8 位端口内部按 14px 排
    const acc = pins
      .filter((p) => p.name === 'acc')
      .map((p) => p.y)
      .sort((a, b) => a - b);
    expect(acc).toHaveLength(8);
    for (let i = 1; i < acc.length; i += 1) expect(acc[i]! - acc[i - 1]!).toBe(14);
  });

  it('绘制：引线从框边画到外端，不抛错', () => {
    const ops: string[] = [];
    const ctx = {
      save: () => ops.push('save'),
      restore: () => ops.push('restore'),
      beginPath: () => ops.push('beginPath'),
      moveTo: (x: number, y: number) => ops.push(`moveTo(${Math.round(x)},${Math.round(y)})`),
      lineTo: (x: number, y: number) => ops.push(`lineTo(${Math.round(x)},${Math.round(y)})`),
      arc: () => ops.push('arc'),
      stroke: () => ops.push('stroke'),
      fill: () => ops.push('fill'),
      fillRect: () => ops.push('fillRect'),
      strokeRect: () => ops.push('strokeRect'),
      translate: () => ops.push('translate'),
      rotate: () => ops.push('rotate'),
      scale: () => ops.push('scale'),
      setLineDash: () => ops.push('setLineDash'),
      fillText: () => ops.push('fillText'),
      strokeText: () => ops.push('strokeText'),
      measureText: () => ({ width: 10 }),
    } as unknown as CanvasRenderingContext2D;
    const scene: Scene = {
      doc,
      camera: { x: 0, y: 0, scale: 1 },
      width: 800,
      height: 600,
      pinSignals: new Map([
        ['m.a[0]', 8],
        ['m.y[0]', 5],
      ]),
      selection: [],
      selectedWires: [],
      hover: null,
      pendingPin: null,
      pendingPoint: null,
      grid: true,
    };
    expect(() => drawScene(ctx, scene)).not.toThrow();
    expect(ops).toContain(`moveTo(${MODULE_HALF_WIDTH},0)`);
    expect(ops).toContain(`lineTo(${MODULE_HALF_WIDTH + MODULE_PIN_LEAD},0)`);
  });
});
