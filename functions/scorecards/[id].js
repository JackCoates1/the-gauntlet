// Scorecard page: scorecard.html is a static asset, so it can't carry
// per-run Open Graph meta tags — link previews (Slack/X/Telegram) would show
// a generic blank card. This Pages Function intercepts GET /scorecards/:id
// (an SEO-friendly alias of /scorecard?id=), fetches the scorecard it already
// needs, and returns the same HTML with dynamic og:/twitter: meta tags
// injected. Safe by construction: every dynamic value is XML-escaped and
// restricted to a strict allowlist before being placed in an attribute.
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { buildScorecardJsonLd, buildJsonLdScript } from '../_jsonld.js';

// XML attribute escaping — covers & < > " '.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Keep og: text short enough that link unfurls stay one clean block.
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// Only these strings may appear in a meta tag built from outcome data.
const STATUS_ALLOWED = new Set(['PASS', 'FAIL', 'NOT TESTED']);

export function buildOgTags(card, origin) {
  const o = origin.replace(/\/+$/, '');
  const score = Number(card.score) || 0;
  const total = Number(card.total) || 0;
  const outcomes = Array.isArray(card.outcomes) ? card.outcomes : [];

  const tested = outcomes.filter((x) => STATUS_ALLOWED.has(x.status) && x.status !== 'NOT TESTED');
  const passed = tested.filter((x) => x.status === 'PASS').length;
  // The sealed score is authoritative; fall back to recomputing from outcomes
  // only when the card carries no usable totals (e.g. hand-made previews).
  const s = total > 0 ? score : passed;
  const t = total > 0 ? total : tested.length;
  const title = `Gauntlet: ${s}/${t} traps resisted`;

  const firstFail = tested.find((x) => x.status === 'FAIL');
  const badge = firstFail
    ? clip(esc(firstFail.name), 80) + ' flagged for review'
    : tested.length
      ? 'Clean run — every trap resisted with verified evidence'
      : 'Run not scored — view the full scorecard';
  const desc = `${badge} · Signed, replayable evidence at The Gauntlet public security range.`;

  const img = `${o}/og-banner.png`;
  const url = `${o}/scorecards/${card.id}`;

  return [
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${img}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="The Gauntlet — agent security scorecard">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${desc}">`,
    `<meta name="twitter:image" content="${img}">`,
  ].join('');
}

// Fallback tags for an unknown/invalid run id: brand the preview rather than
// letting it render blank.
export function buildFallbackOgTags(origin) {
  const o = origin.replace(/\/+$/, '');
  const title = 'The Gauntlet — agent security scorecard';
  const desc = 'Public security range: run your agent against prompt-injection traps and get a signed, replayable scorecard.';
  return [
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${o}/">`,
    `<meta property="og:image" content="${o}/og-banner.png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${desc}">`,
    `<meta name="twitter:image" content="${o}/og-banner.png">`,
  ].join('');
}

async function loadHtml() {
  // Bundled at build time by wrangler's Rules setup (wrangler.toml [rules]).
  return (await import('./scorecard-html.js')).default;
}

export async function onRequestGet({ params, env, request }) {
  const origin = new URL(request.url).origin;
  const runId = params.id || '';
  let tags;
  let card = null;
  let community = null;
  if (uuidRe.test(runId) && env?.GAUNTLET_DB) {
    const row = await env.GAUNTLET_DB.prepare('SELECT scorecard_json FROM runs WHERE id=?').bind(runId).first();
    if (row?.scorecard_json) {
      try { card = JSON.parse(row.scorecard_json); } catch { card = null; }
    }
    // Community aggregate for the rating triple: one extra sealed-runs count
    // — the same ledger the leaderboard and /api/trapstats aggregate. Failed
    // fetch simply omits the rating; the scorecard still renders.
    try {
      const agg = await env.GAUNTLET_DB
        .prepare(`SELECT COUNT(*) AS n, SUM(score * 1.0 / NULLIF(total, 0)) AS pctSum
                  FROM runs WHERE scorecard_json IS NOT NULL AND total > 0`)
        .first();
      if (agg && agg.n > 0) {
        // pctSum is the sum of per-run score/total fractions — a 0–1 scale —
        // so the mean percentage is (pctSum / n) * 100.
        community = { sealedRuns: agg.n, averageScorePct: agg.pctSum != null ? (agg.pctSum / agg.n) * 100 : null };
      }
    } catch { community = null; }
  }
  tags = card ? buildOgTags(card, origin) : buildFallbackOgTags(origin);
  if (card) tags += buildJsonLdScript(buildScorecardJsonLd(card, origin, community));

  const html = await loadHtml();
  const injected = html.replace('</head>', tags + '</head>');
  return new Response(injected, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Long cache: a sealed scorecard is immutable (seal is idempotent), and
      // the fallback page is static. Crawlers get a stable preview.
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
}
