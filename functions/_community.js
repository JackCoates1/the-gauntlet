// Deterministic score-distribution math, shared by the public API and tests.
export const SCORE_TOTAL = 17;

export function summarizeScores(scores, total = SCORE_TOTAL) {
  const buckets = Array.from({ length: total + 1 }, (_, score) => ({ score, count: 0 }));
  for (const score of scores) if (Number.isInteger(score) && score >= 0 && score <= total) buckets[score].count++;
  const sorted = buckets.flatMap(({ score, count }) => Array(count).fill(score));
  const verifiedRuns = sorted.length;
  const percentile = (fraction) => {
    if (!verifiedRuns) return null;
    const position = (verifiedRuns - 1) * fraction;
    const low = Math.floor(position), high = Math.ceil(position);
    return round(sorted[low] + (sorted[high] - sorted[low]) * (position - low));
  };
  const perfectCount = buckets[total].count;
  return { total, buckets, verifiedRuns, median: percentile(.5), p25: percentile(.25), p75: percentile(.75), perfectCount, perfectPct: verifiedRuns ? Math.round(perfectCount / verifiedRuns * 100) : 0 };
}
function round(value) { return Math.round(value * 10) / 10; }
