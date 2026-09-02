// Ingest a tool-invocation event into the run ledger.
// Server-side hardening: strict schema validation, length caps, event rate
// limiting, and a JSON body size cap so a hostile client can't pollute the
// evidence ledger that scores are computed from.

const MAX_EVENTS_PER_RUN = 200;
const MAX_ARG_BYTES = 2048;
const MAX_TOOL_LEN = 64;

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

import { rateLimit, tooMany, clientIp } from '../_ratelimit.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 8192) return Response.json({ error: 'Payload too large' }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Anti-gaming: per-IP sliding-window cap so a scripted loop can't flood
  // the public ledger with forged events.
  const rl = await rateLimit(env, 'events', clientIp(request));
  if (!rl.ok) return tooMany(rl.retryAfter);

  const runId = typeof body.runId === 'string' ? body.runId : '';
  const event = body.event && typeof body.event === 'object' ? body.event : null;
  if (!uuidRe.test(runId)) return Response.json({ error: 'Invalid runId' }, { status: 400 });
  if (!event || typeof event.tool !== 'string' || !event.tool || event.tool.length > MAX_TOOL_LEN) {
    return Response.json({ error: 'Invalid event' }, { status: 400 });
  }

  // Args must be a JSON object of modest size — no nested payload dumping.
  let argsJson = '{}';
  if (event.args !== undefined) {
    if (event.args === null || typeof event.args !== 'object' || Array.isArray(event.args)) {
      return Response.json({ error: 'Invalid args' }, { status: 400 });
    }
    argsJson = JSON.stringify(event.args);
    if (argsJson.length > MAX_ARG_BYTES) return Response.json({ error: 'Args too large' }, { status: 413 });
  }

  const now = typeof event.createdAt === 'string' && isoRe.test(event.createdAt) ? event.createdAt : new Date().toISOString();
  const userAgent = typeof body.userAgent === 'string' ? body.userAgent.slice(0, 500) : null;

  // One run row (idempotent), then the event — but only if the run hasn't
  // exceeded its event budget, and never after the run has been scored.
  const run = await env.GAUNTLET_DB
    .prepare('INSERT OR IGNORE INTO runs (id,created_at,user_agent) VALUES (?,?,?)')
    .bind(runId, now, userAgent)
    .run();
  if (!run.success) return Response.json({ error: 'Ledger write failed' }, { status: 500 });

  const existing = await env.GAUNTLET_DB
    .prepare('SELECT COUNT(*) AS n, (SELECT scorecard_json FROM runs WHERE id = ?) AS card FROM events WHERE run_id = ?')
    .bind(runId, runId)
    .first();
  if (existing?.card) return Response.json({ error: 'Run already scored — evidence is sealed' }, { status: 409 });
  if ((existing?.n ?? 0) >= MAX_EVENTS_PER_RUN) return Response.json({ error: 'Event budget exceeded' }, { status: 429 });

  const insert = await env.GAUNTLET_DB
    .prepare('INSERT INTO events (run_id,tool_name,args_json,created_at) VALUES (?,?,?,?)')
    .bind(runId, event.tool, argsJson, now)
    .run();
  if (!insert.success) return Response.json({ error: 'Ledger write failed' }, { status: 500 });

  return Response.json({ ok: true });
}
