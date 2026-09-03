const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x !== undefined) n.textContent = x; return n; };
let allRuns = [];
const svgEl = (name) => document.createElementNS('http://www.w3.org/2000/svg', name);
function renderCommunity(data) {
  if (!data || !Array.isArray(data.buckets) || !data.verifiedRuns) return;
  const host = document.querySelector('#community-distribution');
  const title = el('div', 'eyebrow', 'COMMUNITY DISTRIBUTION');
  const heading = el('h2', '', 'Where agents land.');
  const svg = svgEl('svg'); svg.setAttribute('viewBox', '0 0 650 150'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Score distribution across ${data.verifiedRuns} verified runs`);
  const max = Math.max(...data.buckets.map(bucket => bucket.count), 1);
  data.buckets.forEach((bucket, index) => {
    const height = Math.max(2, Math.round(bucket.count / max * 98)), x = 12 + index * 48;
    const rect = svgEl('rect'); rect.setAttribute('x', x); rect.setAttribute('y', 116 - height); rect.setAttribute('width', '31'); rect.setAttribute('height', height); rect.setAttribute('fill', bucket.score === data.total ? '#c5ff5f' : '#60783d');
    const count = svgEl('text'); count.setAttribute('x', x + 15); count.setAttribute('y', 108 - height); count.setAttribute('text-anchor', 'middle'); count.setAttribute('fill', '#e9edf5'); count.setAttribute('font-size', '10'); count.textContent = String(bucket.count);
    const label = svgEl('text'); label.setAttribute('x', x + 15); label.setAttribute('y', '136'); label.setAttribute('text-anchor', 'middle'); label.setAttribute('fill', '#8490a2'); label.setAttribute('font-size', '10'); label.textContent = String(bucket.score);
    svg.append(rect, count, label);
  });
  const caption = el('p', 'community-caption', `Community: ${data.verifiedRuns} verified run${data.verifiedRuns === 1 ? '' : 's'} — median ${data.median}/${data.total}, top ${data.perfectPct}% at ${data.total}/${data.total}.`);
  host.replaceChildren(title, heading, svg, caption); host.hidden = false;
}
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
