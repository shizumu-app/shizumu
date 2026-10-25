#!/usr/bin/env python3
"""Re-apply the custom iOS app icons after `tauri ios init`.

`tauri ios init` regenerates gen/apple/ on every build and writes its own
AppIcon.appiconset. The workflow's diagnostic compared that set against the
committed one and found ALL EIGHTEEN different — not the three iPad sizes a
truncated first read of run 1's log suggested. So every build up to run 7
shipped tauri's generic icon at every size, iPhone included, which is exactly
the kind of half-finished look a TestFlight tester notices first.

That comparison is what this script was waiting for. Until it ran, nobody had
seen the generated names or sizes, and a script that copies files over a
naming scheme nobody has confirmed is a guess; the workflow deliberately
reported and changed nothing. The names are confirmed now, so this copies.

The real icon set lives in src-tauri/icons/ios/ (generated once by
`tauri icon`, then committed): 18 PNGs at the sizes their names claim, checked
against the generated set by the workflow step that calls this.

Narrow, in the same way patch-android-icons.py is narrow: it writes only
AppIcon-*.png files that the generated set ALREADY has, and never
Contents.json. Contents.json is what actool reads to find the icons; it is
generated, tauri owns it, and a stale committed copy of it would break the
asset catalogue in a way no icon diff would show. A committed PNG with no
counterpart in the generated set is reported and skipped rather than written,
because a file Contents.json does not reference is not an icon — it is
unreferenced weight in the bundle.

Idempotent, safe to run every build, and a no-op the day tauri starts carrying
the custom icons itself.

usage: patch-ios-icons.py <path to gen/apple/Assets.xcassets/AppIcon.appiconset>
"""

import filecmp
import shutil
import sys
from pathlib import Path

# PNG colour types that carry an alpha channel: 4 is grey+alpha, 6 is RGBA.
# App Store Connect rejects an upload whose large app icon has either —
# "Invalid large app icon. The large app icon in the asset catalog in
# shizumu.app can't be transparent or contain an alpha channel" — and it says
# so at UPLOAD time, after a full build has been paid for (run 9, 2026-09-22).
# The committed set was flattened in the same commit as this check; the check
# is what stops the next `tauri icon` regeneration from quietly re-adding the
# channel and costing another build to discover.
ALPHA_COLOUR_TYPES = (4, 6)


def has_alpha(png):
    """Colour type is byte 25 of a PNG: 8-byte signature, then the IHDR
    length/type/width/height/bit-depth that puts it at a fixed offset."""
    with png.open("rb") as fh:
        head = fh.read(26)
    if len(head) < 26 or head[:8] != b"\x89PNG\r\n\x1a\n":
        sys.exit(f"patch-ios-icons: {png.name} is not a PNG")
    return head[25] in ALPHA_COLOUR_TYPES

# The committed icon set, relative to the repo root (this script lives in
# scripts/, so the root is its parent's parent).
SRC = Path(__file__).resolve().parent.parent / "src-tauri" / "icons" / "ios"

if len(sys.argv) != 2:
    sys.exit("usage: patch-ios-icons.py <path to .../AppIcon.appiconset>")

dest = Path(sys.argv[1])

if not SRC.is_dir():
    sys.exit(f"patch-ios-icons: source icons not found at {SRC}")
if not dest.is_dir():
    sys.exit(f"patch-ios-icons: target appiconset not found at {dest}")

committed = sorted(SRC.glob("AppIcon-*.png"))
if not committed:
    sys.exit(
        f"patch-ios-icons: no AppIcon-*.png under {SRC} — the icon set moved "
        "or is empty; refusing to report success"
    )

transparent = [icon.name for icon in committed if has_alpha(icon)]
if transparent:
    sys.exit(
        "patch-ios-icons: these committed icons carry an alpha channel, which "
        "App Store Connect rejects at upload:\n  "
        + "\n  ".join(transparent)
        + "\nFlatten them onto an opaque background (they are already drawn on "
        "white) rather than shipping a build that cannot be uploaded."
    )

replaced = []
already = 0
missing = []

for icon in committed:
    target = dest / icon.name
    if not target.is_file():
        # Reported, not written: see the docstring. A name the generated
        # Contents.json does not carry is not an icon slot.
        missing.append(icon.name)
        continue
    if filecmp.cmp(icon, target, shallow=False):
        already += 1
        continue
    shutil.copy2(icon, target)
    replaced.append(icon.name)

for name in missing:
    print(f"patch-ios-icons: committed-only, skipped: {name}")

# Checked BEFORE anything reassuring is printed. Nothing matched at all means
# the generated set uses names this script does not know — the one case where
# a success line would be a lie, because the build would ship tauri's icons.
if not replaced and not already:
    sys.exit(
        f"patch-ios-icons: none of the {len(committed)} committed icons had a "
        f"counterpart in {dest} — the generated naming scheme changed; read "
        "the appiconset and update this script rather than shipping unpatched"
    )

if replaced:
    print(f"patch-ios-icons: replaced {len(replaced)} generated icon(s):")
    for name in replaced:
        print(f"  {name}")
else:
    print("patch-ios-icons: generated icons already match the committed set")

if already:
    print(f"patch-ios-icons: {already} already identical")
