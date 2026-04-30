import pg from 'pg';
import type { CloudPusher } from './supabase.ts';

// Direct-Postgres CloudPusher. Works against any provider that exposes a
// libpq-compatible connection string: Supabase (db.<project>.supabase.co),
// Hetzner self-hosted, Heroku Postgres, RDS, etc.
//
// Idempotency: relies on the cloud schema having
//   - PRIMARY KEY (id) on sessions
//   - UNIQUE (session_id, ts, signal_id) on sd_readings
// Both conditions are true on our current Supabase project.
export function postgresCloudPusher(connectionString: string): CloudPusher & {
  close: () => Promise<void>;
} {
  const pool = new pg.Pool({
    connectionString,
    max: 4,
    // Supabase pooler / Heroku / Hetzner all support SSL; let pg negotiate.
    ssl: { rejectUnauthorized: false },
  });

  return {
    async pushSession(sessionId, row) {
      const cols = ['id', ...Object.keys(row)];
      const vals = [sessionId, ...Object.values(row)];
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const updates = cols
        .filter((c) => c !== 'id')
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .join(', ');
      const sql =
        `INSERT INTO sessions (${cols.map((c) => `"${c}"`).join(', ')}) ` +
        `VALUES (${placeholders}) ` +
        `ON CONFLICT (id) DO UPDATE SET ${updates}`;
      await pool.query(sql, vals);
    },

    async pushReadings(sessionId, readings) {
      if (readings.length === 0) return;
      // Multi-row INSERT with ON CONFLICT DO NOTHING. Chunk to keep the
      // parameter count under Postgres' 65535 limit (4 params/row → ~16k/chunk).
      const CHUNK = 5000;
      for (let i = 0; i < readings.length; i += CHUNK) {
        const slice = readings.slice(i, i + CHUNK);
        const params: unknown[] = [];
        const tuples = slice.map((r, idx) => {
          const base = idx * 4;
          params.push(sessionId, r.ts, r.signal_id, r.value);
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        });
        const sql =
          `INSERT INTO sd_readings (session_id, ts, signal_id, value) ` +
          `VALUES ${tuples.join(', ')} ` +
          `ON CONFLICT (session_id, ts, signal_id) DO NOTHING`;
        await pool.query(sql, params);
      }
    },

    async close() {
      await pool.end();
    },
  };
}
