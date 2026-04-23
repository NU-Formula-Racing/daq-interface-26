"""Tests for parser.db — psycopg helpers for local Postgres."""
from __future__ import annotations

from datetime import datetime, timezone

import psycopg
import pytest

from db import (
    Reading,
    SignalDef,
    copy_sd_readings,
    end_session_and_flush,
    insert_rt_batch,
    open_session,
    upsert_signal_definitions,
)


def test_upsert_signal_definitions_returns_id_map(scratch_db: str) -> None:
    defs = [
        SignalDef(source="PDM", signal_name="bus_voltage", unit="V"),
        SignalDef(source="BMS_SOE", signal_name="soc", unit="%"),
    ]
    with psycopg.connect(scratch_db) as conn:
        ids = upsert_signal_definitions(conn, defs)

    assert set(ids.keys()) == {
        ("PDM", "bus_voltage"),
        ("BMS_SOE", "soc"),
    }
    assert all(isinstance(v, int) for v in ids.values())


def test_upsert_signal_definitions_is_idempotent(scratch_db: str) -> None:
    defs = [SignalDef(source="PDM", signal_name="bus_voltage", unit="V")]
    with psycopg.connect(scratch_db) as conn:
        first = upsert_signal_definitions(conn, defs)
        second = upsert_signal_definitions(conn, defs)
    assert first == second


def test_open_and_end_session_flushes_rt_to_sd(scratch_db: str) -> None:
    with psycopg.connect(scratch_db) as conn:
        ids = upsert_signal_definitions(
            conn, [SignalDef(source="PDM", signal_name="v", unit="V")]
        )
        sig_id = ids[("PDM", "v")]

        session_id = open_session(conn, source="live")
        started_at = datetime.now(timezone.utc)

        insert_rt_batch(
            conn,
            session_id,
            [
                Reading(ts=started_at, signal_id=sig_id, value=12.3),
                Reading(ts=started_at, signal_id=sig_id, value=12.4),
            ],
        )

        rt_count = conn.execute(
            "SELECT count(*) FROM rt_readings WHERE session_id = %s",
            (session_id,),
        ).fetchone()[0]
        assert rt_count == 2

        row_count = end_session_and_flush(conn, session_id)
        assert row_count == 2

        rt_after = conn.execute(
            "SELECT count(*) FROM rt_readings WHERE session_id = %s",
            (session_id,),
        ).fetchone()[0]
        sd_after = conn.execute(
            "SELECT count(*) FROM sd_readings WHERE session_id = %s",
            (session_id,),
        ).fetchone()[0]
        ended_at = conn.execute(
            "SELECT ended_at FROM sessions WHERE id = %s",
            (session_id,),
        ).fetchone()[0]

    assert rt_after == 0
    assert sd_after == 2
    assert ended_at is not None


def test_copy_sd_readings_bulk_inserts_directly(scratch_db: str) -> None:
    with psycopg.connect(scratch_db) as conn:
        ids = upsert_signal_definitions(
            conn, [SignalDef(source="PDM", signal_name="v", unit="V")]
        )
        sig_id = ids[("PDM", "v")]
        session_id = open_session(conn, source="sd_import", source_file="a.nfr")

        now = datetime.now(timezone.utc)
        readings = [
            Reading(ts=now, signal_id=sig_id, value=float(i)) for i in range(100)
        ]
        inserted = copy_sd_readings(conn, session_id, readings)

    assert inserted == 100
    with psycopg.connect(scratch_db) as conn:
        count = conn.execute(
            "SELECT count(*) FROM sd_readings WHERE session_id = %s",
            (session_id,),
        ).fetchone()[0]
    assert count == 100
