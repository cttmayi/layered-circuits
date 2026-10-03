/**
 * 教学关「元件课堂」示意图：给每个教学元件一张 SVG 原理图（图文并茂）。
 *
 * 与画布同款配色（PALETTE，见 editor/render.ts）：暗色底 + 元件 body 色 +
 * 电平语义色（强 1 亮绿 / 强 0 冷灰 / 悬空土黄）。图随玩家契约切换
 * （CMOS 契约下「认识三极管」显示 N-MOS 图、「认识二极管」显示 P-MOS 图）。
 *
 * 纯 SVG、无图片资源：离线可用、缩放不糊、可被屏幕阅读器读出（aria-label）。
 */

import type { Level } from '@lc/schema';
import { PALETTE } from '../editor/render';

export interface ComponentDiagramProps {
  level: Level;
  /** 玩家契约（family）：CMOS 契约下教学关换对应工艺的图 */
  family: 'rtl' | 'dtl' | 'ttl' | 'cmos';
  /** 缩略图模式（元件图鉴卡片）：去掉底部要点行 */
  compact?: boolean;
}

/** 图类型：由关卡 id + 玩家契约共同决定 */
export type DiagramKey = 'npn' | 'nmos' | 'dio' | 'pmos' | 'float' | 'cmos-inv' | 'cmos-nand';

export function diagramKeyFor(level: Level, family: ComponentDiagramProps['family']): DiagramKey {
  switch (level.id) {
    case 's1-npn':
      return family === 'cmos' ? 'nmos' : 'npn';
    case 's1-dio':
      return family === 'cmos' ? 'pmos' : 'dio';
    case 's1-float':
      return family === 'cmos' ? 'cmos-inv' : 'float';
    case 's1-cmos-inv':
      return 'cmos-inv';
    case 's1-cmos-nand':
      return 'cmos-nand';
    default:
      return 'npn';
  }
}

const C = PALETTE;
const FONT = { fontFamily: 'system-ui, sans-serif' } as const;

/** 元件符号通用配色 */
const BODY = { stroke: C.body, fill: C.fill } as const;

/** 三极管/场效应管通用骨架：圆 + 基极/栅极竖条 + 引脚（内部斜线 + 上下引脚） */
function TransistorBody({
  cx,
  cy,
  r,
  arrow,
  bubble,
  mirror = false,
}: {
  cx: number;
  cy: number;
  r: number;
  /** 画发射极箭头（NPN 才有） */
  arrow?: boolean;
  /** 栅极引线上画小圆圈（P-MOS 才有） */
  bubble?: boolean;
  /** 栅极在右侧（CMOS 与非门的右排管子） */
  mirror?: boolean;
}): React.JSX.Element {
  const dir = mirror ? 1 : -1;
  const barX = cx + (dir * r) / 2; // 基极/栅极竖条
  const barHalf = Math.round((r * 11) / 19); // 竖条半高（按 r=19 的 ±11 比例）
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} {...BODY} strokeWidth={1.8} />
      <line
        x1={barX}
        y1={cy - barHalf}
        x2={barX}
        y2={cy + barHalf}
        stroke={C.body}
        strokeWidth={3}
      />
      {/* 基极/栅极引线 */}
      <line x1={cx + dir * r} y1={cy} x2={barX} y2={cy} stroke={C.wire} strokeWidth={1.6} />
      {bubble && (
        <circle
          cx={cx + dir * (r - 5)}
          cy={cy}
          r={4}
          fill={C.bg}
          stroke={C.body}
          strokeWidth={1.4}
        />
      )}
      {/* 上引脚（集电极 c / 漏极 d / 源极 s） */}
      <line
        x1={barX}
        y1={cy - r * 0.37}
        x2={cx}
        y2={cy - r * 0.84}
        stroke={C.wire}
        strokeWidth={1.6}
      />
      <line x1={cx} y1={cy - r * 0.84} x2={cx} y2={cy - r} stroke={C.wire} strokeWidth={1.6} />
      {/* 下引脚（发射极 e / 源极 s / 漏极 d） */}
      <line
        x1={barX}
        y1={cy + r * 0.37}
        x2={cx}
        y2={cy + r * 0.84}
        stroke={C.wire}
        strokeWidth={1.6}
      />
      <line x1={cx} y1={cy + r * 0.84} x2={cx} y2={cy + r} stroke={C.wire} strokeWidth={1.6} />
      {arrow && (
        <path
          d={`M ${cx - 3.5} ${cy + r * 0.74} L ${cx + 4} ${cy + r * 0.9} L ${cx - 4.5} ${cy + r * 0.98} Z`}
          fill={C.body}
        />
      )}
    </g>
  );
}

/** 引脚小圆点 */
function PinDot({ x, y }: { x: number; y: number }): React.JSX.Element {
  return <circle cx={x} cy={y} r={3} fill={C.hover} />;
}

/** 端口方块（输入/输出） */
function Port({
  x,
  y,
  label,
  dir,
}: {
  x: number;
  y: number;
  label: string;
  dir: 'in' | 'out';
}): React.JSX.Element {
  const stroke = dir === 'in' ? C.portInStroke : C.portOutStroke;
  const fill = dir === 'in' ? C.portInFill : '#2a2114';
  return (
    <g>
      <rect
        x={x - 5}
        y={y - 5}
        width={10}
        height={10}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
      />
      <text x={x - 9} y={y + 4} textAnchor="end" fontSize={11} fill={C.text} {...FONT}>
        {label}
      </text>
    </g>
  );
}

/** 电阻（矩形，竖放或横放） */
function Resistor({
  x1,
  y1,
  x2,
  y2,
  label,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
}): React.JSX.Element {
  const vertical = x1 === x2;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.wire} strokeWidth={1.6} />
      <rect
        x={vertical ? cx - 8 : cx - Math.abs(x2 - x1) / 2}
        y={vertical ? cy - Math.abs(y2 - y1) / 2 : cy - 8}
        width={vertical ? 16 : Math.abs(x2 - x1)}
        height={vertical ? Math.abs(y2 - y1) : 16}
        fill={C.fill}
        stroke={C.body}
        strokeWidth={1.6}
      />
      {label && (
        <text
          x={vertical ? cx + 13 : cx}
          y={vertical ? cy + 4 : cy - 14}
          textAnchor={vertical ? 'start' : 'middle'}
          fontSize={10}
          fill={C.textDim}
          {...FONT}
        >
          {label}
        </text>
      )}
    </g>
  );
}

/** VCC 电源轨 */
function Vcc({ x, label = 'VCC' }: { x: number; label?: string }): React.JSX.Element {
  return (
    <g>
      <text x={x} y={12} textAnchor="middle" fontSize={10} fill={C.strong1} {...FONT}>
        {label}
      </text>
      <line x1={x - 8} y1={16} x2={x + 8} y2={16} stroke={C.strong1} strokeWidth={2} />
    </g>
  );
}

/** GND 地线符号 */
function Gnd({ x, y, label = 'GND' }: { x: number; y: number; label?: string }): React.JSX.Element {
  return (
    <g>
      <line x1={x - 9} y1={y} x2={x + 9} y2={y} stroke={C.strong0} strokeWidth={2} />
      <line x1={x - 5.5} y1={y + 4} x2={x + 5.5} y2={y + 4} stroke={C.strong0} strokeWidth={1.6} />
      <line x1={x - 2.5} y1={y + 8} x2={x + 2.5} y2={y + 8} stroke={C.strong0} strokeWidth={1.2} />
      {label && (
        <text x={x + 13} y={y + 4} fontSize={10} fill={C.textDim} {...FONT}>
          {label}
        </text>
      )}
    </g>
  );
}

/** 电池（竖放，左正右负） */
function Battery({ x, y, label }: { x: number; y: number; label: string }): React.JSX.Element {
  return (
    <g>
      <line x1={x} y1={y - 14} x2={x} y2={y + 14} stroke={C.body} strokeWidth={2.2} />
      <line x1={x + 9} y1={y - 9} x2={x + 9} y2={y + 9} stroke={C.body} strokeWidth={4} />
      <text x={x - 4} y={y + 4} textAnchor="end" fontSize={10} fill={C.strong1} {...FONT}>
        +
      </text>
      <text x={x + 14} y={y + 4} fontSize={10} fill={C.strong0} {...FONT}>
        −
      </text>
      {label && (
        <text x={x + 4} y={y + 28} textAnchor="middle" fontSize={10} fill={C.textDim} {...FONT}>
          {label}
        </text>
      )}
    </g>
  );
}

/** 灯（输出设备）：圆 + 十字 */
function Lamp({ x, y }: { x: number; y: number }): React.JSX.Element {
  return (
    <g>
      <circle cx={x} cy={y} r={10} fill={C.fill} stroke={C.selection} strokeWidth={1.8} />
      <line
        x1={x - 5.5}
        y1={y - 5.5}
        x2={x + 5.5}
        y2={y + 5.5}
        stroke={C.selection}
        strokeWidth={1.6}
      />
      <line
        x1={x - 5.5}
        y1={y + 5.5}
        x2={x + 5.5}
        y2={y - 5.5}
        stroke={C.selection}
        strokeWidth={1.6}
      />
    </g>
  );
}

/** 二极管（三角 + 阴极条，横放，阳极在左） */
function Diode({ x, y }: { x: number; y: number }): React.JSX.Element {
  return (
    <g>
      <path
        d={`M ${x} ${y - 9} L ${x} ${y + 9} L ${x + 10} ${y} Z`}
        fill={C.fill}
        stroke={C.body}
        strokeWidth={1.6}
      />
      <line x1={x + 10} y1={y - 9} x2={x + 10} y2={y + 9} stroke={C.body} strokeWidth={2} />
    </g>
  );
}

/** 底部要点行 */
function Takeaway({ text, x = 170 }: { text: string; x?: number }): React.JSX.Element {
  return (
    <text
      x={x}
      y={192}
      textAnchor={x === 170 ? 'middle' : 'start'}
      fontSize={11}
      fill={C.text}
      {...FONT}
    >
      {text}
    </text>
  );
}

/** NPN 反相开关：输入 a → 基极；集电极 → y + 上拉电阻；发射极 → GND */
function NpnDiagram({ compact }: { compact?: boolean }): React.JSX.Element {
  return (
    <g>
      <TransistorBody cx={110} cy={86} r={28} arrow />
      <text x={60} y={80} fontSize={11} fill={C.text} {...FONT}>
        b
      </text>
      <text x={117} y={54} fontSize={11} fill={C.text} {...FONT}>
        c
      </text>
      <text x={117} y={126} fontSize={11} fill={C.text} {...FONT}>
        e
      </text>

      <Port x={30} y={86} label="a" dir="in" />
      <line x1={35} y1={86} x2={82} y2={86} stroke={C.wire} strokeWidth={1.6} />

      {/* 输出 y：集电极 → 上拉电阻 → VCC */}
      <line x1={110} y1={58} x2={300} y2={58} stroke={C.wire} strokeWidth={1.6} />
      <Port x={300} y={58} label="y" dir="out" />
      <Vcc x={160} />
      <line x1={160} y1={16} x2={160} y2={38} stroke={C.wire} strokeWidth={1.6} />
      <Resistor x1={160} y1={38} x2={160} y2={58} label="上拉" />
      <Lamp x={262} y={58} />
      <text x={262} y={44} textAnchor="middle" fontSize={9.5} fill={C.textDim} {...FONT}>
        灯
      </text>

      {/* 发射极 → GND */}
      <line x1={110} y1={114} x2={110} y2={140} stroke={C.wire} strokeWidth={1.6} />
      <Gnd x={110} y={140} />

      {!compact && (
        <>
          <text x={30} y={150} fontSize={10} fill={C.textDim} {...FONT}>
            弱信号源直接接基极；VCC 直连基极要经电阻限流
          </text>
          <Takeaway text="a=1 → 基极通电 → c-e 导通 → 输出被拉低（天生的反相）" />
        </>
      )}
    </g>
  );
}

/** N-MOS 反相开关：栅极 → a；漏极 → y + 上拉电阻；源极 → GND */
function NmosDiagram({ compact }: { compact?: boolean }): React.JSX.Element {
  return (
    <g>
      <TransistorBody cx={110} cy={86} r={28} />
      <text x={58} y={80} fontSize={11} fill={C.text} {...FONT}>
        g
      </text>
      <text x={117} y={54} fontSize={11} fill={C.text} {...FONT}>
        d
      </text>
      <text x={117} y={126} fontSize={11} fill={C.text} {...FONT}>
        s
      </text>

      <Port x={30} y={86} label="a" dir="in" />
      <line x1={35} y1={86} x2={82} y2={86} stroke={C.wire} strokeWidth={1.6} />

      <line x1={110} y1={58} x2={300} y2={58} stroke={C.wire} strokeWidth={1.6} />
      <Port x={300} y={58} label="y" dir="out" />
      <Vcc x={160} />
      <line x1={160} y1={16} x2={160} y2={38} stroke={C.wire} strokeWidth={1.6} />
      <Resistor x1={160} y1={38} x2={160} y2={58} label="上拉" />
      <Lamp x={262} y={58} />
      <text x={262} y={44} textAnchor="middle" fontSize={9.5} fill={C.textDim} {...FONT}>
        灯
      </text>

      <line x1={110} y1={114} x2={110} y2={140} stroke={C.wire} strokeWidth={1.6} />
      <Gnd x={110} y={140} />

      {!compact && (
        <>
          <text x={30} y={150} fontSize={10} fill={C.textDim} {...FONT}>
            电压控制：栅极不取电流，弱信号源直接接栅极毫无压力
          </text>
          <Takeaway text="栅极高电平 → 导通 → 输出被拉低；截止时上拉电阻把 y 钉回 1" />
        </>
      )}
    </g>
  );
}

/** 二极管防倒灌：两节电池各串一个二极管再并到设备（或门） */
function DioDiagram({ compact }: { compact?: boolean }): React.JSX.Element {
  return (
    <g>
      {/* 电池 A 支路 */}
      <Battery x={66} y={58} label="电池 A" />
      <line x1={75} y1={58} x2={92} y2={58} stroke={C.wire} strokeWidth={1.6} />
      <Diode x={92} y={58} />
      <text x={101} y={50} fontSize={9} fill={C.textDim} {...FONT}>
        a→k
      </text>
      <line x1={102} y1={58} x2={138} y2={58} stroke={C.wire} strokeWidth={1.6} />
      <line x1={138} y1={58} x2={138} y2={116} stroke={C.wire} strokeWidth={1.6} />

      {/* 电池 B 支路 */}
      <Battery x={66} y={160} label="电池 B" />
      <line x1={75} y1={160} x2={92} y2={160} stroke={C.wire} strokeWidth={1.6} />
      <Diode x={92} y={160} />
      <line x1={102} y1={160} x2={138} y2={160} stroke={C.wire} strokeWidth={1.6} />
      <line x1={138} y1={160} x2={138} y2={116} stroke={C.wire} strokeWidth={1.6} />

      {/* 汇合 → 电阻 → 设备灯 → GND */}
      <PinDot x={138} y={116} />
      <line x1={138} y1={116} x2={196} y2={116} stroke={C.wire} strokeWidth={1.6} />
      <Resistor x1={196} y1={116} x2={196} y2={148} />
      <line x1={196} y1={148} x2={252} y2={148} stroke={C.wire} strokeWidth={1.6} />
      <Lamp x={280} y={148} />
      <text x={280} y={170} textAnchor="middle" fontSize={10} fill={C.textDim} {...FONT}>
        设备灯
      </text>
      <line x1={280} y1={158} x2={280} y2={176} stroke={C.wire} strokeWidth={1.6} />
      <Gnd x={280} y={176} />

      {!compact && (
        <>
          <text x={30} y={130} fontSize={10} fill={C.weak1} {...FONT}>
            二极管只许电流往外流（阳极朝电池、阴极朝设备）
          </text>
          <Takeaway text="任一节电池有电 → 设备就有电：防倒灌 = 或门" />
        </>
      )}
    </g>
  );
}

/** P-MOS 反着来的开关：源极 → VCC；漏极 → y + 下拉电阻；栅极低电平才导通 */
function PmosDiagram({ compact }: { compact?: boolean }): React.JSX.Element {
  return (
    <g>
      <TransistorBody cx={110} cy={86} r={28} bubble />
      <text x={58} y={80} fontSize={11} fill={C.text} {...FONT}>
        g
      </text>
      <text x={117} y={54} fontSize={11} fill={C.text} {...FONT}>
        s
      </text>
      <text x={117} y={126} fontSize={11} fill={C.text} {...FONT}>
        d
      </text>

      {/* 源极 → VCC */}
      <Vcc x={110} label="VCC" />
      <line x1={110} y1={16} x2={110} y2={58} stroke={C.wire} strokeWidth={1.6} />

      <Port x={30} y={86} label="a" dir="in" />
      <line x1={35} y1={86} x2={82} y2={86} stroke={C.wire} strokeWidth={1.6} />

      {/* 漏极 → y + 下拉电阻 → GND */}
      <line x1={110} y1={114} x2={300} y2={114} stroke={C.wire} strokeWidth={1.6} />
      <Port x={300} y={114} label="y" dir="out" />
      <line x1={210} y1={114} x2={210} y2={138} stroke={C.wire} strokeWidth={1.6} />
      <Resistor x1={210} y1={138} x2={210} y2={162} label="下拉" />
      <line x1={210} y1={162} x2={210} y2={172} stroke={C.wire} strokeWidth={1.6} />
      <Gnd x={210} y={172} />
      <Lamp x={262} y={114} />
      <text x={262} y={100} textAnchor="middle" fontSize={9.5} fill={C.textDim} {...FONT}>
        灯
      </text>

      {!compact && (
        <>
          <text x={30} y={150} fontSize={10} fill={C.textDim} {...FONT}>
            栅极悬空是 CMOS 大忌：没人驱动，电平不确定、受噪声乱跳
          </text>
          <Takeaway text="栅极低电平 → 导通 → 输出被拉到 VCC（和 N-MOS 相反）" />
        </>
      )}
    </g>
  );
}

/** 悬空 vs 上拉 vs 下拉：同一条信号线，没人驱动会乱跳，电阻把它钉住 */
function FloatDiagram({ compact }: { compact?: boolean }): React.JSX.Element {
  return (
    <g>
      {/* 三个状态面板 */}
      <rect
        x={14}
        y={26}
        width={104}
        height={112}
        rx={8}
        fill={C.fill}
        stroke={C.bodyDim}
        strokeWidth={1}
      />
      <text x={66} y={46} textAnchor="middle" fontSize={11} fill={C.text} {...FONT}>
        没人驱动
      </text>
      <text x={66} y={62} textAnchor="middle" fontSize={9.5} fill={C.textDim} {...FONT}>
        （悬空 Z）
      </text>
      <text x={66} y={112} textAnchor="middle" fontSize={10} fill={C.z} {...FONT}>
        电平乱跳、不确定
      </text>

      <rect
        x={118}
        y={26}
        width={104}
        height={112}
        rx={8}
        fill={C.fill}
        stroke={C.bodyDim}
        strokeWidth={1}
      />
      <text x={170} y={46} textAnchor="middle" fontSize={11} fill={C.text} {...FONT}>
        上拉电阻
      </text>
      <text x={170} y={62} textAnchor="middle" fontSize={9.5} fill={C.textDim} {...FONT}>
        接到 VCC
      </text>
      <text x={170} y={112} textAnchor="middle" fontSize={10} fill={C.weak1} {...FONT}>
        默认钉在 1
      </text>

      <rect
        x={222}
        y={26}
        width={104}
        height={112}
        rx={8}
        fill={C.fill}
        stroke={C.bodyDim}
        strokeWidth={1}
      />
      <text x={274} y={46} textAnchor="middle" fontSize={11} fill={C.text} {...FONT}>
        下拉电阻
      </text>
      <text x={274} y={62} textAnchor="middle" fontSize={9.5} fill={C.textDim} {...FONT}>
        接到 GND
      </text>
      <text x={274} y={112} textAnchor="middle" fontSize={10} fill={C.weak0} {...FONT}>
        默认钉在 0
      </text>

      {/* 同一条信号线穿过三个面板，颜色随状态变化 */}
      <line x1={32} y1={88} x2={117} y2={88} stroke={C.z} strokeWidth={2.4} />
      <line x1={118} y1={88} x2={222} y2={88} stroke={C.weak1} strokeWidth={2.4} />
      <line x1={223} y1={88} x2={310} y2={88} stroke={C.weak0} strokeWidth={2.4} />

      {/* 上拉：VCC → 电阻 → 信号线 */}
      <Vcc x={170} label="VCC" />
      <line x1={170} y1={16} x2={170} y2={36} stroke={C.wire} strokeWidth={1.6} />
      <Resistor x1={170} y1={36} x2={170} y2={58} />
      <line x1={170} y1={58} x2={170} y2={88} stroke={C.wire} strokeWidth={1.6} />

      {/* 下拉：信号线 → 电阻 → GND */}
      <line x1={274} y1={88} x2={274} y2={108} stroke={C.wire} strokeWidth={1.6} />
      <Resistor x1={274} y1={108} x2={274} y2={130} />
      <line x1={274} y1={130} x2={274} y2={150} stroke={C.wire} strokeWidth={1.6} />
      <Gnd x={274} y={150} />

      {!compact && <Takeaway text="这一关用上拉：平时默认 1，a 一给电就被三极管拉低（反相）" />}
    </g>
  );
}

/** CMOS 反相器：上 pMOS + 下 nMOS 互补对推挽，无电阻 */
function CmosInvDiagram({ compact }: { compact?: boolean }): React.JSX.Element {
  return (
    <g>
      {/* VCC 轨 */}
      <line x1={70} y1={22} x2={290} y2={22} stroke={C.strong1} strokeWidth={2} />
      <text x={60} y={26} textAnchor="end" fontSize={10} fill={C.strong1} {...FONT}>
        VCC
      </text>

      {/* pMOS（上，源极 → VCC） */}
      <TransistorBody cx={150} cy={52} r={19} bubble />
      <line x1={150} y1={33} x2={150} y2={22} stroke={C.wire} strokeWidth={1.6} />
      <line x1={150} y1={52} x2={150} y2={76} stroke={C.wire} strokeWidth={1.6} />
      <text x={174} y={40} fontSize={10} fill={C.text} {...FONT}>
        pMOS
      </text>

      {/* 输出 y */}
      <line x1={150} y1={76} x2={300} y2={76} stroke={C.wire} strokeWidth={1.6} />
      <Port x={300} y={76} label="y" dir="out" />

      {/* nMOS（下，源极 → GND） */}
      <TransistorBody cx={150} cy={128} r={19} />
      <line x1={150} y1={109} x2={150} y2={76} stroke={C.wire} strokeWidth={1.6} />
      <line x1={150} y1={128} x2={150} y2={160} stroke={C.wire} strokeWidth={1.6} />
      <line x1={150} y1={160} x2={150} y2={168} stroke={C.wire} strokeWidth={1.6} />
      <Gnd x={150} y={168} />
      <text x={174} y={134} fontSize={10} fill={C.text} {...FONT}>
        nMOS
      </text>

      {/* 输入 a 接两个栅极 */}
      <Port x={30} y={90} label="a" dir="in" />
      <line x1={35} y1={90} x2={70} y2={90} stroke={C.wire} strokeWidth={1.6} />
      <line x1={70} y1={90} x2={70} y2={52} stroke={C.wire} strokeWidth={1.6} />
      <line x1={70} y1={52} x2={131} y2={52} stroke={C.wire} strokeWidth={1.6} />
      <line x1={70} y1={90} x2={70} y2={128} stroke={C.wire} strokeWidth={1.6} />
      <line x1={70} y1={128} x2={131} y2={128} stroke={C.wire} strokeWidth={1.6} />

      {!compact && (
        <Takeaway text="互补对推挽：a=0 → p 导通 y 强 1；a=1 → n 导通 y 强 0（无电阻）" />
      )}
    </g>
  );
}

/** CMOS 与非门：上 pMOS 并联、下 nMOS 串联 */
function CmosNandDiagram({ compact }: { compact?: boolean }): React.JSX.Element {
  return (
    <g>
      <line x1={80} y1={20} x2={250} y2={20} stroke={C.strong1} strokeWidth={2} />
      <text x={70} y={24} textAnchor="end" fontSize={10} fill={C.strong1} {...FONT}>
        VCC
      </text>

      {/* P1（栅 a，左上）：源极 → VCC */}
      <TransistorBody cx={120} cy={48} r={17} bubble />
      <line x1={120} y1={31} x2={120} y2={20} stroke={C.wire} strokeWidth={1.6} />
      <line x1={120} y1={48} x2={120} y2={70} stroke={C.wire} strokeWidth={1.6} />

      {/* P2（栅 b，右上）：源极 → VCC，漏极并到 y */}
      <TransistorBody cx={230} cy={48} r={17} bubble mirror />
      <line x1={230} y1={31} x2={230} y2={20} stroke={C.wire} strokeWidth={1.6} />
      <line x1={230} y1={48} x2={230} y2={70} stroke={C.wire} strokeWidth={1.6} />

      {/* y 线（上管漏极并联汇合点） */}
      <line x1={120} y1={70} x2={300} y2={70} stroke={C.wire} strokeWidth={1.6} />
      <Port x={300} y={70} label="y" dir="out" />

      {/* N1（栅 a，左下）：漏极接 y，源极接串联线 */}
      <TransistorBody cx={120} cy={136} r={17} />
      <line x1={120} y1={119} x2={120} y2={70} stroke={C.wire} strokeWidth={1.6} />
      <line x1={120} y1={136} x2={120} y2={160} stroke={C.wire} strokeWidth={1.6} />

      {/* 串联线（N1 源极 → N2 漏极） */}
      <line x1={120} y1={160} x2={230} y2={160} stroke={C.wire} strokeWidth={1.6} />

      {/* N2（栅 b，右下）：漏极接串联线，源极 → GND */}
      <TransistorBody cx={230} cy={175} r={17} mirror />
      <line x1={230} y1={175} x2={230} y2={160} stroke={C.wire} strokeWidth={1.6} />
      <line x1={230} y1={175} x2={230} y2={190} stroke={C.wire} strokeWidth={1.6} />
      <Gnd x={230} y={190} />

      {/* 输入 a：P1 栅 + N1 栅 */}
      <Port x={30} y={48} label="a" dir="in" />
      <line x1={35} y1={48} x2={74} y2={48} stroke={C.wire} strokeWidth={1.6} />
      <line x1={74} y1={48} x2={103} y2={48} stroke={C.wire} strokeWidth={1.6} />
      <line x1={74} y1={48} x2={74} y2={136} stroke={C.wire} strokeWidth={1.6} />
      <line x1={74} y1={136} x2={103} y2={136} stroke={C.wire} strokeWidth={1.6} />

      {/* 输入 b：P2 栅 + N2 栅 */}
      <Port x={300} y={175} label="b" dir="in" />
      <line x1={295} y1={175} x2={270} y2={175} stroke={C.wire} strokeWidth={1.6} />
      <line x1={270} y1={175} x2={247} y2={175} stroke={C.wire} strokeWidth={1.6} />
      <line x1={270} y1={175} x2={270} y2={48} stroke={C.wire} strokeWidth={1.6} />
      <line x1={270} y1={48} x2={247} y2={48} stroke={C.wire} strokeWidth={1.6} />

      {!compact && (
        <Takeaway text="上 pMOS 并联（任一 0 拉高）· 下 nMOS 串联（全 1 才拉低）= 与非" x={24} />
      )}
    </g>
  );
}

/** 图类型 → 画图函数 */
const DIAGRAMS: Record<DiagramKey, (p: { compact?: boolean }) => React.JSX.Element> = {
  npn: (p) => NpnDiagram(p),
  nmos: (p) => NmosDiagram(p),
  dio: (p) => DioDiagram(p),
  pmos: (p) => PmosDiagram(p),
  float: (p) => FloatDiagram(p),
  'cmos-inv': (p) => CmosInvDiagram(p),
  'cmos-nand': (p) => CmosNandDiagram(p),
};

export function ComponentDiagram({
  level,
  family,
  compact = false,
}: ComponentDiagramProps): React.JSX.Element {
  const key = diagramKeyFor(level, family);
  const title = level.classroom?.title ?? level.title;
  const Draw = DIAGRAMS[key];
  return (
    <svg
      viewBox="0 0 340 200"
      role="img"
      aria-label={`${title}示意图`}
      className="component-diagram"
    >
      <rect
        x={1}
        y={1}
        width={338}
        height={198}
        rx={10}
        fill={C.bg}
        stroke={C.bodyDim}
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      {Draw({ compact })}
    </svg>
  );
}
