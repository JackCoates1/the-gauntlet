import { verifyRun } from '../_evidence.js';

const MAX_LIMIT = 50;

// Public leaderboard: recent completed runs, framed as an ongoing public
// benchmark. Each entry carries a `verified` badge computed SERVER-SIDE by
// recomputing the event-ledger hash chain and checking the seal-time
// Ed25519 signature — a fabricated scorecard can never earn it.
// Default view is verified-only; pass ?verified=0 to include unverified runs.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  let limit = parseInt(url.searchParams.get('limit') || '20', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  const verifiedOnly = url.searchParams.get('verified') !== '0';

  const rows = await env.GAUNTLET_DB
    .prepare(`SELECT id, created_at, score, total, agent_label, user_agent, scorecard_json, sig
              FROM runs
              WHERE scorecard_json IS NOT NULL
              ORDER BY created_at DESC
              LIMIT ?`)
    .bind(limit)
    .all();

  const all = [];
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
    all.push({
      id: x.id,
      createdAt: x.created_at,
      score: x.score,
      total: x.total,
      pct: x.total > 0 ? Math.round((x.score / x.total) * 100) : null,
      label: x.agent_label || null,
      browser: browserFamily(x.user_agent),
      url: `/scorecard?id=${x.id}`,
      badgeUrl: `/api/badge/${x.id}`,
      verified: verdict.verified,
    });
  }

  const runs = verifiedOnly ? all.filter(r => r.verified) : all;
  return Response.json({ runs, verifiedCount: all.filter(r => r.verified).length, totalSealed: all.length, generatedAt: new Date().toISOString() });
}

function browserFamily(ua) {
  if (!ua || typeof ua !== 'string') return 'Unknown';
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/chrome\//i.test(ua)) return 'Chrome';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Other';
}
