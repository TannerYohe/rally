#!/bin/sh
# Builds build/icon.icns from resources/icon.png using macOS sips and iconutil.
set -e
ICONSET=$(mktemp -d)/icon.iconset
mkdir -p "$ICONSET" build
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" resources/icon.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" resources/icon.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o build/icon.icns
