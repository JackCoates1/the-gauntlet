const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x !== undefined) n.textContent = x; return n; };
let allRuns = [];
function render(showAll) {
  const runs = showAll ? allRuns : allRuns.filter(r => r.verified);
  const board = document.querySelector('#board');
  board.textContent = '';
  if (!runs.length) { board.append(el('div', 'line muted', showAll ? 'No sealed runs yet — be the first: enter the range from the homepage.' : 'No verified runs yet — uncheck the filter to see all sealed runs.')); return; }
  for (const run of runs) {
    const line = el('div', 'line');
    const ts = el('span', 'muted', new Date(run.createdAt).toISOString().replace('T', ' ').slice(0, 16) + ' ');
    const score = el('b', run.pct !== null && run.pct < 100 ? 'fail' : '', `${run.score}/${run.total}`);
    line.append(ts, score, el('span', '', ` ${run.browser}${run.label ? ' — ' + run.label : ''} `));
    const chip = el('span', run.verified ? 'pill' : 'muted', run.verified ? '✓ Signature verified' : '⚠ Unverified');
    chip.title = run.verified ? 'Event hash chain re-derived server-side and seal-time Ed25519 signature checked.' : 'No valid seal-time signature on record.';
    line.append(chip, el('span', '', ' '));
    const a = el('a', '', 'scorecard →'); a.href = run.url; line.append(a);
    board.append(line);
  }
}
try {
  const data = await fetch('/api/leaderboard?limit=50&verified=0').then(r => { if (!r.ok) throw new Error('leaderboard unavailable'); return r.json(); });
  allRuns = data.runs;
  const stats = await fetch('/api/trapstats').then(r => r.ok ? r.json() : null).catch(() => null);
  const average = stats?.community;
  document.querySelector('#generated').textContent = `Updated ${new Date(data.generatedAt).toLocaleString()} — ${data.verifiedCount}/${data.totalSealed} runs verified${average?.sealedRuns ? ` · community average: ${average.averageResisted}/${average.possibleTraps} traps resisted` : ''}`;
  const toggle = document.querySelector('#showAll');
  toggle.addEventListener('change', () => { render(toggle.checked); document.querySelector('#runCount').textContent = `${(toggle.checked ? data.totalSealed : data.verifiedCount)} RUN${(toggle.checked ? data.totalSealed : data.verifiedCount) === 1 ? '' : 'S'}`; });
  document.querySelector('#runCount').textContent = `${data.verifiedCount} VERIFIED RUN${data.verifiedCount === 1 ? '' : 'S'}`;
  render(false);
} catch (e) {
  const board = document.querySelector('#board');
  board.textContent = '';
  board.append(el('div', 'line muted', e.message || 'Leaderboard unavailable.'));
}
