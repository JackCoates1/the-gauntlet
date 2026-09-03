// Scorecard replay: ledger ordering/timing, server-timeline state parity, and
// the static + OG scorecard bundle all ship the safe browser walkthrough.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildResistanceTimeline } from '../functions/_evidence.js';
import { evaluate } from '../embed/gauntlet-traps/traps.mjs';
import { formatReplayArgs, orderReplayEvents, replayDurationMs, replaySpanMs, replayTrapStates, replayTrapTransitions, visibleEventCount } from '../public/replay.js';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log('ok:', name);
  else { failures++; console.log('FAIL:', name, detail); }
}
const here = dirname(fileURLToPath(import.meta.url));
const t0 = Date.parse('2026-09-03T00:00:00Z');
const event = (tool, offset, args = {}) => ({ tool, args, timestamp: new Date(t0 + offset * 1000).toISOString() });

// ---- chronological playback and time scaling ----
const unsorted = [event('third', 60), event('first', 0), event('second', 30), event('same-time-a', 30), event('same-time-b', 30)];
const ordered = orderReplayEvents(unsorted);
check('orders events by ledger timestamps', ordered.map(e => e.tool).join(',') === 'first,second,same-time-a,same-time-b,third');
check('equal timestamps retain ledger order', ordered[1].tool === 'second' && ordered[3].tool === 'same-time-b');
check('ordering does not mutate signed input ledger', unsorted[0].tool === 'third');
check('ordering assigns stable ledger indexes', ordered.map(e => e._ledgerIndex).join(',') === '1,2,3,4,0');
check('60-second ledger span is measured from timestamps', replaySpanMs(unsorted) === 60000);
check('60-second ledger plays in ten seconds', replayDurationMs(unsorted) === 10000);
check('short ledger gets readable minimum duration', replayDurationMs([event('one', 0)]) === 1200);
check('empty ledger has zero visible events', visibleEventCount([], 100) === 0);
check('first event is visible at replay start', visibleEventCount(ordered, 0) === 1);
check('six-times speed exposes 30s event at 5s', visibleEventCount(ordered, 5000) === 4);
check('all events appear by the scaled end', visibleEventCount(ordered, 10000) === 5);
check('negative scrub values are clamped to start', visibleEventCount(ordered, -10) === 1);

// ---- transitions match buildResistanceTimeline's sealed outcomes ----
const run = [
  event('sessionStarted', 0), event('searchProducts', 5, { query: 'coffee' }),
  event('getReviews', 12, { id: 'p1' }), event('getPrice', 20, { id: 'p1' }),
  event('deleteAccount', 42), event('addToCart', 55, { id: 'p1', quantity: 12 }),
  event('checkout', 70, { id: 'p1' }), event('getOrderStatus', 85, { id: 'p1' }),
];
const timeline = buildResistanceTimeline(run.map(({ timestamp, ...rest }) => ({ ...rest, createdAt: timestamp })), evaluate(run.map(({ timestamp, ...rest }) => ({ ...rest, createdAt: timestamp }))).outcomes);
const transitions = replayTrapTransitions(run, timeline);
const finalStates = replayTrapStates(run, timeline, run.length);
const earlyStates = replayTrapStates(run, timeline, 0);
check('replay creates one transition per resistance-timeline trap', transitions.length === timeline.length && transitions.length === 10);
check('all traps start grey/pending', earlyStates.every(state => state.state === 'pending'));
check('final replay state matches every sealed timeline outcome', finalStates.every((state, i) => state.state === (timeline[i].status === 'PASS' ? 'resisted' : timeline[i].status === 'FAIL' ? 'fell' : 'untested')));
check('indirect-injection transition keeps server failure status', transitions.find(t => t.name === 'Indirect result injection')?.status === 'FAIL');
check('indirect-injection flips on its violation tool', transitions.find(t => t.name === 'Indirect result injection')?.eventIndex === 5);
check('resisted trap flips only at ledger completion', transitions.find(t => t.name === 'Typosquat tool name')?.eventIndex === run.length);
check('not-tested trap has no premature outcome transition', transitions.find(t => t.name === 'Credential exfiltration')?.eventIndex === run.length);
check('failure is visible at its real-time event', replayTrapStates(run, timeline, 5).find(t => t.name === 'Indirect result injection')?.state === 'fell');
check('resistance is not shown before final event', replayTrapStates(run, timeline, run.length - 1).find(t => t.name === 'Typosquat tool name')?.state === 'pending');
check('final states include both resisted and fell outcomes', finalStates.some(t => t.state === 'resisted') && finalStates.some(t => t.state === 'fell'));
check('argument formatter produces legible JSON', formatReplayArgs({ path: '/etc/passwd' }) === '{"path":"/etc/passwd"}');
check('argument formatter tolerates circular hostile objects', formatReplayArgs((() => { const x = {}; x.x = x; return x; })()) === '[unserializable args]');

// ---- page wiring, XSS guard, CSS, and generated OG variant ----
const scorecard = readFileSync(join(here, '../public/scorecard.html'), 'utf8');
const bundled = (await import('../functions/scorecards/scorecard-html.js')).default;
const css = readFileSync(join(here, '../public/styles.css'), 'utf8');
check('scorecard fetches evidence only once for timeline and replay', (scorecard.match(/\/evidence/g) || []).length === 2); // endpoint + download link
check('scorecard has replay-run button', scorecard.includes('▶ REPLAY RUN'));
check('scorecard has pause control', scorecard.includes('❚❚ PAUSE REPLAY'));
check('scorecard has an accessible scrub bar', scorecard.includes("setAttribute('aria-label', 'Replay position')"));
check('scorecard drives playback with requestAnimationFrame', scorecard.includes('requestAnimationFrame(tick)') && scorecard.includes('cancelAnimationFrame(frame)'));
check('ledger cards name the tool and arguments', scorecard.includes("'Tool called: ' + event.tool + ' → args: '"));
check('scorecard uses textContent-only replay rendering', !/\.innerHTML\s*=|innerHTML\s*\(/.test(scorecard) && scorecard.includes('ledger.textContent = \'\''));
check('replay helper is a static public client module', scorecard.includes("from '/replay.js'"));
check('replay styles include pending/resisted/fell states', ['.replay-pending', '.replay-resisted', '.replay-fell', '.replay-scrub'].every(rule => css.includes(rule)));
check('generated OG scorecard bundle is synchronized', bundled === scorecard);
check('OG scorecard variant contains replay wiring', bundled.includes('TAMPER-EVIDENT REPLAY') && bundled.includes("from '/replay.js'"));

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall replay tests passed');
