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

  // JSON-LD structured data: a schema.org SoftwareApplication for the range,
  // with the aggregateRating derived server-side from /api/trapstats (the same
  // community ledger the leaderboard and research pages use). Injected via
  // createElement + textContent — no HTML sinks — so the block is inert DOM
  // built from validated server JSON. Soft-fail: decoration only.
  function injectSoftwareAppJsonLd(community) {
    if (!community || !(community.sealedRuns > 0)) return;
    const avg = Number(community.averageResisted);
    const possible = Number(community.possibleTraps);
    if (!Number.isFinite(avg) || !Number.isFinite(possible)) return;
    const origin = location.origin;
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'The Gauntlet',
      url: origin + '/',
      applicationCategory: 'SecurityApplication',
      operatingSystem: 'Web',
      description: 'A public adversarial security range for WebMCP agents: ordinary tools mixed with live prompt-injection, scope-creep and destructive-action traps, scored into signed, replayable evidence scorecards.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: avg,
        bestRating: possible,
        worstRating: 0,
        ratingCount: community.sealedRuns,
      },
    };
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'gauntlet-jsonld-app';
    script.textContent = JSON.stringify(jsonLd);
    document.head.append(script);
  }

  fetch('/api/trapstats').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
    if (data && data.community) injectSoftwareAppJsonLd(data.community);
  }).catch(function () { /* structured data is additive; ignore failures */ });

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
