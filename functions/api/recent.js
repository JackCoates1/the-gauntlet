// Live activity ticker: the most recent sealed runs, for the homepage
// "RECENT RUNS" strip. Verification is computed SERVER-SIDE with the same
// verifyRun() call the leaderboard uses — a fabricated scorecard can never
// earn the ✓ badge. Single D1 read of the sealed-runs index.
import { verifyRun } from '../_evidence.js';

const MAX_LIMIT = 12;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  let limit = parseInt(url.searchParams.get('limit') || '8', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 8;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const rows = await env.GAUNTLET_DB
    .prepare(`SELECT id, created_at, score, total, agent_label, user_agent, scorecard_json, sig
              FROM runs
              WHERE scorecard_json IS NOT NULL
              ORDER BY created_at DESC
              LIMIT ?`)
    .bind(limit)
    .all();

  const runs = [];
  for (const x of rows.results || []) {
    let card = null;
    try { card = JSON.parse(x.scorecard_json); } catch { card = null; }
    const eventRows = await env.GAUNTLET_DB
      .prepare('SELECT tool_name, args_json, created_at FROM events WHERE run_id = ? ORDER BY id')
      .bind(x.id)
      .all();
    const events = (eventRows.results || []).map(e => {
      let args = {};
      try { args = JSON.parse(e.args_json); } catch { args = {}; }
      return { tool: e.tool_name, args, createdAt: e.created_at };
    });
    const verdict = await verifyRun(events, card || { id: x.id, createdAt: x.created_at, score: x.score, total: x.total }, x.sig);
    runs.push({
      id: x.id,
      sealedAt: x.created_at,
      score: x.score,
      total: x.total,
      label: x.agent_label || browserFamily(x.user_agent),
      verified: verdict.verified,
      url: `/scorecards/${x.id}`,
    });
  }

  return Response.json({ runs, generatedAt: new Date().toISOString() });
}

function browserFamily(ua) {
  if (!ua || typeof ua !== 'string') return 'web';
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/chrome\//i.test(ua)) return 'Chrome';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua)) return 'Safari';
  return 'web';
}
