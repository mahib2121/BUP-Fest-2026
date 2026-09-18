/**
 * Runs every public sample against a running API and replays the plan against the
 * GROUND-TRUTH directives (like the judge).   npm run test:samples -- http://localhost:8000
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { replay } from '../src/energy/replay';

const BASE = process.argv[2] ?? 'http://localhost:8000';
const cases = JSON.parse(readFileSync(join(__dirname, '..', '..', 'test', 'public_samples.json'), 'utf8')).cases;

const same = (a: any, b: any) => {
  if (a.directive_type !== b.directive_type || a.applies !== b.applies) return false;
  const x = a.structured_adjustment, y = b.structured_adjustment;
  if (!x || !y) return x === y;
  return Object.keys(x).length === Object.keys(y).length &&
    Object.keys(y).every((k) => (k === 'hours' ? JSON.stringify(x[k]) === JSON.stringify(y[k]) : Math.abs(x[k] - y[k]) <= 0.01));
};

(async () => {
  let all = true;
  for (const c of cases) {
    const exp = c.expected_output;
    const t0 = Date.now();
    const r = await fetch(`${BASE}/optimize-energy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c.input) });
    const out: any = await r.json();
    const ms = Date.now() - t0;
    const interpOk = out.directive_interpretation?.length === exp.directive_interpretation.length &&
      out.directive_interpretation.every((d: any, i: number) => same(d, exp.directive_interpretation[i]));
    const viol = replay(out.hourly_plan, c.input.hours, c.input.battery, exp.directive_interpretation);
    const costOk = out.total_cost_bdt <= exp.total_cost_bdt + 0.01;
    const ok = r.status === 200 && interpOk && !viol.length && costOk;
    all &&= ok;
    console.log(`${c.id}: ${ok ? 'PASS' : 'FAIL'} | interp=${interpOk} violations=${viol.length} cost=${out.total_cost_bdt} ref=${exp.total_cost_bdt} ${ms}ms`);
    if (!interpOk) console.log('   got:', JSON.stringify(out.directive_interpretation));
  }
  console.log(all ? 'ALL PASS' : 'SOME FAILED');
  process.exit(all ? 0 : 1);
})();
