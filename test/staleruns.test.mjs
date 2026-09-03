import { cleanupStaleRuns, STALE_RUN_AGE_MS } from '../functions/_staleRuns.js';
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (name, condition) => { if (condition) console.log('ok:', name); else { failures++; console.error('FAIL:', name); } };
const calls = [];
const env = { GAUNTLET_DB: { prepare(sql) { return { bind(cutoff, preservedRunId) { calls.push({ sql, cutoff, preservedRunId }); return this; }, async run() { return { success: true }; } }; } } };
const now = Date.parse('2026-09-03T12:00:00.000Z');
await cleanupStaleRuns(env, now, 'resumed-run');
const cutoff = new Date(now - STALE_RUN_AGE_MS).toISOString();
check('cleanup removes orphaned events before their unsealed run', calls.length === 2 && /DELETE FROM events/.test(calls[0].sql) && /DELETE FROM runs/.test(calls[1].sql));
check('cleanup only targets old, unsealed runs without touching the resumed run', calls.every(call => call.sql.includes('scorecard_json IS NULL') && call.sql.includes('id != ?') && call.cutoff === cutoff && call.preservedRunId === 'resumed-run'));
const seal = readFileSync(new URL('../functions/api/scorecards/[id].js', import.meta.url), 'utf8');
check('every seal opportunistically triggers stale-ledger cleanup while preserving its run', seal.includes("import { cleanupStaleRuns } from '../../_staleRuns.js'") && seal.includes('await cleanupStaleRuns(env, Date.now(), params.id);'));
if (failures) process.exit(1);
console.log('\nall stale-run cleanup tests passed');
