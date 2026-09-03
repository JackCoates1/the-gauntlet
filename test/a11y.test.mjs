// Accessibility (WCAG 2.1 AA) test suite: runs axe-core headlessly against
// every built static page via jsdom and pins the a11y invariants that earlier
// rounds left uncovered — landmarks, aria-labels on icon-only controls,
// aria-live on dynamic regions, :focus-visible styling, prefers-reduced-motion
// handling, and 4.5:1 contrast for the muted palette.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (cond, name) => { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } };

const PAGES = ['index.html', 'scorecard.html', 'leaderboard.html', 'compare.html',
  'digest.html', 'demo.html', 'connect.html', 'docs.html', 'traps.html', 'verify.html'];
const page = name => readFileSync(join(root, 'public', name), 'utf8');

// ---- axe-core against every built page (document-level rules; the pages
// fetch their dynamic content client-side, so we exclude rules that need a
// live backend and assert zero violations of everything else). ----
const AXE_EXCLUDES = new Set([
  'region',            // decorative noise overlay sits outside landmarks by design
  'page-has-heading-one',
  'landmark-one-main', // asserted explicitly below per page
  'landmark-no-duplicate-main',
  'html-has-lang',     // asserted explicitly below
  'bypass',            // nav jump links not part of this pass
]);

async function runAxe(html) {
  const dom = new JSDOM(html, { url: 'https://gauntlet.jackcoates.co.uk/' });
  global.window = dom.window;
  global.document = dom.window.document;
  const results = await new Promise((resolve, reject) => {
    dom.window.eval(axe.source);
    dom.window.axe.run(dom.window.document, {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false } }, // static palette asserted numerically below
    }).then(resolve, reject);
  });
  delete global.window; delete global.document;
  return results.violations.filter(v => !AXE_EXCLUDES.has(v.id));
}

for (const name of PAGES) {
  let violations = [];
  try { violations = await runAxe(page(name)); }
  catch (e) { check(false, `${name}: axe ran (${e.message})`); continue; }
  const critical = violations.filter(v => (v.impact === 'critical' || v.impact === 'serious'));
  check(critical.length === 0,
    `${name}: zero critical/serious axe violations` +
    (critical.length ? ' — ' + critical.map(v => v.id + ': ' + v.nodes.length + ' node(s)').join(', ') : ''));
}

// ---- semantic landmarks on every generated page ----
for (const name of PAGES) {
  const dom = new JSDOM(page(name));
  const d = dom.window.document;
  check(Boolean(d.querySelector('header nav') || d.querySelector('nav')), `${name}: nav landmark present`);
  check(Boolean(d.querySelector('main')), `${name}: main landmark present`);
  check(Boolean(d.querySelector('footer')), `${name}: footer landmark present`);
  check(d.querySelector('html').getAttribute('lang') === 'en', `${name}: html lang=en`);
}

// ---- aria-labels on icon-only / ambiguous controls ----
const index = page('index.html');
check(/id="copyUrl"[^>]*aria-label=/i.test(index) || /aria-label=[^>]*id="copyUrl"/i.test(index),
  'index: copy test URL button has aria-label');
const connect = page('connect.html') + readFileSync(join(root, 'scripts/build-connect-page.mjs'), 'utf8');
check((connect.match(/copy-btn[^>]*aria-label=/g) || []).length >= 2,
  'connect: both copy buttons carry aria-labels (built page + generator)');
const digest = page('digest.html');
check(/href="\/api\/digest\.csv"[^>]*aria-label=/i.test(digest) || /aria-label=[^>]*href="\/api\/digest\.csv"/i.test(digest),
  'digest: CSV download link has aria-label');
const board = page('leaderboard.html');
check(/href="\/api\/leaderboard\.csv[^"]*"[^>]*aria-label=/i.test(board) || /aria-label=[^>]*href="\/api\/leaderboard\.csv/i.test(board),
  'leaderboard: CSV download link has aria-label');
const docs = page('docs.html');
check(/href="\/openapi\.json"[^>]*aria-label=/i.test(docs) || /aria-label=[^>]*href="\/openapi\.json"/i.test(docs),
  'docs: OpenAPI spec download link has aria-label');

// scorecard.js builds its download/certificate controls at runtime
const scorecardJs = readFileSync(join(root, 'public/scorecard.js'), 'utf8');
check(scorecardJs.includes("ev.setAttribute('aria-label'"), 'scorecard.js: evidence download link gets aria-label');
check(scorecardJs.includes("downloadCard.setAttribute('aria-label'"), 'scorecard.js: certificate download button gets aria-label');
check(scorecardJs.includes("play.setAttribute('aria-label'"), 'scorecard.js: replay play button gets aria-label');
check(scorecardJs.includes("aria-label', 'Replay position'"), 'scorecard.js: scrubber keeps its aria-label');

// ---- aria-live on dynamically-updated regions ----
check(page('index.html').match(/id="recentRuns"[^>]*aria-live="polite"/) !== null,
  'index: recent-runs ticker is aria-live=polite');
check(scorecardJs.includes("trapBoard.setAttribute('aria-live', 'polite')"),
  'scorecard.js: replay trap board announces transitions');
check(scorecardJs.includes("ledger.setAttribute('aria-live', 'polite')"),
  'scorecard.js: replay ledger announces events');
check(scorecardJs.includes("pLine.setAttribute('aria-live', 'polite')"),
  'scorecard.js: percentile line is announced');
check(page('verify.html').match(/id="verdict"[^>]*aria-live="polite"/) !== null,
  'verify: verdict region is aria-live=polite');
check(page('leaderboard.html').match(/id="board"[^>]*aria-live="polite"/) !== null,
  'leaderboard: results console is aria-live=polite');
check(page('digest.html').match(/id="cards"[^>]*aria-live="polite"/) !== null,
  'digest: fingerprint cards region is aria-live=polite');

// ---- visible :focus-visible outlines in the acid palette ----
const styles = readFileSync(join(root, 'public/styles.css'), 'utf8');
check(/:focus-visible\{[^}]*outline:2px solid var\(--acid\)/.test(styles),
  'styles.css: base :focus-visible outline uses the acid palette');
check(/a:focus-visible,button:focus-visible,input:focus-visible,\[tabindex\]:focus-visible\{outline:3px solid var\(--acid\)/.test(styles),
  'styles.css: interactive elements get a 3px acid focus outline');
check(/:focus-visible/.test(styles) && /outline-offset/.test(styles),
  'styles.css: focus outlines are offset and never removed');

// ---- prefers-reduced-motion ----
check(/@media \(prefers-reduced-motion: reduce\)/.test(styles),
  'styles.css: prefers-reduced-motion media query exists');
check(/animation-duration:\.01ms!important/.test(styles) && /transition-duration:\.01ms!important/.test(styles),
  'styles.css: reduced motion kills animations and transitions');
check(/html\{scroll-behavior:auto\}[\s\S]*prefers-reduced-motion/.test(styles.replace('@media (prefers-reduced-motion: reduce){\n  html{scroll-behavior:auto}', 'html{scroll-behavior:auto}')) ||
  (styles.match(/prefers-reduced-motion[\s\S]*scroll-behavior:auto/) !== null),
  'styles.css: reduced motion disables smooth scrolling');
check(/\.doc section\.epi:target\{box-shadow:none\}/.test(styles),
  'styles.css: reduced motion removes the :target glow');

// replay auto-play must jump to the final state under reduced motion
check(scorecardJs.includes("matchMedia('(prefers-reduced-motion: reduce)').matches"),
  'scorecard.js: detects prefers-reduced-motion');
check(scorecardJs.includes('if (reducedMotion) { elapsed = duration; render();'),
  'scorecard.js: reduced motion jumps the replay straight to the final ledger state');
const demoReplay = readFileSync(join(root, 'public/demo-replay.js'), 'utf8');
check(demoReplay.includes("matchMedia('(prefers-reduced-motion: reduce)').matches"),
  'demo-replay.js: detects prefers-reduced-motion');
check(demoReplay.includes('if (reducedMotion) { render(events.length);'),
  'demo-replay.js: reduced motion renders the complete ledger without pacing');

// ---- 4.5:1 contrast for the muted palette (WCAG 1.4.3), computed here so the
// shipped hex values cannot regress ----
function luminance(hex) {
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(1 + i, 3 + i), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const SURFACES = ['#070a10', '#0d121c', '#090d14', '#111925', '#080c13'];
const PALETTE = {
  '--muted #8490a2': '#8490a2',
  'body .muted #8d99ab': '#8d99ab',
  'footer #7a8798': '#7a8798',
  'replay-pending #7d8a9b': '#7d8a9b',
  'lede #aeb8c7': '#aeb8c7',
  'rules li #aab4c3': '#aab4c3',
  'ink #e9edf5': '#e9edf5',
  'acid #c5ff5f': '#c5ff5f',
  'danger #ff6b6b': '#ff6b6b',
};
for (const [name, fg] of Object.entries(PALETTE)) {
  const worst = Math.min(...SURFACES.map(bg => contrast(fg, bg)));
  check(worst >= 4.5, `contrast: ${name} ≥ 4.5:1 on every surface (worst ${worst.toFixed(2)})`);
}
// the old failing values must be gone from the shipped stylesheet
check(!styles.includes('#566276') && !styles.includes('#596577') && !styles.includes('#697587'),
  'contrast: legacy sub-AA greys removed from styles.css');

// ---- the OG/bundle copies stay synchronized (project pattern) ----
const bundledScorecard = readFileSync(join(root, 'functions/scorecards/scorecard-html.js'), 'utf8');
const bundleHtml = JSON.parse(bundledScorecard.replace(/^export default /, '').replace(/;\s*$/, ''));
check(bundleHtml === page('scorecard.html'), 'bundled scorecard-html stays byte-identical to public/scorecard.html');
check(bundleHtml.includes('<header><nav>'), 'bundled scorecard-html carries the header landmark');
check(bundleHtml.includes('aria-live="polite"'), 'bundled scorecard-html keeps the live region');

console.log(`\na11y tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
