// Periodic cleanup of pre-today rows from live_today. The embedded
// Postgres has no pg_cron, so we drive this from the desktop server:
// once on boot and on a setInterval thereafter. The DELETE is cheap —
// the (signal_id, ts) index covers it and almost every row is "today",
// so the predicate matches very few rows in steady state.
import type pg from 'pg';

/** SQL that wipes rows whose `ts` falls before today's Chicago midnight.
 *  Exported separately so it can be unit-tested without a live DB. */
export function buildLiveTodayCleanupSql(): string {
  return `DELETE FROM live_today WHERE ts < (now() AT TIME ZONE 'America/Chicago')::date AT TIME ZONE 'America/Chicago'`;
}

/** Run the cleanup once. Returns the row count deleted. */
export async function runLiveTodayCleanup(pool: pg.Pool): Promise<number> {
  const { rowCount } = await pool.query(buildLiveTodayCleanupSql());
  return rowCount ?? 0;
}

/** Start a recurring cleanup. Fires once immediately then every
 *  intervalMs. Returns a stop function. */
export function startLiveTodayCleanupTimer(
  pool: pg.Pool,
  intervalMs: number = 15 * 60 * 1000,
): () => void {
  const fire = async () => {
    try {
      const n = await runLiveTodayCleanup(pool);
      if (n > 0) console.log(`live_today cleanup deleted ${n} stale rows`);
    } catch (err) {
      console.error('live_today cleanup failed:', (err as Error).message);
    }
  };
  void fire();
  const iv = setInterval(() => { void fire(); }, intervalMs);
  return () => clearInterval(iv);
}
