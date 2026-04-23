"""Shared pytest fixtures for the parser tests.

`scratch_db` creates a throwaway Postgres database, applies the
`desktop/migrations/*.sql` files in order, yields a connection URL, and
drops the database on teardown. Mirrors the TS test harness in Plan 1.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Iterator
from urllib.parse import urlparse, urlunparse

import psycopg
import pytest

ADMIN_URL = os.environ.get(
    "TEST_PG_URL", "postgres://postgres@localhost:5432/postgres"
)
MIGRATIONS_DIR = (
    Path(__file__).resolve().parents[2] / "desktop" / "migrations"
)


def _with_database(url: str, name: str) -> str:
    parsed = urlparse(url)
    return urlunparse(parsed._replace(path=f"/{name}"))


@pytest.fixture
def scratch_db() -> Iterator[str]:
    name = f"nfr_parser_test_{secrets.token_hex(6)}"
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(f"CREATE DATABASE {name}")

    url = _with_database(ADMIN_URL, name)
    try:
        with psycopg.connect(url, autocommit=True) as conn:
            for sql_path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                conn.execute(sql_path.read_text())
            # Track in schema_migrations so reruns behave like the real runner.
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                "version TEXT PRIMARY KEY, "
                "applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            )
            for sql_path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                version = sql_path.stem
                conn.execute(
                    "INSERT INTO schema_migrations (version) VALUES (%s) "
                    "ON CONFLICT DO NOTHING",
                    (version,),
                )

        yield url
    finally:
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = %s",
                (name,),
            )
            admin.execute(f"DROP DATABASE IF EXISTS {name}")
