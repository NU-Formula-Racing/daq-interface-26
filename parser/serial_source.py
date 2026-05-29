"""Convert a reconnectable serial.Serial port into a SourceEvent stream.

Wire format from the LoRa basestation (telemetry-26 base-station firmware,
processIncomingPackets):

  +------+-----+-----+----------------+
  | rssi | snr | len | payload[len]   |
  | i16  | f32 | u8  | len bytes      |
  +------+-----+-----+----------------+

`len` is the byte count of `payload`. `payload` is a packed sequence of
18-byte can::CanFrame records (defined in core/drivers/can/can_types.hpp):

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

import math
import struct
import time
from typing import Iterator

import serial

from live import SourceEvent
from nfr_reader import FRAME_SIZE

RECONNECT_INTERVAL = 2.0
IDLE_TIMEOUT = 10.0

HEADER_SIZE = 2 + 4 + 1  # rssi + snr + len = 7 bytes
HEADER_STRUCT = struct.Struct("<hfB")  # rssi (i16), snr (f32), len (u8)


def _parse_packets(buf: bytes) -> tuple[list[SourceEvent], bytes]:
    """Drain as many complete USB packets as possible from `buf`.

    Returns (events_in_order, remaining_bytes). Stream is assumed to be
    byte-aligned to a packet boundary; if a payload size is not a multiple
    of FRAME_SIZE, we drop one byte and try to resync.
    """
    events: list[SourceEvent] = []
    i = 0
    while i + HEADER_SIZE <= len(buf):
        rssi, snr, payload_size = HEADER_STRUCT.unpack_from(buf, i)

        # Resync sanity checks: when we land on a misaligned header (after
        # a real desync, dropped byte, or junk prefix), the bytes we read
        # as rssi/snr/payload_size will almost always look obviously wrong.
        # Each check below filters out a class of garbage; combined they
        # cut the false-positive resync rate by orders of magnitude.
        #
        # The basestation never sends empty payloads (a packet always
        # carries at least one CanFrame), so payload_size == 0 means we
        # are misaligned.
        if payload_size == 0:
            i += 1
            continue
        # LoRa RSSI is in dBm and physically bounded; values outside
        # [-150, 20] dBm are not legitimate link measurements.
        if rssi < -150 or rssi > 20:
            i += 1
            continue
        # SNR comes through as float32; misaligned reads regularly produce
        # NaN/inf or huge magnitudes. Real link SNR sits in [-30, 30] dB.
        if not math.isfinite(snr) or snr < -30.0 or snr > 30.0:
            i += 1
            continue
        # Each CanFrame is exactly FRAME_SIZE bytes, so any valid payload
        # must be a multiple of FRAME_SIZE. A misaligned read will almost
        # always have a fractional length here.
        if payload_size % FRAME_SIZE != 0:
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
