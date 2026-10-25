# Visual regression (Tier 1)

Engine-level VR for the in-scope targets, all on Linux, zero CI cost.

| Project            | Engine            | Target proxy                  |
|--------------------|-------------------|-------------------------------|
| `win-webview2`     | chromium desktop  | Windows WebView2              |
| `android-webview`  | chromium Pixel 7  | Android System WebView        |
| `android-landscape`| chromium Pixel 7  | Android System WebView (landscape) |
| `linux-webkitgtk`  | webkit desktop    | Linux WebKitGTK family        |
| `ios-webkit`       | webkit iPhone 14  | iOS WKWebView                 |

## Run

    npm run test:vr            # chromium only — runs on bare Fedora/any host
    npm run test:vr:docker     # all five projects in the pinned Ubuntu image

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
| `test:vr:all`           | all five projects | Docker (inside container) |
| `test:vr:docker`        | all five projects | Docker host  |
| `test:vr:docker:update` | all five projects | Docker host  |

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
without touching the test file. Each scene must declare its surface via `sceneSurface`
so it targets the correct projects (desktop, shell, or both).

## Baseline location

    tests/vr/baselines/win-webview2/      Docker-generated, canonical
    tests/vr/baselines/android-webview/   Docker-generated, canonical
    tests/vr/baselines/android-landscape/ Docker-generated, canonical
    tests/vr/baselines/linux-webkitgtk/   Docker-generated, canonical
    tests/vr/baselines/ios-webkit/        Docker-generated, canonical

## Baseline status

All five projects are baselined from the Docker image, and
`npm run test:vr:docker` is the authoritative gate. Measured on 2026-09-03,
on a second consecutive run so that every baseline written by the first was
compared rather than created:

    255 passed · 13 failed · 367 skipped

The 367 skips are the projects each scene does not belong to — the surface
and theme rules in `visual.spec.js`, not anything broken.

**All 13 are stale baselines now.** The number has not moved and the
composition has: `shell-page @ collapsed` used to be the one entry here that
was not a baseline problem, and it is one now. Written down at this length
because the 13 were filed as a single number twice before, and each time the
wall of red stopped being read.

- **12 · genuinely stale, awaiting the re-record.** `shell-gallery` and
  `shell-gallery-sheet`, three themes on two shell projects. 1100–2240
  pixels each. Only `npm run test:vr:docker:update` fixes these, and the
  permission for it has not been granted.
- **1 · stale for a provable reason, awaiting one deletion.**
  `shell-page @ collapsed`. **The product bug it used to report is fixed**
  (`caretRecheckWarranted`, see `caret-visible.js`): the driver now reaches
  the shutter, both scroll arms pass honestly, the band holds `scrollTop 0`
  under the unfold and rests at a deterministic 60 for the capture. What
  fails is the image, by 12818 px (ratio 0.04, against a 0.002 budget), and
  the whole of that difference is one commit old.

  Measured on the three artefacts rather than argued: the nav band differs on
  rows 16–24 and nowhere else — the `find` label — and the body is the
  committed image shifted down by exactly 2px (mean absolute difference 0.08
  after the shift), because the extra control makes the folded bar 2px taller
  and the divider moves 64 → 66. `b338ca3e` "shell: the phone gets in-page
  find" landed 2026-08-29 12:27; this baseline was last written by
  `5e7d4cc5` at 02:17 the same day. That is the same cause, the same commit
  and the same ten hours that the ten deleted `shell-page` interaction
  baselines below are recorded under — this one escaped that sweep only
  because the state threw before the shutter, so nobody could see its image
  to compare.

  The fix is to **delete
  `tests/vr/baselines/android-webview/shell-page-collapsed.png`** and let the
  next plain `npm run test:vr:docker` write it: Playwright 1.61 defaults
  `updateSnapshots` to `missing`, so that is a birth and touches no other
  baseline. It is deliberately NOT done in the commit that fixed the product
  bug — deleting committed evidence is its own decision, it needs the
  permission the twelve above are also waiting on, and a scroll fix that
  quietly rewrote the picture of itself would be the one change nobody could
  check.

**One baseline was BORN after that measurement, and the counts above predate
it.** `shell-page @ ios-keyboard-sheet` on `ios-webkit` — the iOS keyboard
fixture — is a new state, so `tests/vr/baselines/ios-webkit/shell-page-ios-
keyboard-sheet.png` did not exist and a plain run wrote it. That is a birth,
not a re-record: Playwright 1.61 defaults `updateSnapshots` to `missing`, the
creating run reported it failed and no other baseline was touched. It was
**confirmed on a second run** (`1 passed`), which is the rule this file states
two paragraphs down — a creating run and a failing run report the same colour,
so only the run that compares can tell a baseline from a one-shot.

The numbers it was born with, printed by the driver to the run log and
identical across both runs:

    [ios-keyboard-sheet] sheet 164..328 (h 164) · layout viewport 664px ·
    visual viewport 328px at offset 0px · --kb-inset 336px ·
    --kb-overlay 336px · --app-height 328px

That is `resizes-visual`: the layout viewport stays at the iPhone's full 664px
while the visual viewport is 328, `--kb-overlay` carries the whole 336px
keyboard (it is **0 in every other capture in this suite**), and the sheet's
bottom edge lands on 328 — the lowest pixel the keyboard leaves visible.

**Read the image before assuming it broke.** The lower ~336px of the frame is
bare page background, because the layout viewport is full height and the app
has correctly confined itself to the top 328. On a device the keyboard
occupies exactly that band. A capture in which the shell fills the whole frame
would be the Android geometry under an iPhone filename — see
`STATES.IOS_KEYBOARD_SHEET` in `src/lib/vr/scenes.js` for what the fixture is
and, just as important, what it does not prove.

It was **proven red** the way this repo requires, and the proof is worth
repeating here because it is also the justification for the state existing at
all. Sheet.svelte's `margin-bottom: var(--kb-overlay, 0px)` was temporarily
replaced with `0px` and both phone projects were run over `insert-sheet` and
`ios-keyboard-sheet` together. This state failed — *"the box is 500..664 and
the visible band is 0..328 — its bottom edge is under the keyboard"* — and
`android-webview @ insert-sheet` **passed in the same run with the same broken
stylesheet**. On a viewport mode where the layout viewport already shrank,
deleting the lift changes nothing, so no Android capture can see that defect.
The lift was restored and both went green.

The rest of `android-webview` was re-run after these changes (the shared
`shellStripSetup` and `assertSheetShape` were both touched): **119 passed, 7
failed, 2 skipped**, and the 7 are exactly the stale baselines listed above —
six `shell-gallery*` and `shell-page @ collapsed`. No new failure.

**Sixteen have left this list by being deleted, and that is the sanctioned
path when the cause is provable.** Six went first: `shell-trail-page` at
load, three themes on two shell projects. `879c3ddf` capped `Row`'s value
column and `PageScreen`'s `what settled` row is a `Row`, so the committed
PNG held the defect the cap fixed — label broken across two lines, value
wrapped under it — and the actual held the fix. The evidence was the images,
not the trace: every one of the six diffs was confined to a 46px band at
y 368–414, the settled row and its divider, with nothing else on the page
over threshold.

**The ten interaction states followed, and each one was traced to source
before it was deleted.** Five separate commits, none of them a regression,
every diff confined:

- **`shell-page` @ block-strip and selection-strip** — three bands each and
  nothing outside them. The nav bar gains `find` (`b338ca3e`, which lands
  between these two baselines and the other two: block/selection were shot
  at `5e7d4cc5` 02:17 and find/suggestion at `ed3b25fe` 14:46, and the
  committed nav band matches that split exactly). The "what matters now"
  zone moves right to `var(--tap)` so it aligns with the prose under the
  gutter (`6b48f39c`). And the slot: `ToolbarButton` gains horizontal
  padding (`cb49a465`) and `pin` / `pin-selection` gain their commands and
  stop rendering dead (`1970c3ce`).
- **`shell-page` @ suggestion-strip** — two bands: the same
  "what matters now" move, and the chips. The committed chips read
  `heading 1heading 2heading 3`, one string across three tap targets with
  the first glyph under the mask fade; the actual reads them spaced and
  whole. That is `cb49a465` in its own words, photographed.
- **`shell-page` @ find-strip** — the same "what matters now" move, and the
  slot. The committed strip runs `1 of 1` into `previous`, and its search
  field has no outline at all. `cb49a465` separates the labels; `d5e0b2ef`
  gives `Field` a hairline border.

  That "what matters now" band is the same 8px strip in all four strip
  states, and in both directions it is **byte-identical across them** —
  four photographs of one change, not four changes. The nav band divides
  them the way the baseline dates predict and nowhere else.
- **`shell-page` @ settled-sheet, chart-sheet, chart-sheet-timeline and
  `shell-trail-page` @ trail-sheet** — one cause, and the cleanest proof in
  the set. `d5e0b2ef` gave `Field` a `1px solid var(--hairline)` border
  because "P2f-2's photographs found a field reading as a HEADING at
  cream". The committed PNGs are that heading: `name a trail` and
  `title (optional)` sit on the sheet as plain lines of text. Below the
  field, the actual is the expected translated **exactly 2px** — the
  border's two edges — with **zero** pixels over threshold once shifted.
  Shifting by 1 or by 3 instead puts every one of those pixels back
  (5074 on the chart sheet, 891 on the settled sheet), which is what makes
  the 2 a measurement rather than a fit.
- **`shell-trail-page` @ date-sheet and pages-sheet** — `879c3ddf`'s `Row`
  cap again, on the same `what settled` row, confined to y 368–400 plus the
  divider at y 413. Both diffs are 2711 pixels, to the pixel: one row, two
  photographs.

All sixteen were `git rm`'d and re-born by a plain `npm run test:vr:docker`,
which writes a baseline that does not exist and reports it failed on that
creating run only. That is NOT `--update-snapshots`, which rewrites every
baseline at once and would launder a real regression in with an intended
one. Delete on proof, one scene at a time; never re-record a wall. And
confirm on a SECOND run: a creating run and a failing run report the same
colour, so only the run that compares can tell a baseline from a one-shot.

Two states that used to be in the third group left it here: `block-strip`
and `selection-strip` had captions asserting `pin` and `pin-selection`
render disabled, which P2f Task 1 stopped being true. Their drivers threw
before the shutter for a whole phase — a state that has silently stopped
photographing anything, not a state that is failing. Captions corrected, so
they reached the shutter again and failed honestly on a stale PNG, which is
how they came to be read and deleted above.

**`vr-tier1` was red for weeks, and this is why.** Baselines regenerated on
the bare Fedora host pass locally and fail in CI, because CI runs the same
pinned Ubuntu image this Dockerfile builds and its font metrics differ by a
sub-pixel here and there. It costs about 1% of pixels — over the 0.002
`maxDiffPixelRatio` threshold, well under anything a human would notice. So
the suite looks broken while every screenshot looks right, and the temptation
is to stop reading it. That is how the 08-14 → 08-18 regression got through.

The rule that prevents it: **never run `test:vr:update` (bare local) and
commit the result.** Only `test:vr:docker:update` produces baselines CI
agrees with. `test:vr` and `test:vr:update` are for a fast local look while
iterating; nothing they write should reach a commit.

One trap worth knowing: a Docker run mounts the repo read-write as root and
Playwright WRITES any snapshot it finds missing, then reports that test as
failed for the run that created it. So a plain `test:vr:docker` can leave new
untracked `.png` files behind. They are legitimate baselines for scenes that
had none — check `git status` after a run, and commit them deliberately
rather than letting them accumulate untracked.

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
