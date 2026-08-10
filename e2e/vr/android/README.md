# VR Tier-2 — Android real-pixel (System WebView)

Captures the REAL app through the Android System WebView (Chromium) on an
emulator, driven over CDP, and pixel-diffs against committed baselines. The
real-engine counterpart to the Tier-1 Playwright chromium+Pixel *proxy*.
Release-gated.

## Prerequisites

- Android SDK + emulator, `adb` on PATH, `ANDROID_HOME` set, `/dev/kvm` for a
  fast emulator, Rust android targets (`rustup target add x86_64-linux-android …`),
  and an AVD (default `Pixel_API_36`). `tauri android` CLI available.
- First run regenerates the Tauri Android project: `npx tauri android init`.

## Run (from repo root)

    npm run test:vr:android          # build VR debug APK + capture + diff
    npm run test:vr:android:update   # same, but (re)write baselines

Both build a **debug** APK with `VITE_VR=1` (harness embedded; debug enables
WebView remote debugging), boot a headless software-GPU emulator, install +
launch the app, forward the WebView CDP socket, and drive each scene.

## Baselines

`e2e/vr/baselines/android/` is NOT yet populated. The emulator + adb + debug
APK + CDP capture are implemented and verified functional, but reliable
baseline generation requires a clean Android emulator environment. Generate
canonical baselines by running:

    npm run test:vr:android:update

in the CI Android image (`cimg/android:2024.01.1-ndk`, the `build-android` job's
toolchain) or a clean local environment, then commit `e2e/vr/baselines/android/`.

Baselines are Android-System-WebView-version + AVD-profile specific.
Locally-generated baselines (different WebView version) are provisional;
regenerate in the canonical environment and commit.

Captures + diff images land in `e2e/vr/out/android/` (gitignored via `/e2e/vr/out/`).

### Emulator gotcha

Never kill emulators with `pkill -f qemu-system` (it self-matches the shell).
Clear stale AVD locks if boots start failing:

    rm ~/.android/avd/<AVD>.avd/*.lock
    rm -rf /run/user/$UID/avd/running/*
