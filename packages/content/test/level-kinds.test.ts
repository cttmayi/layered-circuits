/**
 * 关卡素材约束在判定侧的落地自检。
 *
 * 成本挑战关 / 复古复用关 / 时序挑战关（GDD 4.2 / 4.3 / 4.4）对应的关卡
 * （s2-dff-cost / s1-xor-retro / s2-dff-fast）已下架，判定侧相关分支保留但无实例。
 */

import { judgeDesign } from '@lc/compiler';
import { InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { findLevel } from '../src/levels.js';

const level = (id: string) => {
  const found = findLevel(id);
  if (!found) throw new Error(`缺少关卡 ${id}`);
  return found;
};

describe('素材约束（allowedUnits）', () => {
  it('关卡只发三极管和电阻时，用二极管会被判错', () => {
    const xor = level('s1-xor');
    expect(xor.allowedUnits).toEqual(['npn', 'res']);
    const reference = xor.referenceSolution!;
    const withDiode = {
      ...reference,
      instances: [
        ...reference.instances,
        {
          kind: 'unit' as const,
          id: 'd1',
          unit: 'dio' as const,
          pins: {},
          label: '偷偷加的二极管',
        },
      ],
    };
    const result = judgeDesign(withDiode, xor, { library: new InMemoryModuleLibrary() });
    expect(result.pass).toBe(false);
    expect(result.errors.join('；')).toContain('本关不提供');
  });
});
