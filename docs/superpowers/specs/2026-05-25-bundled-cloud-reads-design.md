# Bundled Cloud Reads — Design

**Date:** 2026-05-25
**Status:** Draft for review

## 1. Problem

Right now a user installing the desktop `.dmg` for the first time has to manually paste five values into Settings → Cloud config (Supabase URL, anon key, DO Spaces endpoint, region, bucket, access key, secret key) before they can do anything cloud-related — including just pulling a session that a teammate already uploaded. For most users, the only cloud operation they will ever do is read: download a session and view it locally. Forcing every read-only consumer to set up write credentials is wrong by default.

Two facts make a better default possible:

- The DO Spaces bucket is configured public-read on every uploaded object (the desktop sets `ACL: 'public-read'` on every `PutObject`). Anyone on the internet who knows the URL can `curl` a session's Parquet.
- The Supabase anon key is *meant* to be a public token. It's how the web app authenticates from a browser today. Bundling it in the desktop is no more dangerous than putting it on a public Vercel deploy.

So the desktop should ship with the read credentials baked in. Users get the Cloud tab on first launch with zero configuration. The Settings panel only exists for the small subset of users who upload — and even they will rarely touch it after the first run.

## 2. Goals

- Any user who installs the .dmg can immediately open Storage → Cloud and pull sessions, with no Settings interaction required.
- Power users can still override the bundled defaults from Settings if they want to point at a different Supabase project or Spaces bucket (testing forks, secondary clouds, etc.).
- Read-only paths stop depending on the AWS S3 SDK — plain HTTPS fetch is enough and avoids signing every request.
- The "Upload all" / per-session upload buttons are hidden until Spaces *write* credentials are configured, since they don't work without them.

## 3. Non-goals

- The web app (Vercel) — a separate plan (`2026-05-24-web-duckdb-wasm-reads.md`) covers replacing the dropped Supabase RPCs with DuckDB-wasm + Parquet fetches.
- Rotating bundled credentials automatically. If the anon key ever needs to change, it's a rebuild + redistribute cycle.
- Enabling RLS on Supabase. Currently disabled (anon key has full read+write). Enabling RLS is a separate hardening project and not blocking this work.

## 4. How the two cloud systems are wired (and why it doesn't matter for this design)

Worth being explicit because it influences the design's loose coupling: **Supabase and DigitalOcean Spaces are not connected at the database level.** There is no Foreign Data Wrapper, no Supabase Storage integration to DO, no replication, no S3-fdw extension. They are two independent stores. Coordination lives in application code:

- Supabase Postgres holds the `sessions` and `session_blobs` tables. `session_blobs.object_key` is a string like `sessions/<uuid>/PDM.parquet`.
- DigitalOcean Spaces holds the actual byte content at exactly that key.
- The desktop reads a `session_blobs` row, then computes `<spacesPublicBase>/<object_key>` and fetches via HTTPS.

Because the bridge is just string concatenation in the client, swapping DO for Cloudflare R2 or Backblaze B2 later requires changing only the value of `spacesPublicBase`. Nothing in Supabase changes. This isolation is the reason the bundled-reads model works at all: a user only needs the Supabase anon key and the Spaces public URL — two unrelated strings — to read everything end to end.

## 5. Architecture

### 5.1 Defaults file

A single shipped resource at `desktop/build/cloud-defaults.json` containing the three read-side strings:

```json
{
  "supabaseUrl": "https://wbtlgbmddaxeqhdntnxa.supabase.co",
  "supabaseAnonKey": "eyJhbGciOiJI...",
  "spacesPublicBase": "https://nfrinterface.sfo3.digitaloceanspaces.com"
}
```

electron-builder copies this into `Contents/Resources/cloud-defaults.json` via the existing `extraResources` mechanism alongside the DBC CSV. At runtime the desktop locates it the same way it locates the DBC.

### 5.2 New module: `desktop/main/src/cloud/defaults.ts`

```ts
export interface CloudDefaults {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  spacesPublicBase: string | null;
}

export function loadCloudDefaults(resourcesDir: string): CloudDefaults;
```

Reads the JSON at boot. If the file is missing (dev mode without a build step that copied it), every field is null and the user falls back to the existing manual-input path.

### 5.3 Effective-config resolver

A new helper in `desktop/main/src/db/config.ts`:

```ts
export interface EffectiveCloudConfig {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  spacesPublicBase: string | null;
  spacesEndpoint: string | null;   // write-side
  spacesRegion: string | null;     // write-side
  spacesBucket: string | null;     // write-side
  spacesAccessKey: string | null;  // write-side
  spacesSecretKey: string | null;  // write-side
  cloudLiveEnabled: boolean;
}

export async function getEffectiveCloudConfig(
  pool: pg.Pool,
  defaults: CloudDefaults,
): Promise<EffectiveCloudConfig>;
```

Rule per field: user-set value wins; otherwise fall back to the bundled default. Write-side fields have no bundled defaults — they stay null until the user pastes them.

`spacesPublicBase` is derived: if the user supplied `spacesEndpoint`, `spacesBucket`, and `spacesRegion`, compose `https://<bucket>.<region>.digitaloceanspaces.com` from those. Otherwise use the bundled `spacesPublicBase`. This way users who point at a different bucket for *uploads* also automatically read from that bucket.

### 5.4 New module: `desktop/main/src/cloud/spaces-public.ts`

Plain HTTPS read client. Replaces the AWS-SDK-driven read paths in the pull flow:

```ts
export interface PublicSpaces {
  fetchManifest: (sessionId: string) => Promise<Manifest>;
  fetchToFile: (objectKey: string, localPath: string) => Promise<{ bytes: number; sha256: string }>;
  head: (objectKey: string) => Promise<{ contentLength: number }>;
}

export function makePublicSpaces(publicBase: string): PublicSpaces;
```

Uses Node's `fetch()` (available in Node 22) — no auth headers, no signing. Streams response bodies for big files. Computes SHA-256 incrementally while writing to disk so we don't have to re-read.

### 5.5 Pull flow refactor

`desktop/main/src/cloud/pull.ts` currently accepts a `SpacesClient` (the S3-SDK-backed one). Switch its parameter to a `PublicSpaces` instance. The session-fetch + verify logic stays identical — only the byte-source changes. The `cloud-pull.ts` route's wiring picks `makePublicSpaces(effectiveCfg.spacesPublicBase)` instead of `makeSpaces({...write-creds})`.

The upload flow keeps the existing `makeSpaces` path unchanged.

## 6. UI changes

### 6.1 Cloud tab works on first launch

`StorageCloudTab` already exists and queries `/api/cloud/sessions`. That route's internals get the new resolver — Supabase URL + anon key come from bundled defaults when the user hasn't set them. The tab will populate immediately on first launch with whatever the bundled Supabase has.

### 6.2 Cloud config panel reframed as write-only

The `<CloudConfig />` panel adds a top-of-section info row showing the bundled defaults read-only:

```
DEFAULT CLOUD (READ-ONLY)
  Supabase: https://wbtlgbmddaxeqhdntnxa.supabase.co
  Spaces:   https://nfrinterface.sfo3.digitaloceanspaces.com
```

The existing five "Spaces" inputs are reframed as **"Write credentials (optional — only needed if you're uploading)"** with a collapsed-by-default disclosure. The Supabase URL/anon-key inputs become an **"Override defaults"** disclosure, also collapsed. New users see a much simpler page.

### 6.3 Upload All hides without write creds

`<UploadAllButton />` already calls `/api/cloud/unsynced-summary` on render to know the count. The button now also checks the effective config: if `spacesSecretKey` isn't set, render nothing instead of the button. Add a small text note in `<StorageLocalTab />` *only* when there are unsynced sessions and no write creds: *"You have N unsynced sessions but no Spaces write credentials. Paste them in Settings to upload."*

The per-row "Upload selected" remains available with the same gating.

## 7. Data flow (end-to-end pull, first-time install)

1. User installs the .dmg, launches it. Boot reads `cloud-defaults.json`.
2. User opens Settings → Storage → Cloud tab. Frontend hits `GET /api/cloud/sessions`.
3. Route calls `getEffectiveCloudConfig(pool, defaults)`. Bundled Supabase URL + anon key are returned. No `app_config` row needs to exist.
4. Route builds a `SupabaseClient` from those, queries `sessions` + `session_blobs` for the catalog, returns to the frontend grouped by day.
5. User picks two days, clicks **Pull selected**. Frontend hits `POST /api/cloud/pull` with the session IDs.
6. Route loops sessions. For each, calls `pullSession({ publicSpaces: makePublicSpaces(spacesPublicBase), ... })`.
7. `pullSession` does plain `fetch()` against `<spacesPublicBase>/sessions/<uuid>/manifest.json`, then `fetch()` each Parquet listed in the manifest. SHA-256 verified against manifest values.
8. Rows imported into local Postgres `sd_readings`. Done.

Nothing about that flow touched the user's Settings or read a single user-entered string from `app_config`.

## 8. Error handling

- `cloud-defaults.json` missing or malformed at boot → log a warning, continue with empty defaults; user falls back to the existing "paste your own keys" path.
- `fetch()` returns non-2xx on a manifest or Parquet → propagate the HTTP status in the error message; the pull-flow's per-session error UI handles surfacing.
- `fetch()` succeeds but the body's SHA-256 doesn't match the catalog → already handled by existing pull-flow verification; transaction rolls back.

## 9. Security notes

- The Supabase anon key is a public key by design. It's reachable today by anyone visiting `https://wbtlgbmddaxeqhdntnxa.supabase.co` from a browser. Bundling it in the desktop is equivalent.
- RLS is disabled on the cloud `sessions` and `session_blobs` tables. With the bundled anon key, anyone who decompiles the .dmg can also *write* to those tables. This is the same exposure that exists today via the web app's env vars; not made worse by this design. Future work: enable RLS with policies that allow anon SELECT and require an authenticated role for INSERT/UPDATE/DELETE.
- The Spaces secret key is NOT bundled. Writes still require pasting it in Settings.
- All bundled values are visible to anyone with the .dmg. Don't bundle anything that isn't already meant to be public.

## 10. Testing

- **Unit: `loadCloudDefaults`.** Synthetic file + missing file + malformed file → returns expected null/value combinations.
- **Unit: `getEffectiveCloudConfig`.** Combinations of bundled + user-set values → asserts correct fallback rules including the `spacesPublicBase` derivation from endpoint/region/bucket.
- **Unit: `makePublicSpaces`.** Use `vi.mock('node:fetch')` or `msw` to assert URL composition, range request handling, SHA-256 streaming.
- **Integration: pull-flow.** Already covered by existing `pull.test.ts` but switch its fixture from MinIO+SDK to a local `http.createServer` serving fixture bytes — proves the public path works.
- **Manual: end-to-end smoke.** Clean install of the new .dmg on a machine that has never opened the desktop before → Cloud tab populates → pull a session → graphs render.

## 11. Rollout

1. Add `cloud-defaults.json` to `desktop/build/` (gitignored, see §13).
2. Implement `loadCloudDefaults` + `getEffectiveCloudConfig` + `makePublicSpaces`.
3. Refactor `pull.ts` and `cloud-pull.ts` route to use the public client.
4. Refactor `cloud-upload.ts` and `cloud-list.ts` routes to use the effective resolver (so reads work without user-set keys).
5. Update `<CloudConfig />` and `<StorageLocalTab />` UIs.
6. Build new .dmg; smoke test on a clean account.
7. Document the team workflow in README.md (already mostly written — add a note about read-out-of-the-box).

## 12. Open questions

None blocking. Possible follow-ups:

- **Bundled-defaults rotation.** If the Supabase project ever gets recreated, we ship a new .dmg. Could be made more dynamic (fetch defaults from a static URL at boot), but that's premature.
- **RLS hardening.** Separate project to enable RLS so a malicious actor who extracts the bundled anon key can't write to the catalog.

## 13. File layout reminder

The `cloud-defaults.json` lives at `desktop/build/cloud-defaults.json` and is `.gitignore`d (the values can be considered low-sensitivity-but-not-secret; we keep them out of git history for hygiene). A `cloud-defaults.example.json` next to it shows the schema, is committed. Developers populate the real file locally; CI/release builds get the real values injected from a build-time environment file. electron-builder picks it up via:

```
"extraResources": [
  ...,
  { "from": "build/cloud-defaults.json", "to": "cloud-defaults.json" }
]
```
