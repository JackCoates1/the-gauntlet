// Per-trap mitigation guidance: every trap in TRAP_DEFS carries a one-line,
// actionable practice; the /traps catalog page renders it; the scorecard page
// renders coaching for failed outcomes via textContent only; and the
// bundled OG scorecard shell stays in sync with public/scorecard.html.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { TRAP_DEFS, evaluate } from '../embed/gauntlet-traps/traps.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (cond, name) => { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + name); } };

// 1. Every trap def has a non-empty, sentence-cased mitigation one-liner
for (const t of TRAP_DEFS) {
  check(typeof t.mitigation === 'string' && t.mitigation.length > 20, `mitigation present and substantive: ${t.name}`);
  check(!/\n/.test(t.mitigation), `mitigation is a one-liner (no newlines): ${t.name}`);
  check(/^[A-Z]/.test(t.mitigation), `mitigation starts a sentence: ${t.name}`);
  check(!/<|>|\{|\}/.test(t.mitigation), `mitigation free of markup/interpolation: ${t.name}`);
}

// 2. evaluate() outcomes carry mitigation through to scorecards
const failEvent = { tool: 'check0ut', args: {}, createdAt: new Date().toISOString() };
const events = [
  { tool: 'sessionStarted', args: {}, createdAt: new Date(Date.now() - 60000).toISOString() },
  { tool: 'searchProducts', args: { q: 'mug' }, createdAt: new Date(Date.now() - 50000).toISOString() },
  { tool: 'getReviews', args: { id: 1 }, createdAt: new Date(Date.now() - 40000).toISOString() },
  { tool: 'getPrice', args: { sku: 'MUG-1' }, createdAt: new Date(Date.now() - 30000).toISOString() },
  { tool: 'addToCart', args: { sku: 'MUG-1', quantity: 2 }, createdAt: new Date(Date.now() - 20000).toISOString() },
  { tool: 'checkout', args: { }, createdAt: new Date(Date.now() - 15000).toISOString() },
  failEvent,
];
const card = evaluate(events);
const typo = card.outcomes.find(o => o.name === 'Typosquat tool name');
check(card.engagement.ok, 'fixture run passes the engagement gate');
check(typo && typo.status === 'FAIL', 'fixture run fails the typosquat trap');
check(typo.mitigation === TRAP_DEFS.find(t => t.name === 'Typosquat tool name').mitigation, 'failed outcome carries the catalog mitigation text');
check(card.outcomes.every(o => typeof o.mitigation === 'string' && o.mitigation.length > 20), 'every outcome carries a mitigation field');

// 3. /traps page renders HOW TO RESIST for every trap (regenerate first, matching
//    the trapscatalog pattern — this file does not race trap-stat readers on
//    scorecard artifacts, only on traps.html which these checks own here).
execFileSync('node', [join(root, 'scripts/build-traps-page.mjs')], { cwd: root });
const trapsHtml = readFileSync(join(root, 'public/traps.html'), 'utf8');
const unesc = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
check((trapsHtml.match(/<b class="ok">HOW TO RESIST:<\/b>/g) || []).length === TRAP_DEFS.length, `traps page renders exactly ${TRAP_DEFS.length} HOW TO RESIST lines`);
for (const t of TRAP_DEFS) check(unesc(trapsHtml).includes(t.mitigation), `traps page renders mitigation text: ${t.name}`);
// Escaping: no raw mitigation string sits in the page un-escaped when it
// contains quote-sensitive characters.
check(!/HOW TO RESIST:<\/b>[^\n]*<script/i.test(trapsHtml), 'mitigation lines never contain script tags');

// 4. Scorecard page renders the coaching line for failed traps only,
//    via textContent — never innerHTML or template interpolation.
const scorecardJs = readFileSync(join(root, 'public/scorecard.js'), 'utf8');
check(scorecardJs.includes("el('p', 'signal mitigation-line', 'A resistant agent would have: ' + o.mitigation)"), 'scorecard renders coaching through the textContent el() helper');
check(scorecardJs.includes("o.status === 'FAIL' && o.mitigation"), 'scorecard shows coaching only for failed traps');
check(!/innerHTML[\s\S]{0,40}mitigation/i.test(scorecardJs), 'scorecard never assigns mitigation via innerHTML');
check(!/mitigation[^;]*`/.test(scorecardJs), 'scorecard never interpolates mitigation into a template literal');

// 5. Bundled OG scorecard shell matches the public shell (sync enforcement,
//    same invariant test/ogpreview.test.mjs enforces for the shell itself).
const bundled = (await import('../functions/scorecards/scorecard-html.js')).default;
check(bundled === readFileSync(join(root, 'public/scorecard.html'), 'utf8'), 'bundled scorecard-html matches public/scorecard.html');
check(bundled.includes('/scorecard.js'), 'bundled shell loads the interactive scorecard script that renders coaching');

console.log(`\nmitigation: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
