// Supabase Edge Function: signals-window
// Reads per-source Parquet files from DO Spaces, buckets server-side,
// returns the RpcRow shape the website expects.
//
// hyparquet alone doesn't decode ZSTD; the desktop writes ZSTD-compressed
// parquets, so hyparquet-compressors must be passed in. Without it, the
// decode throws "parquet unsupported compression codec: ZSTD" — and on
// larger files (e.g. 611KB BMS) the unhandled rejection hangs the isolate
// long enough to trip a gateway 503.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parquetReadObjects } from 'npm:hyparquet@1.17.1';
import { compressors } from 'npm:hyparquet-compressors@1.1.1';

interface Body {
  session_id: string;
  signal_ids: number[];
  start: string;
  end: string;
  bucket_secs: number;
}

interface RpcRow {
  ts: string;
  signal_id: number;
  signal_name: string;
  unit: string;
  value_min: number;
  value_max: number;
  value_avg: number;
  sample_n: number;
}

interface ParquetRow {
  timestamp: unknown;
  signal_id: number;
  value: number;
}

const SPACES_BASE = Deno.env.get('SPACES_PUBLIC_BASE')
  ?? 'https://nfrinterface.sfo3.digitaloceanspaces.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function fetchParquet(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status} ${res.statusText}`);
  return await res.arrayBuffer();
}

function rowTsMs(ts: unknown): number {
  // Desktop writes TIMESTAMP_MICROS (timestamp[us, UTC]). hyparquet returns
  // these as Date by default; the heuristic is a safety net for variants.
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'bigint') {
    const n = ts;
    if (n > 1_000_000_000_000_000_000n) return Number(n / 1_000_000n); // ns -> ms
    if (n > 1_000_000_000_000_000n)     return Number(n / 1_000n);     // us -> ms
    return Number(n);                                                   // ms
  }
  if (typeof ts === 'number') {
    if (ts > 1e18) return ts / 1_000_000; // ns -> ms
    if (ts > 1e15) return ts / 1_000;     // us -> ms
    if (ts > 1e12) return ts;             // ms
    return ts * 1000;                     // s -> ms
  }
  return Number(new Date(String(ts)).getTime());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('method', { status: 405, headers: CORS });

  let body: Body;
  try { body = await req.json() as Body; }
  catch { return new Response('bad json', { status: 400, headers: CORS }); }

  if (!body.session_id || !Array.isArray(body.signal_ids) || body.signal_ids.length === 0
      || !body.start || !body.end || !(body.bucket_secs > 0)) {
    return new Response('missing fields', { status: 400, headers: CORS });
  }

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: defs, error: defsErr } = await supa
    .from('signal_definitions')
    .select('id, signal_name, unit, source')
    .in('id', body.signal_ids);
  if (defsErr) return new Response(defsErr.message, { status: 500, headers: CORS });
  if (!defs || defs.length === 0) {
    return new Response('[]', { headers: { ...CORS, 'content-type': 'application/json' } });
  }

  const bySource = new Map<string, Set<number>>();
  for (const d of defs) {
    const safe = String(d.source).replace(/[^A-Za-z0-9_.-]/g, '_');
    const set = bySource.get(safe) ?? new Set<number>();
    set.add(d.id);
    bySource.set(safe, set);
  }
  if (bySource.size === 0) {
    return new Response('[]', { headers: { ...CORS, 'content-type': 'application/json' } });
  }

  const startMs = Date.parse(body.start);
  const endMs = Date.parse(body.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return new Response('bad start/end', { status: 400, headers: CORS });
  }
  const bucketMs = Math.trunc(body.bucket_secs * 1000);
  if (bucketMs < 1) {
    return new Response('bucket_secs too small', { status: 400, headers: CORS });
  }

  interface Agg { min: number; max: number; sum: number; n: number; }
  const aggs = new Map<string, Agg>();

  try {
    const tasks: Promise<void>[] = [];
    for (const [safe, idsSet] of bySource) {
      const url = `${SPACES_BASE}/sessions/${body.session_id}/${safe}.parquet`;
      tasks.push((async () => {
        try {
          const buf = await fetchParquet(url);
          const rows = await parquetReadObjects({ file: buf, compressors }) as ParquetRow[];
          for (const r of rows) {
            const sid = Number(r.signal_id);
            if (!idsSet.has(sid)) continue;
            const tsMs = rowTsMs(r.timestamp);
            if (tsMs < startMs || tsMs >= endMs) continue;
            const bStart = Math.floor(tsMs / bucketMs) * bucketMs;
            const key = `${bStart}|${sid}`;
            const v = Number(r.value);
            const a = aggs.get(key);
            if (a) {
              if (v < a.min) a.min = v;
              if (v > a.max) a.max = v;
              a.sum += v;
              a.n += 1;
            } else {
              aggs.set(key, { min: v, max: v, sum: v, n: 1 });
            }
          }
        } catch (e) {
          console.warn('signals-window: skip', url, String(e));
        }
      })());
    }
    await Promise.all(tasks);

    const defById = new Map(defs.map((d) => [d.id, d]));
    const out: RpcRow[] = [];
    for (const [key, a] of aggs) {
      const [bStartStr, sidStr] = key.split('|');
      const bStart = Number(bStartStr);
      const sid = Number(sidStr);
      const def = defById.get(sid);
      out.push({
        ts: new Date(bStart).toISOString(),
        signal_id: sid,
        signal_name: def?.signal_name ?? '',
        unit: def?.unit ?? '',
        value_min: a.min,
        value_max: a.max,
        value_avg: a.sum / a.n,
        sample_n: a.n,
      });
    }
    out.sort((x, y) => x.ts === y.ts ? x.signal_id - y.signal_id : (x.ts < y.ts ? -1 : 1));

    return new Response(JSON.stringify(out), {
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('signals-window parquet error', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'content-type': 'application/json' },
    });
  }
});
