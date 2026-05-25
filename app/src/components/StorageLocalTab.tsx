import { useEffect, useMemo, useState } from 'react';
import { UploadAllButton } from './UploadAllButton.tsx';
import { getUnsyncedSummary, uploadSession as apiUploadSession, getCloudStatus } from '../api/client.ts';

export interface LocalSession {
  id: string;
  date: string;
  synced_at: string | null;
  total_bytes: string | null;
}

type RowStatus =
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
  /** Optional — if provided, the "Delete local copy" action is enabled. */
  estimateLocalBytes?: (ids: string[]) => Promise<number>;
  deleteLocalSessions?: (ids: string[]) => Promise<unknown>;
  onChanged?: () => void;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function StorageLocalTab(props: StorageLocalTabProps) {
  const { sessions, uploadSession, estimateLocalBytes, deleteLocalSessions, onChanged } = props;
  const [writeReady, setWriteReady] = useState(false);
  useEffect(() => {
    getCloudStatus().then((s) => setWriteReady(s.spacesWriteReady)).catch(() => setWriteReady(false));
  }, []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
  const [syncedModal, setSyncedModal] =
    useState<{ machine: string | null; at: string | null } | null>(null);
  const [deleteConfirm, setDeleteConfirm] =
    useState<{ ids: string[]; approxBytes: number } | null>(null);

  // Group sessions by date so a user who parsed a whole day with the wrong DBC
  // can wipe the day in one shot.
  const byDate = useMemo(() => {
    const map = new Map<string, LocalSession[]>();
    for (const s of sessions) {
      const arr = map.get(s.date) ?? [];
      arr.push(s);
      map.set(s.date, arr);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [sessions]);

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const toggleDay = (date: string) => {
    const ids = byDate.find(([d]) => d === date)?.[1].map((s) => s.id) ?? [];
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (allSelected) next.delete(id); else next.add(id);
      }
      return next;
    });
  };

  const uploadAll = async () => {
    for (const id of selected) {
      setStatuses((s) => ({ ...s, [id]: { kind: 'uploading' } }));
      try {
        const r = await uploadSession(id);
        if (r.status === 'already_synced') {
          const m = {
            machine: r.existing?.uploaded_by_machine ?? null,
            at: r.existing?.uploaded_at ?? null,
          };
          setStatuses((s) => ({ ...s, [id]: { kind: 'already_synced', ...m } }));
          setSyncedModal(m);
        } else {
          setStatuses((s) => ({ ...s, [id]: { kind: 'ok', bytes: r.uploadedBytes ?? 0 } }));
        }
      } catch (e) {
        setStatuses((s) => ({ ...s, [id]: { kind: 'error', message: (e as Error).message } }));
      }
    }
    onChanged?.();
  };

  const retry = async (id: string) => {
    setStatuses((s) => ({ ...s, [id]: { kind: 'uploading' } }));
    try {
      const r = await uploadSession(id);
      setStatuses((s) => ({
        ...s,
        [id]: r.status === 'ok'
          ? { kind: 'ok', bytes: r.uploadedBytes ?? 0 }
          : { kind: 'already_synced',
              machine: r.existing?.uploaded_by_machine ?? null,
              at: r.existing?.uploaded_at ?? null },
      }));
    } catch (e) {
      setStatuses((s) => ({ ...s, [id]: { kind: 'error', message: (e as Error).message } }));
    }
  };

  const askDelete = async () => {
    if (!estimateLocalBytes || !deleteLocalSessions) return;
    const ids = [...selected];
    if (ids.length === 0) return;
    let approxBytes = 0;
    try { approxBytes = await estimateLocalBytes(ids); } catch { /* best-effort estimate */ }
    setDeleteConfirm({ ids, approxBytes });
  };

  const doDelete = async () => {
    if (!deleteConfirm || !deleteLocalSessions) return;
    try {
      await deleteLocalSessions(deleteConfirm.ids);
      setSelected(new Set());
      setDeleteConfirm(null);
      onChanged?.();
    } catch (e) {
      setDeleteConfirm(null);
      alert(`Delete failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-3">
      <UploadAllButton
        getSummary={getUnsyncedSummary}
        uploadSession={apiUploadSession}
        onChanged={() => onChanged?.()}
        writeReady={writeReady}
      />
      <div className="flex gap-2">
        <button
          onClick={uploadAll}
          disabled={selected.size === 0}
          className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest disabled:opacity-50 hover:bg-[color:var(--color-bg)]"
        >
          UPLOAD SELECTED ({selected.size})
        </button>
        {deleteLocalSessions && (
          <button
            onClick={askDelete}
            disabled={selected.size === 0}
            className="px-3 py-1.5 border border-red-700/60 text-red-200 text-[11px] tracking-widest disabled:opacity-50 hover:bg-red-900/20"
          >
            DELETE LOCAL ({selected.size})
          </button>
        )}
      </div>

      {!writeReady && sessions.some((s) => !s.synced_at) && (
        <div className="text-[11px] border border-yellow-700/40 bg-yellow-900/10 px-3 py-2">
          You have unsynced sessions but no Spaces write credentials. Paste them
          under <strong>Settings → Cloud config → Write credentials</strong> to
          upload, or just leave them local.
        </div>
      )}

      <table className="w-full text-[11px]">
        <tbody>
          {byDate.map(([date, daySessions]) => {
            const dayIds = daySessions.map((s) => s.id);
            const allDaySelected = dayIds.every((id) => selected.has(id));
            const someDaySelected = !allDaySelected && dayIds.some((id) => selected.has(id));
            return (
              <>
                <tr key={`hdr-${date}`} className="bg-[color:var(--color-bg)]">
                  <td colSpan={4} className="py-1 px-2 border-b border-[color:var(--color-border)]">
                    <label className="inline-flex items-center gap-2 text-[10px] tracking-widest text-[color:var(--color-text-mute)] cursor-pointer">
                      <input
                        type="checkbox"
                        aria-label={`select-day-${date}`}
                        checked={allDaySelected}
                        ref={(el) => { if (el) el.indeterminate = someDaySelected; }}
                        onChange={() => toggleDay(date)}
                      />
                      <span>{date} — {daySessions.length} session(s)</span>
                    </label>
                  </td>
                </tr>
                {daySessions.map((s) => {
                  const st = statuses[s.id]?.kind ?? 'idle';
                  return (
                    <tr key={s.id} className="border-b border-[color:var(--color-border)]/50">
                      <td className="py-1 px-2 w-6">
                        <input
                          type="checkbox" aria-label={`select-${s.id}`}
                          checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                      </td>
                      <td className="font-mono text-[10px]">{s.id.slice(0, 8)}</td>
                      <td>{s.synced_at ? 'cloud + local' : 'local only'}</td>
                      <td>
                        {st === 'uploading' && 'Uploading\u2026'}
                        {st === 'ok' && <span className="text-green-300">Uploaded</span>}
                        {st === 'already_synced' && <span className="text-yellow-300">Already synced</span>}
                        {st === 'error' && (
                          <span>
                            <span className="text-red-300">Error</span>{' '}
                            <button className="underline" onClick={() => retry(s.id)}>Retry</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </>
            );
          })}
        </tbody>
      </table>

      {syncedModal && (
        <div role="dialog" className="border border-yellow-700/60 px-3 py-2 text-[11px]">
          <p>This session was already synced.</p>
          <p>By: <strong>{syncedModal.machine ?? 'unknown'}</strong></p>
          <p>At: {syncedModal.at ?? 'unknown'}</p>
          <button onClick={() => setSyncedModal(null)} className="mt-1 underline">OK</button>
        </div>
      )}

      {deleteConfirm && (
        <div role="dialog" className="border border-red-700/60 px-3 py-2 text-[11px] space-y-2">
          <p>
            Delete <strong>{deleteConfirm.ids.length}</strong> session(s) from local storage?
            This will free approximately <strong>{humanBytes(deleteConfirm.approxBytes)}</strong>.
            Cloud copies (if any) are untouched.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setDeleteConfirm(null)}
              className="px-3 py-1.5 border border-[color:var(--color-border)] tracking-widest">CANCEL</button>
            <button
              onClick={doDelete}
              className="px-3 py-1.5 border border-red-700/80 text-red-200 tracking-widest hover:bg-red-900/30">DELETE</button>
          </div>
        </div>
      )}
    </div>
  );
}
