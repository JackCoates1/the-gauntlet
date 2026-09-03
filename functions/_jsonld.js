// JSON-LD (schema.org) structured data, shared by the static pages (homepage
// SoftwareApplication, /traps ItemList) and the /scorecards/:id OG route
// (Event-shaped result). The object is serialised with JSON.stringify, then
// `<`, `>` and `&` are rewritten to \\uXXXX escapes so a hostile value can
// never close the script element early (</script>) or smuggle HTML entities
// into the block — the JSON-side mirror of the OG route's XML escaping.

export function buildJsonLdScript(obj) {
  const json = JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return '<script type="application/ld+json">' + json + '</script>';
}

// Homepage: SoftwareApplication describing the range, with an AggregateRating
// derived server-side from /api/trapstats (community average over sealed runs).
// ratingCount falls back to 0-safe: the rating node is omitted entirely when
// no sealed runs exist yet.
export function buildHomepageJsonLd(community, origin) {
  const o = String(origin || '').replace(/\/+$/, '');
  const sealedRuns = Number(community && community.sealedRuns) || 0;
  const avgResisted = Number(community && community.averageResisted);
  const possible = Number(community && community.possibleTraps) || 16;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'The Gauntlet',
    url: `${o}/`,
    applicationCategory: 'SecurityApplication',
    operatingSystem: 'Web',
    description: 'A public adversarial security range for WebMCP agents: ordinary tools mixed with live prompt-injection, scope-creep and destructive-action traps, scored into signed, replayable evidence scorecards.',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
  if (sealedRuns > 0 && Number.isFinite(avgResisted)) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: avgResisted,
      bestRating: possible,
      worstRating: 0,
      ratingCount: sealedRuns,
    };
  }
  return jsonLd;
}

// Scorecard: an Event-shaped result object for the sealed run, with the rating
// normalised to a 0–10 scale from the same community ledger, so crawlers can
// render "Gauntlet — Security, rating 7.3/10" style rich snippets.
export function buildScorecardJsonLd(card, origin, community) {
  const o = String(origin || '').replace(/\/+$/, '');
  const score = Number(card.score) || 0;
  const total = Number(card.total) || 0;
  const sealedRuns = Number(community && community.sealedRuns) || 0;
  const avgPct = Number(community && community.averageScorePct);
  const url = `${o}/scorecards/${card.id}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: `Gauntlet: ${score}/${total} traps resisted`,
    url,
    sameAs: url,
    datePublished: card.createdAt || undefined,
    description: `WebMCP agent security run on The Gauntlet: resisted ${score} of ${total} prompt-injection traps, with a signed, replayable evidence ledger.`,
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    location: { '@type': 'VirtualLocation', url: `${o}/` },
    organizer: { '@type': 'Organization', name: 'The Gauntlet', url: `${o}/` },
  };
  if (Number.isFinite(avgPct) && sealedRuns > 0) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Math.round(avgPct) / 10,
      bestRating: 10,
      worstRating: 0,
      ratingCount: sealedRuns,
    };
  }
  return jsonLd;
}

// /traps: an ItemList of every trap in the catalog (single source of truth:
// embed/gauntlet-traps/traps.mjs), with each element's description taken from
// the card's explain field. Static by construction — catalog data only.
export function buildTrapsJsonLd(trapDefs, origin) {
  const o = String(origin || '').replace(/\/+$/, '');
  const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'The Gauntlet trap catalog',
    url: `${o}/traps`,
    numberOfItems: trapDefs.length,
    itemListElement: trapDefs.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      url: `${o}/traps#trap-${slug(t.name)}`,
      description: t.explain,
    })),
  };
}
