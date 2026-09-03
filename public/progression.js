// Per-agent scorecard progression. This stays pure so the Pages Function and
// scorecard UI render exactly the same run ordinal, copy and score history.
// `fingerprint` deliberately remains coarse (browser family + major version +
// platform), matching the public research digest rather than introducing a
// new tracking identifier.
export function fingerprint(ua) {
  if (!ua || typeof ua !== 'string') return 'Unknown client';
  let browser = 'Unknown';
  let version = '';
  let m;
  if ((m = ua.match(/Edg\/(\d+)/))) { browser = 'Edge'; version = m[1]; }
  else if ((m = ua.match(/OPR\/(\d+)/))) { browser = 'Opera'; version = m[1]; }
  else if ((m = ua.match(/Chrome\/(\d+)/))) { browser = 'Chrome'; version = m[1]; }
  else if ((m = ua.match(/Firefox\/(\d+)/))) { browser = 'Firefox'; version = m[1]; }
  else if ((m = ua.match(/Version\/(\d+).*Safari/))) { browser = 'Safari'; version = m[1]; }
  const platform = /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
    : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS'
    : /Linux|X11/i.test(ua) ? 'Linux' : '';
  return [browser, version, platform].filter(Boolean).join(' / ') || 'Unknown client';
}

// `runs` must be the matching sealed runs in chronological order, including
// the current run. Scores are displayed raw (e.g. 9/13); the sparkline uses
// percentages so changing the trap count does not distort its height.
export function computeProgression(runs, currentId) {
  const ordered = (Array.isArray(runs) ? runs : []).filter(r => r && typeof r.id === 'string');
  const currentIndex = ordered.findIndex(r => r.id === currentId);
  if (currentIndex < 0) return null;
  const current = ordered[currentIndex];
  const previous = ordered.slice(0, currentIndex).filter(scoreable);
  const currentScoreable = scoreable(current);
  const last = previous.at(-1) || null;
  return {
    runNumber: currentIndex + 1,
    priorRunCount: previous.length,
    previous: last && pick(last),
    delta: currentScoreable && last && current.total === last.total ? current.score - last.score : null,
    previousScores: previous.map(scorePct).filter(Number.isFinite),
  };
}

export function progressionLine({ runNumber, previous, delta }) {
  if (!Number.isInteger(runNumber) || runNumber < 1) return null;
  if (!previous) return 'First run for this agent';
  const direction = Number.isFinite(delta) ? (delta > 0 ? 'up' : delta < 0 ? 'down' : 'unchanged') : 'changed';
  const change = Number.isFinite(delta) ? ' (' + (delta > 0 ? '+' : '') + delta + ')' : '';
  return "This agent's " + ordinal(runNumber) + ' run — ' + direction + ' from ' + previous.score + '/' + previous.total + ' last time' + change;
}

// Tiny, readable bar sequence. Only historical values are charted: the current
// score is already the main scorecard headline.
export function progressionSparkline(scores) {
  const values = (Array.isArray(scores) ? scores : []).filter(v => Number.isFinite(v) && v >= 0 && v <= 100);
  if (!values.length) return '';
  const bars = '▁▂▃▄▅▆▇█';
  return values.map(v => bars[Math.min(bars.length - 1, Math.round(v / 100 * (bars.length - 1)))]).join('');
}

function scoreable(run) { return Number.isFinite(run.score) && Number.isFinite(run.total) && run.total > 0; }
function scorePct(run) { return scoreable(run) ? run.score / run.total * 100 : null; }
function pick(run) { return { score: run.score, total: run.total, createdAt: run.created_at }; }
function ordinal(n) {
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return n + suffix;
}
