import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { spawn } from 'child_process';

interface DbAdminDeps {
  pool: pg.Pool;
  /** Connection string used for pg_dump / psql invocations. */
  dsn: string;
}

export function registerDbAdminRoutes(app: FastifyInstance, deps: DbAdminDeps) {
  /**
   * POST /api/db/clear
   * Body (JSON, optional): { olderThan?: ISO date string }
   * Deletes sessions (cascade removes their readings). If olderThan is set,
   * only sessions whose `started_at` < olderThan are removed. Returns counts.
   */
  app.post<{ Body?: { olderThan?: string } }>('/api/db/clear', async (req, reply) => {
    const olderThan = req.body?.olderThan;
    const params: any[] = [];
    let where = '';
    if (olderThan) {
      where = 'WHERE started_at < $1::timestamptz';
      params.push(olderThan);
    }
    const before = await deps.pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM sessions ${where}`,
      params,
    );
    const sessionCount = Number(before.rows[0].c);
    if (sessionCount === 0) {
      return { sessions_deleted: 0 };
    }
    await deps.pool.query(`DELETE FROM sessions ${where}`, params);
    // rt_readings has FK with CASCADE, sd_readings same. signal_definitions stays.
    return { sessions_deleted: sessionCount };
  });

  /**
   * GET /api/db/export
   * Streams a data-only pg_dump as `application/sql`. The user saves this file
   * and re-imports it on another machine that has the same schema migrations.
   */
  app.get('/api/db/export', async (req, reply) => {
    reply.raw.setHeader('Content-Type', 'application/sql; charset=utf-8');
    reply.raw.setHeader(
      'Content-Disposition',
      `attachment; filename="nfr-backup-${new Date().toISOString().slice(0, 10)}.sql"`,
    );
    const child = spawn(
      'pg_dump',
      ['--data-only', '--column-inserts', '--no-owner', '--no-privileges', deps.dsn],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.pipe(reply.raw, { end: false });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += String(d); });
    return new Promise<void>((resolve) => {
      child.on('close', (code) => {
        if (code !== 0 && !reply.raw.writableEnded) {
          reply.raw.write(`\n-- pg_dump exited ${code}: ${stderr}\n`);
        }
        reply.raw.end();
        resolve();
      });
    });
  });

  /**
   * POST /api/db/import
   * Body: SQL text (Content-Type: application/sql or text/plain).
   * Truncates all data tables first, then runs the SQL via psql.
   * The user's UI MUST confirm before calling this — it replaces all data.
   */
  app.post('/api/db/import', async (req, reply) => {
    let sql = '';
    if (typeof req.body === 'string') sql = req.body;
    else {
      reply.code(400);
      return { error: 'expected SQL body (Content-Type: application/sql or text/plain)' };
    }
    if (sql.trim().length === 0) {
      reply.code(400);
      return { error: 'empty body' };
    }

    // Wipe data tables in dependency order. signal_definitions and sessions
    // are referenced by rt/sd_readings via FK; truncate cascade keeps it clean.
    await deps.pool.query(`
      TRUNCATE TABLE rt_readings, sd_readings, sessions, signal_definitions, app_config RESTART IDENTITY CASCADE;
    `);
    // Re-seed the singleton config row (Plan 1 migration normally does this).
    await deps.pool.query(`INSERT INTO app_config (id) VALUES (1) ON CONFLICT DO NOTHING`);

    return new Promise((resolve) => {
      const child = spawn(
        'psql',
        ['-v', 'ON_ERROR_STOP=1', '-q', '-X', deps.dsn],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += String(d); });
      child.stderr.on('data', (d) => { stderr += String(d); });
      child.stdin.write(sql);
      child.stdin.end();
      child.on('close', (code) => {
        if (code !== 0) {
          reply.code(500);
          resolve({ error: 'psql import failed', stderr: stderr.slice(0, 2000) });
        } else {
          resolve({ ok: true, stdout: stdout.slice(0, 2000) });
        }
      });
    });
  });

  /**
   * GET /api/db/export-range.csv?olderThan=ISO
   * Streams a CSV containing every reading whose session falls in the
   * targeted range, joined with session metadata + signal info. Without
   * `olderThan` it returns the entire DB. Use this BEFORE calling /api/db/clear
   * with the same range to keep an offline archive.
   */
  app.get<{ Querystring: { olderThan?: string } }>(
    '/api/db/export-range.csv',
    async (req, reply) => {
      const olderThan = req.query.olderThan;
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = olderThan
        ? `nfr-archive-before-${olderThan.slice(0, 10)}-${stamp}.csv`
        : `nfr-archive-all-${stamp}.csv`;
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );

      const params: any[] = [];
      let where = '';
      if (olderThan) {
        where = 'WHERE s.started_at < $1::timestamptz';
        params.push(olderThan);
      }
      const { rows } = await deps.pool.query<{
        session_id: string;
        session_started_at: Date;
        session_ended_at: Date | null;
        track: string | null;
        driver: string | null;
        car: string | null;
        ts: Date;
        source: string;
        signal_name: string;
        unit: string | null;
        value: string;
      }>(
        `SELECT s.id AS session_id, s.started_at AS session_started_at,
                s.ended_at AS session_ended_at, s.track, s.driver, s.car,
                r.ts, sd.source, sd.signal_name, sd.unit, r.value
         FROM sessions s
         JOIN (
           SELECT ts, session_id, signal_id, value FROM sd_readings
           UNION ALL
           SELECT ts, session_id, signal_id, value FROM rt_readings
         ) r ON r.session_id = s.id
         JOIN signal_definitions sd ON sd.id = r.signal_id
         ${where}
         ORDER BY s.started_at, r.ts`,
        params,
      );

      const esc = (s: string) =>
        s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      const parts: string[] = [
        'session_id,session_started_at,session_ended_at,track,driver,car,ts,source,signal_name,unit,value\n',
      ];
      for (const r of rows) {
        parts.push(
          [
            r.session_id,
            r.session_started_at.toISOString(),
            r.session_ended_at ? r.session_ended_at.toISOString() : '',
            esc(r.track ?? ''),
            esc(r.driver ?? ''),
            esc(r.car ?? ''),
            r.ts.toISOString(),
            esc(r.source),
            esc(r.signal_name),
            esc(r.unit ?? ''),
            String(r.value),
          ].join(',') + '\n',
        );
      }
      return parts.join('');
    },
  );

  /**
   * GET /api/db/stats — quick counts so the Settings UI can show what's there.
   */
  app.get('/api/db/stats', async () => {
    const { rows } = await deps.pool.query<{
      sessions: string;
      sd: string;
      rt: string;
      sigs: string;
      size: string;
    }>(`
      SELECT
        (SELECT count(*) FROM sessions)            AS sessions,
        (SELECT count(*) FROM sd_readings)          AS sd,
        (SELECT count(*) FROM rt_readings)          AS rt,
        (SELECT count(*) FROM signal_definitions)   AS sigs,
        pg_size_pretty(pg_database_size(current_database())) AS size
    `);
    const r = rows[0];
    return {
      sessions: Number(r.sessions),
      sd_readings: Number(r.sd),
      rt_readings: Number(r.rt),
      signal_definitions: Number(r.sigs),
      database_size: r.size,
    };
  });
}
