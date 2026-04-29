# Embedded Postgres binaries

Vendored Postgres 17 binaries that ship inside nfrInterface so the user does not need to install Postgres themselves. The runtime loads these via the `PostgresManager` class in `desktop/main/src/db/postgres-manager.ts`.

## Layout

One subdirectory per supported platform:

- `macos-arm64/` — full binary set from Postgres.app (postgres, initdb, pg_ctl, pg_isready, pg_dump, psql, plus dylibs in `lib/` and templates in `share/`)
- `windows-x64/` — full binary set from EnterpriseDB's Windows distribution
- `linux-x64/` — relocatable binaries from `zonkyio/embedded-postgres-binaries` (postgres, initdb, pg_ctl only; readiness check uses a TCP probe)

Each subdir is structured so the postgres executable can find its libs and share dir relative to its own location.

## Update procedure

1. Get the new Postgres release for the target platform:
   - macOS arm64: install Postgres.app, copy from `/Applications/Postgres.app/Contents/Versions/<major>/`
   - Windows x64: download the zip from EnterpriseDB
   - Linux x64: pull the matching `embedded-postgres-binaries-linux-amd64-<version>.jar` from Maven Central
2. Strip the bundle to the minimum subset (drop `pgxs/`, `share/locale/`, `share/doc/`, `share/man/`, regression test executables).
3. On macOS, rewrite any external dylib paths to `@executable_path/../lib/<name>` via `install_name_tool`. Ad-hoc re-sign each touched binary with `codesign --force --sign -`.
4. Drop the result into the matching `<platform>/` subdir.
5. Bump `PG_MAJOR` in `desktop/main/src/db/postgres-manager.ts` if the major version changed.
6. Run the desktop test suite to verify init + start + connect still works.

## Why we vendor

Most apps require users to install Postgres separately. We bundle it because the team laptop should work offline at the track without a separate setup step. This costs ~60-180 MB per platform inside the installer, which is acceptable for a single-app team tool.
