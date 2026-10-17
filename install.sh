#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "OpenSky requires Node.js 22 or later. Install Node.js, then run this installer again." >&2
  exit 1
fi
exec node "$ROOT_DIR/scripts/install.mjs" "$@"
