#!/bin/zsh
set -eu
opensky_source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
cd "$opensky_source_dir"
if ! command -v node >/dev/null 2>&1; then
  for opensky_node_dir in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
    if [ -x "$opensky_node_dir/node" ]; then export PATH="$opensky_node_dir:$PATH"; break; fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  print 'OpenSky needs Node.js 22 or later. Install it from https://nodejs.org/, then open this installer again.'
  read -r '?Press Return to close.'
  exit 1
fi
./install.sh --onboard
