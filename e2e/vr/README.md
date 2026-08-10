# VR Tier-2 — Linux real-pixel (WebKitGTK)

Captures the REAL built app through the system WebKitGTK engine (the actual
Linux target) via tauri-driver, and pixel-diffs against committed baselines.
This is the real-engine counterpart to the root Tier-1 Playwright gate (which
uses a webkit *proxy*). Release-gated.

## Prerequisites (Linux)

    # Fedora
    sudo dnf install -y webkitgtk6.0 xorg-x11-server-Xvfb
    # Debian/Ubuntu
    sudo apt-get install -y webkit2gtk-driver xvfb
    cargo install tauri-driver

`WebKitWebDriver` must be on PATH.

## Run (from repo root)

    npm run test:vr:linux          # build VR binary + capture + diff
    npm run test:vr:linux:update   # same, but (re)write baselines

Both build the binary with VITE_VR=1 so the ?vr harness is embedded, then
`cargo build`, then drive it under xvfb.

## Baselines

    e2e/vr/baselines/linux/<scene>-<theme>.png   committed (18)

Baselines are WebKitGTK-version + host-font specific. **Canonical baselines are
generated in the CI Ubuntu image** (`ubuntu:22.04` + `webkit2gtk-driver`, the
same environment as the `test-e2e` job). Baselines generated on a different
distro/WebKitGTK build are provisional and will diff. Regenerate with
`test:vr:linux:update` in the canonical environment and commit.

Captures and diff images land in `e2e/vr/out/` (gitignored); on a mismatch the
error names the diff PNG.
