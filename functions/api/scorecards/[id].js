import { evaluate } from '../../_lib.js';
import { TRAP_DEFS } from '../../../embed/gauntlet-traps/traps.mjs';
import { sealScorecard, chainRoot, buildReplay } from '../../_evidence.js';
import { rateLimit, tooMany, clientIp, checkRunPlausibility } from '../../_ratelimit.js';
import { cleanupStaleRuns } from '../../_staleRuns.js';
import { notifyWebhooks } from '../../_webhooks.js';

// Mitigation lookup backfills cards sealed before actionable coaching existed.
const MITIGATION_BY_TRAP = Object.fromEntries(TRAP_DEFS.map(t => [t.name, t.mitigation]));
const withMitigations = card => {
  for (const o of card?.outcomes || []) {
    if (o && o.mitigation === undefined) o.mitigation = MITIGATION_BY_TRAP[o.name] || null;
  }
  return card;
};

// Seal a run: compute the scorecard from the SERVER-SIDE event ledger only.
// The request body is never used as a source of events (the previous
// `data.events` fallback let a client post a fabricated clean trace).

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestPost({ request, params, env }) {
  if (!uuidRe.test(params.id)) return Response.json({ error: 'Invalid run id' }, { status: 400 });

  // Anti-gaming: cap seal attempts per IP (a forged-run factory is exactly
  // what this endpoint must not be).
  const rl = await rateLimit(env, 'seals', clientIp(request));
  if (!rl.ok) return tooMany(rl.retryAfter);

  let data = {};
  try {
    const raw = await request.text();
    if (raw.length > 2048) return Response.json({ error: 'Payload too large' }, { status: 413 });
    data = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Preserve the run currently being resumed even if its original first
  // event is old; the client may legitimately continue it after a long pause.
  await cleanupStaleRuns(env, Date.now(), params.id);

  const existing = await env.GAUNTLET_DB.prepare('SELECT scorecard_json FROM runs WHERE id = ?').bind(params.id).first();
  if (existing?.scorecard_json) {
    // Idempotent re-seal: return the original card, never re-score.
    const card = withMitigations(JSON.parse(existing.scorecard_json));
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

  // Proof-of-interaction: a seal is only valid for a run whose event chain
  // spans real time and references tools that exist in the range. This keeps
  // fabricated instant 10/10 runs out of the ledger entirely, which is what
  // makes the signature verifier badge meaningful rather than decorative.
  const plausibility = checkRunPlausibility(events);
  if (!plausibility.ok) {
    return Response.json({ error: 'Seal rejected: ' + plausibility.reason }, { status: 422 });
  }

  const card = { id: params.id, ...evaluate(events), createdAt: new Date().toISOString() };
  const userAgent = typeof data.userAgent === 'string' ? data.userAgent.slice(0, 500) : null;

  // Sign the canonical seal payload (runId + scorecard + event-chain root) at
  // seal time so the leaderboard can later distinguish verified runs.
  const sig = await sealScorecard(params.id, card, events, env.GAUNTLET_SIGNING_KEY || null);
  const root = await chainRoot(await buildReplay(events));

  // Fire-and-forget signed seal webhooks: push the run ID, score, verified
  // flag and the same event-chain root used in the seal payload to every
  // registered subscriber. Never blocks or fails the seal itself.
  const webhookNotify = notifyWebhooks(env, {
    event: 'run.sealed',
    runId: params.id,
    score: card.score,
    total: card.total,
    verified: !!sig,
    eventsRoot: root,
    scorecardUrl: `/scorecards/${params.id}`,
    sealedAt: card.createdAt,
  });
  if (typeof waitUntil === 'function') waitUntil(webhookNotify); else webhookNotify.catch(() => {});

  await env.GAUNTLET_DB
    .prepare('UPDATE runs SET score=?,total=?,scorecard_json=?,user_agent=COALESCE(user_agent,?),sig=? WHERE id=?')
    .bind(card.score, card.total, JSON.stringify(card), userAgent, sig, params.id)
    .run();

  return Response.json({ ...card, verified: !!sig, url: `/scorecard?id=${params.id}`, badgeUrl: `/api/badge/${params.id}` });
}

export async function onRequestGet({ params, env }) {
  if (!uuidRe.test(params.id)) return Response.json({ error: 'Invalid run id' }, { status: 400 });
  const row = await env.GAUNTLET_DB.prepare('SELECT scorecard_json FROM runs WHERE id=?').bind(params.id).first();
  return row?.scorecard_json ? Response.json(withMitigations(JSON.parse(row.scorecard_json))) : Response.json({ error: 'Run not found' }, { status: 404 });
}
