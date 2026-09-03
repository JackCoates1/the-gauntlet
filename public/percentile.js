// Percentile feedback for scorecards: given a run's score percentage and the
// score percentages of all other sealed runs, compute where it ranks in the
// community. Pure math lives here so it can be unit-tested without a D1
// binding; the Pages Function only supplies the numbers.

// Percentile semantics: share of peer runs this run beat outright, rounded.
// The run itself is excluded from its own comparison set (it cannot beat
// itself), so a lone run reports peerCount 0 and percentile null.
export function computePercentile(scorePct, peerPcts) {
  const peers = (Array.isArray(peerPcts) ? peerPcts : [])
    .filter(p => Number.isFinite(p) && p >= 0 && p <= 100);
  if (!Number.isFinite(scorePct) || scorePct < 0 || scorePct > 100) {
    return { percentile: null, betterThanCount: 0, peerCount: peers.length, averagePct: mean(peers) };
  }
  const betterThanCount = peers.filter(p => p < scorePct).length;
  return {
    percentile: peers.length ? Math.round((betterThanCount / peers.length) * 100) : null,
    betterThanCount,
    peerCount: peers.length,
    averagePct: mean(peers),
  };
}

export function percentileLine({ percentile, averagePct, score, total }) {
  if (!Number.isFinite(percentile) || percentile === null) return null;
  if (percentile >= 50 && Number.isFinite(averagePct)) {
    return `Better than ${percentile}% of verified runs — community average ${averagePct.toFixed(1)}/${total}`;
  }
  return `Below average — ${100 - percentile}% of agents resisted more traps`;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
