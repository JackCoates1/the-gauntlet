import { evaluate, buildResistanceTimeline, trapSlug, TRAP_DEFS } from '/embed/gauntlet-traps/traps.mjs';
const fixture = await fetch('/demo-fixture.json').then(r => { if (!r.ok) throw new Error('Demo fixture unavailable'); return r.json(); });
const events = Array.isArray(fixture.events) ? fixture.events : [];
const card = evaluate(events); const timeline = buildResistanceTimeline(events, card.outcomes);
const el = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value !== undefined) n.textContent = value; return n; };
const root = document.querySelector('#scorecard'), play = document.querySelector('#play'), reset = document.querySelector('#reset'); let timer = null;
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function outcomeName(outcome) { if (outcome.status !== 'FAIL') return el('h3', '', outcome.name); const link = el('a', 'trap-link', outcome.name); link.href = '/traps#trap-' + trapSlug(outcome.name); const h = el('h3'); h.append(link); return h; }
function render(visible) {
  root.textContent = '';
  const head = el('div', 'section-head'), score = el('div'); score.append(el('div', 'eyebrow', 'SIMULATED SCORECARD / REAL ENGINE OUTPUT'), el('h2', '', String(card.score) + '/' + card.total + ' RESISTED')); head.append(score, el('p', '', fixture.label + ' · ' + visible + '/' + events.length + ' ledger events shown.')); root.append(head);
  const strip = el('div', 'tl-strip'), maxSeconds = Math.max(1, ...timeline.map(x => x.seconds));
  for (const item of timeline) { const css = item.status === 'FAIL' ? 'tl-fail' : item.status === 'PASS' ? 'tl-pass' : 'tl-untested'; const segment = el('div', 'tl-seg ' + css); segment.classList.add('tl-grow-' + Math.max(1, Math.round(item.seconds / maxSeconds * 20))); segment.title = item.name + ': ' + item.status + (item.outcomeTool ? ' via ' + item.outcomeTool : ''); strip.append(segment, el('div', 'tl-line ' + css, item.name + ' — ' + (item.status === 'FAIL' ? 'FELL after ' + item.seconds + 's' : 'RESISTED for ' + item.seconds + 's'))); }
  root.append(el('div', 'eyebrow tl-head', 'RESISTANCE TIMELINE'), strip);
  const grid = el('div', 'grid'); for (const outcome of card.outcomes) { const item = el('article'); item.append(el('span', outcome.status === 'FAIL' ? 'fail' : '', outcome.status), outcomeName(outcome), el('p', '', outcome.detail), el('p', 'signal', 'ATTACK CLASS: ' + outcome.attackClass), el('p', 'muted', outcome.explain)); grid.append(item); } root.append(grid);
  const replay = el('div', 'console demo-ledger'), bar = el('div', 'console-bar'); bar.append(el('label', '', 'simulated tool ledger / paced replay')); replay.append(bar); const body = el('div', 'console-body'); for (const [i, event] of events.slice(0, visible).entries()) body.append(el('div', 'line', String(i + 1).padStart(2, '0') + '  ' + event.tool + '  ' + JSON.stringify(event.args || {}))); if (!visible) body.append(el('div', 'line muted', 'Press replay to reveal the recorded tool calls.')); replay.append(body); root.append(replay);
}
function stop() { if (timer) clearInterval(timer); timer = null; play.textContent = '▶ REPLAY SIMULATED RUN →'; }
play.addEventListener('click', () => { if (timer) return stop(); if (reducedMotion) { render(events.length); play.textContent = '▶ REPLAY COMPLETE'; return; } let visible = 0; render(visible); play.textContent = '❚❚ PAUSE REPLAY'; timer = setInterval(() => { visible++; render(visible); if (visible >= events.length) stop(); }, 500); });
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
