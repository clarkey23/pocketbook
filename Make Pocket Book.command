#!/bin/bash
SUPPORT="$HOME/Library/Application Support/PocketBook"
cd "$SUPPORT" || {
  osascript -e 'display alert "PocketBook" message "Setup is incomplete. Open Cursor and ask to reinstall PocketBook." as critical'
  exit 1
}

URL=$(osascript <<'EOF'
try
  set theLink to text returned of (display dialog "Paste a Project Gutenberg link:" default answer "" with title "PocketBook" buttons {"Cancel", "Make booklet"} default button "Make booklet")
  return theLink
on error number -128
  return ""
end try
EOF
)

URL=$(echo "$URL" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
[ -z "$URL" ] && exit 0

if [ ! -x "venv/bin/python" ]; then
  osascript -e 'display alert "PocketBook" message "Setup is incomplete. Open Cursor and ask to reinstall PocketBook." as critical'
  exit 1
fi

OUTPUT=$(./venv/bin/python pocketbook.py "$URL" 2>&1)
STATUS=$?

if [ $STATUS -ne 0 ]; then
  MSG=$(echo "$OUTPUT" | tail -n 8 | sed 's/"/\\"/g')
  osascript -e "display alert \"PocketBook failed\" message \"$MSG\" as critical"
  exit 1
fi

PDF=$(echo "$OUTPUT" | sed -n 's/^Booklet ready: //p' | tail -n 1)
if [ -n "$PDF" ] && [ -f "$PDF" ]; then
  open "$PDF"
  osascript -e 'display notification "Saved to Downloads." with title "PocketBook"'
else
  osascript -e 'display alert "PocketBook" message "Finished, but could not find the PDF." as critical'
fi
