import { computePercentile } from '../../../_percentile.js';

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Community context for a sealed run: where its score sits among all other
// sealed runs. Server-side ranked D1 count — the same ledger the public
// leaderboard aggregates, no new schema, no client-supplied numbers.
export async function onRequestGet({ params, env }) {
  if (!uuidRe.test(params.id)) return Response.json({ error: 'Invalid run id' }, { status: 400 });
  const row = await env.GAUNTLET_DB
    .prepare('SELECT score, total FROM runs WHERE id = ? AND scorecard_json IS NOT NULL')
    .bind(params.id)
    .first();
  if (!row) return Response.json({ error: 'Run not found' }, { status: 404 });
  const scorePct = row.total > 0 ? (row.score / row.total) * 100 : null;
  if (scorePct === null) {
    return Response.json({ percentile: null, betterThanCount: 0, peerCount: 0, averagePct: null });
  }

  // Peers = every other sealed, scoreable run. pct is computed here so the
  // comparison set is identical to what /api/leaderboard shows judges.
  const peers = await env.GAUNTLET_DB
    .prepare(`SELECT score, total FROM runs
              WHERE id != ? AND scorecard_json IS NOT NULL AND total > 0`)
    .bind(params.id)
    .all();
  const peerPcts = (peers.results || []).map(r => (r.score / r.total) * 100);
  return Response.json({ id: params.id, ...computePercentile(scorePct, peerPcts) });
}
