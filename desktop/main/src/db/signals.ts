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

export async function getSignalsWindow(
  pool: pg.Pool,
  sessionId: string,
  signalIds: number[],
  start: string,
  end: string,
  bucketSecs: number
): Promise<SignalWindowRow[]> {
  if (signalIds.length === 0) return [];
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
