#!/usr/bin/env python3
"""Put the privacy manifest into the generated iOS project's app bundle.

App Store Connect refuses (ITMS-91053) a build whose binary calls a
"required reason" API with no reason declared in a PrivacyInfo.xcprivacy at
the root of the .app. The manifest is committed at
src-tauri/ios/PrivacyInfo.xcprivacy; `tauri ios init` regenerates
src-tauri/gen/apple/ on every CI build (the whole of src-tauri/gen/ is
gitignored), so it has to be re-added after init, the same re-apply-after-init
pattern as patch-ios-camera.py and the patch-android-* scripts.

What it does, against the gen/apple directory:
  1. copies the manifest to gen/apple/PrivacyInfo/PrivacyInfo.xcprivacy, a
     folder of its own, so it cannot overlap a folder the template already
     lists as a source (XcodeGen would then reference the file twice);
  2. adds that path to the single *_iOS target's `sources` in project.yml
     with `buildPhase: resources`, so XcodeGen puts it in Copy Bundle
     Resources and it lands at the root of the .app.

Run it after `tauri ios init` and BEFORE `xcodegen generate` (the signing step
in ios.yml regenerates the project), then confirm the result in the rendered
project.pbxproj, which this script cannot see.

Refuses rather than guesses: no project.yml, no single *_iOS target, or a
`sources` value of a shape XcodeGen does not accept each stop the build here,
cheaply, instead of shipping a build App Store Connect bounces 25 minutes
later. Idempotent: a target that already lists the manifest is left alone.

usage: patch-ios-privacy.py <gen/apple dir> <path to PrivacyInfo.xcprivacy>
"""

import os
import plistlib
import shutil
import sys

import yaml

REL = "PrivacyInfo/PrivacyInfo.xcprivacy"

if len(sys.argv) != 3:
    sys.exit("usage: patch-ios-privacy.py <gen/apple dir> <path to PrivacyInfo.xcprivacy>")

apple, manifest = sys.argv[1], sys.argv[2]
spec_path = os.path.join(apple, "project.yml")

try:
    with open(manifest, "rb") as fh:
        plistlib.load(fh)
except Exception as err:  # FileNotFoundError, or one of plistlib's several
    sys.exit(f"patch-ios-privacy: {manifest} is not a readable plist ({err})")

try:
    with open(spec_path) as fh:
        spec = yaml.safe_load(fh)
except FileNotFoundError:
    sys.exit(
        f"patch-ios-privacy: {spec_path} does not exist. `tauri ios init` writes it; "
        "run it first"
    )

targets = (spec or {}).get("targets") or {}
ios = [name for name in targets if name.endswith("_iOS")]
if len(ios) != 1:
    sys.exit(f"patch-ios-privacy: expected exactly one *_iOS target in project.yml, found {ios}")
target = targets[ios[0]]

# XcodeGen takes `sources` as a single path, a single entry, or a list of
# either. Normalise to a list without changing what it means.
sources = target.get("sources")
if sources is None:
    sources = []
elif isinstance(sources, (str, dict)):
    sources = [sources]
elif not isinstance(sources, list):
    sys.exit(f"patch-ios-privacy: {ios[0]}.sources is a {type(sources).__name__}; refusing to guess")


def path_of(entry):
    return entry if isinstance(entry, str) else (entry or {}).get("path")


os.makedirs(os.path.join(apple, os.path.dirname(REL)), exist_ok=True)
shutil.copyfile(manifest, os.path.join(apple, REL))

if any(path_of(e) == REL for e in sources):
    print(f"patch-ios-privacy: {ios[0]} already lists {REL}; manifest refreshed, project.yml unchanged")
    sys.exit(0)

sources.append({"path": REL, "buildPhase": "resources"})
target["sources"] = sources
with open(spec_path, "w") as fh:
    yaml.safe_dump(spec, fh, sort_keys=False)

# Read back rather than trusting the write.
with open(spec_path) as fh:
    back = yaml.safe_load(fh)["targets"][ios[0]]["sources"]
if not any(path_of(e) == REL for e in back):
    sys.exit(f"patch-ios-privacy: write failed, {REL} is not in {ios[0]}.sources")

print(f"patch-ios-privacy: {REL} added to {ios[0]} as a bundle resource")
