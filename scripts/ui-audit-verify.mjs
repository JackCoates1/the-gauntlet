// UI-audit verification: docs 390px overflow, console errors, typo, trap counts.
// Serves public/ with the production CSP; /api/* gets realistic stubs so the
// zero-console-error check measures real problems (CSP, missing assets, JS
// errors) rather than the static server's expected lack of Functions runtime.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const CLEAN = { '/':'index.html', '/demo':'demo.html', '/docs':'docs.html', '/traps':'traps.html', '/leaderboard':'leaderboard.html', '/connect':'connect.html', '/verify':'verify.html', '/compare':'compare.html', '/digest':'digest.html' };
const API_STUBS = {
  'GET /api/recent': { runs: [] },
  'GET /api/trapstats': { totalRuns: 0, traps: [] },
  'GET /api/leaderboard': { runs: [], verifiedCount: 0, totalSealed: 0, generatedAt: new Date().toISOString() },
  'GET /api/community': null,
  'POST /api/events': { ok: true },
};
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  const stub = API_STUBS[req.method + ' ' + p] !== undefined ? API_STUBS[req.method + ' ' + p] : API_STUBS[req.method + ' ' + p.split('/').slice(0, 3).join('/')];
  if (p.startsWith('/api/')) {
    res.writeHead(stub === undefined ? 404 : 200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(stub ?? {}));
  }
  if (CLEAN[p]) p = '/' + CLEAN[p];
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, 'public', p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('nf'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'content-security-policy': CSP });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => srv.listen(8791, r));

const browser = await chromium.launch();
const results = [];

// 1. /docs at 390px — page must not scroll horizontally
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto('http://localhost:8791/docs', { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const tableScroll = await page.evaluate(() => {
    const w = document.querySelector('.table-scroll');
    return w ? { count: document.querySelectorAll('.table-scroll').length, innerScrollable: w.scrollWidth >= w.clientWidth - 2, pageClean: document.documentElement.scrollWidth <= document.documentElement.clientWidth } : null;
  });
  await page.screenshot({ path: '/tmp/docs-390.png', fullPage: false });
  results.push({ test: 'docs 390px overflow', pageOverflowPx: overflow, tables: tableScroll, consoleErrors: errors });
  await page.close();
}

// 2. Console errors on several pages (CSP / fonts / missing assets)
{
  const pages = ['/', '/demo', '/docs', '/traps', '/leaderboard'];
  const perPage = {};
  for (const p of pages) {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', m => m.type() === 'error' && errors.push(m.text()));
    const failed = [];
    page.on('requestfailed', r => failed.push(r.url()));
    await page.goto('http://localhost:8791' + p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const fonts = await page.evaluate(() => ({
      manrope: [...document.fonts].filter(f => f.family.replace(/["']/g, '') === 'Manrope' && f.status === 'loaded').length,
      dmMono: [...document.fonts].filter(f => f.family.replace(/["']/g, '') === 'DM Mono' && f.status === 'loaded').length,
    }));
    perPage[p] = { consoleErrors: errors, failedRequests: failed, fontsLoaded: fonts };
    await page.close();
  }
  results.push({ test: 'console errors + self-hosted fonts', perPage });
}

// 3. /demo trap counts populated from catalog
{
  const page = await browser.newPage();
  await page.goto('http://localhost:8791/demo', { waitUntil: 'networkidle' });
  const resist = await page.textContent('#resistCount');
  const trip = await page.textContent('#tripCount');
  const score = await page.textContent('#scorecard h2');
  results.push({ test: 'demo dynamic counts', resist, trip, scorecard: score });
  await page.close();
}

// 4. typo grep is done in shell; here confirm rendered demo text has WEBMCP
{
  const page = await browser.newPage();
  await page.goto('http://localhost:8791/demo', { waitUntil: 'networkidle' });
  const eyebrow = await page.textContent('.hero .eyebrow');
  results.push({ test: 'demo eyebrow text', eyebrow });
  await page.close();
}

await browser.close();
srv.close();
console.log(JSON.stringify(results, null, 2));
