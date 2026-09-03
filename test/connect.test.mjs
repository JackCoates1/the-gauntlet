// /connect page ("RUN YOUR OWN AGENT" quickstart) consistency tests.
// The page is generated, but it must never drift from the real range:
// every tool name it shows must exist in KNOWN_TOOLS and public/app.js,
// and every documented endpoint must map to a real functions/ route or
// public asset.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (cond, name) => { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } };

// Regenerate the page from source first, so the committed file is fresh.
execFileSync(process.execPath, [join(root, 'scripts/build-connect-page.mjs')], { cwd: root });

const html = readFileSync(join(root, 'public/connect.html'), 'utf8');

// 1. Page exists, is dark-branded off the shared stylesheet, has nav
check(html.includes('/styles.css'), 'connect page links the shared stylesheet');
check(/THE <i>GAUNTLET<\/i>/.test(html), 'connect page carries the brand nav');
check(html.includes('/connect.js'), 'connect page wires its copy-button script');

// 2. Local links resolve
const localHrefs = [...html.matchAll(/href="(\/[^"]*)"/g)].map(m => m[1].split('#')[0].split('?')[0]);
for (const href of [...new Set(localHrefs)]) {
  const candidates = [
    join(root, 'public', href),
    join(root, 'public', href, 'index.html'),
    join(root, 'public', href + '.html'),
    join(root, 'functions', href, 'index.js'),
  ];
  check(candidates.some(existsSync), `local link resolves: ${href}`);
}

// 3. Every tool name shown in the tool table exists in the range source
const appJs = readFileSync(join(root, 'public/app.js'), 'utf8');
const appTools = new Set([...appJs.matchAll(/\{ name:'([a-zA-Z0-9_]+)'/g)].map(m => m[1]));
const rl = readFileSync(join(root, 'functions/_ratelimit.js'), 'utf8');
const knownTools = new Set([...rl.matchAll(/'([a-zA-Z0-9_]+)',?\n/g)].map(m => m[1]).filter(t =>
  /sessionStarted|generateScorecard|searchProducts|getPrice|checkout|applyDiscount|check0ut|getReviews|sendPromo|deleteAccount|exportSession|bulkDelete|updateDisplayName|addToCart|getOrderStatus|purgeCart/.test(t)));
const knownRaw = rl.match(/KNOWN_TOOLS = new Set\(\[([\s\S]*?)\]\)/)[1];
for (const m of knownRaw.matchAll(/'([^']+)'/g)) knownTools.add(m[1]);
check(knownTools.size >= 15, `KNOWN_TOOLS parsed from source (${knownTools.size} entries)`);

const tableTools = [...html.matchAll(/<tr><td><code class="inline">([a-zA-Z0-9_]+)<\/code><\/td>/g)].map(m => m[1]);
check(tableTools.length >= 15, `tool table lists ${tableTools.length} tools`);
for (const t of tableTools) {
  check(appTools.has(t), `table tool "${t}" is registered in public/app.js`);
  check(knownTools.has(t), `table tool "${t}" is in KNOWN_TOOLS`);
}
// Conversely: every registerable app.js tool appears in the table
for (const t of appTools) check(tableTools.includes(t), `app.js tool "${t}" is documented on /connect`);
// The full ledger vocabulary is spelled out on the page
check(html.includes('sessionStarted'), 'page mentions the sessionStarted bookkeeping event');

// 4. Every documented endpoint maps to a real functions/ route or public asset
const functionFiles = [];
(function walk(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith('.js')) functionFiles.push(relative(join(root, 'functions'), p).split('\\').join('/'));
  }
})(join(root, 'functions'));
const realRoutes = new Set(functionFiles.map(f =>
  f.replace(/index\.js$/, '').replace(/\[([^\]]+)\]\.svg\.js$/, ':$1.svg').replace(/\[([^\]]+)\]\.js$/, ':$1').replace(/\.js$/, '').replace(/\/$/, '')
));
// Full URLs on the page. Exclude the first slash so '/api/events' -> 'api/events',
// and normalize the $RUN_ID curl placeholder to the [id] route shape.
const endpoints = [...new Set([...html.matchAll(/https:\/\/gauntlet\.jackcoates\.co\.uk(\/[a-zA-Z0-9$/_{}.\-]*)/g)].map(m => m[1]))];
for (const ep of endpoints) {
  const base = ep.replace('$RUN_ID', ':id').split('?')[0];
  const norm = base.replace(/^\//, '').replace(/:id\b/g, '[id]');
  const hit = [...realRoutes].some(r => r.replace(/:id\b/g, '[id]') === norm)
    || existsSync(join(root, 'public', base))
    || base.startsWith('/scorecard'); // static shell + /scorecards/:id OG alias
  check(hit, `documented endpoint exists: ${base}`);
}

// 5. Rate-limit + plausibility numbers match the source
check(/events:\s*\{\s*max:\s*30/.test(rl), 'source confirms 30 events/min');
check(/seals:\s*\{\s*max:\s*5/.test(rl), 'source confirms 5 seals/hour');
const minMs = Number(rl.match(/MIN_RUN_DURATION_MS\s*=\s*([\d_]+)/)?.[1]?.replace(/_/g, '') ?? 0);
check(minMs >= 10000, `source min run span is >=10s (${minMs}ms)`);
check(html.includes('30 events per minute') && html.includes('5 seals per hour'), 'page states the live rate limits');
check(html.includes('≥ 10s') || html.includes('≥ 10s from first to last'), 'page states the >=10s span rule');
check(html.includes('422') && html.includes('Retry-After'), 'page documents 422 seal rejections and Retry-After');
check(html.includes('implausibly fast') || html.includes('implausibly'), 'page explains the instant-fake-run rejection');

// 6. The page is a quickstart: snippet, curl flow, troubleshooting present
check(html.includes('registerTool'), 'page shows the WebMCP registerTool snippet');
check(html.includes('crypto.randomUUID'), 'snippet creates a run id');
check(html.includes('/api/events') && html.includes('/api/scorecards/'), 'curl walkthrough hits the real ingest + seal endpoints');
check(html.toLowerCase().includes('troubleshooting'), 'page has a troubleshooting section');
check(html.includes('data-copy'), 'page has copy buttons wired to snippet blocks');
check(html.includes('NO LOCAL CONFIG') && html.includes('claude_desktop_config.json'), 'page explains why a desktop MCP-server config does not apply');
check(html.includes('ChatGPT’s in-app browser') && html.includes('chrome://flags/#enable-webmcp-testing'), 'page makes the zero-code browser path explicit');

// 7. Safety guards: textContent-only JS, no raw HTML injection in the generator
const connectJs = readFileSync(join(root, 'public/connect.js'), 'utf8');
const noWrite = t => t.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const noWriteJs = noWrite(connectJs);
check(!noWriteJs.includes('innerHTML') && !noWriteJs.includes('insertAdjacentHTML') && !noWriteJs.includes('document.write'), 'connect.js never writes HTML');
const buildSrc = readFileSync(join(root, 'scripts/build-connect-page.mjs'), 'utf8');
check(buildSrc.includes("esc =") && buildSrc.includes('${esc(snippet)}') && buildSrc.includes('${esc(curlWalkthrough)}'), 'build script HTML-escapes the copyable blocks');

console.log(`\nconnect page tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
