#!/usr/bin/env bash
# Stamps the Nightly channel badge onto the Stable icon masters and rebuilds
# the small subset of icon.* outputs tauri.nightly.conf.json's `bundle.icon`
# override actually needs (macOS .icns + the three PNGs; .ico too, for a
# future Windows build). Additive to generate-icons.sh, not a modification of
# it — run generate-icons.sh FIRST when panecrew-mark.svg itself changes, then
# this script to refresh the Nightly badge from its (possibly new) masters.
#
# Badge choice (2026-08-13): a filled circle in PaneCrew's own cyan ANSI
# accent (#29a9ac, the "cool counterpart" already established in
# docs/decisions.md's brand section) with a thin ring in the icon's own flat
# background color as separation from the amber emblem — no new brand color
# invented, no change to panecrew-mark.svg or its gradient. Bottom-right
# corner, ~14% of canvas radius: legible as a distinct dot at 16px dock/
# taskbar size without touching the emblem's own silhouette.
#
# Requires: ImageMagick (magick), Python3+Pillow, (macOS only) iconutil.
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ICONS_DIR="$(dirname "$SOURCE_DIR")"
MASTER="$SOURCE_DIR/panecrew-icon-master.png"
PADDED="$SOURCE_DIR/panecrew-icon-master-macos-padded.png"
BADGED_MASTER="$SOURCE_DIR/.nightly-badge-master-tmp.png"
BADGED_PADDED="$SOURCE_DIR/.nightly-badge-padded-tmp.png"
NIGHTLY_DIR="$ICONS_DIR/nightly"

CANVAS=2048
INSET=205                # must match generate-icons.sh's INSET -- the padded
                          # master's actual artwork sits inside this margin,
                          # a badge placed at full-bleed coordinates on it
                          # pokes past the squircle edge.
BADGE_COLOR="#29a9ac"   # PaneCrew cyan, dark-ground value (icons bring their own dark ground)
RING_COLOR="#1F243C"    # matches generate-icons.sh's BG, separates badge from emblem
BADGE_RADIUS=145         # ~14% of CANVAS/2, full-bleed master's scale
RING_WIDTH=22
BADGE_CENTER=1660        # inset from the bottom-right corner, full-bleed master's scale

for f in "$MASTER" "$PADDED"; do
  [ -f "$f" ] || { echo "!! Missing $f -- run generate-icons.sh first." >&2; exit 1; }
done

mkdir -p "$NIGHTLY_DIR"

echo "==> Stamping Nightly badge onto both masters"
python3 - "$MASTER" "$BADGED_MASTER" "$PADDED" "$BADGED_PADDED" \
  "$CANVAS" "$INSET" "$BADGE_COLOR" "$RING_COLOR" "$BADGE_RADIUS" "$RING_WIDTH" "$BADGE_CENTER" <<'PYEOF'
import sys
from PIL import Image, ImageDraw

master_in, master_out, padded_in, padded_out, canvas, inset, badge_color, ring_color, radius, ring_width, center = sys.argv[1:]
canvas, inset, radius, ring_width, center = int(canvas), int(inset), int(radius), int(ring_width), int(center)

def stamp(src_path, dst_path, radius, ring_width, center):
    img = Image.open(src_path).convert("RGBA")
    assert img.size == (canvas, canvas), img.size
    draw = ImageDraw.Draw(img)
    ring_bbox = [center - radius - ring_width, center - radius - ring_width,
                 center + radius + ring_width, center + radius + ring_width]
    draw.ellipse(ring_bbox, fill=ring_color)
    badge_bbox = [center - radius, center - radius, center + radius, center + radius]
    draw.ellipse(badge_bbox, fill=badge_color)
    img.save(dst_path)

stamp(master_in, master_out, radius, ring_width, center)

# The padded master's real artwork lives inside a (canvas - 2*inset) content
# box, not the full canvas -- scale the same relative badge placement/size
# down to that box so it lands inside the squircle instead of past its edge.
content = canvas - 2 * inset
scale = content / canvas
p_radius = round(radius * scale)
p_ring_width = round(ring_width * scale)
p_center = round(inset + center * scale)
stamp(padded_in, padded_out, p_radius, p_ring_width, p_center)
PYEOF

echo "==> Rendering icons/nightly/{32x32,128x128,128x128@2x}.png (full-bleed convention, matches icons/)"
# `pnpm tauri icon` (used for the Stable set) always emits RGBA; a plain
# `magick -resize` on our RGB (color-type=2) master doesn't add an alpha
# channel on its own, and Tauri's build rejects a non-RGBA icon outright --
# `-alpha set`/`PNG32:` force one explicitly.
magick "$BADGED_MASTER" -alpha set -resize 32x32 "PNG32:$NIGHTLY_DIR/32x32.png"
magick "$BADGED_MASTER" -alpha set -resize 128x128 "PNG32:$NIGHTLY_DIR/128x128.png"
magick "$BADGED_MASTER" -alpha set -resize 256x256 "PNG32:$NIGHTLY_DIR/128x128@2x.png"

echo "==> Rendering icons/nightly/icon.ico (multi-resolution)"
magick "$BADGED_MASTER" -define icon:auto-resize=16,32,48,64,128,256 "$NIGHTLY_DIR/icon.ico"

if command -v iconutil >/dev/null 2>&1; then
  echo "==> Rendering icons/nightly/icon.icns from the badged padded master"
  ICONSET="$(mktemp -d)/panecrew-nightly.iconset"
  mkdir -p "$ICONSET"
  for spec in "16:icon_16x16" "32:icon_16x16@2x" "32:icon_32x32" "64:icon_32x32@2x" \
              "128:icon_128x128" "256:icon_128x128@2x" "256:icon_256x256" \
              "512:icon_256x256@2x" "512:icon_512x512" "1024:icon_512x512@2x"; do
    size="${spec%%:*}"; name="${spec##*:}"
    magick "$BADGED_PADDED" -resize "${size}x${size}" "$ICONSET/${name}.png"
  done
  iconutil -c icns "$ICONSET" -o "$NIGHTLY_DIR/icon.icns"
  rm -rf "$(dirname "$ICONSET")"
else
  echo "!! iconutil not found (non-macOS host) -- icons/nightly/icon.icns not rebuilt."
fi

rm -f "$BADGED_MASTER" "$BADGED_PADDED"
echo "==> Done. icons/nightly/ holds the Nightly-badged subset tauri.nightly.conf.json's bundle.icon points at."
