import { redactArgs, TRAP_DEFS, evaluate } from '../embed/gauntlet-traps/traps.mjs';
import { onRequestGet as evidence } from '../functions/api/scorecards/[id]/evidence.js';
import { verifyBundle } from '../functions/_evidence.js';
import { verifyBundleClient } from '../public/verify.js';
import { formatReplayArgs } from '../public/replay.js';
import { onRequestGet as leaderboardCsv } from '../functions/api/leaderboard.csv.js';
import { onRequestGet as digestCsv } from '../functions/api/digest.csv.js';

let failures = 0;
const check = (name, ok, extra = '') => { if (ok) console.log('ok:', name); else { failures++; console.error('FAIL:', name, extra); } };
const t0 = Date.parse('2026-09-03T00:00:00Z');
const ev = (tool, seconds, args = {}) => ({ tool, args, createdAt: new Date(t0 + seconds * 1000).toISOString() });
const raw = {
  email: 'support.agent@example.com', phone: '+44 7700 900123', card: '4242 4242 4242 4242',
  nested: { apiKey: 'demo-secret-value', opaque: 'abcdefghijklmnopqrstuvwx', note: 'ordinary value' },
};
const redacted = redactArgs(raw);
check('masks email while retaining a small safe hint', redacted.email === 'sup***@***.com', JSON.stringify(redacted));
check('masks phone and card patterns', redacted.phone === '***-***-****' && redacted.card === '**** **** **** 4242');
check('masks long secret-shaped values', redacted.nested.apiKey === '[REDACTED]' && redacted.nested.opaque === 'abc***');
check('does not mutate input while redacting', raw.nested.opaque === 'abcdefghijklmnopqrstuvwx' && raw !== redacted && raw.nested !== redacted.nested);
check('leaves clean arguments unchanged', JSON.stringify(redactArgs({ sku: 'NODE-01', quantity: 1, note: 'ordinary value' })) === JSON.stringify({ sku: 'NODE-01', quantity: 1, note: 'ordinary value' }));
for (const field of TRAP_DEFS.flatMap(trap => trap.sensitiveFields || [])) {
  check(`masks ${field} declared by trap definitions`, redactArgs({ [field]: 'would-leak' })[field] === '[REDACTED]');
}
check('client replay formatter applies the same defensive masking', !formatReplayArgs({ email: raw.email }).includes(raw.email) && formatReplayArgs({ email: raw.email }).includes('sup***@***.com'));

const events = [
  ev('sessionStarted', 0), ev('searchProducts', 2, { query: 'Signal Node' }),
  ev('getReviews', 4), ev('syncLoyaltyAccount', 6, { loyaltyId: 'L-1' }),
  ev('exportSessionBackup', 8, { session_token: 'session-super-secret-0123456789' }),
  ev('sendPromoEmail', 10, { to: raw.email, card_number: '4242424242424242' }), ev('checkout', 12, { items: [{ sku: 'NODE-01', quantity: 1 }] }),
];
const card = { ...evaluate(events), id: '11111111-2222-3333-4444-555555555555', createdAt: '2026-09-03T00:00:12.000Z' };
const ledger = events.map(event => ({ tool_name: event.tool, args_json: JSON.stringify(event.args), created_at: event.createdAt }));
const run = { id: card.id, created_at: card.createdAt, score: card.score, total: card.total, agent_label: 'Privacy fixture', user_agent: 'Mozilla/5.0 Chrome/123.0', scorecard_json: JSON.stringify(card), sig: null };
const key = '302e020100300506032b657004220420bae71f4303776d802121f641a07f855c25e701a9f8717ac124a2bf60e15623a0';
const env = { GAUNTLET_SIGNING_KEY: key, GAUNTLET_DB: { prepare(sql) { return { bind() { return this; }, async first() { return sql.includes('FROM runs') ? { scorecard_json: run.scorecard_json, user_agent: run.user_agent } : null; }, async all() { return { results: sql.includes('FROM runs') ? [run] : ledger }; } }; } } };
const response = await evidence({ params: { id: card.id }, env });
const bundle = await response.json(); const serialized = JSON.stringify(bundle);
check('evidence endpoint marks replay as a redacted presentation view', response.status === 200 && bundle.redaction?.applied === true);
check('evidence endpoint strips fixture PII and secrets', !serialized.includes(raw.email) && !serialized.includes('4242424242424242') && !serialized.includes('session-super-secret'));
check('redacted replay retains chain links and signed root', bundle.replay.at(-1).hash === bundle.eventsRoot && bundle.replay.every((step, i) => step.prevHash === (i ? bundle.replay[i - 1].hash : 'genesis')));
check('signature still verifies over the unchanged canonical payload', (await verifyBundle(bundle)).ok === true, JSON.stringify(await verifyBundle(bundle)));
check('browser verifier accepts the redacted signed view', (await verifyBundleClient(bundle)).ok === true);

const board = await leaderboardCsv({ request: new Request('https://x.test/api/leaderboard.csv?verified=0'), env });
const digest = await digestCsv({ env });
check('CSV exports contain no raw argument payloads', !(await board.text()).includes(raw.email) && !(await digest.text()).includes(raw.email));

if (failures) process.exit(1);
console.log('\nall redaction tests passed');
