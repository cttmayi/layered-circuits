/**
 * 临时预览：把 ComponentDiagram 的 7 张图渲染成 SVG + HTML（.tmp-diag/），
 * 供截图核验布局。LC_DIAG_PREVIEW=1 时运行（与 LC_WAVE_PREVIEW 同模式）。
 */
// @vitest-environment node

import { mkdirSync, writeFileSync } from 'node:fs';
import { TEACH_LEVELS } from '@lc/content';
import { levelViewOf } from '@lc/schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComponentDiagram, diagramKeyFor } from '../src/panels/ComponentDiagram';

function view(levelId: string, family: 'rtl' | 'cmos') {
  const level = TEACH_LEVELS.find((l) => l.id === levelId);
  if (!level) throw new Error(`缺教学关 ${levelId}`);
  return levelViewOf(level, family);
}

describe('元件课堂示意图预览', () => {
  it('写出全部 7 张图（LC_DIAG_PREVIEW=1 时）', () => {
    if (!process.env.LC_DIAG_PREVIEW) return;
    mkdirSync('.tmp-diag', { recursive: true });
    const cases: Array<[string, string, 'rtl' | 'cmos']> = [
      ['s1-npn', 'npn-rtl', 'rtl'],
      ['s1-npn', 'nmos-cmos', 'cmos'],
      ['s1-dio', 'dio-dtl', 'rtl'],
      ['s1-dio', 'pmos-cmos', 'cmos'],
      ['s1-float', 'float-rtl', 'rtl'],
      ['s1-float', 'cmos-inv-cmos', 'cmos'],
      ['s1-cmos-inv', 'cmos-inv', 'cmos'],
      ['s1-cmos-nand', 'cmos-nand', 'cmos'],
    ];
    for (const [levelId, name, family] of cases) {
      const lv = view(levelId, family);
      const svg = renderToStaticMarkup(<ComponentDiagram level={lv} family={family} />);
      const svgCompact = renderToStaticMarkup(
        <ComponentDiagram level={lv} family={family} compact />,
      );
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        body{margin:0;background:#0e1319;color:#c9d6e4;font-family:system-ui,sans-serif}
        .row{display:flex;gap:12px;align-items:flex-start;padding:12px}
        .cell{display:flex;flex-direction:column;gap:6px}
        .lbl{font-size:11px;color:#71839a;padding:0 4px}
      </style></head><body>
      <div class="row"><div class="cell"><div class="lbl">${name} 完整</div>${svg}</div>
      <div class="cell"><div class="lbl">${name} 缩略</div>${svgCompact}</div></div>
      </body></html>`;
      writeFileSync(`.tmp-diag/${name}.svg`, svg);
      writeFileSync(`.tmp-diag/${name}.html`, html);
    }
    expect(cases.length).toBe(8);
  });

  it('diagramKeyFor 按契约分派正确', () => {
    expect(diagramKeyFor(view('s1-npn', 'rtl'), 'rtl')).toBe('npn');
    expect(diagramKeyFor(view('s1-npn', 'cmos'), 'cmos')).toBe('nmos');
    expect(diagramKeyFor(view('s1-dio', 'rtl'), 'rtl')).toBe('dio');
    expect(diagramKeyFor(view('s1-dio', 'cmos'), 'cmos')).toBe('pmos');
    expect(diagramKeyFor(view('s1-float', 'rtl'), 'rtl')).toBe('float');
    expect(diagramKeyFor(view('s1-float', 'cmos'), 'cmos')).toBe('cmos-inv');
    expect(diagramKeyFor(view('s1-cmos-inv', 'cmos'), 'cmos')).toBe('cmos-inv');
    expect(diagramKeyFor(view('s1-cmos-nand', 'cmos'), 'cmos')).toBe('cmos-nand');
  });
});
