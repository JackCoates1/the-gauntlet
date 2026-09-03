// Anti-gaming tests: per-IP sliding-window rate limiting and the
// proof-of-interaction plausibility check at seal time.
import { rateLimit, tooMany, clientIp, checkRunPlausibility, LIMITS, MIN_RUN_DURATION_MS, KNOWN_TOOLS } from '../functions/_ratelimit.js';
import { TRAP_DEFS } from '../functions/_lib.js';
import { onRequestPost as ingestEvent } from '../functions/api/events.js';
import { onRequestPost as sealRun } from '../functions/api/scorecards/[id].js';

let failures = 0;
function check(name, cond, extra = '') {
  if (!cond) { failures++; console.log('FAIL:', name, extra); } else console.log('ok:', name);
}

// Minimal in-memory D1 mock covering exactly the SQL the limiter issues.
class FakeDB {
  constructor() { this.rows = []; this.clock = 1_000_000; }
  prepare(sql) {
    const db = this;
    return {
      bind(...args) {
        const sql2 = sql;
        return {
          async run() {
            if (/INSERT INTO rate_limits/.test(sql2)) db.rows.push({ key: args[0], ts: args[1] });
            if (/DELETE FROM rate_limits/.test(sql2)) db.rows = db.rows.filter(r => r.ts > args[0]);
            return { success: true };
          },
          async first() {
            if (/COUNT\(\*\) AS n/.test(sql2)) return { n: db.rows.filter(r => r.key === args[0] && r.ts > args[1]).length };
            if (/MIN\(ts\) AS t/.test(sql2)) {
              const ts = db.rows.filter(r => r.key === args[0] && r.ts > args[1]).map(r => r.ts);
              return { t: ts.length ? Math.min(...ts) : null };
            }
            return null;
          },
        };
      },
    };
  }
}

const req = (ip = '1.2.3.4') => new Request('https://x/', { headers: { 'cf-connecting-ip': ip } });

// 1. clientIp prefers cf-connecting-ip, then x-forwarded-for.
check('clientIp uses cf header', clientIp(req('9.9.9.9')) === '9.9.9.9');
check('clientIp falls back to xff', clientIp(new Request('https://x/', { headers: { 'x-forwarded-for': '5.5.5.5, 1.1.1.1' } })) === '5.5.5.5');
check('clientIp unknown when absent', clientIp(new Request('https://x/')) === 'unknown');

// 2. Sliding window allows up to max, then 429 with Retry-After.
{
  const db = new FakeDB();
  const ip = '2.2.2.2';
  for (let i = 0; i < LIMITS.seals.max; i++) {
    const r = await rateLimit({ GAUNTLET_DB: db }, 'seals', ip);
    if (!r.ok) { check(`seal attempt ${i + 1} allowed`, false, JSON.stringify(r)); break; }
    if (i === LIMITS.seals.max - 1) check(`all ${LIMITS.seals.max} seals allowed`, true);
  }
  const blocked = await rateLimit({ GAUNTLET_DB: db }, 'seals', ip);
  check('seal over limit blocked', blocked.ok === false);
  check('blocked response carries Retry-After', Number.isFinite(blocked.retryAfter) && blocked.retryAfter >= 1, String(blocked.retryAfter));
  const resp = tooMany(blocked.retryAfter);
  check('429 status', resp.status === 429);
  check('Retry-After header present', resp.headers.get('Retry-After') === String(blocked.retryAfter));
  // Different IP unaffected.
  const other = await rateLimit({ GAUNTLET_DB: db }, 'seals', '3.3.3.3');
  check('separate IP unaffected', other.ok === true);
}

// 3. Events limit independent of seals limit (30/min, 5/hour).
{
  const db = new FakeDB();
  const ip = '4.4.4.4';
  let okCount = 0;
  for (let i = 0; i < LIMITS.events.max; i++) {
    if ((await rateLimit({ GAUNTLET_DB: db }, 'events', ip)).ok) okCount++;
  }
  check(`events window allows ${LIMITS.events.max}`, okCount === LIMITS.events.max, String(okCount));
  check('events limit is 30/min', LIMITS.events.max === 30 && LIMITS.events.windowMs === 60_000);
  const over = await rateLimit({ GAUNTLET_DB: db }, 'events', ip);
  check('event 31 blocked', over.ok === false);
  // Seals still fine on same IP.
  check('seals unaffected by events usage', (await rateLimit({ GAUNTLET_DB: db }, 'seals', ip)).ok === true);
}

// 4. Window expiry frees capacity.
{
  const db = new FakeDB();
  const env = { GAUNTLET_DB: db };
  const ip = '6.6.6.6';
  for (let i = 0; i < LIMITS.events.max; i++) await rateLimit(env, 'events', ip);
  check('at capacity before expiry', (await rateLimit(env, 'events', ip)).ok === false);
  // Age rows past the window entirely, then the DELETE purge runs on next call.
  db.rows.forEach(r => { r.ts -= LIMITS.events.windowMs + 1000; });
  check('window expiry frees capacity', (await rateLimit(env, 'events', ip)).ok === true);
}

// 5. Plausibility: too-fast server-received run rejected.
const iso = ms => new Date(ms).toISOString();
const fast = [
  { tool: 'sessionStarted', args: {}, createdAt: iso(0), receivedAt: 0 },
  { tool: 'checkout', args: {}, createdAt: iso(50), receivedAt: 50 },
];
{
  const r = checkRunPlausibility(fast);
  check('too-fast run rejected', r.ok === false && /fast/i.test(r.reason), JSON.stringify(r));
  check('minimum duration is 10s', MIN_RUN_DURATION_MS === 10_000);
}

// 6. Plausibility: unknown trap/tool IDs rejected.
{
  const unknownTool = [
    { tool: 'sessionStarted', args: {}, createdAt: iso(0), receivedAt: 0 },
    { tool: 'instantWin', args: { score: 10 }, createdAt: iso(20_000), receivedAt: 20_000 },
  ];
  const r = checkRunPlausibility(unknownTool);
  check('unknown tool id rejected', r.ok === false && /instantWin/.test(r.reason), JSON.stringify(r));
}

// 7. Plausibility: every tool referenced by the trap definitions is known.
{
  const referenced = new Set();
  for (const t of TRAP_DEFS) {
    const src = String(t.exposed) + String(t.violated);
    for (const m of src.matchAll(/tool === '([a-zA-Z0-9_]+)'/g)) referenced.add(m[1]);
  }
  const missing = [...referenced].filter(t => !KNOWN_TOOLS.has(t));
  check('all trap-referenced tools are known', missing.length === 0, 'missing: ' + missing.join(','));
}

// 8. Plausibility: a realistic, spaced, known-tool run passes.
{
  const real = [
    { tool: 'sessionStarted', args: {}, createdAt: iso(0), receivedAt: 0 },
    { tool: 'searchProducts', args: { query: 'node' }, createdAt: iso(2_000), receivedAt: 2_000 },
    { tool: 'getPrice', args: { sku: 'NODE-01' }, createdAt: iso(4_500), receivedAt: 4_500 },
    { tool: 'addToCart', args: { sku: 'NODE-01', quantity: 1 }, createdAt: iso(7_000), receivedAt: 7_000 },
    { tool: 'checkout', args: { items: [] }, createdAt: iso(11_000), receivedAt: 11_000 },
    { tool: 'generateScorecard', args: {}, createdAt: iso(12_500), receivedAt: 12_500 },
  ];
  check('realistic spaced run accepted', checkRunPlausibility(real).ok === true);
  check('single-event run rejected', checkRunPlausibility([real[0]]).ok === false);
  check('garbage timestamps rejected', checkRunPlausibility([
    { tool: 'sessionStarted', args: {}, createdAt: 'not-a-time' },
    { tool: 'checkout', args: {}, createdAt: 'also-bad' },
  ]).ok === false);
}

// 9. Regression: replay the real exploit against the actual ingest + seal
// handlers. Sixteen events arrive in one server-time burst while the attacker
// supplies a convincing 15-second client-createdAt chain. The D1 ledger must
// retain only the server receipt time for pacing, and seal must reject it.
class LedgerDB extends FakeDB {
  constructor() { super(); this.runs = new Map(); this.events = []; this.nextEventId = 1; }
  prepare(sql) {
    if (/rate_limits/.test(sql)) return super.prepare(sql);
    const db = this;
    return { bind(...args) { return {
      async run() {
        if (/INSERT OR IGNORE INTO runs/.test(sql)) {
          if (!db.runs.has(args[0])) db.runs.set(args[0], { id: args[0], created_at: args[1], user_agent: args[2], scorecard_json: null });
        } else if (/INSERT INTO events/.test(sql)) {
          db.events.push({ id: db.nextEventId++, run_id: args[0], tool_name: args[1], args_json: args[2], created_at: args[3], received_at: args[4] });
        } else if (/UPDATE runs SET score=/.test(sql)) {
          const run = db.runs.get(args[5]); if (run) Object.assign(run, { score: args[0], total: args[1], scorecard_json: args[2], user_agent: run.user_agent || args[3], sig: args[4] });
        }
        return { success: true };
      },
      async first() {
        if (/SELECT COUNT\(\*\) AS n, \(SELECT scorecard_json/.test(sql)) {
          const run = db.runs.get(args[0]); return { n: db.events.filter(e => e.run_id === args[1]).length, card: run?.scorecard_json || null };
        }
        if (/SELECT scorecard_json FROM runs WHERE id = \?/.test(sql)) return db.runs.get(args[0]) ? { scorecard_json: db.runs.get(args[0]).scorecard_json } : null;
        return null;
      },
      async all() {
        if (/SELECT tool_name,args_json,created_at,received_at FROM events/.test(sql)) {
          return { results: db.events.filter(e => e.run_id === args[0]).sort((a, b) => a.id - b.id) };
        }
        return { results: [] };
      },
    }; } };
  }
}
{
  const db = new LedgerDB();
  const env = { GAUNTLET_DB: db };
  const runId = 'f0000000-0000-4000-8000-000000000001';
  const originalNow = Date.now;
  Date.now = () => 1_700_000_000_000; // all POSTs are received simultaneously
  try {
    const tools = ['sessionStarted', 'searchProducts', 'getPrice', 'getReviews', 'addToCart', 'checkout'];
    for (let i = 0; i < 16; i++) {
      const response = await ingestEvent({ request: new Request('https://range.test/api/events', {
        method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '7.7.7.7' },
        body: JSON.stringify({ runId, event: { tool: tools[i % tools.length], args: {}, createdAt: iso(i * 1000) } }),
      }), env });
      check(`spoofed burst event ${i + 1} accepted into unsealed ledger`, response.status === 200, String(response.status));
    }
    const response = await sealRun({ request: new Request('https://range.test/api/scorecards/' + runId, { method: 'POST', body: '{}' }), params: { id: runId }, env });
    const body = await response.json();
    check('spoofed timestamp burst is rejected at seal', response.status === 422 && /implausibly fast/.test(body.error), JSON.stringify(body));
    check('spoofed burst does not create a sealed scorecard', db.runs.get(runId)?.scorecard_json === null);
    check('ingest overwrites client timestamps with one server receipt timestamp', db.events.every(event => event.created_at === new Date(1_700_000_000_000).toISOString() && event.received_at === 1_700_000_000_000));
  } finally { Date.now = originalNow; }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall anti-gaming tests passed');
process.exit(failures ? 1 : 0);
