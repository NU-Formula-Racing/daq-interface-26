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
