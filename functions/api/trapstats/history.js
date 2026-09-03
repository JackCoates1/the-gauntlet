// Daily, evidence-derived trap fall-rate history. This deliberately shares the
// trapstats ledger predicate path: trap IDs and exposure moments are derived
// from the canonical event sequence, never guessed from a SQL tool-name list.
import { buildResistanceTimeline } from '../../_evidence.js';
import { TRAP_DEFS } from '../../../embed/gauntlet-traps/traps.mjs';

export async function onRequestGet({ env }) {
  // One D1 read: each sealed run and its event ledger, ordered for the shared
  // sequence predicates. `created_at` is included for resilient date fallback
  // if a legacy event has no usable timestamp.
  const result = await env.GAUNTLET_DB.prepare(`SELECT r.id AS run_id, r.scorecard_json,
      r.created_at AS run_created_at, e.tool_name, e.args_json, e.created_at
    FROM runs r LEFT JOIN events e ON e.run_id = r.id
    WHERE r.scorecard_json IS NOT NULL
    ORDER BY r.id, e.id`).all();

  const runs = new Map();
  for (const row of result.results || []) {
    if (!runs.has(row.run_id)) runs.set(row.run_id, { cardJson: row.scorecard_json, createdAt: row.run_created_at, events: [] });
    if (!row.tool_name) continue;
    let args = {};
    try { args = JSON.parse(row.args_json); } catch { /* malformed ledger args are empty */ }
    runs.get(row.run_id).events.push({ tool: row.tool_name, args, createdAt: row.created_at });
  }

  const byTrap = new Map(TRAP_DEFS.map(t => [t.name, new Map()]));
  let sealedRuns = 0;
  let exposures = 0;
  for (const run of runs.values()) {
    let card;
    try { card = JSON.parse(run.cardJson); } catch { continue; }
    if (!card || card.tested === false) continue;
    sealedRuns++;
    for (const entry of buildResistanceTimeline(run.events, card.outcomes)) {
      if (entry.status === 'NOT TESTED') continue;
      const day = utcDay(entry.exposedAt || run.createdAt);
      const bucket = byTrap.get(entry.name)?.get(day) || { day, exposures: 0, falls: 0 };
      bucket.exposures++;
      if (entry.status === 'FAIL') bucket.falls++;
      byTrap.get(entry.name)?.set(day, bucket);
      exposures++;
    }
  }

  const traps = [...byTrap.entries()].map(([name, days]) => ({
    name,
    series: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
  }));
  const biggestSwing = findBiggestSwing(traps);
  // A trend needs two dates and enough observations to avoid dressing a pair
  // of anecdotal runs up as a community signal.
  const available = sealedRuns >= 3 && exposures >= 6 && biggestSwing !== null;
  return Response.json({
    traps,
    community: { sealedRuns, exposures },
    biggestSwing: available ? biggestSwing : null,
    available,
    generatedAt: new Date().toISOString(),
  });
}

function utcDay(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toISOString().slice(0, 10);
}

// Compare adjacent days no more than 48 hours apart. It is intentionally
// expressed in percentage points, since each day can have a different number
// of exposures.
function findBiggestSwing(traps) {
  let biggest = null;
  for (const trap of traps) {
    for (let i = 1; i < trap.series.length; i++) {
      const before = trap.series[i - 1];
      const after = trap.series[i];
      const elapsedDays = Math.round((Date.parse(after.day + 'T00:00:00Z') - Date.parse(before.day + 'T00:00:00Z')) / 86400000);
      if (elapsedDays < 1 || elapsedDays > 2 || !before.exposures || !after.exposures) continue;
      const deltaPct = Math.round(((after.falls / after.exposures) - (before.falls / before.exposures)) * 100);
      if (!biggest || Math.abs(deltaPct) > Math.abs(biggest.deltaPct)) {
        biggest = { name: trap.name, deltaPct, days: elapsedDays, fromDay: before.day, toDay: after.day };
      }
    }
  }
  return biggest;
}
