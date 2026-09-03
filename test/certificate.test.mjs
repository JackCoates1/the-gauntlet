// Resistance certificate: a local Canvas export must faithfully reflect the
// sealed scorecard/timeline and remain safe to ship on both scorecard routes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CERTIFICATE_HEIGHT, CERTIFICATE_WIDTH, TIMELINE_COLORS, certificateOutcomeColor,
  downloadResistanceCertificate, drawResistanceCertificate, formatSealAge, hasVerifiedSignature,
} from '../public/certificate.js';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log('ok:', name);
  else { failures++; console.log('FAIL:', name, detail); }
}
const here = dirname(fileURLToPath(import.meta.url));
const scorecard = {
  id: 'd44bed6c-cb61-4d9e-b556-329abde3d438', score: 7, total: 10,
  createdAt: '2026-09-03T00:00:00.000Z',
  outcomes: [{ status: 'PASS' }, { status: 'FAIL' }, { status: 'NOT TESTED' }],
};
const evidence = { resistanceTimeline: [{ status: 'PASS' }, { status: 'FAIL' }, { status: 'NOT TESTED' }], signatureVerified: true };

// Minimal Canvas/document recording harness: no browser or image library is
// needed to prove the rendering contract and the canvas-export download path.
const calls = [];
const ctx = {
  beginPath() {}, closePath() {}, roundRect() {}, fillRect(...args) { calls.push(['fillRect', this.fillStyle, ...args]); },
  strokeRect() {}, stroke() {}, fill() {}, fillText(...args) { calls.push(['fillText', this.fillStyle, String(args[0])]); },
};
const canvas = { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,certificate' };
const links = [];
const oldDocument = globalThis.document;
const oldWindow = globalThis.window;
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return canvas;
    const link = { download: '', click() { this.clicked = true; }, remove() { this.removed = true; } }; links.push(link); return link;
  },
  body: { append(link) { link.appended = true; } },
};
globalThis.window = { open(...args) { calls.push(['window.open', ...args]); } };

check('certificate is 1200 pixels wide', CERTIFICATE_WIDTH === 1200);
check('certificate is 630 pixels high', CERTIFICATE_HEIGHT === 630);
check('PASS uses the timeline acid color', TIMELINE_COLORS.PASS === '#c5ff5f' && certificateOutcomeColor('PASS') === '#c5ff5f');
check('FAIL uses the timeline red color', TIMELINE_COLORS.FAIL === '#ff6b6b' && certificateOutcomeColor('FAIL') === '#ff6b6b');
check('NOT TESTED uses the timeline grey color', TIMELINE_COLORS['NOT TESTED'] === '#161d29' && certificateOutcomeColor('NOT TESTED') === '#161d29');
check('unknown outcomes safely fall back to grey', certificateOutcomeColor('hostile') === '#161d29');
check('seal age says just now under one minute', formatSealAge(scorecard.createdAt, Date.parse(scorecard.createdAt) + 59000) === 'SEALED JUST NOW');
check('seal age formats minutes', formatSealAge(scorecard.createdAt, Date.parse(scorecard.createdAt) + 61e3) === 'SEALED 1M AGO');
check('seal age formats hours/minutes', formatSealAge(scorecard.createdAt, Date.parse(scorecard.createdAt) + 91 * 60e3) === 'SEALED 1H 31M AGO');
check('seal age formats days', formatSealAge(scorecard.createdAt, Date.parse(scorecard.createdAt) + 49 * 3600e3) === 'SEALED 2D AGO');
check('invalid seal time is explicit', formatSealAge('nope') === 'SEALED TIME UNAVAILABLE');

const rendered = drawResistanceCertificate({ scorecard, evidence, origin: 'https://gauntlet.jackcoates.co.uk/', now: Date.parse(scorecard.createdAt) + 61e3 });
check('renderer returns the canvas it created', rendered === canvas);
check('renderer assigns exact 1200×630 canvas dimensions', canvas.width === 1200 && canvas.height === 630);
const drawnText = calls.filter(call => call[0] === 'fillText').map(call => call[2]);
check('renderer writes the real sealed run ID', drawnText.some(value => value.includes(scorecard.id)));
check('renderer writes actual sealed score', drawnText.includes('7/10'));
check('renderer writes duration since seal', drawnText.includes('SEALED 1M AGO'));
check('renderer writes verified Ed25519 chip only from verified result', drawnText.includes('✓ SIGNATURE VERIFIED'));
check('renderer writes canonical short scorecard link', drawnText.includes('https://gauntlet.jackcoates.co.uk/scorecards/' + scorecard.id));
const stripColors = calls.filter(call => call[0] === 'fillRect').map(call => call[1]);
check('renderer draws an acid PASS outcome segment', stripColors.includes('#c5ff5f'));
check('renderer draws a red FAIL outcome segment', stripColors.includes('#ff6b6b'));
check('renderer draws a grey NOT TESTED outcome segment', stripColors.includes('#161d29'));
check('renderer requires a sealed scorecard ID', (() => { try { drawResistanceCertificate({ scorecard: {} }); } catch { return true; } return false; })());

const dataUrl = downloadResistanceCertificate({ scorecard, evidence, origin: 'https://gauntlet.jackcoates.co.uk', now: Date.parse(scorecard.createdAt) });
check('download exports a local PNG data URL', dataUrl === 'data:image/png;base64,certificate');
check('download creates a PNG filename containing the run ID', links.at(-1).download === 'gauntlet-resistance-' + scorecard.id + '.png');
check('download clicks a temporary anchor for browser download', links.at(-1).appended && links.at(-1).clicked && links.at(-1).removed);
check('download link has no network URL', links.at(-1).href.startsWith('data:image/png;base64,'));
check('incomplete evidence never claims a verified signature', await hasVerifiedSignature({ algorithm: 'Ed25519' }) === false);

const source = readFileSync(join(here, '../public/certificate.js'), 'utf8');
const page = readFileSync(join(here, '../public/scorecard.js'), 'utf8');
const bundled = (await import('../functions/scorecards/scorecard-html.js')).default;
const css = readFileSync(join(here, '../public/styles.css'), 'utf8');
check('certificate is a public browser module', source.includes('document.createElement(\'canvas\')'));
check('certificate uses Canvas toDataURL export', source.includes("toDataURL('image/png')"));
check('certificate has a right-click-safe opened-image fallback', source.includes("window.open(dataUrl, '_blank', 'noopener')"));
check('certificate contains no HTML injection sink', !/\.innerHTML\s*=|innerHTML\s*\(/.test(source));
check('certificate does not fetch or post data', !/\bfetch\s*\(|XMLHttpRequest|\.post\(/.test(source));
check('certificate pins the published Ed25519 public key', source.includes('17f868001b3ad45cc67a069e1115c1e8390debe4ad21add712477d91c857827a'));
check('scorecard imports the certificate module', page.includes("from '/certificate.js'"));
check('scorecard has DOWNLOAD CARD button next to share action', page.includes("'DOWNLOAD CARD'") && page.indexOf("card.append(share)") < page.indexOf("card.append(downloadCard)"));
check('button handler verifies evidence before drawing', page.includes('await hasVerifiedSignature(evidenceBundle)') && page.includes('downloadResistanceCertificate('));
check('OG scorecard bundle stays synchronized', bundled === readFileSync(join(here, '../public/scorecard.html'), 'utf8'));
check('OG scorecard bundle includes certificate wiring', bundled.includes('src=\"/scorecard.js\"'));
check('timeline CSS retains the certificate palette source colors', css.includes('#c5ff5f') && css.includes('#ff6b6b') && css.includes('#161d29'));

globalThis.document = oldDocument;
globalThis.window = oldWindow;
if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall resistance-certificate tests passed');
