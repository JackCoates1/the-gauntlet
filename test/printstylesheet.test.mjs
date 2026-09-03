// Print / PDF stylesheet for scorecards — round 33 idea.
// A judge hitting Ctrl+P on /scorecards/:id gets an ink-friendly one-pager:
// white background, outcome strip colours preserved, verification footer with
// score + run id + canonical URL, and interactive-only chrome hidden.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (cond, msg) => { if (cond) { pass++; console.log('ok   -', msg); } else { fail++; console.error('FAIL -', msg); } };

const css = readFileSync(join(root, 'public/styles.css'), 'utf8');
const js = readFileSync(join(root, 'public/scorecard.js'), 'utf8');
// Node 20 is the CI baseline; RegExp.escape only arrived later.
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 1. A @media print block exists.
check(/@media\s*print\s*\{/.test(css), 'styles.css has a @media print block');

// 2. Outcome strip colours survive printing (print-color-adjust: exact on the tl-* classes).
for (const cls of ['.tl-seg', '.tl-fail', '.tl-pass']) {
  const re = new RegExp(escapeRegExp(cls) + '\\{[^}]*print-color-adjust:\\s*exact');
  check(re.test(css), `outcome strip ${cls} preserves colour when printing (print-color-adjust: exact)`);
}

// 3. White background: the :root custom properties are overridden to white in print.
const printBlock = css.match(/@media\s*print\s*\{[\s\S]*?\n\}/)?.[0] || '';
check(/--bg:\s*#fff/i.test(printBlock), 'print block forces a white background (--bg: #fff)');

// 4. Interactive-only chrome is hidden in print: nav, buttons, embed controls,
//    replay, share, QR embed, noise overlay, homepage ticker.
check(/\.noise,nav,footer,\.button,\.ghost,\.embed-options,\.replay,\.demo-overlay,\.recent-feed\{display:none/.test(css),
  'print block hides nav, buttons, embed controls, replay, noise overlay and homepage ticker');

// 5. Print-only verification footer exists and is hidden on screen.
check(/\.print-footer\{display:none\}/.test(css), 'print footer is hidden on screen');
check(/\.print-footer\{display:block/.test(css), 'print footer is shown in print');
check(js.includes('SIGNATURE VERIFIED AGAINST THE PUBLISHED PUBLIC KEY'),
  'print footer includes the signature-verification statement');
check(js.includes("' · RUN ' + c.id + ' · '"), 'print footer includes the run id');
check(js.includes("'/scorecards/' + c.id"), 'print footer includes the canonical scorecard URL');

// 6. Discoverability: a print control sits next to DOWNLOAD CARD.
check(js.includes("'🖨 PRINT / SAVE PDF'"), 'a PRINT / SAVE PDF button is rendered on the scorecard');
check(js.includes('window.print()'), 'the print button triggers the browser print dialog');
const dlIdx = js.indexOf("'DOWNLOAD CARD'");
const printIdx = js.indexOf("'🖨 PRINT / SAVE PDF'");
check(dlIdx !== -1 && printIdx > dlIdx && printIdx - dlIdx < 1600,
  'the print button is appended right after DOWNLOAD CARD');

// 7. Bundled Pages Function copy stays byte-identical to public/scorecard.html.
const bundled = readFileSync(join(root, 'functions/scorecards/scorecard-html.js'), 'utf8');
const page = readFileSync(join(root, 'public/scorecard.html'), 'utf8');
check(bundled === 'export default ' + JSON.stringify(page) + ';\n',
  'bundled scorecard-html.js is regenerated from public/scorecard.html');

// 8. The scorecard markup itself needs no change (styling + JS only), but the
//    bundled copy must still parse as an ES module exporting a string.
const mod = await import('../functions/scorecards/scorecard-html.js');
check(typeof mod.default === 'string' && mod.default.startsWith('<!doctype html>'),
  'bundled scorecard-html.js exports the HTML string');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
