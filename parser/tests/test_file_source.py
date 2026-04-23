"""Tests for parser.file_source — .nfr file → SourceEvent stream."""
from __future__ import annotations

import struct
import time
from pathlib import Path

from file_source import file_events
from nfr_reader import HEADER_SIZE


def _build_log(tmp_path: Path, frames: list[tuple[int, int, bytes]]) -> Path:
    header = bytes([0] * 9) + struct.pack("<BBBB", 3, 4, 22, 26) + struct.pack(
        "<BBBI", 12, 0, 0, 0
    )
    body = bytearray()
    for ts_ms, frame_id, data in frames:
        dlc = len(data)
        body += struct.pack("<IIH", ts_ms, frame_id, dlc)
        body += data + b"\x00" * (8 - dlc)
    log = tmp_path / "LOG.NFR"
    log.write_bytes(header + bytes(body))
    return log


def test_file_events_yields_connected_frames_disconnected(tmp_path: Path) -> None:
    log = _build_log(tmp_path, [(0, 0x123, b"\x01"), (10, 0x456, b"\x02")])
    events = list(file_events(log, speed=0.0))
    kinds = [e.kind for e in events]
    assert kinds == ["connected", "frame", "frame", "disconnected"]
    assert events[1].frame_id == 0x123
    assert events[1].ts_ms == 0
    assert events[2].frame_id == 0x456
    assert events[2].ts_ms == 10


def test_file_events_at_speed_zero_has_no_delay(tmp_path: Path) -> None:
    frames = [(i * 1000, 0x123, b"\x01") for i in range(5)]
    log = _build_log(tmp_path, frames)
    start = time.monotonic()
    events = list(file_events(log, speed=0.0))
    elapsed = time.monotonic() - start
    assert elapsed < 0.2
    assert len(events) == 7


def test_file_events_respects_speed_multiplier(tmp_path: Path) -> None:
    frames = [(0, 0x123, b"\x01"), (500, 0x123, b"\x02")]
    log = _build_log(tmp_path, frames)
    start = time.monotonic()
    events = list(file_events(log, speed=10.0))
    elapsed = time.monotonic() - start
    assert 0.02 < elapsed < 0.5
    assert len(events) == 4
