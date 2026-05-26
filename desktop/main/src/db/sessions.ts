import type pg from 'pg';

export interface Session {
  id: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  track: string | null;
  driver: string | null;
  car: string | null;
  notes: string | null;
  source: 'live' | 'sd_import';
  source_file: string | null;
  synced_at: string | null;
  content_hash: string | null;
  manifest_key: string | null;
  total_bytes: string | null;          // BIGINT → string via pg default
  uploaded_by_machine: string | null;
  uploaded_at: string | null;
  local_deleted_at: string | null;
}

export interface SessionDetail extends Session {
  signals: Array<{
    signal_id: number;
    source: string;
    signal_name: string;
    unit: string | null;
  }>;
  /** Timestamp of the earliest row in sd_readings for this session.
   *  Authoritative for "when did the actual data start?" — independent
   *  of sessions.started_at, which can drift if the .nfr header was
   *  parsed in the wrong timezone. Null when the session has no rows. */
  data_start_ts: string | null;
}

export async function listSessions(pool: pg.Pool): Promise<Session[]> {
  const { rows } = await pool.query<Session>(
    `SELECT id, date::text, started_at, ended_at, track, driver, car, notes,
            source, source_file, synced_at,
            content_hash, manifest_key, total_bytes::text, uploaded_by_machine,
            uploaded_at, local_deleted_at
     FROM sessions
     ORDER BY started_at DESC`,
  );
  return rows;
}

export async function getSession(
  pool: pg.Pool,
  id: string
): Promise<SessionDetail | null> {
  const { rows } = await pool.query<Session>(
    `SELECT id, date::text, started_at, ended_at, track, driver, car, notes,
            source, source_file, synced_at,
            content_hash, manifest_key, total_bytes::text, uploaded_by_machine,
            uploaded_at, local_deleted_at
     FROM sessions WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) return null;

  const sigs = await pool.query<{
    signal_id: number;
    source: string;
    signal_name: string;
    unit: string | null;
  }>(
    `SELECT signal_id, source, signal_name, unit FROM get_session_signals($1)`,
    [id]
  );

  // Earliest actual reading — the trusted anchor for x-axis labels in the
  // replay widget. Cheap query: covers the (session_id, signal_id, ts)
  // index. Returns null when the session has zero rows.
  //
  // Critical: don't cast to ::text. Postgres' default text representation
  // of timestamptz is "2026-05-25 16:46:24.201-05" — a space instead of T
  // and an offset without minutes. Date.parse mishandles this and shifts
  // by 5 hours on some platforms. Returning the raw Date lets node-postgres
  // produce a JS Date which Fastify serializes as proper ISO 8601 (the
  // same format as started_at).
  const dataStart = await pool.query<{ data_start_ts: Date | null }>(
    `SELECT MIN(ts) AS data_start_ts
     FROM sd_readings WHERE session_id = $1`,
    [id]
  );
  const dataStartIso = dataStart.rows[0]?.data_start_ts ?? null;

  return {
    ...rows[0],
    signals: sigs.rows,
    data_start_ts: dataStartIso ? dataStartIso.toISOString() : null,
  };
}

export type SessionPatch = Partial<
  Pick<Session, 'track' | 'driver' | 'car' | 'notes'>
>;

export async function updateSession(
  pool: pg.Pool,
  id: string,
  patch: SessionPatch
): Promise<void> {
  const fields = (['track', 'driver', 'car', 'notes'] as const).filter(
    (k) => k in patch
  );
  if (fields.length === 0) return;

  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const values = fields.map((f) => patch[f] ?? null);
  await pool.query(
    `UPDATE sessions SET ${sets} WHERE id = $1`,
    [id, ...values]
  );
}

export async function deleteSession(pool: pg.Pool, id: string): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE id = $1`, [id]);
}

