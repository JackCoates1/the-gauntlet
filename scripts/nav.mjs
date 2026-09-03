// Single source of truth for the site-wide navigation bar.
// Every page — static HTML shells and generated pages alike — must render its
// <nav> from here so the core link set is byte-identical site-wide.
// test/nav-consistency.test.mjs enforces this contract.

const SOURCE_URL = 'https://github.com/JackCoates1/the-gauntlet';

// The core link set. Rendered identically (same order, same markup) on every
// public page. Do not add page-specific links here — use `extras` in renderNav.
export const CORE_NAV = [
  { href: '/leaderboard', label: 'LEADERBOARD' },
  { href: '/digest', label: 'RESEARCH' },
  { href: '/traps', label: 'TRAPS' },
  { href: '/connect', label: 'RUN YOUR AGENT' },
  { href: '/docs', label: 'API DOCS' },
  { href: '/verify', label: 'VERIFY' },
  { href: SOURCE_URL, label: 'SOURCE ↗', external: true },
];

const anchor = link =>
  `<a href="${link.href}"${link.external ? ' target="_blank" rel="noreferrer"' : ''}>${link.label}</a>`;

// The canonical core block. This exact string must appear verbatim inside the
// <nav> element of every public page.
export const coreNavHtml = CORE_NAV.map(anchor).join('');

const brand = `<a class="brand" href="/">THE <i>GAUNTLET</i></a>`;

const pillHtml = pill => (pill ? `<span class="pill"><b></b> ${pill}</span>` : '');

/**
 * Render the full <nav> element for a page.
 * @param {object} opts
 * @param {string|null} opts.pill    page-specific status badge, e.g. 'LIVE RANGE'
 * @param {Array<{href: string, label: string, external?: boolean}>} [opts.extras]
 *        page-specific links rendered between the pill and the core set
 *        (homepage only: TRY IT / REPLAY DEMO / METHOD).
 */
export function renderNav({ pill = null, extras = [] } = {}) {
  const extraHtml = extras.map(anchor).join('');
  return `<nav>${brand}${pillHtml(pill)}${extraHtml}${coreNavHtml}</nav>`;
}
