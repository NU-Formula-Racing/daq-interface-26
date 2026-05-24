import type { SupabaseClient } from '@supabase/supabase-js';

export interface CloudSession {
  id: string;
  date: string;
  totalBytes: number;
  contentHash: string;
  manifestKey: string;
  alreadyLocal: boolean;
}

export interface DayGroup {
  date: string;
  totalBytes: number;
  sessions: CloudSession[];
}

export async function listCloudSessionsGroupedByDay(
  sb: SupabaseClient,
  localIds: Set<string>,
): Promise<DayGroup[]> {
  const { data, error } = await sb.from('sessions')
    .select('id, date, total_bytes, content_hash, manifest_key')
    .order('date', { ascending: false });
  if (error) throw error;
  const groups = new Map<string, DayGroup>();
  for (const r of data ?? []) {
    if (!r.content_hash || !r.manifest_key) continue;
    const g = groups.get(r.date) ?? { date: r.date, totalBytes: 0, sessions: [] };
    const s: CloudSession = {
      id: r.id, date: r.date,
      totalBytes: Number(r.total_bytes ?? 0),
      contentHash: r.content_hash, manifestKey: r.manifest_key,
      alreadyLocal: localIds.has(r.id),
    };
    g.sessions.push(s);
    g.totalBytes += s.totalBytes;
    groups.set(r.date, g);
  }
  return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
}
