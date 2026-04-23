"""Confirm the scratch_db fixture spins up a DB with the Plan 1 schema."""
import psycopg


def test_scratch_db_has_sessions_table(scratch_db: str) -> None:
    with psycopg.connect(scratch_db) as conn:
        row = conn.execute(
            "SELECT count(*) FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'sessions'"
        ).fetchone()
        assert row is not None
        assert row[0] == 1


def test_scratch_db_seeds_app_config(scratch_db: str) -> None:
    with psycopg.connect(scratch_db) as conn:
        row = conn.execute("SELECT id FROM app_config").fetchone()
        assert row == (1,)
