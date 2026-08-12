#!/bin/bash
# Install PocketBook as a Dock-friendly Mac app.
# Prerequisites: Homebrew + pango (for WeasyPrint)
#   brew install pango
set -euo pipefail

PROJ="$(cd "$(dirname "$0")" && pwd)"
SUPPORT="$HOME/Library/Application Support/PocketBook"
APP_DIR="$HOME/Applications"
APP="$APP_DIR/PocketBook.app"
ICON="$PROJ/site/PocketBook.icns"
SCRIPT_SRC="$PROJ/mac/PocketBook.applescript"

echo "→ Checking Homebrew pango (needed by WeasyPrint)…"
if ! brew list pango >/dev/null 2>&1; then
  echo "Installing pango via Homebrew…"
  brew install pango
fi

echo "→ Installing converter into Application Support…"
mkdir -p "$SUPPORT" "$APP_DIR"
rsync -a --delete \
  "$PROJ/pocketbook.py" \
  "$PROJ/css" \
  "$PROJ/requirements.txt" \
  "$SUPPORT/"

if [ ! -x "$SUPPORT/venv/bin/python" ]; then
  echo "→ Creating Python virtualenv…"
  /usr/bin/python3 -m venv "$SUPPORT/venv"
fi
echo "→ Installing Python packages…"
"$SUPPORT/venv/bin/pip" install -q --upgrade pip
"$SUPPORT/venv/bin/pip" install -q -r "$SUPPORT/requirements.txt"

if [ ! -f "$SCRIPT_SRC" ]; then
  echo "Missing $SCRIPT_SRC"
  exit 1
fi

echo "→ Building PocketBook.app…"
rm -rf "$APP"
osacompile -o "$APP" "$SCRIPT_SRC"
rm -f "$APP/Contents/Resources/Assets.car"
if [ -f "$ICON" ]; then
  cp "$ICON" "$APP/Contents/Resources/applet.icns"
fi

/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile applet" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.liamclarke.pocketbook" "$APP/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.liamclarke.pocketbook" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion 4" "$APP/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleVersion string 4" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString 1.3" "$APP/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string 1.3" "$APP/Contents/Info.plist"

/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null 2>&1 || true
touch "$APP"

echo
echo "Installed."
echo "  App:     $APP"
echo "  Runtime: $SUPPORT"
echo
echo "Next:"
echo "  1. open \"$APP\""
echo "  2. Right-click the Dock icon → Options → Keep in Dock"
echo
open -R "$APP"
