"""End-to-end: replay an .nfr file through run_live and verify DB state."""
from __future__ import annotations

import io
import json
import struct
from pathlib import Path

import psycopg

from file_source import file_events
from live import run_live
from protocol import ProtocolEmitter


DBC_CSV = """\
Message ID,Message Name,Sender,Signal Name,Start Bit,Size (bits),Factor,Offset,Unit,Data Type
0x123,PDM_Status,PDM,bus_v,0,16,0.01,0,V,Unsigned
"""


def _build_log(tmp_path: Path, frames: list[tuple[int, int, bytes]]) -> Path:
    header = bytes([0] * 9) + struct.pack("<BBBB", 3, 4, 22, 26) + struct.pack(
        "<BBBI", 12, 0, 0, 0
    )
    body = bytearray()
    for ts_ms, frame_id, data in frames:
        dlc = len(data)
        body += struct.pack("<IIH", ts_ms, frame_id, dlc)
        body += data + b"\x00" * (8 - dlc)
    log = tmp_path / "REPLAY.NFR"
    log.write_bytes(header + bytes(body))
    return log


def test_replay_drives_live_session_end_to_end(
    scratch_db: str, tmp_path: Path
) -> None:
    dbc = tmp_path / "dbc.csv"
    dbc.write_text(DBC_CSV)

    log = _build_log(
        tmp_path,
        [
            (0, 0x123, struct.pack("<H", 1000) + b"\x00" * 6),
            (10, 0x123, struct.pack("<H", 1200) + b"\x00" * 6),
            (20, 0x123, struct.pack("<H", 1400) + b"\x00" * 6),
        ],
    )

    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)

    summary = run_live(
        dsn=scratch_db,
        dbc_csv=dbc,
        source=file_events(log, speed=0.0),
        emitter=emitter,
    )

    assert summary.sessions_closed == 1
    assert summary.rows_written == 3

    with psycopg.connect(scratch_db) as conn:
        sess = conn.execute(
            "SELECT source, ended_at FROM sessions"
        ).fetchone()
        assert sess[0] == "live"
        assert sess[1] is not None
        sd = conn.execute("SELECT count(*) FROM sd_readings").fetchone()[0]
        rt = conn.execute("SELECT count(*) FROM rt_readings").fetchone()[0]
    assert sd == 3
    assert rt == 0

    events = [json.loads(l) for l in buf.getvalue().strip().splitlines()]
    types = [e["type"] for e in events]
    assert types[0] == "serial_status"
    assert events[0]["state"] == "connected"
    assert "session_started" in types
    assert "frames" in types
    assert "session_ended" in types
    assert types[-1] == "serial_status"
    assert events[-1]["state"] == "disconnected"
