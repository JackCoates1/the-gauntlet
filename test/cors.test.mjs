import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORS_HEADERS, corsPreflight, withCors } from '../functions/_lib.js';
import { onRequest } from '../functions/api/_middleware.js';
import { openapi } from '../scripts/api-contract.mjs';

let failures = 0;
const check = (name, condition) => { if (condition) console.log('ok:', name); else { failures++; console.error('FAIL:', name); } };
const root = join(fileURLToPath(new URL('..', import.meta.url)));

check('shared policy permits every public origin', CORS_HEADERS['access-control-allow-origin'] === '*');
check('shared policy permits browser API methods', CORS_HEADERS['access-control-allow-methods'] === 'GET, POST, OPTIONS');
check('shared policy permits JSON Content-Type', CORS_HEADERS['access-control-allow-headers'] === 'Content-Type');
check('shared policy never enables credentials', !Object.hasOwn(CORS_HEADERS, 'access-control-allow-credentials'));

const preflight = corsPreflight();
check('OPTIONS preflight returns no-content', preflight.status === 204 && preflight.body === null);
for (const [name, value] of Object.entries(CORS_HEADERS)) check(`preflight includes ${name}`, preflight.headers.get(name) === value);

let calls = 0;
const json = await onRequest({
  request: new Request('https://gauntlet.example/api/leaderboard', { headers: { Origin: 'https://dashboard.example' } }),
  next: async () => { calls++; return Response.json({ runs: [] }, { headers: { 'x-endpoint': 'leaderboard' } }); },
});
check('sample JSON API response keeps endpoint headers', json.headers.get('x-endpoint') === 'leaderboard');
check('sample JSON API response gets CORS', json.headers.get('access-control-allow-origin') === '*');
check('GET passes through to the endpoint once', calls === 1);

const csv = await onRequest({
  request: new Request('https://gauntlet.example/api/leaderboard.csv'),
  next: async () => new Response('run_id', { headers: { 'content-type': 'text/csv' } }),
});
check('sample CSV API response gets CORS', csv.headers.get('access-control-allow-origin') === '*');

calls = 0;
const options = await onRequest({
  request: new Request('https://gauntlet.example/api/events', { method: 'OPTIONS', headers: { Origin: 'https://notebook.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } }),
  next: async () => { calls++; return new Response('should not run'); },
});
check('POST /api/events preflight is answered before the endpoint', options.status === 204 && calls === 0);
check('POST /api/events preflight allows POST and Content-Type', options.headers.get('access-control-allow-methods').includes('POST') && options.headers.get('access-control-allow-headers') === 'Content-Type');

const headersFile = readFileSync(join(root, 'public/_headers'), 'utf8');
check('static OpenAPI contract is CORS-readable', /\/openapi\.json\s*\n\s*Access-Control-Allow-Origin:\s*\*/.test(headersFile));
check('docs explain browser CORS integration', readFileSync(join(root, 'public/docs.html'), 'utf8').includes('Browser-ready integration.'));
check('OpenAPI contract declares the browser CORS policy', openapi['x-cors']?.allowOrigins?.[0] === '*' && openapi['x-cors'].allowMethods.includes('POST') && openapi['x-cors'].allowHeaders.includes('Content-Type'));

if (failures) process.exit(1);
