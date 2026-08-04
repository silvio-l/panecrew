#!/usr/bin/env bash
# Regenerates every PaneCrew app-icon asset from the single vector source of
# truth, panecrew-mark.svg. Run from anywhere; paths are resolved relative to
# this script. Requires: rsvg-convert, ImageMagick (magick), Python3+Pillow
# (padding mask), pnpm + the Tauri CLI, and (macOS only) iconutil.
#
# Why this isn't just `pnpm tauri icon <master.png>`: that command alone
# produces a *full-bleed* .icns, which is wrong for macOS — real macOS apps
# (VS Code, Warp, Terminal.app measured 2026-08-04) bake ~10% transparent
# margin + rounded superellipse (n=5) corners directly into the icon artwork
# instead of relying on OS auto-masking. So .icns is rebuilt separately from
# a padded/masked variant of the same master via iconutil; every other
# platform target (.ico, Windows Store set, favicons) uses the full-bleed
# master, matching that convention. `pnpm tauri icon` also emits iOS/Android
# outputs PaneCrew doesn't ship (v0.1 is macOS+Windows only) — deleted after.
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ICONS_DIR="$(dirname "$SOURCE_DIR")"
DESKTOP_DIR="$(dirname "$(dirname "$ICONS_DIR")")"
SVG="$SOURCE_DIR/panecrew-mark.svg"
MASTER="$SOURCE_DIR/panecrew-icon-master.png"
PADDED="$SOURCE_DIR/panecrew-icon-master-macos-padded.png"

CANVAS=2048
BG="#1F243C"            # measured flat background of the original master
EMBLEM_SIZE=1600         # panecrew-mark.svg viewBox
EMBLEM_OFFSET=223        # (CANVAS - EMBLEM_SIZE) / 2, centers the emblem
INSET=205                # macOS convention: ~10% of 2048
SUPERELLIPSE_N=5

echo "==> Rendering ${CANVAS}x${CANVAS} master from panecrew-mark.svg"
magick -size "${CANVAS}x${CANVAS}" "canvas:${BG}" "$SOURCE_DIR/.bg-tmp.png"
rsvg-convert -w "$EMBLEM_SIZE" -h "$EMBLEM_SIZE" "$SVG" -o "$SOURCE_DIR/.emblem-tmp.png"
magick "$SOURCE_DIR/.bg-tmp.png" "$SOURCE_DIR/.emblem-tmp.png" -geometry "+${EMBLEM_OFFSET}+${EMBLEM_OFFSET}" -composite -depth 8 -define png:color-type=2 "$MASTER"
rm -f "$SOURCE_DIR/.bg-tmp.png" "$SOURCE_DIR/.emblem-tmp.png"

echo "==> Building macOS squircle-padded master (10% inset, superellipse n=${SUPERELLIPSE_N})"
python3 - "$MASTER" "$PADDED" "$CANVAS" "$INSET" "$SUPERELLIPSE_N" <<'PYEOF'
import sys
from PIL import Image
import numpy as np

master_path, padded_path, canvas, inset, n = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
content = canvas - 2 * inset

src = Image.open(master_path).convert("RGBA")
assert src.size == (canvas, canvas), src.size
content_img = src.resize((content, content), Image.LANCZOS)

ss = 4
size_ss = content * ss
ys, xs = np.mgrid[0:size_ss, 0:size_ss]
c = (size_ss - 1) / 2
a = size_ss / 2
xn = np.abs((xs - c) / a)
yn = np.abs((ys - c) / a)
inside = (xn**n + yn**n) <= 1.0
mask_img = Image.fromarray((inside * 255).astype(np.uint8), mode="L").resize((content, content), Image.LANCZOS)

_, _, _, a_ch = content_img.split()
combined_alpha = Image.fromarray(
    (np.array(mask_img) / 255 * np.array(a_ch) / 255 * 255).astype(np.uint8), mode="L"
)
content_img.putalpha(combined_alpha)

out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
out.paste(content_img, (inset, inset), content_img)
out.save(padded_path)
PYEOF

echo "==> Running pnpm tauri icon (full-bleed master -> .ico, Store set, favicons, initial .icns)"
(cd "$DESKTOP_DIR" && pnpm tauri icon "src-tauri/icons/source/$(basename "$MASTER")")

echo "==> Dropping out-of-scope iOS/Android outputs (v0.1 is macOS+Windows only)"
rm -rf "$ICONS_DIR/ios" "$ICONS_DIR/android"

if command -v iconutil >/dev/null 2>&1; then
  echo "==> Rebuilding icon.icns from the padded master (real macOS convention, not full-bleed)"
  ICONSET="$(mktemp -d)/panecrew.iconset"
  mkdir -p "$ICONSET"
  for spec in "16:icon_16x16" "32:icon_16x16@2x" "32:icon_32x32" "64:icon_32x32@2x" \
              "128:icon_128x128" "256:icon_128x128@2x" "256:icon_256x256" \
              "512:icon_256x256@2x" "512:icon_512x512" "1024:icon_512x512@2x"; do
    size="${spec%%:*}"; name="${spec##*:}"
    magick "$PADDED" -resize "${size}x${size}" "$ICONSET/${name}.png"
  done
  iconutil -c icns "$ICONSET" -o "$ICONS_DIR/icon.icns"
  rm -rf "$(dirname "$ICONSET")"
else
  echo "!! iconutil not found (non-macOS host) — icon.icns still reflects the full-bleed pnpm-tauri-icon output, not the padded/squircle convention. Rebuild on macOS before shipping."
fi

echo "==> Done. panecrew-mark.svg is the single source of truth for this mark;"
echo "    every file this script wrote is derived, not hand-edited."
