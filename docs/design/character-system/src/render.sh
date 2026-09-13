#!/bin/sh
# Generate every sheet, then render each SVG to PNG at 1x. Run from any directory.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/.."
python3 src/sheets.py >/dev/null
python3 src/owl_sheets.py >/dev/null
python3 src/char_sheets.py otter >/dev/null
python3 src/animate.py
for f in svg/*.svg; do
  base="$(basename "$f" .svg)"
  rsvg-convert -f png -o "png/$base.png" "$f"
done
# the static fallback used by animation-test.html
rsvg-convert -f png -b "#2F5D3A" -o png/organizer-static.png svg/organizer-static.svg
rm -f png/organizer-rig.png png/organizer-static-sheet.png
echo "rendered $(ls png/*.png | wc -l | tr -d ' ') sheets"

# The 14-blockout-*.png renders come from Blender, not from this script:
#   blender -b -P docs/design/character-system/src/blockout.py
