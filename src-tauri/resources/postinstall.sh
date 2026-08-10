#!/bin/sh
# Post-install: link metainfo to system location for KDE Discover / GNOME Software
mkdir -p /usr/share/metainfo
ln -sf /usr/lib/shizumu/resources/app.shizumu.Shizumu.metainfo.xml /usr/share/metainfo/app.shizumu.Shizumu.metainfo.xml

# Symlink icons under the reverse-DNS name (app.shizumu.Shizumu) so the desktop
# file's Icon=app.shizumu.Shizumu resolves correctly. Tauri installs icons as
# "shizumu.png" (productName); the desktop file references "app.shizumu.Shizumu".
for size in 32x32 128x128 512x512; do
    src="/usr/share/icons/hicolor/${size}/apps/shizumu.png"
    dst="/usr/share/icons/hicolor/${size}/apps/app.shizumu.Shizumu.png"
    if [ -f "$src" ] && [ ! -e "$dst" ]; then
        ln -sf "$src" "$dst"
    fi
done

# Install a proper 256x256 icon from the @2x variant (Tauri puts it in
# 256x256@2/ which some desktop environments don't look up correctly).
src_2x="/usr/share/icons/hicolor/256x256@2/apps/shizumu.png"
if [ -f "$src_2x" ]; then
    mkdir -p /usr/share/icons/hicolor/256x256/apps
    cp "$src_2x" /usr/share/icons/hicolor/256x256/apps/shizumu.png
    ln -sf /usr/share/icons/hicolor/256x256/apps/shizumu.png \
           /usr/share/icons/hicolor/256x256/apps/app.shizumu.Shizumu.png
fi

# Update icon cache
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
fi

# Update desktop database
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications 2>/dev/null || true
fi
