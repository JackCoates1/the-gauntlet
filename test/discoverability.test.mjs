// Static discoverability contract: every public HTML shell needs a useful
// description; browser icon fallbacks and crawler entry points must stay live.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
let pass = 0, fail = 0;
const check = (condition, name) => {
  if (condition) pass++;
  else { fail++; console.error('FAIL: ' + name); }
};

// Pages is configured to serve public/foo.html at /foo and index.html at /.
const routeFor = file => file === 'index.html' ? '/' : '/' + file.replace(/\.html$/, '');
const pages = readdirSync(publicDir).filter(file => file.endsWith('.html')).sort();
check(pages.length >= 9, `found public HTML shells (${pages.length})`);

for (const page of pages) {
  const html = readFileSync(join(publicDir, page), 'utf8');
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  const description = head.match(/<meta\s+name=["']description["']\s+content=(["'])(.*?)\1\s*\/?\s*>/i)?.[2] ?? '';
  check(description.trim().length >= 30, `${routeFor(page)} has a meaningful meta description`);
}

// SVG is the primary brand mark, while PNG/ICO cover older browsers, pinned
// shortcuts, and OS bookmark surfaces. These files are all served verbatim by
// Cloudflare Pages (200 when deployed).
const assets = ['favicon.svg', 'favicon-16.png', 'favicon-32.png', 'favicon.ico', 'apple-touch-icon.png'];
for (const asset of assets) check(existsSync(join(publicDir, asset)), `favicon asset resolves from public/: /${asset}`);
const svg = readFileSync(join(publicDir, 'favicon.svg'), 'utf8');
check(svg.includes('viewBox="0 0 512 512"') && svg.includes('#48e6a7'), 'favicon SVG is the acid-on-dark brand mark');
const png = readFileSync(join(publicDir, 'favicon-32.png'));
check(png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, 'PNG favicon fallback has PNG signature');
for (const page of ['index.html', 'docs.html', 'traps.html', 'scorecard.html']) {
  const html = readFileSync(join(publicDir, page), 'utf8');
  check(html.includes('href="/favicon.svg"') && html.includes('href="/favicon-32.png"'), `${routeFor(page)} declares SVG and PNG favicon links`);
}

const robots = readFileSync(join(publicDir, 'robots.txt'), 'utf8');
check(/User-agent:\s*\*/i.test(robots) && /Allow:\s*\//i.test(robots), 'robots.txt allows crawler access');
check(robots.includes('https://gauntlet.jackcoates.co.uk/sitemap.xml'), 'robots.txt advertises the canonical sitemap');

const sitemap = readFileSync(join(publicDir, 'sitemap.xml'), 'utf8');
const sitemapPaths = [...sitemap.matchAll(/<loc>https:\/\/gauntlet\.jackcoates\.co\.uk([^<]*)<\/loc>/g)].map(match => match[1] || '/');
const expectedPaths = ['/', '/traps', '/docs', '/leaderboard', '/digest', '/demo', '/verify'];
check(sitemapPaths.length === expectedPaths.length, 'sitemap contains exactly the seven judge-facing routes');
for (const route of expectedPaths) {
  check(sitemapPaths.includes(route), `sitemap lists ${route}`);
  const backingFile = route === '/' ? 'index.html' : route.slice(1) + '.html';
  check(existsSync(join(publicDir, backingFile)), `sitemap route is backed by a real public page: ${route}`);
}
check(new Set(sitemapPaths).size === sitemapPaths.length, 'sitemap contains no duplicate URLs');

console.log(`\ndiscoverability tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
