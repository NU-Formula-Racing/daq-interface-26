import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootstrapDatabase } from './db/bootstrap.ts';
import { createPool } from './db/pool.ts';
import { getAppConfig } from './db/config.ts';
import { buildApp } from './server/app.ts';
import { ParserManager } from './parser/manager.ts';
import { FolderWatcher } from './watcher/watcher.ts';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');
const PARSER_DIR = join(REPO_ROOT, 'parser');
const PARSER_PY = join(PARSER_DIR, '__main__.py');
const PARSER_VENV_PY = join(PARSER_DIR, '.venv', 'bin', 'python');

export async function run(opts: {
  dsn?: string;
  port?: number;
  host?: string;
  dbcCsv?: string;
} = {}) {
  const dsn =
    opts.dsn ??
    process.env.NFR_DB_URL ??
    'postgres://postgres@localhost:5432/nfr_local';
  const host = opts.host ?? process.env.NFR_BIND_HOST ?? '127.0.0.1';
  const port = opts.port ?? Number(process.env.NFR_BIND_PORT ?? '4444');
  const dbcCsv = opts.dbcCsv ?? join(REPO_ROOT, 'NFR26DBC.csv');

  const boot = await bootstrapDatabase({ connectionString: dsn, migrationsDir: MIGRATIONS_DIR });
  await boot.client.end();

  const pool = createPool({ connectionString: dsn });
  const cfg = await getAppConfig(pool);
  const authToken = typeof cfg.authToken === 'string' ? cfg.authToken : null;
  const serialPort = typeof cfg.serialPort === 'string' ? cfg.serialPort : null;
  const watchDir = typeof cfg.watchDir === 'string' ? cfg.watchDir : null;
  const replayFile = typeof cfg.replayFile === 'string' ? cfg.replayFile : null;
  const replaySpeed =
    typeof cfg.replaySpeed === 'number' ? cfg.replaySpeed : 1.0;

  const parserArgs = replayFile
    ? [
        PARSER_PY,
        'replay',
        '--dbc',
        dbcCsv,
        '--file',
        replayFile,
        '--speed',
        String(replaySpeed),
      ]
    : serialPort
      ? [PARSER_PY, 'live', '--dbc', dbcCsv, '--port', serialPort]
      : [PARSER_PY, 'live', '--dbc', dbcCsv, '--port', '/dev/null-no-port-configured'];

  const parser = new ParserManager({
    command: PARSER_VENV_PY,
    args: parserArgs,
    env: { ...process.env, NFR_DB_URL: dsn },
    restartOnExit: !replayFile,
    restartDelayMs: 2_000,
  });
  parser.start();

  const app = await buildApp({ pool, parser, authToken });
  await app.listen({ port, host });

  let watcher: FolderWatcher | null = null;
  if (watchDir) {
    watcher = new FolderWatcher({
      dir: watchDir,
      pool,
      importer: async (file: string) => {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            PARSER_VENV_PY,
            [PARSER_PY, 'batch', '--dbc', dbcCsv, '--file', file],
            { env: { ...process.env, NFR_DB_URL: dsn }, stdio: 'inherit' }
          );
          child.on('close', (code) =>
            code === 0 ? resolve() : reject(new Error(`parser batch exit ${code}`))
          );
        });
      },
    });
    await watcher.start();
  }

  const shutdown = async () => {
    await parser.stop();
    if (watcher) await watcher.stop();
    await app.close();
    await pool.end();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return { app, pool, parser, watcher, shutdown, host, port };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    console.error('fatal:', err);
    process.exit(1);
  });
}
