import { DuckDB } from './duckdb.ts';

export async function importParquetIntoSession(opts: {
  sessionId: string;
  parquetPath: string;
  pgConnStr: string;
}): Promise<{ rowCount: number }> {
  const d = new DuckDB();
  try {
    // Switch Postgres attach to read-write for this op.
    await d.run(`INSTALL postgres`);
    await d.run(`LOAD postgres`);
    await d.run(
      `ATTACH '${opts.pgConnStr.replace(/'/g, "''")}' AS pg (TYPE POSTGRES)`,
    );
    const esc = opts.parquetPath.replace(/'/g, "''");
    const escSid = opts.sessionId.replace(/'/g, "''");
    const rc = await d.all<{ n: bigint }>(
      `SELECT COUNT(*)::BIGINT AS n FROM read_parquet('${esc}')`,
    );
    await d.run(
      `INSERT INTO pg.sd_readings (ts, session_id, signal_id, value)
       SELECT timestamp, '${escSid}'::UUID, signal_id, value FROM read_parquet('${esc}')`,
    );
    return { rowCount: Number(rc[0].n) };
  } finally {
    await d.close();
  }
}
