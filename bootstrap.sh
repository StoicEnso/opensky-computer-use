#!/bin/bash
# Fresh-Mac installer. Uses only tools shipped with macOS; never sudo or Xcode.
set -euo pipefail

opensky_fetch() { /usr/bin/curl --fail --location --show-error --silent --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 3 --connect-timeout 20 --max-time 600 "$1" -o "$2"; }
opensky_verify() {
  local expected
  expected=$(/usr/bin/awk -v name="$2" '$2==name {print $1}' "$3")
  [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || { echo "Missing or ambiguous checksum for $2" >&2; return 1; }
  local actual
  actual=$(/usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}')
  [[ "$actual" == "$expected" ]] || { echo "Checksum failed for $2; nothing will be installed." >&2; return 1; }
}
opensky_main() (
  local version='1.7.0-rc.11' release_date='2026-10-19'
  local prefix="$HOME/.local" app_dir="$HOME/Applications" offline='' claude=1 desktop=1 onboard=1
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --no-claude) claude=0; desktop=0; shift;;
      --no-desktop) desktop=0; shift;;
      --no-onboard) onboard=0; shift;;
      --prefix|--app-dir|--from)
        [ "$#" -ge 2 ] && [ -n "$2" ] || { echo "$1 needs a path" >&2; exit 1; }
        case "$1" in --prefix) prefix="$2";; --app-dir) app_dir="$2";; --from) offline="$2";; esac; shift 2;;
      --help|-h)
        echo 'OpenSky + Claude: bash bootstrap.sh [--no-desktop] [--no-claude] [--no-onboard] [--prefix PATH] [--app-dir PATH] [--from RELEASE_FOLDER]'
        echo 'Installs in your home folder. One-time macOS consent, Claude sign-in and Desktop extension review remain visible.'; exit 0;;
      *) echo "Unknown option: $1" >&2; exit 1;;
    esac
  done
  case "$prefix" in /*) ;; *) echo '--prefix must be an absolute path.' >&2; exit 1;; esac
  case "$app_dir" in /*) ;; *) echo '--app-dir must be an absolute path.' >&2; exit 1;; esac
  [ "$(/usr/bin/uname -s)" = Darwin ] || { echo 'OpenSky needs macOS 14 or later.' >&2; exit 1; }
  [ "$(/usr/bin/id -u)" != 0 ] || { echo 'Run as your normal Mac user, without sudo.' >&2; exit 1; }
  local mac_version arch
  mac_version=$(/usr/bin/sw_vers -productVersion)
  [ "${mac_version%%.*}" -ge 14 ] || { echo "macOS 14+ required; found $mac_version" >&2; exit 1; }
  arch=$(/usr/bin/uname -m)
  if [ "$arch" = x86_64 ] && [ "$(/usr/sbin/sysctl -in sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then arch=arm64; fi
  case "$arch" in arm64) ;; x86_64) arch=x64;; *) echo "Unsupported Mac architecture: $arch" >&2; exit 1;; esac
  umask 077
  local temporary
  temporary=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/2026-10-18-opensky-install-Codex.XXXXXX")
  trap '/bin/rm -rf "$temporary"' EXIT
  local base="https://github.com/StoicEnso/opensky-computer-use/releases/download/v$version"
  local stem="$release_date-opensky-$version"
  local sums="$stem-SHA256SUMS-Codex.txt"
  local runtime_asset="$stem-runtime-Codex.tgz" app_asset="$stem-macos-$arch-Codex.zip"
  echo "Installing OpenSky $version and preparing Claude. No administrator password or developer tools are needed for the download/install stage."
  local asset
  for asset in "$sums" "$runtime_asset" "$app_asset"; do
    if [ -n "$offline" ]; then /bin/cp "$offline/$asset" "$temporary/$asset";
    else opensky_fetch "$base/$asset" "$temporary/$asset"; fi
  done
  opensky_verify "$temporary/$runtime_asset" "$runtime_asset" "$temporary/$sums"
  opensky_verify "$temporary/$app_asset" "$app_asset" "$temporary/$sums"
  /bin/mkdir "$temporary/runtime" "$temporary/app"
  /usr/bin/tar -xzf "$temporary/$runtime_asset" -C "$temporary/runtime"
  /usr/bin/ditto -x -k "$temporary/$app_asset" "$temporary/app"
  local node_bin=''
  if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22&&process.arch===process.argv[1]?0:1)' "$arch" >/dev/null 2>&1; then node_bin=$(command -v node); fi
  if [ -z "$node_bin" ]; then
    local node_version='v24.22.0' node_hash node_name node_target
    case "$arch" in
      arm64) node_hash='6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5';;
      x64) node_hash='495e3f273c645f3c4677d438304cdfc701729ea5dec5728f5c8e76a2dece4b91';;
    esac
    node_name="node-$node_version-darwin-$arch.tar.gz"
    node_target="$prefix/share/opensky-node/$node_version-$arch"
    echo "Installing private Node.js $node_version; your system Node and shell settings stay unchanged."
    if [ -n "$offline" ]; then /bin/cp "$offline/$node_name" "$temporary/$node_name";
    else opensky_fetch "https://nodejs.org/dist/$node_version/$node_name" "$temporary/$node_name"; fi
    echo "$node_hash  $node_name" > "$temporary/node-sums"
    opensky_verify "$temporary/$node_name" "$node_name" "$temporary/node-sums"
    /bin/mkdir "$temporary/node"
    /usr/bin/tar -xzf "$temporary/$node_name" -C "$temporary/node" --strip-components 1
    [ "$("$temporary/node/bin/node" --version)" = "$node_version" ] || { echo 'Downloaded Node failed its version check.' >&2; exit 1; }
    if [ ! -e "$node_target" ]; then
      /bin/mkdir -p "$(/usr/bin/dirname "$node_target")"
      /bin/mv "$temporary/node" "$node_target"
    else
      /usr/bin/cmp -s "$temporary/node/bin/node" "$node_target/bin/node" || { echo "Preserved a different existing runtime at $node_target. Move it aside and retry." >&2; exit 1; }
    fi
    node_bin="$node_target/bin/node"
  fi
  # Resolve PATH Node to a stable absolute path before its temporary caller exits.
  node_bin=$("$node_bin" -p 'process.execPath')
  "$node_bin" "$temporary/runtime/scripts/install.mjs" --prefix "$prefix" --app-dir "$app_dir" --prebuilt-app "$temporary/app/OpenSky.app"
  local runtime_dir="${OPENSKY_HOME:-$prefix/share/opensky}"
  [ -f "$runtime_dir/.opensky-install.json" ] && [ -x "$prefix/bin/opensky" ] && [ -x "$app_dir/OpenSky.app/Contents/MacOS/OpenSky" ] || { echo 'Installation did not produce the expected app, manifest and CLI. Setup stopped.' >&2; exit 1; }
  if [ "$claude" = 1 ]; then
    if [ "$desktop" = 0 ]; then "$node_bin" "$runtime_dir/scripts/claude-dependencies.mjs" --no-desktop;
    else "$node_bin" "$runtime_dir/scripts/claude-dependencies.mjs"; fi
    if [ "$desktop" = 0 ]; then "$prefix/bin/opensky" connect claude --no-open --no-desktop;
    else "$prefix/bin/opensky" connect claude --no-open; fi
  fi
  echo "OpenSky is installed. CLI: $prefix/bin/opensky"
  echo 'Add ~/.local/bin to PATH if needed. No shell profile was modified.'
  if [ "$onboard" = 1 ]; then
    local setup_args=(--terminal)
    [ "$claude" = 1 ] && setup_args+=(--claude)
    [ "$desktop" = 0 ] && setup_args+=(--no-desktop)
    "$prefix/bin/opensky" onboard "${setup_args[@]}"
  fi
)
if [ -z "${BASH_SOURCE[0]:-}" ] || [ "${BASH_SOURCE[0]}" = "$0" ]; then opensky_main "$@"; fi
