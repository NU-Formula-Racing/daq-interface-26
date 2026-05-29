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
# available'. Verify the import works before we start spending minutes
# building, so the failure points at the cause instead of the symptom.
if ! "$PY" -c "import psycopg_binary, serial, serial.tools.list_ports" >/dev/null 2>&1; then
  echo "ERROR: build environment is missing required modules." >&2
  echo "       psycopg_binary, serial, serial.tools.list_ports must be" >&2
  echo "       importable from $PY before running build.sh." >&2
  echo "       Try:  pip install psycopg[binary] pyserial pyinstaller" >&2
  exit 1
fi

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
