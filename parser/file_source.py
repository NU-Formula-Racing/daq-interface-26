"""Convert an .nfr log file into a SourceEvent stream with paced timestamps.

Use this in place of `serial_source.serial_events` when testing the live
stack without a basestation. Speed controls the playback rate:
  - speed == 1.0  → real time (frames emerge at their recorded cadence)
  - speed == 10.0 → 10x faster than real time
  - speed == 0.0  → no delay (flood as fast as possible; good for CI smoke)
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Iterator

from live import SourceEvent
from nfr_reader import iter_frames


def file_events(path: Path, speed: float = 1.0) -> Iterator[SourceEvent]:
    if speed < 0:
        raise ValueError(f"speed must be >= 0, got {speed!r}")

    yield SourceEvent(kind="connected", port=f"file://{path}")

    wall_start = time.monotonic()
    first_ts_ms: int | None = None

    for ts_ms, frame_id, data in iter_frames(path):
        if speed > 0:
            if first_ts_ms is None:
                first_ts_ms = ts_ms
            target_offset = (ts_ms - first_ts_ms) / 1000.0 / speed
            now_offset = time.monotonic() - wall_start
            sleep_for = target_offset - now_offset
            if sleep_for > 0:
                time.sleep(sleep_for)
        yield SourceEvent(
            kind="frame", ts_ms=ts_ms, frame_id=frame_id, data=data
        )

    yield SourceEvent(kind="disconnected")
