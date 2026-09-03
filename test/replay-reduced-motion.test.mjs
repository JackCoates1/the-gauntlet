// Replay reduced-motion regression: REPLAY RUN must stay a working,
// scrubbable control when prefers-reduced-motion is set — stepping through
// intermediate states on a timer (no rAF smoothing), not collapsing to the
// finished state. The CSS reduced-motion rules still suppress the animation
// classes; this only asserts the replay progression itself works.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json' };
const CLEAN = { '/scorecards/x': '/scorecard.html', '/demo': '/demo.html' };

// Build a fixture with enough events that intermediate states exist.
const events = [];
for (let i = 0; i < 10; i++) {
  events.push({
    seq: i + 1,
    tool: 'tool_' + i,
    args: { n: i },
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i * 6)).toISOString(),
  });
}
const scorecard = {
  id: 'a'.repeat(8) + '-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  score: 7, total: 10, source: 'simulated', createdAt: events[0].ts,
  outcomes: Array.from({ length: 10 }, (_, i) => ({
    name: 'Trap ' + i, status: i % 3 === 0 ? 'FAIL' : 'PASS', pass: i % 3 !== 0, detail: 'd',
  })),
};
const evidence = {
  replay: events,
  resistanceTimeline: Array.from({ length: 10 }, (_, i) => ({
    name: 'Trap ' + i, status: i % 3 === 0 ? 'FAIL' : 'PASS', seconds: i * 5 + 2, outcomeTool: 'tool_' + i,
  })),
};

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  const json = o => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p.startsWith('/api/scorecards/') && p.endsWith('/evidence')) return json(evidence);
  if (p.startsWith('/api/scorecards/') && p.endsWith('/percentile')) return json({ percentile: 50, averagePct: 5, peerCount: 2 });
  if (p.startsWith('/api/scorecards/') && p.endsWith('/progression')) return json({ previousScores: [], delta: 0 });
  if (p.startsWith('/api/scorecards/')) return json(scorecard);
  let f = CLEAN[p] || p;
  if (/^\/scorecards\/[0-9a-f-]{36}$/i.test(f)) f = '/scorecard.html';
  if (f === '/') f = '/index.html';
  const file = path.join(ROOT, 'public', f);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => srv.listen(8799, r));

const ID = scorecard.id;
const url = 'http://localhost:8799/scorecards/' + ID;
const browser = await chromium.launch();
const results = [];
const fail = msg => { console.error('FAIL: ' + msg); process.exitCode = 1; };

async function countVisible(page) {
  return page.evaluate(() => ({
    ledger: document.querySelectorAll('.replay-event').length,
    chips: [...document.querySelectorAll('.replay-chip')].map(c => c.className),
    clock: document.querySelector('.replay-clock')?.textContent || '',
  }));
}

// ---- 1. Reduced motion: replay must step through intermediate states ----
{
  const page = await browser.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'networkidle' });
  const start = await countVisible(page);
  if (start.ledger !== 1) fail('reduced motion: expected 1 visible event at start, got ' + start.ledger);
  const play = page.locator('.replay-play');
  await play.click();
  await page.waitForTimeout(1800);
  const mid1 = await countVisible(page);
  await page.waitForTimeout(900);
  const mid2 = await countVisible(page);
  if (mid1.ledger <= start.ledger) fail('reduced motion: no progression after first click (' + start.ledger + ' -> ' + mid1.ledger + ')');
  if (mid2.ledger <= mid1.ledger) fail('reduced motion: replay stalled between samples (' + mid1.ledger + ' -> ' + mid2.ledger + ')');
  // scrub bar must have moved with the progression
  const scrubMid = await page.$eval('.replay-scrub', el => Number(el.value));
  if (scrubMid <= 0) fail('reduced motion: scrub bar did not move during replay');
  // pause mid-flight, then scrub to an intermediate position — must render that state
  await play.click(); // pause
  const afterPause = await countVisible(page);
  await page.$eval('.replay-scrub', el => { el.value = '300'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const scrubbed = await countVisible(page);
  const expected = 10; // 30% of a 10-event ledger with events spread evenly
  if (scrubbed.ledger < 1 || scrubbed.ledger > 9) fail('reduced motion: scrub to 30% rendered ' + scrubbed.ledger + ' events, expected an intermediate count');
  if (scrubbed.clock.startsWith('0.0s') && scrubbed.ledger > 0) fail('reduced motion: scrub did not update the clock');
  // finishing: scrub to 100% then click again — should restart from scratch
  await page.$eval('.replay-scrub', el => { el.value = '1000'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const end = await countVisible(page);
  if (end.ledger !== 10) fail('reduced motion: scrub to end shows ' + end.ledger + '/10 events');
  await play.click();
  await page.waitForTimeout(400);
  const restarted = await countVisible(page);
  if (restarted.ledger >= end.ledger) fail('reduced motion: replay did not restart from the beginning after finishing');
  results.push({ test: 'reduced motion replay stepping', start: start.ledger, mid1: mid1.ledger, mid2: mid2.ledger, afterPause: afterPause.ledger, scrubbed: scrubbed.ledger, end: end.ledger, restart: restarted.ledger });
  await page.close();
}

// ---- 2. Reduced motion: /demo replay must also step (not render everything at once) ----
{
  const page = await browser.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://localhost:8799/demo', { waitUntil: 'networkidle' });
  await page.click('#play');
  await page.waitForTimeout(1000); // one or two 750ms steps
  const mid = await page.evaluate(() => document.querySelectorAll('.console-body .line:not(.muted)').length);
  await page.waitForTimeout(1600);
  const later = await page.evaluate(() => document.querySelectorAll('.console-body .line:not(.muted)').length);
  const total = await page.evaluate(() => fetch('/demo-fixture.json').then(r => r.json()).then(f => f.events.length));
  if (mid === 0) fail('demo reduced motion: no ledger lines after first step');
  if (mid === total) fail('demo reduced motion: rendered the whole ledger at once (mid=' + mid + '/' + total + ')');
  if (later <= mid) fail('demo reduced motion: stepping stalled (' + mid + ' -> ' + later + ')');
  results.push({ test: 'demo reduced motion stepping', mid, later, total });
  await page.close();
}

// ---- 3. Normal motion: replay still animates as before ----
{
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  const start = await countVisible(page);
  await page.click('.replay-play');
  await page.waitForTimeout(2500); // 10s duration -> ~25%
  const mid = await countVisible(page);
  const scrubMid = await page.$eval('.replay-scrub', el => Number(el.value));
  if (mid.ledger <= start.ledger) fail('normal motion: no progression after click');
  if (scrubMid <= 0) fail('normal motion: scrub bar did not move');
  // fast-forward to the end and confirm the button resets
  await page.$eval('.replay-scrub', el => { el.value = '999'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(600);
  const end = await countVisible(page);
  if (end.ledger !== 10) fail('normal motion: end state shows ' + end.ledger + '/10 events');
  results.push({ test: 'normal motion replay', start: start.ledger, mid: mid.ledger, scrubMid, end: end.ledger });
  await page.close();
}

// ---- 4. Normal motion: /demo replay still works as before ----
{
  const page = await browser.newPage();
  await page.goto('http://localhost:8799/demo', { waitUntil: 'networkidle' });
  await page.click('#play');
  await page.waitForTimeout(1200);
  const mid = await page.evaluate(() => document.querySelectorAll('.console-body .line:not(.muted)').length);
  if (mid === 0) fail('demo normal motion: no ledger lines after click');
  if (mid > 3) fail('demo normal motion: pacing looks wrong, ' + mid + ' lines after 1.2s');
  results.push({ test: 'demo normal motion', mid });
  await page.close();
}

srv.close();
await browser.close();
console.log(JSON.stringify(results, null, 2));
