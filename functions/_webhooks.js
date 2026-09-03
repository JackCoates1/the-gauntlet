// Signed seal webhooks — push notifications when a new verified run lands.
//
// Every registered subscriber gets an HMAC-SHA256 secret at registration time.
// On each successful seal we fire-and-forget a POST containing the run ID,
// score, verified flag and the same event-chain root used in the seal payload.
// The request is signed with the subscriber's own secret:
//   X-Gauntlet-Signature: t=<unix-seconds>,v1=<hex hmac of "<ts>.<body>">
// This deliberately mirrors (with a lighter per-subscriber scheme) the
// platform-wide Ed25519 story: every notification is verifiable.

const WEBHOOK_TIMEOUT_MS = 5000;
const RETRY_BACKOFF_MS = 500;

// Validate a subscriber URL: https only, no credentials, no localhost /
// private-IP literals (a public research platform should not become an SSRF
// relay into someone's intranet).
export function validateWebhookUrl(raw) {
  if (typeof raw !== 'string' || raw.length < 12 || raw.length > 500) {
    return { ok: false, reason: 'url must be a string of 12-500 characters' };
  }
  let u;
  try { u = new URL(raw); } catch { return { ok: false, reason: 'url is not a valid absolute URL' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'only https:// webhook URLs are accepted' };
  if (u.username || u.password) return { ok: false, reason: 'webhook URLs must not contain credentials' };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    return { ok: false, reason: 'webhook URLs must not point at localhost/internal hosts' };
  }
  if (host.includes(':')) {
    // IPv6 literal: reject loopback, link-local and unique-local addresses.
    const v6 = host.toLowerCase();
    const bad6 = v6 === '::1' || v6 === '::' || /^(f[cd]|fe[89ab])/.test(v6) || /^0+1?$/.test(v6);
    if (bad6) return { ok: false, reason: 'webhook URLs must not point at private IPv6 addresses' };
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const parts = host.split('.').map(Number);
    const private_ = parts[0] === 10 || parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) || parts[0] === 0 || parts[0] >= 224;
    if (private_) return { ok: false, reason: 'webhook URLs must not point at private IP addresses' };
  }
  return { ok: true, url: u.toString() };
}

export function newWebhookSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSign(secretHex, message) {
  const bytes = new Uint8Array(secretHex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

// Build the signed request for one subscriber. Exported so receivers (and
// tests) can verify the signature scheme independently of delivery.
export async function buildWebhookRequest(hook, payload, nowMs = Date.now()) {
  const body = JSON.stringify(payload);
  const ts = Math.floor(nowMs / 1000);
  const v1 = await hmacSign(hook.secret, `${ts}.${body}`);
  return {
    url: hook.url,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Gauntlet-Seal-Webhook/1.0',
        'x-gauntlet-signature': `t=${ts},v1=${v1}`,
        'x-gauntlet-event': 'run.sealed',
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    },
  };
}

async function postOnce(url, init) {
  try {
    const res = await fetch(url, init);
    return res.ok;
  } catch { return false; }
}

// Deliver to one subscriber with a retry-once-with-backoff guard. Never
// throws — a slow or dead subscriber must never fail a seal.
export async function deliverWebhook(hook, payload) {
  const { url, init } = await buildWebhookRequest(hook, payload);
  if (await postOnce(url, init)) return true;
  await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
  return postOnce(url, { ...init, signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS) });
}

// Fire-and-forget notification to every registered webhook. The caller does
// not await this (though awaiting it is harmless and what tests do); the
// Workers runtime is given the best lifetime we can obtain.
export async function notifyWebhooks(env, payload) {
  let rows;
  try {
    rows = await env.GAUNTLET_DB.prepare('SELECT url, secret FROM webhooks').all();
  } catch { return; } // table not migrated yet — never break a seal
  const hooks = rows.results || [];
  if (!hooks.length) return;
  for (const hook of hooks) {
    try { await deliverWebhook(hook, payload); } catch { /* never propagate */ }
  }
}
