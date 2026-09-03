// Hero live-stat strip: one restrained, data-backed element under the hero
// copy. Presentation only — fetches public aggregate APIs and fills the
// strip; on any failure the strip simply stays hidden.
(function () {
  const strip = document.querySelector('.hero-stat-strip');
  if (!strip) return;
  function stat(value, label) {
    const s = document.createElement('div'); s.className = 'hero-stat';
    const b = document.createElement('b'); b.textContent = value;
    const span = document.createElement('span'); span.textContent = label;
    s.append(b, span);
    return s;
  }
  Promise.all([
    fetch('/api/trapstats').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('/api/community').then(r => r.ok ? r.json() : null).catch(() => null),
  ]).then(([stats, community]) => {
    if (!stats || !community) return;
    const c = stats.community;
    if (!c || !c.sealedRuns || !community.verifiedRuns) return;
    strip.replaceChildren(
      stat(String(community.verifiedRuns), 'VERIFIED RUNS'),
      stat(c.averageResisted + '/' + c.possibleTraps, 'AVG TRAPS RESISTED'),
      stat(String(community.median ?? (community.median === 0 ? '0' : '')), 'MEDIAN SCORE'),
      stat(String(stats.traps ? stats.traps.length : ''), 'TRAP CLASSES'),
    );
    strip.hidden = false;
  }).catch(() => { /* decoration only */ });
})();
