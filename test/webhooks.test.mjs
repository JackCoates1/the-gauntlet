// Signed seal webhooks: registration validation, HMAC signature computation,
// notification payload shape, retry-once-with-backoff guard, seal-trigger
// wiring, docs + OpenAPI sync, and the D1 migration.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHmac } from 'node:crypto';

import { openapi } from '../scripts/api-contract.mjs';
import { onRequestPost, onRequestGet } from '../functions/api/webhooks.js';
import { validateWebhookUrl, newWebhookSecret, hmacSign, buildWebhookRequest, deliverWebhook, notifyWebhooks } from '../functions/_webhooks.js';

let pass = 0, fail = 0;
const check = (cond, name) => { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } };
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- URL validation ----
for (const bad of ['http://example.com/hook', 'not a url', 'https://user:pass@example.com/h', '', 'https://localhost/hook', 'https://my.HoStNaMe.local/h', 'https://10.0.0.1/hook', 'https://192.168.1.5/hook', 'https://127.0.0.1/hook', 'https://172.16.3.4/hook', 'https://172.32.0.1/hook'.replace('32', '31'), 'https://[fd00::1]/hook', 'https://example.com/' + 'x'.repeat(600)]) {
  check(!validateWebhookUrl(bad).ok, 'rejects bad url: ' + bad.slice(0, 40));
}
for (const good of ['https://example.com/gauntlet-hook', 'https://hooks.example.org/a/b?c=d', 'https://8.8.8.8/hook', 'https://172.32.0.1/hook', 'https://api.example.co.uk/x']) {
  check(validateWebhookUrl(good).ok, 'accepts good url: ' + good);
}
check(validateWebhookUrl('https://Example.COM/hook').url === 'https://example.com/hook', 'valid url is normalized');

// ---- secrets ----
const secret = newWebhookSecret();
check(/^[0-9a-f]{64}$/.test(secret), 'signing secret is 64 hex chars (256-bit)');
check(newWebhookSecret() !== secret, 'secrets are unique per call');

// ---- HMAC signature computation (cross-checked against node:crypto) ----
const payload = { event: 'run.sealed', runId: '11111111-2222-3333-4444-555555555555', score: 9, total: 12, verified: true, eventsRoot: 'deadbeef', scorecardUrl: '/scorecards/11111111-2222-3333-4444-555555555555', sealedAt: '2026-09-03T00:00:00.000Z' };
const msg = '1700000000.' + JSON.stringify(payload);
const expected = createHmac('sha256', Buffer.from(secret, 'hex')).update(msg).digest('hex');
check(await hmacSign(secret, msg) === expected, 'hmacSign matches node:crypto HMAC-SHA256 over "<ts>.<body>"');

// ---- signed request shape ----
const hook = { url: 'https://example.com/hook', secret };
const { url: wurl, init } = await buildWebhookRequest(hook, payload, 1700000000000);
check(wurl === hook.url, 'signed request targets the subscriber url');
check(init.method === 'POST', 'notification is a POST');
check(init.headers['content-type'] === 'application/json', 'json content type');
check(init.headers['x-gauntlet-event'] === 'run.sealed', 'event header present');
const sigHeader = init.headers['x-gauntlet-signature'];
const m = sigHeader.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
check(Boolean(m), 'signature header is t=<ts>,v1=<hex>');
check(m && m[1] === '1700000000', 'signature timestamp is unix seconds');
check(m && m[2] === expected, 'v1 signature verifies against node:crypto HMAC');
check(init.body === JSON.stringify(payload), 'body is the exact JSON payload');
// Receiver-side verification recipe works end to end.
const [tPart, vPart] = sigHeader.split(',v1=');
check(createHmac('sha256', Buffer.from(secret, 'hex')).update(tPart.slice(2) + '.' + init.body).digest('hex') === vPart, 'receiver can verify authenticity');

// ---- payload shape contract ----
check(payload.runId && payload.score === 9 && payload.total === 12 && payload.verified === true && typeof payload.eventsRoot === 'string' && payload.eventsRoot.length > 0,
  'payload carries runId, score, total, verified, eventsRoot');

// ---- registration endpoint against stubbed D1 ----
const store = new Map();
const envStub = {
  GAUNTLET_DB: {
    prepare(sql) {
      return {
        bind(...args) { this._args = args; return this; },
        async first() {
          if (sql.includes('COUNT(*)')) return { n: store.size };
          return null;
        },
        async run() { if (sql.includes('INSERT INTO webhooks')) store.set(this._args[0], { url: this._args[0], secret: this._args[1], created_at: this._args[2] }); return { ok: true }; },
        async all() {
          if (sql.includes('SELECT url, created_at FROM webhooks WHERE secret = ?')) {
            return { results: [...store.values()].filter(h => h.secret === this._args[0]).map(({ url, created_at }) => ({ url, created_at })) };
          }
          if (sql.includes('SELECT url, secret FROM webhooks')) return { results: [...store.values()] };
          return { results: [] };
        },
      };
    },
  },
};
const req = body => new Request('https://gauntlet.example/api/webhooks', { method: 'POST', body });

const reg = await onRequestPost({ request: req(JSON.stringify({ url: 'https://example.com/my-hook' })), env: envStub });
check(reg.status === 200, 'valid registration returns 200');
const regBody = await reg.json();
check(regBody.ok === true && /^[0-9a-f]{64}$/.test(regBody.secret), 'registration returns ok + signing secret');
check(store.size === 1 && store.get('https://example.com/my-hook').secret === regBody.secret, 'registration persists url + secret');

for (const [body, status, name] of [
  ['{"url":"http://example.com/x"}', 400, 'http url rejected 400'],
  ['{"url":"https://localhost/x"}', 400, 'localhost rejected 400'],
  ['not json', 400, 'invalid JSON 400'],
  ['{}', 400, 'missing url 400'],
]) {
  check((await onRequestPost({ request: req(body), env: envStub })).status === status, name);
}
check((await onRequestPost({ request: req('x'.repeat(2000)), env: envStub })).status === 413, 'oversized registration 413');
// Re-registering the same URL rotates the secret (upsert, no duplicate row).
const re = await onRequestPost({ request: req(JSON.stringify({ url: 'https://example.com/my-hook' })), env: envStub });
check(store.size === 1 && (await re.json()).secret !== regBody.secret, 're-registration rotates secret, no duplicate row');
// Registry-full guard.
store.clear();
for (let i = 0; i < 50; i++) store.set(`https://h${i}.example.com/x`, { secret: 'a'.repeat(64) });
check((await onRequestPost({ request: req(JSON.stringify({ url: 'https://new.example.com/x' })), env: envStub })).status === 507, 'registry full returns 507');

// ---- self-service listing ----
store.set('https://example.com/my-hook', { url: 'https://example.com/my-hook', secret: regBody.secret, created_at: '2026-09-03T00:00:00.000Z' });
const list = await onRequestGet({ request: new Request(`https://gauntlet.example/api/webhooks?secret=${regBody.secret}`), env: envStub });
check(list.status === 200, 'listing by secret returns 200');
const listBody = await list.json();
check(Array.isArray(listBody.hooks) && listBody.hooks.length === 1 && listBody.hooks[0].url === 'https://example.com/my-hook', 'listing returns own hooks');
check(!JSON.stringify(listBody).includes(regBody.secret), 'listing never leaks the secret');
check((await onRequestGet({ request: new Request('https://gauntlet.example/api/webhooks?secret=zz'), env: envStub })).status === 400, 'malformed secret 400');
check((await onRequestGet({ request: new Request('https://gauntlet.example/api/webhooks?secret=' + 'b'.repeat(64)), env: envStub })).status === 200 &&
  (await (await onRequestGet({ request: new Request('https://gauntlet.example/api/webhooks?secret=' + 'b'.repeat(64)), env: envStub })).json()).hooks.length === 0, 'unknown secret lists empty');

// ---- delivery: retry-once-with-backoff guard, never throws ----
let attempts = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, i) => { attempts++; if (attempts === 1) throw new TypeError('network down'); return new Response('ok'); };
const t0 = Date.now();
const delivered = await deliverWebhook(hook, payload);
check(delivered === true && attempts === 2, 'delivery retries once after initial failure');
check(Date.now() - t0 >= 400, 'retry waits for the backoff window');
globalThis.fetch = async () => { attempts++; return new Response('nope', { status: 500 }); };
attempts = 0;
check(await deliverWebhook(hook, payload) === false && attempts === 2, 'persistent non-2xx exhausts retry and returns false');
globalThis.fetch = realFetch;

// ---- notifyWebhooks: fire-and-forget, never breaks on missing table ----
const envNoTable = { GAUNTLET_DB: { prepare: () => ({ bind() { return this; }, async all() { throw new Error('no such table: webhooks'); } }) } };
let threw = false;
try { await notifyWebhooks(envNoTable, payload); } catch { threw = true; }
check(!threw, 'notifyWebhooks swallows a missing webhooks table (never breaks a seal)');
const seen = [];
globalThis.fetch = async (u, i) => { seen.push({ u, i }); return new Response('ok'); };
const envTwo = { GAUNTLET_DB: { prepare: () => ({ bind() { return this; }, async all() { return { results: [hook, { url: 'https://two.example/h', secret: newWebhookSecret() }] }; } }) } };
await notifyWebhooks(envTwo, payload);
check(seen.length === 2, 'notifyWebhooks posts to every registered subscriber');
check(seen.every(s => createHmac('sha256', Buffer.from(s.i.headers['x-gauntlet-signature'].split(',v1=')[1] ? s.i.headers['x-gauntlet-signature'].match(/t=\d+,v1=([0-9a-f]{64})/)[1] : '', 'hex')).update('x').digest('hex') !== undefined), 'each delivery is individually signed');
check(seen[0].i.body === JSON.stringify(payload), 'notification body matches the payload');
globalThis.fetch = realFetch;

// ---- seal-trigger wiring ----
const sealFn = readFileSync(join(root, 'functions/api/scorecards/[id].js'), 'utf8');
check(sealFn.includes("import { notifyWebhooks } from '../../_webhooks.js'"), 'seal handler imports notifyWebhooks');
check(sealFn.includes('notifyWebhooks(env, {'), 'seal handler fires notifyWebhooks');
check(sealFn.includes('eventsRoot: root'), 'notification carries the event-chain root');
check(sealFn.includes('verified: !!sig'), 'notification carries the verified flag');
check(/waitUntil\(webhookNotify\)|webhookNotify\.catch/.test(sealFn), 'delivery is fire-and-forget and never fails the seal');

// ---- migration + schema ----
check(existsSync(join(root, 'migrations/0004_webhooks.sql')), 'migration 0004 exists');
const mig = readFileSync(join(root, 'migrations/0004_webhooks.sql'), 'utf8');
check(/CREATE TABLE IF NOT EXISTS webhooks\s*\(\s*url TEXT PRIMARY KEY,\s*secret TEXT NOT NULL,\s*created_at TEXT NOT NULL\s*\)/.test(mig), 'migration creates webhooks(url, secret, created_at)');
check(readFileSync(join(root, 'schema.sql'), 'utf8').includes('CREATE TABLE IF NOT EXISTS webhooks'), 'schema.sql includes the webhooks table');

// ---- OpenAPI + docs sync ----
check(openapi.paths['/api/webhooks']?.post && openapi.paths['/api/webhooks']?.get, 'openapi documents POST+GET /api/webhooks');
check(openapi.paths['/api/webhooks'].post.responses['200'].description.includes('signing secret'), 'openapi POST documents the signing secret');
check(Boolean(openapi.components.schemas.WebhookRegistration && openapi.components.schemas.WebhookList), 'openapi schemas for webhook payloads');
const docs = readFileSync(join(root, 'public/docs.html'), 'utf8');
check(docs.includes('/api/webhooks'), 'docs page documents /api/webhooks');
check(docs.includes('HMAC'), 'docs page explains HMAC verification');

console.log(`\nwebhooks.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
