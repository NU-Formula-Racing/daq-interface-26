"""Tests for the LoRa→USB wire-format parser in serial_source._parse_packets."""
from __future__ import annotations

import struct

from serial_source import _parse_packets


def _can_frame(ts_ms: int, frame_id: int, data: bytes) -> bytes:
    """Pack one 18-byte can::CanFrame matching core/drivers/can/can_types.hpp."""
    assert len(data) <= 8
    padded = data + b"\x00" * (8 - len(data))
    return struct.pack("<II", ts_ms, frame_id) + bytes([len(data), 0x00]) + padded


def _packet(rssi: int, snr: float, frames: list[bytes]) -> bytes:
    payload = b"".join(frames)
    return b"\xAA\x55" + struct.pack("<hfH", rssi, snr, len(payload)) + payload


def test_single_packet_one_frame() -> None:
    pkt = _packet(-42, 7.5, [_can_frame(123, 0x100, b"\x01\x02\x03")])
    events, rest = _parse_packets(pkt)
    assert rest == b""
    assert [e.kind for e in events] == ["signal_quality", "frame"]
    assert events[0].rssi == -42
    assert abs((events[0].snr or 0) - 7.5) < 1e-5
    assert events[1].frame_id == 0x100
    assert events[1].ts_ms == 123
    assert events[1].data == b"\x01\x02\x03"


def test_single_packet_multiple_frames() -> None:
    frames = [
        _can_frame(100, 0x10, b"\xAA"),
        _can_frame(200, 0x20, b"\xBB\xCC"),
        _can_frame(300, 0x30, b"\xDD\xEE\xFF"),
    ]
    pkt = _packet(-50, 6.0, frames)
    events, rest = _parse_packets(pkt)
    assert rest == b""
    kinds = [e.kind for e in events]
    assert kinds == ["signal_quality", "frame", "frame", "frame"]
    assert [e.frame_id for e in events if e.kind == "frame"] == [0x10, 0x20, 0x30]


def test_buffer_holds_partial_packet() -> None:
    pkt = _packet(-30, 3.0, [_can_frame(1, 0x200, b"\xFF")])
    # Feed all but the last byte.
    events, rest = _parse_packets(pkt[:-1])
    assert events == []
    assert rest == pkt[:-1]
    # Now feed the rest — should drain cleanly.
    events, rest = _parse_packets(rest + pkt[-1:])
    assert rest == b""
    assert any(e.kind == "frame" and e.frame_id == 0x200 for e in events)


def test_resync_skips_garbage_before_sync() -> None:
    pkt = _packet(0, 0.0, [_can_frame(7, 0x300, b"")])
    junk = b"\x00\x01\x02\x03\x04"
    events, rest = _parse_packets(junk + pkt)
    assert rest == b""
    assert any(e.kind == "frame" and e.frame_id == 0x300 for e in events)


def test_oversized_payload_treated_as_garbage() -> None:
    # Fake header with payload_size = 9999 (way over MAX_PAYLOAD). Parser
    # must NOT block waiting for 10k bytes — it must advance past the sync
    # and look for the next one.
    bogus = b"\xAA\x55" + struct.pack("<hfH", 0, 0.0, 9999) + b"\x00" * 5
    pkt = _packet(-10, 1.0, [_can_frame(42, 0x400, b"\xCA\xFE")])
    events, rest = _parse_packets(bogus + pkt)
    # Real packet still recovered.
    assert any(e.kind == "frame" and e.frame_id == 0x400 for e in events)
    # No infinite stall.
    assert len(rest) < 16
