// @vitest-environment jsdom
import { teachingModulesFor } from '@lc/content';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StoredModule } from '../src/editor/model';
import { ModuleDetailModal } from '../src/panels/ModuleDetailModal';

function storedOf(tpl: ReturnType<typeof teachingModulesFor>[number]): StoredModule {
  return {
    hash: tpl.hash,
    name: tpl.name,
    version: tpl.version,
    stage: tpl.stage,
    costHalf: tpl.costHalf,
    isSequential: tpl.isSequential,
    ports: tpl.ports,
    template: tpl,
    sources: [],
    createdAt: 0,
  };
}

describe('ModuleDetailModal（双击模块展开的弹窗）', () => {
  it('渲染元信息 / 内部电路 / 成本明细', () => {
    const nand = teachingModulesFor('rtl').find((m) => m.name === '与非门');
    expect(nand).toBeDefined();
    const stored = storedOf(nand as NonNullable<typeof nand>);
    render(<ModuleDetailModal module={stored} library={[stored]} onClose={() => {}} />);

    expect(screen.getByText('与非门 · 模块详情')).toBeTruthy();
    expect(screen.getByText('内容哈希')).toBeTruthy();
    expect(screen.getByText('内部电路', { exact: false })).toBeTruthy();
    expect(screen.getByText('成本明细', { exact: false })).toBeTruthy();
    // 成本行：10 元（20 半单位）
    expect(screen.getByText(/元（.*半单位）/)).toBeTruthy();
  });
});
