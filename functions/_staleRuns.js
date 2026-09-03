// Best-effort hygiene for abandoned client-ledger runs.  A scorecard is the
// durable completion marker: runs without one are safe to remove once they
// have been idle long enough, while sealed evidence remains immutable.
export const STALE_RUN_AGE_MS = 6 * 60 * 60 * 1000;

export async function cleanupStaleRuns(env, now = Date.now(), preserveRunId = '') {
  const cutoff = new Date(now - STALE_RUN_AGE_MS).toISOString();
  // Events have no foreign-key cascade in the D1 schema, so remove children
  // first.  This is deliberately best-effort: a housekeeping failure must
  // never prevent a legitimate scorecard from being sealed.
  try {
    await env.GAUNTLET_DB
      .prepare(`DELETE FROM events WHERE run_id IN (
        SELECT id FROM runs WHERE scorecard_json IS NULL AND created_at < ? AND id != ?
      )`)
      .bind(cutoff, preserveRunId)
      .run();
    await env.GAUNTLET_DB
      .prepare('DELETE FROM runs WHERE scorecard_json IS NULL AND created_at < ? AND id != ?')
      .bind(cutoff, preserveRunId)
      .run();
  } catch {
    // D1 availability is handled by the request's normal write path.
  }
}
