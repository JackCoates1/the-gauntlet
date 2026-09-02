import { verifyRun } from '../_evidence.js';

// Public research digest: aggregates every sealed run into per-model/browser
// fingerprint cards showing susceptibility per attack class. Served as JSON
// and rendered as a static-feeling report page at /digest.
export async function onRequestGet({ env }) {
  const rows = await env.GAUNTLET_DB
    .prepare('SELECT id, scorecard_json, user_agent, created_at, sig FROM runs WHERE scorecard_json IS NOT NULL ORDER BY created_at ASC')
    .all();

  // fingerprint -> { runs, traps: { outcomeName: {pass, fail, notTested} } }
  const groups = new Map();
  let verifiedRuns = 0;
  for (const row of rows.results || []) {
    let card;
    try { card = JSON.parse(row.scorecard_json); } catch { continue; }
    if (!card || card.tested === false) continue;
    const fp = fingerprint(row.user_agent);
    if (!groups.has(fp)) groups.set(fp, { runs: 0, verified: 0, traps: {}, lastRun: null, scores: [] });
    const g = groups.get(fp);
    g.runs += 1;
    // Server-side verification: same ledger-recompute + signature check the
    // leaderboard uses, so the digest never inherits fabricated runs as data.
    const eventRows = await env.GAUNTLET_DB
      .prepare('SELECT tool_name, args_json, created_at FROM events WHERE run_id = ? ORDER BY id')
      .bind(row.id)
      .all();
    const events = (eventRows.results || []).map(e => {
      let args = {};
      try { args = JSON.parse(e.args_json); } catch { args = {}; }
      return { tool: e.tool_name, args, createdAt: e.created_at };
    });
    const verdict = await verifyRun(events, card, row.sig);
    if (verdict.verified) { g.verified += 1; verifiedRuns += 1; }
    g.scores.push(card.total > 0 ? card.score / card.total : 0);
    g.lastRun = row.created_at;
    for (const o of card.outcomes || []) {
      if (!o.name || o.name === 'Genuine engagement') continue;
      const t = (g.traps[o.name] = g.traps[o.name] || { pass: 0, fail: 0, notTested: 0 });
      if (o.status === 'PASS') t.pass += 1;
      else if (o.status === 'FAIL') t.fail += 1;
      else t.notTested += 1;
    }
  }

  const cards = [...groups.entries()].map(([fingerprint, g]) => {
    const decided = g.traps && Object.values(g.traps).reduce((a, t) => a + t.pass + t.fail, 0);
    const passed = g.traps && Object.values(g.traps).reduce((a, t) => a + t.pass, 0);
    return {
      fingerprint,
      runs: g.runs,
      verifiedRuns: g.verified,
      lastRun: g.lastRun,
      meanPct: g.scores.length ? Math.round((g.scores.reduce((a, b) => a + b, 0) / g.scores.length) * 100) : null,
      traps: Object.fromEntries(
        Object.entries(g.traps).map(([name, t]) => {
          const tested = t.pass + t.fail;
          return [name, {
            ...t,
            susceptibilityPct: tested > 0 ? Math.round((t.fail / tested) * 100) : null,
          }];
        })
      ),
      overall: decided > 0 ? { testedTraps: decided, passed, violated: decided - passed, violationPct: Math.round(((decided - passed) / decided) * 100) } : null,
    };
  }).sort((a, b) => b.runs - a.runs);

  return Response.json({ cards, generatedAt: new Date().toISOString(), totalRuns: (rows.results || []).length, verifiedRuns });
}

// Coarse browser fingerprint: browser family + major version + platform.
// Deliberately NOT a precise tracking fingerprint — this is aggregate
// research reporting over self-submitted runs.
export function fingerprint(ua) {
  if (!ua || typeof ua !== 'string') return 'Unknown client';
  let browser = 'Unknown';
  let version = '';
  let m;
  if ((m = ua.match(/Edg\/(\d+)/))) { browser = 'Edge'; version = m[1]; }
  else if ((m = ua.match(/OPR\/(\d+)/))) { browser = 'Opera'; version = m[1]; }
  else if ((m = ua.match(/Chrome\/(\d+)/))) { browser = 'Chrome'; version = m[1]; }
  else if ((m = ua.match(/Firefox\/(\d+)/))) { browser = 'Firefox'; version = m[1]; }
  else if ((m = ua.match(/Version\/(\d+).*Safari/))) { browser = 'Safari'; version = m[1]; }
  let platform = /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
    : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS'
    : /Linux|X11/i.test(ua) ? 'Linux' : '';
  return [browser, version, platform].filter(Boolean).join(' / ') || 'Unknown client';
}
