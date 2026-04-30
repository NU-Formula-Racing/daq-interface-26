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

import hashlib
from datetime import timedelta
from pathlib import Path
from typing import Iterable
from uuid import UUID, uuid5

import psycopg

# Stable namespace for deriving session UUIDs from .nfr file content. Two
# devices that import the same file get the same session_id, so cloud sync
# deduplicates automatically. Generated once and frozen — do not change.
_NFR_SESSION_NAMESPACE = UUID("8c4b2f6e-3a91-4d20-9c7e-1a5f8b9d2c33")


def session_id_from_file(nfr_file: Path) -> UUID:
    h = hashlib.sha256()
    with open(nfr_file, "rb") as f:
        for chunk in iter(lambda: f.read(64 * 1024), b""):
            h.update(chunk)
    return uuid5(_NFR_SESSION_NAMESPACE, h.hexdigest())

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
        deterministic_id = session_id_from_file(nfr_file)
        session_id = open_session(
            conn,
            source="sd_import",
            source_file=str(nfr_file),
            started_at=header.start_time,
            session_id=deterministic_id,
        )

        # If this exact file has been imported before, the session row already
        # exists and so do its readings — skip the COPY pass and report the
        # existing session as "ended" with whatever count is in the table.
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM sd_readings WHERE session_id = %s",
                (str(session_id),),
            )
            (existing_rows,) = cur.fetchone()
        if existing_rows > 0:
            emitter.session_started(str(session_id), source="sd_import")
            emitter.import_progress(str(nfr_file), pct=100)
            emitter.session_ended(str(session_id), row_count=int(existing_rows))
            return session_id

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
