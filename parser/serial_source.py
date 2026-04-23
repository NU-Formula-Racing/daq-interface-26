"""Convert a reconnectable serial.Serial port into a SourceEvent stream."""
from __future__ import annotations

import struct
import time
from typing import Iterator

import serial

from live import SourceEvent
from nfr_reader import FRAME_SIZE

RECONNECT_INTERVAL = 2.0
IDLE_TIMEOUT = 10.0


def serial_events(
    port: str, baud: int = 9600, idle_timeout: float = IDLE_TIMEOUT
) -> Iterator[SourceEvent]:
    while True:
        try:
            ser = serial.Serial(port, baud, timeout=1)
        except serial.SerialException:
            time.sleep(RECONNECT_INTERVAL)
            continue

        yield SourceEvent(kind="connected", port=port)

        buf = b""
        last_data = time.time()
        try:
            while True:
                chunk = ser.read(max(1, ser.in_waiting))
                now = time.time()
                if chunk:
                    last_data = now
                    buf += chunk
                    while len(buf) >= FRAME_SIZE:
                        frame, buf = buf[:FRAME_SIZE], buf[FRAME_SIZE:]
                        ts_ms, frame_id, dlc = struct.unpack_from("<IIH", frame, 0)
                        data = frame[10:10 + dlc]
                        yield SourceEvent(
                            kind="frame",
                            ts_ms=ts_ms,
                            frame_id=frame_id,
                            data=bytes(data),
                        )
                elif now - last_data > idle_timeout:
                    raise TimeoutError
        except (serial.SerialException, OSError, TimeoutError):
            yield SourceEvent(kind="disconnected")
            try:
                ser.close()
            except Exception:  # noqa: BLE001
                pass
