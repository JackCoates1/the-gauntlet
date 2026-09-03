// Agent progression: digest-compatible coarse fingerprinting, pure score
// history math, Pages route shape, scorecard wiring and contract sync.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computeProgression, fingerprint, progressionLine, progressionSparkline } from '../functions/_progression.js';
import { openapi } from '../scripts/api-contract.mjs';
import { onRequestGet } from '../functions/api/scorecards/[id]/progression.js';

let pass = 0, fail = 0;
const check = (cond, name) => { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } };
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
const runs = [
  { id: ids[0], score: 8, total: 13, created_at: '2026-09-01T00:00:00Z' },
  { id: ids[1], score: 9, total: 13, created_at: '2026-09-02T00:00:00Z' },
  { id: ids[2], score: 10, total: 13, created_at: '2026-09-03T00:00:00Z' },
];

// ---- pure helper ----
const p = computeProgression(runs, ids[2]);
check(p.runNumber === 3 && p.priorRunCount === 2, 'third matching sealed run has ordinal and history count');
check(p.previous?.score === 9 && p.previous?.total === 13, 'previous run is the latest prior sealed score');
check(p.delta === 1, 'comparable raw scores yield delta');
check(JSON.stringify(p.previousScores) === JSON.stringify([8 / 13 * 100, 9 / 13 * 100]), 'history is chronological score percentages');
check(progressionLine(p) === "This agent's 3rd run — up from 9/13 last time (+1)", 'improvement copy matches scorecard story');
check(progressionLine(computeProgression(runs, ids[0])) === 'First run for this agent', 'first run has direct copy');
check(computeProgression([{ ...runs[0] }, { ...runs[1], total: 14 }], ids[1]).delta === null, 'changed trap total does not claim raw delta');
check(progressionSparkline([0, 50, 100]) === '▁▅█', 'sparkline maps score percentages to compact bars');
check(progressionSparkline([]) === '', 'empty history has no fake sparkline');
check(fingerprint('Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0 Safari/537.36') === 'Chrome / 140 / Linux', 'fingerprint matches digest coarse format');
check(fingerprint('') === 'Unknown client', 'missing user agent remains a coarse unknown client');

// Endpoint behavior with the same single-query row shape D1 returns from the
// target/prior self-join. A Chrome/Linux prior is retained; a Firefox prior is
// excluded by the shared digest fingerprint.
const endpointRows = [
  { current_id: ids[2], current_score: 10, current_total: 13, current_created_at: '2026-09-03T00:00:00Z', current_user_agent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0 Safari/537.36', id: ids[0], score: 9, total: 13, created_at: '2026-09-01T00:00:00Z', user_agent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0 Safari/537.36' },
  { current_id: ids[2], current_score: 10, current_total: 13, current_created_at: '2026-09-03T00:00:00Z', current_user_agent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0 Safari/537.36', id: ids[1], score: 12, total: 13, created_at: '2026-09-02T00:00:00Z', user_agent: 'Mozilla/5.0 Firefox/142.0' },
];
let queryCount = 0;
const env = { GAUNTLET_DB: { prepare() { queryCount++; return { bind() { return { async all() { return { results: endpointRows }; } }; } }; } } };
const endpointResponse = await onRequestGet({ params: { id: ids[2] }, env });
const endpointBody = await endpointResponse.json();
check(endpointResponse.status === 200 && endpointBody.runNumber === 2 && endpointBody.delta === 1, 'endpoint returns matching-fingerprint chronological progression');
check(endpointBody.previous?.score === 9 && endpointBody.previousScores.length === 1, 'endpoint excludes differently fingerprinted prior runs');
check(queryCount === 1, 'endpoint executes exactly one D1 query at runtime');

// ---- function + client wiring ----
const fnPath = join(root, 'functions/api/scorecards/[id]/progression.js');
check(existsSync(fnPath), 'progression Pages Function exists at the contract route');
const fn = readFileSync(fnPath, 'utf8');
check(fn.includes('scorecard_json IS NOT NULL'), 'function only reads sealed runs');
check((fn.match(/\.prepare\(/g) || []).length === 1, 'function performs one D1 query');
check(fn.includes('LEFT JOIN runs AS prior') && fn.includes('prior.id != current.id'), 'query joins prior sealed runs while excluding the current run');
check(fn.includes('fingerprint(run.user_agent) === agentFingerprint'), 'function matches the digest fingerprint exactly');
check(fn.includes('uuidRe.test(params.id)'), 'function validates the run id');

const client = readFileSync(join(root, 'public/scorecard.js'), 'utf8');
check(client.includes("'/progression.js'"), 'scorecard imports shared progression helper');
check(client.includes("fetch('/api/scorecards/' + encodeURIComponent(c.id) + '/progression')"), 'scorecard fetches progression after percentile');
check(client.includes("'PROGRESSION'"), 'scorecard renders a labelled progression line');
check(client.includes('progressionSparkline(progression.previousScores)'), 'scorecard renders historical score sparkline');
check(!/\.innerHTML\s*=|innerHTML\s*\(/.test(client), 'no-innerHTML guard still holds on scorecard.js');

const server = readFileSync(join(root, 'functions/_progression.js'), 'utf8');
check(server === readFileSync(join(root, 'public/progression.js'), 'utf8'), 'public progression helper is byte-identical to the server module');
check(readFileSync(join(root, 'functions/api/digest.js'), 'utf8').includes("import { fingerprint } from '../_progression.js'"), 'digest reuses the exact progression fingerprint');

// ---- contract and human docs ----
const path = '/api/scorecards/{runId}/progression';
check(Object.hasOwn(openapi.paths, path), 'progression route is in the shared contract');
check(existsSync(join(root, 'public/openapi.json')) && JSON.parse(readFileSync(join(root, 'public/openapi.json'), 'utf8')).paths[path]?.get, 'generated openapi.json contains progression route');
check(!!openapi.components.schemas.Progression, 'Progression schema is declared');
const docs = readFileSync(join(root, 'public/docs.html'), 'utf8');
check(docs.includes('/api/scorecards/:runId/progression'), 'human docs include progression route');

console.log(`\nProgression tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
