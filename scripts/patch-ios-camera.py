#!/usr/bin/env python3
"""Declare NSCameraUsageDescription in the generated iOS Info.plist.

`tauri ios init` regenerates src-tauri/gen/apple/ on every CI build — the whole
of `src-tauri/gen/` is gitignored (see .gitignore, "The whole gen/ tree is
generated, never committed") — so anything the app needs in there beyond what
the template writes has to be re-applied after init. Same re-apply-after-init
pattern as patch-android-camera / -icons / -insets / -share on the Android side.

The QR-pair flow (QrScanner.svelte) calls
getUserMedia({ video: { facingMode: 'environment' } }) to read a pairing code
off the other device's screen. On iOS that reaches AVFoundation through
WKWebView, and an app that asks AVFoundation for the camera with no
NSCameraUsageDescription in its Info.plist is *terminated* by the OS rather
than denied. The symptom is "the app dies the instant you tap scan", which
reads like a crash bug and sends you looking at the wrong layer entirely.

Only the camera key. shizumu records no audio (the `voice_memo_*` columns
carry text; there is no capture path in the frontend — no MediaRecorder, and
the only getUserMedia call in src/ is QrScanner's) and it reads no photo
library, so NSMicrophoneUsageDescription and NSPhotoLibraryUsageDescription
would each be a purpose string for a capability the app does not use, which is
a thing App Review asks about.

Parsed with plistlib rather than string-anchored, because the file is XcodeGen
output whose whitespace and key ordering are not ours to depend on. The
structural anchor is "the root of this plist is a dict"; if it is not — the
file will not parse, or its root is an array — this refuses rather than
guessing where the key goes, the same way patch-android-camera refuses when
the INTERNET permission it anchors on is absent.

Idempotent: if the key is already present its value is left exactly as it is
(including one someone deliberately changed) and nothing is written, so a
second run — or a future tauri that ships the key itself — is a no-op.

UNVERIFIED ALTERNATIVE: tauri also merges a `src-tauri/Info.ios.plist` into the
generated plist when that file exists (`IosConfig::info_plist` in
node_modules/@tauri-apps/cli/config.schema.json: "Note that Tauri also looks
for a `Info.plist` and `Info.ios.plist` file in the same directory as the Tauri
configuration file"). Nobody has run that path against this project. If it is
confirmed to work, it is the better home for this key — a committed file beats
a CI step — and this script should be deleted, not kept beside it.

usage: patch-ios-camera.py <path to the generated Info.plist>
"""

import plistlib
import sys

KEY = "NSCameraUsageDescription"

# Rendered by iOS in the permission alert, so it is user-facing copy and
# follows the brand voice canon: lowercase, present tense, fewest words.
DESCRIPTION = (
    "shizumu uses the camera to read the pairing code shown on your other "
    "device. nothing else uses the camera."
)

if len(sys.argv) != 2:
    sys.exit("usage: patch-ios-camera.py <path to the generated Info.plist>")

path = sys.argv[1]

try:
    with open(path, "rb") as fh:
        plist = plistlib.load(fh)
except FileNotFoundError:
    sys.exit(
        f"patch-ios-camera: {path} does not exist. `tauri ios init` writes the "
        "generated Info.plist; run it first, and if the path has moved, find "
        "the real one rather than pointing this at a guess"
    )
except Exception as err:  # plistlib raises several unrelated types
    sys.exit(
        f"patch-ios-camera: could not parse {path} as a plist ({err}) — "
        "refusing to guess where the camera key goes"
    )

if not isinstance(plist, dict):
    sys.exit(
        f"patch-ios-camera: the root of {path} is {type(plist).__name__}, not a "
        "dict — the generated Info.plist changed shape; refusing to guess where "
        "the camera key goes"
    )

if KEY in plist:
    print(f"patch-ios-camera: {KEY} already present in {path}; nothing to do")
    sys.exit(0)

plist[KEY] = DESCRIPTION

with open(path, "wb") as fh:
    plistlib.dump(plist, fh)

# Read back rather than trusting the write: this runs against a file another
# tool generated moments earlier, and a silent no-op here is a crash on device.
with open(path, "rb") as fh:
    if KEY not in plistlib.load(fh):
        sys.exit(f"patch-ios-camera: write failed — {KEY} still absent from {path}")

print(f"patch-ios-camera: declared {KEY} in {path}")
