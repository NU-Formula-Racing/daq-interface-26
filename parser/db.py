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
        sources = [d.source for d in defs]
        names = [d.signal_name for d in defs]
        cur.execute(
            "SELECT sd.id, sd.source, sd.signal_name FROM signal_definitions sd "
            "JOIN unnest(%s::text[], %s::text[]) AS t(source, signal_name) "
            "  ON sd.source = t.source AND sd.signal_name = t.signal_name",
            (sources, names),
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
    if source not in ("live", "sd_import"):
        raise ValueError(f"invalid source: {source!r}")
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
