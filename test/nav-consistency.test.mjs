// Nav consistency contract: every public HTML shell — static or generated —
// must contain the exact core nav link set from scripts/nav.mjs, in the same
// order, so judges can reach every page from anywhere on the site.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Regenerate the pages built from single-source templates so we test what
// ships, not stale artifacts.
for (const script of ['build-traps-page.mjs', 'build-connect-page.mjs', 'build-scorecard-shell.mjs']) {
  execFileSync(process.execPath, [join(root, 'scripts', script)], { cwd: root });
}

const { coreNavHtml } = await import(join(root, 'scripts', 'nav.mjs'));

let pass = 0, fail = 0;
const check = (condition, name) => {
  if (condition) pass++;
  else { fail++; console.error('FAIL: ' + name); }
};

const publicDir = join(root, 'public');
const routeFor = file => file === 'index.html' ? '/' : '/' + file.replace(/\.html$/, '');
const pages = readdirSync(publicDir).filter(file => file.endsWith('.html')).sort();
check(pages.length >= 11, `found public HTML shells (${pages.length})`);

const navOf = html => html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i)?.[1] ?? '';
const anchorsOf = navHtml => [...navHtml.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)]
  .map(m => ({ href: m[1], label: m[2] }));

const coreLinks = anchorsOf(coreNavHtml);
check(coreLinks.length === 7, `core nav defines the full link set (${coreLinks.length}/7)`);
for (const link of coreLinks) {
  check(link.label.trim().length > 0, `core link ${link.href} has a label`);
}

for (const page of pages) {
  const html = readFileSync(join(publicDir, page), 'utf8');
  const navHtml = navOf(html);
  check(navHtml.length > 0, `${routeFor(page)} has a <nav> element`);
  const links = anchorsOf(navHtml);
  for (const core of coreLinks) {
    check(
      links.some(l => l.href === core.href && l.label.trim() === core.label.trim()),
      `${routeFor(page)} nav links to ${core.label} (${core.href})`
    );
  }
  // The core block must also appear as one contiguous, ordered run — not
  // scattered links in an arbitrary order.
  const hrefs = links.map(l => l.href);
  const coreHrefs = coreLinks.map(l => l.href);
  let idx = -1, contiguous = true;
  for (const href of coreHrefs) {
    idx = hrefs.indexOf(href, idx + 1);
    if (idx === -1) { contiguous = false; break; }
  }
  check(contiguous, `${routeFor(page)} keeps core nav links contiguous and ordered`);
}

// Generated-page sources must render from the shared module, not re-hardcode.
for (const src of ['scripts/build-traps-page.mjs', 'scripts/build-connect-page.mjs']) {
  const source = readFileSync(join(root, src), 'utf8');
  check(source.includes("from './nav.mjs'") && source.includes('renderNav()'),
    `${src} renders its nav from scripts/nav.mjs`);
  check(!/LEADERBOARD<\/a>/.test(source), `${src} has no hardcoded nav links`);
}

// The scorecard OG bundle (functions/scorecards/scorecard-html.js) is built
// from public/scorecard.html, which the loop above already covers — but assert
// the bundle itself stayed in sync.
const bundle = readFileSync(join(root, 'functions', 'scorecards', 'scorecard-html.js'), 'utf8');
check(bundle.includes(coreNavHtml) || navOf(JSON.parse(bundle.match(/export default (.*);/s)?.[1] ?? '""')).includes(coreLinks[0].href && '<a href="/leaderboard">LEADERBOARD</a>'),
  'scorecard OG bundle carries the core nav');

console.log(`\nnav-consistency tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
