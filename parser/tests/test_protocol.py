"""Tests for parser.protocol — newline-delimited JSON event emitter."""
from __future__ import annotations

import io
import json
from datetime import datetime, timezone

from protocol import ProtocolEmitter


def test_emits_single_event_as_one_json_line() -> None:
    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)
    emitter.serial_status("connected", port="/dev/ttyX")

    out = buf.getvalue()
    assert out.endswith("\n")
    (line,) = out.strip().splitlines()
    parsed = json.loads(line)
    assert parsed == {
        "type": "serial_status",
        "state": "connected",
        "port": "/dev/ttyX",
    }


def test_emits_frames_payload_preserves_row_order() -> None:
    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)
    ts = datetime(2026, 4, 22, 12, 0, tzinfo=timezone.utc)
    emitter.frames(
        [
            {"ts": ts, "signal_id": 1, "value": 1.5},
            {"ts": ts, "signal_id": 2, "value": -0.25},
        ]
    )

    parsed = json.loads(buf.getvalue())
    assert parsed["type"] == "frames"
    assert [r["signal_id"] for r in parsed["rows"]] == [1, 2]
    assert parsed["rows"][0]["ts"] == "2026-04-22T12:00:00+00:00"
    assert parsed["rows"][0]["value"] == 1.5


def test_emits_session_started_and_ended() -> None:
    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)

    emitter.session_started("abc-123", source="live")
    emitter.session_ended("abc-123", row_count=42)

    started, ended = [
        json.loads(l) for l in buf.getvalue().strip().splitlines()
    ]
    assert started == {
        "type": "session_started",
        "session_id": "abc-123",
        "source": "live",
    }
    assert ended == {
        "type": "session_ended",
        "session_id": "abc-123",
        "row_count": 42,
    }


def test_emits_import_progress_with_percentage_clamp() -> None:
    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)
    emitter.import_progress("x.nfr", pct=37.42)
    emitter.import_progress("x.nfr", pct=120.0)  # must clamp to 100
    emitter.import_progress("x.nfr", pct=-5.0)   # must clamp to 0

    lines = [json.loads(l) for l in buf.getvalue().strip().splitlines()]
    assert [l["pct"] for l in lines] == [37, 100, 0]


def test_emits_error_message_without_trailing_whitespace() -> None:
    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)
    emitter.error("something broke")
    assert buf.getvalue() == '{"type":"error","msg":"something broke"}\n'


def test_flushes_after_every_emit() -> None:
    class FakeStream:
        def __init__(self) -> None:
            self.buf: list[str] = []
            self.flush_calls = 0

        def write(self, s: str) -> int:
            self.buf.append(s)
            return len(s)

        def flush(self) -> None:
            self.flush_calls += 1

    fake = FakeStream()
    emitter = ProtocolEmitter(fake)
    emitter.serial_status("disconnected")
    emitter.error("boom")
    assert fake.flush_calls == 2
