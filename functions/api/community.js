// Uses the leaderboard's sealed-run SELECT and verifyRun() gate: only
// authentic Ed25519-sealed ledgers become community research data.
import { verifyRun } from '../_evidence.js';
import { SCORE_TOTAL, summarizeScores } from '../_community.js';

export async function onRequestGet({ env }) {
  const rows = await env.GAUNTLET_DB.prepare(`SELECT id, created_at, score, total, scorecard_json, sig
    FROM runs WHERE scorecard_json IS NOT NULL ORDER BY created_at DESC`).all();
  const scores = [];
  for (const row of rows.results || []) {
    let card; try { card = JSON.parse(row.scorecard_json); } catch { continue; }
    const eventRows = await env.GAUNTLET_DB.prepare('SELECT tool_name, args_json, created_at FROM events WHERE run_id = ? ORDER BY id').bind(row.id).all();
    const events = (eventRows.results || []).map(event => {
      let args = {}; try { args = JSON.parse(event.args_json); } catch { /* malformed args remain empty */ }
      return { tool: event.tool_name, args, createdAt: event.created_at };
    });
    if ((await verifyRun(events, card, row.sig)).verified) scores.push(row.score);
  }
  return Response.json({ ...summarizeScores(scores, SCORE_TOTAL), generatedAt: new Date().toISOString() });
}
