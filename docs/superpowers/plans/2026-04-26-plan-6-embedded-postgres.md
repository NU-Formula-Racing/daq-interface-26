# Plan 6 — Embedded Postgres + Database Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the requirement that users install Postgres themselves. Bundle Postgres inside the app, let users pick where the data directory lives (local or external drive), and let them maintain multiple "databases" they can switch between. Restore the broadcast-on-LAN UI that got dropped during the Settings refactor.

**Architecture:** A new `PostgresManager` module spawns and supervises a private Postgres instance on port 5499 with a user-chosen data directory. App config tracks an active data directory + a list of recents (the "catalog"). Settings exposes a Storage section to create / connect / switch / delete databases. First launch prompts for storage location with a sensible default. Drive-aware resilience handles the case where an external data-dir volume vanishes mid-session. Embedded Postgres binaries get vendored as `extraResources` and shipped inside the `.dmg`.

**Tech Stack:** Vendored Postgres 17 binaries for macOS arm64 (~50 MB), node-pg unchanged, Fastify unchanged, electron-builder `extraResources`, `chokidar` for volume watching, a tiny QR-code library for the broadcast pairing screen.

**Prerequisites:** Plans 1–5 complete. The packaged macOS app currently boots and works against a host-installed Postgres.

**Out of scope (deferred):**
- Linux/Windows packaging — same approach but per-platform binaries; can be a small follow-up.
- Code signing / notarization.
- Auto-update via electron-updater.
- Changing Postgres major versions later (would need pg_upgrade orchestration).

---

### Task 1: Vendor Postgres binaries + `PostgresManager`

**Purpose:** Ship a Postgres server binary inside the app and own its lifecycle.

**Files:**
- Modify: `desktop/package.json` (add `postgres-bin` to `extraResources`)
- Create: `desktop/build/postgres-bin/README.md` (provenance notes — which Postgres build, version, license)
- Create: `desktop/main/src/db/postgres-manager.ts`
- Create: `desktop/main/tests/db/postgres-manager.test.ts`

The Postgres binaries we need: `postgres`, `initdb`, `pg_ctl`, `pg_isready`, plus the `lib/` shared libraries they dlopen and `share/` (for `postgres.bki`, locale data, etc.). On macOS arm64 these come bundled with Postgres.app — we copy the relevant subset.

- [ ] **Step 1: Locate a Postgres 17 macOS arm64 binary set**

If Postgres.app v17 is installed:
```
SRC=/Applications/Postgres.app/Contents/Versions/17
ls $SRC/bin   # expect: postgres, initdb, pg_ctl, pg_isready, psql, ...
```

If not, install it (https://postgresapp.com) just to grab the binaries. We'll vendor a stripped subset.

- [ ] **Step 2: Copy the binaries into `desktop/build/postgres-bin/macos-arm64/`**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
mkdir -p desktop/build/postgres-bin/macos-arm64
SRC=/Applications/Postgres.app/Contents/Versions/17

# Required binaries
mkdir -p desktop/build/postgres-bin/macos-arm64/bin
cp "$SRC"/bin/{postgres,initdb,pg_ctl,pg_isready,pg_dump,psql} \
   desktop/build/postgres-bin/macos-arm64/bin/

# Shared libs they need
mkdir -p desktop/build/postgres-bin/macos-arm64/lib
cp -R "$SRC"/lib/{libpq.5.dylib,libssl.3.dylib,libcrypto.3.dylib,libxml2.*.dylib,libicui18n.*.dylib,libicuuc.*.dylib,libicudata.*.dylib} \
   desktop/build/postgres-bin/macos-arm64/lib/ 2>/dev/null || true
# Catch any others by inspecting otool output
otool -L desktop/build/postgres-bin/macos-arm64/bin/postgres
# Any /opt/homebrew/... or /usr/local/... paths in that output mean we need to vendor those too.

# Share dir (templates, locale, conversion data)
cp -R "$SRC"/share desktop/build/postgres-bin/macos-arm64/

du -sh desktop/build/postgres-bin/macos-arm64
# expect: ~50–80 MB
```

The `otool -L` output is the source of truth. Any dylib reference outside the standard system paths (`/usr/lib/system/...` is fine; `/opt/homebrew/...` or `/usr/local/...` is not) must be vendored, and the binary's load path rewritten:

```bash
install_name_tool -change /opt/homebrew/opt/openssl@3/lib/libssl.3.dylib \
  '@executable_path/../lib/libssl.3.dylib' \
  desktop/build/postgres-bin/macos-arm64/bin/postgres
# Repeat for every offending entry.
```

If this gets onerous, switch to the precompiled binaries from https://www.enterprisedb.com/download-postgresql-binaries (they ship self-contained zip distributions designed for embedding).

- [ ] **Step 3: Write `desktop/build/postgres-bin/README.md`**

```markdown
# Embedded Postgres binaries

These binaries are vendored from Postgres 17 (https://www.postgresql.org/),
PostgreSQL License (BSD-style). They are loaded by `PostgresManager` at
runtime. Per-platform subdirectories (`macos-arm64/`, `linux-x64/`, etc.)
are added as we add support for new install targets.

## Update procedure
1. Install the new Postgres release locally.
2. Copy `bin/{postgres,initdb,pg_ctl,pg_isready,pg_dump,psql}` and
   `lib/*.dylib` into the matching subdir.
3. Run `otool -L bin/postgres` and rewrite any external dylib paths via
   `install_name_tool` to `@executable_path/../lib/<name>`.
4. Copy `share/` verbatim.
5. Bump the major version constant in `PostgresManager.expectedVersion`.
6. Document migration steps for existing data directories in the release notes.
```

- [ ] **Step 4: Write failing tests for `PostgresManager`**

Create `desktop/main/tests/db/postgres-manager.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import pg from 'pg';
import {
  PostgresManager,
  postgresBinDir,
} from '../../src/db/postgres-manager.ts';

describe('PostgresManager', () => {
  let dataDir: string;
  let mgr: PostgresManager;

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'pgmgr-'));
    mgr = new PostgresManager({
      binDir: postgresBinDir(),
      dataDir,
      port: 54399, // pick something unlikely to clash
      superuser: 'nfr',
    });
  });

  afterAll(async () => {
    if (mgr.running) await mgr.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('initializes a fresh data directory if missing', async () => {
    await mgr.ensureInitialized();
    expect(existsSync(join(dataDir, 'PG_VERSION'))).toBe(true);
  }, 60_000);

  it('starts and accepts connections', async () => {
    await mgr.start();
    expect(mgr.running).toBe(true);
    const client = new pg.Client({
      connectionString: `postgres://nfr@127.0.0.1:54399/postgres`,
    });
    await client.connect();
    const r = await client.query('SELECT 1 as ok');
    expect(r.rows[0].ok).toBe(1);
    await client.end();
  }, 60_000);

  it('stops cleanly', async () => {
    await mgr.stop();
    expect(mgr.running).toBe(false);
  }, 30_000);

  it('detects a non-NFR data directory', async () => {
    const other = mkdtempSync(join(tmpdir(), 'pgmgr-other-'));
    const probe = new PostgresManager({
      binDir: postgresBinDir(),
      dataDir: other,
      port: 54398,
      superuser: 'nfr',
    });
    expect(await probe.isInitialized()).toBe(false);
    rmSync(other, { recursive: true, force: true });
  });
});
```

- [ ] **Step 5: Implement `desktop/main/src/db/postgres-manager.ts`**

```ts
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

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
  // From bundled app: <resources>/postgres-bin/macos-arm64
  // From dev: desktop/build/postgres-bin/macos-arm64
  if (process.resourcesPath) {
    const packaged = join(process.resourcesPath, 'postgres-bin', 'macos-arm64');
    if (existsSync(packaged)) return packaged;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'build', 'postgres-bin', 'macos-arm64');
}

export class PostgresManager {
  private child: ChildProcessWithoutNullStreams | null = null;
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

    const binInitdb = join(this.opts.binDir, 'bin', 'initdb');
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

    const binPostgres = join(this.opts.binDir, 'bin', 'postgres');
    const env = { ...process.env, ...this.libEnv() };

    this.child = spawn(
      binPostgres,
      ['-D', this.opts.dataDir, '-p', String(this.opts.port)],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    this.child.stderr.on('data', (d) => process.stderr.write(`[postgres] ${d}`));
    this.child.on('exit', (code, sig) => {
      if (code !== 0 && code !== null) {
        console.error(`postgres exited unexpectedly code=${code} signal=${sig}`);
      }
      this.child = null;
    });

    // Wait for pg_isready
    const binReady = join(this.opts.binDir, 'bin', 'pg_isready');
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const r = spawnSync(binReady, ['-h', '127.0.0.1', '-p', String(this.opts.port)], {
        env, stdio: 'pipe',
      });
      if (r.status === 0) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('postgres did not become ready within 20s');
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

  private libEnv(): NodeJS.ProcessEnv {
    return {
      DYLD_LIBRARY_PATH: join(this.opts.binDir, 'lib'),
      LD_LIBRARY_PATH: join(this.opts.binDir, 'lib'),
    };
  }
}
```

- [ ] **Step 6: Wire into `desktop/package.json`'s extraResources**

Add to the `build.extraResources` array:

```json
{ "from": "build/postgres-bin/macos-arm64", "to": "postgres-bin/macos-arm64" }
```

- [ ] **Step 7: Run the postgres-manager tests**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations/desktop
npm test main/tests/db/postgres-manager.test.ts
```

Expect 4 passing. The first run downloads nothing — these are local binaries.

- [ ] **Step 8: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add desktop/build/postgres-bin/ desktop/main/src/db/postgres-manager.ts \
        desktop/main/tests/db/postgres-manager.test.ts \
        desktop/package.json
git commit -m "feat(desktop): vendor Postgres 17 binaries + PostgresManager lifecycle"
```

(Yes, commit the binaries. They're version-controlled artifacts. ~70 MB on disk; acceptable for a project-local vendored toolchain. If repo size becomes a concern, switch to git-lfs in a follow-up.)

---

### Task 2: Database catalog model

**Purpose:** Track the active database + a list of recents in `app_config`. Expose endpoints to list / create / connect / switch / remove.

**Files:**
- Create: `desktop/main/src/db/catalog.ts`
- Create: `desktop/main/src/server/routes/catalog.ts`
- Create: `desktop/main/tests/db/catalog.test.ts`
- Modify: `desktop/main/src/server/app.ts` (register the route + add catalog dep)

The "catalog" is a JSON object stored under `app_config.data.databaseCatalog`:

```ts
interface CatalogEntry {
  name: string;        // user-friendly label
  path: string;        // absolute path to data dir
  volumeUuid?: string; // for portable detection across mount points
  lastUsed: string;    // ISO timestamp
}

interface Catalog {
  active: string | null;     // path of currently-active database
  entries: CatalogEntry[];
}
```

- [ ] **Step 1: Write failing tests for `catalog.ts`**

Create `desktop/main/tests/db/catalog.test.ts`. Tests cover: read empty catalog returns sane default, write+read round-trip, addEntry dedupes by path, switchActive validates entry exists, removeEntry preserves files (only forgets the path).

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { join } from 'path';
import { fileURLToPath } from 'url';
import {
  loadCatalog,
  addEntry,
  switchActive,
  removeEntry,
} from '../../src/db/catalog.ts';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../migrations'
);

describe('database catalog', () => {
  let db: ScratchDb;
  let pool: pg.Pool;

  beforeAll(async () => {
    db = await createScratchDb();
    await runMigrations(db.client, MIGRATIONS_DIR);
    pool = new pg.Pool({ connectionString: db.url, max: 3 });
  });

  afterAll(async () => {
    await pool.end();
    await db.drop();
  });

  it('returns an empty catalog by default', async () => {
    const cat = await loadCatalog(pool);
    expect(cat.active).toBeNull();
    expect(cat.entries).toEqual([]);
  });

  it('addEntry inserts and dedupes by path', async () => {
    await addEntry(pool, { name: 'A', path: '/p/a' });
    await addEntry(pool, { name: 'B', path: '/p/b' });
    await addEntry(pool, { name: 'A renamed', path: '/p/a' });
    const cat = await loadCatalog(pool);
    expect(cat.entries).toHaveLength(2);
    const a = cat.entries.find((e) => e.path === '/p/a')!;
    expect(a.name).toBe('A renamed');
  });

  it('switchActive sets the active path if it exists', async () => {
    await switchActive(pool, '/p/b');
    const cat = await loadCatalog(pool);
    expect(cat.active).toBe('/p/b');
  });

  it('switchActive throws on unknown path', async () => {
    await expect(switchActive(pool, '/p/nope')).rejects.toThrow(/not in catalog/i);
  });

  it('removeEntry forgets the path; clears active if it was active', async () => {
    await switchActive(pool, '/p/b');
    await removeEntry(pool, '/p/b');
    const cat = await loadCatalog(pool);
    expect(cat.entries.find((e) => e.path === '/p/b')).toBeUndefined();
    expect(cat.active).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `desktop/main/src/db/catalog.ts`**

```ts
import type pg from 'pg';
import { getAppConfig, setAppConfig } from './config.ts';

export interface CatalogEntry {
  name: string;
  path: string;
  volumeUuid?: string;
  lastUsed: string;
}

export interface Catalog {
  active: string | null;
  entries: CatalogEntry[];
}

const KEY = 'databaseCatalog';

export async function loadCatalog(pool: pg.Pool): Promise<Catalog> {
  const cfg = await getAppConfig(pool);
  const raw = cfg[KEY];
  if (raw && typeof raw === 'object' && 'entries' in (raw as any)) {
    return raw as Catalog;
  }
  return { active: null, entries: [] };
}

async function saveCatalog(pool: pg.Pool, cat: Catalog): Promise<void> {
  await setAppConfig(pool, { [KEY]: cat });
}

export async function addEntry(
  pool: pg.Pool,
  entry: Omit<CatalogEntry, 'lastUsed'> & { lastUsed?: string },
): Promise<void> {
  const cat = await loadCatalog(pool);
  const next = entry.lastUsed ?? new Date().toISOString();
  const existing = cat.entries.findIndex((e) => e.path === entry.path);
  const merged: CatalogEntry = {
    name: entry.name,
    path: entry.path,
    volumeUuid: entry.volumeUuid,
    lastUsed: next,
  };
  if (existing >= 0) cat.entries[existing] = merged;
  else cat.entries.push(merged);
  await saveCatalog(pool, cat);
}

export async function switchActive(pool: pg.Pool, path: string): Promise<void> {
  const cat = await loadCatalog(pool);
  const found = cat.entries.find((e) => e.path === path);
  if (!found) throw new Error(`path not in catalog: ${path}`);
  found.lastUsed = new Date().toISOString();
  cat.active = path;
  await saveCatalog(pool, cat);
}

export async function removeEntry(pool: pg.Pool, path: string): Promise<void> {
  const cat = await loadCatalog(pool);
  cat.entries = cat.entries.filter((e) => e.path !== path);
  if (cat.active === path) cat.active = null;
  await saveCatalog(pool, cat);
}
```

- [ ] **Step 3: Implement `desktop/main/src/server/routes/catalog.ts`**

Routes:
- `GET /api/db/catalog` → returns `{ active, entries: [...with health flags...] }`
- `POST /api/db/catalog/create` body `{ name, path }` → run initdb at `path`, add to catalog, switch active
- `POST /api/db/catalog/connect` body `{ name, path }` → verify path is an NFR DB, add to catalog, switch active
- `POST /api/db/catalog/switch` body `{ path }` → make active; signals orchestrator to restart Postgres + reload pool
- `POST /api/db/catalog/remove` body `{ path }` → forget (does NOT delete files)
- `POST /api/db/catalog/delete` body `{ path }` → forget AND `rm -rf` the data dir (require explicit second confirm flag)

Each mutating endpoint that affects the active DB returns `{ requiresRestart: true }`. The orchestrator handles the restart (similar to retry pattern from setup screen — `process.exit(0)` and Electron main relaunches).

Implementation skeleton (full code in subagent prompt):

```ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  loadCatalog, addEntry, switchActive, removeEntry,
} from '../../db/catalog.ts';
import { PostgresManager } from '../../db/postgres-manager.ts';
import { existsSync } from 'fs';
import { rm } from 'fs/promises';

export interface CatalogDeps {
  pool: pg.Pool;
  // ... initialize/connect helpers
}

export function registerCatalogRoutes(app: FastifyInstance, deps: CatalogDeps) {
  app.get('/api/db/catalog', async () => loadCatalog(deps.pool));
  // ... rest
}
```

(See full implementation in subagent dispatch when this task is executed.)

- [ ] **Step 4: Wire into `buildApp`**

Add `catalogDeps?: CatalogDeps` to `BuildAppOptions` in `desktop/main/src/server/app.ts`. Register the route when present.

- [ ] **Step 5: Run all tests**

```bash
cd desktop && npm test
```

Existing 55 tests + 4 manager + 5 catalog = 64 passing.

- [ ] **Step 6: Commit**

```bash
git add desktop/main/src/db/catalog.ts desktop/main/src/server/routes/catalog.ts \
        desktop/main/tests/db/catalog.test.ts desktop/main/src/server/app.ts
git commit -m "feat(desktop): database catalog (active + recents) with switch/create/connect endpoints"
```

---

### Task 3: First-launch Storage UI + Settings Storage section

**Purpose:** UI for choosing/managing the active database. First launch shows a friendly picker; ongoing management lives in Settings.

**Files:**
- Create: `app/src/pages/StorageSetup.tsx` (first-launch picker)
- Modify: `app/src/components/Storage.tsx` (Settings section — extracted from the existing Storage block)
- Modify: `app/src/pages/Settings.tsx` (mount the new Storage section)
- Modify: `app/src/App.tsx` (route to `/storage-setup` when no active DB)
- Modify: `app/src/routes.tsx` (register `/storage-setup`)

**First-launch flow (`StorageSetup.tsx`):**
- Loads `/api/db/catalog`. If `active === null` and `entries.length === 0`, shows the prompt.
- Two big buttons:
  - **USE DEFAULT LOCATION** → posts to `/api/db/catalog/create` with `name="Default"` and `path=<userData>/db`. Server initializes, switches active. Then process exits and Electron relaunches with the new DB.
  - **CHOOSE A FOLDER…** → uses Electron's `dialog.showOpenDialog` (exposed via preload) to pick a folder, then asks "create new" or "connect existing" if it looks like an existing data dir.

**Settings Storage section (`Storage.tsx`):**
- Top: "Active database" card — shows path, healthy/unhealthy status, basic stats.
- Middle: list of recent databases (entries from catalog) with `Switch` / `Remove` / `Delete files…` actions.
- Bottom: `+ CREATE NEW…` and `↗ CONNECT EXISTING…` buttons (same flows as first-launch).

The folder picker uses `electron.dialog` exposed via the preload script. We extend `desktop/preload/preload.ts` to expose:

```ts
contextBridge.exposeInMainWorld('__nfr__', {
  baseUrl: window.location.origin,
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
});
```

…and Electron main handles `'pick-folder'` via `dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })`.

In dev mode (browser, no Electron), `pickFolder` is undefined; fall back to a text input where the user types a path.

- [ ] (Tasks broken into Step 1: preload bridge + Electron handler, Step 2: StorageSetup page, Step 3: Storage.tsx component, Step 4: routing changes, Step 5: tests, Step 6: commit. Full implementation deferred to subagent dispatch.)

---

### Task 4: Orchestrator integration — embedded Postgres + active DB

**Purpose:** `index.ts` becomes responsible for starting the embedded Postgres pointed at the active data dir, and orchestrating the restart when the user switches DBs.

**Files:**
- Modify: `desktop/main/src/index.ts`
- Modify: `desktop/main/src/electron-main.ts` (auto-restart on `process.exit(0)`)

The new boot sequence in `run()`:

1. Read app config from a **bootstrap database** — a small always-present catalog DB at `<userData>/.nfr-catalog/db` that holds only `app_config`. We need a place to read the catalog from BEFORE we know which "real" DB to mount. The bootstrap DB is auto-created on first launch (its own initdb with just the catalog schema).
2. From bootstrap config, read `databaseCatalog.active`.
3. If null → server starts in "no active DB" mode, UI redirects to `/storage-setup`.
4. If non-null → check the path is reachable (volume mounted, has `PG_VERSION`). If not, server starts in "drive missing" mode, UI redirects to `/storage-setup` with a "drive disconnected" hint.
5. If reachable → start `PostgresManager` pointed at that path, run our app's migrations against it (using existing `bootstrapDatabase`), then everything else (parser, routes) as today.

When user switches active DB via `/api/db/catalog/switch`:
1. Server updates the bootstrap config.
2. Server returns `{ ok: true, restarting: true }`.
3. `process.exit(0)` after a short delay.
4. Electron main detects exit, relaunches `run()`.

The bootstrap DB is overhead but it solves the chicken-and-egg of "where do we read settings from before we know which DB to mount?" without storing settings on the filesystem outside Postgres.

Alternative considered: store the catalog in a JSON file at `<userData>/nfr-catalog.json` instead of in a bootstrap Postgres. Simpler. **Going with this.** Updates to the catalog are atomic file writes; no need for SQL.

Refined plan: replace "bootstrap DB" with `<userData>/nfr-catalog.json`. Server reads on boot, writes on switch. The active DB still holds everything else (sessions, signals, readings, app_config for non-catalog settings).

- [ ] (Steps to be detailed in subagent dispatch: refactor `index.ts`, add `<userData>` resolution helper, write JSON-catalog read/write, replace `app_config.databaseCatalog` with file-based catalog, restart-on-switch wiring.)

---

### Task 5: Drive-aware resilience

**Purpose:** When the active DB lives on an external drive that gets disconnected mid-session, fail gracefully.

**Files:**
- Create: `desktop/main/src/db/volume-watcher.ts`
- Modify: `desktop/main/src/index.ts` (consume the watcher)

`volume-watcher.ts` polls the active data dir's path every few seconds. When it disappears (or when the parent volume's UUID stops matching the recorded one), the watcher fires `disconnected`. Cheap and reliable on macOS where `/Volumes/X` simply vanishes when the drive is unplugged.

On `disconnected`:
1. Stop the parser (it's mid-write to a soon-to-be-stale fd).
2. Stop the embedded Postgres (best effort — SIGTERM, then SIGKILL after timeout).
3. Set a flag the server reports via `/api/setup/status` (`pg: storage_disconnected`).
4. UI redirects to `/storage-setup` with a clear "drive disconnected" message and a retry button.

On reconnect (via retry button or volume reappears):
- Server `process.exit(0)` → Electron relaunches → fresh boot finds the path again → resumes normally.

Volume UUID resolution (for "plug into different USB port → mounts at different path"): on macOS, `diskutil info -plist <volume>` returns a `VolumeUUID` field. We record that when the user adds a database to the catalog. On boot, if the configured path doesn't exist, we walk all mounted volumes via `diskutil list -plist`, find the one matching the UUID, and rewrite the path. Optional polish; ship without it first.

- [ ] (Steps in subagent dispatch.)

---

### Task 6: Restore Broadcast UI

**Purpose:** Bring back the "Broadcast on LAN" toggle + token + QR code that got dropped during the Settings rewrite.

**Files:**
- Create: `app/src/components/Broadcast.tsx`
- Modify: `app/src/pages/Settings.tsx` (mount the section)
- Modify: `app/src/App.tsx` (read broadcastEnabled to show LAN URL in header maybe? — optional)
- Modify: `desktop/main/src/index.ts` (read `broadcastEnabled` + bind 0.0.0.0 if true)
- Add dependency: `qrcode` (or a minimal QR-code component — pure SVG generator is ~5 KB)

Section layout:

```
BROADCAST ON LAN
  [ ] Enabled (requires server restart)

  When enabled, peers on this network can open the dashboard in any browser.
  Auth token is regenerated each time you turn this on.

  Connection details
  ┌──────────────────────────────────────┐
  │ http://192.168.1.42:4444/?key=xyz123 │
  │                                      │
  │ [QR code image]                      │
  │                                      │
  │ [ Copy URL ]   [ Regenerate token ]  │
  └──────────────────────────────────────┘
```

Server-side: when `app_config.broadcastEnabled === true`, `index.ts` binds `host = '0.0.0.0'` and reads `authToken` from config. Toggle changes require a restart (use the same `process.exit(0)` pattern).

For the LAN IP — `os.networkInterfaces()` returns all non-internal IPv4 addresses; pick the first one or let the user choose if there are multiple.

- [ ] (Steps in subagent dispatch.)

---

### Task 7: Repackage + integration smoke

**Files:** none — this is a verification task.

- [ ] Build the new DMG end-to-end:

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations

# 1. UI
cd app && npm run build && cd ..

# 2. Parser binary (unchanged)
cd parser && ./build.sh && cd ..

# 3. Embedded Postgres binaries — already vendored from Task 1

# 4. Build the DMG
cd desktop && npm run package
```

Expected output: `desktop/release/NFR Local-0.1.0-arm64.dmg`. Size grows from 114 MB → ~180 MB due to the embedded Postgres.

- [ ] **Manual smoke checklist** (each item, in order):

1. **Drag the new app to /Applications, replacing the old one. Right-click → Open to bypass Gatekeeper.**
2. **First-launch storage setup screen appears.** Click **USE DEFAULT LOCATION**.
3. **App boots into the live dashboard** with an empty signal catalog. Embedded Postgres is running at `~/Library/Application Support/NFR Local/db`.
4. **Import a session** via `↑ IMPORT NFR` → SINGLE FILE → pick a `.nfr`. Watch progress overlay → completes → session appears in the picker calendar.
5. **Settings → Storage:** active DB shows the default path with row counts. Click `+ CREATE NEW…`, pick `/Volumes/<external>/NFR-test/db` as the path. Server restarts, mounts the new DB. Live view loads with the new (empty) DB.
6. **Switch back** via Storage's recent list → click the default. Server restarts, loads the original DB. Imported sessions still there.
7. **Eject the external drive** while NOT on it. Verify Storage list still shows the entry but marks it "drive disconnected."
8. **Switch to the disconnected DB** → app shows the storage-setup screen with "drive disconnected" message + retry. Plug drive back in, click retry → app loads.
9. **Broadcast toggle:** Settings → Broadcast → enable. App restarts. Header shows the LAN URL. From a phone on the same WiFi, scan the QR code → dashboard loads.
10. **Quit cleanly.** Activity Monitor shows no zombie `postgres`, `node`, or `parser` processes.

- [ ] If any item fails, file a follow-up and fix before declaring Plan 6 done.

---

## Exit criteria for Plan 6

- `cd desktop && npm test` passes (~70 tests, including 4 PostgresManager + 5 catalog).
- `cd app && npm test` passes (no new tests in this plan, no regressions).
- The packaged `.dmg` includes `postgres-bin/macos-arm64/` and the parser binary.
- Fresh-install flow: drag, drop, open → storage setup → default location → working dashboard. **No Postgres install required by the user.**
- Settings Storage section can: create new, connect existing, switch, remove, delete files (with confirm).
- External-drive disconnect mid-session shows the disconnect screen instead of crashing.
- Broadcast toggle works: enabling binds `0.0.0.0`, generates a token, displays a QR code.
- Existing test infrastructure (Plan 1's scratch-DB harness) still uses host-installed Postgres — only end users see embedded Postgres. README updated to reflect this split.

After this plan, the README's "Prerequisites" section drops the "install Postgres locally" requirement. The app is fully self-contained: drag, drop, open, choose where data lives, done.
