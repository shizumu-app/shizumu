# Visual regression (Tier 1)

Engine-level VR for the in-scope targets, all on Linux, zero CI cost.

| Project            | Engine            | Target proxy                  |
|--------------------|-------------------|-------------------------------|
| `win-webview2`     | chromium desktop  | Windows WebView2              |
| `android-webview`  | chromium Pixel 7  | Android System WebView        |
| `linux-webkitgtk`  | webkit desktop    | Linux WebKitGTK family        |

## Run

    npm run test:vr            # chromium only — runs on bare Fedora/any host
    npm run test:vr:docker     # all three projects in the pinned Ubuntu image

`test:vr` intentionally excludes `linux-webkitgtk` because Playwright's local
webkit binary requires ICU 74 versioned symbols unavailable on Fedora 42.
The Docker image provides the matching Ubuntu environment where webkit runs.

## Update baselines (after an intentional UI change)

    npm run test:vr:docker:update
    git add tests/vr/baselines && git commit

**Docker-generated baselines are canonical.** Bare local Fedora runs may produce
chromium diffs from host font hinting; webkit only runs in Docker entirely.
Always regenerate via `test:vr:docker:update` so baselines are reproducible on
any Linux host and on a future self-hosted CI runner.

## Scripts summary

| Script                  | Projects          | Runs in          |
|-------------------------|-------------------|------------------|
| `test:vr`               | win + android     | local (Fedora OK)|
| `test:vr:update`        | win + android     | local            |
| `test:vr:all`           | win + android + webkit | Docker (inside container) |
| `test:vr:docker`        | win + android + webkit | Docker host  |
| `test:vr:docker:update` | win + android + webkit | Docker host  |

The `-v vr_node_modules:/app/node_modules` named volume keeps the container's
`node_modules` isolated from the host tree so `npm ci` inside Docker does not
clobber the host's native binaries.

**Caveat — root-owned outputs.** The container runs as root, so a local
`test:vr:docker*` run leaves root-owned `dist/` and `test-results/` in your
working tree (both gitignored). They can block a subsequent host `vite build`
(EACCES on `dist/`). Clean them with a throwaway root container (no sudo):

    docker run --rm -v "$PWD":/app -w /app \
      mcr.microsoft.com/playwright:v1.61.1-noble rm -rf dist test-results

In ephemeral CI this is a non-issue. (`outputDir`/report live under
`playwright-report/`, kept out of `test-results/` to avoid a Playwright
report-folder clash.)

## Diffs and reports

Test artefacts (diffs) and the HTML report land in `playwright-report/`
(gitignored). Open `playwright-report/vr/index.html` to inspect failures.

## Scenes and themes

Defined in `src/lib/vr/scenes.js`. Add new scenes there; the registry extends
without touching the test file.

## Baseline location

    tests/vr/baselines/win-webview2/      committed (provisional, see status)
    tests/vr/baselines/android-webview/   committed (provisional, see status)
    tests/vr/baselines/linux-webkitgtk/   NOT yet generated (Docker-only)

## Baseline status (read before relying on the Docker gate)

The committed `win-webview2/` and `android-webview/` baselines were generated on
a bare Fedora host (chromium). They prove the harness is deterministic locally,
but they are **provisional**: Ubuntu/Docker font hinting differs, so they will
not match Docker-rendered chromium, and **no `linux-webkitgtk/` baselines exist
yet** (the webkit engine only runs in the Docker image, which was not run in the
environment that built this).

To establish the canonical, cross-machine baselines, run **once** on a
Docker-capable host (or in CI):

    npm run test:vr:docker:update    # regenerates chromium ×2 + webkit ×1 = 54 baselines
    git add tests/vr/baselines && git commit

After that, `npm run test:vr:docker` is the authoritative gate.

**Do not file a wall of red as "hinting drift" without looking.** Hinting
drift is sub-pixel glyph noise; it does not move a header 26px or indent a
column. Every android-webview baseline went stale for three sessions
(2026-08-14 → 08-18) because a uniform shift across all scenes was written off
with this section as the citation — the actual cause was intentional layout
commits (inset floor removed, gutter restored, density pass) that nobody
re-baselined. When many scenes fail at once: `git log -1 -- <baseline.png>`,
diff the actual against it by eye, trace each difference to a commit, and only
then regenerate. Regenerate on the same host kind the passing baselines came
from (currently bare Fedora — see above), or the rest of the suite goes red.

## Real device coverage (future)

- **Plan 2** — Tier-2 Linux real-pixel (Linux WebKitGTK app, actual GTK render).
- **Plan 3** — Tier-2 Android real-pixel (Android emulator).
