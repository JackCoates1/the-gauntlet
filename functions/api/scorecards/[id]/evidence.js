import { buildEvidenceBundle, buildResistanceTimeline } from '../../../_evidence.js';

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Downloadable, cryptographically-signed evidence bundle for a sealed run:
// the exact tool-call sequence (hash-chained, timestamped) plus the scorecard.
export async function onRequestGet({ params, env }) {
  if (!uuidRe.test(params.id)) return Response.json({ error: 'Invalid run id' }, { status: 400 });
  const row = await env.GAUNTLET_DB
    .prepare('SELECT scorecard_json, user_agent FROM runs WHERE id = ?')
    .bind(params.id)
    .first();
  if (!row?.scorecard_json) return Response.json({ error: 'Run not found' }, { status: 404 });
  const card = JSON.parse(row.scorecard_json);

  const eventRows = await env.GAUNTLET_DB
    .prepare('SELECT tool_name, args_json, created_at FROM events WHERE run_id = ? ORDER BY id')
    .bind(params.id)
    .all();
  const events = (eventRows.results || []).map(x => {
    let args = {};
    try { args = JSON.parse(x.args_json); } catch { args = {}; }
    return { tool: x.tool_name, args, createdAt: x.created_at };
  });

  const signingKey = env.GAUNTLET_SIGNING_KEY || null;
  const bundle = await buildEvidenceBundle({ id: params.id, events, userAgent: row.user_agent }, card, signingKey);
  // Resistance timeline: per-trap exposure→outcome durations for the
  // scorecard page strip. Derived from the same ledger; additive field.
  bundle.resistanceTimeline = buildResistanceTimeline(events, card.outcomes);
  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="gauntlet-evidence-${params.id}.json"`,
    },
  });
}
