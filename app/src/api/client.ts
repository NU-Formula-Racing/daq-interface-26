const TOKEN_KEY = 'nfr_api_token';

function getToken(): string | null {
  // URL `?key=xxx` overrides localStorage on first visit.
  const fromUrl = new URLSearchParams(window.location.search).get('key');
  if (fromUrl) {
    localStorage.setItem(TOKEN_KEY, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(TOKEN_KEY);
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const token = getToken();
  if (token) url.searchParams.set('key', token);
  return url.pathname + url.search;
}

async function throwOnError(res: Response): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  throw new Error(`${res.status} ${res.statusText}: ${body}`);
}

export async function apiGet<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const res = await fetch(buildUrl(path, query));
  await throwOnError(res);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await throwOnError(res);
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await throwOnError(res);
  return res.json() as Promise<T>;
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(buildUrl(path), { method: 'DELETE' });
  await throwOnError(res);
}

export interface UploadResult {
  status: 'ok' | 'already_synced';
  uploadedBytes?: number;
  files?: number;
  contentHash?: string;
  existing?: { uploaded_by_machine: string | null; uploaded_at: string | null };
}

export interface CloudDayGroup {
  date: string;
  totalBytes: number;
  sessions: Array<{ id: string; date: string; totalBytes: number; alreadyLocal: boolean }>;
}

export async function listCloudSessions(): Promise<CloudDayGroup[]> {
  const r = await fetch(buildUrl('/api/cloud/sessions'));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function pullSessions(ids: string[]): Promise<{ results: Array<{ id: string; ok: boolean; error?: string; rowCount?: number }> }> {
  const r = await fetch(buildUrl('/api/cloud/pull'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function estimateLocalBytes(ids: string[]): Promise<number> {
  const r = await fetch(buildUrl('/api/local/estimate'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return (await r.json()).approxBytes;
}

export async function deleteLocalSessions(ids: string[]): Promise<{ approxBytesFreed: number }> {
  const r = await fetch(buildUrl('/api/local/delete'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return r.json();
}

export async function uploadSession(sessionId: string): Promise<UploadResult> {
  const r = await fetch(buildUrl(`/api/cloud/upload/${sessionId}`), { method: 'POST' });
  const body = await r.json();
  if (r.status === 409) return { status: 'already_synced', existing: body.existing };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return { status: 'ok', ...body };
}
