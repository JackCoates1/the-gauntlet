import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCompareOgTags, buildCompareFallbackOgTags, onRequestGet } from '../functions/compare/[a]/[b].js';

let failures = 0;
const check = (name, ok, extra = '') => { if (ok) console.log('ok:', name); else { failures++; console.log('FAIL:', name, extra); } };
const here = dirname(fileURLToPath(import.meta.url));
const a = { id: '11111111-2222-3333-4444-555555555555', score: 8, total: 10, outcomes: [] };
const b = { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', score: 5, total: 10, outcomes: [] };

const tags = buildCompareOgTags(a, b, 'https://gauntlet.jackcoates.co.uk/');
check('OG title includes both sealed scores', tags.includes('Gauntlet comparison: A 8/10 vs B 5/10'));
check('OG URL uses shareable /compare/:a/:b alias', tags.includes('/compare/11111111-2222-3333-4444-555555555555/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
check('OG reuses existing banner', tags.includes('/og-banner.png'));
check('OG tags trim trailing origin slash', !tags.includes('co.uk//'));
check('fallback has comparison title', buildCompareFallbackOgTags('https://x.test').includes('run comparison'));

const html = readFileSync(join(here, '../public/compare.html'), 'utf8');
const bundled = (await import('../functions/compare/compare-html.js')).default;
check('bundled comparison HTML matches public source', bundled === html);
check('comparison fetches both existing evidence endpoints', html.includes("'/evidence'") && html.includes('Promise.all([load(aId), load(bId)])'));
check('comparison renders aligned trap rows and resistance timelines', html.includes('compare-row') && html.includes('compare-timeline') && html.includes('resistanceTimeline'));
check('comparison creates the requested resist/fell delta', html.includes('resisted ') && html.includes('fell after '));
check('failed trap names retain catalog deep links', html.includes("'/traps#trap-'") && html.includes('trapSlug'));
check('comparison supports query and OG path IDs', html.includes("params.get('a')") && html.includes('pathIds'));
check('comparison has no innerHTML rendering', !/\.innerHTML\s*=|innerHTML\s*\+?=/.test(html));
check('comparison styles include responsive aligned table', readFileSync(join(here, '../public/styles.css'), 'utf8').includes('.compare-row'));

const fakeEnv = { GAUNTLET_DB: { prepare() { return { bind(id) { return { async first() { return { scorecard_json: JSON.stringify(id === a.id ? a : b) }; } }; } }; } } };
const res = await onRequestGet({ params: { a: a.id, b: b.id }, env: fakeEnv, request: new Request('https://gauntlet.jackcoates.co.uk/compare/' + a.id + '/' + b.id) });
const body = await res.text();
check('OG route returns HTML with dynamic preview', res.status === 200 && body.includes('Gauntlet comparison: A 8/10 vs B 5/10'));
check('OG tags precede closing head', body.indexOf('og:title') < body.indexOf('</head>'));
const invalid = await onRequestGet({ params: { a: 'bad', b: b.id }, env: fakeEnv, request: new Request('https://x.test/compare/bad/' + b.id) });
check('invalid path gets branded fallback without DB access', (await invalid.text()).includes('run comparison'));

if (failures) process.exit(1);
console.log('\nall comparison tests passed');
