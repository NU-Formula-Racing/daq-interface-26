import type pg from 'pg';

export interface SignalDefinition {
  id: number;
  source: string;
  signal_name: string;
  unit: string | null;
  description: string | null;
}

export interface WindowRow {
  ts: string;
  value: number;
}

export async function listSignalDefinitions(
  pool: pg.Pool
): Promise<SignalDefinition[]> {
  const { rows } = await pool.query<SignalDefinition>(
    `SELECT id, source, signal_name, unit, description
     FROM signal_definitions
     ORDER BY source, signal_name`
  );
  return rows;
}

export async function getSignalWindow(
  pool: pg.Pool,
  sessionId: string,
  signalId: number,
  start: string,
  end: string
): Promise<WindowRow[]> {
  const { rows } = await pool.query<{ ts: Date; value: string }>(
    `SELECT ts, value FROM get_signal_window($1, $2::smallint, $3::timestamptz, $4::timestamptz)`,
    [sessionId, signalId, start, end]
  );
  return rows.map((r) => ({ ts: r.ts.toISOString(), value: Number(r.value) }));
}

export interface SignalWindowRow {
  ts: string;          // ISO
  signal_id: number;
  signal_name: string;
  unit: string | null;
  value_min: number;
  value_max: number;
  value_avg: number;
  sample_n: number;
}

export async function getSessionSignalIds(
  pool: pg.Pool,
  sessionId: string
): Promise<number[]> {
  const { rows } = await pool.query<{ signal_id: number }>(
    `SELECT signal_id FROM get_session_signal_ids($1)`,
    [sessionId]
  );
  return rows.map((r) => r.signal_id);
}

/** Ensure the 1-second rollup is populated for this session. No-op if it
 *  already has rows. Used for sessions imported before v0.7.4 (the rollup
 *  is built at import time for new ones). Slow on the first call for a
 *  large legacy session; subsequent opens hit the rollup directly.
 *  ANALYZE is run after populate so the planner has up-to-date stats —
 *  without it PG defaults to a seq scan that defeats the whole point. */
async function ensureRollup(pool: pg.Pool, sessionId: string): Promise<void> {
  const { rows } = await pool.query<{ has: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM sd_rollup_1s WHERE session_id = $1 LIMIT 1
     ) AS has`,
    [sessionId],
  );
  if (rows[0]?.has) return;
  const t = performance.now();
  const { rows: built } = await pool.query<{ populate_sd_rollup: number }>(
    `SELECT populate_sd_rollup($1)`,
    [sessionId],
  );
  await pool.query('ANALYZE sd_rollup_1s');
  console.log(
    `[signals-window] lazy-backfill session=${sessionId.slice(0, 8)} ` +
    `rollup_rows=${built[0]?.populate_sd_rollup ?? 0} ` +
    `took=${(performance.now() - t).toFixed(0)}ms`,
  );
}

/** EXPLAIN ANALYZE for the same call shape as getSignalsWindow. Returns
 *  the plan as joined text for the diagnostic /explain route. */
export async function explainSignalsWindow(
  pool: pg.Pool,
  sessionId: string,
  signalIds: number[],
  start: string,
  end: string,
  bucketSecs: number,
): Promise<string> {
  await ensureRollup(pool, sessionId);
  const { rows } = await pool.query<{ 'QUERY PLAN': string }>(
    `EXPLAIN (ANALYZE, BUFFERS)
     SELECT * FROM get_signals_window($1, $2::integer[], $3::timestamptz, $4::timestamptz, $5::double precision)`,
    [sessionId, signalIds, start, end, bucketSecs],
  );
  return rows.map((r) => r['QUERY PLAN']).join('\n');
}

export async function getSignalsWindow(
  pool: pg.Pool,
  sessionId: string,
  signalIds: number[],
  start: string,
  end: string,
  bucketSecs: number
): Promise<SignalWindowRow[]> {
  if (signalIds.length === 0) return [];
  // Only the rollup path benefits from backfill. Sub-second buckets hit
  // raw sd_readings anyway, so don't pay the existence check for them.
  if (bucketSecs >= 1.0) await ensureRollup(pool, sessionId);
  const tQuery = performance.now();
  const { rows } = await pool.query<{
    ts: Date;
    signal_id: number;
    signal_name: string;
    unit: string | null;
    value_min: string;
    value_max: string;
    value_avg: string;
    sample_n: number;
  }>(
    `SELECT ts, signal_id, signal_name, unit, value_min, value_max, value_avg, sample_n
     FROM get_signals_window($1, $2::integer[], $3::timestamptz, $4::timestamptz, $5::double precision)`,
    [sessionId, signalIds, start, end, bucketSecs]
  );
  const queryMs = performance.now() - tQuery;
  const tMap = performance.now();
  const out = rows.map((r) => ({
    ts: r.ts.toISOString(),
    signal_id: r.signal_id,
    signal_name: r.signal_name,
    unit: r.unit,
    value_min: Number(r.value_min),
    value_max: Number(r.value_max),
    value_avg: Number(r.value_avg),
    sample_n: r.sample_n,
  }));
  const mapMs = performance.now() - tMap;
  // Timing breakdown for replay-open performance investigation. `query` is
  // the embedded-PG round trip (dominated by random I/O on slow disks);
  // `map` is the Node-side row materialization. Logged at info so it shows
  // up in the desktop console without flipping a debug flag.
  console.log(
    `[signals-window] session=${sessionId.slice(0, 8)} ids=${signalIds.length} ` +
    `bucket=${bucketSecs.toFixed(3)}s rows=${rows.length} ` +
    `query=${queryMs.toFixed(0)}ms map=${mapMs.toFixed(0)}ms`,
  );
  return out;
}
