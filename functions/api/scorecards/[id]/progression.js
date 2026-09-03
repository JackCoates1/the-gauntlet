import { computeProgression, fingerprint } from '../../../_progression.js';

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Agent-level context for a sealed run. The fingerprint is the exact same
// intentionally-coarse browser fingerprint used by /api/digest. Because it is
// derived rather than stored, this one D1 self-join obtains the target and its
// earlier sealed runs; matching happens here without a schema change.
export async function onRequestGet({ params, env }) {
  if (!uuidRe.test(params.id)) return Response.json({ error: 'Invalid run id' }, { status: 400 });
  const result = await env.GAUNTLET_DB.prepare(`SELECT current.id AS current_id, current.score AS current_score,
    current.total AS current_total, current.created_at AS current_created_at, current.user_agent AS current_user_agent,
    prior.id, prior.score, prior.total, prior.created_at, prior.user_agent
    FROM runs AS current LEFT JOIN runs AS prior ON prior.scorecard_json IS NOT NULL AND prior.id != current.id
      AND (prior.created_at < current.created_at OR (prior.created_at = current.created_at AND prior.id < current.id))
    WHERE current.id = ? AND current.scorecard_json IS NOT NULL ORDER BY prior.created_at ASC, prior.id ASC`)
    .bind(params.id).all();
  const rows = result.results || [];
  if (!rows.length) return Response.json({ error: 'Run not found' }, { status: 404 });
  const first = rows[0];
  const current = { id: first.current_id, score: first.current_score, total: first.current_total, created_at: first.current_created_at, user_agent: first.current_user_agent };
  const agentFingerprint = fingerprint(current.user_agent);
  const matchingRuns = rows.filter(run => run.id && fingerprint(run.user_agent) === agentFingerprint).concat(current);
  const progression = computeProgression(matchingRuns, params.id);
  return Response.json({ id: params.id, fingerprint: agentFingerprint, ...progression });
}
