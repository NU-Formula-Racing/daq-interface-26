import type { Client } from 'pg';

export interface Fixture {
  sessionId: string;
  signalAId: number;
  signalBId: number;
  baseTs: Date;
}

/**
 * Inserts one session with two signals ("A" and "B") and 60 seconds of
 * data (1 Hz), alternating value patterns so averages are predictable.
 */
export async function seedBasicFixture(client: Client): Promise<Fixture> {
  const sigA = await client.query<{ id: number }>(
    `INSERT INTO signal_definitions (source, signal_name, unit)
     VALUES ('TEST', 'A', 'V')
     RETURNING id`
  );
  const sigB = await client.query<{ id: number }>(
    `INSERT INTO signal_definitions (source, signal_name, unit)
     VALUES ('TEST', 'B', 'A')
     RETURNING id`
  );

  const baseTs = new Date('2026-04-22T12:00:00Z');

  const sess = await client.query<{ id: string }>(
    `INSERT INTO sessions (date, started_at, ended_at, source)
     VALUES ($1::date, $2, $3, 'live')
     RETURNING id`,
    [baseTs, baseTs, new Date(baseTs.getTime() + 60_000)]
  );

  const rows: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (let i = 0; i < 60; i++) {
    const ts = new Date(baseTs.getTime() + i * 1000);
    rows.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(ts, sess.rows[0].id, sigA.rows[0].id, i);
    rows.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(ts, sess.rows[0].id, sigB.rows[0].id, 100 - i);
  }
  await client.query(
    `INSERT INTO sd_readings (ts, session_id, signal_id, value) VALUES ${rows.join(',')}`,
    params
  );

  return {
    sessionId: sess.rows[0].id,
    signalAId: sigA.rows[0].id,
    signalBId: sigB.rows[0].id,
    baseTs,
  };
}
