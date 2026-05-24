"""Convert a reconnectable serial.Serial port into a SourceEvent stream.

Wire format from the LoRa basestation (telemetry-26 base-station firmware,
processIncomingPackets):

  +--------+------+-----+-------------+-----------------+
  | sync   | rssi | snr | payload_sz  | payload[ps]     |
  | 2 B    | i16  | f32 | u16         | ps bytes        |
  | AA 55  |      |     |             |                 |
  +--------+------+-----+-------------+-----------------+

`payload` is a packed sequence of 18-byte can::CanFrame records (defined in
core/drivers/can/can_types.hpp):

  CanFrame {
    uint32_t timestamp;
    uint32_t id;
    uint8_t  dlc;
    uint8_t  idType;
    uint8_t  data[8];
  };  // pack(1) → 18 bytes

Each CanFrame in a packet is emitted as a SourceEvent(kind="frame"). One
signal_quality event is emitted per USB packet, carrying the LoRa-link
rssi and snr for the most recent packet so the UI can show link health.
"""
from __future__ import annotations

import struct
import time
from typing import Iterator

import serial

from live import SourceEvent
from nfr_reader import FRAME_SIZE

RECONNECT_INTERVAL = 2.0
IDLE_TIMEOUT = 10.0

SYNC_BYTES = b"\xAA\x55"
HEADER_SIZE = 2 + 2 + 4 + 2  # sync + rssi + snr + payload_size = 10 bytes
HEADER_STRUCT = struct.Struct("<2shfH")  # sync, rssi (i16), snr (f32), size (u16)
# Sanity: refuse to read pathologically large payloads — the LoRa FIFO is
# 255 bytes, so > 512 is certainly desync garbage.
MAX_PAYLOAD = 512


def _parse_packets(buf: bytes) -> tuple[list[SourceEvent], bytes]:
    """Drain as many complete USB packets as possible from `buf`.

    Returns (events_in_order, remaining_bytes). On a desync (bad sync bytes
    or absurd payload size), advances one byte at a time until the next
    valid-looking sync. This makes the parser self-recovering after a
    partial-buffer startup or a basestation reset.
    """
    events: list[SourceEvent] = []
    i = 0
    while i + HEADER_SIZE <= len(buf):
        # Resync to the next 0xAA 0x55 if needed.
        if buf[i : i + 2] != SYNC_BYTES:
            nxt = buf.find(SYNC_BYTES, i + 1)
            if nxt < 0:
                # Keep the last byte in case it's the start of a future sync.
                i = max(i, len(buf) - 1)
                break
            i = nxt
            continue

        sync, rssi, snr, payload_size = HEADER_STRUCT.unpack_from(buf, i)
        if payload_size > MAX_PAYLOAD:
            # Definitely garbage — skip past this sync and try again.
            i += 1
            continue
        if i + HEADER_SIZE + payload_size > len(buf):
            # Wait for the rest of this packet to arrive.
            break

        payload_start = i + HEADER_SIZE
        payload_end = payload_start + payload_size

        # Emit one signal_quality event per packet so the UI can show link
        # health independently of frame rate. ts_ms left as None — this is
        # a basestation-side measurement, not a CAN-bus timestamp.
        events.append(SourceEvent(kind="signal_quality", rssi=rssi, snr=snr))

        # Split the payload into 18-byte CanFrame records. Any trailing
        # bytes shorter than FRAME_SIZE are ignored (would indicate the
        # basestation sent an unaligned payload — log via desync recovery).
        off = payload_start
        while off + FRAME_SIZE <= payload_end:
            ts_ms, frame_id, dlc = struct.unpack_from("<IIH", buf, off)
            data = bytes(buf[off + 10 : off + 10 + min(dlc, 8)])
            events.append(
                SourceEvent(
                    kind="frame",
                    ts_ms=ts_ms,
                    frame_id=frame_id,
                    data=data,
                )
            )
            off += FRAME_SIZE

        i = payload_end

    return events, buf[i:]


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
                    events, buf = _parse_packets(buf)
                    for ev in events:
                        yield ev
                elif now - last_data > idle_timeout:
                    raise TimeoutError
        except (serial.SerialException, OSError, TimeoutError):
            yield SourceEvent(kind="disconnected")
            try:
                ser.close()
            except Exception:  # noqa: BLE001
                pass
