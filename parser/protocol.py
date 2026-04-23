"""Newline-delimited JSON emitter for parser → Electron main IPC.

Every call writes exactly one JSON object followed by a newline to the
provided stream and flushes. Keys are stable and match the protocol in the
design spec.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Mapping, Protocol, Sequence


class _WritableStream(Protocol):
    def write(self, s: str) -> int: ...
    def flush(self) -> None: ...


def _encode(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"unserializable: {type(value).__name__}")


class ProtocolEmitter:
    def __init__(self, stream: _WritableStream) -> None:
        self._stream = stream

    def _emit(self, payload: Mapping[str, Any]) -> None:
        line = json.dumps(payload, default=_encode, separators=(",", ":"))
        self._stream.write(line + "\n")
        self._stream.flush()

    def serial_status(self, state: str, *, port: str | None = None) -> None:
        body: dict[str, Any] = {"type": "serial_status", "state": state}
        if port is not None:
            body["port"] = port
        self._emit(body)

    def session_started(self, session_id: str, *, source: str) -> None:
        self._emit(
            {"type": "session_started", "session_id": session_id, "source": source}
        )

    def session_ended(self, session_id: str, *, row_count: int) -> None:
        self._emit(
            {"type": "session_ended", "session_id": session_id, "row_count": row_count}
        )

    def frames(self, rows: Sequence[Mapping[str, Any]]) -> None:
        self._emit({"type": "frames", "rows": list(rows)})

    def import_progress(self, file: str, *, pct: float) -> None:
        clamped = max(0, min(100, int(pct)))
        self._emit({"type": "import_progress", "file": file, "pct": clamped})

    def error(self, msg: str) -> None:
        self._emit({"type": "error", "msg": msg})
