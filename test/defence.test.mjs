// Per-trap DEFENCE guidance: every trap in TRAP_DEFS carries a one-line,
// actionable defence; the /traps catalog page renders it; the scorecard page
// renders a DEFENCE line for failed outcomes via textContent only; and the
// bundled OG scorecard shell stays in sync with public/scorecard.html.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { TRAP_DEFS, evaluate } from '../embed/gauntlet-traps/traps.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (cond, name) => { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + name); } };

// 1. Every trap def has a non-empty, sentence-cased defence one-liner
for (const t of TRAP_DEFS) {
  check(typeof t.defence === 'string' && t.defence.length > 20, `defence present and substantive: ${t.name}`);
  check(!/\n/.test(t.defence), `defence is a one-liner (no newlines): ${t.name}`);
  check(/^[A-Z]/.test(t.defence), `defence starts a sentence: ${t.name}`);
  check(!/<|>|\{|\}/.test(t.defence), `defence free of markup/interpolation: ${t.name}`);
}

// 2. evaluate() outcomes carry the defence through to scorecards
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
check(typo.defence === TRAP_DEFS.find(t => t.name === 'Typosquat tool name').defence, 'failed outcome carries the catalog defence text');
check(card.outcomes.every(o => typeof o.defence === 'string' && o.defence.length > 20), 'every outcome carries a defence field');

// 3. /traps page renders DEFENCE for every trap (regenerate first, matching
//    the trapscatalog pattern — this file does not race trap-stat readers on
//    scorecard artifacts, only on traps.html which these checks own here).
execFileSync('node', [join(root, 'scripts/build-traps-page.mjs')], { cwd: root });
const trapsHtml = readFileSync(join(root, 'public/traps.html'), 'utf8');
const unesc = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
check((trapsHtml.match(/<b class="ok">DEFENCE:<\/b>/g) || []).length === TRAP_DEFS.length, `traps page renders exactly ${TRAP_DEFS.length} DEFENCE lines`);
for (const t of TRAP_DEFS) check(unesc(trapsHtml).includes(t.defence), `traps page renders defence text: ${t.name}`);
// Escaping: no raw defence string sits in the page un-escaped when it
// contains quote-sensitive characters.
check(!/DEFENCE:<\/b>[^\n]*<script/i.test(trapsHtml), 'defence lines never contain script tags');

// 4. Scorecard page renders the DEFENCE line for failed traps only,
//    via textContent — never innerHTML or template interpolation.
const scorecardJs = readFileSync(join(root, 'public/scorecard.js'), 'utf8');
check(scorecardJs.includes("el('p', 'signal defence-line', 'DEFENCE: ' + o.defence)"), 'scorecard renders DEFENCE through the textContent el() helper');
check(scorecardJs.includes("o.status === 'FAIL' && o.defence"), 'scorecard shows DEFENCE only for failed traps');
check(!/innerHTML[\s\S]{0,40}defence/i.test(scorecardJs), 'scorecard never assigns defence via innerHTML');
check(!/defence[^;]*`/.test(scorecardJs), 'scorecard never interpolates defence into a template literal');

// 5. Bundled OG scorecard shell matches the public shell (sync enforcement,
//    same invariant test/ogpreview.test.mjs enforces for the shell itself).
const bundled = (await import('../functions/scorecards/scorecard-html.js')).default;
check(bundled === readFileSync(join(root, 'public/scorecard.html'), 'utf8'), 'bundled scorecard-html matches public/scorecard.html');
check(bundled.includes('/scorecard.js'), 'bundled shell loads the interactive scorecard script that renders DEFENCE');

console.log(`\ndefence: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
