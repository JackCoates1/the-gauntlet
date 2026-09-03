// Seed the reproducible reference run used by the scorecard comparison CTA.
// It replays the checked-in fixture through the same public API as an agent,
// preserving its relative event timings and sealing the resulting server
// ledger. Re-running is safe: the fixed UUID makes the sealed run idempotent.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { evaluate } from '../embed/gauntlet-traps/traps.mjs';

const fixturePath = new URL('../public/demo-fixture.json', import.meta.url);
const baselinePath = new URL('../public/baseline.json', import.meta.url);
const base = (process.env.GAUNTLET_URL || 'https://gauntlet.jackcoates.co.uk').replace(/\/+$/, '');
const pace = Math.max(0, Number(process.env.BASELINE_PACE ?? 0.1));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const expected = evaluate(fixture.events);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

if (expected.score !== 9 || expected.total !== 13) throw new Error(`demo fixture must remain the 9/13 reference, got ${expected.score}/${expected.total}`);
const existing = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
const runId = uuid.test(existing?.id || '') ? existing.id : randomUUID();

async function request(path, options) {
  const response = await fetch(base + path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options?.method || 'GET'} ${path} -> ${response.status}: ${body.error || 'request failed'}`);
  return body;
}

// A run already sealed on the public ledger is the canonical baseline. Never
// append duplicate events to it; only verify that it is still the expected run.
let card = await fetch(base + '/api/scorecards/' + encodeURIComponent(runId)).then(async response => response.ok ? response.json() : null);
if (!card) {
  const first = Date.parse(fixture.events[0]?.createdAt || '');
  const startedAt = Date.now();
  let previousOffset = 0;
  for (const event of fixture.events) {
    const offset = Math.max(0, Date.parse(event.createdAt) - first);
    await wait((offset - previousOffset) * pace);
    previousOffset = offset;
    await request('/api/events', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId, event: { ...event, createdAt: new Date(startedAt + offset).toISOString() }, userAgent: 'gauntlet-reference-fixture/1.0' }),
    });
  }
  card = await request('/api/scorecards/' + encodeURIComponent(runId), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userAgent: 'gauntlet-reference-fixture/1.0' }),
  });
}
if (card.score !== expected.score || card.total !== expected.total) throw new Error(`sealed baseline drifted: expected ${expected.score}/${expected.total}, got ${card.score}/${card.total}`);

const baseline = {
  version: 1,
  id: runId,
  label: `${card.score}/${card.total} reference agent`,
  score: card.score,
  total: card.total,
  fixture: 'demo-fixture.json',
  seededAt: existing?.seededAt || new Date().toISOString(),
};
writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
console.log(`baseline ${baseline.id}: ${baseline.label}`);
