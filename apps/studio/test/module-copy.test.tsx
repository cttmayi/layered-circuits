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
import { handleRequest } from '../src/sim/handle';

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

describe('模块详情：自测', () => {
  it('标准非门：列出真值表并说「输出会随输入变化」', () => {
    const library = storedModules();
    render(
      <ModuleDetailModal
        module={library.find((m) => m.name === '非门')!}
        library={library}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('自测（把它当电路跑一遍）')).toBeTruthy();
    expect(screen.getByText('a=0')).toBeTruthy();
    expect(screen.getByText('y → 1·弱')).toBeTruthy();
    expect(screen.getByText('输出会随输入变化，看起来是活的 ✓')).toBeTruthy();
  });

  it('坏模块（输出脚没接到东西上）：点名「一直没动」', () => {
    const library = storedModules();
    const wrapped = handleRequest({
      id: 1,
      type: 'wrap',
      library: [],
      name: '坏非门',
      stage: 1,
      design: {
        schemaVersion: 1,
        id: 'bad-not',
        name: '坏非门',
        instances: [{ kind: 'unit', id: 'r1', unit: 'res' }],
        nets: [
          { id: 'n1', pins: [{ inst: 'r1', pin: 'a', bit: 0 }] },
          { id: 'n2', pins: [] },
        ],
        ports: [
          { id: 'a', name: 'a', dir: 'in', width: 1, nets: ['n1'] },
          { id: 'y', name: 'y', dir: 'out', width: 1, nets: ['n2'] },
        ],
      },
    }).wrapped!;
    const bad: StoredModule = {
      hash: wrapped.hash,
      name: wrapped.name,
      version: (wrapped.template as { version: string }).version,
      stage: 1,
      costHalf: wrapped.costHalf,
      isSequential: wrapped.isSequential,
      ports: wrapped.ports,
      template: wrapped.template as StoredModule['template'],
      sources: [],
      createdAt: 0,
    };
    render(<ModuleDetailModal module={bad} library={[...library, bad]} onClose={() => {}} />);
    expect(screen.getByText(/y 在输入变化时一直没动/)).toBeTruthy();
  });
});

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
