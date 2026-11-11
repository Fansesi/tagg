#!/bin/sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RELEASE_DIR=${1:-"$REPO_ROOT/dist/thunderbird-tagg"}
RELEASE_DIR=$(CDPATH= cd -- "$RELEASE_DIR" && pwd)
HOST_SOURCE="$RELEASE_DIR/native-host"
INSTALL_DIR=${TAGG_NATIVE_HOST_DIR:-"$HOME/.local/share/tagg/native-host"}
PYTHON=${TAGG_PYTHON:-python3}

case "$(uname -s)" in
  Darwin)
    MANIFEST_DIR=${TAGG_NATIVE_MANIFEST_DIR:-"$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"}
    ;;
  Linux)
    MANIFEST_DIR=${TAGG_NATIVE_MANIFEST_DIR:-"$HOME/.mozilla/native-messaging-hosts"}
    ;;
  *)
    printf '%s\n' 'This installer supports Linux and macOS. Use the generated host files for Windows.' >&2
    exit 1
    ;;
esac

if [ ! -f "$HOST_SOURCE/tagg_native_host.py" ] || [ ! -f "$HOST_SOURCE/tagg_native_host" ]; then
  printf 'Release not found at %s. Build it first.\n' "$RELEASE_DIR" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/tagg" "$MANIFEST_DIR"
cp "$HOST_SOURCE/tagg_native_host.py" "$INSTALL_DIR/tagg_native_host.py"
cp "$HOST_SOURCE/tagg_native_host" "$INSTALL_DIR/tagg_native_host"
cp "$HOST_SOURCE/tagg_native_host.json" "$MANIFEST_DIR/tagg_native_host.json"
cp -R "$HOST_SOURCE/tagg/." "$INSTALL_DIR/tagg/"
chmod 755 "$INSTALL_DIR/tagg_native_host"

"$PYTHON" - "$MANIFEST_DIR/tagg_native_host.json" "$INSTALL_DIR/tagg_native_host" <<'PY'
import json
import sys

manifest_path, host_path = sys.argv[1:]
with open(manifest_path, encoding="utf-8") as file:
    manifest = json.load(file)
manifest["path"] = host_path
with open(manifest_path, "w", encoding="utf-8") as file:
    json.dump(manifest, file, indent=2)
    file.write("\n")
PY

printf 'Registered %s at %s\n' "tagg_native_host" "$MANIFEST_DIR/tagg_native_host.json"
printf 'Python: %s\n' "$PYTHON"