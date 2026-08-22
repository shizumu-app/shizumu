# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

shizumu (沈む) is a private thinking space. The canon is four verbs:

> write to think.
> pin what matters.
> trail what continues.
> the rest sinks.

Three active verbs (write · pin · trail) plus one passive default (sink). The three durable primitives map cleanly: **page** is the writing surface (ephemeral by default), **pin** is the kept artifact (intentional retention), **trail** is the structural through-line (intentional continuity). Pin × trail is the high-value cross-product — "show me the pins on my book trail" is the six-month executive summary no notebook app can produce.

**Positioning anchor:** shizumu is not a notebook you pile into. The volume of writing is not the artifact; what you pin is. Three beats, in order — **think** (by writing) · **keep** (by pinning what matters) · **let sink** (everything else is fuel, not inventory).

**Cognitive grounding (why the verbs work).** Thinking happens during the *production* of sentences, not the marking of them — the page, not the pin, is where the thinking gets done. Sink is what makes the writing honest: knowing the rest is ephemeral lowers the stakes and quiets the editor-voice. Sink reads as the passive default but does the most active psychological work in the system. Pins are pointers back into your thinking, not the thinking itself. The on-canon claim is **"your thinking happens on the page. the pins are where you left it."** Never claim "your thinking is in the pins" — that overclaims what selection can deliver (a pin is a highlight; the transformation happened while writing).

**Return beat (encounter-time).** The three beats describe capture-time. Insight arrives twice: once while writing, once on return. The return is re-reading and curating the pins on a trail — reordering and unpinning there *is* re-thinking. The pin × trail view is where the six-month executive summary actually gets read. Pins sink too, if you let them go: unpinning is part of the model, not a failure of it.

**Pin pointer clause (sunk, not shredded).** A pin is a pointer plus a frozen snapshot: it caches its content and keeps a reference to its source page (migration 013, pin pointer semantics). When the source page is deleted, the pin survives orphaned with its cache intact. Sunk writing stays reachable through what was pinned from it — sinking lowers the stakes; it does not shred the record.

**Trail-exception clause (load-bearing).** Continuous trails look like piling because they're one document the user keeps adding to. They're not — they're the intentional exception. When one thread should genuinely keep growing (a book, a long project, a life-arc), the user chooses to trail it. That's a deliberate refusal of sinking for that one focused topic, not the default pile.

See `shizumu-mvp-prd.md` for full specification.

## Commands

```bash
npm run dev          # Start Vite dev server (frontend only, port 1420)
npm run build        # Build frontend to dist/
npx tauri dev        # Run full Tauri app in dev mode (frontend + Rust backend)
npx tauri build      # Production build (creates platform installer)
cd src-tauri && cargo check  # Type-check Rust backend
```

### Linux Prerequisites (Fedora)
```bash
sudo dnf install webkit2gtk4.1-devel libsoup3-devel javascriptcoregtk4.1-devel gtk3-devel
```

## Tech Stack

- **Framework:** Tauri 2.0 (desktop app + web PWA)
- **Frontend:** Svelte 5
- **Backend:** Rust (Tauri commands)
- **Database:** SQLite via sqlx (local-first; cloud sync via self-deploy relay is planned for v1, not in MVP)
- **Animations:** Svelte native transitions
- **Fonts:** Embedded Lora (body) + DM Mono (interface labels)

## Architecture — Two Spaces

The app has two spatial layers the user moves between:

- **THE PAGE** — always home. Where you write. Contains the writing canvas (TipTap editor), "what matters now" field, "what shifted" kaizen strip.
- **MEMORY** (swipe up from PAGE) — chronological history and long-view data. Page thumbnails grouped by date, full-text search via FTS5, commitment tracking. Also includes presence block (writing calendar) and "what shifted" diary for reflection across time.

## Trail Modes

Pages can optionally belong to a trail (lineage). A trail has one of two modes:

- **Discrete** — per-day focus pages. Multiple pages per day allowed on the same trail; each is independent. Past-day entries are never surfaced on the writing canvas; browsing history happens in memory.
- **Continuous** — one canonical living document per trail, freeform-editable. Max one page per continuous trail, ever. Each day's "what matters now" is captured on first open and stamped into the doc as a non-content `dayMarker` decorator node (date + focus, soft styling, excluded from word count). `Cmd/Ctrl+K` opens a navigation palette indexing all dayMarkers in the current doc.

Trails may be nested (any depth). Each lineage owns its own doc/pages; a continuous parent does not share a doc with its continuous children. Deleting a parent trail re-parents its children to the grandparent (or null).

## Data Model

MVP SQLite tables: `pages`, `lineages`, `pages_fts` (FTS5 virtual table). See `src-tauri/migrations/` for schemas (001 through 010+).

Key relationships:
- Pages are identified by date + page_number (multiple pages per day on discrete trails or untrailed).
- Continuous trails enforce a single canonical page per `lineage_id` at the command layer.
- Lineages may nest via `parent_id`. Mode (`discrete` / `continuous`) is stored on the lineage row.
- Page content is a single TipTap doc JSON blob (`content_json`); FTS index is updated on save.

## Tauri Command Surface

Rust backend exposes commands for: page CRUD, line saving, navigation, thread/search queries, ground data, commitment management, voice memo capture, and page signature computation. See PRD section 9 for the full command list.

## Design Constraints

- **Past pages are read-only** on discrete trails (and untrailed pages): open yesterday in memory, write today on PAGE. Continuous trails are the deliberate exception — their single canonical doc is freeform-editable at any position.
- **Discrete trails never surface past days on the writing canvas.** If the user wants yesterday, they go to memory. The writing surface is now.
- **No prompts, tags, folders, templates, streaks, or social features.** These are permanent refusals.
- **All data local.** Nothing leaves the device without explicit export.
- **Column width fixed at ~65 characters.** Margins expand with window.
- **Interface language:** see "Brand voice canon" below for the rules.

## Brand voice canon

Any user-facing string (onboarding, empty states, placeholders, button labels, store metadata, landing page) must follow these rules.

**Active verbs to thread:** write · pin · trail · sink. Any new copy threads one of these or stays neutral chrome.

**Three primitives:** page · pin · trail.

**Positioning anchor:** "not a notebook you pile into." Describe the behavior shift (piling-in vs. pinning-what-matters), not a category-noun substitution. Do **not** use "shizumu is a distillation surface" or "shizumu is a press, not a notebook" — both are off-canon, as is any press metaphor ("the writing is the press", "pins are what comes out").

**Pin claim (corrected):** the on-canon line is "your thinking happens on the page. the pins are where you left it." Do **not** write "your thinking is in the pins" — pins are selection, not transformation; the overclaim invites the pile-of-highlights failure mode the product exists to avoid.

**Sink claim:** sink is not just a storage policy; it is what makes the writing honest. A page that keeps everything makes you write for posterity; a page that sinks lets you write to think. When sink appears in copy, prefer the behavior claim (how it changes the writing) over the cleanup claim (less clutter).

**Trail-exception clause:** when the piling contrast is drawn, name continuous trails as the intentional refusal of sinking for one focused topic. Keeps the framing coherent rather than self-contradicting.

**Continuous-trail pin clause:** on continuous trails sink does not operate, so pins are the compression valve — the doc grows because the user chose continuity; the pins keep it from becoming a wall to re-read. This is where pin × trail is strongest; name it when the trail exception is drawn in long-form copy.

**Cross-product anchor:** pin × trail is the executive summary. The six-month view across one topic. The return beat lives here: re-reading and curating pins on a trail is re-thinking, and unpinning is part of the model (pins sink too, if you let them go).

**Voice:**
- lowercase, present tense, fewest words possible
- punctuation: em-dash for clauses, period for stops, no exclamation marks
- prose over tables for competitive differentiation (behavior-vs-behavior, not feature tables)

**Forbidden words / patterns:**
- productivity, optimize, habit, streak, mindful, journey, growth, flow (as standalone noun)
- exclamation marks
- future-tense promises ("you'll soon notice…")
- imperative therapy ("breathe", "reflect")
- prescriptive verbs ("declare", "commit")
- "your thinking is in the pins" (overclaim — see pin claim above)
- press metaphors ("the press", "what comes out", "distillation surface")
- competitive differentiation via feature-comparison tables (that's Notion's voice, not shizumu's)

**Cloud sync clarification:** cloud sync via self-deploy relay is planned for v1 (privacy-respecting; users run their own server). Do **not** list "no cloud" as a refusal anywhere. The differentiation is the piling premise, not hosting. Live collaborative multiplayer IS refused (solo writing surface).

**Permanent refusals:** prompts · tags · folders · templates · streaks · social features · plugins · graph view · AI-generated writing.

## Color Themes

Three canvas tones — Cream (default: `#F5F0E8`), White (`#FAFAFA`), Dark (`#141210`).

## Performance Targets

- Cold launch to blank page: < 800ms
- Typing latency on continuous docs of 50k+ words: no perceptible lag
- Search results: < 300ms for 1000 pages

## Testing rules

Four rules, each written after a defect reached a device despite a green suite.

**Decisions go in pure modules, not inside components.** Layout geometry, gesture
intent, viewport arithmetic, and data-shape conversion each live in their own
module with unit tests — never inline in a `.svelte` file, where nothing can
reach them. See `src/lib/swipe-intent.js` (which edge means what),
`src/lib/keyboard-state.js` (`computeKeyboardState` — the app's only
visualViewport reader), `src/lib/gesture-arming.js` (may a view-switch gesture
arm at all), `src/lib/header-collapse.js` (may the header collapse right now),
`src/lib/editor/block-actions.js` (which actions a block offers),
`src/lib/editor/touch-reveal-dismiss.js` (may a blur put the touch toolbar
away, and is this tap addressing an affordance rather than a block),
`src/lib/pin-carry-forward.js` (`pinToNodes`),
`src/lib/page-address.js` (`pageAddress` — which identifier addresses a page).
Every one of those was extracted *because* the bug it now guards shipped.

`src/lib/editor/handle-placement.js` used to head this list. It is gone: it
existed only to place the floating block-handles bar that phones fell back to
when the editor gutter was removed on small screens, and that whole layout was
deleted when the gutter came back (the floating bar was the root of a long run
of controls-over-content bugs). A pure module outliving the decision it made is
dead weight, not coverage — delete it, and say so here, rather than leaving a
pointer to a file that no longer exists.

**A test asserting "nothing happens" must say why.** `expect(fn(x)).toEqual([])`
is indistinguishable from a bug someone wrote down as correct — a plain-text note
pin silently vanishing was protected by exactly that assertion for as long as it
existed. Comment the reason the empty result is right, or assert the real
behaviour instead.

**`env(safe-area-inset-*)` appears in exactly one place**: the `--safe-*`
definitions in `src/styles/global.css`. Everything else reads `var(--safe-top)`
and friends. The shell reserves the status bar once; a surface inside it that
re-adds the inset is double-counting (memory did, and its list started ~50px too
low). The indirection is also the seam the VR harness overrides via
`?inset=notch`, which is what makes an inset regression a failing screenshot
rather than a device-only finding.

**A phone bug you have to *do* something to see needs a VR interaction state.**
Load-time screenshots cannot show a revealed block bar, a collapsed header, or an
expanded strip. Add the state to `SCENES[...].states` and a driver in
`tests/vr/states.js` — driven by real input, never by a hook inside the app, or
the test passes while the real path stays broken.

When you add a regression test, prove it: reintroduce the bug, watch it go red,
then restore. A test that does not fail on the bug it was written for is
decoration.

## Build Sequence

Development follows a strict 24-week plan (see PRD section 14). **Critical gate:** continuous-trail single-doc invariant must hold — no content duplication across pages, no orphaned rows when switching trails — before the trail system is considered shippable.

## Historical Note

Earlier iterations described a "rising line" / FLOW mode mechanic (typed lines rise and settle above a fixed writing line, with a Ma-timer pause trigger). That mechanic has been dropped; the writing surface is now a TipTap editor for both discrete and continuous trails. References to FLOW mode, Ma timer, settled/struck/open line states, or 60fps line-rise targets in the PRD (`shizumu-mvp-prd.md`) reflect the older design and no longer apply. The standalone GROUND space was cut in 2026-07; its data surfaces inside memory.


For kamae authoring (project.yml, skills, graph verbs): see @docs/kamae-protocol.md