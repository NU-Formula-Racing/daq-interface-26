import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import { bootstrapDatabase } from './db/bootstrap.ts';
import { createPool } from './db/pool.ts';
import { getAppConfig } from './db/config.ts';
import { buildApp } from './server/app.ts';
import { ParserManager } from './parser/manager.ts';
import { FolderWatcher } from './watcher/watcher.ts';
import type { SetupState } from './server/routes/setup.ts';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');
const PARSER_DIR = join(REPO_ROOT, 'parser');
const PARSER_PY = join(PARSER_DIR, '__main__.py');
const PARSER_VENV_PY = join(PARSER_DIR, '.venv', 'bin', 'python');
const DBC_STORE_PATH = join(REPO_ROOT, 'parser', 'active-dbc.csv');

export async function run(opts: {
  dsn?: string;
  port?: number;
  host?: string;
  dbcCsv?: string;
  migrationsDir?: string;
  parserBinary?: string;
  staticRoot?: string;
} = {}) {
  const dsn =
    opts.dsn ??
    process.env.NFR_DB_URL ??
    'postgres://postgres@localhost:5432/nfr_local';
  const host = opts.host ?? process.env.NFR_BIND_HOST ?? '127.0.0.1';
  const port = opts.port ?? Number(process.env.NFR_BIND_PORT ?? '4444');
  const dbcCsv = opts.dbcCsv ?? join(REPO_ROOT, 'NFR26DBC.csv');
  const migrationsDir = opts.migrationsDir ?? MIGRATIONS_DIR;
  const parserBinary =
    opts.parserBinary ??
    process.env.NFR_PARSER_BINARY ??
    PARSER_VENV_PY;   // dev fallback: the venv's python interpreter
  const parserIsPython =
    parserBinary.endsWith('python') || parserBinary.endsWith('python3');

  let pool: pg.Pool | null = null;
  let parser: ParserManager | null = null;
  let watcher: FolderWatcher | null = null;
  let authToken: string | null = null;

  const setupState: SetupState = {
    status: 'not_reachable',
    lastError: null,
  };

  const tryBoot = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const boot = await bootstrapDatabase({
        connectionString: dsn,
        migrationsDir,
      });
      await boot.client.end();
      pool = createPool({ connectionString: dsn });
      const cfg = await getAppConfig(pool);
      authToken = typeof cfg.authToken === 'string' ? cfg.authToken : null;
      const serialPort = typeof cfg.serialPort === 'string' ? cfg.serialPort : null;
      const watchDir = typeof cfg.watchDir === 'string' ? cfg.watchDir : null;
      const replayFile = typeof cfg.replayFile === 'string' ? cfg.replayFile : null;
      const replaySpeed =
        typeof cfg.replaySpeed === 'number' ? cfg.replaySpeed : 1.0;
      const cfgDbc = typeof cfg.dbcPath === 'string' ? cfg.dbcPath : null;
      const effectiveDbc = cfgDbc ?? dbcCsv;

      const subcommandArgs = replayFile
        ? ['replay', '--dbc', effectiveDbc, '--file', replayFile, '--speed', String(replaySpeed)]
        : serialPort
          ? ['live', '--dbc', effectiveDbc, '--port', serialPort]
          : ['live', '--dbc', effectiveDbc, '--port', '/dev/null-no-port-configured'];

      const parserArgs = parserIsPython
        ? [PARSER_PY, ...subcommandArgs]
        : subcommandArgs;

      parser = new ParserManager({
        command: parserBinary,
        args: parserArgs,
        env: { ...process.env, NFR_DB_URL: dsn },
        restartOnExit: !replayFile,
        restartDelayMs: 2_000,
      });
      parser.start();

      if (watchDir) {
        watcher = new FolderWatcher({
          dir: watchDir,
          pool,
          importer: async (file: string) => {
            try {
              await new Promise<void>((resolve, reject) => {
                const batchArgs = parserIsPython
                  ? [PARSER_PY, 'batch', '--dbc', effectiveDbc, '--file', file]
                  : ['batch', '--dbc', effectiveDbc, '--file', file];
                const child = spawn(
                  parserBinary,
                  batchArgs,
                  { env: { ...process.env, NFR_DB_URL: dsn }, stdio: 'inherit' }
                );
                child.on('close', (code) =>
                  code === 0 ? resolve() : reject(new Error(`parser batch exit ${code}`))
                );
              });
            } catch (err) {
              console.error(`SD import failed for ${file}:`, err);
              throw err;
            }
          },
        });
        await watcher.start();
      }

      setupState.status = 'ok';
      setupState.lastError = null;
      return { ok: true };
    } catch (err) {
      setupState.status = 'not_reachable';
      setupState.lastError = (err as Error).message;
      console.error('boot failed:', (err as Error).message);
      return { ok: false, error: (err as Error).message };
    }
  };

  const firstBoot = await tryBoot();

  // The retry exposed via the setup route triggers a rebuild by exiting the
  // process; Electron main will restart us with a fresh `run()` call.
  setupState.retry = async () => {
    const result = await tryBoot();
    if (result.ok) {
      setTimeout(() => process.exit(0), 500);
    }
    return result;
  };

  const restartParser = async () => {
    if (!parser || !pool) return;
    const cfgNow = await getAppConfig(pool);
    const newDbc = typeof cfgNow.dbcPath === 'string' ? cfgNow.dbcPath : dbcCsv;
    const replayFileNow = typeof cfgNow.replayFile === 'string' ? cfgNow.replayFile : null;
    const replaySpeedNow = typeof cfgNow.replaySpeed === 'number' ? cfgNow.replaySpeed : 1.0;
    const serialPortNow = typeof cfgNow.serialPort === 'string' ? cfgNow.serialPort : null;

    const newSubArgs = replayFileNow
      ? ['replay', '--dbc', newDbc, '--file', replayFileNow, '--speed', String(replaySpeedNow)]
      : serialPortNow
        ? ['live', '--dbc', newDbc, '--port', serialPortNow]
        : ['live', '--dbc', newDbc, '--port', '/dev/null-no-port-configured'];

    const newArgs = parserIsPython ? [PARSER_PY, ...newSubArgs] : newSubArgs;

    await parser.stop();
    parser = new ParserManager({
      command: parserBinary,
      args: newArgs,
      env: { ...process.env, NFR_DB_URL: dsn },
      restartOnExit: !replayFileNow,
      restartDelayMs: 2_000,
    });
    parser.start();
  };

  const app = await buildApp({
    pool,
    parser: parser ?? undefined,
    authToken,
    setupState,
    staticRoot: opts.staticRoot,
    dbcStorePath: DBC_STORE_PATH,
    onDbcChanged: restartParser,
    dsn,
  });
  await app.listen({ port, host });

  const shutdown = async () => {
    if (parser) await parser.stop();
    if (watcher) await watcher.stop();
    await app.close();
    if (pool) await pool.end();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return { app, pool, parser, watcher, shutdown, host, port, firstBoot };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    console.error('fatal:', err);
    process.exit(1);
  });
}
