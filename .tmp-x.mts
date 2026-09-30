import { findLevel } from './packages/content/src/levels.ts';
import { searchAlternatives, sourcesOf } from './tools/opt-solver/src/search.ts';
import { buildCatalog, targetMaskOf } from './tools/opt-solver/src/solver.ts';
import { fragmentsFor } from './tools/opt-solver/src/fragments.ts';
import { verifyPlan } from './tools/opt-solver/src/emit.ts';
import { InMemoryModuleLibrary } from './packages/schema/src/index.ts';
const lib = new InMemoryModuleLibrary();
const l = findLevel('s1-xnor')!;
const target = targetMaskOf(l)!;
const gates = buildCatalog(lib, { modules: false, fragments: fragmentsFor(l) });
console.log('gates size:', gates.size);
const plans = searchAlternatives(gates, target, { limit: 6, sources: sourcesOf(l) });
console.log('plans:', plans.length);
const ins = ['a','b'], out = 'y';
for (const p of plans) {
  const v = verifyPlan(p, l, lib, { inputNames: ins, outputName: out });
  console.log('plan costHalf=' + v.costHalf, 'pass=' + v.pass, 'errs=' + JSON.stringify(v.errors.slice(0,2)));
}
