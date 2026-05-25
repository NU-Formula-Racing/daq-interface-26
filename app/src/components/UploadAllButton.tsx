import { useEffect, useState } from 'react';

interface Summary { count: number; approxBytes: number; sessionIds: string[] }
interface UploadResult { status: 'ok' | 'already_synced'; uploadedBytes?: number }

export interface UploadAllButtonProps {
  getSummary: () => Promise<Summary>;
  uploadSession: (id: string) => Promise<UploadResult>;
  onChanged: () => void;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function UploadAllButton(props: UploadAllButtonProps) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);

  const refresh = async () => {
    try { setSummary(await props.getSummary()); } catch { /* surface elsewhere */ }
  };
  useEffect(() => { refresh(); }, []);

  const onConfirm = async () => {
    if (!summary) return;
    setConfirming(false);
    setRunning(true);
    setCancelRequested(false);
    const ids = summary.sessionIds;
    setProgress({ done: 0, total: ids.length });
    for (let i = 0; i < ids.length; i++) {
      if (cancelRequested) break;
      try { await props.uploadSession(ids[i]); }
      catch { /* error rendered by parent table row */ }
      setProgress({ done: i + 1, total: ids.length });
    }
    setRunning(false);
    setProgress(null);
    props.onChanged();
    refresh();
  };

  if (!summary || summary.count === 0) return null;

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={running}
        className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest disabled:opacity-50 hover:bg-[color:var(--color-bg)]"
      >
        {running && progress
          ? `UPLOADING ${progress.done} / ${progress.total}\u2026`
          : `UPLOAD ALL (${summary.count} sessions, ~${humanBytes(summary.approxBytes)})`}
      </button>
      {running && (
        <button
          onClick={() => setCancelRequested(true)}
          className="ml-2 px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest hover:bg-[color:var(--color-bg)]"
        >CANCEL</button>
      )}
      {confirming && (
        <div role="dialog" className="border border-[color:var(--color-border)] px-3 py-2 mt-2 text-[11px] space-y-2">
          <p>
            You&rsquo;re about to upload <strong>{summary.count}</strong> session(s)
            to the cloud, approximately <strong>{humanBytes(summary.approxBytes)}</strong> total.
            The first run takes a while. Continue?
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirming(false)}
              className="px-3 py-1.5 border border-[color:var(--color-border)] tracking-widest">CANCEL</button>
            <button onClick={onConfirm}
              className="px-3 py-1.5 border border-[color:var(--color-border)] tracking-widest">CONTINUE</button>
          </div>
        </div>
      )}
    </>
  );
}
