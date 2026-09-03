// Aggregate, evidence-derived trap resistance statistics. Trap exposure is
// intentionally recomputed from the canonical ledger predicates rather than
// inferred from tool names in SQL: several traps depend on arguments or on a
// sequence of calls.
import { buildResistanceTimeline } from '../_evidence.js';
import { TRAP_DEFS } from '../../embed/gauntlet-traps/traps.mjs';

export async function onRequestGet({ env }) {
  // One D1 read joins every sealed run to its ledger. Grouping in JavaScript is
  // necessary because trap ids are derived by the shared predicate functions,
  // not stored on individual event rows.
  const result = await env.GAUNTLET_DB.prepare(`SELECT r.id AS run_id, r.scorecard_json,
      e.tool_name, e.args_json, e.created_at
    FROM runs r LEFT JOIN events e ON e.run_id = r.id
    WHERE r.scorecard_json IS NOT NULL
    ORDER BY r.id, e.id`).all();

  const runs = new Map();
  for (const row of result.results || []) {
    if (!runs.has(row.run_id)) runs.set(row.run_id, { cardJson: row.scorecard_json, events: [] });
    if (!row.tool_name) continue;
    let args = {};
    try { args = JSON.parse(row.args_json); } catch { /* malformed ledger args are treated as empty */ }
    runs.get(row.run_id).events.push({ tool: row.tool_name, args, createdAt: row.created_at });
  }

  const stats = new Map(TRAP_DEFS.map(t => [t.name, { name: t.name, exposureCount: 0, fellCount: 0, resistedCount: 0, durations: [] }]));
  let sealedRuns = 0;
  let totalResisted = 0;
  for (const run of runs.values()) {
    let card;
    try { card = JSON.parse(run.cardJson); } catch { continue; }
    if (!card || card.tested === false) continue;
    sealedRuns++;
    const timeline = buildResistanceTimeline(run.events, card.outcomes);
    for (const entry of timeline) {
      if (entry.status === 'NOT TESTED') continue;
      const stat = stats.get(entry.name);
      if (!stat) continue;
      stat.exposureCount++;
      stat.durations.push(entry.seconds);
      if (entry.status === 'FAIL') stat.fellCount++;
      if (entry.status === 'PASS') { stat.resistedCount++; totalResisted++; }
    }
  }

  const traps = [...stats.values()].map(stat => ({
    name: stat.name,
    exposureCount: stat.exposureCount,
    fellCount: stat.fellCount,
    resistedCount: stat.resistedCount,
    fallRatePct: stat.exposureCount ? Math.round((stat.fellCount / stat.exposureCount) * 100) : null,
    medianSeconds: median(stat.durations),
  })).sort((a, b) => (b.fallRatePct ?? -1) - (a.fallRatePct ?? -1)
    || b.exposureCount - a.exposureCount || a.name.localeCompare(b.name))
    .map((trap, i) => ({ ...trap, rank: i + 1 }));

  return Response.json({
    traps,
    hardestTrap: traps.find(t => t.exposureCount > 0) || null,
    community: {
      sealedRuns,
      averageResisted: sealedRuns ? round(totalResisted / sealedRuns, 1) : 0,
      possibleTraps: TRAP_DEFS.length,
    },
    generatedAt: new Date().toISOString(),
  });
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2, 1);
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
