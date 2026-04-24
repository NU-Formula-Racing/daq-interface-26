# Packaging the NFR Local app

Prerequisites on your build machine:
- Plans 1–4 + Plan 5 Tasks 1–3 complete (cloud sync, setup screen, PyInstaller binary).
- `app/dist/` built via `cd app && npm run build`.
- `parser/dist/parser-<platform>-<arch>/parser` built via `cd parser && ./build.sh`.
- Node 20+, npm 10+, Xcode Command Line Tools.

Build the installer:

    cd desktop
    npm run package

Output: `desktop/release/NFR Local-<version>-<arch>.dmg`.

First-build note: electron-builder will download the Electron runtime (~90 MB)
on its first run. Subsequent builds are cached.

## What's inside the `.dmg`

- `NFR Local.app/Contents/Resources/app/` — built React UI
- `.../Resources/migrations/` — SQL migrations applied on first launch
- `.../Resources/parser/parser` — the PyInstaller-bundled parser binary
- `.../Resources/NFR26DBC.csv` — default CAN signal definitions

## Install + first launch

1. Open the `.dmg`, drag `NFR Local.app` to `/Applications`.
2. First launch: right-click → Open (bypasses Gatekeeper for the unsigned build).
3. If Postgres isn't running, the UI shows the setup page with install
   instructions. Start Postgres.app, click RETRY. App reloads to the Live
   dashboard.
