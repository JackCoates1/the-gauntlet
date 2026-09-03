// Homepage "RECENT RUNS" ticker: renders the latest sealed runs as a
// textContent-only strip under the hero. Every entry links to its signed
// /scorecards/:id page. Additive — never blocks or breaks the homepage.
(function () {
  const host = document.getElementById('recentRuns');
  if (!host) return;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function relTime(iso) {
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return 'just now';
    const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function render(data) {
    const runs = Array.isArray(data && data.runs) ? data.runs.slice(0, 8) : [];
    host.textContent = '';
    host.append(el('span', 'recent-label', 'RECENT RUNS'));
    if (!runs.length) {
      host.append(el('span', 'recent-entry', 'No sealed runs yet — be the first.'));
      return;
    }
    runs.forEach(function (run, i) {
      if (i > 0) host.append(el('span', 'recent-sep', ' · '));
      const link = el('a', 'recent-entry');
      link.href = typeof run.url === 'string' && /^\/scorecards\/[0-9a-f-]{36}$/i.test(run.url)
        ? run.url
        : '/leaderboard';
      const mark = run.verified ? '✓ ' : '⚠ ';
      link.append(el('span', run.verified ? 'recent-ok' : 'recent-un', mark + run.score + '/' + run.total));
      link.append(el('span', 'recent-who', ' — ' + String(run.label || 'web') + ' — ' + relTime(run.sealedAt)));
      host.append(link);
    });
  }

  fetch('/api/recent?limit=8')
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
    .then(render)
    .catch(function () {
      host.textContent = '';
      host.append(el('span', 'recent-label', 'RECENT RUNS'));
      host.append(el('span', 'recent-entry', 'Live feed unavailable.'));
    });
})();
