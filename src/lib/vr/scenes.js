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
  // The shell page's nav bar folded by a real SCROLL — line 2 gone, the
  // hairline earned, the writing holding the screen.
  //
  // P2a declared this state unreachable and recorded the measurements
  // instead of faking it (see the shell-page scene below, which keeps
  // them). It was right: .shell-screen-content measured 705/705 because
  // the canvas was a placeholder, and a real wheel left scrollTop at 0.
  // P2b's editor is what changed the answer — a shell page can now hold
  // more writing than the band is tall, and that is the only way scroll
  // exists on this screen at all.
  //
  // Deliberately a SEPARATE state from KEYBOARD even though both end with
  // a folded bar, because nav-collapse.js reaches that answer down two
  // independent arms (`if (keyboardOpen) return true` before the scroll
  // thresholds are read at all). One capture of a folded bar would leave
  // whichever arm it did not travel untested — and the scroll arm is the
  // one with the hysteresis band in it.
  COLLAPSED: "collapsed",
  // The bottom band showing an EDITING strip ABOVE the nav row (P2c).
  //
  // The band used to be modal — tab bar with the keyboard down, block strip
  // with the caret in text, selection strip with a range — and only one of
  // those three had any capture at all before this pass: every shell-page
  // baseline was taken with the keyboard down, i.e. of the tab bar alone.
  //
  // IT IS NOT MODAL ANY MORE, and the prose here used to say the opposite.
  // KEYBOARD (above) photographed a tab bar under an open keyboard, which
  // this comment called "a combination the app can no longer produce" — the
  // app produces it again, on purpose. A Galaxy A34 whose webview froze its
  // viewport numbers believed a keyboard was up for a whole session, and
  // modal meant no page, no memory, no settings until the app restarted. The
  // strip is the upper row now; navigation is not something a belief about a
  // keyboard can take away.
  //
  // A PAIR, deliberately, and for the same reason the two attachment states
  // are a pair. The strips share five of their controls and the same row of
  // chrome, so "the strip shows bold and italic" is true of both — a single
  // capture proves the slot renders A strip, not that it renders the RIGHT
  // one. Shot side by side, the difference is legible in the images: the
  // block strip ends in `undo` and `hide keyboard`, the selection strip has
  // no `hide keyboard` at all and carries `strike`, `code` and `copy`
  // instead.
  //
  // Both are photographed with dead controls in them, on purpose. Some ids
  // have no command yet (ShellApp's header lists which and why), and each
  // renders DISABLED rather than silently inert — which is exactly what
  // makes them safe to photograph rather than a picture of an unfinished
  // toolbar. The drivers assert the disabled set EXACTLY, so a button that
  // quietly comes alive, or one that quietly dies, fails here rather than
  // being absorbed into a pixel diff nobody re-reads.
  //
  // It has already done that once. P2c photographed five dead ids; P2d gave
  // `type` and `insert` their sheets, and the block-strip driver went red
  // naming `insert` the first time it ran afterwards — which is why the
  // count is no longer written down here, where it would only go stale
  // again. The captions in states.js are the one place it belongs.
  //
  // Both drivers TYPE before they shoot, because the selection strip cannot
  // exist without something to select and the two images should differ in
  // exactly one thing. Typing is the only way a shell page acquires content
  // at all — the same constraint COLLAPSED writes up.
  //
  // It is NOT to make `undo` live. That was this comment's first claim, and
  // breaking it is what disproved it: the untyped capture already in the
  // suite renders `undo` in the same ink as `bold`, so canUndo is true on a
  // shell page nobody has typed into. See states.js's SHELL_STRIP_LINE.
  BLOCK_STRIP: "block-strip",
  SELECTION_STRIP: "selection-strip",
  // P2d: the two sheets a block can open, and the first time Sheet has been
  // photographed over a real screen. P1d built its detents, its navstack
  // registration and its replace-if-open branch, and until this pass none
  // of that had ever run against anything but the gallery's catalogue —
  // where Sheet is a mounted primitive with nothing behind it to cover.
  //
  // A PAIR, for the reason the two strips above are a pair: both are a half
  // detent of rows over an emptied slot, so a single capture proves the
  // shell can open A sheet, not that the handle and the `+` open DIFFERENT
  // ones. Side by side the difference is the whole subject — the block
  // sheet acts on the block the caret is in (copy, move, delete), the
  // insert sheet acts on the caret (blocks to put at it).
  //
  // Both go through the same keyboard-up setup the strips use, and that is
  // not shared convenience — it is the only way in. The `+` lives ON the
  // block strip, which exists only with the keyboard up, and the gutter
  // handle needs an activeBlock, which needs a caret. It is also what makes
  // the two claims below checkable: a sheet whose bottom edge is inside the
  // shrunken viewport is a sheet the keyboard is not covering, and an
  // emptied slot is only legible against the strip that was in it a moment
  // before.
  //
  // Both place the caret with real keystrokes before they tap. A freshly
  // opened page does NOT leave the caret at the top — EditorCore restores
  // the cursor, which on a multi-block doc lands on the LAST block, and
  // Task 3 lost four first-draft tests to exactly that, silently reading a
  // blockquote's rows. Typing is the only way a shell page gets content at
  // all, so here the caret is where the typing left it, said out loud
  // rather than assumed.
  //
  // BOTH WERE COMMITTED RED, WITH NO BASELINE, ON PURPOSE — and between
  // them they found two separate defects, neither of which any load-time
  // capture or unit test could reach. The trail is kept because the shape
  // of it is the argument for interaction states: in both cases every
  // assertion about the MODEL passed, and the screen was still wrong.
  //
  // The first was shared. The right sheet was open, the right rows were in
  // it, the slot behind it was empty, the box was half of --app-height —
  // and the photograph showed no sheet at all. Its box measured y −299..−119
  // in a 360px viewport, because `.shell-sheet` was `position: fixed;
  // bottom: 0` plus `margin-bottom: var(--kb-inset)` while index.html asks
  // for `interactive-widget=resizes-content`, which makes the soft keyboard
  // shrink the LAYOUT viewport. `bottom: 0` was therefore already above the
  // keyboard, and the margin lifted the sheet a second whole keyboard-height
  // — 479px on an 839px device — clean off the top of the display. The same
  // double-count caret-visible.js's header forbids for a measured band.
  // ShellRoot's note that a fixed surface "has to re-supply the offset
  // itself" is true under resizes-VISUAL, which is what iOS does and what
  // this app deliberately turned off. Fixed by reading --kb-overlay
  // instead; block-sheet recorded its baseline on that commit.
  //
  // The second was insert-sheet's alone, and it survived the first fix: the
  // sheet mounted and was GONE again 500ms later, with a list board on the
  // page nobody asked for. A tap fires `click` after `pointerdown`, and
  // ToolbarButton acts on pointerdown — so the click that followed the press
  // on `+` was hit-tested against a DOM that now had the insert sheet in it,
  // landed on whichever row sat at the button's y, and ran it. block-sheet
  // never saw it only because its gutter handle sits high enough on the page
  // that the ghost click misses the sheet: geometry, not a rule. Sheet.svelte
  // now swallows exactly one click, the one belonging to the gesture that
  // opened it, and this state is the photograph of that.
  //
  // Both are device bugs, not harness artifacts. The VR keyboard is a
  // layout-viewport shrink, which is exactly what resizes-content produces;
  // and `.tap()` fires the same pointerdown / pointerup / click sequence a
  // finger does, which is how the second one was measured — pointerdown on
  // [data-button-id="insert"] with 0 sheets on screen, then pointerup and
  // click on a `.shell-row-label` with 1.
  //
  // Neither baseline was recorded before its bug was fixed, and neither
  // assertion was relaxed. A PNG of a missing sheet, committed, is the bug
  // written down as correct — the P1c failure, volunteered rather than
  // stumbled into.
  BLOCK_SHEET: "block-sheet",
  INSERT_SHEET: "insert-sheet",
  // The same sheet, with the keyboard up in the shape iOS reports it —
  // and the only state in this catalog that does not run on the phone
  // project (visual.spec.js's STATE_PROJECT sends it to `ios-webkit`).
  //
  // WHAT IS DIFFERENT, in one sentence: every other keyboard state in this
  // suite raises the keyboard by shrinking the viewport, which moves
  // `innerHeight` and the visual viewport's height together — that is
  // `interactive-widget=resizes-content`, what index.html asks for, and
  // what Android does. iOS/WKWebView ignores the meta and shrinks only the
  // VISUAL viewport, so `--kb-overlay` (keyboardOverlayPx,
  // keyboard-state.js) is the keyboard's HEIGHT there and 0 everywhere
  // else. Every keyboard photograph this suite holds was therefore taken
  // with `--kb-overlay` at 0. This is the first one taken with it carrying
  // a keyboard, and it is the branch the fix for INSERT_SHEET's own defect
  // (see the note above: y -299..-119, a sheet lifted twice) was written
  // against without ever being seen.
  //
  // IT IS A SEAM, NOT REAL INPUT, and the fourth testing rule says to say
  // so rather than quietly install one. No Playwright API moves the visual
  // viewport independently of the layout viewport — setViewportSize moves
  // both, measured before this was built — so raiseKeyboard (states.js)
  // shadows the visual viewport's height on the engine's own viewport
  // object and dispatches the engine's own resize event at the app's own
  // listener. What is faked is one JS-visible number that no CSS reads;
  // what runs for real is everything else, on WebKit: keyboard-state.js's
  // subscriber, computeKeyboardState, keyboardOverlayPx, the custom
  // properties, and every quantity the engine resolves — fixed positioning
  // against a layout viewport deliberately left at full height,
  // `margin-bottom: var(--kb-overlay)`, the detent's
  // `calc(var(--app-height) * ...)`, the safe-area insets.
  //
  // WHAT IT STILL CANNOT PROVE, so nobody reads the picture as more than
  // it is: that WKWebView reports these numbers. §5 of the mobile-shell
  // spec lists the keyboard fixture and Stack's interactive back as the
  // two flags that can only be settled on a device, and this does not
  // settle either — it gets the arithmetic and the layout onto a real
  // WebKit at iOS-shaped numbers, and leaves the reporting to the device
  // pass.
  //
  // WHAT THE IMAGE SHOWS, which is worth knowing before reading it as
  // broken: the layout viewport stays the full 664px of the phone while
  // the app confines itself to the top 328, so the lower ~336px of the
  // frame is bare page background. That IS resizes-visual, drawn — on a
  // device the keyboard occupies exactly that band. A capture in which the
  // shell fills the whole frame would be the Android geometry wearing an
  // iPhone filename.
  IOS_KEYBOARD_SHEET: "ios-keyboard-sheet",
  // P2c-2: `toolbarFor`'s rows 2 and 4 — the last two the slot had never
  // rendered, and the last two the suite had never seen. Every strip
  // capture before these is `.shell-toolbar-strip`; neither of these is.
  // Row 2 has its own renderer (FindStrip) because a text field is not a
  // button, and row 4 has a third (SuggestionStrip) because a chip's id is
  // a slash-command title rather than a strip button id. So the existing
  // `stripState` reader returns null for both, and every assertion built
  // on it would have passed over an empty slot — which is precisely why
  // they are photographed rather than trusted.
  //
  // A PAIR, for the reason the strips and the sheets are pairs. Both are
  // "the slot showing something that is not the block strip", and one
  // capture would prove the slot can be taken over, not that these two
  // take it over differently. Side by side the difference is the whole
  // subject: row 2 is a text field with a count and three named controls,
  // row 4 is a row of command chips and nothing else.
  //
  // REAL INPUT, and for these two that phrase has teeth. Find has exactly
  // one door — the header's `find`, which is where it was put so it is
  // reachable with the keyboard down — and the chips have exactly one
  // producer, a `/` typed into the document. Neither state can be reached
  // by setting a flag, and neither driver does.
  //
  // WHAT THE PHOTOGRAPH KNOWS THAT THE MODEL DOES NOT. `findStripModel`
  // and `suggestionChips` are unit-tested against plain objects, and P2d
  // is the standing proof that a green model says nothing about the
  // screen: both sheets asserted the right sheet, the right rows and the
  // right height while photographing a blank band. What is only checkable
  // here is that a 44px field, a live count and three named controls fit
  // one 412px row without the last of them being clipped off the end —
  // FindStrip deliberately does NOT scroll (its field absorbs the width
  // instead), so an over-subscribed strip loses `close`, which is the one
  // control the mode's only exit hangs on.
  //
  // FIND IS SHOT AT EXACTLY ONE MATCH, deliberately, and it is the only
  // total that photographs a decision. Task 1 kept `prev`/`next` LIVE at
  // `total === 1`, where both are visible no-ops, because the label beside
  // them reads "1 of 1" and a greyed arrow would contradict the strip's
  // own sentence. At every other non-zero total the two arrows render
  // identically, so no other query can show it. The driver asserts the
  // empty disabled set by name, so the day someone greys them the caption
  // fails rather than the pixels quietly moving.
  //
  // THE CHIPS ARE SHOT AT THREE, not at the twenty a bare `/` resolves to.
  // Three is the case a writer is in — they type a letter or two — and it
  // is the case where "the chips fit the strip" is a claim the picture can
  // make. A full list is a scroll position, and a scroll position
  // photographs as a strip with its first chip half under the mask fade.
  //
  // The suggestion state also carries §3's other half. `95bfc854` made
  // PageScreen pass `floatingChrome={false}`, which swaps SlashCommands'
  // renderer for silentSuggestionRender — so `/` on a phone must now open
  // ONE menu, the strip. Nothing in the suite could see that: the claim is
  // about a floating element that only exists while a trigger is live, and
  // no capture had ever had a live trigger. This driver asserts
  // `.slash-command-menu` is absent, on the same keystroke that fills the
  // strip.
  FIND_STRIP: "find-strip",
  SUGGESTION_STRIP: "suggestion-strip",
  // P2e: a block held off the page. The only state in this file that is
  // photographed MID-STROKE — the pointer is still down when the shutter
  // goes, because a lift that has been released is either a drop or a
  // cancel and neither of those is what §3 describes.
  //
  // It is the whole of the drag in one frame: the lifted block (scale and
  // shadow), the hairline saying where it would land, and the handle the
  // finger is holding lit in the accent. Three separate pieces of the
  // feature, and until this state not one of them had ever been rendered
  // by a browser — every assertion behind them is jsdom's, where a
  // `transform` is a string on a style object and a 2px line has no box.
  //
  // WHY IT IS SHOT WITH THE KEYBOARD DOWN, which is the one deliberate
  // divergence from every other shell-page state here. The VR keyboard is
  // a viewport shrink to 360px, which leaves the content band about 210px
  // tall — and autoScrollSpeed clamps its 60px bands to half the canvas,
  // so on a band that short EVERY pointer position is inside one band or
  // the other and the canvas would scroll for as long as the finger is
  // down. A photograph of a drag that is auto-scrolling is a photograph of
  // whatever frame the shutter caught. At the device's own 839px the
  // middle of the band is neutral, the document does not move, and the
  // driver asserts scrollTop stayed at 0 so that stays true rather than
  // being assumed. The keyboard is not a term in any of the three things
  // this state photographs.
  //
  // WHAT THE PICTURE IS EXPECTED TO SHOW AND THE MODEL CANNOT SAY. The
  // hairline is 2px on a 412px frame — roughly 0.0006 of it against a
  // 0.002 gate — so it can move, or vanish, with the baseline still green
  // (P2c-2 watched a 44px control do exactly that). `data-index` on the
  // indicator is the model's own answer to "where would this land", and
  // the driver asserts THAT number plus the line's y against the block
  // rects it measured before the press. The photograph is the other half:
  // it is the only thing that can say the lifted block is legible as
  // lifted at all.
  //
  // COMMITTED RED, WITH NO BASELINE, ON PURPOSE, and the baseline below
  // was born on the commit that fixed what it found — the same call P2d
  // made for the two sheets above, and for the same reason: a PNG of a
  // broken lift is the bug written down as correct. What it caught: the
  // whole drag was on screen and asserted — the frame carried
  // `.shell-root.dragging`, the handle was lit, the hairline was drawn in
  // the right gap and `data-index` read the number the drop would use —
  // and the block itself had no scale and no shadow.
  //
  // PageScreen's effect had done its job and been undone. Measured with a
  // MutationObserver, `.ps-lifted` landed on the paragraph and ProseMirror
  // replaced that DOM node within ~100ms: a class written onto a node the
  // editor renders is a foreign mutation its DOMObserver re-syncs away, so
  // the class rode off on the orphan while the effect, whose dependencies
  // had not changed, never re-ran. Reproduced on an untouched paragraph
  // too, which is what made it general rather than a fact about the lifted
  // node.
  //
  // THE FIX, and the part worth carrying forward, is that the unit tests
  // could see this all along and nobody had asked them to. The editor
  // under them is real — a real EditorView with a real DOMObserver, only
  // its extension list is stubbed — and jsdom delivers mutation records on
  // a microtask. The nine phases of green came from asserting in the same
  // synchronous turn the class was added; one `await` is the whole
  // difference. `.ps-lifted` is now a ProseMirror node decoration
  // (EditorCore.setLiftedBlock), which a redraw re-applies rather than
  // undoes, and two jsdom tests hold it: "keeps the block lifted once
  // ProseMirror has had a turn" (PageScreen.test.js) and "keeps the mark
  // when ProseMirror redraws the node" (EditorCore.test.js, which forces
  // the redraw and proves it happened). This state stays the only witness
  // that the scale and the shadow are legible on a screen.
  //
  // ONE MORE THING THE PICTURE SAYS, smaller and separate, and DECIDED
  // rather than deferred. §3 asks for "slight scale, strong shadow tier,
  // FOLLOWS THE FINGER", and there is no translate anywhere in the shell —
  // `.ps-lifted` is scale and shadow and nothing else, so the block sits
  // still in its own slot while the hairline moves. That is the answer
  // this shell keeps. A translate would have to be a transform (a block
  // taken out of the flow stops scrolling with its page, which breaks the
  // auto-scroll — PageScreen's own argument), and a transform leaves the
  // block in the flow, which means the finger would drag a copy away from
  // a hole that is not there: the writer sees the block in two places, its
  // own slot and under the thumb, with the hairline saying a third. On a
  // 412px frame the block is nearly full-width and the thumb is on it, so
  // the tracking is felt more than seen. What the drag needs to say is
  // WHERE IT WILL LAND, and that is the hairline's job, which it does at
  // any distance from the finger. The phrase in §3 is the overstatement,
  // not the implementation; Task 2's commit subject ("the block follows
  // the finger") overstated it in the same way.
  BLOCK_LIFT: "block-lift",
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
  // The DESKTOP tree's BottomSheet, open, with the keyboard up.
  //
  // A scoping state, not a coverage state. BLOCK_SHEET/INSERT_SHEET above
  // found the shell's sheet lifted clean off the screen by
  // `margin-bottom: var(--kb-inset)` under
  // `interactive-widget=resizes-content`. `src/lib/ui/BottomSheet.svelte`
  // — the shipping desktop/mobile-web sheet, which shares no code with the
  // shell's Sheet — carries `bottom: var(--kb-inset, 0px)`: the same lift,
  // off the same variable, published by the same owner. So the finding is
  // either shell-only or a three-week-old live bug, and nothing in this
  // suite could tell the two apart, because every sheet state opened a
  // sheet with no field in it and every keyboard state raised the keyboard
  // with no sheet on screen.
  //
  // LineageSelector's trail sheet is where the two meet on a phone: a
  // BottomSheet whose first child is a text input. The driver opens it and
  // taps the field, which is the only way --kb-inset can be non-zero at
  // all (computeKeyboardState gates it on hasFocusedField) — and the
  // driver fails loudly if it is still 0, because a sheet lifted by 0px is
  // trivially on screen and would read as an all-clear this state never
  // earned.
  TRAIL_SHEET_KEYBOARD: "trail-sheet-keyboard",
  // ── P2f: the page's own chrome ──────────────────────────────────────
  //
  // The states for the surfaces P2f wired, and they divide by what each
  // one needs the page to BE rather than by which task built them. They
  // run on `shell-trail-page`, because a header affordance that names a
  // trail, a day or a sibling page has nothing to open on a page that has
  // none.
  //
  // THE TOAST IS THE SMALL ONE, and it is the reason the plan singles this
  // task out. It is a band of about 24px on an 839px frame — well under
  // the 0.002 ratio the gate compares at, so it can fail to appear at all
  // with the baseline still green (P2c-2 watched a 44px control do exactly
  // that; P2e asserted `data-index` on a 2px hairline for the same
  // reason). Its driver therefore asserts the SENTENCE, character for
  // character, and where the box sits: under the header, above the content
  // band, inside the viewport, not clipped at its own right edge.
  //
  // AND IT IS THE ONE STATE IN THIS FILE WITH A CLOCK IN IT. The toast
  // clears itself after PIN_TOAST_MS (4000ms, pin-toast.js) because Toast
  // has no lifetime of its own and an uncleared breadcrumb outlives the
  // pin it describes. `toHaveScreenshot` settles by taking screenshots
  // until two consecutive frames match, so a static toast is captured on
  // the first pair — but a driver that dawdled after the tap would
  // photograph the frame AFTER it left, and that image would be a pin
  // flow with no confirmation in it, committed as correct. The driver
  // waits on the toast's own appearance rather than on a fixed settle,
  // and does its measuring in one round trip, for that reason alone.
  PIN_TOAST: "pin-toast",
  // The header's three, each opened by a real tap on the control that
  // names it: `today ▾`, the dots, the trail chip.
  //
  // THREE STATES RATHER THAN ONE, for the reason the two strips and the
  // two block sheets are pairs. All three are rows over an emptied slot,
  // so a single capture would prove the header can open A sheet and not
  // that its three controls open DIFFERENT ones — which is the failure
  // mode a header of adjacent 44px targets actually has. Side by side the
  // difference is the whole subject: days, pages of one day, trails.
  //
  // Each driver asserts its rows by name, including which of them is
  // INERT. `Row` renders a value with no control when the row names what
  // is already on screen ("showing", "this page") or something the shell
  // cannot do (a continuous trail's "living doc"), and an inert row is
  // indistinguishable from a live one in a photograph. It used to be
  // "the chevron is the only difference"; since the visual pass a row
  // draws no line of its own and a choice row draws no chevron either,
  // so at 412px nothing separates `showing` from the row beside it but
  // the tap that does nothing. The driver's per-row `kind` is the only
  // record of which is which.
  DATE_SHEET: "date-sheet",
  PAGES_SHEET: "pages-sheet",
  // FULL detent, and the only sheet in the shell that takes one — so this
  // is also the first capture of `--detent-fraction: 0.92` resolving
  // against `--app-height`. It holds a field AND the list being chosen
  // between, which is why half is not enough (ShellApp's own comment).
  TRAIL_SHEET: "trail-sheet",
  // ── P2f-2: the builders, and the rows that stopped being absent ──────
  //
  // Four new states plus two existing ones re-driven, and the division is
  // the same one P2f used: what does the page have to BE. All six run on
  // `shell-page` — an untrailed page on today's date — because none of
  // them asks anything of a trail, a sibling page or a day.
  //
  // THE TWO EXISTING ONES CHANGED, and that is the first thing to know
  // before reading a diff. `insert-sheet` was captioned "seven rows" and
  // the sheet now holds eleven (image and file, Task 1; table, Task 4;
  // chart, Task 5), and `block-sheet` was captioned four rows and now
  // offers `pin` (Task 2). Both baselines were DELETED and re-born on a
  // plain run rather than re-recorded with `--update-snapshots`, which is
  // the only route a session has and the reason the deletion is a commit
  // of its own to read.
  //
  // ── the two builders ─────────────────────────────────────────────────
  // Both are reached the only way a phone can reach them — keyboard up,
  // `+` on the block strip, then the row — and both then photograph with
  // the harness keyboard DOWN. That is not a convenience: `Row` is a
  // plain `<button>` with no pointerdown preventDefault (unlike
  // ToolbarButton, which has one precisely to keep the caret), and
  // `runInsertRow` closes the insert sheet before it runs, so the tapped
  // element leaves the DOM and focus lands on `<body>`. No focused field
  // means `computeKeyboardState` publishes no keyboard, so on a device
  // the IME is gone by the time the builder is up. The drivers assert the
  // editor released focus BEFORE restoring the viewport, so the restore
  // is a consequence of something measured rather than a state the
  // harness helped itself to.
  //
  // It also decides what the photograph is worth. At the keyboard-open
  // viewport a full detent is 0.92 × 360 ≈ 331px, and the grid alone is
  // ~384px — so shooting the builders keyboard-up would have baselined a
  // scrolled, clipped picture of a sheet no writer ever sees that way.
  //
  // TABLE_SHEET picks cell (3, 4), not the default. `gridCellsFor` clamps
  // rows to a floor of 2 and reads cols-across/rows-down, so the cell
  // commits 5 columns by 4 rows and the caption says `5 × 4` — an
  // ASYMMETRIC size, deliberately, because a square one photographs a
  // transposed reading identically. The driver asserts the twenty lit
  // cells by coordinate, the caption's characters, the commit row's value
  // and that the caption's box ends above the grid's (Task 4's whole
  // thumb argument), because at 0.002 a caption is ~1/20th of the gate.
  TABLE_SHEET: "table-sheet",
  // The builder as it OPENS: flowchart, the kind `chartDraft` defaults
  // to, two empty nodes and one edge, and a commit row that is a live
  // control reading `insert · flowchart`.
  CHART_SHEET: "chart-sheet",
  // The same builder after a real tap on the segmented control's third
  // segment. A PAIR rather than one state, for the reason the two strips
  // and the two block sheets are pairs: one photograph of one segment
  // selected cannot show that tapping a segment does anything, and the
  // difference between the two images is the whole subject.
  //
  // Timeline is the segment worth tapping. `emptySource("timeline")`
  // seeds two events with no dates, `chartCanCommit` is false for exactly
  // that, and the commit row goes INERT carrying the reason — the one row
  // in the shell whose value is a sentence about what to type next. An
  // inert row is invisible in a photograph (no chevron, same hairline),
  // so the driver asserts it by name. It is also the only capture of
  // Task 5's two inherited breakages: the `⋮⋮` reorder handle that is
  // dead under a finger, and the absent live preview.
  CHART_SHEET_TIMELINE: "chart-sheet-timeline",
  // The block sheet over a BOARD, which is the only shape that offers
  // `title` — the row Task 3 unblocked by splitting `hasTitle` into
  // `hasTitleSlot` (a slot exists to focus) and `isTitled` (a title has
  // been typed). `block-sheet` above cannot host it: it is shot on a
  // paragraph, and a paragraph has no slot, so the row it spent three
  // phases absent from would still be absent from every image in the
  // suite.
  //
  // The board is a `q&a` inserted through the insert sheet — real input,
  // and the same path the row it is testing is reached by. Its rows are
  // `title`, `turn into`, the two moves and `delete`: no `pin` and no
  // `copy`, because a board with nothing typed into it has no text to
  // keep, which is `blockActionsFor`'s `canPin` and is asserted here so
  // the absence reads as a rule rather than as a missing row.
  BLOCK_SHEET_BOARD: "block-sheet-board",
  // ── P3: memory, the pins, and the stack ─────────────────────────────
  //
  // FOUR SCREENS THE HARNESS HAS NEVER SEEN. Every shell capture in this
  // file before these is one screen — the page root — plus whatever it
  // opened over itself. P3 built the other three roots'-worth of surface
  // (a pushed pins list, the memory root, a pushed reading view, a pushed
  // trail index) and until this pass not one pixel of any of them had
  // been rendered by a browser: `Stack` was mounted by nothing through
  // P1d and P2 entire, `MemoryScreen` is four days old, and the two
  // pushed screens have never been laid out against a real 412px frame.
  //
  // ALL SEVEN RUN ON `shell-trail-page`, and that is a fixture decision
  // rather than a convenience. Every one of them needs DATA the shell has
  // no way to make: pins to list, days to scroll, trails to index, a past
  // page to read. `trailedDay` is the only fixture in the catalog with
  // all four — three lineages (one continuous), eleven pins, two earlier
  // days of writing, two pages on today — and `shell-page`'s empty
  // untrailed page would photograph four empty states instead of four
  // screens. It is also why the memory states live on a scene named for a
  // page: the tab bar is the door, so the root the scene BOOTS on is not
  // the root it ends on, and `goRoot` is the real input that gets there.
  //
  // THE ROWS BELOW ARE SCOPED TO THE TOP STACK ENTRY, always. Stack keeps
  // the top TWO entries mounted in one grid cell, so with pins pushed
  // over the page root `document.querySelectorAll(".shell-row")` matches
  // the screen underneath as well — a reader that forgot this would count
  // rows from a screen the photograph does not show. `data-top="true"` is
  // Stack's own answer to which one is in front, and states.js reads
  // nothing outside it.
  //
  // WHAT THE PICTURE IS EXPECTED TO SHOW AND THE MODEL CANNOT SAY, for
  // this group specifically. `toolbarFor`'s row 1 gives a pushed screen
  // `strip: "none"`, so the frame stops reserving the bottom band
  // entirely — there is no tab bar and no strip on a pushed screen, and
  // "nothing is there" photographs exactly like "something failed to
  // render". The drivers assert the ABSENCE of `.shell-slot` by name for
  // that reason, and assert the tab bar's PRESENCE on the memory root in
  // the same breath, so the two answers are told apart by a caption
  // rather than by a reader's memory of which screen owes a bar.
  //
  // ── FIVE OF THE SEVEN ARE COMMITTED RED, WITH NO BASELINE ────────────
  //
  // Every state below that photographs a PUSHED screen — the pins screen,
  // its two sheets, the reading view and the trail index — reached its
  // shutter with every assertion green and produced an unreadable image:
  // the screen underneath is painted THROUGH the one on top. Memory's
  // nav bar, its search field, its mode segment and every timeline row
  // show behind the reading view's writing and behind the trail index's
  // rows, letter over letter.
  //
  // A PUSHED SCREEN HAS NO BACKGROUND. `.shell-root` paints
  // `--canvas-bg` once, `Sheet` paints `--surface`, and nothing between
  // the frame and a screen paints anything at all — while `Stack` keeps
  // the top TWO entries mounted in ONE grid cell. Stack's own header
  // states the assumption that turns out to be false in as many words:
  // "the top screen covers the one beneath by DOM order alone." DOM
  // order decides paint ORDER; it does not make a transparent element
  // opaque.
  //
  // Not one unit test could have seen it, and that is the point of the
  // photograph rather than a complaint about the suite: jsdom applies no
  // scoped stylesheet, has no compositing, and every model assertion this
  // pass makes — the rows, their values, the back control's 44px box, the
  // emptied slot, the read-only construction — passes over a screen
  // nobody could read. It is P2d's finding again ("every assertion about
  // the MODEL passed, and the screen was still wrong"), on a whole screen
  // instead of a sheet.
  //
  // The baselines are ABSENT rather than recorded, on this tree's
  // standing rule: a PNG of a broken screen, committed, is the bug
  // written down as correct (P1c's failure, and the call P2d and P2e both
  // made). The two states that DID record — `memory` and its filter sheet
  // — are roots: `Stack` keys the root entry by `active`, so a root
  // switch replaces the entry rather than stacking on it, there is only
  // ever one live entry, and nothing bleeds. That is also why the defect
  // survived P1d, P2 entire and three P3 tasks: until Task 1 wired the
  // router, nothing had ever pushed a second entry at all.
  //
  // The fix is one background declaration inside `src/shell/`, which this
  // task may not make. Reported instead.
  //
  // ── the pins screen, and the two sheets a row opens ──────────────────
  //
  // A THREE, not a pair, and the chain is the point: the screen is pushed
  // from the page header, a row on it opens the actions sheet, and a row
  // on THAT opens the editor. Each capture is the previous one plus one
  // real tap, which is the only way the third is reachable at all.
  //
  // NO FILTER SEGMENT IS IN THIS PHOTOGRAPH, and it is a rule rather than
  // a missing control. `pinFilterOptions` returns [] when the list holds
  // fewer than two scopes, and all eleven of the fixture's pins are the
  // page's own trail's — so a segment here would be `all | this trail`,
  // two controls selecting the same eleven rows. The driver asserts the
  // absence AND the one scope behind it, so the day a fixture grows an
  // inherited pin this fails by name instead of quietly gaining a band.
  PINS_SCREEN: "pins-screen",
  // The pin's own screen, pushed from its ROW. It shipped three phases
  // after the pins list, because an Android tester said "I can't open a
  // pin" out loud; the second device pass then made the row open it
  // directly and made the writing on it editable (the actions sheet and
  // the editor sheet that used to stand between are gone).
  //
  // IT IS AN INTERACTION STATE BY NECESSITY, which is this tree's fourth
  // testing rule in its plainest form: the screen is a real tap past a
  // pushed list, so no load-time capture can reach it, and what it costs
  // to get wrong is a pinned table, chart or board that a phone can name
  // and cannot show — or, now, cannot edit.
  //
  // WHAT ONLY THE PHOTOGRAPH CAN SAY: whether a pinned artifact laid out
  // through `.prose` at 412px is legible at all. Every node-shape rule for
  // a table, a code block or a chart lives in src/styles/prose.css, which
  // no jsdom test in this suite loads — so the unit assertions can prove
  // the doc reached the renderer and cannot prove a column of it fits on a
  // phone. The driver checks the box; the image is the rest.
  PIN_ARTIFACT_SCREEN: "pin-artifact-screen",
  // The pin's trail picker (task 9e): a real tap on the pin screen's
  // `trail` row. The sheet lists `no trail` and every trail, the pin's own
  // marked `this pin` and inert — a difference a photograph cannot carry,
  // so the driver reads the elements.
  PIN_TRAIL_SHEET: "pin-trail-sheet",
  // ── a trail's screen, and its delete (task 9e) ──────────────────────
  //
  // Management lives in memory (trail-sheet-model.js's header). The way in
  // is memory's trails sheet: one tap scopes, and the row memory is
  // already showing pushes the trail's screen (trail-manage.js's
  // `scopeRowAction`). Both are interaction states by necessity — four
  // real taps past the root, which no load-time capture reaches.
  TRAIL_SCREEN: "trail-screen",
  // The delete's confirmation sheet: the screen's `delete trail` row
  // asks, and the one destructive row here — naming the trail — deletes.
  // The driver opens it and does not press it.
  TRAIL_DELETE_SHEET: "trail-delete-sheet",
  // ── memory, and the search that rides the bar ────────────────────────
  //
  // The root, reached by a real tap on the tab bar — which is also the
  // first capture in this suite of a root SWITCH. `goRoot` drops the push
  // stack and re-reads on arrival, so what is on screen here is a fetch
  // this driver caused rather than a list the boot left lying around.
  //
  // Three things are in the frame that nothing else in the suite has:
  // the field riding in the nav band (a second line under the bar, not a
  // third control inside it), the mode segment, and the timeline. The
  // driver measures the first against the content band, because "rides in
  // the bar" is a claim about two boxes and a photograph of a field at
  // the top of a screen is compatible with it having scrolled there.
  MEMORY: "memory",
  // The filters sheet, over memory. §2 gives this surface a sheet where it
  // gives pins a segment, and the asymmetry is what the pair of states is
  // for: side by side, one is a band inside a list and the other owns the
  // bottom of the display.
  //
  // NO `clear filters` ROW, and its absence is the assertion. ShellApp
  // offers that row only when `memoryFilterCount` is non-zero, which at
  // rest it is not — so a row appearing here would mean the screen opened
  // already filtered, which is the one thing memory-model.js's header
  // says a writer must never be handed silently.
  MEMORY_FILTERS_SHEET: "memory-filters-sheet",
  // ── the reading view ────────────────────────────────────────────────
  //
  // A past page's writing, pushed from a memory row, with the read-only
  // arm of `readingRows` under it. Both halves are the fixture's: the
  // page is on a DISCRETE trail and dated yesterday, which is the exact
  // shape `pageReadonly` freezes, and CLAUDE.md's "open yesterday in
  // memory, write today on PAGE" is the sentence this screen exists to
  // be the first half of.
  //
  // WHAT ONLY THE PHOTOGRAPH CAN SAY is that the writing is LEGIBLE —
  // `ProseHTML` renders into the global `.prose` stylesheet, which is
  // linked from index.html and applies to no jsdom test in the suite, so
  // every claim about how a past page reads has been unrendered until
  // now. What the driver asserts beside it is the other half of §2's
  // word: not one `contenteditable` and not one `.ProseMirror` anywhere
  // on screen. "Clearly not editable" as a construction rather than as a
  // gate answering false — and a construction is checkable, which a
  // greyed-out cursor is not.
  READING_VIEW: "reading-view",
  // ── P4: settings, sync, and the camera at the end of it ─────────────
  //
  // THE THIRD ROOT, AND EVERYTHING BEHIND IT. `page` and `memory` have
  // both been photographed; `settings` has been a tab with nothing behind
  // it since P1c wrote ROOTS, and until this pass a tap on it had never
  // been performed by anything but a unit test against a stub.
  //
  // ALL SEVEN RUN ON `shell-page`, the untrailed empty page, and that is
  // the opposite call P3 made for memory. P3's four screens each needed
  // DATA the shell cannot make — pins to list, days to scroll, trails to
  // index — so they went on `shell-trail-page`. Nothing below asks the
  // page anything at all: settings reads settings, and sync reads the
  // account. Shooting them on the trailed fixture would seed eleven pins
  // and three lineages to photograph a list of four settings rows.
  //
  // ── WHAT THE MOCK CAN AND CANNOT ANSWER, SAID BEFORE THE PICTURES ───
  //
  // `sync_status` returns null in `src/lib/api.js` — it is one of the
  // thirty-odd commands the browser mock answers with the null default —
  // and no fixture can seed it, because the mock holds no sync state to
  // seed. So every sync capture below is the NULL-STATUS arm, and that is
  // named here rather than discovered by a reader wondering why the state
  // row is blank.
  //
  // It is not a degraded photograph. `syncStateLabel(null)` answers ""
  // deliberately — sync-model.js's own header: "a status that has not been
  // read yet and an install that has never synced are different facts, and
  // printing the second for the first would tell a synced user their
  // account is gone for as long as the round trip takes". The blank value
  // column IS that decision on a screen, and it is an arm a seeded fixture
  // would photograph past. What the mock CANNOT show is the configured
  // arm: a device list with rows in it, `pairSide` answering "show", the
  // QR half of pairing. Those need a seeded account and are unphotographable
  // here — recorded in the P4 handoff rather than faked.
  //
  // ── THE ROOT, AND TWO OF ITS FOUR SECTIONS ──────────────────────────
  //
  // A THREE, and the chain is the point: the root is reached by a tab, a
  // row on it pushes a section, and the two sections chosen are the two
  // that render DIFFERENT row shapes. `SettingsSectionScreen` is one
  // component standing behind every section (settings-model.js's own
  // constraint — Stack calls `entry.view()` with no arguments), so a
  // single section capture proves it renders A section and not that it
  // renders the right SHAPE for each. `tone` is four choice rows with a
  // word in one value column; `labs` is a toggle.
  //
  // `settings-labs` WAS THE FIRST RENDERED PIXEL OF `Row`'S TOGGLE SHAPE,
  // which was checked rather than assumed when it was added: `Row` had
  // carried the variant since §4, and the shell gallery drew only the
  // navigation, value and destructive swatches, so this capture stood in
  // for the catalogue entry the gallery owed. The visual pass's Task 10
  // paid that (the gallery draws the toggle in both positions now, and
  // the PrimaryAction swatch its header had recorded as owed), so this
  // capture stays for what it alone shows: the switch on a real screen,
  // under a real eyebrow, reached by a tap.
  //
  // `about` is NOT photographed, and that is a decision rather than an
  // omission. Its one row is a `value` kind — inert markup, a label and a
  // build string — and that exact shape is already in two captures below:
  // the settings root's `tone · cream`, and the devices screen's state
  // row. A third picture of it would cost a baseline to say nothing new.
  SETTINGS_ROOT: "settings-root",
  SETTINGS_TONE: "settings-tone",
  SETTINGS_LABS: "settings-labs",
  // ── the sync stack, three levels deep ───────────────────────────────
  //
  // devices → pair → scanner, each capture the previous one plus one real
  // tap, which is the only way the third is reachable at all. It is also
  // the DEEPEST the shell goes: sync sits at depth 2 under the settings
  // root, pair at 3, the scanner at 4 — and `assertPushedScreen`'s
  // `depth === 2` claim does not survive that. Stack keeps only the top
  // two entries MOUNTED, but `entries.length` keeps counting, so the
  // drivers below name the depth they expect rather than reusing a helper
  // written when two was the only answer a pushed screen could give.
  //
  // WHAT THE DEVICES SCREEN IS EXPECTED TO SHOW, given the null status
  // above: the state row with an empty value, no note under it (STATE_NOTES
  // has entries for "not set up" and "revoked" and none for ""), no device
  // rows, no loading empty state — `loadSyncDevices` returns [] without
  // fetching when `status?.configured` is false — the pair row reading
  // `pair this device`, which is `pairSide(null) === "join"`, and under
  // it `set up sync`, which `setupRowShows(null)` offers because a status
  // not read yet is the same "not on an account" the pair row assumes.
  // Six separate decisions, four of which are an ABSENCE, and an absent
  // row photographs exactly like a row that failed to render. Asserted by
  // name.
  SYNC_DEVICES: "sync-devices",
  // The join side of pairing: a sentence telling the reader to go and get
  // a code on the device that already has their writing, and one row.
  //
  // NO FIELD ON THIS SIDE, and its absence is an assertion rather than a
  // gap. `pair_new_complete` discards its `device_label` argument
  // (commands.rs, quoted in sync-model.js's header), so a name field here
  // would be a control that does nothing — the same refusal Task 1 made of
  // `restore_last_page`. The field belongs to the SHOW side, which the
  // mock cannot reach.
  SYNC_PAIR: "sync-pair",
  // ── the camera, and the consent gate in front of it ─────────────────
  //
  // A PAIR, and this one is not a matter of taste: they are two different
  // components on one screen. `sync-scan` is the borrowed QrScanner's
  // rationale gate — its own prose and its own `start camera` button,
  // before any `getUserMedia` has been called — and `sync-scan-refused` is
  // what SyncScanScreen puts there INSTEAD once that call fails: QrScanner
  // unmounted, and the shell's own sentence from `scannerNote` in its
  // place.
  //
  // A FAILED CAMERA IS THE ORDINARY CASE HERE, not an error path, and the
  // reason is the capture host: no machine that shoots these baselines has
  // a camera. Playwright's browsers are launched headless against a
  // synthetic display, so `getUserMedia` rejects on every project in the
  // matrix, every time. That is what makes this screen deterministic
  // enough to photograph, and it is the one worth having a baseline of.
  //
  // THIS COMMENT USED TO GIVE A DIFFERENT REASON, AND IT WAS FALSE in both
  // halves: "there is no AndroidManifest.xml in the repo and no
  // `onPermissionRequest` handling, and the only grant that exists is the
  // Linux webkit2gtk hook." Corrected rather than deleted, because the
  // mistake is one a reader can make again from the same evidence.
  //
  // The manifest IS granted the camera. `.gitlab-ci.yml:542-545` runs
  // `scripts/patch-android-camera.py` after `tauri android init`, which
  // inserts `android.permission.CAMERA` plus two optional `uses-feature`
  // entries (`android.hardware.camera`, `android.hardware.camera.autofocus`
  // — optional on purpose, so the app stays installable on a camera-less
  // device given the pair flow's type-the-words fallback). The manifest
  // under `gen/` really does declare only INTERNET, but `gen/` is gitignored
  // and regenerated per build: GENERATED IS NOT SHIPPED, and every CI-built
  // APK and AAB carries the permission.
  //
  // And the WebView-level request is handled without any hook of ours:
  // wry's Android `WebChromeClient` grants it itself. `lib.rs`'s
  // `connect_permission_request` is Linux/webkit2gtk only because Android
  // was never waiting on it. QR pairing works on Android today — the public
  // beta scans with it.
  //
  // The trap that produced the old claim is worth naming, since it is still
  // live: `npm run test:vr:android` shells straight out to
  // `tauri android build` and re-applies none of CI's five patch scripts, so
  // a LOCALLY built APK has no camera permission. A local Android build is
  // not the shipped Android build, and a scanner that never asks for
  // permission there says nothing about the app users install.
  //
  // WHICH OF THE THREE SENTENCES IS IN THE IMAGE IS THE ENGINE'S ANSWER,
  // NOT ANDROID'S, and it is not even the same answer on two Linux hosts.
  // `classifyCameraError` sorts the raw `getUserMedia` rejection into
  // `refused` / `absent` / `failed` by QrScanner's own substrings, and the
  // machine taking the photograph has no camera:
  //
  //   Docker (the canonical image, and what the committed PNG holds)
  //     NotFoundError: Requested device not found  ->  `absent`,
  //     "no camera on this device."
  //   bare Fedora host (a local `npm run test:vr`)
  //     something matching neither mark  ->  `failed`,
  //     "the camera did not open. go back and try again."
  //
  // Measured on both, not assumed: the driver logs the raw error beside the
  // note it produced, every run. That divergence is also why the driver
  // asserts the SET rather than the string — a state that pinned one
  // sentence would be red on whichever host it was not written on, and the
  // README's rule (Docker baselines are canonical) would then be settling
  // an argument about a camera rather than about fonts.
  //
  // THE `refused` ARM IS NOT PHOTOGRAPHED, and it is the one a real Android
  // device will meet. Nothing in this harness can produce it: it needs a
  // machine with a camera whose permission is denied, and the capture hosts
  // have no camera at all.
  //
  // So what the picture guards is the SHAPE, and the shape is the whole
  // finding: the component unmounted, the shell's own sentence in the
  // band, the back control still 44px, no bottom band reserved. The
  // driver asserts the sentence is one of the module's three by name, so
  // a fourth — or the raw exception reaching the screen — fails here
  // rather than being absorbed into the pixels.
  //
  // WHAT THE SECOND CAPTURE IS ACTUALLY GUARDING is a sentence that must
  // never appear. QrScanner's own error branch tells the reader to "switch
  // to the 'type words' tab" — a tab that exists in the desktop's
  // SyncSettings.svelte and NOWHERE in this tree, so on a phone it is an
  // instruction to do something impossible. SyncScanScreen unmounts the
  // component on `onError` precisely so that text cannot be reached, and
  // the whole of that claim is one `{#if}` against a status string. The
  // driver asserts the desktop's wording is absent from the document by
  // name, because in a photograph "the shell's sentence" and "the desktop's
  // sentence" are both grey prose in the middle of a band.
  SYNC_SCAN: "sync-scan",
  SYNC_SCAN_REFUSED: "sync-scan-refused",
  // ── setup, the account wizard, on the phone (2026-09-17) ────────────
  //
  // Two steps of the three, each the previous capture plus real input.
  // The wizard was refused in P4 Task 2 and reversed for the phone that
  // is someone's only device (sync-model.js's header); these are its
  // first pictures, and they have NO BASELINE YET — births, taken in the
  // same re-record every shell baseline is waiting on.
  //
  // `sync-setup-phrase` is the phrase step on the HAVE-A-PHRASE side,
  // with 24 words typed into the one multiline field. The new-account
  // side is what the screen opens on, and it is not the one photographed,
  // for the mock's reason above: `sync_generate_phrase` answers null in
  // the browser, so that side shows the "could not make a phrase"
  // sentence and no words — a true picture of the null arm, and a
  // picture of nothing the wizard is for. The typed side is reachable by
  // a real tap on the segment and real keys into the field, and it is
  // the step whose cost (24 words on a phone keyboard) the layout has to
  // carry, so it is the one that earns a baseline.
  //
  // `sync-setup-relay` is the step after `next` on that phrase: the
  // hosted choice, the destination named under `syncs to`, the device
  // name field, `connect`, and `change the phrase`. Nothing is sent —
  // `connect` is not pressed, and the mock's `sync_relay_health` would
  // answer null if it were.
  SYNC_SETUP_PHRASE: "sync-setup-phrase",
  SYNC_SETUP_RELAY: "sync-setup-relay",
};



/** Which tree a scene exercises. Defaults to "desktop": the nine scenes
 *  that predate the shell all render the desktop tree, and spelling that
 *  out on each of them would be nine chances to typo a default.
 *
 *  This exists because visual.spec.js loops every scene across every
 *  project. Without it, adding an iPhone project shoots all nine desktop
 *  scenes at phone size, and the shell gallery gets shot on the two
 *  desktop projects — in both directions, images nobody will ever read. */
export function sceneSurface(scene) {
  return scene?.surface === "shell" ? "shell" : "desktop";
}

/** The viewport height a scene insists on, or null for the project's real
 *  device height.
 *
 *  This used to be keyed on `surface === "shell"`, which raised every shell
 *  scene to 1200px. For a component catalogue that is right — the gallery is
 *  taller than any phone and the shell does not scroll, so a real height
 *  crops primitives out of the shot. For a SCREEN it is backwards: the page
 *  screen's whole subject is how a 390px-tall-and-narrow device lays it out,
 *  and at 1200px the header shows a fold state no device produces and the
 *  tab bar sits above a home indicator it would never reach.
 *
 *  So the height is a property of the scene, not of the surface: `surface`
 *  says which tree, this says how tall. No field means the device's own
 *  viewport, which is what a screen scene wants. */
export function sceneViewportHeight(scene) {
  const h = scene?.viewportHeight;
  return typeof h === "number" && h > 0 ? h : null;
}

/** How many slides a DECK scene walks, or null for a single capture.
 *
 *  visual.spec.js used to hold this as `const ONBOARDING_SLIDES = 6` beside
 *  an `if (sceneId === "onboarding")` — a fact about one scene, written down
 *  in the loop that reads it, in a file that imports no scene's component. It
 *  survived because there was one deck. There are two now: the shell's gate
 *  is four slides (`ONBOARDING_SLIDES` in src/shell/gate-model.js), and
 *  leaving it there would have made the branch an `||` of scene ids with two
 *  counts to keep in step by hand.
 *
 *  So the count is a property of the scene, exactly like `viewportHeight`
 *  above and for the same reason. `> 1` rather than `> 0`: a one-slide deck
 *  is not a deck, and honouring it would rename that scene's baseline from
 *  `<id>-<theme>.png` to `<id>-s1-<theme>.png` for no gain — the filenames
 *  the existing decks already carry are unchanged by this move. */
export function sceneSlides(scene) {
  const n = scene?.slides;
  return Number.isInteger(n) && n > 1 ? n : null;
}

/** Seeds `try_new_shell` before the scene's own fixture runs, so App.svelte's
 *  boot fork renders the shell instead of the desktop tree. The read happens
 *  at App init (App.svelte's `shellFlagRead`), which is after bootstrap has
 *  installed this invoke — so the value has to be in the store by the time
 *  the fixture returns, not later.
 *
 *  SINCE P5 THIS OVERWRITES RATHER THAN WRITES. `createSeededInvoke`
 *  (seed.js) now seeds "false" for every scene first, because an unwritten
 *  key boots the shell and both Android projects are phone-shaped — a
 *  desktop scene left unseeded would photograph the wrong tree. This
 *  function runs inside the fixture, i.e. after that, so shell scenes still
 *  get "true" and the ordering is what makes both correct.
 *
 *  The string "true", not the boolean: `set_setting` stores strings, and
 *  shell-boot.js enumerates the exact strings precisely because
 *  `Boolean("false")` is true. Seeding a boolean here would still boot the
 *  shell, but it would be seeding something the app can never actually
 *  contain. */
function withShellFlag(fixture) {
  return async (invoke) => {
    await invoke("set_setting", { key: "try_new_shell", value: "true" });
    await fixture(invoke);
  };
}

export const SCENES = {
  "page-blank": {
    space: "page", fixture: FIXTURES.emptyPage, onboarding: false,
    states: [STATES.TOUCH_INSERT_HANDLE, STATES.CHART_BUILDER, STATES.CHART_BUILDER_KEYBOARD],
  },
  "page-content": {
    space: "page", fixture: FIXTURES.pageWithContent, onboarding: false,
    states: [
      STATES.BLOCK_HANDLES_TOUCH, STATES.PIN_FLOW_TOUCH, STATES.KEYBOARD,
      STATES.PIN_PANEL,
      STATES.TRAIL_SHEET_KEYBOARD,
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
  // slides: 6 is the count visual.spec.js used to hold as a constant of its
  // own. Moved here unchanged — same six captures, same six filenames — so
  // that the shell's four-slide gate below could join without the spec
  // growing a second scene id to match on. See `sceneSlides`.
  "onboarding": { space: "page", fixture: FIXTURES.emptyPage, onboarding: true, slides: 6 },

  // The gallery is the only view the harness has of a primitive on its
  // own — every screen shot has that screen's data in front of it. Two
  // scenes rather than one because Sheet is position:fixed and would
  // cover the catalogue: the overlay gets its own shot. Everything that
  // needs a gesture to reveal it — a drag mid-flight, a stack mid-back,
  // the strip switching modes — has a driver in tests/vr/states.js on the
  // screen that hosts it, not a swatch here.
  //
  // viewportHeight: the shell root does not scroll past the viewport, so
  // a height shorter than the catalogue crops its last sections off the
  // bottom and nothing but the photograph says so. The catalogue was
  // measured at ~839px before the visual pass and is ESTIMATED at ~2130px
  // after it — twelve sections, summed from the primitives' own CSS at
  // the phone's 14px rem; the arithmetic is in the Task 10 commit `shell:
  // the gallery shows the system`. 2400 leaves headroom for what that
  // sum cannot see (the prose metrics inside Card, two lines wrapping
  // where one was assumed). ◆ Estimated, not measured: confirm on the
  // first re-shoot and bring it down to what the column needs. These two
  // scenes are the only ones that want a height — see sceneViewportHeight
  // above.
  "shell-gallery": {
    space: "shell-gallery", surface: "shell", viewportHeight: 2400,
    fixture: FIXTURES.emptyPage, onboarding: false,
  },
  "shell-gallery-sheet": {
    space: "shell-gallery", surface: "shell", viewportHeight: 2400,
    fixture: FIXTURES.emptyPage, onboarding: false, sheetOpen: true,
  },

  // The shell's first real SCREEN, reached the way a tester reaches it: the
  // fixture seeds `try_new_shell`, App.svelte's boot fork reads it, and the
  // shell renders in place of the desktop tree. Deliberately NOT
  // space: "shell-gallery" — that branch sits above the fork in App.svelte's
  // {#if} chain and would shadow it, photographing the catalogue under a
  // page scene's name. `space: "page"` is what the desktop tree would have
  // rendered, so if the fork ever stops firing this scene shows the desktop
  // page rather than a blank, and the difference is visible in the image.
  //
  // No viewportHeight: this is a screen, and how a real phone lays it out is
  // the whole subject.
  //
  // BOTH STATES WERE UNREACHABLE IN P2a AND ARE REACHABLE NOW. The measured
  // case for the old refusal is kept, because it is the evidence that the
  // states registered here are real rather than declared:
  //
  //   .shell-screen-content  clientHeight 705, scrollHeight 705
  //   its two children       .ps-wmn 37px + .ps-canvas 28px = 65px
  //   a real wheel over it   scrollTop 0, .ph-line2 still present
  //   viewport shrunk to 360 (the KEYBOARD driver's technique)
  //                          clientHeight 226, scrollHeight 226, still 705-
  //                          shaped in kind: nothing to scroll, and
  //                          .ph-line2 still present
  //
  // Both of navCollapsed's inputs were dead: scroll, because the canvas was
  // a placeholder with nothing to push past the 24px threshold; keyboardOpen,
  // because App.svelte rendered `<S />` with no props at all.
  //
  // Re-measured on the same Pixel 7 against this phase's build, same scene:
  //
  //   load                   705/705, scrollTop 0, .ph-line2 present
  //   keyboard (viewport 360) clientHeight 270, .ph-line2 GONE — the prop
  //                          now arrives (App.svelte:315's kbOpen), so the
  //                          `if (keyboardOpen) return true` arm fires
  //   22 typed lines         scrollHeight 848 against a 749 band, and a real
  //                          wheel moves scrollTop 0 <-> 99, folding and
  //                          unfolding the bar with it
  //
  // The scroll arm needs writing on the page, and typing is how a shell page
  // gets writing — there is no import path and no second surface. The driver
  // types; it does not reach past the editor to plant a doc, which would be
  // a picture of the test rather than of the app.
  //
  // ONE OF THE TWO IS DOCKER-ONLY, and knowing which saves the next reader an
  // investigation. shell-page-keyboard.png verifies green inside
  // `npm run test:vr:docker` and fails a bare-host `npm run test:vr` by 521
  // pixels — every glyph on the screen redrawn, nothing moved: the header
  // text, the "what matters now" line, the placeholder and the three tab
  // labels, in four bands and no fifth. Structurally the two images are the
  // same picture. It is specific to this capture, checked rather than assumed:
  // this scene's own load-time baselines pass on the host, and so does the
  // desktop tree's page-content @ keyboard, which shrinks to the same 360px.
  // --app-height, the shell's one viewport-derived number, reads a clean
  // 360px on the host, so a sub-pixel frame is not the cause and the cause is
  // still open. Docker is the environment these baselines are generated and
  // gated in, so it decides; do not re-record this one from a host to make a
  // local run go green.
  //
  // AND IT IS STALE AS OF P2c, which is a different thing from wrong and
  // needs saying before someone re-records it as a flake. The committed
  // shell-page-keyboard.png shows the TAB BAR under an open keyboard — a
  // combination the app stopped being able to produce the moment the slot
  // went modal (P2c Task 3, `shell: the bottom slot answers to the editor`),
  // because keyboard-up with a caret in text is now the block strip. The
  // Docker run confirms it: 472 pixels differ and the diff is confined
  // entirely to the slot band, every pixel above it identical.
  //
  // It was NOT re-recorded by the task that found it. That task's scope was
  // new baselines, and a moved one is a finding rather than a rebase to
  // accept — the whole reason the gate run is plain and never
  // `--update-snapshots`. It was re-photographed by the next commit that
  // picked the report up (`vr: re-record shell-page @ keyboard, which Task 3
  // deliberately changed`), so the paragraph above is history: the committed
  // PNG has shown the block strip since then, and P2d Task 5 re-recorded it
  // again for the gutter. Left standing because it is the worked example of
  // the rule, not because it still describes the file.
  //
  // Retaken, it stays a distinct shot rather than a duplicate of BLOCK_STRIP
  // below: KEYBOARD is the fold and the resize on an UNWRITTEN page, and the
  // strip is incidental to it; BLOCK_STRIP is the strip itself, over a line
  // somebody typed. What the untyped one turned out to prove is that `undo`
  // is live on both — canUndo is true before the first keystroke, which is
  // the finding states.js records against SHELL_STRIP_LINE.
  //
  // AND IT WAS RE-BORN AGAIN IN P3 TASK 5, by deletion rather than by
  // `--update-snapshots`, on evidence anyone can re-check by opening the
  // file: the committed PNG's header carried `today ▾` and `pins` and no
  // `find`, and PageHeader has rendered `.ph-find` UNCONDITIONALLY since
  // P2c-2. A baseline missing a control the markup cannot omit is stale by
  // inspection, which is the one case this tree lets a session delete a
  // PNG so a plain run rewrites it.
  //
  // THE OTHER THREE OF THIS SCENE'S FIVE "STALE" BASELINES ARE NOT STALE,
  // and the P2f-2 handoff's count is corrected here rather than repeated.
  // `block-strip`, `selection-strip` and `collapsed` never reach the
  // shutter at all: their DRIVERS throw first — `pin` and `pin-selection`
  // now render live where the captions call them dead (P2f Task 1 gave
  // them their command, and the captions were not carried), and the fold
  // does not re-open when the band is scrolled back to 22px. No re-record
  // can fix any of the three; each needs its caption re-derived or the
  // behaviour looked at. They were deleted during the P3 pass and RESTORED
  // on that finding — a committed baseline nothing can regenerate is worth
  // more than an empty slot.
  //
  // THE GUTTER MOVED THE INTERACTION SHOTS AND NOT THE LOAD-TIME ONES, which
  // is the opposite of what P2d Task 2 forecast and worth a line before
  // someone re-derives it. P2d gave the canvas `padding-left: var(--tap)`, so
  // every line of prose starts 30px further right — but this scene's fixture
  // is an EMPTY page, and an unfocused empty editor draws nothing at all: no
  // placeholder (it needs focus), no caret, no handle. Six load-time
  // baselines (three themes, two shell projects) and the notch shot were
  // therefore byte-identical across the change, and the four states that put
  // something on the page — keyboard, collapsed, and the two strips — all
  // moved. A gutter is only visible next to something it indents.
  "shell-page": {
    space: "page", surface: "shell",
    fixture: withShellFlag(FIXTURES.emptyPage), onboarding: false,
    states: [
      STATES.KEYBOARD, STATES.COLLAPSED,
      STATES.BLOCK_STRIP, STATES.SELECTION_STRIP,
      STATES.BLOCK_SHEET, STATES.INSERT_SHEET,
      // On `ios-webkit` and nowhere else — see STATE_PROJECT in
      // visual.spec.js. It lives on this scene rather than on one of its
      // own because it IS the insert sheet: same fixture, same entry, same
      // rows, and the only difference is which viewport the keyboard
      // shrank. Two scenes would make the comparison a paragraph instead
      // of a pair of images.
      STATES.IOS_KEYBOARD_SHEET,
      STATES.FIND_STRIP, STATES.SUGGESTION_STRIP,
      STATES.BLOCK_LIFT,
      STATES.TABLE_SHEET, STATES.CHART_SHEET, STATES.CHART_SHEET_TIMELINE,
      STATES.BLOCK_SHEET_BOARD,
      // P4's seven. The third root and everything behind it — see the
      // block in STATES for why they are here rather than on the trailed
      // scene, and for what the browser mock can and cannot answer about
      // an account.
      STATES.SETTINGS_ROOT, STATES.SETTINGS_TONE, STATES.SETTINGS_LABS,
      STATES.SYNC_DEVICES, STATES.SYNC_PAIR,
      STATES.SYNC_SCAN, STATES.SYNC_SCAN_REFUSED,
      // Setup's two, born 2026-09-17 with no PNG yet — see their block
      // in STATES.
      STATES.SYNC_SETUP_PHRASE, STATES.SYNC_SETUP_RELAY,
    ],
  },

  // The same shell screen on a page that is ON something — P2f's four
  // header-and-pin states, which `shell-page` cannot host.
  //
  // COLLAPSED's own comment forecast this scene and declined to build it:
  // it probed the trail-name promotion by pointing shell-page's fixture at
  // continuousTrail, found the promotion renders, and reverted the probe
  // rather than commit it, because "changing which page the shell's only
  // screen scene shows is a catalogue decision and not a VR-state one. A
  // trailed shell scene belongs with P2f's trail sheet, and this is the
  // coverage it buys." This is that scene, and shell-page keeps its
  // untrailed empty page unchanged — the two are the pair, not a
  // replacement.
  //
  // The fixture is a DISCRETE trail on today's date, and both halves of
  // that matter. Discrete, because a continuous trail's canonical is the
  // one page the shell refuses to offer a trail control for at all
  // (ShellApp's call site, and the desktop's before it), so several of
  // these states would have nothing to tap. Today, because
  // `pageReadonly` freezes any other date on a discrete trail — the
  // fixture would render an inert shell and the photograph would read as
  // broken chrome rather than as a rule being obeyed (P2f Task 3's own
  // finding, where every unit fixture was dated 1999).
  //
  // No viewportHeight, for shell-page's reason: this is a SCREEN, and how
  // a real phone lays it out is the subject.
  //
  // P3 ADDED SEVEN MORE, and they are here rather than on a scene of
  // their own for the reason the STATES block above records: the four
  // screens P3 built all need data — pins, days, trails, a past page —
  // and this fixture is the only one in the catalog that has it. Three of
  // them do not photograph this page at all (memory is a different root,
  // reached through the tab bar), which is a property of the shell rather
  // than of the catalog: one app, one boot, and the tab bar is real
  // input.
  "shell-trail-page": {
    space: "page", surface: "shell",
    fixture: withShellFlag(FIXTURES.trailedDay), onboarding: false,
    states: [
      STATES.PIN_TOAST,
      STATES.DATE_SHEET, STATES.PAGES_SHEET, STATES.TRAIL_SHEET,
      STATES.PINS_SCREEN, STATES.PIN_ARTIFACT_SCREEN, STATES.PIN_TRAIL_SHEET,
      STATES.MEMORY, STATES.MEMORY_FILTERS_SHEET,
      STATES.TRAIL_SCREEN, STATES.TRAIL_DELETE_SHEET,
      STATES.READING_VIEW,
    ],
  },

  // ── P4: the shell's own onboarding gate ─────────────────────────────
  //
  // The first CHROMELESS surface in the catalog. Every other shell scene
  // is a root or something pushed over one; this is what stands in FRONT
  // of the shell entirely — App.svelte's chain runs onboarding → lock →
  // the boot fork, and a gate is reached by never getting as far as the
  // fork at all.
  //
  // TWO FLAGS TOGETHER, and neither works without the other.
  // `onboarding: true` is what makes App.svelte's VR branch report the
  // onboarding as incomplete, which is the branch the gate lives inside;
  // `withShellFlag` is what makes that branch render the SHELL's gate
  // rather than the desktop's six slides. Drop either and this scene
  // silently photographs the other tree — which is legible in the image
  // (the desktop deck is a different layout entirely), so a mis-seed here
  // fails visibly rather than subtly.
  //
  // WHO SEES THIS IN THE REAL APP got WIDER at P5, and this note said the
  // reverse until the default flipped: it read "`bootShell` needs
  // `try_new_shell` already written, and a genuinely new install has never
  // written it, so a true first launch onboards on the desktop slides",
  // reached only "by a tester who turned the flag on and then cleared their
  // data". An unwritten key now boots the shell, so this gate is what a
  // genuinely new phone install sees. The scene still writes the flag
  // explicitly, and still should: seed.js seeds "false" for every scene
  // first, so a shell scene that stopped asking would quietly photograph
  // the desktop deck.
  //
  // FOUR SLIDES, WALKED, in all three themes. The deck is captured the way
  // the desktop's six are and for the reason recorded there: a lone
  // capture of slide 1 leaves the rest without regression coverage, and a
  // real layout break once shipped invisible to VR that way. Here it is
  // load-time coverage rather than an interaction state even though a tap
  // moves between slides, because the deck IS the surface — every slide is
  // a resting screen a reader arrives at, not a state something has to be
  // done to reveal. What that buys beyond the pixels is the off-by-one
  // `gateStep` exists to prevent: slide 4's control reads `begin` and
  // slides 1–3's read `next`, and the walk would stall on a deck that
  // labelled the last one wrong.
  //
  // NO viewportHeight, for shell-page's reason: the whole subject is how
  // a phone lays out a gate with `margin: auto` centring, and a 1200px
  // frame would photograph a centring no device performs.
  //
  // THE OTHER TWO CHROMELESS STATES ARE ABSENT, and both are unreachable
  // rather than skipped. LOCK: App.svelte's VR branch sets
  // `isLocked = false` and returns early, and the mock's
  // `check_encryption_status` answers false regardless — so no scene, no
  // fixture and no driver can put this app behind a lock. scenes.js's own
  // header has said "lock-screen is deferred to a follow-up (needs extra
  // app hooks)" since the first catalog, and P4 does not change it.
  // MIDNIGHT: `midnightDue` needs the device's day to have moved SINCE the
  // page was adopted, and installFixedClock freezes `Date` at one instant
  // for the whole capture — `openedOn` and `today` are read from the same
  // frozen clock, so `today > openedOn` can never be true. Not a driver
  // that was not written: a driver cannot exist while the clock cannot
  // move. Both are in the P4 handoff with what each would cost.
  "shell-onboarding": {
    space: "page", surface: "shell",
    fixture: withShellFlag(FIXTURES.emptyPage), onboarding: true, slides: 4,
  },
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
  // The same three pages in the phone layout, for the site's phone shots
  // (marketing/launch/screenshots/2026-10-25/_capture/capture.mjs).
  "mk-shell-tools": {
    space: "page", surface: "shell", fixture: withShellFlag(MARKETING_FIXTURES.marketingTools),
    onboarding: false, marketing: true,
  },
  "mk-shell-trail": {
    space: "page", surface: "shell", fixture: withShellFlag(MARKETING_FIXTURES.marketingTrail),
    onboarding: false, marketing: true,
  },
  "mk-shell-memory": {
    space: "page", surface: "shell", fixture: withShellFlag(MARKETING_FIXTURES.marketingMemory),
    onboarding: false, marketing: true,
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
