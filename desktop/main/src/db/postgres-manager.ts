import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path, { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

export interface PostgresManagerOptions {
  /** Absolute path to the directory holding `bin/`, `lib/`, `share/`. */
  binDir: string;
  /** Absolute path to the Postgres data directory (the "cluster"). */
  dataDir: string;
  /** TCP port to bind. Use a private port (e.g. 5499) to avoid collisions. */
  port: number;
  /** Superuser to create. Defaults to `nfr`. */
  superuser?: string;
}

const PG_MAJOR = '17';

export function postgresBinDir(): string {
  const platDir =
    process.platform === 'win32' ? 'windows-x64'
    : process.platform === 'linux' ? 'linux-x64'
    : 'macos-arm64';
  // Packaged: <resources>/postgres-bin/<plat>
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const packaged = join(resourcesPath, 'postgres-bin', platDir);
    if (existsSync(packaged)) return packaged;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, '..', '..', '..', 'build', 'postgres-bin', platDir);
  if (!existsSync(candidate)) {
    throw new Error('embedded Postgres binaries not found at ' + candidate);
  }
  return candidate;
}

export class PostgresManager {
  private child: ChildProcess | null = null;
  private opts: Required<PostgresManagerOptions>;

  constructor(opts: PostgresManagerOptions) {
    this.opts = { superuser: 'nfr', ...opts };
  }

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /** True if `dataDir` has a Postgres cluster of the expected major version. */
  async isInitialized(): Promise<boolean> {
    const versionFile = join(this.opts.dataDir, 'PG_VERSION');
    if (!existsSync(versionFile)) return false;
    const v = readFileSync(versionFile, 'utf-8').trim();
    return v === PG_MAJOR;
  }

  /** Run `initdb` if no cluster exists. Idempotent. */
  async ensureInitialized(): Promise<void> {
    if (await this.isInitialized()) return;

    const binInitdb = this.binPath('initdb');
    const env = { ...process.env, ...this.libEnv() };

    const res = spawnSync(
      binInitdb,
      [
        '-D', this.opts.dataDir,
        '-U', this.opts.superuser,
        '-A', 'trust',
        '--encoding=UTF8',
        '--locale=C',
      ],
      { env, stdio: 'pipe' },
    );
    if (res.status !== 0) {
      throw new Error(`initdb failed: ${res.stderr.toString().slice(0, 500)}`);
    }

    // Pin the port + listen-on-loopback in postgresql.conf so accidental
    // edits don't break our assumptions.
    const conf = join(this.opts.dataDir, 'postgresql.conf');
    const extra = [
      `port = ${this.opts.port}`,
      `listen_addresses = '127.0.0.1'`,
      `unix_socket_directories = ''`,
      `logging_collector = off`,
    ].join('\n');
    const orig = readFileSync(conf, 'utf-8');
    if (!orig.includes('# nfr-managed')) {
      writeFileSync(conf, orig + `\n# nfr-managed\n${extra}\n`, 'utf-8');
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!(await this.isInitialized())) {
      throw new Error(
        `data dir ${this.opts.dataDir} is not initialized — call ensureInitialized() first`,
      );
    }

    const binPostgres = this.binPath('postgres');
    const env = { ...process.env, ...this.libEnv() };

    const child = spawn(
      binPostgres,
      ['-D', this.opts.dataDir, '-p', String(this.opts.port)],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.child = child;

    const STDERR_CAP = 2048;
    let stderrBuf = '';
    child.stderr!.on('data', (d) => {
      const s = d.toString();
      process.stderr.write(`[postgres] ${s}`);
      if (stderrBuf.length < STDERR_CAP) {
        stderrBuf = (stderrBuf + s).slice(-STDERR_CAP);
      }
    });
    child.on('exit', (code, sig) => {
      if (code !== 0 && code !== null) {
        console.error(`postgres exited unexpectedly code=${code} signal=${sig}`);
      }
      if (this.child === child) this.child = null;
    });

    // Wait for readiness via TCP probe (Linux zonky binaries don't ship pg_isready).
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      // If exit handler nulled this.child, the process died during startup.
      if (this.child === null) {
        throw new Error(
          `postgres exited during startup${stderrBuf ? `: ${stderrBuf.trim()}` : ''}`,
        );
      }
      const probe = new pg.Client({
        connectionString: `postgres://${this.opts.superuser}@127.0.0.1:${this.opts.port}/postgres`,
        connectionTimeoutMillis: 1000,
      });
      try {
        await probe.connect();
        await probe.end();
        return;
      } catch {
        // not ready yet
        try { await probe.end(); } catch { /* ignore */ }
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    // Timed out — kill the child before throwing.
    if (this.child === child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 2_000));
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    throw new Error(
      `postgres did not become ready within 20s${stderrBuf ? `: ${stderrBuf.trim()}` : ''}`,
    );
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    const child = this.child;
    return new Promise((resolveP) => {
      const done = () => resolveP();
      if (child.exitCode !== null) return done();
      child.once('close', done);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 5_000);
    });
  }

  /** Connection URL to use with `pg.Pool` etc. */
  url(database: string): string {
    return `postgres://${this.opts.superuser}@127.0.0.1:${this.opts.port}/${database}`;
  }

  private binPath(name: string): string {
    return join(this.opts.binDir, 'bin', process.platform === 'win32' ? `${name}.exe` : name);
  }

  private libEnv(): NodeJS.ProcessEnv {
    const libDir = join(this.opts.binDir, 'lib');
    const dyld = process.env.DYLD_LIBRARY_PATH ?? '';
    const ld = process.env.LD_LIBRARY_PATH ?? '';
    return {
      DYLD_LIBRARY_PATH: dyld ? `${libDir}${path.delimiter}${dyld}` : libDir,
      LD_LIBRARY_PATH: ld ? `${libDir}${path.delimiter}${ld}` : libDir,
      LC_ALL: 'C.UTF-8',
      LANG: 'C.UTF-8',
    };
  }
}
