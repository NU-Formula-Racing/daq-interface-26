# Plan 2 — Python Parser Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Python parser to talk to local Postgres instead of Supabase, add a `--batch <file>` mode for SD imports, and expose a newline-delimited JSON protocol on stdout for the Electron main process to consume in live mode.

**Architecture:** Reuse `compile.py` / `decode.py` / `signalSpec.py` verbatim. Add new focused modules: `db.py` (psycopg helpers), `protocol.py` (stdout JSON emitter), `nfr_reader.py` (log-file frame iterator), `batch.py` (one-shot file import), `live.py` (long-running serial loop with auto-session lifecycle), `__main__.py` (CLI glue). Old `upload.py` and `main.py` stay on disk unmodified but become dead code.

**Tech Stack:** Python 3.11+, psycopg 3 (binary), pyserial, pytest, PostgreSQL 14+ (same local instance Plan 1 uses).

**Prerequisites:** Plan 1 complete. `desktop/migrations/*.sql` files exist and are known-good. Postgres running on `localhost:5432` with a user that has CREATEDB privilege.

---

### Task 1: Scaffold parser package config and test harness

**Files:**
- Create: `parser/pyproject.toml`
- Create: `parser/tests/__init__.py`
- Create: `parser/tests/conftest.py`
- Create: `parser/tests/test_harness.py`
- Modify: `.gitignore` (root)

- [ ] **Step 1: Create `parser/pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "daq-parser"
version = "0.1.0"
description = "NFR 26 DAQ CAN decoder + local Postgres uploader"
requires-python = ">=3.11"
dependencies = [
  "psycopg[binary]>=3.2",
  "pyserial>=3.5",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.0",
]

[tool.setuptools]
py-modules = ["compile", "decode", "signalSpec"]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-ra -q"
```

- [ ] **Step 2: Add parser venv dir to root `.gitignore`**

Append to `/Users/andrewxue/Documents/daq-interface-26/.gitignore`:

```
parser/.venv/
parser/*.egg-info/
parser/__pycache__/
parser/**/__pycache__/
```

- [ ] **Step 3: Create the Postgres fixture in `parser/tests/conftest.py`**

```python
"""Shared pytest fixtures for the parser tests.

`scratch_db` creates a throwaway Postgres database, applies the
`desktop/migrations/*.sql` files in order, yields a connection URL, and
drops the database on teardown. Mirrors the TS test harness in Plan 1.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Iterator
from urllib.parse import urlparse, urlunparse

import psycopg
import pytest

ADMIN_URL = os.environ.get(
    "TEST_PG_URL", "postgres://postgres@localhost:5432/postgres"
)
MIGRATIONS_DIR = (
    Path(__file__).resolve().parents[2] / "desktop" / "migrations"
)


def _with_database(url: str, name: str) -> str:
    parsed = urlparse(url)
    return urlunparse(parsed._replace(path=f"/{name}"))


@pytest.fixture
def scratch_db() -> Iterator[str]:
    name = f"nfr_parser_test_{secrets.token_hex(6)}"
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(f"CREATE DATABASE {name}")

    url = _with_database(ADMIN_URL, name)
    try:
        with psycopg.connect(url, autocommit=True) as conn:
            for sql_path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                conn.execute(sql_path.read_text())
            # Track in schema_migrations so reruns behave like the real runner.
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                "version TEXT PRIMARY KEY, "
                "applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            )
            for sql_path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                version = sql_path.stem
                conn.execute(
                    "INSERT INTO schema_migrations (version) VALUES (%s) "
                    "ON CONFLICT DO NOTHING",
                    (version,),
                )

        yield url
    finally:
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = %s",
                (name,),
            )
            admin.execute(f"DROP DATABASE IF EXISTS {name}")
```

- [ ] **Step 4: Smoke test the fixture**

Create `parser/tests/__init__.py` (empty file) and `parser/tests/test_harness.py`:

```python
"""Confirm the scratch_db fixture spins up a DB with the Plan 1 schema."""
import psycopg


def test_scratch_db_has_sessions_table(scratch_db: str) -> None:
    with psycopg.connect(scratch_db) as conn:
        row = conn.execute(
            "SELECT count(*) FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'sessions'"
        ).fetchone()
        assert row is not None
        assert row[0] == 1


def test_scratch_db_seeds_app_config(scratch_db: str) -> None:
    with psycopg.connect(scratch_db) as conn:
        row = conn.execute("SELECT id FROM app_config").fetchone()
        assert row == (1,)
```

- [ ] **Step 5: Create venv and install**

Run:
```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations/parser
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
```

Expected: clean install of psycopg, pyserial, pytest and the local package.

- [ ] **Step 6: Run the harness smoke tests**

Run (from the parser venv):
```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations/parser
.venv/bin/pytest tests/test_harness.py -v
```

Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add parser/pyproject.toml parser/tests/__init__.py parser/tests/conftest.py parser/tests/test_harness.py .gitignore
git commit -m "chore: scaffold parser test harness with scratch Postgres fixture"
```

---

### Task 2: `db.py` — psycopg helpers (TDD)

**Files:**
- Create: `parser/tests/test_db.py`
- Create: `parser/db.py`

Module provides the four operations the live/batch modes need against the Plan 1 schema.

- [ ] **Step 1: Write the failing test file**

Create `parser/tests/test_db.py`:

```python
"""Tests for parser.db — psycopg helpers for local Postgres."""
from __future__ import annotations

from datetime import datetime, timezone

import psycopg
import pytest

from db import (
    Reading,
    SignalDef,
    copy_sd_readings,
    end_session_and_flush,
    insert_rt_batch,
    open_session,
    upsert_signal_definitions,
)


def test_upsert_signal_definitions_returns_id_map(scratch_db: str) -> None:
    defs = [
        SignalDef(source="PDM", signal_name="bus_voltage", unit="V"),
        SignalDef(source="BMS_SOE", signal_name="soc", unit="%"),
    ]
    with psycopg.connect(scratch_db) as conn:
        ids = upsert_signal_definitions(conn, defs)

    assert set(ids.keys()) == {
        ("PDM", "bus_voltage"),
        ("BMS_SOE", "soc"),
    }
    assert all(isinstance(v, int) for v in ids.values())


def test_upsert_signal_definitions_is_idempotent(scratch_db: str) -> None:
    defs = [SignalDef(source="PDM", signal_name="bus_voltage", unit="V")]
    with psycopg.connect(scratch_db) as conn:
        first = upsert_signal_definitions(conn, defs)
        second = upsert_signal_definitions(conn, defs)
    assert first == second


def test_open_and_end_session_flushes_rt_to_sd(scratch_db: str) -> None:
    with psycopg.connect(scratch_db) as conn:
        ids = upsert_signal_definitions(
            conn, [SignalDef(source="PDM", signal_name="v", unit="V")]
        )
        sig_id = ids[("PDM", "v")]

        session_id = open_session(conn, source="live")
        started_at = datetime.now(timezone.utc)

        insert_rt_batch(
            conn,
            session_id,
            [
                Reading(ts=started_at, signal_id=sig_id, value=12.3),
                Reading(ts=started_at, signal_id=sig_id, value=12.4),
            ],
        )

        rt_count = conn.execute(
            "SELECT count(*) FROM rt_readings WHERE session_id = %s",
            (session_id,),
        ).fetchone()[0]
        assert rt_count == 2

        row_count = end_session_and_flush(conn, session_id)
        assert row_count == 2

        rt_after = conn.execute(
            "SELECT count(*) FROM rt_readings WHERE session_id = %s",
            (session_id,),
        ).fetchone()[0]
        sd_after = conn.execute(
            "SELECT count(*) FROM sd_readings WHERE session_id = %s",
            (session_id,),
        ).fetchone()[0]
        ended_at = conn.execute(
            "SELECT ended_at FROM sessions WHERE id = %s",
            (session_id,),
        ).fetchone()[0]

    assert rt_after == 0
    assert sd_after == 2
    assert ended_at is not None


def test_copy_sd_readings_bulk_inserts_directly(scratch_db: str) -> None:
    with psycopg.connect(scratch_db) as conn:
        ids = upsert_signal_definitions(
            conn, [SignalDef(source="PDM", signal_name="v", unit="V")]
        )
        sig_id = ids[("PDM", "v")]
        session_id = open_session(conn, source="sd_import", source_file="a.nfr")

        now = datetime.now(timezone.utc)
        readings = [
            Reading(ts=now, signal_id=sig_id, value=float(i)) for i in range(100)
        ]
        inserted = copy_sd_readings(conn, session_id, readings)

    assert inserted == 100
    with psycopg.connect(scratch_db) as conn:
        count = conn.execute(
            "SELECT count(*) FROM sd_readings WHERE session_id = %s",
            (session_id,),
        ).fetchone()[0]
    assert count == 100
```

- [ ] **Step 2: Run tests — expect all to fail (ImportError)**

```bash
cd parser && .venv/bin/pytest tests/test_db.py -v
```

Expected: collection error — `db` module not found.

- [ ] **Step 3: Implement `parser/db.py`**

```python
"""psycopg helpers for the NFR 26 local parser.

All functions take an open `psycopg.Connection` and use the schema from
`desktop/migrations/`. Transactions are caller-managed: pass a connection,
we do the work, you commit (or we use `autocommit` for the flush step).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Sequence
from uuid import UUID

import psycopg


@dataclass(frozen=True)
class SignalDef:
    source: str
    signal_name: str
    unit: str = ""
    description: str = ""


@dataclass(frozen=True)
class Reading:
    ts: datetime
    signal_id: int
    value: float


def upsert_signal_definitions(
    conn: psycopg.Connection, defs: Sequence[SignalDef]
) -> dict[tuple[str, str], int]:
    """Upsert a batch of signal definitions and return their ids."""
    if not defs:
        return {}

    rows = [(d.source, d.signal_name, d.unit, d.description) for d in defs]
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO signal_definitions (source, signal_name, unit, description) "
            "VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (source, signal_name) DO UPDATE SET "
            "unit = EXCLUDED.unit, description = EXCLUDED.description",
            rows,
        )
        cur.execute(
            "SELECT id, source, signal_name FROM signal_definitions "
            "WHERE (source, signal_name) = ANY(%s)",
            ([(d.source, d.signal_name) for d in defs],),
        )
        result: dict[tuple[str, str], int] = {}
        for sig_id, source, signal_name in cur.fetchall():
            result[(source, signal_name)] = sig_id
    conn.commit()
    return result


def open_session(
    conn: psycopg.Connection,
    source: str,
    *,
    source_file: str | None = None,
    started_at: datetime | None = None,
) -> UUID:
    """Create a new session row and return its UUID."""
    assert source in ("live", "sd_import"), f"invalid source: {source!r}"
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO sessions (date, started_at, source, source_file) "
            "VALUES (COALESCE(%s::date, CURRENT_DATE), "
            "        COALESCE(%s, now()), %s, %s) "
            "RETURNING id",
            (started_at, started_at, source, source_file),
        )
        (session_id,) = cur.fetchone()
    conn.commit()
    return session_id


def insert_rt_batch(
    conn: psycopg.Connection, session_id: UUID, readings: Sequence[Reading]
) -> None:
    """Insert a batch of live readings into rt_readings."""
    if not readings:
        return
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO rt_readings (ts, session_id, signal_id, value) "
            "VALUES (%s, %s, %s, %s)",
            [(r.ts, session_id, r.signal_id, r.value) for r in readings],
        )
    conn.commit()


def end_session_and_flush(
    conn: psycopg.Connection, session_id: UUID
) -> int:
    """Move rt_readings rows to sd_readings and mark the session ended.

    Runs inside a single transaction. Returns the number of rows flushed.
    """
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO sd_readings (ts, session_id, signal_id, value) "
                "SELECT ts, session_id, signal_id, value "
                "FROM rt_readings WHERE session_id = %s",
                (session_id,),
            )
            moved = cur.rowcount
            cur.execute(
                "DELETE FROM rt_readings WHERE session_id = %s",
                (session_id,),
            )
            cur.execute(
                "UPDATE sessions "
                "SET ended_at = COALESCE("
                "  (SELECT max(ts) FROM sd_readings WHERE session_id = %s), "
                "  now()) "
                "WHERE id = %s",
                (session_id, session_id),
            )
    return moved


def copy_sd_readings(
    conn: psycopg.Connection,
    session_id: UUID,
    readings: Iterable[Reading],
) -> int:
    """Bulk-insert historical readings via COPY FROM STDIN.

    Returns the number of rows written. Intended for SD-import batch mode.
    """
    count = 0
    with conn.cursor() as cur:
        with cur.copy(
            "COPY sd_readings (ts, session_id, signal_id, value) FROM STDIN"
        ) as copy:
            for r in readings:
                copy.write_row((r.ts, session_id, r.signal_id, r.value))
                count += 1
    conn.commit()
    return count
```

- [ ] **Step 4: Run tests — expect 4 passing**

```bash
cd parser && .venv/bin/pytest tests/test_db.py -v
```

- [ ] **Step 5: Commit**

```bash
git add parser/db.py parser/tests/test_db.py
git commit -m "feat(parser): add psycopg db helpers for signals, sessions, readings"
```

---

### Task 3: `protocol.py` — stdout JSON emitter (TDD)

**Files:**
- Create: `parser/tests/test_protocol.py`
- Create: `parser/protocol.py`

- [ ] **Step 1: Write failing tests**

Create `parser/tests/test_protocol.py`:

```python
"""Tests for parser.protocol — newline-delimited JSON event emitter."""
from __future__ import annotations

import io
import json
from datetime import datetime, timezone

from protocol import ProtocolEmitter


def test_emits_single_event_as_one_json_line() -> None:
    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)
    emitter.serial_status("connected", port="/dev/ttyX")

    out = buf.getvalue()
    assert out.endswith("\n")
    (line,) = out.strip().splitlines()
    parsed = json.loads(line)
    assert parsed == {
        "type": "serial_status",
        "state": "connected",
        "port": "/dev/ttyX",
    }


def test_emits_frames_payload_preserves_row_order() -> None:
    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)
    ts = datetime(2026, 4, 22, 12, 0, tzinfo=timezone.utc)
    emitter.frames(
        [
            {"ts": ts, "signal_id": 1, "value": 1.5},
            {"ts": ts, "signal_id": 2, "value": -0.25},
        ]
    )

    parsed = json.loads(buf.getvalue())
    assert parsed["type"] == "frames"
    assert [r["signal_id"] for r in parsed["rows"]] == [1, 2]
    assert parsed["rows"][0]["ts"] == "2026-04-22T12:00:00+00:00"
    assert parsed["rows"][0]["value"] == 1.5


def test_emits_session_started_and_ended() -> None:
    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)

    emitter.session_started("abc-123", source="live")
    emitter.session_ended("abc-123", row_count=42)

    started, ended = [
        json.loads(l) for l in buf.getvalue().strip().splitlines()
    ]
    assert started == {
        "type": "session_started",
        "session_id": "abc-123",
        "source": "live",
    }
    assert ended == {
        "type": "session_ended",
        "session_id": "abc-123",
        "row_count": 42,
    }


def test_emits_import_progress_with_percentage_clamp() -> None:
    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)
    emitter.import_progress("x.nfr", pct=37.42)
    emitter.import_progress("x.nfr", pct=120.0)  # must clamp to 100
    emitter.import_progress("x.nfr", pct=-5.0)   # must clamp to 0

    lines = [json.loads(l) for l in buf.getvalue().strip().splitlines()]
    assert [l["pct"] for l in lines] == [37, 100, 0]


def test_emits_error_message_without_trailing_whitespace() -> None:
    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)
    emitter.error("something broke")
    assert buf.getvalue() == '{"type":"error","msg":"something broke"}\n'


def test_flushes_after_every_emit() -> None:
    class FakeStream:
        def __init__(self) -> None:
            self.buf: list[str] = []
            self.flush_calls = 0

        def write(self, s: str) -> int:
            self.buf.append(s)
            return len(s)

        def flush(self) -> None:
            self.flush_calls += 1

    fake = FakeStream()
    emitter = ProtocolEmitter(fake)
    emitter.serial_status("disconnected")
    emitter.error("boom")
    assert fake.flush_calls == 2
```

- [ ] **Step 2: Run — expect ImportError**

```bash
cd parser && .venv/bin/pytest tests/test_protocol.py -v
```

- [ ] **Step 3: Implement `parser/protocol.py`**

```python
"""Newline-delimited JSON emitter for parser → Electron main IPC.

Every call writes exactly one JSON object followed by a newline to the
provided stream and flushes. Keys are stable and match the protocol in the
design spec.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Mapping, Protocol, Sequence


class _WritableStream(Protocol):
    def write(self, s: str) -> int: ...
    def flush(self) -> None: ...


def _encode(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"unserializable: {type(value).__name__}")


class ProtocolEmitter:
    def __init__(self, stream: _WritableStream) -> None:
        self._stream = stream

    def _emit(self, payload: Mapping[str, Any]) -> None:
        line = json.dumps(payload, default=_encode, separators=(",", ":"))
        self._stream.write(line + "\n")
        self._stream.flush()

    def serial_status(self, state: str, *, port: str | None = None) -> None:
        body: dict[str, Any] = {"type": "serial_status", "state": state}
        if port is not None:
            body["port"] = port
        self._emit(body)

    def session_started(self, session_id: str, *, source: str) -> None:
        self._emit(
            {"type": "session_started", "session_id": session_id, "source": source}
        )

    def session_ended(self, session_id: str, *, row_count: int) -> None:
        self._emit(
            {"type": "session_ended", "session_id": session_id, "row_count": row_count}
        )

    def frames(self, rows: Sequence[Mapping[str, Any]]) -> None:
        self._emit({"type": "frames", "rows": list(rows)})

    def import_progress(self, file: str, *, pct: float) -> None:
        clamped = max(0, min(100, int(pct)))
        self._emit({"type": "import_progress", "file": file, "pct": clamped})

    def error(self, msg: str) -> None:
        self._emit({"type": "error", "msg": msg})
```

- [ ] **Step 4: Run tests — expect 6 passing**

- [ ] **Step 5: Commit**

```bash
git add parser/protocol.py parser/tests/test_protocol.py
git commit -m "feat(parser): add stdout JSON protocol emitter"
```

---

### Task 4: `nfr_reader.py` — .nfr log-file frame iterator (TDD)

**Files:**
- Create: `parser/tests/test_nfr_reader.py`
- Create: `parser/nfr_reader.py`

Factored out of the legacy `main.py` so `batch.py` and live tests can share it.

- [ ] **Step 1: Write failing tests**

Create `parser/tests/test_nfr_reader.py`:

```python
"""Tests for parser.nfr_reader — .nfr log file parser."""
from __future__ import annotations

import struct
from datetime import datetime, timezone
from pathlib import Path

from nfr_reader import HEADER_SIZE, FRAME_SIZE, iter_frames, read_header


def _build_log(tmp_path: Path, frames: list[tuple[int, int, bytes]]) -> Path:
    """Build a tiny .nfr file with a canned header + the given frames."""
    # Header: 9 filler bytes + (weekday, month, day, year)=(3,4,22,26)
    # + (hours=12, minutes=0, seconds=0, subseconds=0)
    header = bytes([0] * 9) + struct.pack("<BBBB", 3, 4, 22, 26) + struct.pack(
        "<BBBI", 12, 0, 0, 0
    )
    assert len(header) == HEADER_SIZE

    body = bytearray()
    for ts_ms, frame_id, data in frames:
        dlc = len(data)
        body += struct.pack("<IIH", ts_ms, frame_id, dlc)
        # Frame layout: 4 ts + 4 id + 2 dlc + 8 data payload slot
        padded = data + b"\x00" * (8 - dlc)
        body += padded

    path = tmp_path / "LOG_0001.NFR"
    path.write_bytes(header + bytes(body))
    return path


def test_read_header_decodes_date_and_start_dt(tmp_path: Path) -> None:
    log = _build_log(tmp_path, [])
    info = read_header(log)
    assert info.date == "2026-04-22"
    assert info.start_time == datetime(2026, 4, 22, 12, 0, tzinfo=timezone.utc)


def test_iter_frames_yields_every_frame_in_order(tmp_path: Path) -> None:
    log = _build_log(
        tmp_path,
        [
            (0, 0x123, b"\x01\x02"),
            (10, 0x456, b"\xff"),
            (20, 0x123, b""),
        ],
    )
    frames = list(iter_frames(log))
    assert [(ts, fid, bytes(d)) for ts, fid, d in frames] == [
        (0, 0x123, b"\x01\x02"),
        (10, 0x456, b"\xff"),
        (20, 0x123, b""),
    ]


def test_iter_frames_returns_nothing_if_header_truncated(tmp_path: Path) -> None:
    path = tmp_path / "short.NFR"
    path.write_bytes(b"\x00" * (HEADER_SIZE - 1))
    assert list(iter_frames(path)) == []


def test_iter_frames_stops_on_partial_trailing_frame(tmp_path: Path) -> None:
    log = _build_log(tmp_path, [(0, 0x123, b"\x01")])
    # Append an extra 5 bytes: not enough for a full frame.
    with log.open("ab") as f:
        f.write(b"\x00" * 5)
    frames = list(iter_frames(log))
    assert len(frames) == 1
```

- [ ] **Step 2: Run — expect ImportError**

- [ ] **Step 3: Implement `parser/nfr_reader.py`**

```python
"""Read .nfr binary log files into (timestamp_ms, frame_id, data) tuples.

Header layout (20 bytes):
  [0..8]   9 bytes of filler/version
  [9..12]  RtcDate: weekday, month, day, year (year = 2000 + year_byte)
  [13..19] RtcTime: hours, minutes, seconds, subseconds (uint32 ms)

Frame layout (18 bytes):
  [0..3]   timestamp_ms  (uint32 LE, relative to header start_time)
  [4..7]   frame_id      (uint32 LE)
  [8..9]   dlc           (uint16 LE)
  [10..17] data          (8 bytes; first `dlc` are valid payload)
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

HEADER_SIZE = 20
FRAME_SIZE = 18


@dataclass(frozen=True)
class HeaderInfo:
    date: str
    start_time: datetime


def read_header(path: Path) -> HeaderInfo:
    with open(path, "rb") as f:
        raw = f.read(HEADER_SIZE)
    if len(raw) < HEADER_SIZE:
        raise ValueError(f"{path}: file too short for header")
    _weekday, month, day, year = struct.unpack_from("<BBBB", raw, 9)
    hours, minutes, seconds, subseconds = struct.unpack_from("<BBBI", raw, 13)
    date_str = f"20{year:02d}-{month:02d}-{day:02d}"
    start_dt = datetime(
        2000 + year, month, day, hours, minutes, seconds,
        subseconds * 1000, tzinfo=timezone.utc,
    )
    return HeaderInfo(date=date_str, start_time=start_dt)


def iter_frames(path: Path) -> Iterator[tuple[int, int, bytes]]:
    with open(path, "rb") as f:
        header = f.read(HEADER_SIZE)
        if len(header) < HEADER_SIZE:
            return
        while True:
            frame = f.read(FRAME_SIZE)
            if len(frame) < FRAME_SIZE:
                return
            ts_ms, frame_id, dlc = struct.unpack_from("<IIH", frame, 0)
            yield ts_ms, frame_id, bytes(frame[10:10 + dlc])
```

- [ ] **Step 4: Run tests — expect 4 passing**

- [ ] **Step 5: Commit**

```bash
git add parser/nfr_reader.py parser/tests/test_nfr_reader.py
git commit -m "feat(parser): add nfr_reader for .nfr log file decoding"
```

---

### Task 5: `batch.py` — SD import mode (TDD)

**Files:**
- Create: `parser/tests/test_batch.py`
- Create: `parser/batch.py`

Decodes a single `.nfr` file end-to-end: open session (source=sd_import), upsert signal defs, COPY rows into `sd_readings`, set `ended_at = max(ts)`, emit progress.

- [ ] **Step 1: Write failing test**

Create `parser/tests/test_batch.py`:

```python
"""End-to-end test for parser.batch — SD log file import."""
from __future__ import annotations

import csv
import io
import json
import struct
from pathlib import Path

import psycopg
import pytest

from batch import run_batch_import
from nfr_reader import HEADER_SIZE
from protocol import ProtocolEmitter

DBC_CSV = """\
Message ID,Message Name,Sender,Signal Name,Start Bit,Bit Length,Signed,Scale,Offset,Unit
0x123,PDM_Status,PDM,bus_v,0,16,No,0.01,0,V
,PDM_Status,,fault,16,8,No,1,0,
0x456,BMS_SOE,BMS_SOE,soc,0,8,No,0.5,0,%
"""


def _write_dbc(tmp_path: Path) -> Path:
    p = tmp_path / "dbc.csv"
    p.write_text(DBC_CSV)
    return p


def _write_log(tmp_path: Path) -> Path:
    header = bytes([0] * 9) + struct.pack("<BBBB", 3, 4, 22, 26) + struct.pack(
        "<BBBI", 12, 0, 0, 0
    )
    body = bytearray()
    # PDM_Status: bus_v=1200 (12.00 V), fault=0; at ts=0, ts=100
    for ts_ms in (0, 100):
        payload = struct.pack("<HB", 1200, 0) + b"\x00" * 5
        body += struct.pack("<IIH", ts_ms, 0x123, 3) + payload
    # BMS_SOE: soc=180 (90.0%); at ts=50
    body += struct.pack("<IIH", 50, 0x456, 1) + struct.pack("<B", 180) + b"\x00" * 7
    log = tmp_path / "LOG_0001.NFR"
    log.write_bytes(header + bytes(body))
    return log


def test_run_batch_import_creates_session_and_rows(
    scratch_db: str, tmp_path: Path
) -> None:
    dbc = _write_dbc(tmp_path)
    log = _write_log(tmp_path)
    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)

    session_id = run_batch_import(
        dsn=scratch_db, dbc_csv=dbc, nfr_file=log, emitter=emitter
    )

    assert session_id is not None
    with psycopg.connect(scratch_db) as conn:
        sess = conn.execute(
            "SELECT source, source_file, ended_at FROM sessions WHERE id = %s",
            (session_id,),
        ).fetchone()
        assert sess is not None
        assert sess[0] == "sd_import"
        assert sess[1] == str(log)
        assert sess[2] is not None

        rows = conn.execute(
            "SELECT count(*) FROM sd_readings WHERE session_id = %s",
            (session_id,),
        ).fetchone()
        assert rows[0] == 5   # 2 frames x (bus_v, fault) + 1 frame x soc

        rt_rows = conn.execute(
            "SELECT count(*) FROM rt_readings WHERE session_id = %s",
            (session_id,),
        ).fetchone()
        assert rt_rows[0] == 0

    # Protocol: we expect session_started, at least one import_progress, session_ended
    lines = [json.loads(l) for l in buf.getvalue().strip().splitlines()]
    types = [l["type"] for l in lines]
    assert "session_started" in types
    assert "session_ended" in types
    # At least one progress event
    assert any(t == "import_progress" for t in types)


def test_run_batch_import_rejects_missing_file(
    scratch_db: str, tmp_path: Path
) -> None:
    dbc = _write_dbc(tmp_path)
    missing = tmp_path / "nope.NFR"
    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)
    with pytest.raises(FileNotFoundError):
        run_batch_import(dsn=scratch_db, dbc_csv=dbc, nfr_file=missing, emitter=emitter)
```

- [ ] **Step 2: Run — expect ImportError**

- [ ] **Step 3: Implement `parser/batch.py`**

```python
"""SD-import batch mode: decode one .nfr file into the local DB.

Flow:
  1. Compile the DBC CSV.
  2. Stream the .nfr file once to build the signal-definitions set and
     compute the end timestamp for the session. This is fast (binary read,
     no DB writes).
  3. Upsert signal_definitions; open a session row (source=sd_import).
  4. Stream the file again, COPY all decoded readings into sd_readings.
  5. Set ended_at = max(ts). Emit import_progress periodically and
     session_started / session_ended around the work.

Emits progress via a `ProtocolEmitter`; callers choose the stream.
"""
from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import Iterable
from uuid import UUID

import psycopg

from compile import compile_csv
from db import (
    Reading,
    SignalDef,
    copy_sd_readings,
    open_session,
    upsert_signal_definitions,
)
from decode import decode_frame
from nfr_reader import iter_frames, read_header
from protocol import ProtocolEmitter

PROGRESS_STEP_PCT = 10  # emit progress every 10% of file size


def run_batch_import(
    *,
    dsn: str,
    dbc_csv: Path,
    nfr_file: Path,
    emitter: ProtocolEmitter,
) -> UUID:
    if not nfr_file.is_file():
        raise FileNotFoundError(nfr_file)

    decode_table = compile_csv(str(dbc_csv))
    header = read_header(nfr_file)

    # Pass 1: collect signal defs + compute end timestamp.
    signal_units: dict[tuple[str, str], str] = {}
    sender_lookup: dict[tuple[int, str], str] = {}
    for msg in decode_table.values():
        sender = msg.sender or msg.name or "unknown"
        for sig in msg.signals:
            signal_units[(sender, sig.name)] = sig.unit or ""
            sender_lookup[(msg.frame_id, sig.name)] = sender

    signals_seen: set[tuple[str, str, str]] = set()
    last_ts_ms = 0
    for ts_ms, frame_id, data in iter_frames(nfr_file):
        decoded = decode_frame(frame_id, data, decode_table)
        if not decoded:
            continue
        for signal_name in decoded:
            sender = sender_lookup.get((frame_id, signal_name), "unknown")
            unit = signal_units.get((sender, signal_name), "")
            signals_seen.add((sender, signal_name, unit))
        if ts_ms > last_ts_ms:
            last_ts_ms = ts_ms

    # Pass 2: open session, upsert defs, COPY rows.
    with psycopg.connect(dsn) as conn:
        sig_id_map = upsert_signal_definitions(
            conn,
            [
                SignalDef(source=src, signal_name=name, unit=unit)
                for (src, name, unit) in signals_seen
            ],
        )
        session_id = open_session(
            conn,
            source="sd_import",
            source_file=str(nfr_file),
            started_at=header.start_time,
        )
        emitter.session_started(str(session_id), source="sd_import")

        next_progress_threshold = PROGRESS_STEP_PCT

        def _readings() -> Iterable[Reading]:
            nonlocal next_progress_threshold
            for ts_ms, frame_id, data in iter_frames(nfr_file):
                decoded = decode_frame(frame_id, data, decode_table)
                if not decoded:
                    continue
                ts = header.start_time + timedelta(milliseconds=ts_ms)
                for signal_name, value in decoded.items():
                    sender = sender_lookup.get((frame_id, signal_name), "unknown")
                    sig_id = sig_id_map.get((sender, signal_name))
                    if sig_id is None:
                        continue
                    yield Reading(ts=ts, signal_id=sig_id, value=float(value))

                # Emit periodic progress based on relative timestamp position.
                pct = min(99, int(100 * ts_ms / max(last_ts_ms, 1)))
                if pct >= next_progress_threshold:
                    emitter.import_progress(str(nfr_file), pct=pct)
                    next_progress_threshold += PROGRESS_STEP_PCT

        count = copy_sd_readings(conn, session_id, _readings())

        with conn.cursor() as cur:
            cur.execute(
                "UPDATE sessions "
                "SET ended_at = COALESCE("
                "  (SELECT max(ts) FROM sd_readings WHERE session_id = %s),"
                "  %s) "
                "WHERE id = %s",
                (session_id, header.start_time + timedelta(milliseconds=last_ts_ms), session_id),
            )
        conn.commit()

        emitter.import_progress(str(nfr_file), pct=100)
        emitter.session_ended(str(session_id), row_count=count)
        return session_id
```

- [ ] **Step 4: Run tests — expect 2 passing**

- [ ] **Step 5: Commit**

```bash
git add parser/batch.py parser/tests/test_batch.py
git commit -m "feat(parser): add SD import batch mode with COPY FROM STDIN"
```

---

### Task 6: `live.py` — auto-session live serial loop (TDD)

**Files:**
- Create: `parser/tests/test_live.py`
- Create: `parser/live.py`

The live runner takes a `frame_source` — an iterable of `(ts_ms, frame_id, data)` tuples plus connect/disconnect signals — so tests can inject a fake. The real CLI wraps a `serial.Serial` into this iterable.

- [ ] **Step 1: Write failing test**

Create `parser/tests/test_live.py`:

```python
"""Tests for parser.live — auto-session live loop."""
from __future__ import annotations

import io
import json
import struct
from pathlib import Path

import psycopg

from live import SourceEvent, run_live
from protocol import ProtocolEmitter


DBC_CSV = """\
Message ID,Message Name,Sender,Signal Name,Start Bit,Bit Length,Signed,Scale,Offset,Unit
0x123,PDM_Status,PDM,bus_v,0,16,No,0.01,0,V
"""


def _frames_for(bus_v_raw: int) -> bytes:
    return struct.pack("<H", bus_v_raw) + b"\x00" * 6


def test_run_live_opens_session_on_connect_and_flushes_on_disconnect(
    scratch_db: str, tmp_path: Path
) -> None:
    dbc = tmp_path / "dbc.csv"
    dbc.write_text(DBC_CSV)

    events: list[SourceEvent] = [
        SourceEvent(kind="connected", port="/dev/ttyFAKE"),
        SourceEvent(kind="frame", ts_ms=0, frame_id=0x123, data=_frames_for(1200)),
        SourceEvent(kind="frame", ts_ms=10, frame_id=0x123, data=_frames_for(1210)),
        SourceEvent(kind="disconnected"),
    ]

    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)

    summary = run_live(
        dsn=scratch_db, dbc_csv=dbc, source=iter(events), emitter=emitter
    )

    assert summary.sessions_closed == 1
    assert summary.rows_written == 2

    # DB state: one session, source=live, 2 sd_readings, 0 rt_readings
    with psycopg.connect(scratch_db) as conn:
        sess = conn.execute(
            "SELECT source, ended_at FROM sessions ORDER BY started_at DESC LIMIT 1"
        ).fetchone()
        assert sess[0] == "live"
        assert sess[1] is not None
        rt = conn.execute("SELECT count(*) FROM rt_readings").fetchone()[0]
        sd = conn.execute("SELECT count(*) FROM sd_readings").fetchone()[0]
    assert rt == 0
    assert sd == 2

    # Protocol events
    events_out = [json.loads(l) for l in buf.getvalue().strip().splitlines()]
    types = [e["type"] for e in events_out]
    assert types[0] == "serial_status"
    assert events_out[0]["state"] == "connected"
    assert "session_started" in types
    assert "frames" in types
    assert "session_ended" in types
    assert events_out[-1]["type"] == "serial_status"
    assert events_out[-1]["state"] == "disconnected"


def test_run_live_handles_reconnect_as_new_session(
    scratch_db: str, tmp_path: Path
) -> None:
    dbc = tmp_path / "dbc.csv"
    dbc.write_text(DBC_CSV)

    events: list[SourceEvent] = [
        SourceEvent(kind="connected", port="/dev/ttyA"),
        SourceEvent(kind="frame", ts_ms=0, frame_id=0x123, data=_frames_for(1000)),
        SourceEvent(kind="disconnected"),
        SourceEvent(kind="connected", port="/dev/ttyA"),
        SourceEvent(kind="frame", ts_ms=0, frame_id=0x123, data=_frames_for(2000)),
        SourceEvent(kind="disconnected"),
    ]
    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)

    summary = run_live(
        dsn=scratch_db, dbc_csv=dbc, source=iter(events), emitter=emitter
    )
    assert summary.sessions_closed == 2

    with psycopg.connect(scratch_db) as conn:
        sessions = conn.execute("SELECT count(*) FROM sessions").fetchone()[0]
    assert sessions == 2
```

- [ ] **Step 2: Run — expect ImportError**

- [ ] **Step 3: Implement `parser/live.py`**

```python
"""Live mode: consume frames from a source and maintain one session per
connect/disconnect cycle.

The source is an iterable of `SourceEvent` objects. The real serial runner
(wired up in `__main__.py`) converts a pyserial port and a reconnect loop
into this sequence; tests feed synthetic events.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

import psycopg

from compile import compile_csv
from db import (
    Reading,
    SignalDef,
    end_session_and_flush,
    insert_rt_batch,
    open_session,
    upsert_signal_definitions,
)
from decode import decode_frame
from protocol import ProtocolEmitter

BATCH_SIZE = 50
PROTOCOL_BATCH_ROWS = 100  # max rows per outbound `frames` message


@dataclass(frozen=True)
class SourceEvent:
    kind: str   # "connected" | "disconnected" | "frame"
    port: str | None = None
    ts_ms: int | None = None
    frame_id: int | None = None
    data: bytes | None = None


@dataclass(frozen=True)
class RunSummary:
    sessions_closed: int
    rows_written: int


def _make_sig_lookups(decode_table):
    sender_lookup: dict[tuple[int, str], str] = {}
    unit_lookup: dict[tuple[str, str], str] = {}
    defs: list[SignalDef] = []
    for msg in decode_table.values():
        sender = msg.sender or msg.name or "unknown"
        for sig in msg.signals:
            sender_lookup[(msg.frame_id, sig.name)] = sender
            unit_lookup[(sender, sig.name)] = sig.unit or ""
            defs.append(
                SignalDef(source=sender, signal_name=sig.name, unit=sig.unit or "")
            )
    return defs, sender_lookup


def run_live(
    *,
    dsn: str,
    dbc_csv: Path,
    source: Iterable[SourceEvent],
    emitter: ProtocolEmitter,
    connect_time: datetime | None = None,
) -> RunSummary:
    decode_table = compile_csv(str(dbc_csv))
    defs, sender_lookup = _make_sig_lookups(decode_table)

    sessions_closed = 0
    rows_written = 0

    with psycopg.connect(dsn) as conn:
        sig_id_map = upsert_signal_definitions(conn, defs)

        active_session = None  # UUID | None
        rt_batch: list[Reading] = []
        out_rows: list[dict] = []
        session_start: datetime | None = None

        def _flush_rt() -> None:
            nonlocal rt_batch
            if active_session is not None and rt_batch:
                insert_rt_batch(conn, active_session, rt_batch)
                rt_batch = []

        def _flush_out() -> None:
            nonlocal out_rows
            if out_rows:
                emitter.frames(out_rows)
                out_rows = []

        for evt in source:
            if evt.kind == "connected":
                emitter.serial_status("connected", port=evt.port)
                session_start = connect_time or datetime.now(timezone.utc)
                active_session = open_session(
                    conn, source="live", started_at=session_start
                )
                emitter.session_started(str(active_session), source="live")

            elif evt.kind == "frame":
                if active_session is None:
                    continue
                decoded = decode_frame(evt.frame_id, evt.data, decode_table)
                if not decoded:
                    continue
                ts = (session_start or datetime.now(timezone.utc)) + timedelta(
                    milliseconds=evt.ts_ms or 0
                )
                for signal_name, value in decoded.items():
                    sender = sender_lookup.get(
                        (evt.frame_id, signal_name), "unknown"
                    )
                    sig_id = sig_id_map.get((sender, signal_name))
                    if sig_id is None:
                        continue
                    rt_batch.append(
                        Reading(ts=ts, signal_id=sig_id, value=float(value))
                    )
                    out_rows.append(
                        {"ts": ts, "signal_id": sig_id, "value": float(value)}
                    )
                    rows_written += 1
                    if len(rt_batch) >= BATCH_SIZE:
                        _flush_rt()
                    if len(out_rows) >= PROTOCOL_BATCH_ROWS:
                        _flush_out()

            elif evt.kind == "disconnected":
                _flush_rt()
                _flush_out()
                if active_session is not None:
                    row_count = end_session_and_flush(conn, active_session)
                    emitter.session_ended(str(active_session), row_count=row_count)
                    sessions_closed += 1
                    active_session = None
                emitter.serial_status("disconnected")
                session_start = None

        # End-of-stream: close any open session.
        _flush_rt()
        _flush_out()
        if active_session is not None:
            row_count = end_session_and_flush(conn, active_session)
            emitter.session_ended(str(active_session), row_count=row_count)
            sessions_closed += 1

    return RunSummary(sessions_closed=sessions_closed, rows_written=rows_written)
```

- [ ] **Step 4: Run tests — expect 2 passing**

- [ ] **Step 5: Commit**

```bash
git add parser/live.py parser/tests/test_live.py
git commit -m "feat(parser): add live mode with auto-session lifecycle"
```

---

### Task 7: `__main__.py` — CLI glue + serial bridge (no tests; manual smoke)

**Files:**
- Create: `parser/__main__.py`
- Create: `parser/serial_source.py`

Wires `serial.Serial` into a `SourceEvent` iterable and exposes `python -m parser ...`. Serial-hardware behavior is not unit-testable here — we cover the surrounding logic in Task 6 and smoke-test this manually.

- [ ] **Step 1: Create `parser/serial_source.py`**

```python
"""Convert a reconnectable serial.Serial port into a SourceEvent stream."""
from __future__ import annotations

import struct
import time
from typing import Iterator

import serial

from live import SourceEvent
from nfr_reader import FRAME_SIZE

RECONNECT_INTERVAL = 2.0
IDLE_TIMEOUT = 10.0


def serial_events(
    port: str, baud: int = 9600, idle_timeout: float = IDLE_TIMEOUT
) -> Iterator[SourceEvent]:
    while True:
        try:
            ser = serial.Serial(port, baud, timeout=1)
        except serial.SerialException:
            time.sleep(RECONNECT_INTERVAL)
            continue

        yield SourceEvent(kind="connected", port=port)

        buf = b""
        last_data = time.time()
        try:
            while True:
                chunk = ser.read(max(1, ser.in_waiting))
                now = time.time()
                if chunk:
                    last_data = now
                    buf += chunk
                    while len(buf) >= FRAME_SIZE:
                        frame, buf = buf[:FRAME_SIZE], buf[FRAME_SIZE:]
                        ts_ms, frame_id, dlc = struct.unpack_from("<IIH", frame, 0)
                        data = frame[10:10 + dlc]
                        yield SourceEvent(
                            kind="frame",
                            ts_ms=ts_ms,
                            frame_id=frame_id,
                            data=bytes(data),
                        )
                elif now - last_data > idle_timeout:
                    raise TimeoutError
        except (serial.SerialException, OSError, TimeoutError):
            yield SourceEvent(kind="disconnected")
            try:
                ser.close()
            except Exception:  # noqa: BLE001
                pass
```

- [ ] **Step 2: Create `parser/__main__.py`**

```python
"""CLI entrypoint for the NFR 26 parser.

Usage:
  python -m parser live --dbc <csv> --port <device> [--baud 9600]
  python -m parser batch --dbc <csv> --file <nfr>

The DB connection string is read from the `NFR_DB_URL` environment variable
(default: `postgres://postgres@localhost:5432/nfr_local`).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from batch import run_batch_import
from live import run_live
from protocol import ProtocolEmitter
from serial_source import serial_events


DEFAULT_DSN = "postgres://postgres@localhost:5432/nfr_local"


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="parser")
    sub = p.add_subparsers(dest="mode", required=True)

    live = sub.add_parser("live", help="Read live frames from a serial port.")
    live.add_argument("--dbc", required=True, type=Path)
    live.add_argument("--port", required=True)
    live.add_argument("--baud", type=int, default=9600)

    batch = sub.add_parser("batch", help="Import a single .nfr log file.")
    batch.add_argument("--dbc", required=True, type=Path)
    batch.add_argument("--file", required=True, type=Path)

    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    dsn = os.environ.get("NFR_DB_URL", DEFAULT_DSN)
    emitter = ProtocolEmitter(sys.stdout)

    try:
        if args.mode == "live":
            run_live(
                dsn=dsn,
                dbc_csv=args.dbc,
                source=serial_events(args.port, args.baud),
                emitter=emitter,
            )
            return 0
        if args.mode == "batch":
            run_batch_import(
                dsn=dsn, dbc_csv=args.dbc, nfr_file=args.file, emitter=emitter
            )
            return 0
    except Exception as err:  # noqa: BLE001
        emitter.error(str(err))
        return 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Smoke-test the batch path against a real fixture file**

Pick the smallest file in `parser/testData/`:

```bash
cd parser
ls -S testData/3-10-26/*.NFR | tail -1
```

Run batch against it, targeting the scratch DB pattern (use a fresh database you create manually):

```bash
psql -h localhost -U postgres -c "CREATE DATABASE nfr_local_smoke"
for f in ../desktop/migrations/*.sql; do
  psql -h localhost -U postgres -d nfr_local_smoke -f "$f"
done
NFR_DB_URL="postgres://postgres@localhost:5432/nfr_local_smoke" \
  .venv/bin/python -m parser batch \
    --dbc ../NFR26DBC.csv \
    --file testData/3-10-26/LOG_0002.NFR
```

Expected stdout: a `session_started` line, one or more `import_progress` lines, exactly one `session_ended`. Verify:

```bash
psql -h localhost -U postgres -d nfr_local_smoke -c \
  "SELECT source, source_file, ended_at FROM sessions"
psql -h localhost -U postgres -d nfr_local_smoke -c \
  "SELECT count(*) FROM sd_readings"
```

Expected: one `sd_import` session row, thousands of readings. Drop the scratch DB when done:

```bash
psql -h localhost -U postgres -c "DROP DATABASE nfr_local_smoke"
```

- [ ] **Step 4: Run the full parser test suite**

```bash
cd parser && .venv/bin/pytest -v
```

Expected: all previous tests (harness 2 + db 4 + protocol 6 + nfr_reader 4 + batch 2 + live 2 = 20) still pass.

- [ ] **Step 5: Commit**

```bash
git add parser/__main__.py parser/serial_source.py
git commit -m "feat(parser): add CLI entrypoint and serial source bridge"
```

---

## Exit criteria for Plan 2

- `cd parser && .venv/bin/pytest` passes with 20 tests.
- `python -m parser batch --dbc <csv> --file <.nfr>` produces a `sd_import` session row and populates `sd_readings`.
- `python -m parser live --dbc <csv> --port <device>` connects, auto-creates sessions on serial connect, flushes `rt_readings` → `sd_readings` on disconnect, and emits the newline-delimited JSON protocol on stdout.
- `compile.py`, `decode.py`, `signalSpec.py` are unchanged.
- Plan 3 (Electron main + Fastify) can spawn `python -m parser` as a child process and consume stdout JSON without any further parser changes.
