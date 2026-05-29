#!/usr/bin/env bash
# Build a single-file parser binary for the current platform.
# Output: parser/dist/parser/parser  (or parser.exe on Windows when run via Git Bash)
# The output directory is always the same so electron-builder's extraResources
# entry can be a single platform-agnostic path. Each CI runner produces its own.
set -euo pipefail

cd "$(dirname "$0")"

OUT_DIR="dist/parser"

rm -rf "$OUT_DIR" "build" "parser.spec"
mkdir -p "$OUT_DIR"

if [ -x ".venv/bin/pyinstaller" ]; then
  PYINSTALLER=".venv/bin/pyinstaller"
  PY=".venv/bin/python"
elif [ -x ".venv/Scripts/pyinstaller.exe" ]; then
  PYINSTALLER=".venv/Scripts/pyinstaller.exe"
  PY=".venv/Scripts/python.exe"
else
  PYINSTALLER="pyinstaller"
  PY="python3"
fi

# Guard against the silent-bundle bug: PyInstaller's --hidden-import only
# bundles psycopg_binary if it's importable at build time. Without it the
# resulting binary runs but blows up at first DB call with 'no pq wrapper
# available'. Print the actual ImportError so the cause is obvious — the
# previous version captured stderr silently which made CI failures opaque.
# We also try each module independently so we can call out exactly which
# one is missing on the runner.
# `psycopg_binary` must be imported via `psycopg` — recent releases reject
# direct `import psycopg_binary` with "the psycopg package should be
# imported before psycopg_binary". Importing `psycopg` itself loads the
# binary backend implicitly, which is what we actually need for the
# bundled binary to work.
err="$("$PY" -c "import psycopg, serial, serial.tools.list_ports" 2>&1)" || {
  echo "ERROR: build environment is missing required modules." >&2
  echo "       Python: $PY" >&2
  echo "$err" | sed 's/^/         /' >&2
  echo >&2
  echo "       Installed packages (pip list):" >&2
  "$PY" -m pip list 2>&1 | sed 's/^/         /' >&2
  echo >&2
  echo "       Try:  pip install 'psycopg[binary]' pyserial pyinstaller" >&2
  exit 1
}

"$PYINSTALLER" \
  --onefile \
  --name parser \
  --hidden-import psycopg_binary \
  --hidden-import serial \
  --hidden-import serial.tools.list_ports \
  --distpath "$OUT_DIR" \
  __main__.py

echo ""
if [ -f "$OUT_DIR/parser.exe" ]; then
  echo "Built: $OUT_DIR/parser.exe"
  "$OUT_DIR/parser.exe" --help | head -20
else
  echo "Built: $OUT_DIR/parser"
  "$OUT_DIR/parser" --help | head -20
fi
