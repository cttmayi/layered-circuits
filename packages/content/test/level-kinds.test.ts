/**
 * 关卡素材约束在判定侧的落地自检。
 *
 * 成本挑战关 / 复古复用关 / 时序挑战关（GDD 4.2 / 4.3 / 4.4）对应的关卡
 * （s2-dff-cost / s1-xor-retro / s2-dff-fast）已下架，判定侧相关分支保留但无实例。
 */

import { judgeDesign } from '@lc/compiler';
import { InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { ALL_LEVELS, findLevel } from '../src/levels.js';

const level = (id: string) => {
  const found = findLevel(id);
  if (!found) throw new Error(`缺少关卡 ${id}`);
  return found;
};

describe('积木约束（moduleAccess）', () => {
  it('任务关不锁积木：白名单只留给真正的「指定积木」关（复古复用关）', () => {
    // 用户定稿：关卡不该限制玩家用哪个积木——「用什么搭」本身也是解题的一部分。
    // 只有考点就是「手搭元件」（'none'）或「只许用早期版本」（复古关 + bannedModules）
    // 的关卡才收窄。普通任务关一旦出现白名单，玩家会发现自己刚封装的模块被锁住。
    const locked = ALL_LEVELS.filter((l) => l.moduleAccess === 'listed');
    expect(locked.map((l) => l.id)).toEqual([]);
    // 该机制本身保留（复古关要用），所以这里只断言「现状没有普通关在用」
    expect(ALL_LEVELS.some((l) => l.kind === 'retro')).toBe(false);
  });
});

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
