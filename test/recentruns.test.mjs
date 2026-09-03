// Recent-runs ticker tests: the endpoint contract, client rendering rules,
// relative-time math, homepage wiring, and the OpenAPI contract staying in
// sync with the shipped route.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { openapi } from '../scripts/api-contract.mjs';

let pass = 0, fail = 0;
const check = (cond, name) => { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } };
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- endpoint exists and reuses the leaderboard verification pattern ----
const fnPath = join(root, 'functions/api/recent.js');
check(existsSync(fnPath), 'recent Pages Function exists');
const fn = readFileSync(fnPath, 'utf8');
check(fn.includes("import { verifyRun } from '../_evidence.js'"), 'endpoint uses the shared verifyRun');
check(fn.includes('scorecard_json IS NOT NULL'), 'endpoint only lists sealed runs');
check(fn.includes('ORDER BY created_at DESC'), 'endpoint orders by seal time');
check(fn.includes('`/scorecards/${x.id}`'), 'entries link to the shareable /scorecards/:id route');
check(fn.includes('LIMIT ?'), 'limit is a bound parameter (no injection)');
check(fn.includes('MAX_LIMIT = 12'), 'limit is capped');
check(!/(innerHTML|document\.write|insertAdjacentHTML)/.test(fn), 'endpoint has no HTML sinks');

// ---- client script ----
const jsPath = join(root, 'public/recent.js');
check(existsSync(jsPath), 'public/recent.js exists');
const js = readFileSync(jsPath, 'utf8');
check(js.includes("getElementById('recentRuns')"), 'client targets the recentRuns host');
check(js.includes("fetch('/api/recent?limit=8')"), 'client fetches the endpoint');
check(!/innerHTML|document\.write|insertAdjacentHTML/.test(js), 'client is textContent-only (no innerHTML)');
check(js.includes('createElement'), 'client builds DOM with createElement');
check(js.includes('textContent'), 'client assigns via textContent');
check(js.includes("'✓ '") && js.includes("'⚠ '"), 'verified/unverified marks reuse chip semantics');
check(js.includes('/^\\/scorecards\\/[0-9a-f-]{36}$/i'), 'href is validated against the scorecard path shape');
check(js.includes('.catch('), 'client fails soft when the feed is unavailable');

// relative-time renderer behavior (extracted + evaluated)
const relTimeFn = js.match(/function relTime\(iso\) \{([\s\S]*?)\n  \}/);
check(Boolean(relTimeFn), 'relTime helper is present');
if (relTimeFn) {
  const relTime = new Function('return function relTime(iso) {' + relTimeFn[1] + '\n}')();
  const now = Date.now();
  check(relTime(new Date(now - 20e3).toISOString()) === '20s ago', 'seconds formatting');
  check(relTime(new Date(now - 120e3).toISOString()) === '2m ago', 'minutes formatting');
  check(relTime(new Date(now - 9 * 60e3).toISOString()) === '9m ago', 'nine minutes formatting');
  check(relTime(new Date(now - 3 * 3600e3).toISOString()) === '3h ago', 'hours formatting');
  check(relTime(new Date(now - 5 * 86400e3).toISOString()) === '5d ago', 'days formatting');
  check(relTime('not-a-date') === 'just now', 'garbage timestamps fall back');
  check(relTime(new Date(now + 60e3).toISOString()) === '0s ago', 'future timestamps clamp to zero');
}

// ---- homepage wiring ----
const html = readFileSync(join(root, 'public/index.html'), 'utf8');
check(html.includes('id="recentRuns"'), 'homepage hosts the ticker');
check(html.includes('src="/recent.js"'), 'homepage loads recent.js');
check(html.includes('RECENT RUNS') || html.includes('aria-label="Recent sealed runs"'), 'ticker is labelled');
const heroIdx = html.indexOf('class="hero"');
const recentIdx = html.indexOf('id="recentRuns"');
const rangeIdx = html.indexOf('id="launch"');
check(heroIdx > -1 && recentIdx > heroIdx && recentIdx < rangeIdx, 'ticker sits under the hero, above the range');

// ---- styles ----
const css = readFileSync(join(root, 'public/styles.css'), 'utf8');
check(css.includes('.recent{'), 'ticker styles present');
check(css.includes('.recent-ok{color:var(--acid)}'), 'verified entries reuse the acid color');
check(css.includes('.recent{'), 'ticker block exists in stylesheet');

// ---- docs + contract sync ----
const docs = readFileSync(join(root, 'public/docs.html'), 'utf8');
check(docs.includes('/api/recent'), '/docs documents the endpoint');
check(Boolean(openapi.paths['/api/recent']), 'OpenAPI contract includes /api/recent');
const built = JSON.parse(readFileSync(join(root, 'public/openapi.json'), 'utf8'));
check(Boolean(built.paths['/api/recent']), 'generated openapi.json includes /api/recent');
check(built.paths['/api/recent'].get.parameters[0].schema.maximum === 12, 'contract documents the limit cap');

console.log(`recent-runs: ${pass} ok, ${fail} fail`);
if (fail) process.exit(1);
