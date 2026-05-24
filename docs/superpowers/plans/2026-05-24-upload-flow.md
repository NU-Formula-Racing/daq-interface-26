# Upload Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual desktop → DO Spaces upload flow that writes Parquet files for a session, verifies each upload byte-for-byte, dedups against any prior cloud copy, and only marks the local session synced after the cloud catalog row commits. Replaces the existing buggy "mark synced before verifying" sync path.

**Architecture:** A new `cloud/spaces.ts` module wraps the AWS S3 SDK pointed at the DO Spaces endpoint. A new `uploadSession()` orchestrator in `cloud/upload.ts` runs Parquet write → S3 PUT → HEAD/GET probe → manifest write → manifest readback → Supabase transactional insert → local `synced_at` update. A Fastify route exposes it per session. The Storage page's Local tab gets a multi-select + Upload button + per-row retry.

**Tech Stack:** TypeScript, `@aws-sdk/client-s3`, `@supabase/supabase-js` (already a dep), Fastify, React.

**Depends on:** Plan `2026-05-24-catalog-and-parquet-foundation.md` (Parquet writer, manifest, session_blobs).

---

## File Structure

**Create:**
- `desktop/main/src/cloud/spaces.ts` — DO Spaces (S3) client wrapper
- `desktop/main/src/cloud/spaces.test.ts`
- `desktop/main/src/cloud/upload.ts` — orchestration
- `desktop/main/src/cloud/upload.test.ts` — runs against MinIO container
- `desktop/main/src/cloud/supabase-catalog.ts` — transactional INSERT into sessions + session_blobs
- `desktop/main/src/server/routes/cloud-upload.ts` — POST /api/cloud/upload
- `app/src/components/StorageLocalTab.tsx` — Local tab UI
- `app/src/components/StorageLocalTab.test.tsx`

**Modify:**
- `desktop/package.json` — add `@aws-sdk/client-s3`
- `desktop/main/src/db/config.ts` — add Spaces config keys
- `desktop/main/src/server/app.ts` — register new route
- `app/src/components/Storage.tsx` — split into Local / Cloud tabs (Local only in this plan)
- `app/src/api/client.ts` — add `uploadSession(sessionId)` call

---

### Task 1: Add @aws-sdk/client-s3 + DO Spaces config

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop/main/src/db/config.ts`

- [ ] **Step 1: Install SDK**

```bash
cd desktop && npm install @aws-sdk/client-s3
```

- [ ] **Step 2: Add Spaces config keys**

In `desktop/main/src/db/config.ts`, extend the config schema with:
```ts
// DigitalOcean Spaces (S3-compatible) credentials. All four must be set
// for the cloud upload flow to be available.
spacesEndpoint: string | null;   // e.g. "https://nyc3.digitaloceanspaces.com"
spacesRegion: string | null;     // e.g. "us-east-1" (DO ignores but SDK requires)
spacesBucket: string | null;
spacesAccessKey: string | null;
spacesSecretKey: string | null;
```

Add the same fields to whatever defaults / setter helpers exist next to existing `supabaseUrl`/`supabaseAnonKey`.

- [ ] **Step 3: Commit**

```bash
git add desktop/package.json desktop/package-lock.json desktop/main/src/db/config.ts
git commit -m "cloud: add DO Spaces config and aws-sdk client-s3 dep"
```

---

### Task 2: Spaces client wrapper

**Files:**
- Create: `desktop/main/src/cloud/spaces.ts`
- Create: `desktop/main/src/cloud/spaces.test.ts`

- [ ] **Step 1: Write failing test (against MinIO)**

`spaces.test.ts` expects a MinIO endpoint at `MINIO_URL` (set in CI; for local, `docker run -p 9000:9000 -e MINIO_ROOT_USER=test -e MINIO_ROOT_PASSWORD=testtest minio/minio server /data`):

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeSpaces } from './spaces.ts';

const spaces = makeSpaces({
  endpoint: process.env.MINIO_URL!,
  region: 'us-east-1',
  bucket: 'test-bucket',
  accessKey: 'test',
  secretKey: 'testtest',
  forcePathStyle: true,
});

beforeAll(async () => { await spaces.ensureBucket(); });

describe('Spaces wrapper', () => {
  it('round-trips a small file with byte-equal verify', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sp-'));
    const local = join(dir, 'hello.bin');
    await writeFile(local, Buffer.from('hello world'));
    await spaces.putFile('greetings/hello.bin', local);
    const head = await spaces.head('greetings/hello.bin');
    expect(head.contentLength).toBe(11);
    const probe = await spaces.probeBytes('greetings/hello.bin', 0, 4);
    expect(probe.toString()).toBe('hell');
  });
});
```

- [ ] **Step 2: Run, expect fail**

`cd desktop && MINIO_URL=http://localhost:9000 npx vitest run main/src/cloud/spaces.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement spaces.ts**

```ts
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand,
  CreateBucketCommand, BucketAlreadyOwnedByYou, BucketAlreadyExists } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

export interface SpacesConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle?: boolean;
}

export interface SpacesClient {
  putFile: (key: string, localPath: string, contentType?: string) => Promise<void>;
  putBytes: (key: string, body: Buffer, contentType?: string) => Promise<void>;
  head: (key: string) => Promise<{ contentLength: number }>;
  getString: (key: string) => Promise<string>;
  probeBytes: (key: string, start: number, length: number) => Promise<Buffer>;
  ensureBucket: () => Promise<void>;
}

export function makeSpaces(cfg: SpacesConfig): SpacesClient {
  const s3 = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    forcePathStyle: cfg.forcePathStyle ?? false,
  });

  return {
    async putFile(key, localPath, contentType) {
      const st = await stat(localPath);
      await s3.send(new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: createReadStream(localPath),
        ContentLength: st.size,
        ContentType: contentType,
      }));
    },
    async putBytes(key, body, contentType) {
      await s3.send(new PutObjectCommand({
        Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType,
      }));
    },
    async head(key) {
      const r = await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
      return { contentLength: r.ContentLength ?? 0 };
    },
    async getString(key) {
      const r = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      return await r.Body!.transformToString();
    },
    async probeBytes(key, start, length) {
      const r = await s3.send(new GetObjectCommand({
        Bucket: cfg.bucket, Key: key, Range: `bytes=${start}-${start + length - 1}`,
      }));
      const arr = await r.Body!.transformToByteArray();
      return Buffer.from(arr);
    },
    async ensureBucket() {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
      } catch (e) {
        if (e instanceof BucketAlreadyOwnedByYou || e instanceof BucketAlreadyExists) return;
        throw e;
      }
    },
  };
}
```

- [ ] **Step 4: Run, expect pass**

`MINIO_URL=http://localhost:9000 npx vitest run main/src/cloud/spaces.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add desktop/main/src/cloud/spaces.ts desktop/main/src/cloud/spaces.test.ts
git commit -m "cloud: DO Spaces (S3) client wrapper"
```

---

### Task 3: Supabase catalog writer (transactional)

**Files:**
- Create: `desktop/main/src/cloud/supabase-catalog.ts`

- [ ] **Step 1: Implement and commit**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Manifest } from '../parquet/manifest.ts';

export class AlreadySyncedError extends Error {
  constructor(public existing: { uploaded_by_machine: string | null; uploaded_at: string | null }) {
    super('session already synced');
  }
}

export async function commitSessionToCatalog(
  sb: SupabaseClient,
  args: {
    sessionId: string;
    sessionRow: Record<string, unknown>;
    manifest: Manifest;
    totalBytes: number;
    machine: string;
  },
): Promise<void> {
  // Pre-check: if a row with this content_hash already exists, raise.
  const { data: existing, error: selErr } = await sb
    .from('sessions')
    .select('id, uploaded_by_machine, uploaded_at')
    .eq('content_hash', args.manifest.session_content_hash)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing && existing.id !== args.sessionId) {
    throw new AlreadySyncedError({
      uploaded_by_machine: existing.uploaded_by_machine,
      uploaded_at: existing.uploaded_at,
    });
  }

  // Upsert the session row with cloud bookkeeping columns.
  const sessionPayload = {
    ...args.sessionRow,
    id: args.sessionId,
    content_hash: args.manifest.session_content_hash,
    manifest_key: `sessions/${args.sessionId}/manifest.json`,
    total_bytes: args.totalBytes,
    uploaded_by_machine: args.machine,
    uploaded_at: new Date().toISOString(),
  };
  const { error: upErr } = await sb.from('sessions').upsert(sessionPayload, { onConflict: 'id' });
  if (upErr) {
    if ((upErr as { code?: string }).code === '23505') {
      throw new AlreadySyncedError({ uploaded_by_machine: null, uploaded_at: null });
    }
    throw upErr;
  }

  const blobRows = args.manifest.files.map((f) => ({
    session_id: args.sessionId,
    source: f.source,
    object_key: f.object_key,
    bytes: f.bytes,
    row_count: f.row_count,
    content_hash: f.sha256,
  }));
  const { error: bErr } = await sb.from('session_blobs').upsert(blobRows, {
    onConflict: 'session_id,source',
  });
  if (bErr) throw bErr;
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/main/src/cloud/supabase-catalog.ts
git commit -m "cloud: transactional supabase catalog writer with dedup check"
```

---

### Task 4: Upload orchestrator

**Files:**
- Create: `desktop/main/src/cloud/upload.ts`
- Create: `desktop/main/src/cloud/upload.test.ts`

- [ ] **Step 1: Write the failing test (uses MinIO + a local PG seeded session)**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { makeSpaces } from './spaces.ts';
import { uploadSession, AlreadySyncedError } from './upload.ts';

const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SID = '55555555-5555-5555-5555-555555555555';

beforeAll(async () => {
  await pool.query(`INSERT INTO signal_definitions (id, source, signal_name) VALUES
    (5001, 'PDM', 'V') ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO sessions (id, date, started_at, source) VALUES
    ($1, '2026-05-24', '2026-05-24T00:00:00Z', 'live') ON CONFLICT (id) DO NOTHING`, [SID]);
  await pool.query(`INSERT INTO sd_readings (ts, session_id, signal_id, value) VALUES
    ('2026-05-24T00:00:01Z', $1, 5001, 1.0),
    ('2026-05-24T00:00:02Z', $1, 5001, 2.0)`, [SID]);
});
afterAll(async () => {
  await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [SID]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [SID]);
  await sb.from('session_blobs').delete().eq('session_id', SID);
  await sb.from('sessions').delete().eq('id', SID);
  await pool.end();
});

const spaces = makeSpaces({
  endpoint: process.env.MINIO_URL!, region: 'us-east-1', bucket: 'test',
  accessKey: 'test', secretKey: 'testtest', forcePathStyle: true,
});

describe('uploadSession', () => {
  it('uploads, verifies, and marks synced exactly once', async () => {
    await spaces.ensureBucket();
    const r = await uploadSession({ sessionId: SID, pool, sb, spaces, machine: 'test-machine', pgConnStr: process.env.PG_TEST_URL! });
    expect(r.uploadedBytes).toBeGreaterThan(0);
    const { rows } = await pool.query('SELECT synced_at, content_hash FROM sessions WHERE id = $1', [SID]);
    expect(rows[0].synced_at).not.toBeNull();
    expect(rows[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws AlreadySyncedError on duplicate upload', async () => {
    await expect(
      uploadSession({ sessionId: SID, pool, sb, spaces, machine: 'other', pgConnStr: process.env.PG_TEST_URL! })
    ).rejects.toBeInstanceOf(AlreadySyncedError);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Expected: FAIL — `./upload.ts` missing.

- [ ] **Step 3: Implement upload.ts**

```ts
import type pg from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSessionParquet } from '../parquet/writer.ts';
import { buildManifest } from '../parquet/manifest.ts';
import { upsertBlob } from '../db/blobs.ts';
import { commitSessionToCatalog, AlreadySyncedError } from './supabase-catalog.ts';
import type { SpacesClient } from './spaces.ts';

export { AlreadySyncedError };

export interface UploadResult {
  uploadedBytes: number;
  files: number;
  contentHash: string;
}

export async function uploadSession(opts: {
  sessionId: string;
  pool: pg.Pool;
  sb: SupabaseClient;
  spaces: SpacesClient;
  machine: string;
  pgConnStr: string;
}): Promise<UploadResult> {
  const { sessionId, pool, sb, spaces, machine, pgConnStr } = opts;

  // 1. Read session row.
  const { rows: srows } = await pool.query(
    `SELECT id, date::text, started_at, ended_at, track, driver, car, notes,
            source, source_file, source_file_hash
     FROM sessions WHERE id = $1`,
    [sessionId],
  );
  if (srows.length === 0) throw new Error(`session ${sessionId} not found`);
  const sessionRow = srows[0];

  const dir = await mkdtemp(join(tmpdir(), `up-${sessionId}-`));
  try {
    // 2. Write parquet files locally.
    const files = await writeSessionParquet({ sessionId, outDir: dir, pgConnStr });
    if (files.length === 0) throw new Error('session has no readings');

    // 3. Build manifest.
    const manifestObjs = files.map((f) => ({
      source: f.source,
      objectKey: `sessions/${sessionId}/${f.source.replace(/[^A-Za-z0-9_.-]/g, '_')}.parquet`,
      bytes: f.bytes,
      rowCount: f.rowCount,
      sha256: f.sha256,
    }));
    const manifest = buildManifest({
      sessionId, createdAt: new Date().toISOString(), files: manifestObjs,
    });

    // 4. Dedup pre-check via Supabase.
    const { data: existing } = await sb.from('sessions')
      .select('id, uploaded_by_machine, uploaded_at')
      .eq('content_hash', manifest.session_content_hash).maybeSingle();
    if (existing && existing.id !== sessionId) {
      throw new AlreadySyncedError({
        uploaded_by_machine: existing.uploaded_by_machine,
        uploaded_at: existing.uploaded_at,
      });
    }

    // 5. Upload each Parquet, then verify.
    let totalBytes = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const key = manifestObjs[i].objectKey;
      await spaces.putFile(key, f.localPath, 'application/vnd.apache.parquet');
      const head = await spaces.head(key);
      if (head.contentLength !== f.bytes) {
        throw new Error(`upload size mismatch for ${key}: got ${head.contentLength}, want ${f.bytes}`);
      }
      // Probe first + last 16KB so a truncated body is caught cheaply.
      const probeLen = Math.min(16384, f.bytes);
      const head16 = await spaces.probeBytes(key, 0, probeLen);
      const tail16 = await spaces.probeBytes(key, Math.max(0, f.bytes - probeLen), probeLen);
      if (head16.length !== probeLen || tail16.length !== probeLen) {
        throw new Error(`probe length mismatch for ${key}`);
      }
      totalBytes += f.bytes;
    }

    // 6. Upload manifest.json.
    const manifestKey = `sessions/${sessionId}/manifest.json`;
    const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2));
    await spaces.putBytes(manifestKey, manifestBody, 'application/json');
    const mback = await spaces.getString(manifestKey);
    const parsed = JSON.parse(mback);
    if (parsed.session_content_hash !== manifest.session_content_hash) {
      throw new Error('manifest readback hash mismatch');
    }

    // 7. Commit to cloud catalog.
    await commitSessionToCatalog(sb, {
      sessionId, sessionRow, manifest, totalBytes, machine,
    });

    // 8. Mirror blobs locally + mark synced (only now).
    for (const m of manifest.files) {
      await upsertBlob(pool, {
        sessionId, source: m.source, objectKey: m.object_key,
        bytes: m.bytes, rowCount: m.row_count, contentHash: m.sha256,
      });
    }
    await pool.query(
      `UPDATE sessions SET
         synced_at = now(),
         content_hash = $2,
         manifest_key = $3,
         total_bytes = $4,
         uploaded_by_machine = $5,
         uploaded_at = now()
       WHERE id = $1`,
      [sessionId, manifest.session_content_hash, manifestKey, totalBytes, machine],
    );

    return { uploadedBytes: totalBytes, files: files.length, contentHash: manifest.session_content_hash };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run, expect pass**

`PG_TEST_URL=... MINIO_URL=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx vitest run main/src/cloud/upload.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add desktop/main/src/cloud/upload.ts desktop/main/src/cloud/upload.test.ts
git commit -m "cloud: verify-before-mark-synced upload orchestrator"
```

---

### Task 5: Fastify route

**Files:**
- Create: `desktop/main/src/server/routes/cloud-upload.ts`
- Modify: `desktop/main/src/server/app.ts`

- [ ] **Step 1: Implement route**

```ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import os from 'node:os';
import { makeSpaces } from '../../cloud/spaces.ts';
import { uploadSession, AlreadySyncedError } from '../../cloud/upload.ts';
import { getAppConfig } from '../../db/config.ts';

export function registerCloudUploadRoutes(app: FastifyInstance, pool: pg.Pool, pgConnStr: string) {
  app.post<{ Params: { id: string } }>('/api/cloud/upload/:id', async (req, reply) => {
    const cfg = await getAppConfig(pool);
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return reply.code(400).send({ error: 'supabase not configured' });
    if (!cfg.spacesEndpoint || !cfg.spacesBucket || !cfg.spacesAccessKey || !cfg.spacesSecretKey) {
      return reply.code(400).send({ error: 'spaces not configured' });
    }
    const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const spaces = makeSpaces({
      endpoint: cfg.spacesEndpoint, region: cfg.spacesRegion ?? 'us-east-1',
      bucket: cfg.spacesBucket, accessKey: cfg.spacesAccessKey, secretKey: cfg.spacesSecretKey,
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

- [ ] **Step 2: Register in app.ts**

Find the route-registration section of `desktop/main/src/server/app.ts` and add alongside the others:
```ts
import { registerCloudUploadRoutes } from './routes/cloud-upload.ts';
// ...
registerCloudUploadRoutes(app, pool, pgConnStr);
```

You may need to thread `pgConnStr` into `buildApp` — follow the existing pattern used by `registerSyncRoutes`.

- [ ] **Step 3: Smoke test the route**

Start the desktop dev server, then:
```bash
curl -X POST http://localhost:4444/api/cloud/upload/<session-id>
```
Expected: `{"status":"ok",...}` for a fresh session, `{"status":"already_synced",...}` on the second call.

- [ ] **Step 4: Commit**

```bash
git add desktop/main/src/server/routes/cloud-upload.ts desktop/main/src/server/app.ts
git commit -m "server: POST /api/cloud/upload/:id"
```

---

### Task 6: Frontend API helper

**Files:**
- Modify: `app/src/api/client.ts`

- [ ] **Step 1: Add uploadSession helper**

Append to `app/src/api/client.ts`:
```ts
export interface UploadResult {
  status: 'ok' | 'already_synced';
  uploadedBytes?: number;
  files?: number;
  contentHash?: string;
  existing?: { uploaded_by_machine: string | null; uploaded_at: string | null };
}

export async function uploadSession(sessionId: string): Promise<UploadResult> {
  const r = await fetch(`/api/cloud/upload/${sessionId}`, { method: 'POST' });
  const body = await r.json();
  if (r.status === 409) return { status: 'already_synced', existing: body.existing };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return { status: 'ok', ...body };
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/api/client.ts
git commit -m "app: uploadSession client helper"
```

---

### Task 7: StorageLocalTab component

**Files:**
- Create: `app/src/components/StorageLocalTab.tsx`
- Create: `app/src/components/StorageLocalTab.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StorageLocalTab } from './StorageLocalTab.tsx';

const sessions = [
  { id: 'a', date: '2026-05-20', synced_at: null, total_bytes: null },
  { id: 'b', date: '2026-05-21', synced_at: '2026-05-22T00:00:00Z', total_bytes: '12345' },
];

describe('StorageLocalTab', () => {
  it('uploads selected unsynced sessions and surfaces already-synced state', async () => {
    const upload = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', uploadedBytes: 100 });
    render(<StorageLocalTab sessions={sessions} uploadSession={upload} />);
    fireEvent.click(screen.getByLabelText('select-a'));
    fireEvent.click(screen.getByRole('button', { name: /upload selected/i }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith('a'));
    expect(screen.getByText(/uploaded/i)).toBeInTheDocument();
  });

  it('shows already-synced modal when API returns 409', async () => {
    const upload = vi.fn().mockResolvedValue({
      status: 'already_synced',
      existing: { uploaded_by_machine: 'other-mac', uploaded_at: '2026-05-23T00:00:00Z' },
    });
    render(<StorageLocalTab sessions={sessions} uploadSession={upload} />);
    fireEvent.click(screen.getByLabelText('select-a'));
    fireEvent.click(screen.getByRole('button', { name: /upload selected/i }));
    await waitFor(() => expect(screen.getByText(/already synced/i)).toBeInTheDocument());
    expect(screen.getByText('other-mac')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect fail**

`cd app && npx vitest run src/components/StorageLocalTab.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement StorageLocalTab.tsx**

```tsx
import { useState } from 'react';

export interface LocalSession {
  id: string;
  date: string;
  synced_at: string | null;
  total_bytes: string | null;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'ok'; bytes: number }
  | { kind: 'already_synced'; machine: string | null; at: string | null }
  | { kind: 'error'; message: string };

export interface StorageLocalTabProps {
  sessions: LocalSession[];
  uploadSession: (id: string) => Promise<{
    status: 'ok' | 'already_synced';
    uploadedBytes?: number;
    existing?: { uploaded_by_machine: string | null; uploaded_at: string | null };
  }>;
}

export function StorageLocalTab({ sessions, uploadSession }: StorageLocalTabProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [modal, setModal] = useState<Status & { kind: 'already_synced' } | null>(null);

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const uploadAll = async () => {
    for (const id of selected) {
      setStatuses((s) => ({ ...s, [id]: { kind: 'uploading' } }));
      try {
        const r = await uploadSession(id);
        if (r.status === 'already_synced') {
          const m = { kind: 'already_synced' as const,
            machine: r.existing?.uploaded_by_machine ?? null,
            at: r.existing?.uploaded_at ?? null };
          setStatuses((s) => ({ ...s, [id]: m }));
          setModal(m);
        } else {
          setStatuses((s) => ({ ...s, [id]: { kind: 'ok', bytes: r.uploadedBytes ?? 0 } }));
        }
      } catch (e) {
        setStatuses((s) => ({ ...s, [id]: { kind: 'error', message: (e as Error).message } }));
      }
    }
  };

  const retry = async (id: string) => {
    setStatuses((s) => ({ ...s, [id]: { kind: 'uploading' } }));
    try {
      const r = await uploadSession(id);
      setStatuses((s) => ({ ...s, [id]: r.status === 'ok'
        ? { kind: 'ok', bytes: r.uploadedBytes ?? 0 }
        : { kind: 'already_synced', machine: r.existing?.uploaded_by_machine ?? null, at: r.existing?.uploaded_at ?? null } }));
    } catch (e) {
      setStatuses((s) => ({ ...s, [id]: { kind: 'error', message: (e as Error).message } }));
    }
  };

  return (
    <div>
      <button onClick={uploadAll} disabled={selected.size === 0}>
        Upload selected
      </button>
      <table>
        <tbody>
          {sessions.map((s) => {
            const st = statuses[s.id]?.kind ?? 'idle';
            return (
              <tr key={s.id}>
                <td>
                  <input type="checkbox" aria-label={`select-${s.id}`}
                    checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                </td>
                <td>{s.date}</td>
                <td>{s.synced_at ? 'cloud + local' : 'local only'}</td>
                <td>
                  {st === 'uploading' && 'Uploading…'}
                  {st === 'ok' && <span>Uploaded</span>}
                  {st === 'error' && (
                    <span>
                      Error: {(statuses[s.id] as { kind: 'error'; message: string }).message}{' '}
                      <button onClick={() => retry(s.id)}>Retry</button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {modal && (
        <div role="dialog">
          <p>This session was already synced.</p>
          <p>By: <strong>{modal.machine ?? 'unknown'}</strong></p>
          <p>At: {modal.at ?? 'unknown'}</p>
          <button onClick={() => setModal(null)}>OK</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run, expect pass**

`cd app && npx vitest run src/components/StorageLocalTab.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/StorageLocalTab.tsx app/src/components/StorageLocalTab.test.tsx
git commit -m "app: StorageLocalTab with manual upload and retry"
```

---

### Task 8: Wire StorageLocalTab into Storage.tsx

**Files:**
- Modify: `app/src/components/Storage.tsx`

- [ ] **Step 1: Replace the existing local-sessions section**

Add a tab bar (`Local | Cloud`) and render `<StorageLocalTab sessions={...} uploadSession={uploadSession} />` for the Local tab. The Cloud tab placeholder reads "Coming soon — implemented in pull-flow plan." Keep all existing storage-setup controls untouched.

- [ ] **Step 2: Manual verification**

Run the desktop dev server and Vite dev for the app. Open the Storage page. Confirm:
- Local tab lists sessions with checkboxes
- Selecting a session and clicking Upload streams an upload (watch the desktop log)
- The session row shows "Uploaded" after the call returns
- A second upload of the same session opens the already-synced modal

- [ ] **Step 3: Commit**

```bash
git add app/src/components/Storage.tsx
git commit -m "app: integrate StorageLocalTab into Storage page"
```

---

## Self-Review Notes

- Spec §7 step 8 (mark synced after catalog commit) — Task 4, step 7→8 ordering ✓
- Spec §7 step 5 (HEAD verify + head/tail probe) — Task 4 explicit ✓
- Spec §7 step 3 (dedup modal) — Task 7 already-synced modal ✓
- Spec retry — Task 7 row-level Retry button + state.error ✓
- Naming consistency: `AlreadySyncedError`, `uploadSession`, `commitSessionToCatalog`, `makeSpaces` consistent across files ✓
- No TBDs, every step has real code.
