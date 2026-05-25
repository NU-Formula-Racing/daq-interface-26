# Bundled Cloud Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the desktop with Supabase URL + anon key + Spaces public URL baked in so any user can pull sessions from the cloud on first launch without pasting any credentials.

**Architecture:** A small `cloud-defaults.json` resource ships in the .app bundle (kept out of git for hygiene; an `.example.json` documents the schema). A new `loadCloudDefaults` reads it at boot; `getEffectiveCloudConfig` returns `userValue ?? bundled` per field. Reads route through a new HTTPS-only `PublicSpaces` client that needs no creds. Writes keep the existing S3-SDK path that needs Spaces access/secret keys; their UI hides itself when those keys aren't set.

**Tech Stack:** TypeScript, Node 22 (`fetch`, `crypto.createHash` for streaming SHA-256), Fastify, React 19.

---

## File Structure

**Create:**
- `desktop/build/cloud-defaults.example.json` — committed schema example
- `desktop/main/src/cloud/defaults.ts` — `loadCloudDefaults(resourcesDir)`
- `desktop/main/src/cloud/defaults.test.ts`
- `desktop/main/src/cloud/effective-config.ts` — `getEffectiveCloudConfig(pool, defaults)`
- `desktop/main/src/cloud/effective-config.test.ts`
- `desktop/main/src/cloud/spaces-public.ts` — anonymous HTTPS read client
- `desktop/main/src/cloud/spaces-public.test.ts`

**Modify:**
- `.gitignore` — add `desktop/build/cloud-defaults.json`
- `desktop/package.json` — `extraResources` includes `build/cloud-defaults.json`
- `desktop/main/src/cloud/pull.ts` — accept `PublicSpaces` param instead of `SpacesClient` for reads
- `desktop/main/src/server/routes/cloud-pull.ts` — wire `PublicSpaces` from effective config
- `desktop/main/src/server/routes/cloud-upload.ts` — read Supabase from effective config
- `desktop/main/src/server/routes/spaces-config.ts` — surface bundled defaults in status response
- `desktop/main/src/server/app.ts` — accept defaults in `BuildAppOptions`, thread to routes
- `desktop/main/src/index.ts` — load defaults, pass to `buildApp`
- `desktop/main/src/electron-main.ts` — locate `cloud-defaults.json` under `process.resourcesPath`
- `app/src/components/CloudConfig.tsx` — surface bundled defaults; collapse write inputs into disclosure
- `app/src/components/UploadAllButton.tsx` — hide when write creds absent
- `app/src/components/StorageLocalTab.tsx` — info banner when unsynced count > 0 and no write creds
- `README.md` — one-liner on bundled reads

---

### Task 1: `cloud-defaults.example.json` + gitignore

**Files:**
- Create: `desktop/build/cloud-defaults.example.json`
- Modify: `.gitignore`

- [ ] **Step 1: Write the example file**

```json
{
  "supabaseUrl": "https://YOUR-PROJECT.supabase.co",
  "supabaseAnonKey": "eyJ...",
  "spacesPublicBase": "https://YOUR-BUCKET.YOUR-REGION.digitaloceanspaces.com"
}
```

- [ ] **Step 2: Add to `.gitignore`**

Append at the end of `.gitignore` (above any final blank line):
```
# Bundled cloud read-defaults; copied into the .app at build time. Kept out of
# git history to avoid leaking rotation-able tokens by accident.
desktop/build/cloud-defaults.json
```

- [ ] **Step 3: Create a real local file for dev**

```bash
cp desktop/build/cloud-defaults.example.json desktop/build/cloud-defaults.json
# Edit to populate with the actual values:
#   - supabaseUrl  = your Supabase project URL
#   - supabaseAnonKey = anon key from Supabase API settings
#   - spacesPublicBase = https://<bucket>.<region>.digitaloceanspaces.com
```

- [ ] **Step 4: Verify gitignore works**

Run: `git status --short desktop/build/`
Expected: only `cloud-defaults.example.json` shows up (the real one is ignored).

- [ ] **Step 5: Commit**

```bash
git add desktop/build/cloud-defaults.example.json .gitignore
git commit -m "build: cloud-defaults.example.json + gitignore the real file"
```

---

### Task 2: `loadCloudDefaults` loader

**Files:**
- Create: `desktop/main/src/cloud/defaults.ts`
- Create: `desktop/main/src/cloud/defaults.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCloudDefaults } from './defaults.ts';

describe('loadCloudDefaults', () => {
  it('returns all-null when the file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cd-'));
    const d = loadCloudDefaults(dir);
    expect(d).toEqual({
      supabaseUrl: null, supabaseAnonKey: null, spacesPublicBase: null,
    });
  });

  it('parses present values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cd-'));
    await writeFile(join(dir, 'cloud-defaults.json'), JSON.stringify({
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'k',
      spacesPublicBase: 'https://b.r.digitaloceanspaces.com',
    }));
    const d = loadCloudDefaults(dir);
    expect(d.supabaseUrl).toBe('https://x.supabase.co');
    expect(d.supabaseAnonKey).toBe('k');
    expect(d.spacesPublicBase).toBe('https://b.r.digitaloceanspaces.com');
  });

  it('returns nulls for fields that are wrong type or empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cd-'));
    await writeFile(join(dir, 'cloud-defaults.json'), JSON.stringify({
      supabaseUrl: '', supabaseAnonKey: 42, spacesPublicBase: null,
    }));
    const d = loadCloudDefaults(dir);
    expect(d).toEqual({
      supabaseUrl: null, supabaseAnonKey: null, spacesPublicBase: null,
    });
  });

  it('returns all-null on malformed JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cd-'));
    await writeFile(join(dir, 'cloud-defaults.json'), 'not json');
    const d = loadCloudDefaults(dir);
    expect(d).toEqual({
      supabaseUrl: null, supabaseAnonKey: null, spacesPublicBase: null,
    });
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
cd desktop && npx vitest run main/src/cloud/defaults.test.ts
```
Expected: module not found.

- [ ] **Step 3: Implement**

```ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface CloudDefaults {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  spacesPublicBase: string | null;
}

const EMPTY: CloudDefaults = {
  supabaseUrl: null,
  supabaseAnonKey: null,
  spacesPublicBase: null,
};

function strField(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Read cloud-defaults.json from the given directory.
 *  Tolerates missing file / bad JSON / wrong types — anything that isn't a
 *  non-empty string for a known field becomes null. */
export function loadCloudDefaults(resourcesDir: string): CloudDefaults {
  const path = join(resourcesDir, 'cloud-defaults.json');
  if (!existsSync(path)) return { ...EMPTY };
  let raw: string;
  try { raw = readFileSync(path, 'utf-8'); }
  catch { return { ...EMPTY }; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return { ...EMPTY }; }
  const obj = (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {};
  return {
    supabaseUrl:      strField(obj.supabaseUrl),
    supabaseAnonKey:  strField(obj.supabaseAnonKey),
    spacesPublicBase: strField(obj.spacesPublicBase),
  };
}
```

- [ ] **Step 4: Run, expect pass**

```bash
cd desktop && npx vitest run main/src/cloud/defaults.test.ts
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add desktop/main/src/cloud/defaults.ts desktop/main/src/cloud/defaults.test.ts
git commit -m "cloud: loadCloudDefaults reads bundled cloud-defaults.json"
```

---

### Task 3: `getEffectiveCloudConfig` resolver

**Files:**
- Create: `desktop/main/src/cloud/effective-config.ts`
- Create: `desktop/main/src/cloud/effective-config.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { getEffectiveCloudConfig } from './effective-config.ts';

const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });

beforeAll(async () => {
  await pool.query(`UPDATE app_config SET data = '{}'::jsonb WHERE id = 1`);
});
afterAll(async () => {
  await pool.query(`UPDATE app_config SET data = '{}'::jsonb WHERE id = 1`);
  await pool.end();
});

describe('getEffectiveCloudConfig', () => {
  it('falls back to bundled defaults when user has set nothing', async () => {
    const eff = await getEffectiveCloudConfig(pool, {
      supabaseUrl: 'https://default.supabase.co',
      supabaseAnonKey: 'default-anon',
      spacesPublicBase: 'https://default.r.digitaloceanspaces.com',
    });
    expect(eff.supabaseUrl).toBe('https://default.supabase.co');
    expect(eff.supabaseAnonKey).toBe('default-anon');
    expect(eff.spacesPublicBase).toBe('https://default.r.digitaloceanspaces.com');
    expect(eff.spacesAccessKey).toBeNull();
    expect(eff.spacesSecretKey).toBeNull();
  });

  it('user-set values override bundled defaults', async () => {
    await pool.query(
      `UPDATE app_config SET data = $1::jsonb WHERE id = 1`,
      [JSON.stringify({
        supabaseUrl: 'https://override.supabase.co',
        spacesAccessKey: 'DO00abc',
        spacesSecretKey: 'secret',
        spacesEndpoint: 'https://sfo3.digitaloceanspaces.com',
        spacesRegion: 'sfo3',
        spacesBucket: 'custom-bucket',
      })],
    );
    const eff = await getEffectiveCloudConfig(pool, {
      supabaseUrl: 'https://default.supabase.co',
      supabaseAnonKey: 'default-anon',
      spacesPublicBase: 'https://default.r.digitaloceanspaces.com',
    });
    expect(eff.supabaseUrl).toBe('https://override.supabase.co');
    // anon key still bundled (user didn't set it)
    expect(eff.supabaseAnonKey).toBe('default-anon');
    // public base derived from user's endpoint/region/bucket, NOT bundled
    expect(eff.spacesPublicBase).toBe('https://custom-bucket.sfo3.digitaloceanspaces.com');
    expect(eff.spacesAccessKey).toBe('DO00abc');
    expect(eff.spacesSecretKey).toBe('secret');
  });

  it('returns nulls when neither user nor bundled has the value', async () => {
    await pool.query(`UPDATE app_config SET data = '{}'::jsonb WHERE id = 1`);
    const eff = await getEffectiveCloudConfig(pool, {
      supabaseUrl: null, supabaseAnonKey: null, spacesPublicBase: null,
    });
    expect(eff.supabaseUrl).toBeNull();
    expect(eff.supabaseAnonKey).toBeNull();
    expect(eff.spacesPublicBase).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
docker run --rm -d --name bcr-pg -p 5433:5432 \
  -e POSTGRES_PASSWORD=test -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=test \
  postgres:17
sleep 4
cd desktop && npx tsx -e "
import { runMigrations } from './main/src/db/migrate.ts';
import pg from 'pg';
(async () => {
  const c = new pg.Client({ connectionString: 'postgresql://postgres@localhost:5433/test' });
  await c.connect();
  await runMigrations(c, 'migrations');
  await c.end();
})();
"
PG_TEST_URL=postgresql://postgres@localhost:5433/test npx vitest run main/src/cloud/effective-config.test.ts
```
Expected: module not found.

- [ ] **Step 3: Implement**

```ts
import type pg from 'pg';
import { getAppConfig } from '../db/config.ts';
import type { CloudDefaults } from './defaults.ts';

export interface EffectiveCloudConfig {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  spacesPublicBase: string | null;
  spacesEndpoint: string | null;
  spacesRegion: string | null;
  spacesBucket: string | null;
  spacesAccessKey: string | null;
  spacesSecretKey: string | null;
  cloudLiveEnabled: boolean;
  /** Convenience: true iff all five Spaces write fields are populated. */
  spacesWriteReady: boolean;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export async function getEffectiveCloudConfig(
  pool: pg.Pool,
  defaults: CloudDefaults,
): Promise<EffectiveCloudConfig> {
  const cfg = await getAppConfig(pool);

  const userSupabaseUrl     = str(cfg.supabaseUrl);
  const userSupabaseAnonKey = str(cfg.supabaseAnonKey);
  const userSpacesEndpoint  = str(cfg.spacesEndpoint);
  const userSpacesRegion    = str(cfg.spacesRegion);
  const userSpacesBucket    = str(cfg.spacesBucket);
  const userSpacesAccess    = str(cfg.spacesAccessKey);
  const userSpacesSecret    = str(cfg.spacesSecretKey);

  // spacesPublicBase derivation: if the user provided endpoint+region+bucket,
  // compose from them so reads go to the user's bucket (matches where writes
  // go). Otherwise fall back to the bundled default.
  let spacesPublicBase: string | null = defaults.spacesPublicBase;
  if (userSpacesBucket && userSpacesRegion) {
    spacesPublicBase = `https://${userSpacesBucket}.${userSpacesRegion}.digitaloceanspaces.com`;
  }

  const spacesEndpoint = userSpacesEndpoint;
  const spacesRegion   = userSpacesRegion;
  const spacesBucket   = userSpacesBucket;
  const spacesAccessKey = userSpacesAccess;
  const spacesSecretKey = userSpacesSecret;
  const spacesWriteReady = !!(spacesEndpoint && spacesRegion && spacesBucket
    && spacesAccessKey && spacesSecretKey);

  return {
    supabaseUrl: userSupabaseUrl ?? defaults.supabaseUrl,
    supabaseAnonKey: userSupabaseAnonKey ?? defaults.supabaseAnonKey,
    spacesPublicBase,
    spacesEndpoint,
    spacesRegion,
    spacesBucket,
    spacesAccessKey,
    spacesSecretKey,
    cloudLiveEnabled: cfg.cloudLiveEnabled === true,
    spacesWriteReady,
  };
}
```

- [ ] **Step 4: Run, expect pass; tear down**

```bash
PG_TEST_URL=postgresql://postgres@localhost:5433/test npx vitest run main/src/cloud/effective-config.test.ts
docker rm -f bcr-pg
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add desktop/main/src/cloud/effective-config.ts desktop/main/src/cloud/effective-config.test.ts
git commit -m "cloud: getEffectiveCloudConfig merges bundled defaults with user overrides"
```

---

### Task 4: `PublicSpaces` client

**Files:**
- Create: `desktop/main/src/cloud/spaces-public.ts`
- Create: `desktop/main/src/cloud/spaces-public.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { makePublicSpaces } from './spaces-public.ts';

let server: http.Server;
let baseUrl: string;

const manifestBody = JSON.stringify({
  session_id: 'a', manifest_version: 1, files: [],
  session_content_hash: 'h',
});

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/sessions/abc/manifest.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(manifestBody);
      return;
    }
    if (req.method === 'GET' && req.url === '/sessions/abc/PDM.parquet') {
      res.writeHead(200, { 'content-type': 'application/octet-stream',
        'content-length': '5' });
      res.end(Buffer.from('hello'));
      return;
    }
    if (req.method === 'HEAD' && req.url === '/sessions/abc/PDM.parquet') {
      res.writeHead(200, { 'content-length': '5' });
      res.end();
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('makePublicSpaces', () => {
  it('fetches and parses a manifest', async () => {
    const ps = makePublicSpaces(baseUrl);
    const m = await ps.fetchManifest('abc');
    expect(m.session_id).toBe('a');
  });

  it('HEAD returns content length', async () => {
    const ps = makePublicSpaces(baseUrl);
    const { contentLength } = await ps.head('sessions/abc/PDM.parquet');
    expect(contentLength).toBe(5);
  });

  it('streams a parquet to disk and computes sha256', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sp-pub-'));
    const dest = join(dir, 'PDM.parquet');
    const ps = makePublicSpaces(baseUrl);
    const result = await ps.fetchToFile('sessions/abc/PDM.parquet', dest);
    expect(result.bytes).toBe(5);
    expect(result.sha256).toBe(
      createHash('sha256').update(Buffer.from('hello')).digest('hex'),
    );
    expect(await readFile(dest)).toEqual(Buffer.from('hello'));
  });

  it('throws on 404', async () => {
    const ps = makePublicSpaces(baseUrl);
    await expect(ps.fetchManifest('nope')).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
cd desktop && npx vitest run main/src/cloud/spaces-public.test.ts
```
Expected: module not found.

- [ ] **Step 3: Implement**

```ts
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { Manifest } from '../parquet/manifest.ts';
import { parseManifest } from '../parquet/manifest.ts';

export interface PublicSpaces {
  fetchManifest: (sessionId: string) => Promise<Manifest>;
  /** GET the object, stream to disk, return bytes + sha256. */
  fetchToFile: (objectKey: string, localPath: string) =>
    Promise<{ bytes: number; sha256: string }>;
  head: (objectKey: string) => Promise<{ contentLength: number }>;
}

export function makePublicSpaces(publicBase: string): PublicSpaces {
  const base = publicBase.replace(/\/$/, '');
  const url = (key: string) => `${base}/${key.replace(/^\//, '')}`;

  return {
    async fetchManifest(sessionId) {
      const u = url(`sessions/${sessionId}/manifest.json`);
      const r = await fetch(u);
      if (!r.ok) throw new Error(`${r.status} fetching ${u}`);
      return parseManifest(await r.text());
    },
    async fetchToFile(objectKey, localPath) {
      const u = url(objectKey);
      const r = await fetch(u);
      if (!r.ok) throw new Error(`${r.status} fetching ${u}`);
      if (!r.body) throw new Error(`empty body for ${u}`);
      const hash = createHash('sha256');
      let bytes = 0;
      const ws = createWriteStream(localPath);
      const src = Readable.fromWeb(r.body as unknown as import('stream/web').ReadableStream);
      src.on('data', (chunk: Buffer) => { hash.update(chunk); bytes += chunk.length; });
      await pipeline(src, ws);
      return { bytes, sha256: hash.digest('hex') };
    },
    async head(objectKey) {
      const u = url(objectKey);
      const r = await fetch(u, { method: 'HEAD' });
      if (!r.ok) throw new Error(`${r.status} HEAD ${u}`);
      const len = r.headers.get('content-length');
      return { contentLength: len ? Number(len) : 0 };
    },
  };
}
```

- [ ] **Step 4: Run, expect pass**

```bash
cd desktop && npx vitest run main/src/cloud/spaces-public.test.ts
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add desktop/main/src/cloud/spaces-public.ts desktop/main/src/cloud/spaces-public.test.ts
git commit -m "cloud: PublicSpaces — credential-free HTTPS read client"
```

---

### Task 5: Refactor `pull.ts` to accept `PublicSpaces`

**Files:**
- Modify: `desktop/main/src/cloud/pull.ts`

- [ ] **Step 1: Read the current file to confirm starting point**

```bash
sed -n '1,50p' desktop/main/src/cloud/pull.ts
```
The signature currently takes `spaces: SpacesClient` from `./spaces.ts`. We'll swap that for the new public client.

- [ ] **Step 2: Update the imports + signature**

In `desktop/main/src/cloud/pull.ts`:

Replace:
```ts
import type { SpacesClient } from './spaces.ts';
```
with:
```ts
import type { PublicSpaces } from './spaces-public.ts';
```

And the function param block — replace:
```ts
  spaces: SpacesClient;
```
with:
```ts
  spaces: PublicSpaces;
```

- [ ] **Step 3: Replace the byte-fetching block**

The current `pull.ts` step that downloads a Parquet calls `spaces.head` + `spaces.probeBytes(key, 0, f.bytes)` + writes the buffer to disk and computes SHA. Replace that whole block with `fetchToFile` which streams + hashes in one pass.

Find this block (around lines 60–75 of `pull.ts`):
```ts
    for (const f of manifest.files) {
      const local = join(dir, `${f.source.replace(/[^A-Za-z0-9_.-]/g, '_')}.parquet`);
      const head = await spaces.head(f.object_key);
      if (head.contentLength !== f.bytes) throw new Error(`${f.object_key}: size mismatch`);
      const body = await spaces.probeBytes(f.object_key, 0, f.bytes);
      await writeFile(local, body);
      const sha = createHash('sha256').update(await readFile(local)).digest('hex');
      if (sha !== f.sha256) throw new Error(`${f.object_key}: hash mismatch`);
      downloaded.push({ source: f.source, localPath: local, manifestEntry: f });
    }
```

Replace with:
```ts
    for (const f of manifest.files) {
      const local = join(dir, `${f.source.replace(/[^A-Za-z0-9_.-]/g, '_')}.parquet`);
      const { bytes, sha256 } = await spaces.fetchToFile(f.object_key, local);
      if (bytes !== f.bytes) throw new Error(`${f.object_key}: size mismatch`);
      if (sha256 !== f.sha256) throw new Error(`${f.object_key}: hash mismatch`);
      downloaded.push({ source: f.source, localPath: local, manifestEntry: f });
    }
```

Also delete the now-unused imports at the top: `createHash` from `node:crypto`, `writeFile, readFile` from `node:fs/promises`. Keep `mkdtemp, rm`.

- [ ] **Step 4: Replace the manifest-fetch call**

The current pull.ts has:
```ts
  const manifestRaw = await spaces.getString(sessRow.manifest_key);
  const manifest = parseManifest(manifestRaw);
```

Replace with (note we also no longer need `parseManifest` imported here since the public client returns a parsed `Manifest`):
```ts
  // sessRow.manifest_key looks like "sessions/<uuid>/manifest.json".
  // fetchManifest takes just the session id; derive it.
  const manifest = await spaces.fetchManifest(sessionId);
```

Drop the `parseManifest` import from `../parquet/manifest.ts` if no longer used.

- [ ] **Step 5: Run the existing pull tests, expect they still pass against the new shape**

The existing `pull.test.ts` uses the AWS SDK client. We'll update it in Task 6 where the public test infra is fully in place. For now just typecheck:

```bash
cd desktop && npx tsc --noEmit 2>&1 | grep -E "cloud/pull|spaces-public" | head -5
```
Expected: no type errors from our changes (the pre-existing `cloud/list.ts(36,21)` error is unrelated).

- [ ] **Step 6: Commit**

```bash
git add desktop/main/src/cloud/pull.ts
git commit -m "cloud: pull uses PublicSpaces for credential-free reads"
```

---

### Task 6: Update `pull.test.ts` to use a real HTTP server

**Files:**
- Modify: `desktop/main/src/cloud/pull.test.ts`

- [ ] **Step 1: Stand up an HTTP fixture in the test**

Replace the `makeSpaces` + MinIO bootstrap in the existing test file with the same pattern used in `spaces-public.test.ts`: spin up an in-process `http.createServer` that serves manifest + parquet files from a local temp dir. After `uploadSession` runs (which uses the real S3 SDK against MinIO), copy the resulting files from MinIO into the local HTTP server's served directory so the pull side reads from the public server.

This is a meaningful test rework — keep the assertions the same but replace the input-builder. If the existing test imports `makeSpaces` from `./spaces.ts`, switch to a hybrid:
- Keep MinIO for the upload half (writes still need S3 SDK).
- For the pull half, swap to `makePublicSpaces(baseUrl)` where `baseUrl` is the local fixture HTTP server.

The local server must serve `/sessions/<id>/manifest.json` and `/sessions/<id>/<source>.parquet` — easiest is to walk MinIO via the SDK after upload and pre-load the local dir, OR generate the manifest fixture inline.

Since the cleanest path is to mock just enough HTTP, rewrite the test header:

```ts
import http from 'node:http';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fixtureDir: string;
let fixtureBase: string;
let fixtureServer: http.Server;

beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'pull-fixture-'));
  fixtureServer = http.createServer((req, res) => {
    if (!req.url) { res.writeHead(404); return res.end(); }
    const path = join(fixtureDir, req.url);
    try {
      const body = readFileSync(path);
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'content-length': String(body.length) });
        res.end();
      } else {
        res.writeHead(200, { 'content-length': String(body.length) });
        res.end(body);
      }
    } catch {
      res.writeHead(404); res.end();
    }
  });
  await new Promise<void>((r) => fixtureServer.listen(0, '127.0.0.1', r));
  const addr = fixtureServer.address() as { port: number };
  fixtureBase = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => new Promise<void>((r) => fixtureServer.close(() => r())));
```

- [ ] **Step 2: After uploadSession completes, materialise the bytes into `fixtureDir`**

Right after `uploadSession(...)` returns, copy the objects from MinIO to the local fixture by re-reading them via the S3 client and writing to disk:

```ts
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

async function mirrorToFixture(sessionId: string) {
  const s3 = new S3Client({
    endpoint: process.env.MINIO_URL!, region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'testtest' },
    forcePathStyle: true,
  });
  const dir = join(fixtureDir, 'sessions', sessionId);
  mkdirSync(dir, { recursive: true });
  for (const key of ['manifest.json', 'PDM.parquet']) {
    const r = await s3.send(new GetObjectCommand({
      Bucket: 'test', Key: `sessions/${sessionId}/${key}`,
    }));
    const buf: Buffer[] = [];
    for await (const chunk of (r.Body as Readable)) buf.push(chunk as Buffer);
    writeFileSync(join(dir, key), Buffer.concat(buf));
  }
}
```

(In tests where the manifest lists more than one source, iterate manifest.files instead.)

- [ ] **Step 3: Update the `pullSession` call to use the public client**

```ts
import { makePublicSpaces } from './spaces-public.ts';
// ...
await mirrorToFixture(SID);
const r = await pullSession({
  sessionId: SID, pool, sb,
  spaces: makePublicSpaces(fixtureBase),
  pgConnStr: PG,
});
```

- [ ] **Step 4: Run the tests, expect the existing assertions still pass**

```bash
docker run --rm -d --name pull-fixture-pg -p 5433:5432 \
  -e POSTGRES_PASSWORD=test -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=test \
  postgres:17
sleep 4
docker run --rm -d --name pull-fixture-minio -p 9000:9000 \
  -e MINIO_ROOT_USER=test -e MINIO_ROOT_PASSWORD=testtest \
  minio/minio server /data
sleep 3
cd desktop && PG_TEST_URL=postgresql://postgres@localhost:5433/test \
  MINIO_URL=http://localhost:9000 \
  npx vitest run main/src/cloud/pull.test.ts
docker rm -f pull-fixture-pg pull-fixture-minio
```
Expected: 2 passed (round-trip + hash-mismatch).

- [ ] **Step 5: Commit**

```bash
git add desktop/main/src/cloud/pull.test.ts
git commit -m "cloud: pull.test uses local HTTP fixture (public path) instead of MinIO SDK"
```

---

### Task 7: Wire bundled defaults into `buildApp`

**Files:**
- Modify: `desktop/main/src/server/app.ts`

- [ ] **Step 1: Accept `cloudDefaults` in `BuildAppOptions`**

In `desktop/main/src/server/app.ts`:

Add the import:
```ts
import type { CloudDefaults } from '../cloud/defaults.ts';
```

Add the option to the `BuildAppOptions` interface (right above `uninstallDeps?:`):
```ts
  /** Read-only defaults baked into the .app, used as fallback when the user
   *  hasn't pasted their own creds. Null/missing fields fall back to manual
   *  entry via the Cloud config panel. */
  cloudDefaults?: CloudDefaults;
```

Default it inside the function:
```ts
  const cloudDefaults: CloudDefaults = opts.cloudDefaults ?? {
    supabaseUrl: null, supabaseAnonKey: null, spacesPublicBase: null,
  };
```

- [ ] **Step 2: Pass `cloudDefaults` to the route registrations**

Update the calls within `if (opts.pool) {` block:

```ts
    registerSpacesConfigRoutes(app, pool, cloudDefaults);
    registerUnsyncedSummaryRoutes(app, pool);
    if (opts.pgConnStr) {
      registerCloudUploadRoutes(app, pool, opts.pgConnStr, cloudDefaults);
      registerCloudPullRoutes(app, pool, opts.pgConnStr, cloudDefaults);
    }
```

The route signatures will be updated in later tasks.

- [ ] **Step 3: Typecheck**

```bash
cd desktop && npx tsc --noEmit 2>&1 | tail -5
```
Expected: type errors about `registerSpacesConfigRoutes`, `registerCloudUploadRoutes`, `registerCloudPullRoutes` not accepting the new arg — that's OK, fixed in the next tasks.

- [ ] **Step 4: Commit**

```bash
git add desktop/main/src/server/app.ts
git commit -m "server: thread cloudDefaults through buildApp"
```

---

### Task 8: Load defaults at boot and pass to `buildApp`

**Files:**
- Modify: `desktop/main/src/index.ts`
- Modify: `desktop/main/src/electron-main.ts`

- [ ] **Step 1: Add the resources-dir option to `run` and load defaults**

In `desktop/main/src/index.ts`:

Add the import:
```ts
import { loadCloudDefaults, type CloudDefaults } from './cloud/defaults.ts';
```

Add a new option to the `run` opts type:
```ts
  cloudDefaultsDir?: string;
```

Resolve it (near `const dbcCsv = ...`):
```ts
  const cloudDefaultsDir = opts.cloudDefaultsDir ?? REPO_ROOT;
  const cloudDefaults = loadCloudDefaults(cloudDefaultsDir);
```

Pass it to `buildApp`:
```ts
  const app = await buildApp({
    pool,
    parser: parser ?? undefined,
    authToken,
    setupState,
    staticRoot: opts.staticRoot,
    dbcStorePath,
    onDbcChanged: restartParser,
    onParserConfigChanged: restartParser,
    dsn: dsn ?? undefined,
    pgConnStr: dsn ?? undefined,
    onImport: runBatchImport,
    catalogDeps,
    broadcastDeps,
    cloudDefaults,
    uninstallDeps: {
      ...
    },
  });
```

- [ ] **Step 2: In Electron entrypoint, point at `process.resourcesPath`**

Edit `desktop/main/src/electron-main.ts`, in the `app.whenReady()` block, update the `run({...})` call:

```ts
    const booted = await run({
      dbcCsv: join(resources, 'NFR26DBC.csv'),
      migrationsDir: join(resources, 'migrations'),
      parserBinary: join(resources, 'parser', process.platform === 'win32' ? 'parser.exe' : 'parser'),
      staticRoot: join(resources, 'app'),
      cloudDefaultsDir: resources,
      userDataDir: app.getPath('userData'),
    });
```

- [ ] **Step 3: Smoke build to ensure it bundles**

```bash
cd desktop && node build/build-main.js 2>&1 | tail -3
```
Expected: `Done in ...ms`, no esbuild errors.

- [ ] **Step 4: Commit**

```bash
git add desktop/main/src/index.ts desktop/main/src/electron-main.ts
git commit -m "main: load cloud-defaults.json at boot, pass to buildApp"
```

---

### Task 9: Refactor cloud-upload route to use effective config

**Files:**
- Modify: `desktop/main/src/server/routes/cloud-upload.ts`

- [ ] **Step 1: Update the route to accept and use `cloudDefaults`**

Replace the contents of `desktop/main/src/server/routes/cloud-upload.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createClient } from '../../cloud/supabase-client.ts';
import os from 'node:os';
import { makeSpaces } from '../../cloud/spaces.ts';
import { uploadSession, AlreadySyncedError } from '../../cloud/upload.ts';
import type { CloudDefaults } from '../../cloud/defaults.ts';
import { getEffectiveCloudConfig } from '../../cloud/effective-config.ts';

export function registerCloudUploadRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  pgConnStr: string,
  cloudDefaults: CloudDefaults,
) {
  app.post<{ Params: { id: string } }>('/api/cloud/upload/:id', async (req, reply) => {
    const eff = await getEffectiveCloudConfig(pool, cloudDefaults);
    if (!eff.supabaseUrl || !eff.supabaseAnonKey) {
      return reply.code(400).send({ error: 'supabase not configured' });
    }
    if (!eff.spacesWriteReady) {
      return reply.code(400).send({
        error: 'spaces write credentials not configured (endpoint, region, bucket, access key, secret key)',
      });
    }
    const sb = createClient(eff.supabaseUrl, eff.supabaseAnonKey);
    const spaces = makeSpaces({
      endpoint: eff.spacesEndpoint!,
      region: eff.spacesRegion!,
      bucket: eff.spacesBucket!,
      accessKey: eff.spacesAccessKey!,
      secretKey: eff.spacesSecretKey!,
    });
    try {
      const r = await uploadSession({
        sessionId: req.params.id, pool, sb, spaces,
        machine: os.hostname(), pgConnStr,
      });
      return reply.send({ status: 'ok', ...r });
    } catch (e) {
      if (e instanceof AlreadySyncedError) {
        return reply.code(409).send({ status: 'already_synced', existing: e.existing });
      }
      req.log.error({ err: e }, 'cloud upload failed');
      return reply.code(500).send({ error: (e as Error).message });
    }
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
cd desktop && npx tsc --noEmit 2>&1 | grep cloud-upload
```
Expected: no errors from `cloud-upload.ts`.

- [ ] **Step 3: Commit**

```bash
git add desktop/main/src/server/routes/cloud-upload.ts
git commit -m "server: cloud-upload uses effective config (bundled-or-user)"
```

---

### Task 10: Refactor cloud-pull route to use PublicSpaces + effective config

**Files:**
- Modify: `desktop/main/src/server/routes/cloud-pull.ts`

- [ ] **Step 1: Rewrite the route**

Replace the contents of `desktop/main/src/server/routes/cloud-pull.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createClient } from '../../cloud/supabase-client.ts';
import { makePublicSpaces } from '../../cloud/spaces-public.ts';
import { listCloudSessionsGroupedByDay } from '../../cloud/list.ts';
import { pullSession } from '../../cloud/pull.ts';
import { deleteLocalSessionRows, estimateLocalBytes } from '../../db/local-delete.ts';
import type { CloudDefaults } from '../../cloud/defaults.ts';
import { getEffectiveCloudConfig } from '../../cloud/effective-config.ts';

export function registerCloudPullRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  pgConnStr: string,
  cloudDefaults: CloudDefaults,
) {
  async function readDeps() {
    const eff = await getEffectiveCloudConfig(pool, cloudDefaults);
    if (!eff.supabaseUrl || !eff.supabaseAnonKey || !eff.spacesPublicBase) {
      throw new Error('cloud read not configured (missing supabase URL/anon-key or spaces public base)');
    }
    return {
      sb: createClient(eff.supabaseUrl, eff.supabaseAnonKey),
      spaces: makePublicSpaces(eff.spacesPublicBase),
    };
  }

  app.get('/api/cloud/sessions', async () => {
    const { sb } = await readDeps();
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM sessions');
    const local = new Set(rows.map((r) => r.id));
    return await listCloudSessionsGroupedByDay(sb, local);
  });

  app.post<{ Body: { ids: string[] } }>('/api/cloud/pull', async (req, reply) => {
    const { sb, spaces } = await readDeps();
    const results: Array<{ id: string; ok: boolean; error?: string; rowCount?: number }> = [];
    for (const id of req.body.ids) {
      try {
        const r = await pullSession({ sessionId: id, pool, sb, spaces, pgConnStr });
        results.push({ id, ok: true, rowCount: r.rowCount });
      } catch (e) {
        results.push({ id, ok: false, error: (e as Error).message });
      }
    }
    return reply.send({ results });
  });

  app.post<{ Body: { ids: string[] } }>('/api/local/delete', async (req) => {
    const est = await estimateLocalBytes(pool, req.body.ids);
    await deleteLocalSessionRows(pool, req.body.ids);
    return { deleted: req.body.ids.length, approxBytesFreed: est };
  });

  app.post<{ Body: { ids: string[] } }>('/api/local/estimate', async (req) => {
    return { approxBytes: await estimateLocalBytes(pool, req.body.ids) };
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
cd desktop && npx tsc --noEmit 2>&1 | grep cloud-pull
```
Expected: no errors from `cloud-pull.ts`.

- [ ] **Step 3: Commit**

```bash
git add desktop/main/src/server/routes/cloud-pull.ts
git commit -m "server: cloud-pull uses PublicSpaces (no creds) + effective config"
```

---

### Task 11: Surface bundled defaults in cloud status endpoint

**Files:**
- Modify: `desktop/main/src/server/routes/spaces-config.ts`

- [ ] **Step 1: Update the route to take + reflect `cloudDefaults`**

Replace the contents of `desktop/main/src/server/routes/spaces-config.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getAppConfig, setAppConfig } from '../../db/config.ts';
import type { CloudDefaults } from '../../cloud/defaults.ts';
import { getEffectiveCloudConfig } from '../../cloud/effective-config.ts';

interface CloudStatus {
  // User-set values (never secrets — only string fields the user pasted)
  supabaseUrl: string | null;
  hasSupabaseAnonKey: boolean;
  spacesEndpoint: string | null;
  spacesRegion: string | null;
  spacesBucket: string | null;
  hasSpacesAccessKey: boolean;
  hasSpacesSecretKey: boolean;
  // Bundled defaults — informational, displayed read-only
  defaults: {
    supabaseUrl: string | null;
    hasSupabaseAnonKey: boolean;
    spacesPublicBase: string | null;
  };
  // Aggregate flags computed by the resolver
  spacesWriteReady: boolean;
  supabaseReadReady: boolean;
  spacesReadReady: boolean;
  cloudLiveEnabled: boolean;
}

const PLAIN_KEYS = [
  'supabaseUrl',
  'spacesEndpoint', 'spacesRegion', 'spacesBucket',
] as const;
const SECRET_KEYS = [
  'supabaseAnonKey',
  'spacesAccessKey', 'spacesSecretKey',
] as const;

export function registerSpacesConfigRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  cloudDefaults: CloudDefaults,
) {
  const buildStatus = async (): Promise<CloudStatus> => {
    const cfg = await getAppConfig(pool);
    const eff = await getEffectiveCloudConfig(pool, cloudDefaults);
    const str = (k: keyof typeof cfg) =>
      typeof cfg[k] === 'string' ? (cfg[k] as string) : null;
    const has = (k: keyof typeof cfg) =>
      typeof cfg[k] === 'string' && (cfg[k] as string).length > 0;

    return {
      supabaseUrl: str('supabaseUrl'),
      hasSupabaseAnonKey: has('supabaseAnonKey'),
      spacesEndpoint: str('spacesEndpoint'),
      spacesRegion: str('spacesRegion'),
      spacesBucket: str('spacesBucket'),
      hasSpacesAccessKey: has('spacesAccessKey'),
      hasSpacesSecretKey: has('spacesSecretKey'),
      defaults: {
        supabaseUrl: cloudDefaults.supabaseUrl,
        hasSupabaseAnonKey: !!cloudDefaults.supabaseAnonKey,
        spacesPublicBase: cloudDefaults.spacesPublicBase,
      },
      spacesWriteReady: eff.spacesWriteReady,
      supabaseReadReady: !!(eff.supabaseUrl && eff.supabaseAnonKey),
      spacesReadReady: !!eff.spacesPublicBase,
      cloudLiveEnabled: eff.cloudLiveEnabled,
    };
  };

  app.get('/api/cloud/status', buildStatus);
  app.get('/api/spaces/status', buildStatus);  // back-compat alias

  const savePatch = async (body: Record<string, unknown>) => {
    const patch: Record<string, unknown> = {};
    for (const k of [...PLAIN_KEYS, ...SECRET_KEYS]) {
      const v = body[k];
      if (typeof v === 'string' && v.length > 0) patch[k] = v;
    }
    if (typeof body.cloudLiveEnabled === 'boolean') {
      patch.cloudLiveEnabled = body.cloudLiveEnabled;
    }
    if (Object.keys(patch).length === 0) return { ok: true, noop: true };
    await setAppConfig(pool, patch);
    return { ok: true };
  };

  app.post<{ Body: Record<string, unknown> }>(
    '/api/cloud/config', async (req) => savePatch(req.body ?? {}),
  );
  app.post<{ Body: Record<string, unknown> }>(
    '/api/spaces/config', async (req) => savePatch(req.body ?? {}),
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd desktop && npx tsc --noEmit 2>&1 | grep spaces-config
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add desktop/main/src/server/routes/spaces-config.ts
git commit -m "server: cloud status surfaces bundled defaults + read/write ready flags"
```

---

### Task 12: Update CloudConfig UI for bundled-first ergonomics

**Files:**
- Modify: `app/src/components/CloudConfig.tsx`

- [ ] **Step 1: Update the `CloudStatus` type and add disclosures**

Replace the contents of `app/src/components/CloudConfig.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client.ts';

interface CloudStatus {
  supabaseUrl: string | null;
  hasSupabaseAnonKey: boolean;
  spacesEndpoint: string | null;
  spacesRegion: string | null;
  spacesBucket: string | null;
  hasSpacesAccessKey: boolean;
  hasSpacesSecretKey: boolean;
  defaults: {
    supabaseUrl: string | null;
    hasSupabaseAnonKey: boolean;
    spacesPublicBase: string | null;
  };
  spacesWriteReady: boolean;
  supabaseReadReady: boolean;
  spacesReadReady: boolean;
  cloudLiveEnabled: boolean;
}

const PLACEHOLDER_SET = '••••• (set)';

export function CloudConfig() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [spacesEndpoint, setSpacesEndpoint] = useState('');
  const [spacesRegion, setSpacesRegion] = useState('');
  const [spacesBucket, setSpacesBucket] = useState('');
  const [spacesAccessKey, setSpacesAccessKey] = useState('');
  const [spacesSecretKey, setSpacesSecretKey] = useState('');
  const [showWriteInputs, setShowWriteInputs] = useState(false);
  const [showSupabaseOverride, setShowSupabaseOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const refresh = () => {
    apiGet<CloudStatus>('/api/cloud/status').then(setStatus).catch(() => setStatus(null));
  };
  useEffect(() => { refresh(); }, []);

  const flashError = (msg: string) => { setInfo(''); setError(msg); setTimeout(() => setError(''), 8000); };
  const flashInfo  = (msg: string) => { setError(''); setInfo(msg);  setTimeout(() => setInfo(''),  6000); };

  const onSave = async () => {
    setBusy(true);
    try {
      const patch: Record<string, string> = {};
      if (supabaseUrl)     patch.supabaseUrl     = supabaseUrl.trim();
      if (supabaseAnonKey) patch.supabaseAnonKey = supabaseAnonKey.trim();
      if (spacesEndpoint)  patch.spacesEndpoint  = spacesEndpoint.trim();
      if (spacesRegion)    patch.spacesRegion    = spacesRegion.trim();
      if (spacesBucket)    patch.spacesBucket    = spacesBucket.trim();
      if (spacesAccessKey) patch.spacesAccessKey = spacesAccessKey.trim();
      if (spacesSecretKey) patch.spacesSecretKey = spacesSecretKey.trim();
      await apiPost('/api/cloud/config', patch);
      setSupabaseAnonKey('');
      setSpacesAccessKey('');
      setSpacesSecretKey('');
      flashInfo('Saved.');
      refresh();
    } catch (e) {
      flashError(`Save failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="border border-[color:var(--color-border)] p-4 space-y-3">
      <legend className="px-2 text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
        Cloud config
      </legend>

      {/* Default cloud (read-only display) */}
      <div className="space-y-2">
        <div className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
          DEFAULT CLOUD (READ-ONLY)
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div className="border border-[color:var(--color-border)]/60 px-2 py-1">
            <div className="text-[9px] tracking-widest text-[color:var(--color-text-mute)]">SUPABASE</div>
            <div className="truncate" title={status?.defaults.supabaseUrl ?? ''}>
              {status?.defaults.supabaseUrl ?? '—'}
            </div>
          </div>
          <div className="border border-[color:var(--color-border)]/60 px-2 py-1">
            <div className="text-[9px] tracking-widest text-[color:var(--color-text-mute)]">SPACES (PUBLIC URL)</div>
            <div className="truncate" title={status?.defaults.spacesPublicBase ?? ''}>
              {status?.defaults.spacesPublicBase ?? '—'}
            </div>
          </div>
        </div>
        <div className="text-[10px] text-[color:var(--color-text-mute)]">
          Reads work out of the box. The Cloud tab in Storage and the
          per-session pull flow will use these unless you override below.
        </div>
      </div>

      {/* Supabase override — collapsed by default */}
      <div className="border-t border-[color:var(--color-border)]/60 pt-3">
        <button
          onClick={() => setShowSupabaseOverride((v) => !v)}
          className="text-[10px] tracking-widest text-[color:var(--color-text-mute)] hover:text-[color:var(--color-text)]"
        >
          {showSupabaseOverride ? '▾' : '▸'} OVERRIDE SUPABASE (ADVANCED)
        </button>
        {showSupabaseOverride && (
          <div className="space-y-2 mt-2">
            <Field label="SUPABASE URL"
              value={supabaseUrl} setValue={setSupabaseUrl}
              placeholder={status?.supabaseUrl ?? 'https://xxx.supabase.co'} />
            <Field label="SUPABASE ANON KEY"
              value={supabaseAnonKey} setValue={setSupabaseAnonKey} secret
              placeholder={status?.hasSupabaseAnonKey ? PLACEHOLDER_SET : 'eyJ…'} />
          </div>
        )}
      </div>

      {/* Spaces write credentials — collapsed by default */}
      <div className="border-t border-[color:var(--color-border)]/60 pt-3">
        <button
          onClick={() => setShowWriteInputs((v) => !v)}
          className="text-[10px] tracking-widest text-[color:var(--color-text-mute)] hover:text-[color:var(--color-text)]"
        >
          {showWriteInputs ? '▾' : '▸'} WRITE CREDENTIALS (FOR UPLOADING)
        </button>
        {showWriteInputs && (
          <div className="space-y-2 mt-2">
            <Field label="ENDPOINT URL"
              value={spacesEndpoint} setValue={setSpacesEndpoint}
              placeholder={status?.spacesEndpoint ?? 'https://nyc3.digitaloceanspaces.com'} />
            <Field label="REGION SLUG"
              value={spacesRegion} setValue={setSpacesRegion}
              placeholder={status?.spacesRegion ?? 'nyc3'} />
            <Field label="BUCKET NAME"
              value={spacesBucket} setValue={setSpacesBucket}
              placeholder={status?.spacesBucket ?? 'nfr26-sessions'} />
            <Field label="ACCESS KEY ID"
              value={spacesAccessKey} setValue={setSpacesAccessKey} secret
              placeholder={status?.hasSpacesAccessKey ? PLACEHOLDER_SET : 'DO00…'} />
            <Field label="SECRET ACCESS KEY"
              value={spacesSecretKey} setValue={setSpacesSecretKey} secret
              placeholder={status?.hasSpacesSecretKey ? PLACEHOLDER_SET : '••••••••'} />
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-[11px] cursor-pointer pt-1">
        <input
          type="checkbox"
          checked={status?.cloudLiveEnabled ?? false}
          onChange={async (e) => {
            try {
              await apiPost('/api/cloud/config', { cloudLiveEnabled: e.target.checked });
              flashInfo(e.target.checked ? 'Live cloud stream enabled.' : 'Live cloud stream disabled.');
              refresh();
            } catch (err) { flashError(`Toggle failed: ${String(err)}`); }
          }}
          className="accent-[color:var(--color-accent)]"
        />
        <span>
          Stream live frames to Supabase <code>rt_readings</code> (truncated nightly).
          Takes effect on next desktop launch.
        </span>
      </label>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={busy}
          className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest disabled:opacity-50 hover:bg-[color:var(--color-bg)]"
        >
          {busy ? 'SAVING…' : 'SAVE'}
        </button>
        <span className="text-[10px] tracking-widest text-[color:var(--color-text-mute)] self-center">
          READ: {status?.supabaseReadReady && status?.spacesReadReady ? 'READY' : 'NOT READY'} ·{' '}
          WRITE: {status?.spacesWriteReady ? 'READY' : 'NOT READY'}
        </span>
      </div>

      {info && (
        <div className="text-[11px] text-[color:var(--color-text)] border border-[color:var(--color-border)] px-3 py-2">{info}</div>
      )}
      {error && (
        <div className="text-[11px] text-red-300 border border-red-700/50 px-3 py-2">{error}</div>
      )}
    </fieldset>
  );
}

function Field(props: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  placeholder: string;
  secret?: boolean;
}) {
  return (
    <label className="block text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
      {props.label}
      <input
        type={props.secret ? 'password' : 'text'}
        value={props.value}
        onChange={(e) => props.setValue(e.target.value)}
        placeholder={props.placeholder}
        autoComplete="off"
        className="mt-1 w-full bg-transparent border border-[color:var(--color-border)] px-2 py-1 text-[11px] font-mono"
      />
    </label>
  );
}
```

- [ ] **Step 2: Run app tests**

```bash
cd app && npx vitest run
```
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/CloudConfig.tsx
git commit -m "ui: CloudConfig surfaces bundled defaults; collapses write inputs by default"
```

---

### Task 13: Hide Upload All without write creds + info banner in Local tab

**Files:**
- Modify: `app/src/components/UploadAllButton.tsx`
- Modify: `app/src/components/StorageLocalTab.tsx`
- Modify: `app/src/api/client.ts`

- [ ] **Step 1: Add a typed `getCloudStatus` helper**

Append to `app/src/api/client.ts`:

```ts
export interface CloudStatusForUi {
  spacesWriteReady: boolean;
  supabaseReadReady: boolean;
  spacesReadReady: boolean;
}

export async function getCloudStatus(): Promise<CloudStatusForUi> {
  const r = await fetch('/api/cloud/status');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = await r.json();
  return {
    spacesWriteReady: !!body.spacesWriteReady,
    supabaseReadReady: !!body.supabaseReadReady,
    spacesReadReady: !!body.spacesReadReady,
  };
}
```

- [ ] **Step 2: Update `UploadAllButton.tsx` to hide when write not ready**

In `app/src/components/UploadAllButton.tsx`:

Add an extra prop:
```tsx
export interface UploadAllButtonProps {
  getSummary: () => Promise<Summary>;
  uploadSession: (id: string) => Promise<UploadResult>;
  onChanged: () => void;
  /** When false, render nothing — uploads can't work without write creds. */
  writeReady: boolean;
}
```

Inside the component, very early after the `if (!summary || summary.count === 0) return null;` check, also bail when not ready:
```tsx
  if (!props.writeReady) return null;
```

- [ ] **Step 3: Update `StorageLocalTab.tsx` to fetch status and gate the button + banner**

In `app/src/components/StorageLocalTab.tsx`:

Add imports:
```tsx
import { useEffect, useMemo, useState } from 'react';
import { getCloudStatus } from '../api/client.ts';
```

Add state:
```tsx
const [writeReady, setWriteReady] = useState(false);
useEffect(() => {
  getCloudStatus().then((s) => setWriteReady(s.spacesWriteReady)).catch(() => setWriteReady(false));
}, []);
```

Pass it to the button:
```tsx
<UploadAllButton
  getSummary={getUnsyncedSummary}
  uploadSession={apiUploadSession}
  onChanged={() => onChanged?.()}
  writeReady={writeReady}
/>
```

Add a banner above the table (only if there are unsynced sessions but no write creds). Find the spot just above `<table className="w-full text-[11px]">` and insert:

```tsx
{!writeReady && sessions.some((s) => !s.synced_at) && (
  <div className="text-[11px] border border-yellow-700/40 bg-yellow-900/10 px-3 py-2">
    You have unsynced sessions but no Spaces write credentials. Paste them
    under <strong>Settings → Cloud config → Write credentials</strong> to
    upload, or just leave them local.
  </div>
)}
```

- [ ] **Step 4: Update the existing `UploadAllButton.test.tsx`** to pass `writeReady` in both cases:

Edit the two `render(...)` calls to add `writeReady={true}`:
```tsx
render(<UploadAllButton
  getSummary={getSummary} uploadSession={upload} onChanged={onChanged} writeReady={true} />);
```

Also add one new test:
```tsx
it('renders nothing when writeReady is false', async () => {
  const getSummary = vi.fn().mockResolvedValue({
    count: 5, approxBytes: 100, sessionIds: ['a', 'b', 'c', 'd', 'e'],
  });
  render(<UploadAllButton getSummary={getSummary}
    uploadSession={vi.fn()} onChanged={vi.fn()} writeReady={false} />);
  await waitFor(() => expect(getSummary).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: /upload all/i })).toBeNull();
});
```

- [ ] **Step 5: Run app tests**

```bash
cd app && npx vitest run
```
Expected: all tests pass (12 + 1 new = 13).

- [ ] **Step 6: Commit**

```bash
git add app/src/api/client.ts app/src/components/UploadAllButton.tsx \
        app/src/components/UploadAllButton.test.tsx app/src/components/StorageLocalTab.tsx
git commit -m "ui: hide Upload All without write creds; show banner explaining why"
```

---

### Task 14: Add `cloud-defaults.json` to electron-builder extraResources

**Files:**
- Modify: `desktop/package.json`

- [ ] **Step 1: Find the existing `extraResources` array**

Open `desktop/package.json`. Locate the top-level `"extraResources":` inside `"build"`. It currently contains entries for app dist, migrations, parser, DBC.

- [ ] **Step 2: Add the new entry**

After the `NFR26DBC.csv` entry, add:

```json
{
  "from": "build/cloud-defaults.json",
  "to": "cloud-defaults.json"
}
```

Final block (illustrative, full thing):
```json
"extraResources": [
  { "from": "../app/dist", "to": "app" },
  { "from": "migrations", "to": "migrations" },
  { "from": "../parser/dist/parser", "to": "parser" },
  { "from": "../NFR26DBC.csv", "to": "NFR26DBC.csv" },
  { "from": "build/cloud-defaults.json", "to": "cloud-defaults.json" }
]
```

- [ ] **Step 3: Verify the file exists before building**

```bash
ls desktop/build/cloud-defaults.json
```
If missing, run the example copy from Task 1 Step 3.

- [ ] **Step 4: Rebuild the .dmg and verify the file lands in the bundle**

```bash
cd desktop && npm run package:mac 2>&1 | tail -3
unzip -l release/mac-arm64/nfrInterface.app/Contents/Resources/*.tar* 2>&1 | grep cloud-defaults || \
  ls -la release/mac-arm64/nfrInterface.app/Contents/Resources/ | grep cloud-defaults
```
Expected: `cloud-defaults.json` appears in Resources.

- [ ] **Step 5: Commit**

```bash
git add desktop/package.json
git commit -m "build: ship cloud-defaults.json with the .app"
```

---

### Task 15: README pointer

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a one-liner under the "Syncing data with the cloud" section**

In `README.md`, in the existing "Syncing data with the cloud" section, after the bullet about the merge/auto-truncate paragraph, add:

```markdown
- **First-time install:** the .app ships with read-only cloud defaults
  baked in (Supabase project URL + anon key + Spaces public URL). Just
  open the app, go to Settings → Storage → Cloud, and pull whatever days
  you need. No keys to paste. To upload (push), you do still need to paste
  Spaces access + secret keys under Settings → Cloud config → "Write
  credentials."
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: note that reads work out of the box with bundled defaults"
```

---

## Self-Review Notes

- Spec §4 (decoupling) — referenced explicitly in pull.ts and effective-config.ts: client composes URL from `<base>/<key>`. ✓
- Spec §5.1 (defaults file location) → Task 1 ships `cloud-defaults.example.json` at `desktop/build/`; Task 14 wires it into `extraResources`. ✓
- Spec §5.2 (loader) → Task 2 ✓
- Spec §5.3 (effective config + spacesPublicBase derivation) → Task 3, derivation tested. ✓
- Spec §5.4 (PublicSpaces client) → Task 4 ✓
- Spec §5.5 (pull refactor) → Tasks 5, 6, 10 ✓
- Spec §6.1 (Cloud tab works first launch) → Task 10 uses effective config so anon-only env works. ✓
- Spec §6.2 (reframed CloudConfig panel) → Task 12 ✓
- Spec §6.3 (UploadAll hide + banner) → Task 13 ✓
- Spec §7 (data flow) — covered by Task 10 + Task 3 + Task 4 ✓
- Spec §8 (error handling) — `loadCloudDefaults` returns nulls on bad files (Task 2 tests cover three failure shapes); routes return 400 when prerequisites missing (Task 9 + 10). ✓
- Spec §9 (security notes) — RLS note documented in spec; not in scope for plan. ✓
- Spec §10 (testing) — unit tests for loader (Task 2), resolver (Task 3), public client (Task 4), pull integration retooled with HTTP fixture (Task 6); UI hide-when-unready test (Task 13). ✓
- Spec §11 (rollout) — task order matches: defaults file → loader → resolver → public client → pull refactor → routes → UI → bundle → README.
- Spec §13 (file layout reminder) → Task 1 + Task 14 ✓
- No TBDs. Every code step shows real code. Function names stay consistent: `loadCloudDefaults`, `getEffectiveCloudConfig`, `makePublicSpaces`, `CloudDefaults`, `EffectiveCloudConfig`, `PublicSpaces` across all tasks.
