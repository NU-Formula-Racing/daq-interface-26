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
