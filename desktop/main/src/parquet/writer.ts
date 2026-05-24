import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DuckDB, attachPostgres } from './duckdb.ts';

export interface WrittenFile {
  source: string;
  localPath: string;
  bytes: number;
  rowCount: number;
  sha256: string;
}

export async function writeSessionParquet(opts: {
  sessionId: string;
  outDir: string;
  pgConnStr: string;
}): Promise<WrittenFile[]> {
  const d = new DuckDB();
  try {
    await attachPostgres(d, opts.pgConnStr);

    // Escape the UUID for inline SQL (UUIDs are hex+dashes, safe to inline)
    const escSid = opts.sessionId.replace(/'/g, "''");

    const sources = await d.all<{ source: string }>(
      `SELECT DISTINCT sd.source
       FROM pg.sd_readings r
       JOIN pg.signal_definitions sd ON sd.id = r.signal_id
       WHERE r.session_id = '${escSid}'::UUID
       ORDER BY sd.source`,
    );

    const out: WrittenFile[] = [];
    for (const { source } of sources) {
      const safe = source.replace(/[^A-Za-z0-9_.-]/g, '_');
      const path = join(opts.outDir, `${safe}.parquet`);
      const escPath = path.replace(/'/g, "''");
      const escSource = source.replace(/'/g, "''");

      await d.run(
        `COPY (
           SELECT r.ts AS timestamp, r.signal_id::SMALLINT AS signal_id, r.value
           FROM pg.sd_readings r
           JOIN pg.signal_definitions sd ON sd.id = r.signal_id
           WHERE r.session_id = '${escSid}'::UUID AND sd.source = '${escSource}'
           ORDER BY r.signal_id, r.ts
         ) TO '${escPath}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 1000000)`,
      );

      const rc = await d.all<{ n: bigint }>(
        `SELECT COUNT(*)::BIGINT AS n FROM read_parquet('${escPath}')`,
      );
      const st = await stat(path);
      out.push({
        source,
        localPath: path,
        bytes: st.size,
        rowCount: Number(rc[0].n),
        sha256: await sha256File(path),
      });
    }
    return out;
  } finally {
    await d.close();
  }
}

async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return h.digest('hex');
}
