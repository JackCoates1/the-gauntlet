// Shareable comparison preview. The human view is public/compare.html; this
// alias only adds trustworthy OG tags from the two sealed scorecards.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const clip = (s, n) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
export function buildCompareOgTags(a, b, origin) {
  const o = origin.replace(/\/+$/, ''), as = Number(a.score) || 0, at = Number(a.total) || 0, bs = Number(b.score) || 0, bt = Number(b.total) || 0;
  const winner = as / Math.max(1, at) === bs / Math.max(1, bt) ? 'Side-by-side evidence comparison' : (as / Math.max(1, at) > bs / Math.max(1, bt) ? 'Run A leads' : 'Run B leads');
  const title = `Gauntlet comparison: A ${as}/${at} vs B ${bs}/${bt}`;
  const desc = `${winner} · ${clip(esc(a.id), 36)} vs ${clip(esc(b.id), 36)} with signed, replayable evidence.`;
  const url = `${o}/compare/${encodeURIComponent(a.id)}/${encodeURIComponent(b.id)}`;
  return [`<meta property="og:title" content="${title}">`,`<meta property="og:description" content="${desc}">`,`<meta property="og:type" content="website">`,`<meta property="og:url" content="${url}">`,`<meta property="og:image" content="${o}/og-banner.png">`,`<meta property="og:image:width" content="1200">`,`<meta property="og:image:height" content="630">`,`<meta name="twitter:card" content="summary_large_image">`,`<meta name="twitter:title" content="${title}">`,`<meta name="twitter:description" content="${desc}">`,`<meta name="twitter:image" content="${o}/og-banner.png">`].join('');
}
export function buildCompareFallbackOgTags(origin) { const o = origin.replace(/\/+$/, ''); return `<meta property="og:title" content="The Gauntlet — run comparison"><meta property="og:description" content="Compare two evidence-backed agent security runs side by side."><meta property="og:type" content="website"><meta property="og:url" content="${o}/compare"><meta property="og:image" content="${o}/og-banner.png"><meta name="twitter:card" content="summary_large_image">`; }
async function html() { return (await import('../compare-html.js')).default; }
export async function onRequestGet({ params, env, request }) {
  const origin = new URL(request.url).origin, ids = [params.a || '', params.b || '']; let cards = [];
  if (ids.every(x => uuid.test(x)) && ids[0] !== ids[1] && env?.GAUNTLET_DB) {
    for (const id of ids) { const row = await env.GAUNTLET_DB.prepare('SELECT scorecard_json FROM runs WHERE id=?').bind(id).first(); try { cards.push(row?.scorecard_json ? JSON.parse(row.scorecard_json) : null); } catch { cards.push(null); } }
  }
  const tags = cards.length === 2 && cards.every(Boolean) ? buildCompareOgTags(cards[0], cards[1], origin) : buildCompareFallbackOgTags(origin);
  return new Response((await html()).replace('</head>', tags + '</head>'), { headers: { 'content-type':'text/html; charset=utf-8', 'cache-control':'public, max-age=300', 'x-content-type-options':'nosniff' } });
}
