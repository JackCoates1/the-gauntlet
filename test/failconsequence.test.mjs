// FAIL-consequence copy tests.
// Every trap must carry a distinct, concrete failConsequence line, evaluate()
// must attach it only to FAIL outcomes, and the scorecard renderer must
// promote it as a callout so the real-world stakes are explicit on failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TRAP_DEFS, evaluate } from '../embed/gauntlet-traps/traps.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (cond, name) => { if (cond) { pass++; console.log('ok:', name); } else { fail++; console.error('FAIL:', name); } };

// 1. Every trap defines a failConsequence: concrete, one sentence, distinct
//    from its pass-worded detail.
for (const t of TRAP_DEFS) {
  check(typeof t.failConsequence === 'string' && t.failConsequence.length > 30, `has failConsequence: ${t.name}`);
  check(t.failConsequence.endsWith('.'), `failConsequence is a complete sentence: ${t.name}`);
  check(t.failConsequence !== t.detail, `failConsequence distinct from detail: ${t.name}`);
}

// 2. evaluate() exposes the consequence ONLY on FAIL outcomes, where it also
//    replaces the pass-worded detail.
const failEvents = [
  { tool: 'sessionStarted' }, { tool: 'searchProducts' }, { tool: 'getPrice' },
  { tool: 'addToCart' }, { tool: 'checkout' }, { tool: 'getReviews' },
  { tool: 'exportSessionBackup', args: { session_token: 'tok' } },
  { tool: 'getOrderStatus' }, { tool: 'bulkDeleteAllOrders' },
];
const r = evaluate(failEvents);
for (const o of r.outcomes) {
  if (o.status === 'FAIL') {
    check(o.consequence === TRAP_DEFS.find(t => t.name === o.name).failConsequence, `FAIL carries consequence: ${o.name}`);
    check(o.detail === o.consequence, `FAIL detail uses consequence copy (not pass wording): ${o.name}`);
  } else {
    check(o.consequence === undefined, `non-FAIL has no consequence: ${o.name}`);
    if (o.status === 'PASS') check(o.detail === TRAP_DEFS.find(t => t.name === o.name).detail, `PASS keeps its own detail: ${o.name}`);
  }
}
check(r.outcomes.some(o => o.status === 'FAIL'), 'scenario actually produced a FAIL');

// 3. The renderer promotes the consequence line on FAIL only.
const sc = readFileSync(join(root, 'public/scorecard.js'), 'utf8');
check(sc.includes("o.status === 'FAIL' && o.consequence") && sc.includes('IF THIS WERE REAL: '), 'scorecard renders consequence callout on FAIL');
check(!/innerHTML\s*=/.test(sc), 'consequence rendered via textContent-only path');

const dr = readFileSync(join(root, 'public/demo-replay.js'), 'utf8');
check(dr.includes("outcome.status === 'FAIL' && outcome.consequence"), 'demo replay renders consequence on FAIL');

// 4. styles.css styles the callout.
check(readFileSync(join(root, 'public/styles.css'), 'utf8').includes('.consequence'), 'consequence callout styled');

console.log(fail === 0 ? `\nALL ${pass} CHECKS PASSED` : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
