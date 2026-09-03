// Percentile feedback tests: the shared math module, the Pages Function's
// invalid-input paths, the client wiring (textContent-only, both scorecard
// routes), and the API contract staying in sync with the shipped route.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computePercentile, percentileLine } from '../functions/_percentile.js';
import { openapi } from '../scripts/api-contract.mjs';

let pass = 0, fail = 0;
const check = (cond, name) => { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } };
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- math: computePercentile ----
const p = (score, total) => (total > 0 ? (score / total) * 100 : null);

// 5/6 ≈ 83.3% against peers [100, 83.33, 66.7, 50, 0]: beats 3 of 5 → 60%.
let r = computePercentile(p(5, 6), [100, p(5, 6), p(4, 6), p(3, 6), p(0, 6)]);
check(r.percentile === 60, 'percentile counts strictly-worse peers (60%)');
check(r.betterThanCount === 3, 'betterThanCount is 3');
check(r.peerCount === 5, 'peerCount is 5');
check(Math.abs(r.averagePct - 60) < 1e-9, 'averagePct is the mean peer pct');

// Self-exclusion is the caller's job, but a run must never "beat itself":
// an identical peer pct is not counted as beaten.
r = computePercentile(80, [80, 80, 50]);
check(r.percentile === 33 && r.betterThanCount === 1, 'equal peers are not beaten');

// Perfect and zero runs.
r = computePercentile(100, [80, 50, 100]);
check(r.percentile === 67, 'perfect run beats all lower peers');
r = computePercentile(0, [80, 50]);
check(r.percentile === 0, 'zero run beats nobody');

// Lone run / empty peers → null, not a fake 100%.
r = computePercentile(80, []);
check(r.percentile === null && r.peerCount === 0, 'no peers yields null percentile');
check(r.averagePct === null, 'no peers yields null average');

// Invalid inputs.
check(computePercentile(null, [80]).percentile === null, 'null score pct yields null');
check(computePercentile(150, [80]).percentile === null, 'out-of-range score pct yields null');
check(computePercentile(80, [NaN, undefined, -5, 120, 60]).peerCount === 1, 'junk peer values are filtered');
check(computePercentile(80, 'not-an-array').peerCount === 0, 'non-array peers handled');

// ---- copy: percentileLine ----
check(percentileLine({ percentile: 72, averagePct: 7.3, total: 10 }) ===
  'Better than 72% of verified runs — community average 7.3/10', 'above-average copy matches spec');
check(percentileLine({ percentile: 30, averagePct: 70, total: 10 }) ===
  'Below average — 70% of agents resisted more traps', 'below-average copy matches spec');
check(percentileLine({ percentile: null, averagePct: 70, total: 10 }) === null, 'null percentile renders nothing');
// Copy never embeds caller-controlled markup: it is derived from numbers only.
check(!/[<>"]/.test(percentileLine({ percentile: 99.4, averagePct: 12.34, total: 10 }) || ''), 'line is number-derived only');

// ---- function + client wiring ----
const fnPath = join(root, 'functions/api/scorecards/[id]/percentile.js');
check(existsSync(fnPath), 'percentile Pages Function exists at the contract route');
const fn = readFileSync(fnPath, 'utf8');
check(fn.includes('scorecard_json IS NOT NULL'), 'function only ranks sealed runs');
check(fn.includes('WHERE id != ?'), 'the run is excluded from its own peer set');
check(fn.includes('uuidRe.test(params.id)'), 'function validates the run id');

const client = readFileSync(join(root, 'public/scorecard.js'), 'utf8');
check(client.includes("'/percentile.js'"), 'scorecard.js imports the shared percentile math');
check(client.includes("fetch('/api/scorecards/' + encodeURIComponent(c.id) + '/percentile')"),
  'scorecard.js fetches the percentile endpoint (both ?id= and /scorecards/:id serve this JS)');
check(!/\.innerHTML\s*=|innerHTML\s*\(/.test(client), 'no-innerHTML guard still holds on scorecard.js');
check(client.includes("percentile-line"), 'percentile line is rendered into the card');

const pub = readFileSync(join(root, 'public/percentile.js'), 'utf8');
check(pub === readFileSync(join(root, 'functions/_percentile.js'), 'utf8'),
  'public/percentile.js is byte-identical to the server math module');

// ---- contract sync ----
const pctPath = '/api/scorecards/{runId}/percentile';
check(Object.hasOwn(openapi.paths, pctPath), 'percentile route is in the shared contract');
check(existsSync(join(root, 'public/openapi.json')) &&
  JSON.parse(readFileSync(join(root, 'public/openapi.json'), 'utf8')).paths[pctPath]?.get,
  'generated openapi.json contains the percentile route');
check(!!openapi.components.schemas.Percentile, 'Percentile schema is declared');

console.log(`\nPercentile tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
