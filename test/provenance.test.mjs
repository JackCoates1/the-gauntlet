import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeRunSource } from '../functions/api/scorecards/[id].js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, value) => { if (value) console.log('ok:', name); else { failures++; console.error('FAIL:', name); } };

check('guided-demo is the sole declared live-demo source', normalizeRunSource('guided-demo') === 'guided-demo');
check('ordinary and untrusted values retain the modest live-api default', normalizeRunSource() === 'live-api' && normalizeRunSource('simulated') === 'live-api' && normalizeRunSource('agent') === 'live-api');
const endpoint = readFileSync(join(root, 'functions/api/scorecards/[id].js'), 'utf8');
check('sealed card stored with its run retains provenance', endpoint.includes('createdAt: new Date().toISOString(), source') && endpoint.includes('JSON.stringify(card)'));
const scorecard = readFileSync(join(root, 'public/scorecard.js'), 'utf8');
check('scorecard shows only the two non-live labels', scorecard.includes('GUIDED DEMO RUN') && scorecard.includes('SIMULATED / NO LIVE API') && scorecard.includes("c.source === 'guided-demo'"));

if (failures) process.exit(1);
console.log('\nall provenance tests passed');
