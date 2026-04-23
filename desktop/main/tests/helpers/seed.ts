import type pg from 'pg';

export interface SeededSession {
  sessionId: string;
  signalAId: number;
  signalBId: number;
  baseTs: Date;
}

export async function seedSessionWithReadings(pool: pg.Pool): Promise<SeededSession> {
  const baseTs = new Date('2026-04-22T12:00:00Z');

  const sigA = await pool.query<{ id: number }>(
    `INSERT INTO signal_definitions (source, signal_name, unit)
     VALUES ('PDM', 'bus_v', 'V')
     ON CONFLICT (source, signal_name) DO UPDATE SET unit = EXCLUDED.unit
     RETURNING id`
  );
  const sigB = await pool.query<{ id: number }>(
    `INSERT INTO signal_definitions (source, signal_name, unit)
     VALUES ('BMS_SOE', 'soc', '%')
     ON CONFLICT (source, signal_name) DO UPDATE SET unit = EXCLUDED.unit
     RETURNING id`
  );

  const sess = await pool.query<{ id: string }>(
    `INSERT INTO sessions (date, started_at, ended_at, source, track, driver)
     VALUES ($1::date, $2, $3, 'live', 'Track 1', 'Alice')
     RETURNING id`,
    [baseTs, baseTs, new Date(baseTs.getTime() + 60_000)]
  );

  const sessionId = sess.rows[0].id;
  const sigAId = sigA.rows[0].id;
  const sigBId = sigB.rows[0].id;

  for (let i = 0; i < 60; i++) {
    const ts = new Date(baseTs.getTime() + i * 1000);
    await pool.query(
      `INSERT INTO sd_readings (ts, session_id, signal_id, value)
       VALUES ($1, $2, $3, $4), ($1, $2, $5, $6)`,
      [ts, sessionId, sigAId, i, sigBId, 100 - i]
    );
  }

  return { sessionId, signalAId: sigAId, signalBId: sigBId, baseTs };
}
