// Browser-only helpers for replaying a signed evidence ledger. Keeping the
// timing/state model separate from the scorecard DOM makes it easy to test
// without trusting or modifying the signed bundle.
import { redactArgs } from '../embed/gauntlet-traps/traps.mjs';
const timestamp = event => {
  const value = Date.parse(event?.timestamp || event?.createdAt || '');
  return Number.isFinite(value) ? value : 0;
};

// The evidence API returns its ledger in insertion order. Timestamp ordering
// makes the presentation robust to equal/out-of-order clock readings while
// retaining that canonical order as a stable tie-breaker.
export function orderReplayEvents(events = []) {
  return events.map((event, index) => ({ ...event, _ledgerIndex: index }))
    .sort((a, b) => timestamp(a) - timestamp(b) || a._ledgerIndex - b._ledgerIndex);
}

export function replaySpanMs(events = []) {
  const ordered = orderReplayEvents(events);
  return ordered.length > 1 ? Math.max(0, timestamp(ordered.at(-1)) - timestamp(ordered[0])) : 0;
}

// Six times real-time means a 60-second run plays in ten seconds. Very short
// ledgers still get enough time for a judge to read each event.
export function replayDurationMs(events = []) {
  return Math.max(1200, replaySpanMs(events) / 6);
}

export function visibleEventCount(events = [], elapsedMs = 0) {
  const ordered = orderReplayEvents(events);
  if (!ordered.length) return 0;
  const until = timestamp(ordered[0]) + Math.max(0, elapsedMs) * 6;
  return ordered.filter(event => timestamp(event) <= until).length;
}

// buildResistanceTimeline gives the sealed outcome and, for a fall, the tool
// that first violated the trap. PASS transitions when the ledger completes;
// FAIL transitions on that violating tool, so every terminal state mirrors the
// server-derived timeline without introducing another API/schema surface.
export function replayTrapTransitions(events = [], timeline = []) {
  const ordered = orderReplayEvents(events);
  return timeline.map(trap => {
    let eventIndex = ordered.length;
    if (trap.status === 'FAIL' && trap.outcomeTool) {
      const found = ordered.findIndex(event => event.tool === trap.outcomeTool);
      if (found >= 0) eventIndex = found + 1;
    }
    return { ...trap, eventIndex };
  });
}

export function replayTrapStates(events = [], timeline = [], eventCount = 0) {
  return replayTrapTransitions(events, timeline).map(trap => ({
    ...trap,
    state: eventCount >= trap.eventIndex
      ? (trap.status === 'PASS' ? 'resisted' : trap.status === 'FAIL' ? 'fell' : 'untested')
      : 'pending',
  }));
}

export function formatReplayArgs(args) {
  try { return JSON.stringify(redactArgs(args ?? {})); }
  catch { return '[unserializable args]'; }
}
