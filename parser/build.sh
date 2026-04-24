#!/usr/bin/env bash
# Build a single-file parser binary for the current platform.
# Output: parser/dist/parser-<platform>-<arch>/parser
set -euo pipefail

cd "$(dirname "$0")"

PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
OUT_DIR="dist/parser-${PLATFORM}-${ARCH}"

rm -rf "$OUT_DIR" "build" "parser.spec"
mkdir -p "$OUT_DIR"

.venv/bin/pyinstaller \
  --onefile \
  --name parser \
  --hidden-import psycopg_binary \
  --hidden-import serial \
  --hidden-import serial.tools.list_ports \
  --distpath "$OUT_DIR" \
  __main__.py

echo ""
echo "Built: $OUT_DIR/parser"
"$OUT_DIR/parser" --help | head -20
