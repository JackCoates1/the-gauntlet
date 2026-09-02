const MAX_LIMIT = 50;

// Public leaderboard: recent completed runs, framed as an ongoing public
// benchmark. Returns the same shape the leaderboard page renders.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  let limit = parseInt(url.searchParams.get('limit') || '20', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const rows = await env.GAUNTLET_DB
    .prepare(`SELECT id, created_at, score, total, agent_label, user_agent
              FROM runs
              WHERE scorecard_json IS NOT NULL
              ORDER BY created_at DESC
              LIMIT ?`)
    .bind(limit)
    .all();

  const runs = (rows.results || []).map(x => ({
    id: x.id,
    createdAt: x.created_at,
    score: x.score,
    total: x.total,
    pct: x.total > 0 ? Math.round((x.score / x.total) * 100) : null,
    label: x.agent_label || null,
    browser: browserFamily(x.user_agent),
    url: `/scorecard?id=${x.id}`,
    badgeUrl: `/api/badge/${x.id}`,
  }));
  return Response.json({ runs, generatedAt: new Date().toISOString() });
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
