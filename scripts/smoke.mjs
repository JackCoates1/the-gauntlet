// Post-deploy live smoke test. Plain fetch, zero dependencies — asserts the
// deployed production site actually serves what it should so a Pages path
// regression, stripped asset or bad deploy fails CI within a minute of
// shipping instead of being noticed by a human later.
//
// Usage: node scripts/smoke.mjs [baseUrl]
//   baseUrl defaults to GAUNTLET_URL, then https://gauntlet.jackcoates.co.uk

const BASE = (process.argv[2] || process.env.GAUNTLET_URL || 'https://gauntlet.jackcoates.co.uk').replace(/\/+$/, '');
const KNOWN_SCORECARD = 'bcb36e29-75c0-43c1-a8ff-fcbe010991ba';

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log('  ok  ' + name); };
const bad = (name, detail) => { fail++; console.error('FAIL  ' + name + (detail ? ' — ' + detail : '')); };
const check = (cond, name, detail) => cond ? ok(name) : bad(name, detail);

const get = async (path) => {
  const res = await fetch(BASE + path, { redirect: 'follow' });
  return res;
};

async function expectPage(path, markers) {
  const res = await get(path);
  const text = await res.text();
  check(res.status === 200, `GET ${path} -> 200`, `got ${res.status}`);
  for (const m of markers) {
    check(text.includes(m), `GET ${path} contains "${m}"`);
  }
}

async function expectJson(path, extra) {
  const res = await get(path);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* handled below */ }
  check(res.status === 200 && body !== null, `GET ${path} -> 200 JSON`, `status ${res.status}, parse ${body === null ? 'failed' : 'ok'}`);
  if (body && extra) extra(body, res);
}

console.log(`Smoke-testing ${BASE}\n`);

// 1-7: core pages return 200 with expected content markers.
await expectPage('/', ['Gauntlet', 'WebMCP']);
await expectPage('/traps', ['trap']);
await expectPage('/docs', ['API']);
await expectPage('/leaderboard', ['Gauntlet']);
await expectPage('/digest', ['Gauntlet']);
await expectPage('/demo', ['Gauntlet']);
await expectPage('/verify', ['Gauntlet']);

// 8-9: research APIs return valid JSON with the current trap count.
await expectJson('/api/recent', (b) => {
  check(Array.isArray(b.runs ?? b), '/api/recent returns an array of runs');
});
await expectJson('/api/trapstats', (b) => {
  check((b.community && b.community.possibleTraps) === 13, '/api/trapstats possibleTraps === 13', `got ${b.community && b.community.possibleTraps}`);
  check(Array.isArray(b.traps) && b.traps.length === 13, '/api/trapstats lists 13 traps');
});

// 10: OpenAPI contract parses and documents the recent-runs path.
{
  const res = await get('/openapi.json');
  let spec = null;
  try { spec = JSON.parse(await res.text()); } catch { /* below */ }
  check(res.status === 200 && !!spec, '/openapi.json parses as JSON');
  check(!!spec && !!spec.paths['/api/recent'], '/openapi.json contains the /api/recent path');
}

// 11: Atom feed served with the right content type.
{
  const res = await get('/feed.xml');
  const ct = String(res.headers.get('content-type') || '');
  check(res.status === 200, '/feed.xml -> 200', `got ${res.status}`);
  check(ct.includes('application/atom+xml'), '/feed.xml is application/atom+xml', ct);
}

// 12: a known sealed scorecard's dynamic OG route still renders.
{
  const res = await get(`/scorecards/${KNOWN_SCORECARD}`);
  check(res.status === 200, `/scorecards/${KNOWN_SCORECARD} -> 200`, `got ${res.status}`);
}

// 13-14: the shipped app/verify assets are not stripped and still carry the
// 12th deriveScore predicate plus the newest KNOWN_TOOLS entries.
{
  const app = await (await get('/app.js')).text();
  check(app.includes('cancelOrder') && app.includes('bulkReorder'), '/app.js contains the 12th-trap tools (cancelOrder, bulkReorder)');
  check(/getOrderStatus/.test(app) && /scope-creep|cancelOrder/.test(app), '/app.js still wires trap-12 predicate logic');
  const verify = await (await get('/verify.js')).text();
  check(verify.includes('bulkReorder'), '/verify.js contains the 12th deriveScore predicate (bulkReorder trap)');
  check(app.includes('syncLoyaltyAccount'), '/app.js contains the 13th-trap tool (syncLoyaltyAccount)');
  check(verify.includes('payment_token'), '/verify.js contains the 13th deriveScore predicate (error-channel credential phishing)');
}

console.log(`\nsmoke: ${pass} passed, ${fail} failed against ${BASE}`);
process.exit(fail ? 1 : 0);
