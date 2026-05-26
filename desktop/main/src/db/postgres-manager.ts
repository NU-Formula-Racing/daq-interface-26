import { spawn, spawnSync, type ChildProcess } from 'child_process';

// Windows leaves postgres worker processes orphaned when the postmaster
// is terminated via TerminateProcess (Node's SIGTERM on win32). Use taskkill
// /T to recursively terminate the full process tree.
function killTreeWindows(pid: number, force: boolean): void {
  const args = force ? ['/F', '/T', '/PID', String(pid)] : ['/T', '/PID', String(pid)];
  spawn('taskkill', args, { stdio: 'ignore' });
}
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import path, { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import pg from 'pg';

const execFileP = promisify(execFile);

/** Best-effort: remove a postmaster.pid lock whose claimed PID isn't a
 *  running postgres process owning the same data dir. Swallows all errors
 *  — cleanup must never block the launch path. */
export async function clearStalePidLock(dataDir: string): Promise<void> {
  const lockPath = `${dataDir}/postmaster.pid`;
  if (!existsSync(lockPath)) return;

  let raw: string;
  try { raw = readFileSync(lockPath, 'utf-8'); }
  catch { return; }

  const firstLine = raw.split(/\r?\n/)[0]?.trim();
  const pid = Number(firstLine);
  if (!Number.isInteger(pid) || pid <= 0) return;  // malformed — leave alone

  // Is the PID alive?
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') alive = true;
  }

  if (!alive) {
    try { unlinkSync(lockPath); } catch { /* ignore */ }
    return;
  }

  // Alive — confirm it's actually a postgres owning OUR data dir.
  if (process.platform === 'win32') {
    // ps doesn't behave the same on Windows; trust the alive check.
    return;
  }
  try {
    const { stdout } = await execFileP('ps', ['-p', String(pid), '-o', 'command=']);
    const cmd = stdout.trim();
    if (cmd.includes('postgres') && cmd.includes(dataDir)) return;
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  } catch {
    // ps failed — be defensive and delete. Postgres will surface a clear
    // error if the lock turned out to be legitimate.
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  }
}

/** Best-effort `ipcrm -m <id>` to release an orphaned SysV shared-memory
 *  block left over from an unclean postgres shutdown. */
export async function ipcrmShared(id: string): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    await execFileP('ipcrm', ['-m', id]);
  } catch { /* ignore */ }
}

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

    // Pre-launch cleanup: remove a stale postmaster.pid lock left behind by
    // a previous unclean shutdown. Safe on a clean data dir.
    await clearStalePidLock(this.opts.dataDir);

    const binPostgres = this.binPath('postgres');
    const env = { ...process.env, ...this.libEnv() };

    const attemptSpawn = async (): Promise<
      { ok: true } | { ok: false; stderrBuf: string }
    > => {
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

      // Readiness probe — 20 s budget.
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (this.child === null) {
          return { ok: false, stderrBuf };
        }
        const probe = new pg.Client({
          connectionString: `postgres://${this.opts.superuser}@127.0.0.1:${this.opts.port}/postgres`,
          connectionTimeoutMillis: 1000,
        });
        try {
          await probe.connect();
          await probe.end();
          return { ok: true };
        } catch {
          try { await probe.end(); } catch { /* ignore */ }
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      // Timed out — kill the child before returning.
      if (this.child === child && child.exitCode === null) {
        if (process.platform === 'win32' && child.pid != null) {
          killTreeWindows(child.pid, false);
        } else {
          child.kill('SIGTERM');
        }
        await new Promise((r) => setTimeout(r, 2_000));
        if (child.exitCode === null) {
          if (process.platform === 'win32' && child.pid != null) {
            killTreeWindows(child.pid, true);
          } else {
            child.kill('SIGKILL');
          }
        }
      }
      return {
        ok: false,
        stderrBuf: stderrBuf || 'postgres did not become ready within 20s',
      };
    };

    let result = await attemptSpawn();
    if (!result.ok) {
      // Orphan-shmem recovery: parse the block ID, ipcrm, retry once.
      const m = result.stderrBuf.match(
        /pre-existing shared memory block \(key \d+, ID (\d+)\)/,
      );
      if (m) {
        const id = m[1];
        process.stderr.write(
          `[postgres] orphan shmem detected (ID ${id}), running ipcrm -m ${id}\n`,
        );
        await ipcrmShared(id);
        result = await attemptSpawn();
      }
    }

    if (!result.ok) {
      throw new Error(
        `postgres failed to start${result.stderrBuf ? `: ${result.stderrBuf.trim()}` : ''}`,
      );
    }
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    const child = this.child;
    return new Promise((resolveP) => {
      const done = () => resolveP();
      if (child.exitCode !== null) return done();
      child.once('close', done);
      if (process.platform === 'win32' && child.pid != null) {
        killTreeWindows(child.pid, true);
      } else {
        child.kill('SIGTERM');
      }
      setTimeout(() => {
        if (child.exitCode === null) {
          if (process.platform === 'win32' && child.pid != null) {
            killTreeWindows(child.pid, true);
          } else {
            child.kill('SIGKILL');
          }
        }
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
