#!/bin/bash
# Build (if needed) and install PocketBook.app into ~/Applications.
set -euo pipefail
PROJ="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$HOME/Applications"
DIST_APP="$PROJ/dist/PocketBook.app"

mkdir -p "$APP_DIR"

if [ ! -d "$DIST_APP" ]; then
  echo "No built app yet — building standalone app (needs Homebrew pango)…"
  "$PROJ/build-standalone-app.sh"
fi

rm -rf "$APP_DIR/PocketBook.app"
cp -R "$DIST_APP" "$APP_DIR/PocketBook.app"
echo "Installed: $APP_DIR/PocketBook.app"
open -R "$APP_DIR/PocketBook.app"
open "$APP_DIR/PocketBook.app"
