// API documentation page (public/docs.html) consistency tests.
// The docs are static, but they must never drift from the real API: every
// documented route string must match a route that actually exists in
// functions/, and every link on the page must resolve to a real local asset
// or the published GitHub repo.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (cond, name) => { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + name); } };

const html = readFileSync(join(root, 'public/docs.html'), 'utf8');

// 1. The page exists and is dark-branded off styles.css
check(html.includes('/styles.css'), 'docs page links the shared stylesheet');
check(/THE <i>GAUNTLET<\/i>/.test(html), 'docs page carries the brand nav');

// 2. Local links resolve to files that exist
const localHrefs = [...html.matchAll(/href="(\/[^"]*)"/g)].map(m => m[1].split('#')[0].split('?')[0]);
const uniqueLocal = [...new Set(localHrefs)];
for (const href of uniqueLocal) {
  const candidates = [
    join(root, 'public', href),
    join(root, 'public', href, 'index.html'),
    join(root, 'public', href + '.html'),
    join(root, 'functions', href, 'index.js'),          // functions route (GET)
  ];
  check(candidates.some(existsSync), `local link resolves: ${href}`);
}

// 3. Every documented API route string corresponds to a real route in functions/
const functionsDir = join(root, 'functions');
const functionFiles = [];
(function walk(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith('.js')) functionFiles.push(relative(functionsDir, p).split('\\').join('/'));
  }
})(functionsDir);
// Route file names: [id].js -> :id, [id].svg.js -> :id.svg, index.js -> the dir
const realRoutes = new Set(functionFiles.map(f =>
  f.replace(/index\.js$/, '').replace(/\[([^\]]+)\]\.svg\.js$/, ':$1.svg').replace(/\[([^\]]+)\]\.js$/, ':$1').replace(/\.js$/, '').replace(/\/$/, '')
));

// Documented method+path pairs, extracted from the page markup
const docRoutes = [...html.matchAll(/class="method m-(post|get)"[\s\S]*?<span class="path">([^<]+)<\/span>/g)]
  .map(m => ({ method: m[1].toUpperCase(), path: m[2].replace(/&amp;/g, '&') }));
check(docRoutes.length >= 8, `found ${docRoutes.length} documented routes (expected >= 8)`);

for (const { method, path } of docRoutes) {
  const base = path.split('?')[0];
  // Normalize documented path to a functions/ route file or public/ asset
  const norm = base
    .replace(/^\//, '')
    .replace(/:runId\b/g, '[id]')
    .replace(/:id\b/g, '[id]');
  const hit = [...realRoutes].some(r => {
    const rNorm = r.replace(/:id\b/g, '[id]');
    return rNorm === norm;
  }) || existsSync(join(root, 'public', base));
  check(hit, `documented route exists in functions/: ${method} ${path}`);
}

// 4. Rate-limit numbers in the docs match functions/_ratelimit.js
const rl = readFileSync(join(functionsDir, '_ratelimit.js'), 'utf8');
check(/events:\s*\{\s*max:\s*30/.test(rl), 'source confirms 30 events/min');
check(/seals:\s*\{\s*max:\s*5/.test(rl), 'source confirms 5 seals/hour');
check(rl.includes('Retry-After'), 'source confirms Retry-After');
check(html.includes('30'), 'docs mention 30 events/min');
check(html.includes('Retry-After'), 'docs mention Retry-After');
check(/5\s*per\s*IP|5 seals/.test(html), 'docs mention 5 seals/hour');

// 5. Proof-of-interaction rules match the source
check(/MIN_RUN_DURATION_MS\s*=\s*(\d+)_?000/.test(rl), 'source has min run duration');
const minSec = Number(rl.match(/MIN_RUN_DURATION_MS\s*=\s*(\d+)_?000/)?.[1] ?? 0);
check(minSec >= 10, `min run duration is >=10s (got ${minSec}s)`);
check(html.includes('10 seconds') && html.includes('2 events'), 'docs state the 10s / 2-event seal requirements');

// 6. Published public key in the docs matches functions/_evidence.js
const ev = readFileSync(join(functionsDir, '_evidence.js'), 'utf8');
const pubKey = ev.match(/PUBLIC_KEY_HEX\s*=\s*'([0-9a-f]+)'/)?.[1];
check(!!pubKey && pubKey.length === 64, 'evidence module publishes a 64-hex public key');
check(html.includes(pubKey), 'docs page shows the exact published public key');

// 7. Known tool list in the docs matches KNOWN_TOOLS in _ratelimit.js
const knownBlock = rl.match(/export const KNOWN_TOOLS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
const knownTools = [...knownBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);
check(knownTools.length >= 15, `KNOWN_TOOLS extracted (${knownTools.length} tools)`);
for (const t of knownTools) check(html.includes(`>${t}<`) || new RegExp(`[^a-zA-Z]${t}[^a-zA-Z]`).test(html), `docs list known tool: ${t}`);

// 8. Walkthrough curl block covers the full flow
check(html.includes('curl -s -X POST $BASE/api/events'), 'walkthrough ingests events via curl');
check(html.includes('$BASE/api/scorecards/$RUN'), 'walkthrough seals via curl');
check(html.includes('$BASE/api/scorecards/$RUN/evidence'), 'walkthrough fetches evidence via curl');
check(html.includes('Ed25519'), 'walkthrough verifies offline with Ed25519');
check(html.includes('embed/gauntlet-traps/traps.mjs'), 'walkthrough links the embeddable library');

console.log(`\ndocs page tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
