import { validateWebhookUrl, newWebhookSecret, hmacSign } from '../_webhooks.js';

// POST /api/webhooks — register a signed seal-webhook subscriber.
// GET /api/webhooks?secret=<signing secret> — self-service listing.
//
// Registration returns the generated HMAC signing secret exactly once; every
// subsequent notification from us is signed with it so receivers can verify
// authenticity (mirroring the platform's "everything is signed" story with a
// deliberately lighter per-subscriber scheme).

const secretRe = /^[0-9a-f]{64}$/;
const MAX_WEBHOOKS = 50;

export async function onRequestPost({ request, env }) {
  let data = {};
  try {
    const raw = await request.text();
    if (raw.length > 1024) return Response.json({ error: 'Payload too large' }, { status: 413 });
    data = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const check = validateWebhookUrl(data.url);
  if (!check.ok) return Response.json({ error: 'Invalid webhook URL: ' + check.reason }, { status: 400 });

  try {
    const count = await env.GAUNTLET_DB.prepare('SELECT COUNT(*) AS n FROM webhooks').first();
    if ((count?.n || 0) >= MAX_WEBHOOKS) {
      return Response.json({ error: 'Webhook registry is full' }, { status: 507 });
    }
    const secret = newWebhookSecret();
    await env.GAUNTLET_DB
      .prepare('INSERT INTO webhooks (url, secret, created_at) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET secret=excluded.secret, created_at=excluded.created_at')
      .bind(check.url, secret, new Date().toISOString())
      .run();
    return Response.json({ ok: true, url: check.url, secret, message: 'Sign every notification with HMAC-SHA256 over "<unix-timestamp>.<body>" and compare to the X-Gauntlet-Signature header (t=<ts>,v1=<hex>).' });
  } catch (e) {
    // Table not migrated yet or D1 unavailable.
    return Response.json({ error: 'Webhook registry unavailable' }, { status: 503 });
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret') || '';
  if (!secretRe.test(secret)) {
    return Response.json({ error: 'Provide the hex signing secret you received at registration (query: ?secret=)' }, { status: 400 });
  }
  try {
    const rows = await env.GAUNTLET_DB
      .prepare('SELECT url, created_at FROM webhooks WHERE secret = ?')
      .bind(secret)
      .all();
    return Response.json({ hooks: rows.results || [] });
  } catch {
    return Response.json({ error: 'Webhook registry unavailable' }, { status: 503 });
  }
}
