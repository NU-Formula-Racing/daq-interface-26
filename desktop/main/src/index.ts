import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import pg from 'pg';
import { bootstrapDatabase } from './db/bootstrap.ts';
import { createPool } from './db/pool.ts';
import { getAppConfig } from './db/config.ts';
import { buildApp } from './server/app.ts';
import { ParserManager } from './parser/manager.ts';
import { FolderWatcher } from './watcher/watcher.ts';
import { PostgresManager, postgresBinDir } from './db/postgres-manager.ts';
import { loadCatalog } from './db/catalog.ts';
import { VolumeWatcher } from './db/volume-watcher.ts';
import type { SetupState } from './server/routes/setup.ts';
import type { ImportResult } from './server/routes/import.ts';
import type { CatalogDeps } from './server/routes/catalog.ts';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');
const PARSER_DIR = join(REPO_ROOT, 'parser');
const PARSER_PY = join(PARSER_DIR, '__main__.py');
const PARSER_VENV_PY = join(PARSER_DIR, '.venv', 'bin', 'python');
const DBC_STORE_PATH = join(REPO_ROOT, 'parser', 'active-dbc.csv');
// Staging area for uploaded .nfr files. Inside an installed `.app` the
// Resources/ directory is often read-only, so use the OS temp dir which is
// always writable and good enough — files are ingested into Postgres
// immediately and the temp copy is no longer needed.
const NFR_UPLOADS_DIR = join(tmpdir(), 'nfr-uploads');

const EMBEDDED_PG_PORT = 5499;
const EMBEDDED_PG_USER = 'nfr';
const EMBEDDED_PG_DATABASE = 'postgres';

function isNfrDataDirSync(path: string): boolean {
  const versionFile = join(path, 'PG_VERSION');
  if (!existsSync(versionFile)) return false;
  try {
    return readFileSync(versionFile, 'utf-8').trim() === '17';
  } catch {
    return false;
  }
}

export async function run(opts: {
  dsn?: string;
  port?: number;
  host?: string;
  dbcCsv?: string;
  migrationsDir?: string;
  parserBinary?: string;
  staticRoot?: string;
  userDataDir?: string;
} = {}) {
  const defaultHost = opts.host ?? process.env.NFR_BIND_HOST ?? '127.0.0.1';
  const port = opts.port ?? Number(process.env.NFR_BIND_PORT ?? '4444');
  const dbcCsv = opts.dbcCsv ?? join(REPO_ROOT, 'NFR26DBC.csv');
  const migrationsDir = opts.migrationsDir ?? MIGRATIONS_DIR;
  const parserBinary =
    opts.parserBinary ??
    process.env.NFR_PARSER_BINARY ??
    PARSER_VENV_PY;   // dev fallback: the venv's python interpreter
  const parserIsPython =
    parserBinary.endsWith('python') || parserBinary.endsWith('python3');

  const userDataDir =
    opts.userDataDir ??
    process.env.NFR_USER_DATA_DIR ??
    join(homedir(), '.nfr-local');
  const catalogPath = join(userDataDir, 'nfr-catalog.json');

  // Dev/test override: if NFR_DB_URL is explicitly set (or opts.dsn passed in)
  // we skip the catalog/embedded-Postgres flow and use that DSN directly.
  // This is what the scratch-DB test harness uses.
  const envDsnOverride = opts.dsn ?? process.env.NFR_DB_URL ?? null;

  let pool: pg.Pool | null = null;
  let parser: ParserManager | null = null;
  let watcher: FolderWatcher | null = null;
  let authToken: string | null = null;
  let pgManager: PostgresManager | null = null;
  let dsn: string | null = null;
  let volumeWatcher: VolumeWatcher | null = null;
  let activeDataDir: string | null = null;

  const setupState: SetupState = {
    status: 'not_reachable',
    lastError: null,
  };

  const tryBoot = async (): Promise<{ ok: boolean; error?: string }> => {
    if (volumeWatcher) {
      volumeWatcher.stop();
      volumeWatcher = null;
    }
    try {
      // Resolve dsn for this boot attempt
      let bootDsn: string;
      if (envDsnOverride) {
        bootDsn = envDsnOverride;
      } else {
        // Read catalog and decide what to do
        const cat = await loadCatalog(catalogPath);
        if (cat.active === null) {
          setupState.status = 'not_reachable';
          setupState.lastError = 'no active database — choose or create one';
          return { ok: false, error: setupState.lastError };
        }
        if (!isNfrDataDirSync(cat.active)) {
          setupState.status = 'not_reachable';
          setupState.lastError = `active database not reachable: ${cat.active}`;
          return { ok: false, error: setupState.lastError };
        }

        // Spin up embedded Postgres against the active data dir.
        pgManager = new PostgresManager({
          binDir: postgresBinDir(),
          dataDir: cat.active,
          port: EMBEDDED_PG_PORT,
          superuser: EMBEDDED_PG_USER,
        });
        await pgManager.ensureInitialized();
        await pgManager.start();
        bootDsn = pgManager.url(EMBEDDED_PG_DATABASE);
        activeDataDir = cat.active;
      }

      const boot = await bootstrapDatabase({
        connectionString: bootDsn,
        migrationsDir,
      });
      await boot.client.end();
      pool = createPool({ connectionString: bootDsn });
      dsn = bootDsn;

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
        env: { ...process.env, NFR_DB_URL: bootDsn },
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
                  { env: { ...process.env, NFR_DB_URL: bootDsn }, stdio: 'inherit' }
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

      // Watch the active data dir so an unplugged external drive surfaces
      // as a clean UI state instead of letting Postgres crash unattended.
      if (pool && activeDataDir) {
        const watchedPath = activeDataDir;
        volumeWatcher = new VolumeWatcher({
          path: watchedPath,
          onDisconnect: () => {
            console.error(`data drive disconnected: ${watchedPath}`);
            (async () => {
              if (parser) {
                try { await parser.stop(); } catch { /* best effort */ }
                parser = null;
              }
              if (pgManager) {
                try { await pgManager.stop(); } catch { /* best effort */ }
                pgManager = null;
              }
              if (pool) {
                try { await pool.end(); } catch { /* best effort */ }
                pool = null;
              }
              setupState.status = 'storage_disconnected';
              setupState.lastError = 'data drive disconnected: ' + watchedPath;
            })();
          },
        });
        volumeWatcher.start();
      }

      return { ok: true };
    } catch (err) {
      setupState.status = 'not_reachable';
      setupState.lastError = (err as Error).message;
      console.error('boot failed:', (err as Error).message);
      // If the embedded Postgres started but bootstrap/etc failed, stop it so
      // the next attempt isn't fighting a stale process.
      if (pgManager) {
        try { await pgManager.stop(); } catch { /* ignore */ }
        pgManager = null;
      }
      if (volumeWatcher) {
        volumeWatcher.stop();
        volumeWatcher = null;
      }
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
    if (!parser || !pool || !dsn) return;
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

  const runBatchImport = async (filename: string, body: Buffer): Promise<ImportResult> => {
    if (!pool || !dsn) return { session_id: null, row_count: 0, error: 'database not ready' };
    mkdirSync(NFR_UPLOADS_DIR, { recursive: true });
    const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_');
    const target = join(NFR_UPLOADS_DIR, `${Date.now()}-${safeName}`);
    writeFileSync(target, body);

    const cfgNow = await getAppConfig(pool);
    const importDbc = typeof cfgNow.dbcPath === 'string' ? cfgNow.dbcPath : dbcCsv;
    const subArgs = ['batch', '--dbc', importDbc, '--file', target];
    const args = parserIsPython ? [PARSER_PY, ...subArgs] : subArgs;
    const importDsn = dsn;

    return new Promise<ImportResult>((resolve) => {
      const child = spawn(parserBinary, args, {
        env: { ...process.env, NFR_DB_URL: importDsn },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += String(d); });
      child.stderr.on('data', (d) => { stderr += String(d); });
      child.on('close', (code) => {
        if (code !== 0) {
          resolve({
            session_id: null,
            row_count: 0,
            error: `parser exit ${code}: ${stderr.slice(0, 500)}`,
          });
          return;
        }
        let sessionId: string | null = null;
        let rowCount = 0;
        for (const line of stdout.trim().split('\n')) {
          try {
            const ev = JSON.parse(line);
            if (ev?.type === 'session_ended') {
              sessionId = ev.session_id ?? null;
              rowCount = ev.row_count ?? 0;
            }
          } catch {
            /* ignore non-JSON lines */
          }
        }
        resolve({ session_id: sessionId, row_count: rowCount });
      });
    });
  };

  const catalogDeps: CatalogDeps = {
    catalogPath,
    initializeDataDir: async (path: string) => {
      const mgr = new PostgresManager({
        binDir: postgresBinDir(),
        dataDir: path,
        port: EMBEDDED_PG_PORT,
        superuser: EMBEDDED_PG_USER,
      });
      await mgr.ensureInitialized();
      // Don't start it — orchestrator will own the lifecycle on next boot.
    },
    isNfrDataDir: async (path: string) => isNfrDataDirSync(path),
    signalRestart: () => {
      setTimeout(() => process.exit(0), 500);
    },
  };

  // Resolve broadcast host BEFORE app.listen by reading app_config (if reachable).
  let broadcastEnabled = false;
  if (pool) {
    try {
      const cfg = await getAppConfig(pool);
      broadcastEnabled = cfg.broadcastEnabled === true;
    } catch {
      broadcastEnabled = false;
    }
  }
  const host = broadcastEnabled ? '0.0.0.0' : defaultHost;

  const broadcastDeps = pool
    ? {
        configPool: pool,
        signalRestart: () => {
          setTimeout(() => process.exit(0), 500);
        },
        port,
        host,
      }
    : undefined;

  const app = await buildApp({
    pool,
    parser: parser ?? undefined,
    authToken,
    setupState,
    staticRoot: opts.staticRoot,
    dbcStorePath: DBC_STORE_PATH,
    onDbcChanged: restartParser,
    dsn: dsn ?? undefined,
    onImport: runBatchImport,
    catalogDeps,
    broadcastDeps,
    uninstallDeps: {
      catalogPath,
      userDataDir,
      signalQuit: () => {
        // Use a non-zero code so the Electron relaunch override (which only
        // catches code 0) lets the process die instead of restarting.
        process.exit(99);
      },
    },
  });
  await app.listen({ port, host });

  const shutdown = async () => {
    if (volumeWatcher) volumeWatcher.stop();
    if (parser) await parser.stop();
    if (watcher) await watcher.stop();
    await app.close();
    if (pool) await pool.end();
    if (pgManager) {
      try { await pgManager.stop(); } catch { /* ignore */ }
    }
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
