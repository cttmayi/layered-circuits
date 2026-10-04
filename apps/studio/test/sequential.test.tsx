/**
 * M2 时序界面自检：波形面板与「本关校验」里的时序读数。
 *
 * 数据不是造出来的：直接拿阶段 2 的 D 触发器关卡参考解跑一遍真判定，
 * 用真实的判定结果渲染组件 —— 面板上看到的就是判定用的那份波形。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { type JudgeResult, judgeDesign } from '@lc/compiler';
import { ALL_LEVELS } from '@lc/content';
import { InMemoryModuleLibrary } from '@lc/schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JudgePanel } from '../src/panels/JudgePanel';
import { LevelCard } from '../src/panels/LevelCard';
import { WaveformPanel } from '../src/panels/WaveformPanel';

const dffLevel = ALL_LEVELS.find((l) => l.id === 's2-dff');
if (!dffLevel) throw new Error('缺少 D 触发器关卡');

function judgeDff(): JudgeResult {
  const design = dffLevel?.referenceSolution;
  if (!design) throw new Error('缺少参考解');
  return judgeDesign(design, dffLevel, {
    library: new InMemoryModuleLibrary(),
    hardcore: true,
  });
}

const PORT_NAMES = ['d', 'clk', 'q', 'qn'];

describe('时序关卡的向量说明列', () => {
  // 时序关的向量表会出现「同一组输入、输出却不同」的行（保持上一次）。没有说明列
  // 这张表就是自相矛盾的：sn=rn=1 出现两次，一次 q=1 一次 q=0。
  const srLevel = ALL_LEVELS.find((l) => l.id === 's2-sr-latch');
  if (!srLevel) throw new Error('缺少 SR 锁存器关卡');

  it('任务卡正面用大白话讲清规则，不出现低有效/置位/复位这些行话（行话在教学说明里）', () => {
    const html = renderToStaticMarkup(<LevelCard level={srLevel} costHalf={0} />);
    expect(html).toContain('一个会记忆的开关');
    expect(html).toContain('sn 和 rn 地位一样');
    expect(html).toContain('都为 1 时 q 保持不动');
    expect(html).toContain('都为 0 时没有正确答案');
    expect(html).toContain('qn 是 q 的反相');
    for (const jargon of ['低有效', '置位', '复位', '互补', '拉低']) {
      expect(html).not.toContain(jargon);
    }
  });

  it('判定结果每一行带上关卡说明（判定表里也能看懂「保持」）', () => {
    const design = srLevel.referenceSolution;
    if (!design) throw new Error('缺少参考解');
    const result = judgeDesign(design, srLevel, {
      library: new InMemoryModuleLibrary(),
      hardcore: true,
    });
    expect(result.pass).toBe(true);
    expect(result.rows.map((r) => r.note)).toEqual([
      '置位：sn 拉低 → q=1',
      '保持：沿用上一次的 q=1',
      '复位：rn 拉低 → q=0',
      '保持：沿用上一次的 q=0',
    ]);
    const html = renderToStaticMarkup(
      <JudgePanel level={srLevel} result={result} record={undefined} attempts={1} />,
    );
    expect(html).toContain('说明');
    expect(html).toContain('保持：沿用上一次的 q=1');
  });

  it('没有写说明的关卡不出现多余的列（非门真值表仍是两列）', () => {
    const notLevel = ALL_LEVELS.find((l) => l.id === 's1-not');
    if (!notLevel) throw new Error('缺少非门关卡');
    const html = renderToStaticMarkup(<LevelCard level={notLevel} costHalf={0} />);
    expect(html).not.toContain('说明');
  });
});

describe('波形面板', () => {
  it('把 D 触发器的端口波形画成阶梯线，并标出每个向量的施加时刻', () => {
    const result = judgeDff();
    const html = renderToStaticMarkup(
      <WaveformPanel
        waveform={result.waveform ?? null}
        portNames={PORT_NAMES}
        marks={result.rows.map((r) => ({ label: `#${r.index + 1}`, atPs: r.window.fromPs }))}
      />,
    );
    expect(html).toContain('<svg');
    expect(html).toContain('class="vline"');
    // 四个端口都有标签
    for (const name of PORT_NAMES) expect(html).toContain(`>${name}</text>`);
    // 时钟是强驱动、数据来自输入引脚 → 至少各有一条实线/虚线电平线
    expect(html).toContain('class="strong"');
    expect(html).toContain('class="weak"');
  });

  it('波形里能看到「时钟高电平期间数据变化、输出不动」（无空翻）的证据', () => {
    const result = judgeDff();
    const wave = result.waveform;
    if (!wave) throw new Error('判定结果里应当带波形');
    const q = wave.nets.find((n) => n.port?.name === 'q');
    expect(q).toBeDefined();
    // 第 4 个向量（clk=1, d=0）窗口内 q 不应有任何跳变
    const row = result.rows[4];
    if (!row) throw new Error('缺少第 5 个向量');
    const steps = (q?.steps ?? []).filter(
      (s) => s.timePs > row.window.fromPs && s.timePs <= row.window.toPs,
    );
    expect(steps.length).toBe(0);
    expect(row.glitches).toBe(0);
  });

  it('没有波形时给出提示而不是空白', () => {
    const html = renderToStaticMarkup(<WaveformPanel waveform={null} portNames={PORT_NAMES} />);
    expect(html).toContain('先运行一次校验');
  });

  it('校验面板显示跳变次数、空翻结论与建立/保持时间', () => {
    const result = judgeDff();
    const html = renderToStaticMarkup(
      <JudgePanel level={dffLevel} result={result} record={undefined} attempts={1} />,
    );
    expect(html).toContain('空翻/毛刺');
    expect(html).toContain('无空翻');
    expect(html).toContain('建立/保持');
    expect(html).toContain('含记忆（时序电路）');
    expect(html).toContain('20MHz 下还有余量');
  });

  it('生成一份可视化预览（LC_WAVE_PREVIEW=1 时写到 .tmp-wave/，用于人工核对）', () => {
    if (!process.env.LC_WAVE_PREVIEW) return;
    const result = judgeDff();
    const body = renderToStaticMarkup(
      <>
        <h1 style={{ font: '600 15px system-ui' }}>D 触发器：端口波形与判定读数</h1>
        <WaveformPanel
          waveform={result.waveform ?? null}
          portNames={PORT_NAMES}
          marks={result.rows.map((r) => ({ label: `#${r.index + 1}`, atPs: r.window.fromPs }))}
        />
        <JudgePanel level={dffLevel} result={result} record={undefined} attempts={3} />
      </>,
    );
    mkdirSync('.tmp-wave', { recursive: true });
    writeFileSync(
      '.tmp-wave/preview.html',
      `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
      body{background:#131820;color:#dfe7ef;font:13px/1.6 system-ui;margin:16px;width:560px}
      .wave-svg{background:#0e1319;border:1px solid #263242;border-radius:4px}
      .wave-svg .vline{stroke:#2a3644;stroke-dasharray:2 3}
      .wave-svg .strong{stroke:#58d68d;stroke-width:2}
      .wave-svg .weak{stroke:#2f7d55;stroke-width:2;stroke-dasharray:4 2}
      .wave-svg .unknown{stroke:#b99530;stroke-width:2;stroke-dasharray:1 3}
      .wave-svg .wlabel{fill:#9fb0c3;font-size:11px}
      .diags{padding-left:16px;font-size:11.5px;list-style:none}
      .diags li.info{color:#8fa0b3}
      .verdict{font-weight:600}
      .verdict.pass{color:#58d68d}
      table.kv td{padding:2px 8px 2px 0;font-size:12px}
      table.kv td:first-child{color:#93a4b8}
      table.truth{border-collapse:collapse;font-size:12px;margin-top:6px}
      table.truth td,table.truth th{border:1px solid #263242;padding:2px 6px;text-align:center}
      .hi{color:#58d68d}.bad{color:#ff6b60}.dim{color:#7d8ea3}
      </style></head><body>${body}</body></html>`,
    );
    expect(true).toBe(true);
  });
});
