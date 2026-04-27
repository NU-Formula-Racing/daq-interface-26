# Embedded Postgres binaries

These binaries are vendored from Postgres 17 (https://www.postgresql.org/),
PostgreSQL License (BSD-style). They are loaded by `PostgresManager` at
runtime. Per-platform subdirectories (`macos-arm64/`, `linux-x64/`, etc.)
are added as we add support for new install targets.

## Update procedure
1. Install the new Postgres release locally.
2. Copy `bin/{postgres,initdb,pg_ctl,pg_isready,pg_dump,psql}` and
   `lib/*.dylib` into the matching subdir.
3. Run `otool -L bin/postgres` and rewrite any external dylib paths via
   `install_name_tool` to `@executable_path/../lib/<name>`.
4. Copy `share/` verbatim.
5. Bump the major version constant in `PostgresManager.expectedVersion`.
6. Document migration steps for existing data directories in the release notes.
