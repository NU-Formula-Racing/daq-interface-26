/**
 * One-shot: upload `sessions/<id>/signal_map.json` for every session that
 * already lives on DO Spaces but is missing the sidecar that the website's
 * signals-window edge function now expects.
 *
 * Pulls each session's distinct (local_id, source, name) from the local
 * `sd_readings` + `signal_definitions`. Same shape as what upload.ts now
 * writes alongside fresh uploads.
 *
 * Usage (from desktop/):
 *   tsx main/scripts/backfill-signal-maps.ts                 # all uploaded sessions
 *   tsx main/scripts/backfill-signal-maps.ts <session-id>    # one session
 *
 * Reads creds from the local desktop app_config (same path the upload UI uses).
 */
import pg from 'pg';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const EMBEDDED_PG = {
  host: 'localhost', port: 5499, user: 'nfr', database: 'postgres',
};

async function main() {
  const pool = new pg.Pool(EMBEDDED_PG);
  const { rows: cfgRows } = await pool.query<{ data: any }>(
    `SELECT data FROM app_config WHERE id = 1`,
  );
  const cfg = cfgRows[0]?.data ?? {};
  if (!cfg.spacesBucket || !cfg.spacesEndpoint || !cfg.spacesAccessKey || !cfg.spacesSecretKey) {
    throw new Error('Spaces creds not configured in app_config');
  }

  const s3 = new S3Client({
    endpoint: cfg.spacesEndpoint,
    region: cfg.spacesRegion ?? 'sfo3',
    credentials: {
      accessKeyId: cfg.spacesAccessKey,
      secretAccessKey: cfg.spacesSecretKey,
    },
    forcePathStyle: false,
  });

  const onlySid = process.argv[2];
  const { rows: sessions } = onlySid
    ? await pool.query<{ id: string }>(
        `SELECT id FROM sessions WHERE id = $1 AND manifest_key IS NOT NULL`,
        [onlySid],
      )
    : await pool.query<{ id: string }>(
        `SELECT id FROM sessions WHERE manifest_key IS NOT NULL ORDER BY started_at`,
      );

  if (sessions.length === 0) {
    console.log('no uploaded sessions to backfill');
    await pool.end();
    return;
  }
  console.log(`backfilling ${sessions.length} session(s)…`);

  let written = 0, skipped = 0, missing = 0;
  for (const { id } of sessions) {
    const key = `sessions/${id}/signal_map.json`;
    // Skip if it already exists, so reruns are idempotent.
    try {
      await s3.send(new HeadObjectCommand({ Bucket: cfg.spacesBucket, Key: key }));
      skipped++;
      continue;
    } catch (_err) { /* not found → proceed */ }

    const { rows: defs } = await pool.query<{
      local_id: number; source: string; name: string;
    }>(
      `SELECT DISTINCT sd.id AS local_id, sd.source, sd.signal_name AS name
       FROM sd_readings r
       JOIN signal_definitions sd ON sd.id = r.signal_id
       WHERE r.session_id = $1
       ORDER BY sd.source, sd.signal_name`,
      [id],
    );
    if (defs.length === 0) {
      console.warn(`  ${id}: no local readings — can't reconstruct map, skipping`);
      missing++;
      continue;
    }
    const body = JSON.stringify({
      session_id: id,
      signals: defs.map((d) => ({ local_id: d.local_id, source: d.source, name: d.name })),
    });
    await s3.send(new PutObjectCommand({
      Bucket: cfg.spacesBucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      ACL: 'public-read',
    }));
    console.log(`  ${id}: wrote ${defs.length} signal(s)`);
    written++;
  }

  console.log(`done · wrote ${written} · already-present ${skipped} · no-local-data ${missing}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
