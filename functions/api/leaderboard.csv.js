import { verifyRun, buildResistanceTimeline } from '../_evidence.js';
import { redactArgs } from '../../embed/gauntlet-traps/traps.mjs';
import { csvResponse } from '../_csv.js';

const MAX_LIMIT = 50;

// Spreadsheet-friendly, one-row-per-run-and-trap export of the same sealed
// ledger data used by /api/leaderboard. Long format keeps it plot-ready.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  let limit = parseInt(url.searchParams.get('limit') || '20', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  const verifiedOnly = url.searchParams.get('verified') !== '0';
  const result = await env.GAUNTLET_DB.prepare(`SELECT id, created_at, score, total, agent_label, user_agent, scorecard_json, sig
    FROM runs WHERE scorecard_json IS NOT NULL ORDER BY created_at DESC LIMIT ?`).bind(limit).all();
  const runs = [];
  for (const row of result.results || []) {
    let card; try { card = JSON.parse(row.scorecard_json); } catch { continue; }
    const eventRows = await env.GAUNTLET_DB.prepare('SELECT tool_name, args_json, created_at FROM events WHERE run_id = ? ORDER BY id').bind(row.id).all();
    const events = (eventRows.results || []).map(e => ({ tool: e.tool_name, args: parseArgs(e.args_json), createdAt: e.created_at }));
    const verified = (await verifyRun(events, card, row.sig)).verified;
    // CSV intentionally exports aggregate timeline columns only. Keep a
    // redacted presentation copy here so any future argument-derived column
    // cannot accidentally serialize raw ledger values.
    const presentationEvents = events.map(event => ({ ...event, args: redactArgs(event.args) }));
    if (!verifiedOnly || verified) runs.push({ row, verified, timeline: buildResistanceTimeline(events, card.outcomes), presentationEvents });
  }
  const exposure = new Map();
  for (const run of runs) for (const trap of run.timeline) if (trap.status !== 'NOT TESTED') {
    const x = exposure.get(trap.name) || { fell: 0, total: 0 }; x.total++; if (trap.status === 'FAIL') x.fell++; exposure.set(trap.name, x);
  }
  const rows = [['run_id', 'created_at', 'verified', 'score', 'total', 'score_pct', 'agent_label', 'browser', 'trap', 'attack_class', 'status', 'duration_seconds', 'trap_fall_rate_pct']];
  for (const { row, verified, timeline } of runs) for (const trap of timeline) {
    const stat = exposure.get(trap.name);
    rows.push([row.id, row.created_at, verified, row.score, row.total, row.total > 0 ? Math.round(row.score / row.total * 100) : null, row.agent_label, browserFamily(row.user_agent), trap.name, trap.attackClass, trap.status, trap.seconds, stat ? Math.round(stat.fell / stat.total * 100) : null]);
  }
  return csvResponse('gauntlet-leaderboard.csv', rows);
}

function parseArgs(json) { try { return JSON.parse(json); } catch { return {}; } }
function browserFamily(ua) { if (!ua || typeof ua !== 'string') return 'Unknown'; if (/edg\//i.test(ua)) return 'Edge'; if (/opr\/|opera/i.test(ua)) return 'Opera'; if (/chrome\//i.test(ua)) return 'Chrome'; if (/firefox/i.test(ua)) return 'Firefox'; if (/safari/i.test(ua)) return 'Safari'; return 'Other'; }
