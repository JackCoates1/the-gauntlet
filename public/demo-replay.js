import { evaluate, buildResistanceTimeline, trapSlug, TRAP_DEFS } from '/embed/gauntlet-traps/traps.mjs';
const fixture = await fetch('/demo-fixture.json').then(r => { if (!r.ok) throw new Error('Demo fixture unavailable'); return r.json(); });
const events = Array.isArray(fixture.events) ? fixture.events : [];
const card = evaluate(events); const timeline = buildResistanceTimeline(events, card.outcomes);
const el = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value !== undefined) n.textContent = value; return n; };
const root = document.querySelector('#scorecard'), play = document.querySelector('#play'), reset = document.querySelector('#reset'); let timer = null;
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function outcomeName(outcome) { if (outcome.status !== 'FAIL') return el('h3', '', outcome.name); const link = el('a', 'trap-link', outcome.name); link.href = '/traps#trap-' + trapSlug(outcome.name); const h = el('h3'); h.append(link); return h; }

// Incremental replay rendering: instead of rebuilding the whole table on every
// tick, each 500ms step appends only what just happened — a ledger line lands,
// a timeline segment flips from pending to its sealed outcome, and a trap
// result card resolves (red/green flip) at the moment the ledger reaches the
// tool that sealed it. Resisted traps flip only when the run completes, so the
// reveal matches the scorecard replay's pacing contract.
const maxSeconds = Math.max(1, ...timeline.map(x => x.seconds));
let strip, headPara, grid, ledgerBody;

function buildSkeleton() {
  root.textContent = '';
  const head = el('div', 'section-head'), score = el('div');
  score.append(el('div', 'eyebrow', 'SIMULATED SCORECARD / REAL ENGINE OUTPUT'), el('h2', '', String(card.score) + '/' + card.total + ' RESISTED'));
  headPara = el('p', '', fixture.label + ' · 0/' + events.length + ' ledger events shown.');
  head.append(score, headPara); root.append(head);
  root.append(el('div', 'eyebrow tl-head', 'RESISTANCE TIMELINE'));
  strip = el('div', 'tl-strip');
  for (const item of timeline) strip.append(el('div', 'tl-seg tl-untested demo-tl-seg'), el('div', 'tl-line tl-untested', item.name + ' — RUNNING…'));
  root.append(strip);
  grid = el('div', 'grid'); root.append(grid);
  const replay = el('div', 'console demo-ledger'), bar = el('div', 'console-bar');
  bar.append(el('label', '', 'simulated tool ledger / paced replay'));
  ledgerBody = el('div', 'console-body'); ledgerBody.append(el('div', 'line muted', 'Press replay to reveal the recorded tool calls.'));
  replay.append(bar, ledgerBody); root.append(replay);
}

function resolveSegment(index, final) {
  const seg = strip.children[index * 2], line = strip.children[index * 2 + 1];
  const item = timeline[index];
  const css = item.status === 'FAIL' ? 'tl-fail' : 'tl-pass';
  for (const node of [seg, line]) { node.classList.remove('tl-untested'); node.classList.add(css); }
  line.textContent = item.name + ' — ' + (item.status === 'FAIL' ? 'FELL after ' + item.seconds + 's' : 'RESISTED for ' + item.seconds + 's');
  if (final) seg.title = item.name + ': ' + item.status + (item.outcomeTool ? ' via ' + item.outcomeTool : '');
}

function appendOutcome(outcome) {
  const item = el('article', 'demo-outcome demo-resolved');
  item.append(el('span', outcome.status === 'FAIL' ? 'fail' : '', outcome.status), outcomeName(outcome), el('p', '', outcome.detail), el('p', 'signal', 'ATTACK CLASS: ' + outcome.attackClass), el('p', 'muted', outcome.explain));
  grid.append(item);
}

function appendLedgerLine(index) {
  if (index === 0) ledgerBody.textContent = '';
  const line = el('div', 'line' + (index ? ' demo-fresh' : ''), String(index + 1).padStart(2, '0') + '  ' + events[index].tool + '  ' + JSON.stringify(events[index].args || {}));
  ledgerBody.append(line);
  ledgerBody.scrollTop = ledgerBody.scrollHeight;
}

function headCount(visible) { headPara.textContent = fixture.label + ' · ' + visible + '/' + events.length + ' ledger events shown.'; }

// Full render (initial load, reset, reduced motion, replay end): no animation.
function render(visible) {
  buildSkeleton(); headCount(visible);
  for (const [index, item] of timeline.entries()) {
    if (visible < events.length && item.status !== 'FAIL') continue; // stays pending mid-run
    resolveSegment(index, visible >= events.length);
  }
  const resolved = new Set();
  for (let i = 0; i < visible; i++) {
    timeline.forEach((item, tIndex) => { if (item.status === 'FAIL' && item.outcomeTool === events[i].tool && !resolved.has(item.name)) { resolved.add(item.name); appendOutcome(card.outcomes.find(o => o.name === item.name)); } });
    appendLedgerLine(i);
  }
  if (visible >= events.length) for (const outcome of card.outcomes) if (!resolved.has(outcome.name)) appendOutcome(outcome);
  if (!visible) ledgerBody.append(el('div', 'line muted', 'Press replay to reveal the recorded tool calls.'));
}

function stop() { if (timer) clearInterval(timer); timer = null; play.textContent = '▶ REPLAY SIMULATED RUN →'; }
play.addEventListener('click', () => {
  if (timer) return stop();
  if (reducedMotion) { render(events.length); play.textContent = '▶ REPLAY COMPLETE'; return; }
  let visible = 0;
  buildSkeleton(); headCount(0);
  play.textContent = '❚❚ PAUSE REPLAY';
  timer = setInterval(() => {
    visible++;
    appendLedgerLine(visible - 1); headCount(visible);
    timeline.forEach((item, tIndex) => {
      if (strip.children[tIndex * 2].classList.contains('tl-untested')) {
        if (item.status === 'FAIL' && item.outcomeTool === events[visible - 1].tool) { resolveSegment(tIndex, false); appendOutcome(card.outcomes.find(o => o.name === item.name)); }
        else if (visible >= events.length) { resolveSegment(tIndex, true); if (item.status !== 'FAIL') appendOutcome(card.outcomes.find(o => o.name === item.name)); }
      }
    });
    if (visible >= events.length) stop();
  }, 500);
});
reset.addEventListener('click', () => { stop(); render(0); }); render(0);
// Populate the hero copy with real counts from the trap catalog module so the
// text can never drift from what the engine actually scores.
(() => {
  const resist = document.querySelector('#resistCount'), trip = document.querySelector('#tripCount');
  if (!resist || !trip) return;
  const total = TRAP_DEFS.length;
  const tripped = card.outcomes.filter(o => o.status === 'FAIL').length;
  resist.textContent = String(card.score) + ' of ' + total;
  trip.textContent = String(tripped);
})();
