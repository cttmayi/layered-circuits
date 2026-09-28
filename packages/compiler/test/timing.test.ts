import { InMemoryModuleLibrary } from '@lc/schema';
import { describe, expect, it } from 'vitest';
import { compileDesign } from '../src/flatten.js';
import { analyzeTiming, maxClockHz } from '../src/timing.js';
import { designToModulePorts, wrapModule } from '../src/wrap.js';
import { bufferDesign, notGateDesign, srLatchDesign } from './helpers/designs.js';

function compileNot() {
  return compileDesign(notGateDesign(), { library: new InMemoryModuleLibrary() }).net;
}

describe('时序分析（用同一套时序仿真实测最长传播延迟）', () => {
  it('非门关键路径 = 0.5ns(电阻) + 1.0ns + 1.0ns(两级三极管) = 2.5ns', () => {
    const timing = analyzeTiming(compileNot());
    expect(timing.portDelayPs.out).toBe(2500);
    expect(timing.criticalPathPs).toBe(2500);
    expect(timing.isSequential).toBe(false);
    expect(timing.uncertain).toBe(false);
  });

  it('两个非门串联（模块复用）= 5ns', () => {
    const library = new InMemoryModuleLibrary();
    const { template: notModule } = wrapModule(
      {
        name: '非门',
        stage: 1,
        kind: 'logic',
        ports: designToModulePorts(notGateDesign()),
        body: notGateDesign(),
      },
      library,
    );
    library.add(notModule);
    const { net } = compileDesign(bufferDesign(notModule.hash), { library });
    const timing = analyzeTiming(net);
    expect(timing.portDelayPs.out).toBe(5000);
  });

  it('SR 锁存器被行为判定为时序电路', () => {
    const body = srLatchDesign();
    const { net } = compileDesign(body, { library: new InMemoryModuleLibrary() });
    const timing = analyzeTiming(net);
    expect(timing.isSequential).toBe(true);
  });

  it('由关键路径推算最高时钟频率', () => {
    expect(maxClockHz(2500)).toBeCloseTo(4e8, 5);
    expect(maxClockHz(0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('封装模块时把延迟矩阵与是否时序电路写进模板', () => {
    const library = new InMemoryModuleLibrary();
    const { template } = wrapModule(
      {
        name: '非门',
        stage: 1,
        kind: 'logic',
        ports: designToModulePorts(notGateDesign()),
        body: notGateDesign(),
      },
      library,
    );
    expect(template.delayPs.out).toBe(2500);
    expect(template.criticalPathPs).toBe(2500);
    expect(template.isSequential).toBe(false);
  });
});
