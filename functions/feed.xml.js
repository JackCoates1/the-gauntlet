// Atom feed of verified sealed runs at GET /feed.xml. Live data, so this is
// a Pages Function (not a build script): it reuses the exact /api/recent D1
// read and the same server-side verifyRun() call the leaderboard and ticker
// use — a run only earns the "verified" title suffix when its Ed25519
// signature actually checks out. Every dynamic value is XML-escaped with the
// same escaping pattern the OG route uses before it touches markup.
import { verifyRun } from './_evidence.js';

const MAX_ENTRIES = 20;

// XML escaping — covers & < > " ' (same allowlist pattern as /scorecards/:id).
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// RFC 3339 timestamp or "now" fallback so the feed always validates.
const iso = (value) => {
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
};

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;

  const rows = await env.GAUNTLET_DB
    .prepare(`SELECT id, created_at, score, total, agent_label, user_agent, scorecard_json, sig
              FROM runs
              WHERE scorecard_json IS NOT NULL
              ORDER BY created_at DESC
              LIMIT ?`)
    .bind(MAX_ENTRIES)
    .all();

  const entries = [];
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
    entries.push({
      id: x.id,
      sealedAt: x.created_at,
      score: x.score,
      total: x.total,
      label: x.agent_label || browserFamily(x.user_agent),
      verified: verdict.verified,
      url: `/scorecards/${x.id}`,
    });
  }

  const updated = entries.length ? iso(entries[0].sealedAt) : new Date().toISOString();

  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `<title>${esc('The Gauntlet — verified runs')}</title>`,
    `<subtitle>${esc('Every sealed run on the WebMCP security range, with server-side signature verification.')}</subtitle>`,
    `<id>${esc(origin + '/')}</id>`,
    `<updated>${updated}</updated>`,
    `<link rel="self" href="${esc(origin + '/feed.xml')}" type="application/atom+xml"/>`,
    `<link rel="alternate" href="${esc(origin + '/')}" type="text/html"/>`,
    `<generator>${esc('The Gauntlet Pages Function')}</generator>`,
    ...entries.map(e => [
      '<entry>',
      `<title>${esc(`Gauntlet: ${e.score}/${e.total} traps resisted — ${e.verified ? 'verified' : 'unverified'}`)}</title>`,
      `<link rel="alternate" href="${esc(origin + e.url)}"/>`,
      `<id>${esc(origin + e.url)}</id>`,
      `<published>${iso(e.sealedAt)}</published>`,
      `<updated>${iso(e.sealedAt)}</updated>`,
      `<author><name>${esc(e.label || 'web')}</name></author>`,
      `<summary>${esc(`Agent ${e.label || 'web'} sealed a run resisting ${e.score}/${e.total} traps. ${e.verified ? 'Signature verified server-side.' : 'Signature could not be verified.'} Full signed evidence: ${origin + e.url}`)}</summary>`,
      '</entry>',
    ].join('')),
    '</feed>',
    '',
  ].join('\n');

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
    },
  });
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
