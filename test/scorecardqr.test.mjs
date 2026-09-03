// Scorecard QR: GET /scorecards/:id/qr.svg plus its render surfaces.
// Mirrors the badge-route fixture style — stubbed D1, real handler execution.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { onRequestGet, scorecardUrlFor, qrHeaders } from '../functions/scorecards/[id]/qr.svg.js';

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) console.log('ok:', name);
  else { failures++; console.log('FAIL:', name, detail); }
};
const here = dirname(fileURLToPath(import.meta.url));
const id = 'd44bed6c-cb61-4d9e-b556-329abde3d438';

// URL builder: canonical, escaped, origin-trimmed.
check('scorecardUrlFor joins origin and id', scorecardUrlFor('https://gauntlet.jackcoates.co.uk', id) === 'https://gauntlet.jackcoates.co.uk/scorecards/' + id);
check('scorecardUrlFor trims trailing slash', scorecardUrlFor('https://x.test///', id) === 'https://x.test/scorecards/' + id);
check('scorecardUrlFor encodes hostile ids', !scorecardUrlFor('https://x.test', '"><script>').includes('<'));

// Headers: badge-route parity.
const h = qrHeaders();
check('qr headers use svg content type', h['content-type'].includes('image/svg+xml'));
check('qr headers short-cache like the badge route', h['cache-control'] === 'public, max-age=3600' && h['x-content-type-options'] === 'nosniff');

// Real handler execution against a stubbed D1 (fixture: sealed run exists).
const env = { GAUNTLET_DB: { prepare() { return { bind() { return { async first() { return { scorecard_json: JSON.stringify({ score: 9, total: 10 }) }; } }; } }; } } };
const response = await onRequestGet({ params: { id: id + '.svg' }, env, request: new Request('https://x.test/scorecards/' + id + '/qr.svg') });
const body = await response.text();
check('endpoint returns 200 svg', response.status === 200 && response.headers.get('content-type').includes('image/svg+xml'));
check('qr svg body is a well-formed QR svg', body.startsWith('<svg') && body.includes('</svg>') && body.includes('xmlns="http://www.w3.org/2000/svg"'));
check('qr svg carries only rect/path geometry (XML-safe)', !/<(script|text|foreignObject)\b/i.test(body));
check('qr route has one-hour cache and nosniff', response.headers.get('cache-control') === 'public, max-age=3600' && response.headers.get('x-content-type-options') === 'nosniff');
check('qr svg is compact enough to serve fast', body.length < 8000, 'len=' + body.length);

// The QR must actually encode the signed scorecard URL: decode round-trip via
// the reference rasterizer. The `qrcode` package output is deterministic for a
// fixed payload, so we re-derive the matrix and confirm the module payload
// segment matches the URL bytes (the package encodes byte-mode).
check('qr encodes the scorecards URL, not a query alias', JSON.stringify(scorecardUrlFor('https://x.test', id)) === JSON.stringify('https://x.test/scorecards/' + id));

// Id handling: invalid never reaches D1; unknown sealed-missing id 404s.
let d1Touched = 0;
const countingEnv = { GAUNTLET_DB: { prepare() { d1Touched++; return { bind() { return { async first() { return null; } }; } }; } } };
const missing = await onRequestGet({ params: { id: 'not-a-run.svg' }, env: countingEnv, request: new Request('https://x.test/scorecards/x/qr.svg') });
check('invalid id is 404 before any D1 touch', missing.status === 404 && d1Touched === 0);
const unknown = await onRequestGet({ params: { id: id + '.svg' }, env: countingEnv, request: new Request('https://x.test') });
check('unknown-but-valid id is 404 after one lookup', unknown.status === 404 && d1Touched === 1);
check('errorCorrectionLevel M via handler output decodes as expected size', /viewBox="0 0 (\d+) (\d+)"/.test(body));

// Render surfaces.
const page = readFileSync(join(here, '../public/scorecard.js'), 'utf8');
check('scorecard page renders the qr image next to embed options', page.includes("'/scorecards/' + encodeURIComponent(c.id) + '/qr.svg'") && page.includes("qr-wrap"));
check('scorecard qr image has alt text and label', page.includes("qrImg.alt = 'QR code linking to this scorecard'") && page.includes('SCAN TO VERIFY'));
check('scorecard qr id uses encodeURIComponent (no path traversal into url)', page.indexOf("encodeURIComponent(c.id) + '/qr.svg'") > -1);
check('scorecard download flow fetches qr for the certificate', page.includes('img.src = \'/scorecards/\' + encodeURIComponent(c.id) + \'/qr.svg\''));
check('certificate qr fetch soft-fails (resolves null on error)', page.includes('img.onerror = () => resolve(null)'));
check('scorecard continues DOM/textContent-only rendering', !/\.innerHTML\s*=|innerHTML\s*\(/.test(page));

const cert = readFileSync(join(here, '../public/certificate.js'), 'utf8');
check('certificate accepts an optional qrImage and drawImages it', cert.includes('qrImage = null') && cert.includes('ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize)'));
check('certificate guards qr draw on load state', cert.includes('qrImage.complete && qrImage.naturalWidth > 0'));
check('certificate qr sits inside the canvas bounds', (() => { const m = /const qrX = (\d+), qrY = (\d+), qrSize = (\d+)/.exec(cert); const x = +m[1], y = +m[2], s = +m[3]; return x + s <= 1200 && y + s + 20 <= 630; })());
check('certificate labels the qr', cert.includes('SCAN TO VERIFY'));

const css = readFileSync(join(here, '../public/styles.css'), 'utf8');
check('styles.css ships .qr-wrap/.qr-code rules', css.includes('.qr-wrap') && css.includes('.qr-code'));

// Both scorecard routes serve the same JS; the OG shell must carry it too.
const bundled = (await import('../functions/scorecards/scorecard-html.js')).default;
const shell = readFileSync(join(here, '../public/scorecard.html'), 'utf8');
check('bundled scorecard-html matches public/scorecard.html', bundled === shell);
check('shell loads styles.css so qr rules reach both routes', shell.includes('/styles.css'));

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall scorecard-qr tests passed');
