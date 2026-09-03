import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluate } from '../embed/gauntlet-traps/traps.mjs';

let failures = 0;
const check = (name, ok, extra = '') => { if (ok) console.log('ok:', name); else { failures++; console.error('FAIL:', name, extra); } };
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(readFileSync(join(root, 'public/baseline.json'), 'utf8'));
const fixture = JSON.parse(readFileSync(join(root, 'public/demo-fixture.json'), 'utf8'));
const scorecard = readFileSync(join(root, 'public/scorecard.js'), 'utf8');
const compare = readFileSync(join(root, 'public/compare.js'), 'utf8');
const seed = readFileSync(join(root, 'scripts/seed-baseline.mjs'), 'utf8');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const result = evaluate(fixture.events);

check('baseline descriptor has a pinned UUID', uuid.test(baseline.id));
check('baseline descriptor identifies the public fixture', baseline.fixture === 'demo-fixture.json');
check('baseline descriptor matches the fixture’s real score', baseline.score === result.score && baseline.total === result.total && baseline.label === `${result.score}/${result.total} reference agent`);
check('fixture remains the requested 9/13 reference', result.score === 9 && result.total === 13);
check('scorecard renders one-click baseline comparison', scorecard.includes("fetch('/baseline.json'") && scorecard.includes("'/compare/a/' + encodeURIComponent(c.id) + '/b/' + encodeURIComponent(baseline.id)") && scorecard.includes('COMPARE VS BASELINE'));
const bundledScorecard = (await import('../functions/scorecards/scorecard-html.js')).default;
check('both scorecard routes carry the same comparison bundle', bundledScorecard === readFileSync(join(root, 'public/scorecard.html'), 'utf8'));
check('compare page names the reference and highlights judged-run failures', compare.includes('YOUR RUN') && compare.includes('REFERENCE AGENT') && compare.includes('Your run fell for '));
check('seed script replays fixture events through public API and seals them', seed.includes("'/api/events'") && seed.includes("'/api/scorecards/'") && seed.includes('await wait('));

if (failures) process.exit(1);
console.log('\nall baseline tests passed');
