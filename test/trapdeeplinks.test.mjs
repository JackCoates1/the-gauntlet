// Trap deep-linking tests: /traps cards carry id="trap-<slug>" anchors derived
// from TRAP_DEFS, the scorecard page links failed traps to those anchors, and
// the scorecard slug logic mirrors trapSlug() in the catalog module.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TRAP_DEFS, trapSlug } from '../embed/gauntlet-traps/traps.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (cond, name) => { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + name); } };

// public/traps.html is the committed deploy artifact. Do not regenerate it
// here: node --test runs files concurrently, so a test-side write races the
// independent trap-stat tests that read the same artifact.
const trapsHtml = readFileSync(join(root, 'public/traps.html'), 'utf8');
const scorecardHtml = readFileSync(join(root, 'public/scorecard.html'), 'utf8');

// 1. Slug function is deterministic and well-formed
check(typeof trapSlug === 'function', 'trapSlug is exported from the catalog module');
for (const t of TRAP_DEFS) {
  const s = trapSlug(t.name);
  check(typeof s === 'string' && s.length > 0, `slug non-empty: ${t.name}`);
  check(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s), `slug is kebab-case: ${t.name} -> ${s}`);
  check(trapSlug(t.name) === s, `slug deterministic: ${t.name}`);
}

// 2. Every TRAP_DEFS entry has a matching anchor in traps.html — and every
//    anchor in traps.html maps back to a trap (no orphans, no drift).
const anchors = [...trapsHtml.matchAll(/<section class="epi" id="trap-([^"]+)"/g)].map(m => m[1]);
check(anchors.length === TRAP_DEFS.length, `traps.html has exactly ${TRAP_DEFS.length} trap anchors (found ${anchors.length})`);
for (const t of TRAP_DEFS) {
  const s = trapSlug(t.name);
  check(anchors.includes(s), `traps.html anchor exists for: ${t.name} (#trap-${s})`);
  const re = new RegExp(`id="trap-${s}"[\\s\\S]{0,200}?<h2>${t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h2>`);
  check(re.test(trapsHtml), `anchor #trap-${s} sits on the card for "${t.name}"`);
}
const slugs = new Set(TRAP_DEFS.map(t => trapSlug(t.name)));
for (const a of anchors) check(slugs.has(a), `anchor #trap-${a} corresponds to a real TRAP_DEFS entry`);

// 3. Slugs are unique
check(new Set(TRAP_DEFS.map(t => trapSlug(t.name))).size === TRAP_DEFS.length, 'trap slugs are unique');

// 4. Scorecard page deep-links failed traps to /traps#trap-<slug>
check(scorecardHtml.includes("link.href = '/traps#trap-' + trapSlug(o.name)"), 'scorecard builds /traps#trap-<slug> hrefs for failed traps');
check(scorecardHtml.includes('link.textContent = o.name'), 'scorecard sets link text via textContent (no innerHTML)');
check(!/<a[\s>][^>]*>.{0,40}\{\s*o\.name/.test(scorecardHtml), 'scorecard never interpolates trap names into markup');

// 5. The scorecard's local slug mirror must match the catalog's trapSlug
//    exactly — extract the arrow body from scorecard.html and compare outputs.
const m = scorecardHtml.match(/const trapSlug = \(name\) => (.+?);/);
check(!!m, 'scorecard defines its trapSlug mirror');
if (m) {
  let localSlug;
  try { localSlug = new Function('name', 'return ' + m[1]); } catch { localSlug = null; }
  check(!!localSlug, 'scorecard trapSlug mirror is parseable');
  if (localSlug) {
    for (const t of TRAP_DEFS) check(localSlug(t.name) === trapSlug(t.name), `scorecard slug matches catalog for: ${t.name}`);
    check(localSlug('Ünïcode Name!!') === trapSlug('Ünïcode Name!!'), 'scorecard slug matches catalog for non-ASCII input');
  }
}

// 6. Styles: :target highlight for the deep-linked card, and link affordance
const css = readFileSync(join(root, 'public/styles.css'), 'utf8');
check(/\.doc section\.epi:target/.test(css), 'styles.css has a :target highlight for trap cards');
check(/\.trap-link/.test(css), 'styles.css styles the .trap-link affordance');

// 7. Bundled OG scorecard HTML stays in sync with public/scorecard.html
const bundled = (await import('../functions/scorecards/scorecard-html.js')).default;
check(bundled === scorecardHtml, 'bundled scorecard-html.js matches public/scorecard.html (deep links included)');
check(bundled.includes('/traps#trap-'), 'bundled OG scorecard carries the deep-link logic');

// 8. XSS guard: scorecard page must not use innerHTML/outerHTML anywhere
//    (strip comments first — the code mentions the rule in its own comments).
const scorecardCode = scorecardHtml.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
check(!/(innerHTML|outerHTML|document\.write)/.test(scorecardCode), 'scorecard page uses no innerHTML/outerHTML/document.write (outside comments)');

console.log(`\ntrapdeeplinks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
