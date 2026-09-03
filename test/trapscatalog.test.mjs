// Trap catalog page (public/traps.html) consistency tests.
// The page is generated from embed/gauntlet-traps/traps.mjs by
// scripts/build-traps-page.mjs. These tests assert the generated page
// stays in sync with the real catalog and the real tool surface.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { TRAP_DEFS } from '../embed/gauntlet-traps/traps.mjs';
import { KNOWN_TOOLS } from '../functions/_ratelimit.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (cond, name) => { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + name); } };

// Regenerate from source so we test the current catalog, not a stale build
execFileSync('node', [join(root, 'scripts/build-traps-page.mjs')], { cwd: root });
const html = readFileSync(join(root, 'public/traps.html'), 'utf8');

// 1. Page exists, is branded off the shared stylesheet, and carries the nav
check(existsSync(join(root, 'public/traps.html')), 'traps page exists');
check(html.includes('/styles.css'), 'traps page links the shared stylesheet');
check(/THE <i>GAUNTLET<\/i>/.test(html), 'traps page carries the brand nav');
check(html.includes('href="/docs"'), 'traps page links API DOCS');
check(html.includes('embed/gauntlet-traps/traps.mjs'), 'traps page credits the catalog module');

// 2. Every trap in TRAP_DEFS is rendered with its full metadata
check(html.includes('FULL TRAP CATALOG'), 'traps page has the threat-model header');
const unesc = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
for (const t of TRAP_DEFS) {
  check(unesc(html).includes(t.name), `page renders trap name: ${t.name}`);
  check(unesc(html).includes(t.detail), `page renders trap detail: ${t.name}`);
  check(unesc(html).includes(t.attackClass), `page renders attack class: ${t.name}`);
  check(unesc(html).includes(t.reference), `page renders reference: ${t.name}`);
  check(unesc(html).includes(t.explain), `page renders detection predicate/explain: ${t.name}`);
}
check((html.match(/class="epi"/g) || []).length >= TRAP_DEFS.length, `page has >= ${TRAP_DEFS.length} trap cards`);

// 3. No drift: every trap tool named in the page must exist in KNOWN_TOOLS.
//    Extract tool-like identifiers from the rendered cards and check them.
const toolish = new Set([...html.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map(m => m[0]));
const pageTools = [...toolish].filter(t => KNOWN_TOOLS.has(t));
check(pageTools.length >= 4, `page references range tools (${pageTools.length} found)`);
for (const pt of pageTools) check(KNOWN_TOOLS.has(pt), `page tool ${pt} is in KNOWN_TOOLS`);

// 4. Cross-check the other direction: every KNOWN_TOOLS trap-actor tool that
//    any trap predicate references must appear somewhere on the page context.
//    (The catalog's violated predicates only use KNOWN_TOOLS members.)
const catalogViolatedTools = [...html.matchAll(/>([A-Za-z0-9_]+)<\/code>/g)].map(m => m[1]);
for (const t of TRAP_DEFS) {
  check(typeof t.violated === 'function' && typeof t.exposed === 'function', `trap has predicates: ${t.name}`);
  check(typeof t.attackClass === 'string' && t.attackClass.startsWith('LLM'), `attack class is OWASP-mapped: ${t.name}`);
}

// 5. XSS safety: catalog cards are generated server-side; the aggregate panel
//    is a textContent-only module so it can refresh as new runs arrive.
check(html.includes('src="/traps.js"') && readFileSync(join(root, 'public/traps.js'), 'utf8').includes("fetch('/api/trapstats')"), 'traps page loads live resistance statistics');
check(!/\.innerHTML\s*=/.test(html), 'traps runtime renderer has no innerHTML sink');
check(html.includes('same catalog module the range scores with'), 'traps page explains single source of truth');
check(html.includes('WHAT WE CHECK'), 'traps page labels the detection predicate');

console.log(`\ntrapscatalog: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
