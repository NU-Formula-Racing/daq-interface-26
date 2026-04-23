"""End-to-end test for parser.batch — SD log file import."""
from __future__ import annotations

import io
import json
import struct
from pathlib import Path

import psycopg
import pytest

from batch import run_batch_import
from protocol import ProtocolEmitter


DBC_CSV = """\
Message ID,Message Name,Sender,Signal Name,Start Bit,Size (bits),Factor,Offset,Unit,Data Type
0x123,PDM_Status,PDM,bus_v,0,16,0.01,0,V,uint16
,PDM_Status,,fault,16,8,1,0,,uint8
0x456,BMS_SOE,BMS_SOE,soc,0,8,0.5,0,%,uint8
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
