import { evaluate } from '../../_lib.js';
import { sealScorecard } from '../../_evidence.js';

// Seal a run: compute the scorecard from the SERVER-SIDE event ledger only.
// The request body is never used as a source of events (the previous
// `data.events` fallback let a client post a fabricated clean trace).

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestPost({ request, params, env }) {
  if (!uuidRe.test(params.id)) return Response.json({ error: 'Invalid run id' }, { status: 400 });

  let data = {};
  try {
    const raw = await request.text();
    if (raw.length > 2048) return Response.json({ error: 'Payload too large' }, { status: 413 });
    data = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const existing = await env.GAUNTLET_DB.prepare('SELECT scorecard_json FROM runs WHERE id = ?').bind(params.id).first();
  if (existing?.scorecard_json) {
    // Idempotent re-seal: return the original card, never re-score.
    const card = JSON.parse(existing.scorecard_json);
    return Response.json({ ...card, url: `/scorecard?id=${params.id}`, badgeUrl: `/api/badge/${params.id}` });
  }

  const rows = await env.GAUNTLET_DB
    .prepare('SELECT tool_name,args_json,created_at FROM events WHERE run_id=? ORDER BY id')
    .bind(params.id)
    .all();
  const events = (rows.results || []).map(x => {
    let args = {};
    try { args = JSON.parse(x.args_json); } catch { args = {}; }
    return { tool: x.tool_name, args, createdAt: x.created_at };
  });

  const card = { id: params.id, ...evaluate(events), createdAt: new Date().toISOString() };
  const userAgent = typeof data.userAgent === 'string' ? data.userAgent.slice(0, 500) : null;

  // Sign the canonical seal payload (runId + scorecard + event-chain root) at
  // seal time so the leaderboard can later distinguish verified runs.
  const sig = await sealScorecard(params.id, card, events, env.GAUNTLET_SIGNING_KEY || null);

  await env.GAUNTLET_DB
    .prepare('UPDATE runs SET score=?,total=?,scorecard_json=?,user_agent=COALESCE(user_agent,?),sig=? WHERE id=?')
    .bind(card.score, card.total, JSON.stringify(card), userAgent, sig, params.id)
    .run();

  return Response.json({ ...card, verified: !!sig, url: `/scorecard?id=${params.id}`, badgeUrl: `/api/badge/${params.id}` });
}

export async function onRequestGet({ params, env }) {
  if (!uuidRe.test(params.id)) return Response.json({ error: 'Invalid run id' }, { status: 400 });
  const row = await env.GAUNTLET_DB.prepare('SELECT scorecard_json FROM runs WHERE id=?').bind(params.id).first();
  return row?.scorecard_json ? Response.json(JSON.parse(row.scorecard_json)) : Response.json({ error: 'Run not found' }, { status: 404 });
}
