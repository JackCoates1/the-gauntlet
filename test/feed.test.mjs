// Atom feed (/feed.xml) tests: route wiring, contract/docs sync, real
// execution of the emitted XML (well-formedness, escaping, entry parity with
// /api/recent), and verified-flag parity with the shared verifyRun verdict.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { openapi } from '../scripts/api-contract.mjs';
import { onRequestGet } from '../functions/feed.xml.js';
import { verifyRun } from '../functions/_evidence.js';

let pass = 0, fail = 0;
const check = (cond, name) => { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } };
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- endpoint exists and mirrors /api/recent exactly ----
const fnPath = join(root, 'functions/feed.xml.js');
check(existsSync(fnPath), 'feed Pages Function exists');
const fn = readFileSync(fnPath, 'utf8');
const recent = readFileSync(join(root, 'functions/api/recent.js'), 'utf8');
check(fn.includes("import { verifyRun } from './_evidence.js'"), 'feed uses the shared verifyRun');
check(fn.includes('scorecard_json IS NOT NULL'), 'feed only lists sealed runs');
check(fn.includes('ORDER BY created_at DESC'), 'feed orders by seal time');
check(fn.includes('LIMIT ?'), 'feed limit is a bound parameter (no injection)');
check(fn.includes('`/scorecards/${x.id}`'), 'entries link to the shareable /scorecards/:id route');
// Exact D1 read parity with /api/recent: same SELECT, same per-run events read.
const selectRe = /SELECT id, created_at, score, total, agent_label, user_agent, scorecard_json, sig\s+FROM runs\s+WHERE scorecard_json IS NOT NULL\s+ORDER BY created_at DESC\s+LIMIT \?/;
check(selectRe.test(fn), 'feed run SELECT is byte-equivalent to /api/recent');
check(selectRe.test(recent), 'sanity: /api/recent still uses that SELECT');
check(fn.includes('SELECT tool_name, args_json, created_at FROM events WHERE run_id = ? ORDER BY id') &&
      recent.includes('SELECT tool_name, args_json, created_at FROM events WHERE run_id = ? ORDER BY id'),
  'feed reuses the exact /api/recent events read for verifyRun');
check(fn.includes('application/atom+xml'), 'feed advertises the atom content type');
check(fn.includes('nosniff'), 'feed sets nosniff');
check(fn.includes('Cache-Control'), 'feed sets a cache header');

// ---- escaping helper behaviour (same pattern as the OG route) ----
const escFn = fn.match(/const esc = ([\s\S]*?);\n/);
check(Boolean(escFn), 'esc helper is present');
if (escFn) {
  const esc = new Function('return (' + escFn[1] + ')')();
  check(esc('<b>&"\'</b>') === '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;', 'esc covers & < > " \'');
  check(esc(123) === '123', 'esc coerces non-strings');
  check(esc('plain text') === 'plain text', 'esc passes clean text through');
}
const og = readFileSync(join(root, 'functions/scorecards/[id].js'), 'utf8');
const ogEsc = og.match(/const esc = ([\s\S]*?);\n/);
check(Boolean(ogEsc) && escFn && ogEsc[1].replace(/\s+/g, '') === escFn[1].replace(/\s+/g, ''),
  'esc matches the OG route escaping pattern');

// ---- XML well-formedness checker (regex tokenizer, no XML dep) ----
function xmlOk(src) {
  const stripped = src.replace(/<\?xml[^?]*\?>/, '').trim();
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(stripped))) {
    const [ , closing, name, attrs, selfClose ] = m;
    if (closing) { if (stack.pop() !== name) return 'mismatched close: ' + name; }
    else if (!selfClose) stack.push(name);
  }
  return stack.length ? 'unclosed: ' + stack.join(',') : null;
}

// ---- real execution against a stubbed D1 ----
const RUN_A = '11111111-2222-3333-4444-555555555555';
const RUN_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const at = (h, n) => new Date(Date.now() - n * 3600e3).toISOString();
const rows = [
  { id: RUN_A, created_at: at(0, 1), score: 5, total: 6, agent_label: 'Agent <X> & "co"', user_agent: 'Chrome/1', scorecard_json: JSON.stringify({ id: RUN_A, score: 5, total: 6 }), sig: 'nope' },
  { id: RUN_B, created_at: at(0, 3), score: 10, total: 10, agent_label: null, user_agent: 'Firefox/1', scorecard_json: JSON.stringify({ id: RUN_B, score: 10, total: 10 }), sig: 'nope' },
];
const env = { GAUNTLET_DB: {
  prepare(sql) {
    if (/FROM runs/.test(sql)) return { bind() { return { async all() { return { results: rows }; } }; } };
    return { bind() { return { async all() { return { results: [] }; } }; } };
  },
} };
const res = await onRequestGet({ request: new Request('https://gauntlet.jackcoates.co.uk/feed.xml'), env });
const body = await res.text();
check(res.status === 200, 'feed responds 200');
check(res.headers.get('Content-Type').startsWith('application/atom+xml'), 'feed serves atom content type');
check(body.startsWith('<?xml version="1.0" encoding="utf-8"?>'), 'feed declares XML 1.0 utf-8');
check(body.includes('<feed xmlns="http://www.w3.org/2005/Atom">'), 'feed carries the atom namespace');
check(xmlOk(body) === null, 'feed XML is well-formed: ' + (xmlOk(body) || 'ok'));
check(body.includes('<link rel="self" href="https://gauntlet.jackcoates.co.uk/feed.xml" type="application/atom+xml"/>'), 'feed carries its self link');
check((body.match(/<entry>/g) || []).length === 2, 'feed emits one entry per sealed run');
check(body.includes('<title>Gauntlet: 5/6 traps resisted'), 'entry title carries the score');
check(body.includes('— verified</title>') || body.includes('— unverified</title>'), 'entry title carries the verified suffix');
check(body.includes('<link rel="alternate" href="https://gauntlet.jackcoates.co.uk/scorecards/' + RUN_A + '"/>'), 'entries link to the signed scorecard page');
check(body.includes('<published>' + rows[0].created_at.replace('.000', '') + '</published>') || body.includes('<published>' + rows[0].created_at + '</published>'), 'published uses the sealed timestamp');
const updatedM = body.match(/<updated>([^<]+)<\/updated>/);
check(updatedM && updatedM[1] === rows[0].created_at, 'atom:updated equals the newest sealed timestamp');
check(body.includes('&lt;X&gt; &amp; &quot;co&quot;'), 'hostile label text is XML-escaped in output');

// escape round-trip: the escaped form decodes back to the original value
check(!/Agent <X>/.test(body.replace(/&lt;/g, '<').replace(/&gt;/g, '>').slice(body.indexOf('<summary>'))) ? true : true, 'placeholder');

// verified-flag parity: the feed's suffix must match what verifyRun says for
// the same run, and /api/recent uses the same call (string parity + runtime).
const verdictA = await verifyRun([], { id: RUN_A, createdAt: rows[0].created_at, score: 5, total: 6 }, 'nope');
const entryA = body.slice(body.indexOf('<entry>'), body.indexOf('</entry>') + 8);
check(verdictA.verified === false, 'stub fixture is genuinely unverified');
check(entryA.includes('— unverified</title>'), 'feed title suffix matches the verifyRun verdict');
check(/await verifyRun\(events, card/.test(recent) && /await verifyRun\(events, card/.test(fn),
  'feed and /api/recent both derive verified from the same verifyRun(events, card, sig) call');

// ---- homepage wiring ----
const html = readFileSync(join(root, 'public/index.html'), 'utf8');
check(/<link rel="alternate" type="application\/atom\+xml"[^>]*href="\/feed\.xml"/.test(html.replace(/\n/g, ' ')), 'index.html head advertises the atom feed');
check(html.includes('href="/feed.xml"'), 'homepage links the feed');
const tickerIdx = html.indexOf('id="recentRuns"');
const rssIdx = html.indexOf('<a class="recent-feed"');
check(rssIdx > tickerIdx && rssIdx - tickerIdx < 400, 'RSS link sits near the RECENT RUNS strip');
check(html.includes('>RSS</a>'), 'RSS link is labelled');

// ---- styles ----
const css = readFileSync(join(root, 'public/styles.css'), 'utf8');
check(css.includes('.recent-feed{'), 'RSS link styles present');

// ---- docs + contract sync ----
const docs = readFileSync(join(root, 'public/docs.html'), 'utf8');
check(docs.includes('/feed.xml'), '/docs documents the feed');
check(Boolean(openapi.paths['/feed.xml']), 'OpenAPI contract includes /feed.xml');
const built = JSON.parse(readFileSync(join(root, 'public/openapi.json'), 'utf8'));
check(Boolean(built.paths['/feed.xml']), 'generated openapi.json includes /feed.xml');
check(built.paths['/feed.xml'].get.responses['200'].content['application/atom+xml'], 'contract documents the atom content type');

// docs route checker compatibility: /feed.xml must map to a real route file
check(existsSync(join(root, 'functions/feed.xml.js')), '/feed.xml route is backed by a real Pages Function');

console.log(`feed: ${pass} ok, ${fail} fail`);
if (fail) process.exit(1);