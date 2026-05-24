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
  const [modal, setModal] = useState<(Status & { kind: 'already_synced' }) | null>(null);

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
                  {st === 'uploading' && 'Uploading\u2026'}
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
