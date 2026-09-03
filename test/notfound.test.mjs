// Branded 404: preserve real HTTP semantics, do not shadow APIs/assets, and
// keep untrusted recent-run labels out of HTML sinks.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPassthroughPath, onRequest } from '../functions/[[path]].js';

let pass = 0, fail = 0;
const check = (condition, name) => { if (condition) pass++; else { fail++; console.error('FAIL: ' + name); } };
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = join(root, 'public', '404.html');
const clientPath = join(root, 'public', '404.js');
const page = readFileSync(pagePath, 'utf8');
const client = readFileSync(clientPath, 'utf8');
const fn = readFileSync(join(root, 'functions', '[[path]].js'), 'utf8');

check(existsSync(pagePath), 'top-level public/404.html exists (disables Pages SPA fallback)');
check(page.includes('404 — OFF THE RANGE.') && page.includes("This route isn't part of The Gauntlet"), '404 carries the requested brand copy');
check(page.includes('href="/"') && page.includes('href="/traps"') && page.includes('href="/demo"'), '404 offers home, traps, and demo navigation');
check(page.includes('id="lostRecentRuns"') && page.includes('/404.js'), '404 includes the live recent-runs panel');
check(page.includes('name="robots" content="noindex"'), '404 is noindex');
check(client.includes("fetch('/api/recent?limit=3')"), '404 fetches exactly three recent runs');
check(!/\.innerHTML\s*=/.test(client), '404 client has no innerHTML sink');
check(client.includes('textContent') && client.includes('createElement'), '404 client renders API data as DOM text');
check(client.includes('validScorecard') && client.includes("'/leaderboard'"), '404 validates run links before navigation');

check(isPassthroughPath('/api/recent'), 'API prefix is excluded from catch-all');
check(isPassthroughPath('/api'), 'bare API prefix is excluded from catch-all');
check(isPassthroughPath('/styles.css') && isPassthroughPath('/favicon.svg'), 'static asset paths are excluded from catch-all');
check(isPassthroughPath('/') && isPassthroughPath('/traps') && isPassthroughPath('/docs/'), 'extensionless static pages are excluded from catch-all');
check(!isPassthroughPath('/nonexistent-page-xyz') && !isPassthroughPath('/some/missing/path'), 'unmatched public paths reach the 404 handler');
check(fn.includes('env.ASSETS.fetch') && fn.includes('status: 404'), 'catch-all fetches the static shell and returns status 404');

const html = '<!doctype html><title>404 — OFF THE RANGE.</title>';
const assets = { fetch: async (url) => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Test': new URL(url).pathname } }) };
let nextCalls = 0;
const missing = await onRequest({ request: new Request('https://gauntlet.example/nope'), env: { ASSETS: assets }, next: async () => { nextCalls++; return new Response('next'); } });
check(missing.status === 404 && missing.statusText === 'Not Found', 'unknown public route returns HTTP 404');
check((await missing.text()) === html, 'unknown public route serves the checked-in 404 asset');
check(missing.headers.get('X-Test') === '/404.html', 'catch-all reads public/404.html through ASSETS');
const api = await onRequest({ request: new Request('https://gauntlet.example/api/recent'), env: { ASSETS: assets }, next: async () => { nextCalls++; return new Response('api'); } });
check(await api.text() === 'api' && nextCalls === 1, 'API route is passed through instead of converted to HTML 404');
const asset = await onRequest({ request: new Request('https://gauntlet.example/styles.css'), env: { ASSETS: assets }, next: async () => { nextCalls++; return new Response('asset'); } });
check(await asset.text() === 'asset' && nextCalls === 2, 'asset route is passed through instead of converted to HTML 404');
const staticPage = await onRequest({ request: new Request('https://gauntlet.example/traps'), env: { ASSETS: assets }, next: async () => { nextCalls++; return new Response('traps'); } });
check(await staticPage.text() === 'traps' && nextCalls === 3, 'extensionless static page is passed through instead of converted to HTML 404');
const head = await onRequest({ request: new Request('https://gauntlet.example/nope', { method: 'HEAD' }), env: { ASSETS: assets }, next: async () => new Response('next') });
check(head.status === 404 && (await head.text()) === '', 'unknown HEAD route keeps 404 status without an HTML body');

console.log(`notfound: ${pass} ok, ${fail} fail`);
if (fail) process.exit(1);
