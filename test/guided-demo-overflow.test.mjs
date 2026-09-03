// Guided-demo modal overflow regression: the ledger list inside the homepage
// "TRY THE GAUNTLET" modal must never visually escape the panel bounds — at
// any point during the run, every ledger row's bottom edge must be within the
// panel's bottom edge (or inside a scrollable area that itself respects the
// panel). Checked at mobile (390px) and desktop (1280px) viewports while the
// demo runs through all steps in real time.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.woff2':'font/woff2' };
const CLEAN = { '/': '/index.html' };
const FAKE_CARD = { id: '11111111-2222-3333-4444-555555555555' };

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  const json = o => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.method === 'POST' && p === '/api/events') return json({ ok: true });
  if (req.method === 'POST' && /^\/api\/scorecards\/[0-9a-f-]+$/.test(p)) return json(FAKE_CARD);
  if (p === '/api/recent') return json({ runs: [] });
  if (p === '/api/trapstats') return json({ totalRuns: 0, traps: [] });
  if (p === '/api/leaderboard') return json({ runs: [], verifiedCount: 0, totalSealed: 0, generatedAt: new Date().toISOString() });
  if (p === '/api/community') return json(null);
  let f = CLEAN[p] || p;
  if (/^\/scorecards\/[0-9a-f-]{36}$/i.test(f)) f = '/scorecard.html';
  if (f === '/') f = '/index.html';
  const file = path.join(ROOT, 'public', f);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('nf'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => srv.listen(8793, r));

const browser = await chromium.launch();
let failures = 0;
const check = (name, ok, extra = '') => { if (ok) console.log('ok:', name); else { failures++; console.log('FAIL:', name, extra); } };

async function runViewport(width, height, label) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto('http://localhost:8793/', { waitUntil: 'networkidle' });
  await page.click('[data-guided-demo]');
  await page.waitForSelector('.demo-panel', { state: 'visible' });

  // Poll for the whole run (~15s paced): at every sample, each ledger row must
  // be inside the panel box, or inside a scrollable ancestor that is itself
  // inside the panel box.
  const samples = [];
  let escapedEver = false, lastDetail = '';
  const started = Date.now();
  while (Date.now() - started < 40000) {
    const snap = await page.evaluate(() => {
      const panel = document.querySelector('.demo-panel');
      if (!panel) return { gone: true };
      const pb = panel.getBoundingClientRect();
      const scroller = document.querySelector('.demo-progress');
      const scrollContained = !!scroller && getComputedStyle(scroller).overflowY !== 'visible' &&
        scroller.scrollHeight >= scroller.clientHeight - 1;
      const sb = scrollContained ? scroller.getBoundingClientRect() : null;
      const rows = [...document.querySelectorAll('.demo-progress-line')].map(r => {
        const b = r.getBoundingClientRect();
        return { text: r.textContent.slice(0, 30), bottom: b.bottom, top: b.top };
      });
      return { gone: false, panelBottom: pb.bottom, panelTop: pb.top, scrollContained, scroller: sb && { bottom: sb.bottom }, rows, rowCount: rows.length };
    }).catch(() => ({ gone: true }));
    if (snap.gone) break; // navigation to scorecard after seal
    for (const row of snap.rows) {
      const contained = (snap.scrollContained && snap.scroller && row.bottom <= snap.scroller.bottom + 1) || row.bottom <= snap.panelBottom + 1;
      if (!contained || row.top < snap.panelTop - 1) { escapedEver = true; lastDetail = JSON.stringify({ row: row.text, rowBottom: row.bottom, panelBottom: snap.panelBottom, scrollContained: snap.scrollContained }); }
    }
    samples.push(snap.rowCount);
    await page.waitForTimeout(400);
  }
  check(`${label}: ledger rows appeared during run`, samples.some(n => n >= 4), `maxRows=${Math.max(0, ...samples)}`);
  check(`${label}: no ledger row ever escapes the modal panel bounds`, !escapedEver, lastDetail);
  await page.close();
}

await runViewport(390, 844, 'mobile 390px');
await runViewport(1280, 800, 'desktop 1280px');

await browser.close();
srv.close();
if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall guided-demo overflow tests passed');
