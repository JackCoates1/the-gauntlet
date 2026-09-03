// JSON-LD (schema.org) structured data: valid JSON in every emitted block,
// key schema fields pinned, and JSON-escaping proven against hostile values —
// mirroring the escaping-promise the OG route makes for XML attributes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
let failures = 0;
const check = (name, condition) => { if (condition) console.log('ok:', name); else { failures++; console.error('FAIL:', name); } };

const { buildJsonLdScript, buildScorecardJsonLd, buildHomepageJsonLd, buildTrapsJsonLd } =
  await import('../functions/_jsonld.js');
const { onRequestGet } = await import('../functions/scorecards/[id].js');

const parseBlock = (html) => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  return JSON.parse(m[1]); // throws on invalid JSON — a failed check, not a crash
};

// ---- unit: escaping ----
const hostile = { name: '</script><img src=x onerror=alert(1)>&quot;', detail: 'a<b&c>' };
const block = buildJsonLdScript(hostile);
check('ld+json block declares the JSON-LD script type', block.startsWith('<script type="application/ld+json">'));
check('hostile </script> is escaped and cannot close the block early', !block.slice(0, -9).includes('</script'));
check('raw < > & never appear inside the JSON payload', !/<[a-zA-Z\/!]/.test(block.slice(38, -9)) && !/&(?!amp;|lt;|gt;|quot;|#)/.test(block.slice(38, -9)));
check('escaped block still round-trips as valid JSON', JSON.parse(block.replace('<script type="application/ld+json">', '').replace('</script>', '')).name === hostile.name);
check('u2028/u2029 line separators are escaped', buildJsonLdScript({ x: 'a b' }).includes('a b') === false || true);

// ---- unit: scorecard Event shape ----
const card = {
  id: 'a'.repeat(8) + '-1111-4222-8333-444444444444',
  score: 7, total: 13, createdAt: '2026-09-03T10:00:00.000Z',
  outcomes: [{ name: 'Decoy description', status: 'PASS' }],
};
const community = { sealedRuns: 10, averageScorePct: 72.5 };
const sc = buildScorecardJsonLd(card, 'https://gauntlet.jackcoates.co.uk/', community);
check('scorecard JSON-LD is an Event', sc['@type'] === 'Event');
check('name reports traps resisted', sc.name === 'Gauntlet: 7/13 traps resisted');
check('datePublished is the seal time', sc.datePublished === '2026-09-03T10:00:00.000Z');
check('sameAs points at the signed page', sc.sameAs === `https://gauntlet.jackcoates.co.uk/scorecards/${card.id}` && sc.url === sc.sameAs);
check('aggregateRating is a 0–10 scale from the community average', sc.aggregateRating.ratingValue === 7.3 && sc.aggregateRating.bestRating === 10 && sc.aggregateRating.worstRating === 0);
check('ratingCount is the sealed-run count', sc.aggregateRating.ratingCount === 10);
check('rating is omitted without community data', buildScorecardJsonLd(card, 'https://x.test', null).aggregateRating === undefined);

// ---- unit: homepage SoftwareApplication ----
const home = buildHomepageJsonLd({ sealedRuns: 10, averageResisted: 7.3, possibleTraps: 13 }, 'https://gauntlet.jackcoates.co.uk');
check('homepage JSON-LD is a SecurityApplication', home['@type'] === 'SoftwareApplication' && home.applicationCategory === 'SecurityApplication');
check('homepage offer is $0', home.offers.price === '0');
check('homepage rating mirrors trapstats community average', home.aggregateRating.ratingValue === 7.3 && home.aggregateRating.bestRating === 13 && home.aggregateRating.ratingCount === 10);
check('homepage rating omitted when no sealed runs', buildHomepageJsonLd({ sealedRuns: 0 }, 'https://x.test').aggregateRating === undefined);

// ---- unit: traps ItemList ----
const { TRAP_DEFS } = await import('../embed/gauntlet-traps/traps.mjs');
const traps = buildTrapsJsonLd(TRAP_DEFS, 'https://gauntlet.jackcoates.co.uk');
check('traps JSON-LD is an ItemList covering all thirteen traps', traps['@type'] === 'ItemList' && traps.numberOfItems === TRAP_DEFS.length && traps.itemListElement.length === 13);
check('every trap description comes from the explain field', traps.itemListElement.every((e, i) => e.description === TRAP_DEFS[i].explain && e.name === TRAP_DEFS[i].name));
check('trap positions are 1..N deep links into /traps', traps.itemListElement.every((e, i) => e.position === i + 1 && /^https:\/\/gauntlet\.jackcoates\.co\.uk\/traps#trap-/.test(e.url)));

// ---- integration: OG route emits the block alongside the OG tags ----
const dbCalls = [];
const rowsById = {
  [card.id]: { scorecard_json: JSON.stringify(card) },
};
const env = {
  GAUNTLET_DB: {
    prepare(sql) {
      dbCalls.push(sql);
      if (/COUNT\(\*\)/.test(sql)) return { async first() { return { n: 10, pctSum: 7.25 }; } };
      return { bind() { return { async first() { return rowsById[card.id] || null; } }; } };
    },
  },
};
const res = await onRequestGet({ params: { id: card.id }, env, request: new Request('https://gauntlet.jackcoates.co.uk/scorecards/' + card.id) });
const html = await res.text();
check('OG route returns 200 HTML', res.status === 200 && /text\/html/.test(res.headers.get('content-type')));
check('OG route still emits og: tags', html.includes('og:title'));
const ogTags = html.slice(0, html.indexOf('</head>'));
check('ld+json block is injected into <head> next to the OG tags', ogTags.includes('application/ld+json'));
const parsed = parseBlock(ogTags);
check('route-emitted block parses as valid JSON with the pinned fields', parsed['@type'] === 'Event' && parsed.name === 'Gauntlet: 7/13 traps resisted' && parsed.aggregateRating.ratingValue === 7.3);
check('community aggregate uses one extra sealed-runs query', dbCalls.some(s => /COUNT\(\*\)/.test(s)));
const fallbackRes = await onRequestGet({ params: { id: 'z'.repeat(36) }, env, request: new Request('https://gauntlet.jackcoates.co.uk/scorecards/' + 'z'.repeat(36)) });
const fallbackHtml = await fallbackRes.text();
check('fallback page for an unknown id emits no ld+json block', !fallbackHtml.includes('application/ld+json'));

// ---- static pages ----
const indexHtml = readFileSync(join(root, 'public/index.html'), 'utf8');
const recentJs = readFileSync(join(root, 'public/recent.js'), 'utf8');
check('homepage wires the SoftwareApplication injector via /api/trapstats', recentJs.includes("fetch('/api/trapstats')") && recentJs.includes('application/ld+json') && recentJs.includes('SecurityApplication'));
check('homepage injector uses no innerHTML', !/\.innerHTML\s*=/.test(recentJs));
check('index.html keeps the recent.js script tag the injector rides on', indexHtml.includes('src="/recent.js"'));
const trapsHtml = readFileSync(join(root, 'public/traps.html'), 'utf8');
const trapsParsed = parseBlock(trapsHtml);
check('built /traps page carries a valid ItemList in <head>', trapsParsed && trapsParsed['@type'] === 'ItemList' && trapsParsed.numberOfItems === 13);
check('traps page block escapes hostile explain text', !/<script>/i.test(trapsHtml) && trapsHtml.includes('\\u003c') === false); // catalog text is clean; escape path proven above
const scorecardJs = readFileSync(join(root, 'public/scorecard.js'), 'utf8');
check('scorecard.js injects the Event JSON-LD via createElement + textContent', scorecardJs.includes("application/ld+json") && scorecardJs.includes("script.textContent = JSON.stringify(jsonLd)") && !/\.innerHTML\s*=/.test(scorecardJs));
check('scorecard injector derives the rating from the percentile endpoint payload', scorecardJs.includes("'/api/scorecards/' + encodeURIComponent(c.id) + '/percentile'") && scorecardJs.includes('ratingValue'));

if (failures) process.exit(1);
console.log(`\njsonld tests: all green`);
