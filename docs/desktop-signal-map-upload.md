# Desktop change needed: upload per-session signal map

**Status:** required for cloud-replay on the website to render any data.

**Owner:** whoever maintains `desktop/main/src/parquet/` and `desktop/main/src/cloud/upload.ts`.

## The problem

The website's replay path reads per-source Parquet files from DO Spaces and asks the cloud Supabase catalog (`signal_definitions`) to map signal IDs to names/units. But the cloud catalog assigns its own IDs, and the desktop writes Parquet files with **its own local** `signal_definitions.id` values — not the cloud IDs.

Concrete example (session `8ac70c7f-890b-55cd-9b00-7d98cb2dc313`):

- Cloud `signal_definitions.id = 42` → `Cell_T_10` (source `BMS_Temperatures_1`)
- `sessions/<id>/ECU.parquet` contains `signal_id = 42`
- ECU.parquet should only contain ECU signals — meaning the desktop's local `signal_definitions.id = 42` is some ECU signal, not `Cell_T_10`.

Cloud and desktop assigned different IDs to the same names. The edge function asks the parquet for "cloud_id=397" (the cloud's `APPS1_Throttle`) and gets zero rows because the parquet only has desktop IDs.

This is the same issue the live-stream path already solves in `desktop/main/src/cloud/live-stream.ts:87–108` — it builds a `local_id → cloud_id` map by joining on `(source, signal_name)` before pushing to `rt_readings`. The parquet upload path does no such translation, so cloud replay is broken for every uploaded session.

## What to change

Inside the upload step (e.g. `desktop/main/src/cloud/upload.ts`), after the parquets are written but before/while they are pushed to Spaces, upload one extra object per session:

- **Key:** `sessions/<session_id>/signal_map.json`
- **Body:**
  ```json
  {
    "session_id": "uuid",
    "signals": [
      { "local_id": 42, "source": "ECU", "name": "APPS1_Throttle" },
      { "local_id": 43, "source": "ECU", "name": "APPS2_Throttle" },
      { "local_id": 100, "source": "BMS", "name": "Cell_V_1" }
    ]
  }
  ```

Only signals that actually appear in this session's parquets need to be included (i.e. `DISTINCT signal_id` from `sd_readings WHERE session_id = $1`, joined to local `signal_definitions` for source + name). Including the full catalog is fine too — file size is tiny.

Implementation sketch (local Postgres query the writer can run alongside its existing per-source COPY):

```sql
SELECT DISTINCT sd.id AS local_id, sd.source, sd.signal_name AS name
FROM sd_readings r
JOIN signal_definitions sd ON sd.id = r.signal_id
WHERE r.session_id = $1
ORDER BY sd.source, sd.signal_name;
```

Stream the JSON to Spaces with `content-type: application/json` and the same public-read ACL the parquets use. No manifest update is strictly required — the edge function will just `fetch()` the file directly.

## Why this shape

- Edge function input is a cloud signal_id. It already knows cloud → (source, name) via `signal_definitions`. With `signal_map.json` in hand it can do (source, name) → local_id and filter the parquet by local_id.
- Doing the lookup in the edge function (not the database) keeps cloud DB writes off the upload critical path.
- A per-session file (not a global one) means each session is self-describing — useful if catalogs drift between desktops or over time.

## Edge function side (already shipped)

The cloud-side `signals-window` edge function in `supabase/functions/signals-window/` does the following:

1. Resolves the requested `signal_ids[]` to `(source, name)` via cloud `signal_definitions`.
2. For each unique source, fetches `sessions/<id>/signal_map.json`. If found, builds a `(source, name) → local_id` map and filters the per-source parquet by the corresponding local_ids.
3. If `signal_map.json` is missing, the function falls back to direct cloud_id matching (the current broken behavior). All sessions uploaded **before** this desktop change ships will continue to return empty until they're re-uploaded with a map.

So: ship the desktop change → new uploads start working → optionally re-upload (or backfill `signal_map.json` for) historical sessions to recover their replay.

## Backfill option

If you don't want to re-upload all the parquets, a small one-shot script that just generates and uploads `signal_map.json` per existing session is enough. The map only needs the desktop's `signal_definitions` table content (assuming that desktop still has the same catalog the parquets were written with). Pseudocode:

```ts
for (const session of allUploadedSessions) {
  const distinctIds = await pg.query(
    'SELECT DISTINCT signal_id FROM sd_readings WHERE session_id = $1',
    [session.id],
  );
  const defs = await pg.query(
    'SELECT id, source, signal_name FROM signal_definitions WHERE id = ANY($1)',
    [distinctIds.rows.map(r => r.signal_id)],
  );
  const body = JSON.stringify({
    session_id: session.id,
    signals: defs.rows.map(d => ({ local_id: d.id, source: d.source, name: d.signal_name })),
  });
  await spaces.putObject(`sessions/${session.id}/signal_map.json`, body, { contentType: 'application/json', acl: 'public-read' });
}
```

## Why not include this in the parquet itself

We considered writing `signal_name` directly into the parquet (an extra column) instead of `signal_id`, which would make parquets fully self-describing and avoid the sidecar entirely. That's a bigger change — every parquet schema and reader, including DuckDB on the desktop, would need updating — and it bloats parquet size since names repeat per row. A 1-file-per-session JSON sidecar is the smaller, more targeted fix.

## Test plan

1. Ship the desktop change.
2. Upload a fresh session.
3. `curl https://nfrinterface.sfo3.digitaloceanspaces.com/sessions/<id>/signal_map.json` — should be 200 with the expected JSON.
4. Open the website at `nfrinterface.com/app?session=<id>&mode=replay`, drag a signal onto a graph, confirm data renders.
