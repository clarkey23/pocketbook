#!/bin/bash
# Build a self-contained PocketBook.app (no Homebrew/Terminal needed for end users).
set -euo pipefail

PROJ="$(cd "$(dirname "$0")" && pwd)"
DIST="$PROJ/dist"
APP="$DIST/PocketBook.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RES="$CONTENTS/Resources"
FRAMEWORKS="$CONTENTS/Frameworks"
APPDIR="$RES/app"
PYDIR="$RES/python"
ICON_SRC="$PROJ/site/PocketBook.icns"
CACHE="$PROJ/.cache"
STANDALONE_DIR="$CACHE/python-standalone"

# macOS arm64 CPython from python-build-standalone (Astral/indygreg)
# Pin a known release; bump intentionally.
PY_VERSION="3.12.7"
PY_TAG="20241016"
PY_ARCH="aarch64-apple-darwin"
PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PY_TAG}/cpython-${PY_VERSION}+${PY_TAG}-${PY_ARCH}-install_only.tar.gz"

echo "→ Preparing dist…"
rm -rf "$APP"
mkdir -p "$MACOS" "$APPDIR" "$FRAMEWORKS" "$CACHE"

echo "→ Ensuring standalone Python…"
if [ ! -x "$STANDALONE_DIR/python/bin/python3" ]; then
  rm -rf "$STANDALONE_DIR"
  mkdir -p "$STANDALONE_DIR"
  curl -L --fail "$PY_URL" -o "$CACHE/python-standalone.tar.gz"
  tar -xzf "$CACHE/python-standalone.tar.gz" -C "$STANDALONE_DIR"
fi
STANDALONE_PY="$STANDALONE_DIR/python/bin/python3"
"$STANDALONE_PY" --version

echo "→ Creating bundled virtualenv with dependencies…"
BUILD_VENV="$CACHE/build-venv"
rm -rf "$BUILD_VENV"
"$STANDALONE_PY" -m venv "$BUILD_VENV"
"$BUILD_VENV/bin/pip" install -q --upgrade pip
"$BUILD_VENV/bin/pip" install -q -r "$PROJ/requirements.txt"

echo "→ Copying Python runtime into app…"
mkdir -p "$PYDIR"
# Copy the standalone python install (not just venv) then overlay site-packages from build venv
rsync -a "$STANDALONE_DIR/python/" "$PYDIR/"
# Overlay installed packages into the bundled python
rsync -a "$BUILD_VENV/lib/" "$PYDIR/lib/"

echo "→ Copying app code…"
cp "$PROJ/pocketbook.py" "$PROJ/mac/gui.py" "$APPDIR/"
rsync -a "$PROJ/css" "$PROJ/fonts" "$APPDIR/"

echo "→ Collecting native libraries for WeasyPrint…"
BREW_PREFIX="$(brew --prefix 2>/dev/null || true)"
BREW_LIB="${BREW_PREFIX:-/opt/homebrew}/lib"
if [ ! -d "$BREW_LIB" ]; then
  echo "Homebrew libs not found at build time. Install pango first: brew install pango"
  exit 1
fi

SEEDS=(
  "$BREW_LIB/libgobject-2.0.dylib"
  "$BREW_LIB/libglib-2.0.dylib"
  "$BREW_LIB/libpango-1.0.dylib"
  "$BREW_LIB/libpangocairo-1.0.dylib"
  "$BREW_LIB/libpangoft2-1.0.dylib"
  "$BREW_LIB/libcairo.dylib"
  "$BREW_LIB/libcairo-gobject.dylib"
  "$BREW_LIB/libharfbuzz.dylib"
  "$BREW_LIB/libfontconfig.dylib"
  "$BREW_LIB/libfreetype.dylib"
  "$BREW_LIB/libfribidi.dylib"
  "$BREW_LIB/libpixman-1.dylib"
  "$BREW_LIB/libintl.dylib"
  "$BREW_LIB/libgmodule-2.0.dylib"
  "$BREW_LIB/libgio-2.0.dylib"
)

python3 - <<'PY' "$FRAMEWORKS" "${SEEDS[@]}"
import os, sys, subprocess, shutil
from pathlib import Path

frameworks = Path(sys.argv[1])
seeds = [Path(p) for p in sys.argv[2:] if Path(p).exists()]
seen = set()
queue = list(seeds)

def deps(path: Path):
    try:
        out = subprocess.check_output(["otool", "-L", str(path)], text=True)
    except Exception:
        return []
    result = []
    for line in out.splitlines()[1:]:
        lib = line.strip().split(" ", 1)[0]
        if lib.startswith("/opt/homebrew/") or lib.startswith("/usr/local/"):
            result.append(Path(lib))
    return result

while queue:
    lib = queue.pop()
    if not lib.exists():
        continue
    key = str(lib.resolve())
    if key in seen:
        continue
    seen.add(key)
    dest = frameworks / lib.name
    if not dest.exists():
        shutil.copy2(lib, dest)
    for dep in deps(lib):
        queue.append(dep)

print(f"bundled {len(list(frameworks.glob('*.dylib')))} dylibs")
PY

# Common SONAME copies WeasyPrint/cffi look for
for pattern in \
  libgobject-2.0*.dylib libglib-2.0*.dylib libpango-1.0*.dylib \
  libpangocairo-1.0*.dylib libcairo*.dylib libharfbuzz*.dylib \
  libfontconfig*.dylib libfreetype*.dylib libfribidi*.dylib \
  libintl*.dylib libgio-2.0*.dylib libgmodule-2.0*.dylib libpixman-1*.dylib
do
  for src in "$BREW_LIB"/$pattern; do
    [ -e "$src" ] || continue
    cp -R "$src" "$FRAMEWORKS/" 2>/dev/null || true
  done
done

echo "→ Rewriting dylib install names to @loader_path…"
for dylib in "$FRAMEWORKS"/*.dylib; do
  [ -e "$dylib" ] || continue
  # Skip broken symlinks
  [ -f "$dylib" ] || continue
  base="$(basename "$dylib")"
  chmod u+w "$dylib" 2>/dev/null || true
  install_name_tool -id "@loader_path/$base" "$dylib" 2>/dev/null || true
  while read -r dep; do
    depname="$(basename "$dep")"
    if [ -f "$FRAMEWORKS/$depname" ]; then
      install_name_tool -change "$dep" "@loader_path/$depname" "$dylib" 2>/dev/null || true
    fi
  done < <(otool -L "$dylib" 2>/dev/null | awk 'NR>1 {print $1}' | grep -E '^/opt/homebrew/|^/usr/local/' || true)
done

echo "→ Writing launcher…"
cat > "$MACOS/PocketBook" <<'LAUNCH'
#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export DYLD_FALLBACK_LIBRARY_PATH="$ROOT/Frameworks:${DYLD_FALLBACK_LIBRARY_PATH:-}"
export DYLD_LIBRARY_PATH="$ROOT/Frameworks:${DYLD_LIBRARY_PATH:-}"
export PYTHONPATH="$ROOT/Resources/app:${PYTHONPATH:-}"
export PYTHONNOUSERSITE=1
export TCL_LIBRARY="$ROOT/Resources/python/lib/tcl8.6"
export TK_LIBRARY="$ROOT/Resources/python/lib/tk8.6"
PY="$ROOT/Resources/python/bin/python3"
exec "$PY" "$ROOT/Resources/app/gui.py"
LAUNCH
chmod +x "$MACOS/PocketBook"

echo "→ Writing Info.plist…"
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>PocketBook</string>
  <key>CFBundleDisplayName</key><string>PocketBook</string>
  <key>CFBundleIdentifier</key><string>com.liamclarke.pocketbook</string>
  <key>CFBundleVersion</key><string>2.0.0</string>
  <key>CFBundleShortVersionString</key><string>2.0.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>PocketBook</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$RES/AppIcon.icns"
fi

echo "→ Ad-hoc codesign…"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

ZIP="$DIST/PocketBook-macOS.zip"
rm -f "$ZIP"
(
  cd "$DIST"
  ditto -c -k --sequesterRsrc --keepParent "PocketBook.app" "PocketBook-macOS.zip"
)

echo
echo "Built: $APP"
echo "Zip:   $ZIP"
du -sh "$APP" "$ZIP"
echo
echo "Test: open \"$APP\""
