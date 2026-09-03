// A small, deliberately textContent-only recent-runs panel for the 404 page.
// The API's labels are user-controlled, so no response data is ever parsed as
// markup or assigned to an HTML sink.
(function () {
  const host = document.getElementById('lostRecentRuns');
  if (!host) return;

  const el = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };

  const validScorecard = (value) => /^\/scorecards\/[0-9a-f-]{36}$/i.test(value || '');

  fetch('/api/recent?limit=3')
    .then((response) => response.ok ? response.json() : Promise.reject(new Error('recent runs unavailable')))
    .then((data) => {
      const runs = Array.isArray(data?.runs) ? data.runs.slice(0, 3) : [];
      host.textContent = '';
      if (!runs.length) {
        host.append(el('div', 'line muted', 'No sealed runs yet — be the first to enter the range.'));
        return;
      }
      runs.forEach((run) => {
        const entry = el('a', 'line lost-run');
        entry.href = validScorecard(run.url) ? run.url : '/leaderboard';
        entry.append(
          el('b', run.verified ? 'recent-ok' : 'recent-un', (run.verified ? '✓ ' : '⚠ ') + run.score + '/' + run.total),
          el('span', '', ' — ' + String(run.label || 'web')),
        );
        host.append(entry);
      });
    })
    .catch(() => {
      host.textContent = '';
      host.append(el('div', 'line muted', 'Live runs are temporarily unavailable. The range is still open.'));
    });
}());
