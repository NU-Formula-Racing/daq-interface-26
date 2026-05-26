# Website Parity with Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `frontend/interface/` (public website) into behavioral and visual parity with the desktop app's `/app` route: fix the broken active-signal filter, port the sub-second graph bucket fix, mirror the desktop's calendar-style session picker, and verify the DigitalOcean Spaces data pipeline.

**Architecture:** Website-only edits. Replay still fetches via Supabase RPCs — no browser-side Parquet/Spaces fetch. Session picker is a new JSX port of `app/src/components/SessionPicker.tsx`. Sub-second buckets require widening the Supabase function's `p_bucket_secs` parameter from `INT` to `NUMERIC` (this lives in `frontend/database/supabase_functions.sql`, which is the website's own DB layer — not desktop code).

**Tech Stack:** React 19, Vite, Supabase JS, `@nfr/widgets` workspace package, `react-router-dom` 7, `vitest`, `@testing-library/react`.

**Hard constraint:** Do not modify any file under `app/`, `desktop/`, `parser/`, or `packages/widgets/` source. The Supabase SQL under `frontend/database/` IS allowed (it's the website's database layer).

---

## File map

**Create:**
- `frontend/interface/src/components/SessionPicker.jsx` — calendar→day-list session picker ported from desktop.
- `frontend/interface/src/components/SessionPicker.test.jsx` — unit tests for the picker.

**Modify:**
- `frontend/interface/src/adapters/useSessionList.ts` — add `source` field to `SessionListItem` and select it from the RPC return.
- `frontend/database/supabase_functions.sql` — change `list_sessions` to return `source`; change `get_signals_window` `p_bucket_secs` from `INT` to `NUMERIC`.
- `frontend/interface/src/adapters/useSupabaseFrames.ts` — use raw fractional `bucketSecs` instead of `bucketFor()`.
- `frontend/interface/src/adapters/bucketFor.ts` — delete (becomes unused).
- `frontend/interface/src/adapters/bucketFor.test.ts` — delete (corresponding test).
- `frontend/interface/src/adapters/framesCache.ts` — confirm cache key uses bucket as-is (already does — no change unless verification finds a `Math.round`).
- `frontend/interface/src/routes/AppRoute.jsx` — replace `<DateAndSessionPicker>` with `<SessionPicker>`.
- `frontend/interface/src/components/DateAndSessionPicker.jsx` — delete after route swap (also delete `DatePicker.jsx`, `DatePicker.css` if no remaining importers).

**Verify (read-only):**
- `desktop/build/cloud-defaults.json` — read to learn canonical Spaces base URL.
- `packages/widgets/src/dock/dir-dock.tsx` — already confirms `availableSignalIds: ReadonlySet<number>` contract.

---

## Task 1: Sanity-verify Spaces & pipeline (read-only)

**Files:**
- Read: `desktop/build/cloud-defaults.json`

- [ ] **Step 1: Read cloud-defaults**

```bash
cat desktop/build/cloud-defaults.json
```
Expected: JSON with `spacesPublicBase`, `supabaseUrl`, `supabaseAnonKey`. Record the `spacesPublicBase` value (call it `$SPACES_BASE`).

- [ ] **Step 2: Pick a known session id**

Run in psql against the same Supabase project (or use Supabase MCP):
```sql
SELECT id FROM sessions WHERE source = 'sd_import' ORDER BY started_at DESC LIMIT 1;
```
Record the id (call it `$SID`).

- [ ] **Step 3: HEAD the session manifest**

```bash
curl -I "$SPACES_BASE/sessions/$SID/manifest.json"
```
Expected: `HTTP/2 200`. If 403/404, the pipeline is broken at the upload side — **stop and report**; fix is desktop-side and out of scope.

- [ ] **Step 4: Confirm the Supabase RPC returns rows for that session**

```sql
SELECT count(*) FROM get_signals_window(
  '$SID'::uuid,
  ARRAY(SELECT signal_id FROM get_session_signal_ids('$SID'::uuid) LIMIT 5),
  (SELECT started_at FROM sessions WHERE id = '$SID'),
  (SELECT coalesce(ended_at, started_at + interval '60 seconds') FROM sessions WHERE id = '$SID'),
  1
);
```
Expected: count > 0. If 0, the Supabase mirror is empty for that session — **stop and report**; fix is desktop-side.

- [ ] **Step 5: Commit a note**

No code changes. Skip the commit step.

---

## Task 2: Widen `get_signals_window` to NUMERIC bucket seconds

**Files:**
- Modify: `frontend/database/supabase_functions.sql` (around line 89 — the `get_signals_window` definition)

- [ ] **Step 1: Find the function definition**

Open `frontend/database/supabase_functions.sql` and locate `CREATE OR REPLACE FUNCTION get_signals_window(...)`. Inside, change:
```sql
p_bucket_secs INT DEFAULT 1
```
to
```sql
p_bucket_secs NUMERIC DEFAULT 1
```

- [ ] **Step 2: Verify the body still type-checks**

Inside the body, the line is:
```sql
floor(extract(epoch FROM r.timestamp) / p_bucket_secs) * p_bucket_secs
```
`floor` and arithmetic both accept NUMERIC, so no body change needed. Confirm by reading the function source.

- [ ] **Step 3: Also widen `get_session_overview` for consistency**

In the same file, change `get_session_overview`'s `p_bucket_secs INT DEFAULT 1` → `p_bucket_secs NUMERIC DEFAULT 1`.

- [ ] **Step 4: Apply migration to Supabase**

Use the Supabase MCP `apply_migration` tool with the updated function definitions. Migration name: `widen_bucket_secs_to_numeric`.

- [ ] **Step 5: Verify the function accepts a float**

Via Supabase MCP `execute_sql`:
```sql
SELECT count(*) FROM get_signals_window(
  (SELECT id FROM sessions WHERE source='sd_import' LIMIT 1)::uuid,
  ARRAY[1]::int[],
  NOW() - interval '1 day',
  NOW(),
  0.05
);
```
Expected: returns without a type error. (Count may be 0 — that's fine.)

- [ ] **Step 6: Commit**

```bash
git add frontend/database/supabase_functions.sql
git commit -m "supabase: widen p_bucket_secs to NUMERIC for sub-second buckets"
```

---

## Task 3: Use fractional bucketSecs in website replay adapter

**Files:**
- Modify: `frontend/interface/src/adapters/useSupabaseFrames.ts:62-65`
- Delete: `frontend/interface/src/adapters/bucketFor.ts`
- Delete: `frontend/interface/src/adapters/bucketFor.test.ts`

- [ ] **Step 1: Update the bucket calculation**

In `frontend/interface/src/adapters/useSupabaseFrames.ts`, replace lines 62-65:
```ts
    const startMs = Date.parse(args.start);
    const endMs = Date.parse(args.end);
    const durationSecs = Math.max(1, Math.round((endMs - startMs) / 1000));
    const bucketSecs = bucketFor(durationSecs, args.targetBuckets ?? 800);
```
with:
```ts
    const startMs = Date.parse(args.start);
    const endMs = Date.parse(args.end);
    const durationSecs = Math.max(0.001, (endMs - startMs) / 1000);
    const bucketSecs = durationSecs / (args.targetBuckets ?? 800);
```

- [ ] **Step 2: Drop the now-unused import**

In the same file, remove the line:
```ts
import { bucketFor } from './bucketFor';
```

- [ ] **Step 3: Confirm no other importers**

Run:
```bash
grep -rn "from .*bucketFor" frontend/interface/src
```
Expected: zero matches.

- [ ] **Step 4: Delete `bucketFor.ts` and its test**

```bash
rm frontend/interface/src/adapters/bucketFor.ts \
   frontend/interface/src/adapters/bucketFor.test.ts
```

- [ ] **Step 5: Confirm cache key handles fractional buckets**

Open `frontend/interface/src/adapters/framesCache.ts` and verify the key-building function uses `bucketSecs` as-is (no `Math.round`). If it rounds, change it to embed the raw number (e.g. `String(bucketSecs)`). If it already uses raw, no change.

- [ ] **Step 6: Run the adapter tests**

```bash
cd frontend/interface && npm test -- adapters/useSupabaseFrames.test.ts adapters/framesCache.test.ts
```
Expected: all tests pass. If `useSupabaseFrames.test.ts` asserts an integer bucket value, update the expectation to the fractional value the new code produces (e.g. for `start=...:00:00`, `end=...:00:01`, `targetBuckets=800` → `bucketSecs = 1/800 = 0.00125`).

- [ ] **Step 7: Run all frontend tests**

```bash
cd frontend/interface && npm test
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/interface/src/adapters/useSupabaseFrames.ts \
        frontend/interface/src/adapters/bucketFor.ts \
        frontend/interface/src/adapters/bucketFor.test.ts \
        frontend/interface/src/adapters/useSupabaseFrames.test.ts \
        frontend/interface/src/adapters/framesCache.ts
git commit -m "website: sub-second graph buckets in replay (parity with desktop)"
```

---

## Task 4: Diagnose the active-signal filter

**Files:**
- Read-only: `packages/widgets/src/dock/dir-dock.tsx:1066`, `:1173`
- Read-only: `frontend/interface/src/routes/AppRoute.jsx:164`
- Read-only: `frontend/interface/src/adapters/useSessionSignalIds.ts`

- [ ] **Step 1: Add a temporary diagnostic log**

In `frontend/interface/src/routes/AppRoute.jsx`, just before the `return` (after `const sessionSlot = ...`), insert:
```jsx
useEffect(() => {
  console.log('[DIAG availableSignalIds]', {
    mode,
    idsStatus,
    sessionId: session?.id ?? null,
    setSize: sessionSignalIds.size,
    sample: [...sessionSignalIds].slice(0, 5),
  });
}, [mode, idsStatus, session?.id, sessionSignalIds]);
```

- [ ] **Step 2: Run the dev server**

```bash
cd frontend/interface && npm run dev
```
Open `http://localhost:5173/app?session=<known-sid>`.

- [ ] **Step 3: Observe the console**

Three outcomes are possible:

(a) `setSize: 0` and `idsStatus: 'error'` — RPC failing. Inspect the error in the Network tab; usually a Supabase RLS or function-signature issue. Fix is in `frontend/database/supabase_functions.sql` for `get_session_signal_ids`.

(b) `setSize: 0` and `idsStatus: 'ready'` — RPC returned no rows. The session may have no `sd_readings` rows. Pick a different session id to confirm the wiring before claiming a bug.

(c) `setSize > 0` and `idsStatus: 'ready'`, but the picker still shows all signals — widget consumer issue. Open `packages/widgets/src/dock/dir-dock.tsx:1066-1075` to confirm `available.has(s.id)` is reached. If it is, the bug is most likely that `availableSignalIds` is being **re-created on every render** (new Set identity each tick), forcing the dock to think there's no filter or to render before the Set settles. Fix: memoize.

- [ ] **Step 4: Apply the fix based on the outcome**

For outcome (c), in `frontend/interface/src/routes/AppRoute.jsx` line ~164, wrap the value to ensure stable identity:
```jsx
const filteredAvailable = mode === 'replay' && idsStatus === 'ready'
  ? sessionSignalIds
  : null;
```
This is already what the code does — `sessionSignalIds` itself is the `Set` returned by the hook, which is stable across renders for a given `sessionId` because the hook stores it in state. So if outcome (c) reproduces, the next suspect is that `useSessionSignalIds` recreates the empty Set on first render and `availableSignalIds` lands as an **empty Set** before the gating clause (`idsStatus === 'ready'`) flips. Confirm by checking the timestamp of the first log vs the picker-open event.

For outcome (a), fix the SQL function and re-apply migration. For (b), this is not a bug — close as "works as designed".

- [ ] **Step 5: Remove the diagnostic log**

Delete the `useEffect` block added in Step 1.

- [ ] **Step 6: Run frontend tests**

```bash
cd frontend/interface && npm test
```
Expected: all pass.

- [ ] **Step 7: Commit**

If a fix was applied:
```bash
git add frontend/interface/src/routes/AppRoute.jsx frontend/interface/src/adapters/useSessionSignalIds.ts
git commit -m "website: fix active-signal filter (root-cause from diagnostic)"
```
If no fix was needed (outcome b or false alarm), commit nothing.

---

## Task 5: Add `source` to the website session list

**Files:**
- Modify: `frontend/database/supabase_functions.sql` (the `list_sessions` function around line 162)
- Modify: `frontend/interface/src/adapters/useSessionList.ts`

- [ ] **Step 1: Read the current `list_sessions` definition**

```bash
sed -n '155,200p' frontend/database/supabase_functions.sql
```
Note the existing column list.

- [ ] **Step 2: Add `source TEXT` to the RETURNS TABLE and to the SELECT**

In `frontend/database/supabase_functions.sql`, in the `list_sessions` function:
- Add `source TEXT` to the `RETURNS TABLE (...)` column list.
- Add `s.source` to the `SELECT` projection, matching the column order.

- [ ] **Step 3: Apply migration**

Use Supabase MCP `apply_migration`. Migration name: `list_sessions_add_source`. Drop and recreate the function (`list_sessions` already has a `DROP FUNCTION IF EXISTS` line at 160 — keep that and update the new signature accordingly).

- [ ] **Step 4: Smoke-test the RPC**

Via Supabase MCP `execute_sql`:
```sql
SELECT id, source FROM list_sessions(5);
```
Expected: returns rows with non-null `source` values like `sd_import` or `live`.

- [ ] **Step 5: Add `source` to `SessionListItem`**

In `frontend/interface/src/adapters/useSessionList.ts`, change:
```ts
export interface SessionListItem {
  id: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  duration_secs: number;
  driver: string | null;
  car: string | null;
  session_number: number | null;
}
```
to add `source`:
```ts
export interface SessionListItem {
  id: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  duration_secs: number;
  driver: string | null;
  car: string | null;
  session_number: number | null;
  source: string | null;
}
```

- [ ] **Step 6: Run tests**

```bash
cd frontend/interface && npm test
```
Expected: all pass (no test asserts on this field yet).

- [ ] **Step 7: Commit**

```bash
git add frontend/database/supabase_functions.sql frontend/interface/src/adapters/useSessionList.ts
git commit -m "website: expose session source for desktop-style picker filtering"
```

---

## Task 6: Port the desktop-style SessionPicker — write the failing test

**Files:**
- Create: `frontend/interface/src/components/SessionPicker.test.jsx`

- [ ] **Step 1: Write the test file**

Create `frontend/interface/src/components/SessionPicker.test.jsx` with:
```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SessionPicker from './SessionPicker';

const SESSIONS = [
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    date: '2026-04-21',
    started_at: '2026-04-21T14:23:00Z',
    ended_at: '2026-04-21T14:28:20Z',
    duration_secs: 320,
    driver: 'Alex',
    car: null,
    session_number: 1,
    source: 'sd_import',
  },
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000002',
    date: '2026-04-21',
    started_at: '2026-04-21T15:00:00Z',
    ended_at: '2026-04-21T15:05:00Z',
    duration_secs: 300,
    driver: 'Sam',
    car: null,
    session_number: 2,
    source: 'sd_import',
  },
  {
    id: 'bbbbbbbb-0000-0000-0000-000000000003',
    date: '2026-04-22',
    started_at: '2026-04-22T10:00:00Z',
    ended_at: '2026-04-22T10:02:00Z',
    duration_secs: 120,
    driver: null,
    car: null,
    session_number: null,
    source: 'live', // should be filtered out
  },
];

function open(button) { fireEvent.click(button); }

describe('SessionPicker', () => {
  it('shows the calendar when opened and excludes non-sd_import sessions from day badges', () => {
    render(<SessionPicker sessions={SESSIONS} currentId={null} onPick={() => {}} />);
    open(screen.getByRole('button', { name: /select session|▾/i }));
    // April 21 has 2 sd_import sessions; April 22 has 1 live (filtered).
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
    // Badge "2" present for day 21 (two sd_import sessions)
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('drills into a day and labels sessions by local time, not by #N', () => {
    render(<SessionPicker sessions={SESSIONS} currentId={null} onPick={() => {}} />);
    open(screen.getByRole('button', { name: /select session|▾/i }));
    fireEvent.click(screen.getByText('21'));
    // Should NOT show "#1" or "#2" anywhere
    expect(screen.queryByText(/#1/)).toBeNull();
    expect(screen.queryByText(/#2/)).toBeNull();
    // Should show the 8-char id prefix for each session
    expect(screen.getByText('aaaaaaaa')).toBeInTheDocument();
  });

  it('calls onPick with the chosen session id', () => {
    const onPick = vi.fn();
    render(<SessionPicker sessions={SESSIONS} currentId={null} onPick={onPick} />);
    open(screen.getByRole('button', { name: /select session|▾/i }));
    fireEvent.click(screen.getByText('21'));
    // Click first session in the day list
    fireEvent.click(screen.getByText('aaaaaaaa'));
    expect(onPick).toHaveBeenCalledWith('aaaaaaaa-0000-0000-0000-000000000001');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd frontend/interface && npm test -- src/components/SessionPicker.test.jsx
```
Expected: FAIL — "Cannot find module './SessionPicker'".

- [ ] **Step 3: Commit the failing test**

```bash
git add frontend/interface/src/components/SessionPicker.test.jsx
git commit -m "test: SessionPicker calendar + day list + onPick contract"
```

---

## Task 7: Implement SessionPicker (port from desktop)

**Files:**
- Create: `frontend/interface/src/components/SessionPicker.jsx`

- [ ] **Step 1: Read the desktop reference**

```bash
sed -n '1,338p' app/src/components/SessionPicker.tsx
```
This is the source of truth for visuals + UX. The website version is a JSX port that:
- Takes `sessions`, `currentId`, `onPick(id)` props directly (no internal `apiGet` or `useParams`).
- Inlines `SH_COLORS` constants (don't reach into desktop's `colors.ts`).
- Uses the same calendar grid + day list components.

- [ ] **Step 2: Create the file**

Create `frontend/interface/src/components/SessionPicker.jsx`:

```jsx
import { useEffect, useMemo, useRef, useState } from 'react';

const COLORS = {
  bg: '#1e1f22',
  bgInner: '#2b2d30',
  border: 'rgba(255,255,255,0.09)',
  text: '#dfe1e5',
  textMute: '#9da0a8',
  textFaint: '#6b6e76',
  accentBright: '#a78bfa',
};

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DOW_LABELS = ['S','M','T','W','T','F','S'];

function smallBtn() {
  return {
    display: 'inline-flex', alignItems: 'center', padding: '3px 7px',
    background: 'transparent', border: `1px solid ${COLORS.border}`,
    color: COLORS.textMute, fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10, letterSpacing: 0.5, cursor: 'pointer',
    borderRadius: 2, textTransform: 'uppercase',
  };
}

function CalendarPanel({ cursor, cells, onPrev, onNext, onToday, onPickDate, emptyHint }) {
  const today = new Date();
  const todayIso =
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  return (
    <div style={{ padding: 12, fontFamily: '"JetBrains Mono", monospace' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 10 }}>
        <button onClick={onPrev} style={{ ...smallBtn(), padding:'2px 8px' }}>‹</button>
        <span style={{ fontSize: 11, color: COLORS.text, letterSpacing: 1, fontWeight: 600 }}>
          {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
        </span>
        <div style={{ display:'flex', gap: 4 }}>
          <button onClick={onToday} style={{ ...smallBtn(), padding:'2px 6px', fontSize: 9 }}>TODAY</button>
          <button onClick={onNext} style={{ ...smallBtn(), padding:'2px 8px' }}>›</button>
        </div>
      </div>
      <div style={{
        display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap: 2,
        marginBottom: 4, fontSize: 9, color: COLORS.textFaint,
      }}>
        {DOW_LABELS.map((d, i) => (
          <span key={i} style={{ textAlign:'center', padding:'2px 0' }}>{d}</span>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((c) => {
          const has = c.sessions > 0;
          const isToday = c.iso === todayIso;
          const dim = !c.inMonth;
          return (
            <button
              key={c.iso}
              onClick={() => has && onPickDate(c.iso)}
              disabled={!has}
              style={{
                aspectRatio:'1 / 1', padding: 0,
                background: has ? 'rgba(167,139,250,0.22)' : 'transparent',
                border: isToday
                  ? `1px solid ${COLORS.accentBright}`
                  : `1px solid ${has ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.05)'}`,
                color: has ? COLORS.text : dim ? COLORS.textFaint : COLORS.textMute,
                cursor: has ? 'pointer' : 'default',
                fontFamily:'"JetBrains Mono", monospace', fontSize: 10,
                display:'flex', alignItems:'center', justifyContent:'center',
                position:'relative', opacity: dim ? 0.4 : 1,
              }}
              title={has ? `${c.sessions} session${c.sessions === 1 ? '' : 's'}` : ''}
            >
              {c.date.getDate()}
              {has && c.sessions > 1 && (
                <span style={{
                  position:'absolute', bottom: 2, right: 4,
                  fontSize: 8, color: COLORS.accentBright,
                }}>
                  {c.sessions}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {emptyHint && (
        <div style={{ marginTop: 10, fontSize: 9, color: COLORS.textFaint, textAlign:'center' }}>
          {emptyHint}
        </div>
      )}
    </div>
  );
}

function SessionDayList({ date, sessions, currentId, onPick, onBack }) {
  return (
    <div style={{ fontFamily:'"JetBrains Mono", monospace' }}>
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'10px 12px', borderBottom:`1px solid ${COLORS.border}`,
      }}>
        <button onClick={onBack} style={{ ...smallBtn(), padding:'2px 8px', fontSize: 9 }}>← BACK</button>
        <span style={{ fontSize: 10, color: COLORS.textMute, letterSpacing: 1 }}>
          {date} · {sessions.length} session{sessions.length === 1 ? '' : 's'}
        </span>
      </div>
      {sessions.map((s) => {
        const active = s.id === currentId;
        return (
          <div
            key={s.id}
            onClick={() => onPick(s.id)}
            style={{
              padding:'10px 12px', borderBottom:`1px solid ${COLORS.border}`,
              cursor:'pointer',
              background: active ? 'rgba(167,139,250,0.12)' : 'transparent',
              fontSize: 10, color: COLORS.text,
            }}
          >
            <div style={{ display:'flex', justifyContent:'space-between', gap: 8 }}>
              <span>{new Date(s.started_at).toLocaleTimeString()}</span>
              <span style={{ color: COLORS.textFaint, fontSize: 9 }}>
                {s.id.slice(0, 8)}
              </span>
            </div>
            {(s.driver || s.car) && (
              <div style={{
                marginTop: 2, color: COLORS.textMute, fontSize: 9, display:'flex', gap: 8,
              }}>
                {s.driver && <span>{s.driver}</span>}
                {s.car && <span>· {s.car}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Calendar-style session picker.
 * Props:
 *   sessions: SessionListItem[]   (full list; sd_import gets filtered internally)
 *   currentId: string | null
 *   onPick(id: string)
 */
export default function SessionPicker({ sessions, currentId, onPick }) {
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });
  const autoJumpedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setSelectedDate(null);
      autoJumpedRef.current = false;
    }
  }, [open]);

  const sdSessions = useMemo(
    () => (sessions ?? []).filter((s) => s.source === 'sd_import'),
    [sessions],
  );

  useEffect(() => {
    if (!open || autoJumpedRef.current) return;
    if (sdSessions.length === 0) { autoJumpedRef.current = true; return; }
    const latest = sdSessions.reduce((acc, s) => (s.date > acc ? s.date : acc), sdSessions[0].date);
    const [y, m] = latest.split('-').map((x) => parseInt(x, 10));
    if (y && m) setCursor(new Date(y, m - 1, 1));
    autoJumpedRef.current = true;
  }, [open, sdSessions]);

  const dayMap = useMemo(() => {
    const m = new Map();
    for (const s of sdSessions) {
      const arr = m.get(s.date);
      if (arr) arr.push(s);
      else m.set(s.date, [s]);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''));
    }
    return m;
  }, [sdSessions]);

  const current = sessions?.find((s) => s.id === currentId);
  const label = currentId
    ? current
      ? `${new Date(current.started_at).toLocaleDateString()} · ${currentId.slice(0, 8)}`
      : currentId.slice(0, 8)
    : 'Select session';

  const cells = useMemo(() => {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startSunday = new Date(firstOfMonth);
    startSunday.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(startSunday);
      d.setDate(startSunday.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      out.push({
        date: d, iso,
        inMonth: d.getMonth() === cursor.getMonth(),
        sessions: dayMap.get(iso)?.length ?? 0,
      });
    }
    return out;
  }, [cursor, dayMap]);

  const dropdownStyle = {
    position:'absolute', top:'calc(100% + 4px)', right: 0,
    width: 380, maxHeight: 460, overflow:'auto',
    background: COLORS.bg, border:`1px solid ${COLORS.border}`,
    zIndex: 51, boxShadow:'0 8px 24px rgba(0,0,0,0.55)',
  };

  return (
    <div style={{ position:'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...smallBtn(), color: COLORS.text, padding:'4px 10px' }}>
        {label} ▾
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position:'fixed', inset: 0, zIndex: 50 }} />
          <div style={dropdownStyle}>
            {selectedDate ? (
              <SessionDayList
                date={selectedDate}
                sessions={dayMap.get(selectedDate) ?? []}
                currentId={currentId}
                onPick={(id) => { onPick(id); setOpen(false); }}
                onBack={() => setSelectedDate(null)}
              />
            ) : (
              <CalendarPanel
                cursor={cursor}
                cells={cells}
                onPrev={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                onNext={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                onToday={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); }}
                onPickDate={(iso) => setSelectedDate(iso)}
                emptyHint={sdSessions.length === 0 ? 'No imported sessions yet' : null}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run the SessionPicker test**

```bash
cd frontend/interface && npm test -- src/components/SessionPicker.test.jsx
```
Expected: all three tests pass. If the "calls onPick" test fails because the day list shows multiple `aaaaaaaa` strings (one per session), narrow the selector — e.g. `screen.getAllByText('aaaaaaaa')[0]`.

- [ ] **Step 4: Commit**

```bash
git add frontend/interface/src/components/SessionPicker.jsx
git commit -m "website: desktop-style calendar SessionPicker"
```

---

## Task 8: Wire SessionPicker into AppRoute

**Files:**
- Modify: `frontend/interface/src/routes/AppRoute.jsx`
- Delete: `frontend/interface/src/components/DateAndSessionPicker.jsx`
- Delete (conditional): `frontend/interface/src/components/DatePicker.jsx`, `DatePicker.css`

- [ ] **Step 1: Swap the import**

In `frontend/interface/src/routes/AppRoute.jsx`, change:
```jsx
import DateAndSessionPicker from '@/components/DateAndSessionPicker';
```
to:
```jsx
import SessionPicker from '@/components/SessionPicker';
```

- [ ] **Step 2: Replace the JSX**

Find the `sessionSlot = mode === 'replay' ? (...)` block. Replace the `<DateAndSessionPicker ... />` JSX with:
```jsx
<SessionPicker
  sessions={sessions}
  currentId={session?.id ?? null}
  onPick={(id) => setSearch((p) => {
    if (id) p.set('session', id); else p.delete('session');
    p.delete('date');
    return p;
  })}
/>
```

- [ ] **Step 3: Remove the now-dead date helper logic**

In the same file, the `selectedDate` / `setSelectedDate` / `urlDate` block and the `useEffect` that auto-picks first session for `selectedDate` are no longer needed (the new picker manages its own calendar cursor). Delete:
- `const urlDate = search.get('date');`
- `const selectedDate = urlDate ?? session?.date ?? new Date().toISOString().split('T')[0];`
- `const setSelectedDate = ...`
- The `useEffect(() => { if (mode !== 'replay' || sessionId) return; ... }, [...])` block that auto-picks `firstForDate`.

Keep the `session` and `sessionId` derivations untouched.

- [ ] **Step 4: Check remaining importers of `DateAndSessionPicker` and `DatePicker`**

```bash
grep -rn "DateAndSessionPicker\|from .*DatePicker" frontend/interface/src
```
Expected: only the AppRoute import (which we just removed) — should now show zero matches.

- [ ] **Step 5: Delete the orphaned files**

```bash
rm frontend/interface/src/components/DateAndSessionPicker.jsx \
   frontend/interface/src/components/DatePicker.jsx \
   frontend/interface/src/components/DatePicker.css
```

- [ ] **Step 6: Run the dev server and smoke-test**

```bash
cd frontend/interface && npm run dev
```
Open `http://localhost:5173/app`. Confirm:
- The trigger button reads `Select session ▾` initially.
- Clicking opens a calendar with badged days.
- Clicking a day shows the time-list with `HH:MM:SS` labels and 8-char id stubs (no `#N`).
- Picking a session updates the URL `?session=...` and the dock starts loading data.

Kill the dev server when done.

- [ ] **Step 7: Run all frontend tests**

```bash
cd frontend/interface && npm test
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/interface/src/routes/AppRoute.jsx \
        frontend/interface/src/components/DateAndSessionPicker.jsx \
        frontend/interface/src/components/DatePicker.jsx \
        frontend/interface/src/components/DatePicker.css
git commit -m "website: AppRoute uses desktop-style SessionPicker; drop dead DateAndSessionPicker"
```

---

## Task 9: Widget parity audit

**Files:**
- Read-only: `frontend/interface/package.json`, `packages/widgets/package.json`, `packages/widgets/src/index.ts`

- [ ] **Step 1: Confirm workspace resolution**

```bash
ls -la frontend/interface/node_modules/@nfr/widgets
```
Expected: symlink to `packages/widgets`. If it's a copied directory or missing, run from the repo root:
```bash
npm install
```

- [ ] **Step 2: Confirm widgets uses source entrypoint**

```bash
cat packages/widgets/package.json | grep -E '"main"|"types"|"exports"'
```
Expected: `"main": "src/index.ts"` (no build step required — Vite consumes source).

- [ ] **Step 3: Run the widget test suite to confirm nothing is broken upstream**

```bash
cd packages/widgets && npm test
```
Expected: all pass. If failures, this is a pre-existing issue — note but don't fix (out of scope).

- [ ] **Step 4: Smoke-check the desktop-fix parity**

Start the website dev server again, open `/app?session=<sid>`. Visually confirm in the dock graph:
- Cursor snaps to nearest sample (no interpolation between samples).
- X-axis labels are relative to session start.
- Enum signals render as names, not the raw dictionary object.
- Reset-zoom button (purple corner) is present.
- Data-status dot is colored per signal status.

If any of these are missing despite running the same `@nfr/widgets`, file a separate issue — they should propagate automatically from the shared package.

- [ ] **Step 5: No commit needed unless action was taken**

If `npm install` modified `package-lock.json`:
```bash
git add package-lock.json
git commit -m "deps: refresh lockfile after workspace audit"
```

---

## Verification checklist

After all tasks complete, verify against the spec:

- [ ] `cat desktop/build/cloud-defaults.json` → publishes a Spaces URL, the URL `HEAD`s 200, and the corresponding Supabase RPC returns rows for a known session (Task 1).
- [ ] Supabase `get_signals_window` accepts a fractional `p_bucket_secs` without error (Task 2).
- [ ] On the website `/app` route, zooming a graph to a sub-second window renders dense samples (not stair-stepped) (Task 3).
- [ ] On the website `/app` route, opening a widget signal picker hides signals that have no data in the current session (Task 4).
- [ ] The session picker on the website is a calendar grid (Task 7) wired into AppRoute (Task 8), with no `#N` numbering visible anywhere.
- [ ] `git status` shows no modifications under `app/`, `desktop/`, `parser/`, or `packages/widgets/`.
- [ ] All vitest suites pass: `cd frontend/interface && npm test` and `cd packages/widgets && npm test`.
