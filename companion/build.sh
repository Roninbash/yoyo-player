#!/bin/sh
# Builds dist/YoYo Companion.app (Apple silicon and Intel), signed to run on this Mac.
set -e
cd "$(dirname "$0")/.."
app="dist/YoYo Companion.app"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp companion/Info.plist "$app/Contents/Info.plist"

for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos13.0" companion/YoYoCompanion.swift -o "$tmp/$arch"
done
lipo -create "$tmp/arm64" "$tmp/x86_64" -output "$app/Contents/MacOS/YoYo Companion"

set_dir="$tmp/AppIcon.iconset"
mkdir "$set_dir"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" assets/logo.png --out "$set_dir/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" assets/logo.png --out "$set_dir/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$set_dir" -o "$app/Contents/Resources/AppIcon.icns"

codesign --force --sign - "$app"
echo "built $app"
