import { verifyRun, buildResistanceTimeline } from '../_evidence.js';
import { csvResponse } from '../_csv.js';
import { fingerprint } from './digest.js';

// Long-format research export mirroring /api/digest, with median resistance
// duration so researchers can compare both susceptibility and latency.
export async function onRequestGet({ env }) {
  const result = await env.GAUNTLET_DB.prepare('SELECT id, scorecard_json, user_agent, created_at, sig FROM runs WHERE scorecard_json IS NOT NULL ORDER BY created_at ASC').all();
  const groups = new Map();
  for (const row of result.results || []) {
    let card; try { card = JSON.parse(row.scorecard_json); } catch { continue; }
    if (!card || card.tested === false) continue;
    const eventRows = await env.GAUNTLET_DB.prepare('SELECT tool_name, args_json, created_at FROM events WHERE run_id = ? ORDER BY id').bind(row.id).all();
    const events = (eventRows.results || []).map(e => ({ tool: e.tool_name, args: parseArgs(e.args_json), createdAt: e.created_at }));
    const key = fingerprint(row.user_agent), g = groups.get(key) || { runs: 0, verified: 0, scores: [], lastRun: null, traps: new Map() };
    g.runs++; g.scores.push(card.total > 0 ? card.score / card.total : 0); g.lastRun = row.created_at;
    if ((await verifyRun(events, card, row.sig)).verified) g.verified++;
    for (const trap of buildResistanceTimeline(events, card.outcomes)) {
      const t = g.traps.get(trap.name) || { pass: 0, fail: 0, notTested: 0, durations: [] };
      if (trap.status === 'PASS') t.pass++; else if (trap.status === 'FAIL') t.fail++; else t.notTested++;
      if (trap.status !== 'NOT TESTED') t.durations.push(trap.seconds); g.traps.set(trap.name, t);
    }
    groups.set(key, g);
  }
  const rows = [['fingerprint', 'runs', 'verified_runs', 'mean_score_pct', 'last_run', 'trap', 'pass_count', 'fall_count', 'not_tested_count', 'fall_rate_pct', 'median_duration_seconds']];
  for (const [fp, g] of groups) for (const [trap, t] of g.traps) rows.push([fp, g.runs, g.verified, Math.round(g.scores.reduce((a, b) => a + b, 0) / g.scores.length * 100), g.lastRun, trap, t.pass, t.fail, t.notTested, t.pass + t.fail ? Math.round(t.fail / (t.pass + t.fail) * 100) : null, median(t.durations)]);
  return csvResponse('gauntlet-digest.csv', rows);
}

function parseArgs(json) { try { return JSON.parse(json); } catch { return {}; } }
function median(values) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; }
