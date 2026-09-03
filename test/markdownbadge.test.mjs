// README badge: shields-style SVG query handling plus the safe two-format UI.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { badgeColor, safeBadgeColor, svg } from '../functions/_lib.js';
import { onRequestGet } from '../functions/api/badge/[id].svg.js';

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) console.log('ok:', name);
  else { failures++; console.log('FAIL:', name, detail); }
};
const here = dirname(fileURLToPath(import.meta.url));
const id = 'd44bed6c-cb61-4d9e-b556-329abde3d438';
const card = { score: 9, total: 10 };

check('excellent score derives brightgreen', badgeColor('9/10') === 'brightgreen');
check('middle score derives yellowgreen', badgeColor('5/10') === 'yellowgreen');
check('low score derives red', badgeColor('2/10') === 'red');
check('invalid score derives neutral color', badgeColor('bad') === 'lightgrey');
check('named and hex colors are allowed', safeBadgeColor('orange', 'red') === 'orange' && safeBadgeColor('#12ab34', 'red') === '#12ab34');
check('unsafe color falls back to score color', safeBadgeColor('url(javascript:bad)', 'green') === 'green');

const rendered = svg(card, { label: 'The Gauntlet', score: '9/10' });
check('SVG uses compact shields dimensions', rendered.includes('height="20"') && /width="\d+"/.test(rendered));
check('SVG has separate label and score fields', rendered.includes('>The Gauntlet</text>') && rendered.includes('>9/10</text>'));
check('SVG derives score color when query omits it', rendered.includes('fill="brightgreen"'));
check('SVG escapes hostile label and never leaks markup', !svg(card, { label: '"><script>alert(1)</script>' }).includes('<script>'));
check('malformed requested score falls back to stored score', svg(card, { score: '999/evil' }).includes('>9/10</text>'));

const env = { GAUNTLET_DB: { prepare() { return { bind() { return { async first() { return { scorecard_json: JSON.stringify(card) }; } }; } }; } } };
const response = await onRequestGet({ params: { id: id + '.svg' }, env, request: new Request('https://x.test/api/badge/' + id + '.svg?label=The%20Gauntlet&score=9%2F10&color=orange') });
const body = await response.text();
check('endpoint returns SVG with requested shield fields', response.status === 200 && response.headers.get('content-type').includes('image/svg+xml') && body.includes('>The Gauntlet</text>') && body.includes('>9/10</text>'));
check('endpoint honours safe custom color', body.includes('fill="orange"'));
check('endpoint has one-hour cache and nosniff', response.headers.get('cache-control') === 'public, max-age=3600' && response.headers.get('x-content-type-options') === 'nosniff');
const missing = await onRequestGet({ params: { id: 'not-a-run.svg' }, env, request: new Request('https://x.test') });
check('invalid id is rejected before D1 output', missing.status === 404);

const page = readFileSync(join(here, '../public/scorecard.js'), 'utf8');
check('scorecard has image and markdown format toggles', page.includes("'IMAGE EMBED'") && page.includes("'MARKDOWN EMBED'"));
check('scorecard markdown is a linked README one-liner', page.includes("'[![The Gauntlet: ' + score + ']('") && page.includes("+ ')](' + scorecardUrl + ')'"));
check('scorecard sends exact label and score query parameters', page.includes("label=' + encodeURIComponent('The Gauntlet')") && page.includes("'&score=' + encodeURIComponent(score)"));
check('scorecard copy UI uses clipboard and copied confirmation', page.includes('navigator.clipboard.writeText(snippets[format])') && page.includes("copy.textContent = 'COPIED'"));
check('scorecard continues DOM/textContent-only rendering', !/\.innerHTML\s*=|innerHTML\s*\(/.test(page));

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall markdown-badge tests passed');
