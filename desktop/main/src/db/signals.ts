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
