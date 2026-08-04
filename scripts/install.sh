#!/bin/sh
# Downloads, verifies, and invokes a Tower portable release installer.
# This script is deterministic and non-interactive; it never invokes npm/pnpm.
set -eu

VERSION=latest
DOWNLOAD_BASE=${TOWER_DOWNLOAD_BASE_URL:-}
ASSET_DIR=""
PREFIX=${TOWER_INSTALL_DIR:-"${XDG_DATA_HOME:-$HOME/.local/share}/tower"}
BIN_DIR=${TOWER_BIN_DIR:-"$HOME/.local/bin"}
ACTION=install

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Options:
  --version VERSION       Release version (for example 0.3.1 or latest)
  --download-base URL     HTTPS directory containing release assets
  --asset-dir DIR         Install from already-downloaded offline assets
  --prefix DIR            User installation root
  --bin-dir DIR           User launcher directory
  --verify                Download/extract/verify only; do not install
  --rollback              Switch to the previously installed version
  --uninstall             Remove app files; preserve ~/.tower data
  --yes                   Explicit non-interactive mode (the default)
  --non-interactive       Alias for --yes
  --no-start              Do not start Tower after install (the default)
  -h, --help              Show this help

Environment: TOWER_DOWNLOAD_BASE_URL, TOWER_INSTALL_DIR, TOWER_BIN_DIR.
The download base is the exact asset directory, not a registry URL.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; VERSION=${2#v}; shift 2 ;;
    --download-base) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; DOWNLOAD_BASE=$2; shift 2 ;;
    --asset-dir) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; ASSET_DIR=$2; shift 2 ;;
    --prefix) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; PREFIX=$2; shift 2 ;;
    --bin-dir) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; BIN_DIR=$2; shift 2 ;;
    --verify) ACTION=verify; shift ;;
    --rollback) ACTION=rollback; shift ;;
    --uninstall) ACTION=uninstall; shift ;;
    --yes|--non-interactive|--no-start) shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$ACTION" = rollback ] || [ "$ACTION" = uninstall ]; then
  [ -x "$PREFIX/current/install" ] || { printf 'Tower is not installed in %s\n' "$PREFIX" >&2; exit 1; }
  exec "$PREFIX/current/install" "--$ACTION" --prefix "$PREFIX" --bin-dir "$BIN_DIR" --yes
fi

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'TOWER_ERROR=NODE_NOT_FOUND minimum=22.0.0 tested=22|24 action="Install Node.js 22 LTS or newer and retry."' >&2
  exit 1
fi
NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || true)
case "$NODE_MAJOR" in ''|*[!0-9]*|0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|21)
  NODE_VERSION=$(node --version 2>/dev/null || printf unknown)
  printf '%s\n' "TOWER_ERROR=UNSUPPORTED_NODE minimum=22.0.0 tested=22|24 found=${NODE_VERSION} action=\"Install Node.js 22 LTS or newer and retry.\"" >&2
  exit 1
esac
case "$NODE_MAJOR" in 22|24) ;; *)
  NODE_VERSION=$(node --version 2>/dev/null || printf unknown)
  printf '%s\n' "TOWER_WARNING=UNTESTED_NODE minimum=22.0.0 tested=22|24 found=${NODE_VERSION} action=\"Continue best-effort or use Node.js 22/24 LTS for full support.\"" >&2
esac

case "$(uname -s)" in Darwin) PLATFORM=darwin ;; Linux) PLATFORM=linux ;; *) printf 'Unsupported OS: %s\n' "$(uname -s)" >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64|amd64) ARCH=x64 ;; arm64|aarch64) ARCH=arm64 ;; *) printf 'Unsupported architecture: %s\n' "$(uname -m)" >&2; exit 1 ;; esac
ASSET="tower-portable-$PLATFORM-$ARCH.tar.gz"

TEMP=$(mktemp -d "${TMPDIR:-/tmp}/tower-install.XXXXXX")
trap 'rm -rf "$TEMP"' EXIT HUP INT TERM
if [ -n "$ASSET_DIR" ]; then
  cp "$ASSET_DIR/$ASSET" "$TEMP/$ASSET"
  cp "$ASSET_DIR/SHA256SUMS" "$TEMP/SHA256SUMS"
else
  if [ -z "$DOWNLOAD_BASE" ]; then
    if [ "$VERSION" = latest ]; then
      DOWNLOAD_BASE="https://github.com/tower-org/tower/releases/latest/download"
    else
      DOWNLOAD_BASE="https://github.com/tower-org/tower/releases/download/v$VERSION"
    fi
  fi
  case "$DOWNLOAD_BASE" in https://*) ;; *) printf 'Download base must use HTTPS: %s\n' "$DOWNLOAD_BASE" >&2; exit 1 ;; esac
  command -v curl >/dev/null 2>&1 || { printf 'curl is required for online installation.\n' >&2; exit 1; }
  curl --proto '=https' --tlsv1.2 -fsSLo "$TEMP/$ASSET" "$DOWNLOAD_BASE/$ASSET"
  curl --proto '=https' --tlsv1.2 -fsSLo "$TEMP/SHA256SUMS" "$DOWNLOAD_BASE/SHA256SUMS"
fi

EXPECTED=$(awk -v name="$ASSET" '$2 == name || $2 == "*" name { print $1 }' "$TEMP/SHA256SUMS")
[ "${#EXPECTED}" -eq 64 ] || { printf 'No valid checksum for %s\n' "$ASSET" >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then ACTUAL=$(sha256sum "$TEMP/$ASSET" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then ACTUAL=$(shasum -a 256 "$TEMP/$ASSET" | awk '{print $1}')
else ACTUAL=$(openssl dgst -sha256 "$TEMP/$ASSET" | awk '{print $NF}'); fi
[ "$ACTUAL" = "$EXPECTED" ] || { printf 'SHA-256 mismatch for %s\n' "$ASSET" >&2; exit 1; }

tar -tzf "$TEMP/$ASSET" | awk '/^\// || /(^|\/)\.\.($|\/)/ { bad=1 } END { exit bad }' || { printf 'Unsafe archive paths detected.\n' >&2; exit 1; }
tar -xzf "$TEMP/$ASSET" -C "$TEMP"
ROOT=$(find "$TEMP" -mindepth 1 -maxdepth 1 -type d -name 'tower-v*' -print)
[ -n "$ROOT" ] && [ "$(printf '%s\n' "$ROOT" | wc -l | tr -d ' ')" -eq 1 ] || { printf 'Archive must contain one Tower root directory.\n' >&2; exit 1; }

if [ "$VERSION" != latest ]; then
  ACTUAL_VERSION=$(node -p "require(process.argv[1]).version" "$ROOT/portable-manifest.json")
  [ "$ACTUAL_VERSION" = "$VERSION" ] || { printf 'Requested %s but archive contains %s\n' "$VERSION" "$ACTUAL_VERSION" >&2; exit 1; }
fi
ACTUAL_TARGET=$(node -p "const m=require(process.argv[1]); m.platform + '-' + m.arch" "$ROOT/portable-manifest.json")
[ "$ACTUAL_TARGET" = "$PLATFORM-$ARCH" ] || { printf 'Archive target %s does not match this machine %s\n' "$ACTUAL_TARGET" "$PLATFORM-$ARCH" >&2; exit 1; }
if [ "$ACTION" = verify ]; then exec "$ROOT/install" --verify --prefix "$PREFIX" --bin-dir "$BIN_DIR" --yes; fi
exec "$ROOT/install" --prefix "$PREFIX" --bin-dir "$BIN_DIR" --yes --no-start
