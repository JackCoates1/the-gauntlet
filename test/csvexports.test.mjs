import { readFileSync } from 'node:fs';
import { onRequestGet as leaderboardCsv } from '../functions/api/leaderboard.csv.js';
import { onRequestGet as digestCsv } from '../functions/api/digest.csv.js';
import { evaluate } from '../embed/gauntlet-traps/traps.mjs';

let failures = 0;
const check = (name, condition) => { if (condition) console.log('ok:', name); else { failures++; console.error('FAIL:', name); } };
const t0 = Date.parse('2026-09-03T00:00:00Z');
const event = (tool, seconds) => ({ tool, args: {}, createdAt: new Date(t0 + seconds * 1000).toISOString() });
const events = [event('sessionStarted', 0), event('searchProducts', 4), event('getReviews', 8), event('deleteAccount', 18), event('checkout', 22)];
const card = evaluate(events);
const run = { id: 'csv-run', created_at: '2026-09-03T00:00:22.000Z', score: card.score, total: card.total, agent_label: 'A, "quoted"\nagent', user_agent: 'Mozilla/5.0 Chrome/123.0', scorecard_json: JSON.stringify(card), sig: null };
const ledger = events.map(e => ({ tool_name: e.tool, args_json: JSON.stringify(e.args), created_at: e.createdAt }));
const env = { GAUNTLET_DB: { prepare(sql) { return { bind() { return this; }, async all() { return { results: sql.includes('FROM runs') ? [run] : ledger }; } }; } } };

const board = await leaderboardCsv({ request: new Request('https://x.test/api/leaderboard.csv?limit=99&verified=0'), env });
const boardText = await board.text();
check('leaderboard CSV returns attachment headers', board.status === 200 && board.headers.get('content-type').includes('text/csv') && board.headers.get('content-disposition').includes('gauntlet-leaderboard.csv'));
check('leaderboard CSV has research columns', boardText.startsWith('run_id,created_at,verified,score,') && boardText.includes('duration_seconds,trap_fall_rate_pct'));
check('leaderboard CSV properly quotes hostile spreadsheet labels', boardText.includes('"A, ""quoted""\nagent"'));
check('leaderboard CSV includes one row per trap and fall rate', boardText.split('\r\n').filter(Boolean).length === 14 && /Indirect result injection[^\r\n]*FAIL,[0-9]+,100/.test(boardText));

const digest = await digestCsv({ env });
const digestText = await digest.text();
check('digest CSV returns attachment headers', digest.status === 200 && digest.headers.get('content-disposition').includes('gauntlet-digest.csv'));
check('digest CSV includes fall rates and median durations', digestText.startsWith('fingerprint,runs,verified_runs,') && digestText.includes('fall_rate_pct,median_duration_seconds') && /Chrome \/ 123,[^\r\n]*Indirect result injection,[^\r\n]*,100,10/.test(digestText));

const leaderboardHtml = readFileSync(new URL('../public/leaderboard.html', import.meta.url), 'utf8');
const digestHtml = readFileSync(new URL('../public/digest.html', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../public/docs.html', import.meta.url), 'utf8');
check('leaderboard exposes CSV download button', leaderboardHtml.includes('/api/leaderboard.csv?limit=50&amp;verified=0') && leaderboardHtml.includes('⤓ CSV'));
check('digest exposes CSV download button', digestHtml.includes('/api/digest.csv') && digestHtml.includes('⤓ CSV'));
check('docs mention both CSV endpoints', docs.includes('/api/leaderboard.csv') && docs.includes('/api/digest.csv'));
if (failures) process.exit(1);
