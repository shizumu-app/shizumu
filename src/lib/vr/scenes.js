// The VR scene catalog. Each scene maps to a real app space plus a fixture
// that seeds its data. onboarding:true renders the onboarding flow (driven
// by the mock's check_onboarding_complete defaulting to false when the
// fixture seeds no completion). Ground was removed (memory now carries its
// data); lock-screen is deferred to a follow-up (needs extra app hooks; see
// plan note).
import { FIXTURES } from "./fixtures.js";
import { MARKETING_FIXTURES } from "./fixtures-marketing.js";

export const THEMES = ["cream", "white", "dark"];

// Interaction states a scene can be captured in, beyond the load-time one.
//
// Every scene used to be a single screenshot taken the moment the app
// settled, which meant anything you had to *do* something to see was
// invisible to the suite. That is where the phone bugs lived: block
// controls only exist after a reveal, the header only collapses once the
// keyboard is up, a sheet only covers content after you open it.
//
// The capture spec drives these with real input (tests/vr/states.js) —
// there is deliberately no code here that puts the app into a state, since
// that would test the hook rather than the path.
export const STATES = {
  KEYBOARD: "keyboard",
  PIN_PANEL: "pin-panel",
  WHAT_SETTLED: "what-settled",
  BLOCK_TITLE_TOUCH: "block-title-touch",
  // Gutter-polish pass: the chip-less touch handle (touch-block-handle.js)
  // renders "+" only on an EMPTY block, into the left gutter — this state
  // proves that glyph and position.
  TOUCH_INSERT_HANDLE: "touch-insert-handle",
  // Gutter-polish pass, the actual bug fix ("tap on block does not show
  // the toolbar in the left space"): a tap on a chip-less block that
  // already has content reveals that block's pin/copy/delete controls in
  // the gutter — the same .block-handles column desktop hover populates,
  // just touch-triggered (see TipTapEditor.svelte's handleEditorPointerDown
  // → revealBlockHandlesForNode). This replaces the earlier BottomSheet
  // path a chip-less block used to reach via a synthetic "⋯" handle — that
  // handle is gone; a plain tap on the block itself is the whole gesture
  // now. Deliberately targets the FIRST (one-line) fixture paragraph, the
  // tallest-risk case: three stacked controls next to a single text line
  // are taller than the block itself, so this is the capture that proves
  // the overflow spills down the gutter rather than over any text.
  // A board's own actions sheet (its .block-type-chip, unchanged by this
  // pass) has no dedicated state here — page-board-content below only
  // drives BLOCK_TITLE_TOUCH, and always has.
  //
  // The value MUST be "block-handles" — TipTapEditor.svelte's
  // armTouchHandleHide() freezes its own auto-hide timer keyed on exactly
  // this string via document.documentElement.dataset.vrState, so the VR
  // harness can photograph the reveal before it clears itself.
  BLOCK_HANDLES_TOUCH: "block-handles",
  // The same gutter card, revealed on an ATTACHMENT line — the pair of
  // states that would have caught the `/image` defect on the day it landed.
  //
  // Reported: hovering an image offered only the "+" insert handle, while
  // the identical file line offered pin/copy/delete. The cause was
  // blockPinFacts sniffing `.attachment-block`, a class only
  // AttachmentBlock.svelte's FILE branch renders — so an image was never
  // seen as an attachment, and (being an inline atom with no node text)
  // read as an EMPTY LINE. Both scenes were load-time-only, which is why
  // the whole VR suite stayed green through it: a load screenshot cannot
  // show a control you have to touch the line to reach.
  //
  // They exist as a PAIR deliberately. The bug was found by measuring the
  // two lines side by side on one build, and the file half is what made
  // the image half legible — on its own, "an image offers no pin" reads
  // like intended behaviour. Keeping both photographed keeps that
  // comparison in the suite instead of in a bug report.
  IMAGE_BLOCK_HANDLES_TOUCH: "image-block-handles",
  FILE_BLOCK_HANDLES_TOUCH: "file-block-handles",
  // The touch pin flow, end to end, real input the whole way: tap a
  // chip-less block (reveals .block-handles, same as BLOCK_HANDLES_TOUCH
  // above) → tap its pin button → assert a pin now exists. Exists because
  // every prior mobile block-action fix was reasoned about a single seam
  // (the reveal, the popup, the button) and passed here while still
  // failing on-device — this state walks the full gesture chain a phone
  // actually exercises, so a regression anywhere in it (reveal wrong block,
  // popup eats the tap, quick-pin path regresses) fails HERE instead of
  // on the next release.
  PIN_FLOW_TOUCH: "pin-flow-touch",
  // /chart builder modal (ChartBuilder.svelte), reached the real way: type
  // "/chart" in the editor and pick the row from the slash menu, same as a
  // user would — no hook that sets chartBuilderState directly, which is a
  // private local in TipTapEditor.svelte with no VR seam of its own, and
  // reaching in from outside would test the hook rather than the slash-menu
  // path the reported bug actually travels through.
  //
  // Task 2 gave the builder a live Mermaid preview pane below the form.
  // Correction (Task 6 fix round 1): this state's baseline and
  // CHART_BUILDER_KEYBOARD's did NOT change shape — verified against the
  // committed PNGs, byte-identical to before Task 2 landed. The
  // `.builder-preview` div is always in the DOM once the builder is open,
  // but ChartBuilder.svelte debounces the preview's own render ~150ms
  // after the last edit; this state's driver (states.js) captures right
  // after the slash-menu opens the builder, before that debounce has ever
  // fired once, so the preview div is still empty (zero visible height,
  // nothing rendered into it) at capture time — the load-time snapshot
  // never shows the preview pane's content either way. The earlier note
  // here claiming a shape change was written ahead of actually diffing the
  // baselines and was wrong.
  CHART_BUILDER: "chart-builder",
  // Same, plus the soft keyboard up (shrunk viewport, same technique as
  // KEYBOARD above) — the reported bug involved fields with the IME open.
  CHART_BUILDER_KEYBOARD: "chart-builder-keyboard",
  // The same pin flow as PIN_FLOW_TOUCH, but on a BOARD block (one with a
  // title slot) instead of a plain paragraph. PIN_FLOW_TOUCH could not
  // catch the reported "tap on the toolbar button does nothing", because a
  // plain <p> has no title slot: tapping it reveals only the gutter
  // column, which is absolutely positioned and changes no layout. A board
  // reveals its title IN FLOW on the same tap, which moves the block — and
  // that is the case the device report is about.
  PIN_FLOW_TOUCH_BOARD: "pin-flow-touch-board",
  // A toolbar button that is NOT the top one, tapped once, on a SHORT
  // block. Reported as "you have to tap many times before anything
  // happens", and every existing state missed it because they all tap the
  // pin button — the top one, the only one that still lands inside a
  // one-line block's own Y range. The lower buttons hang past the block,
  // and pointerup was resolving the tap to whatever block sits under THEM.
  DELETE_FLOW_TOUCH: "delete-flow-touch",
  // Task 6: the touch action sheet a board's own `.block-type-chip` opens
  // (block-shell.js / table-shell-view.js dispatch shizumu-block-actions on
  // tap). Task 1's bug lived exactly here — tapping the chip on an EMPTY
  // chart or table opened nothing at all — so this state's driver asserts
  // "delete" is always offered, "title" is offered on table/chart (the
  // regression photograph for that fix), "convert to…" is offered on the
  // convertible board types (Task 5) and absent on table/chart.
  BLOCK_ACTIONS_SHEET_TOUCH: "block-actions-sheet",
  // Same open, then tap "convert to…": asserts the sheet swaps to a
  // "← back" row plus at least one target row (Task 5's submenu).
  //
  // PARKED (Task 6, fix round 1) — not applied to any scene below. Opening
  // the sheet appears to fire a real `mouseleave` on `.tiptap-wrapper`
  // (the dialog's top-layer promotion covers the previously-hovered chip),
  // which arms handleEditorMouseLeave's 320ms desktop-hover hide timer
  // (hover-reveal.js) — never gated on touch — and that timer then wipes
  // hoveredBlock out from under this exact submenu sometime after this
  // driver returns but before `toHaveScreenshot`'s own capture lands,
  // collapsing the list back to just "back" with no further input. Two
  // driver attempts (assert-then-return; hold the pointer via `.hover()`
  // then assert again) both pass their own assertions reliably and both
  // still produced a collapsed capture on Docker — see states.js's own
  // comment on this state for the full trail. The fix needs
  // `handleEditorMouseLeave` gated on `!isCoarsePointer()`, inside frozen
  // TipTapEditor.svelte; tracked in task-6-report.md, not done here.
  BLOCK_CONVERT_SHEET_TOUCH: "block-convert-sheet",
  // The keyboard-shortcuts panel (ShortcutHelp.svelte), open.
  //
  // The one DESKTOP-shaped interaction state in this file. It has to be:
  // the panel is `display: none` under (pointer: coarse), so on the phone
  // project the driver would click a button that is not rendered. It runs
  // on win-webview2 alone — see STATE_PROJECT in tests/vr/visual.spec.js.
  //
  // It exists because the panel is a click away from a DOM that does not
  // contain it at all (Popover renders `{:else if open}`), and the whole
  // audit that produced this state found four rows that had been wrong for
  // months plus a ⌘ printed on Linux and Windows — every one of them
  // invisible to a suite whose only captures are load-time. Same rule as
  // the touch states above, on the other pointer.
  SHORTCUT_PANEL: "shortcut-panel",
};



export const SCENES = {
  "page-blank": {
    space: "page", fixture: FIXTURES.emptyPage, onboarding: false,
    states: [STATES.TOUCH_INSERT_HANDLE, STATES.CHART_BUILDER, STATES.CHART_BUILDER_KEYBOARD],
  },
  "page-content": {
    space: "page", fixture: FIXTURES.pageWithContent, onboarding: false,
    states: [
      STATES.BLOCK_HANDLES_TOUCH, STATES.PIN_FLOW_TOUCH, STATES.KEYBOARD,
      STATES.PIN_PANEL, STATES.WHAT_SETTLED,
      // Desktop-only; skipped on the phone project by STATE_PROJECT.
      STATES.SHORTCUT_PANEL,
    ],
  },
  "page-board-content": {
    space: "page", fixture: FIXTURES.pageWithBoardContent, onboarding: false,
    // BLOCK_CONVERT_SHEET_TOUCH deliberately NOT applied here — parked,
    // see that state's own comment above.
    states: [
      STATES.BLOCK_TITLE_TOUCH, STATES.PIN_FLOW_TOUCH_BOARD,
      STATES.BLOCK_ACTIONS_SHEET_TOUCH,
    ],
  },
  // Exists for DELETE_FLOW_TOUCH: a short titled board, so the toolbar's
  // lower buttons hang past it. See the fixture for why the other board
  // scene cannot show this.
  "page-short-board": {
    space: "page", fixture: FIXTURES.pageWithShortBoard, onboarding: false,
    states: [STATES.DELETE_FLOW_TOUCH],
  },
  // Task 6 — board types that had zero VR presence before this pass. Each
  // gets the touch action-sheet state. page-board-content (above) and
  // page-qa-content (below) would also carry the convert submenu, but
  // that state is parked — see BLOCK_CONVERT_SHEET_TOUCH's own comment.
  "page-table-content": {
    space: "page", fixture: FIXTURES.pageWithTableContent, onboarding: false,
    states: [STATES.BLOCK_ACTIONS_SHEET_TOUCH],
  },
  // The regression photograph for Task 1's bug: tapping an EMPTY table's
  // chip used to open no sheet at all.
  "page-empty-table": {
    space: "page", fixture: FIXTURES.pageWithEmptyTable, onboarding: false,
    states: [STATES.BLOCK_ACTIONS_SHEET_TOUCH],
  },
  // page-blank's CHART_BUILDER states cover only the modal, never the
  // rendered block — this is the first VR coverage of an actual chart node.
  "page-chart-content": {
    space: "page", fixture: FIXTURES.pageWithChartContent, onboarding: false,
    states: [STATES.BLOCK_ACTIONS_SHEET_TOUCH],
  },
  // Same regression photograph as page-empty-table, for chart.
  "page-empty-chart": {
    space: "page", fixture: FIXTURES.pageWithEmptyChart, onboarding: false,
    states: [STATES.BLOCK_ACTIONS_SHEET_TOUCH],
  },
  "page-recipe-content": {
    space: "page", fixture: FIXTURES.pageWithRecipeContent, onboarding: false,
    states: [STATES.BLOCK_ACTIONS_SHEET_TOUCH],
  },
  "page-qa-content": {
    space: "page", fixture: FIXTURES.pageWithQaContent, onboarding: false,
    // BLOCK_CONVERT_SHEET_TOUCH deliberately NOT applied here — parked,
    // see that state's own comment above.
    states: [STATES.BLOCK_ACTIONS_SHEET_TOUCH],
  },
  "page-decision-content": {
    space: "page", fixture: FIXTURES.pageWithDecisionContent, onboarding: false,
    states: [STATES.BLOCK_ACTIONS_SHEET_TOUCH],
  },
  // An attachment renders no `.block-type-chip` (block-shell.js never wraps
  // one), so it has no block-actions SHEET — but it does have the gutter
  // card a tap reveals on any chip-less block with content, and that card
  // is what went missing on an image. This scene was load-time-only, and
  // that is exactly how the defect shipped: nothing here could photograph a
  // control that only exists after you touch the line.
  "page-image-content": {
    space: "page", fixture: FIXTURES.pageWithImageContent, onboarding: false,
    states: [STATES.IMAGE_BLOCK_HANDLES_TOUCH],
  },
  "page-file-content": {
    space: "page", fixture: FIXTURES.pageWithFileContent, onboarding: false,
    states: [STATES.FILE_BLOCK_HANDLES_TOUCH],
  },
  "memory-list": { space: "memory", fixture: FIXTURES.memoryWithPages, onboarding: false },
  "pin-view": { space: "memory", fixture: FIXTURES.pinsRich, onboarding: false },
  "trail-continuous": { space: "page", fixture: FIXTURES.continuousTrail, onboarding: false },
  "dead-image-ref": { space: "page", fixture: FIXTURES.deadImageRef, onboarding: false },
  "onboarding": { space: "page", fixture: FIXTURES.emptyPage, onboarding: true },

  // ── marketing scenes ────────────────────────────────────────────────
  // Product shots for the Flathub listing and the release posts. They live
  // here, in the same catalog, because the capture harness reaches them the
  // same way every other scene is reached (?vr=1&scene=…) and a scene that
  // only exists on a branch during a photo session is a scene nobody can
  // re-shoot six months later — which is exactly what happened to the
  // previous `mk-*` set (added, used, reverted, gone).
  //
  // They must NEVER enter the VR sweep. Their content is COPY: a rewritten
  // sentence is a legitimate, frequent change with no behaviour behind it,
  // and baselining it on three projects turns every copy tweak into a
  // screenshot diff to re-approve. `marketing: true` is the flag;
  // VR_SCENE_IDS below is the filtered list tests/vr/visual.spec.js
  // iterates. Adding a scene here is therefore safe by default — you have
  // to omit the flag to get baselines.
  "mk-tasks": {
    space: "page", fixture: MARKETING_FIXTURES.marketingTasks,
    onboarding: false, marketing: true,
  },
  // Filmed, not photographed: an untrailed page and a trail with
  // carry-forward pins on it. See marketingTrail.
  "mk-trail": {
    space: "page", fixture: MARKETING_FIXTURES.marketingTrail,
    onboarding: false, marketing: true,
  },
  "mk-tools": {
    space: "page", fixture: MARKETING_FIXTURES.marketingTools,
    onboarding: false, marketing: true,
  },
  "mk-memory": {
    space: "memory", fixture: MARKETING_FIXTURES.marketingMemory,
    onboarding: false, marketing: true,
  },
  "mk-mention": {
    space: "page", fixture: MARKETING_FIXTURES.marketingMention,
    onboarding: false, marketing: true,
  },
  "mk-blocks": {
    space: "page", fixture: MARKETING_FIXTURES.marketingBlocks,
    onboarding: false, marketing: true,
  },
  "mk-decision": {
    space: "page", fixture: MARKETING_FIXTURES.marketingDecision,
    onboarding: false, marketing: true,
  },
  // The one scene that renders a real bitmap. `blobs` is the seam: without
  // it every attachment falls back to "image not on this device", because
  // the mock has no blob store (api.js) — see createSeededInvoke's own
  // note. Loaded lazily so the data URI never enters this module's graph:
  // scenes.js is imported by unit tests, and none of them want a
  // quarter-megabyte of base64.
  "mk-evidence": {
    space: "page", fixture: MARKETING_FIXTURES.marketingEvidence,
    onboarding: false, marketing: true,
    blobs: () => import("./blobs-marketing.js").then((m) => m.MARKETING_BLOBS),
  },
  // Not a shot — the SUBJECT of the bitmap mk-evidence puts on the page.
  // capture-evidence.mjs photographs this one and clips the result.
  "mk-evidence-subject": {
    space: "page", fixture: MARKETING_FIXTURES.marketingEvidenceSubject,
    onboarding: false, marketing: true,
  },
};

/** True for a scene that exists to be photographed for a listing, not to
 *  be regression-baselined. See the marketing block in SCENES above. */
export function isMarketingScene(scene) {
  return scene?.marketing === true;
}

/**
 * The scene ids the VR suite photographs — every scene except the
 * marketing ones.
 *
 * Exported as a computed list rather than left as a filter inlined in the
 * spec, because visual.spec.js iterates SCENES in TWO loops (load-time and
 * interaction states) and a filter applied to one of them and forgotten in
 * the other is precisely the failure this guards against. One list, both
 * loops, one unit test (scenes.test.js).
 */
export const VR_SCENE_IDS = Object.keys(SCENES).filter((id) => !isMarketingScene(SCENES[id]));

/** The interaction states declared for a scene (never undefined). */
export function sceneStates(scene) {
  return Array.isArray(scene?.states) ? scene.states : [];
}

export function getScene(id) {
  const s = SCENES[id];
  if (!s) throw new Error(`unknown VR scene: ${id}`);
  return s;
}
