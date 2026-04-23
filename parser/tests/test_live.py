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
Message ID,Message Name,Sender,Signal Name,Start Bit,Size (bits),Factor,Offset,Unit,Data Type
0x123,PDM_Status,PDM,bus_v,0,16,0.01,0,V,uint16
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
