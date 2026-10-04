// @vitest-environment jsdom
/**
 * 模块详情弹窗的「复制模块 JSON」：模块内部有问题时（画布导出只带哈希、不带模块本体），
 * 玩家能把整份模块贴出来离线复现。
 */
import { teachingModulesFor } from '@lc/content';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StoredModule } from '../src/editor/model';
import { ModuleDetailModal } from '../src/panels/ModuleDetailModal';

function storedModules(): StoredModule[] {
  return teachingModulesFor('rtl').map((m) => ({
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
}

describe('模块详情：复制模块 JSON', () => {
  it('点了按钮就把整份模块写进剪贴板', async () => {
    const library = storedModules();
    const notMod = library.find((m) => m.name === '非门')!;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ModuleDetailModal module={notMod} library={library} onClose={() => {}} />);
    // 端口一览（含方向）是排查「模块接反/内部不对」的第一手信息
    expect(screen.getByText(/y\(出\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '复制模块 JSON' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '已复制 ✓' })).toBeTruthy());
    expect(writeText).toHaveBeenCalledTimes(1);
    const pasted = JSON.parse(writeText.mock.calls[0][0] as string) as StoredModule;
    expect(pasted.hash).toBe(notMod.hash);
    expect(pasted.template?.ports.map((p) => `${p.name}:${p.dir}`)).toEqual(['a:in', 'y:out']);
  });
});
