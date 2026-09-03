// Machine-readable API contract tests. The generated file is intentionally
// checked against the shared contract, real Pages routes, and human docs.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openapi } from '../scripts/api-contract.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(join(root, 'public/openapi.json'), 'utf8'));
let pass = 0, fail = 0;
const check = (cond, name) => { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } };

check(spec.openapi === '3.1.0', 'uses OpenAPI 3.1');
check(JSON.stringify(spec) === JSON.stringify(openapi), 'openapi.json is generated from the shared contract');
check(spec.servers?.[0]?.url === 'https://gauntlet.jackcoates.co.uk', 'production server is declared');

for (const [path, item] of Object.entries(spec.paths)) {
  const normalized = path.replace(/^\//, '').replace(/\{runId\}/g, '[id]').replace(/\[id\]\.svg$/, '[id].svg');
  const functionPath = join(root, 'functions', normalized + '.js');
  const publicPath = join(root, 'public', path);
  check(existsSync(functionPath) || existsSync(publicPath), `spec path has a real route or public asset: ${path}`);
  for (const method of Object.keys(item)) check(['get', 'post'].includes(method), `${path} exposes an HTTP operation`);
}

const docs = readFileSync(join(root, 'public/docs.html'), 'utf8');
check(docs.includes('href="/openapi.json"'), 'docs link to the generated spec');
check(/Postman|Insomnia/.test(docs), 'docs tell judges how to import the spec');
const docPaths = [...docs.matchAll(/class="path">([^<]+)/g)].map(m => m[1].replace(/&amp;/g, '&').split('?')[0].replace(/:runId/g, '{runId}'));
for (const path of docPaths) check(Object.hasOwn(spec.paths, path), `human docs route appears in OpenAPI: ${path}`);

const events = spec.paths['/api/events'].post;
const seal = spec.paths['/api/scorecards/{runId}'].post;
check(events.description.includes('30 requests per IP per sliding minute'), 'event rate limit is documented in contract');
check(events.description.includes('200 events') && events.responses['413'], 'event caps are documented in contract');
check(seal.description.includes('5 requests per IP per sliding hour') && seal.description.includes('10 seconds'), 'seal rate and plausibility constraints are documented in contract');
check(seal.responses['429'].headers['Retry-After'], '429 response declares Retry-After');

console.log(`\nOpenAPI tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
