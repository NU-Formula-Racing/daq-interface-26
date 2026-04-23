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
    defs: list[SignalDef] = []
    for msg in decode_table.values():
        sender = msg.sender or msg.name or "unknown"
        for sig in msg.signals:
            sender_lookup[(msg.frame_id, sig.name)] = sender
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
