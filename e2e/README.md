# e2e — Tauri boot smoke

WebdriverIO drives the built app through [`tauri-driver`], which proxies
WebDriver to the platform webview driver. **Playwright is not used** — it
can't drive Tauri's native webview; `tauri-driver` + WebdriverIO is the
documented Tauri 2 path.

[`tauri-driver`]: https://v2.tauri.app/develop/tests/webdriver/

## what this suite is for

One assertion: **the real binary launches, the webview loads, and Svelte
mounts.** Nothing else belongs here.

That narrowness is deliberate. This suite used to also carry four
"golden-path" specs (write-today, spawn-trail, pin-propagation, lock-screen).
None of them touched the UI — they called the Tauri IPC bridge directly,
because WebKitWebDriver implements neither the WebDriver Actions API nor
`click()` on contenteditable nodes. They were command-layer tests wearing a
webview harness, running in a job that could not fail the pipeline.

They now live where they belong:

| old spec        | now                                                         |
|-----------------|-------------------------------------------------------------|
| write-today     | `commands::tests::golden_path_write_today_survives_reopen`   |
| spawn-trail     | `commands::tests::golden_path_page_on_a_trail_is_reachable_through_it` |
| pin-propagation | `commands::tests::golden_path_pin_is_visible_from_a_sibling_page_on_the_trail` |
| lock-screen     | already covered by `crypto::tests::encrypted_db_roundtrip`   |

They run under `cargo test`, blocking, in milliseconds. If you're tempted to
add a data-invariant test here, add it there instead — the only thing worth
paying a webview boot for is behaviour that needs a real webview.

## prerequisites

### Linux (WebKitGTK)

```bash
# Fedora
sudo dnf install -y webkitgtk6.0 xorg-x11-server-Xvfb
# Debian/Ubuntu
sudo apt-get install -y webkit2gtk-driver xvfb

cargo install tauri-driver
```

`WebKitWebDriver` must be on PATH. A display is required — run headless
under `xvfb-run`.

### Windows (WebView2)

```powershell
choco install -y selenium-chromium-edge-driver
cargo install tauri-driver
```

`msedgedriver` must be on PATH, or set `TAURI_NATIVE_DRIVER` to its full
path. No display wrapper needed.

## build the app, then run

```bash
# from repo root: build the debug binary the driver launches
npx tauri build --debug --no-bundle

cd e2e && npm ci
xvfb-run -a npm test            # Linux
npm test                        # Windows
```

**It must be `tauri build --debug`, not `cargo build`.** A bare cargo debug
build resolves the webview URL to `tauri.conf.json`'s `devUrl`
(`http://localhost:1420`) rather than embedding `frontendDist`. With no vite
dev server running, the app opens on `about:blank` reading "Could not connect
to localhost: Connection refused" — Svelte never mounts, so not even the
unconditional `.app-shell` exists and every selector times out. Building the
frontend first does not help: the binary never reads `dist/`.

`tauri build --debug` runs `beforeBuildCommand`, embeds the assets, and still
writes `src-tauri/target/debug/shizumu`. `--no-bundle` skips installer
packaging, which this suite doesn't need.

Override the binary with `TAURI_APP_BINARY=/abs/path/to/shizumu` (e.g. a
release build). The suite sandboxes the app's data dir into a temp directory
for the run — `XDG_DATA_HOME` on Linux, `APPDATA`/`LOCALAPPDATA` on Windows
— so it can never touch your real writing.

## where it runs in CI

| job             | engine           | when              | gate                   |
|-----------------|------------------|-------------------|------------------------|
| `test-e2e`      | Linux WebKitGTK  | MRs + main + tags | soft (`allow_failure`) |
| `smoke-windows` | Windows WebView2 | tags only         | soft (`allow_failure`) |

`smoke-windows` runs on the self-hosted `windows-external-runner` after
`build-windows`, reusing that job's warm cache. It is the only place in the
pipeline a real WebView2 ever runs — the `win-webview2` Playwright VR
project is headless chromium standing in for it, not the engine itself.

Both are soft-gated on first landing to absorb webview-startup flake. Flip
`allow_failure` off once each has held green across a couple of runs.
