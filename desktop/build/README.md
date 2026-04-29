# Packaging nfrInterface

This folder holds the build inputs that electron-builder needs:

- `icon.png` / `icon.icns` / `icon.ico` — the app icon for each OS
- `entitlements.mac.plist` — macOS entitlements file
- `build-main.js` — esbuild script that bundles the Electron main + preload
- `postgres-bin/` — vendored Postgres 17 binaries for each supported platform

## Building

Prerequisites:
- Node 20+ and npm 10+
- Python 3.11+
- For macOS: Xcode Command Line Tools

Step by step:

```
# 1. Build the React frontend
cd app && npm install && npm run build

# 2. Build the parser binary for this OS
cd parser
python -m venv .venv
source .venv/bin/activate    # on Windows: .\.venv\Scripts\Activate.ps1
pip install -e . pyinstaller
./build.sh                   # on Windows: .\build.ps1

# 3. Package the desktop app
cd desktop && npm install && npm run package
```

Output ends up in `desktop/release/`:
- macOS: `nfrInterface-<version>-arm64.dmg`
- Linux: `nfrInterface-<version>.AppImage`
- Windows: `nfrInterface <version>.exe` (portable)

The first build downloads the Electron runtime (~90 MB). After that it is cached.

## What's inside the installer

- `<resources>/app/` — the built React UI (static files)
- `<resources>/migrations/` — SQL migrations applied on first launch
- `<resources>/parser/parser` (or `parser.exe`) — PyInstaller binary
- `<resources>/postgres-bin/<platform>/` — embedded Postgres for that OS
- `<resources>/NFR26DBC.csv` — default CAN signal definitions

The user does not need to install Postgres or Python; everything is bundled.

## Cross-platform builds

Each platform has to package itself because the Postgres and parser binaries are native code. Use the GitHub Actions workflow at `.github/workflows/release.yml` — push a tag like `v0.4.0` and it produces all three installers in parallel and attaches them to the matching release.
