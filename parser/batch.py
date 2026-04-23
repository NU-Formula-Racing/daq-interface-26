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
