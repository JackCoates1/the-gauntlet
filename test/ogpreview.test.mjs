// Shareable scorecard preview tests: OG meta tag generation on the
// /scorecards/:id Pages Function and the bundled scorecard HTML.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildOgTags, buildFallbackOgTags, onRequestGet } from '../functions/scorecards/[id].js';

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log('ok:', name);
  else { failures++; console.log('FAIL:', name, extra); }
}

const here = dirname(fileURLToPath(import.meta.url));

// ---- unit: buildOgTags ----
const card = {
  id: 'd44bed6c-cb61-4d9e-b556-329abde3d438',
  score: 7, total: 7,
  outcomes: [
    { name: 'Clean trap', status: 'PASS' },
    { name: 'Sneaky & "quoted" trap', status: 'PASS' },
  ],
  badges: ['UNSWAYED'],
};
const tags = buildOgTags(card, 'https://gauntlet.jackcoates.co.uk/');

check('og:title present with score', /<meta property="og:title" content="Gauntlet: 7\/7 traps resisted">/.test(tags), tags);
check('og:description present', /<meta property="og:description" content="Clean run[^"]*">/.test(tags));
check('og:image points at banner', tags.includes('<meta property="og:image" content="https://gauntlet.jackcoates.co.uk/og-banner.png">'));
check('og:image dimensions 1200x630', tags.includes('og:image:width" content="1200"') && tags.includes('og:image:height" content="630"'));
check('twitter:card summary_large_image', tags.includes('<meta name="twitter:card" content="summary_large_image">'));
check('og:url uses /scorecards/ alias', tags.includes('https://gauntlet.jackcoates.co.uk/scorecards/d44bed6c-cb61-4d9e-b556-329abde3d438'));
check('origin trailing slash trimmed', !tags.includes('co.uk//'));

// partial score mentions first failing trap name
const partial = buildOgTags({
  id: 'd44bed6c-cb61-4d9e-b556-329abde3d438', score: 3, total: 7,
  outcomes: [{ name: 'Discount stacking', status: 'PASS' }, { name: 'Fake override tool', status: 'FAIL' }, { name: 'Untested', status: 'NOT TESTED' }],
}, 'https://x.test');
check('partial score title uses sealed score', partial.includes('content="Gauntlet: 3/7 traps resisted"'), partial.slice(0, 200));
check('failing trap named in description', partial.includes('Fake override tool flagged for review'));
check('NOT TESTED excluded from counts', !partial.includes('Untested'));

// XML escaping: hostile trap name cannot break out of the attribute
const hostile = buildOgTags({
  id: 'd44bed6c-cb61-4d9e-b556-329abde3d438', score: 0, total: 2,
  outcomes: [{ name: '"><script>alert(1)</script>', status: 'FAIL' }],
}, 'https://x.test');
check('trap name XML-escaped', !hostile.includes('<script>') && hostile.includes('&quot;&gt;&lt;script&gt;'));
check('attr closed exactly once per meta', (hostile.match(/content="[^"]*">/g) || []).length === (hostile.match(/<meta /g) || []).length);

// NOT TESTED-only card → generic title, not 0/0
const untested = buildOgTags({ id: 'x'.repeat(36), score: 0, total: 0, outcomes: [{ status: 'NOT TESTED' }] }, 'https://x.test');
check('all-untested falls back to 0/0 title', untested.includes('content="Gauntlet: 0/0 traps resisted"'));

// long trap name clipped
const long = 'X'.repeat(200);
const clipped = buildOgTags({ id: 'x'.repeat(36), score: 0, total: 1, outcomes: [{ name: long, status: 'FAIL' }] }, 'https://x.test');
check('long trap name clipped to 80 chars', !clipped.includes(long) && /X{70,}… flagged for review/.test(clipped));

// ---- unit: fallback tags ----
const fb = buildFallbackOgTags('https://gauntlet.jackcoates.co.uk');
check('fallback og:title present', fb.includes('content="The Gauntlet — agent security scorecard"'));
check('fallback og:image present', fb.includes('/og-banner.png'));

// ---- bundled HTML stays in sync with public/scorecard.html ----
const publicHtml = readFileSync(join(here, '../public/scorecard.html'), 'utf8');
const bundled = (await import('../functions/scorecards/scorecard-html.js')).default;
check('bundled scorecard-html matches public/scorecard.html', bundled === publicHtml);
check('scorecard page has SHARE RESULT button', publicHtml.includes("'SHARE RESULT'"));
check('share uses navigator.share', publicHtml.includes('navigator.share'));
check('share has clipboard fallback', publicHtml.includes('navigator.clipboard.writeText(shareUrl)'));
check('share URL uses /scorecards/ alias', publicHtml.includes("'/scorecards/' + encodeURIComponent(c.id)"));

// ---- integration: onRequestGet injects tags into the served HTML ----
const fakeEnv = {
  GAUNTLET_DB: {
    prepare(sql) {
      return { bind() { return { async first() { return { scorecard_json: JSON.stringify(card) }; } }; } };
    },
  },
};
const res = await onRequestGet(
  { params: { id: 'd44bed6c-cb61-4d9e-b556-329abde3d438' }, env: fakeEnv, request: new Request('https://gauntlet.jackcoates.co.uk/scorecards/d44bed6c-cb61-4d9e-b556-329abde3d438') },
);
const body = await res.text();
check('onRequestGet returns 200 html', res.status === 200 && res.headers.get('content-type').includes('text/html'));
check('response contains og:title', body.includes('og:title'));
check('tags injected before </head>', body.indexOf('og:title') < body.indexOf('</head>'));
check('body still contains app script', body.includes("new URLSearchParams(location.search)"));

// unknown id → fallback tags still injected
const fakeEnvMiss = { GAUNTLET_DB: { prepare() { return { bind() { return { async first() { return null; } }; } }; } } };
const res2 = await onRequestGet({ params: { id: '1'.repeat(36) }, env: fakeEnvMiss, request: new Request('https://x.test/scorecards/' + '1'.repeat(36)) });
const body2 = await res2.text();
check('unknown id gets fallback tags', body2.includes('agent security scorecard') && body2.includes('og:title'));

// invalid id never touches D1
const res3 = await onRequestGet({ params: { id: 'DROP TABLE' }, env: fakeEnv, request: new Request('https://x.test/scorecards/x') });
check('invalid id returns fallback page 200', res3.status === 200 && (await res3.text()).includes('og:title'));

// banner asset exists and has OG dimensions
const png = readFileSync(join(here, '../public/og-banner.png'));
check('og-banner.png exists with PNG magic', png.length > 10000 && png[0] === 0x89 && png[1] === 0x50);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
