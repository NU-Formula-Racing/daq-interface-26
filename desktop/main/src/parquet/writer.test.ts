import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSessionParquet } from './writer.ts';
import { DuckDB } from './duckdb.ts';

const PG = process.env.PG_TEST_URL!;
const pool = new Pool({ connectionString: PG });
const SESSION = '11111111-1111-1111-1111-111111111111';

beforeAll(async () => {
  await pool.query(`INSERT INTO signal_definitions (id, source, signal_name) VALUES
    (1001, 'PDM', 'Volt'), (1002, 'BMS_SOE', 'Temp')
    ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO sessions (id, date, started_at, source) VALUES
    ($1, '2026-05-24', '2026-05-24T00:00:00Z', 'live')
    ON CONFLICT (id) DO NOTHING`, [SESSION]);
  await pool.query(`INSERT INTO sd_readings (ts, session_id, signal_id, value) VALUES
    ('2026-05-24T00:00:01Z', $1, 1001, 12.3),
    ('2026-05-24T00:00:02Z', $1, 1001, 12.4),
    ('2026-05-24T00:00:01Z', $1, 1002, 25.0)`, [SESSION]);
});

afterAll(async () => {
  await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [SESSION]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [SESSION]);
  await pool.end();
});

describe('writeSessionParquet', () => {
  it('produces one parquet per source with correct rowCounts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pq-'));
    try {
      const files = await writeSessionParquet({
        sessionId: SESSION,
        outDir: dir,
        pgConnStr: PG,
      });
      expect(files.map((f) => f.source).sort()).toEqual(['BMS_SOE', 'PDM']);
      const pdm = files.find((f) => f.source === 'PDM')!;
      expect(pdm.rowCount).toBe(2);
      const bms = files.find((f) => f.source === 'BMS_SOE')!;
      expect(bms.rowCount).toBe(1);
      const st = await stat(pdm.localPath);
      expect(st.size).toBeGreaterThan(0);

      // Round-trip via DuckDB to confirm the bytes are valid Parquet.
      const d = new DuckDB();
      const rows = await d.all<{ n: bigint }>(
        `SELECT COUNT(*)::BIGINT AS n FROM read_parquet('${pdm.localPath.replace(/'/g, "''")}')`,
      );
      expect(Number(rows[0].n)).toBe(2);
      await d.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
