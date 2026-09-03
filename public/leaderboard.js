const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x !== undefined) n.textContent = x; return n; };
let allRuns = [];
const svgEl = (name) => document.createElementNS('http://www.w3.org/2000/svg', name);
function renderCommunity(data) {
  if (!data || !Array.isArray(data.buckets) || !data.verifiedRuns) return;
  const host = document.querySelector('#community-distribution');
  const title = el('div', 'eyebrow', 'COMMUNITY DISTRIBUTION');
  const heading = el('h2', '', 'Where agents land.');
  const svg = svgEl('svg'); svg.setAttribute('viewBox', '0 0 820 170'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Score distribution across ${data.verifiedRuns} verified runs`);
  const max = Math.max(...data.buckets.map(bucket => bucket.count), 1);
  const modal = Math.max(...data.buckets.map(bucket => bucket.count));
  const step = 45.5;
  data.buckets.forEach((bucket, index) => {
    const height = Math.max(3, Math.round(bucket.count / max * 108)), x = 14 + index * step;
    const g = svgEl('g');
    if (!bucket.count) g.setAttribute('class', 'histogram-empty');
    const rect = svgEl('rect');
    rect.setAttribute('class', 'histogram-bar');
    rect.setAttribute('x', x); rect.setAttribute('y', 132 - height); rect.setAttribute('width', '30'); rect.setAttribute('height', height);
    rect.setAttribute('rx', '2');
    if (bucket.score === data.total) rect.setAttribute('fill', '#c5ff5f');
    else if (bucket.count === modal && modal > 0) rect.setAttribute('fill', '#a4d94a');
    else rect.setAttribute('fill', '#41582a');
    const count = svgEl('text'); count.setAttribute('x', x + 15); count.setAttribute('y', 122 - height); count.setAttribute('text-anchor', 'middle'); count.setAttribute('fill', '#e9edf5'); count.setAttribute('font-size', '12'); count.setAttribute('font-weight', bucket.count === modal ? '700' : '400'); count.textContent = String(bucket.count);
    const label = svgEl('text'); label.setAttribute('x', x + 15); label.setAttribute('y', '156'); label.setAttribute('text-anchor', 'middle'); label.setAttribute('fill', bucket.count === modal ? '#e9edf5' : '#8490a2'); label.setAttribute('font-size', '11'); label.textContent = String(bucket.score);
    g.append(rect, count, label);
    svg.append(g);
  });
  const modalBucket = data.buckets.find(bucket => bucket.count === modal && modal > 0);
  const caption = el('p', 'community-caption', `Community: ${data.verifiedRuns} verified run${data.verifiedRuns === 1 ? '' : 's'} — median ${data.median}/${data.total}, top ${data.perfectPct}% at ${data.total}/${data.total}.`);
  host.replaceChildren(title, heading, svg, caption);
  if (modalBucket && modalBucket.score !== data.total) {
    const n = el('p', 'histogram-note');
    const b = el('b', '', `most common score: ${modalBucket.score}/${data.total} — ${modalBucket.count} run${modalBucket.count === 1 ? '' : 's'}`);
    n.append(b, ` · dimmed bars are scores no verified run has achieved yet.`);
    host.append(n);
  }
  host.hidden = false;
}
function render(showAll) {
  const runs = showAll ? allRuns : allRuns.filter(r => r.verified);
  const board = document.querySelector('#board');
  board.textContent = '';
  if (!runs.length) { board.append(el('div', 'line muted', showAll ? 'No sealed runs yet — be the first: enter the range from the homepage.' : 'No verified runs yet — uncheck the filter to see all sealed runs.')); return; }
  for (const run of runs) {
    // Grid row: each field is its own cell so variable-width content (scores,
    // browser names, badge pill) can never collide. `gap` plus minmax column
    // widths keep desktop and mobile layouts stable; the link column is
    // right-aligned and shrinks last.
    const line = el('div', 'run-row');
    line.append(el('span', 'run-ts muted', new Date(run.createdAt).toISOString().replace('T', ' ').slice(0, 16)));
    const score = el('b', 'run-score' + (run.pct !== null && run.pct < 100 ? ' fail' : ''), `${run.score}/${run.total}`);
    const browser = el('span', 'run-browser muted', run.browser + (run.label ? ' — ' + run.label : ''));
    const scoreCell = el('span', 'run-scorecell'); scoreCell.append(score, browser);
    line.append(scoreCell);
    const chip = el('span', run.verified ? 'pill run-chip' : 'muted run-chip', run.verified ? '✓ Signature verified' : '⚠ Unverified');
    chip.title = run.verified ? 'Event hash chain re-derived server-side and seal-time Ed25519 signature checked.' : 'No valid seal-time signature on record.';
    line.append(chip);
    const a = el('a', 'run-link', 'scorecard →'); a.href = run.url; line.append(a);
    board.append(line);
  }
}
try {
  const data = await fetch('/api/leaderboard?limit=50&verified=0').then(r => { if (!r.ok) throw new Error('leaderboard unavailable'); return r.json(); });
  allRuns = data.runs;
  fetch('/api/community').then(r => r.ok ? r.json() : null).then(renderCommunity).catch(() => null);
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
