// Attack-class profile: class aggregation comes from the signed per-trap
// timeline plus catalog metadata, while its DOM renderer stays textContent-only.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { buildAttackClassProfile, renderAttackClassProfile } from '../public/attack-profile.js';
import { TRAP_DEFS, trapSlug } from '../embed/gauntlet-traps/traps.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond) => { if (cond) console.log('ok:', name); else { failures++; console.error('FAIL:', name); } };
const timeline = [
  { name: 'Decoy description', status: 'PASS' },
  { name: 'Typosquat tool name', status: 'FAIL' },
  { name: 'Credential exfiltration', status: 'PASS' },
  { name: 'Third-party PII leakage', status: 'NOT TESTED' },
];

const profile = buildAttackClassProfile(timeline, TRAP_DEFS);
const llm01 = profile.find(group => group.code === 'LLM01');
const llm02 = profile.find(group => group.code === 'LLM02');
check('groups tested traps by OWASP class', profile.length === 2 && llm01?.resisted === 1 && llm01?.fell === 1 && llm01?.total === 2 && llm02?.resisted === 1 && llm02?.total === 1);
check('excludes untested traps from numerators and denominators', !profile.some(group => group.total > 1 && group.code === 'LLM02'));
check('soft-fails old or malformed bundles', buildAttackClassProfile(null, TRAP_DEFS).length === 0 && buildAttackClassProfile([], TRAP_DEFS).length === 0);
check('ignores unknown or duplicate timeline entries', buildAttackClassProfile([...timeline, timeline[0], { name: 'unknown', status: 'FAIL' }], TRAP_DEFS).find(group => group.code === 'LLM01')?.total === 2);

const oldDocument = globalThis.document;
const dom = new JSDOM('<main id="card"></main>', { url: 'https://x.test/scorecard?id=x' });
globalThis.document = dom.window.document;
const card = document.querySelector('#card');
check('renderer emits the compact profile', renderAttackClassProfile(card, timeline, TRAP_DEFS, trapSlug) === true && card.querySelector('.attack-profile') !== null);
check('class labels deep-link into the catalog', card.querySelector('.attack-profile-label')?.getAttribute('href') === '/traps#trap-decoy-description');
check('bar uses separate acid/red segments in score proportions', card.querySelector('.attack-profile-pass')?.classList.contains('attack-profile-grow-1') && card.querySelector('.attack-profile-fail')?.classList.contains('attack-profile-grow-1'));
check('failed class receives one canonical mitigation line', card.querySelector('.attack-profile-coaching')?.textContent.includes(TRAP_DEFS.find(t => t.name === 'Typosquat tool name').mitigation));

// A hostile catalog is intentionally passed to the renderer: it must become
// literal text, never an executable node or markup sink.
card.textContent = '';
const hostile = [{ name: 'trap', attackClass: 'LLM99: <img src=x>', mitigation: '<img src=x onerror=alert(1)>' }];
renderAttackClassProfile(card, [{ name: 'trap', status: 'FAIL' }], hostile, trapSlug);
check('XSS guard renders hostile mitigation as literal text', card.querySelector('img') === null && card.textContent.includes('<img src=x onerror=alert(1)>'));
globalThis.document = oldDocument;

const scorecard = readFileSync(join(root, 'public/scorecard.js'), 'utf8');
const css = readFileSync(join(root, 'public/styles.css'), 'utf8');
const bundled = (await import('../functions/scorecards/scorecard-html.js')).default;
check('scorecard derives profile after its evidence timeline', scorecard.includes('renderAttackClassProfile(card, tl, TRAP_DEFS, trapSlug)'));
check('profile renderer has no HTML injection sink', !/innerHTML|outerHTML|document\.write/.test(readFileSync(join(root, 'public/attack-profile.js'), 'utf8')));
check('profile styling reuses timeline acid and red palette', css.includes('.attack-profile-pass') && css.includes('#c5ff5f') && css.includes('.attack-profile-fail') && css.includes('#ff6b6b'));
check('OG scorecard shell remains synchronized', bundled === readFileSync(join(root, 'public/scorecard.html'), 'utf8') && bundled.includes('src="/scorecard.js"'));

if (failures) process.exit(1);
console.log('\nall attack-profile tests passed');
