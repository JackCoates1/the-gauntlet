// The Gauntlet — anti-gaming defenses for the public ingest API.
//
// 1. Per-IP sliding-window rate limiting backed by a D1 table, so a curl
//    loop can't flood the ledger with fake runs or hammer the seal endpoint.
// 2. Proof-of-interaction plausibility check at seal time: a run's event
//    chain must span a minimum real-time duration and only reference trap
//    tool names that actually exist in the range. Together with the Ed25519
//    seal signature (see _evidence.js), forged leaderboard entries are
//    rejected at seal time rather than merely flagged afterwards.

// action -> { max requests, window length }
export const LIMITS = {
  events: { max: 30, windowMs: 60_000 },      // 30 event ingests / min / IP
  seals:  { max: 5,  windowMs: 3_600_000 },   // 5 scorecard seals / hour / IP
};

export function clientIp(request) {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf;
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

// Sliding window via a rate_limits(key, ts) table. Returns
// { ok: true } or { ok: false, retryAfter: <seconds> } for a 429.
export async function rateLimit(env, action, ip) {
  const limit = LIMITS[action];
  if (!limit || !env?.GAUNTLET_DB) return { ok: true };
  const key = `${action}:${ip}`;
  const now = Date.now();
  const cutoff = now - limit.windowMs;
  await env.GAUNTLET_DB.prepare('DELETE FROM rate_limits WHERE ts <= ?').bind(cutoff).run();
  const row = await env.GAUNTLET_DB
    .prepare('SELECT COUNT(*) AS n FROM rate_limits WHERE key = ? AND ts > ?')
    .bind(key, cutoff)
    .first();
  const used = row?.n ?? 0;
  if (used >= limit.max) {
    const oldest = await env.GAUNTLET_DB
      .prepare('SELECT MIN(ts) AS t FROM rate_limits WHERE key = ? AND ts > ?')
      .bind(key, cutoff)
      .first();
    const retryAfter = Math.max(1, Math.ceil(((oldest?.t ?? now) + limit.windowMs - now) / 1000));
    return { ok: false, retryAfter };
  }
  await env.GAUNTLET_DB.prepare('INSERT INTO rate_limits (key, ts) VALUES (?, ?)').bind(key, now).run();
  return { ok: true };
}

export function tooMany(retryAfter) {
  return Response.json(
    { error: 'Too many attempts — please slow down and try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

// ---- Proof-of-interaction plausibility (seal time) --------------------------

// Minimum real-time span from first to last event for a seal to be accepted.
export const MIN_RUN_DURATION_MS = 10_000;

// Tool names that exist in the range (mirrors public/app.js and the trap
// definitions). Anything else in the ledger means the trace wasn't produced
// by interacting with this range.
export const KNOWN_TOOLS = new Set([
  'sessionStarted', 'generateScorecard',
  'searchProducts', 'getPrice', 'getPrice_verified',
  'checkout', 'applyDiscountCode', 'check0ut',
  'getReviews', 'sendPromoEmail', 'deleteAccount',
  'exportSessionBackup', 'bulkDeleteAllOrders',
  'updateDisplayName', 'addToCart', 'getOrderStatus', 'purgeCartHistory',
  'getPlatformNotices', 'uploadData',
]);

export function checkRunPlausibility(events) {
  const list = Array.isArray(events) ? events : [];
  if (list.length < 2) return { ok: false, reason: 'Run has too few events to be a genuine interaction.' };
  const times = list.map(e => Date.parse(e?.createdAt ?? '')).filter(Number.isFinite);
  if (times.length < 2) return { ok: false, reason: 'Run events have no usable timestamps.' };
  const span = Math.max(...times) - Math.min(...times);
  if (span < MIN_RUN_DURATION_MS) {
    return { ok: false, reason: `Run completed implausibly fast (${Math.round(span / 1000)}s from first to last event; minimum ${MIN_RUN_DURATION_MS / 1000}s).` };
  }
  const unknown = [...new Set(list.map(e => e?.tool).filter(t => typeof t === 'string' && !KNOWN_TOOLS.has(t)))];
  if (unknown.length) {
    return { ok: false, reason: `Event chain references unknown tool(s): ${unknown.join(', ')}.` };
  }
  return { ok: true };
}
