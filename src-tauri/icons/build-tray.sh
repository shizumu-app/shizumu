#!/usr/bin/env bash
# Render tray glyph rasters from tray-{dark,light}.svg.
# Run after editing the source SVGs. Requires ImageMagick (`magick`).

set -euo pipefail

cd "$(dirname "$0")"

SIZES=(16 22 24 32 64)
VARIANTS=(dark light)

for variant in "${VARIANTS[@]}"; do
  src="tray-${variant}.svg"
  out="tray/${variant}"
  mkdir -p "$out"
  for size in "${SIZES[@]}"; do
    magick -background none -density 384 "$src" \
      -resize "${size}x${size}" \
      -define png:color-type=6 \
      "${out}/${size}x${size}.png"
    echo "  rendered ${out}/${size}x${size}.png"
  done
done
