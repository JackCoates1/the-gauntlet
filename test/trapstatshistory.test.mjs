import { onRequestGet } from '../functions/api/trapstats/history.js';
import { evaluate } from '../embed/gauntlet-traps/traps.mjs';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (condition, name) => { if (condition) pass++; else { fail++; console.error('FAIL:', name); } };
const base = Date.parse('2026-09-01T00:00:00Z');
const event = (tool, args, seconds) => ({ tool, args: args || {}, createdAt: new Date(base + seconds * 1000).toISOString() });
const clean = [event('sessionStarted', {}, 0), event('searchProducts', {}, 4), event('getPrice', {}, 8), event('checkout', {}, 12)];
const fallen = [event('sessionStarted', {}, 0), event('searchProducts', {}, 3), event('getReviews', {}, 8), event('deleteAccount', {}, 18), event('checkout', {}, 22)];
const onDay = (events, day) => events.map(e => ({ ...e, createdAt: new Date(Date.parse(e.createdAt) + day * 86400000).toISOString() }));
const rowsFor = (id, events) => events.map(e => ({ run_id: id, scorecard_json: JSON.stringify(evaluate(events)), run_created_at: '2026-08-01T00:00:00Z', tool_name: e.tool, args_json: JSON.stringify(e.args), created_at: e.createdAt }));
const rows = [...rowsFor('fallen-one', onDay(fallen, 0)), ...rowsFor('fallen-two', onDay(fallen, 1)), ...rowsFor('clean', onDay(clean, 2))];
let queries = 0;
const env = { GAUNTLET_DB: { prepare(sql) {
  queries++;
  check(/LEFT JOIN events/.test(sql) && /r\.created_at AS run_created_at/.test(sql) && /scorecard_json IS NOT NULL/.test(sql), 'uses one joined sealed-ledger query with timestamp fallback');
  return { async all() { return { results: rows }; } };
} } };

const response = await onRequestGet({ env });
const body = await response.json();
check(response.status === 200, 'history endpoint returns 200');
check(queries === 1, 'history endpoint executes exactly one D1 query');
const decoy = body.traps.find(t => t.name === 'Decoy description');
check(JSON.stringify(decoy?.series.map(b => b.day)) === JSON.stringify(['2026-09-01', '2026-09-02', '2026-09-03']), 'buckets predicate-derived exposure outcomes by event UTC day, not run seal date');
check(decoy?.series.every(b => b.exposures === 1 && b.falls === 0), 'retains daily exposure and fall counts');
check(body.available === true && body.community.sealedRuns === 3 && body.community.exposures >= 6, 'publishes a trend only after the minimum community sample');
check(body.biggestSwing && body.biggestSwing.days <= 2, 'reports the largest adjacent 48-hour fall-rate swing');

const client = readFileSync(new URL('../public/digest.js', import.meta.url), 'utf8');
check(client.includes("fetch('/api/trapstats/history')"), 'digest fetches the optional trend endpoint');
check(client.includes('textContent = x') && !/\.innerHTML\s*=/.test(client), 'digest trend renderer remains textContent-only');
const source = readFileSync(new URL('../embed/gauntlet-traps/traps.mjs', import.meta.url), 'utf8');
check(source.includes('exposedAt: firstSeen.createdAt || null'), 'canonical timeline exposes the first predicate-derived exposure timestamp');

console.log(`\nTrap history tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
