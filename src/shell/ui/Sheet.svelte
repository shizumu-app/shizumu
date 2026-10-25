<!--
  The one overlay. Two detents, drag to dismiss, a scrim behind it that
  dismisses on tap, and nothing else in the shell is allowed position:
  fixed except the root.

  Where a drag lands is sheet-detent.js's decision, not this component's:
  the sheet measures the gesture and asks. That matters because the rule
  is not obvious — velocity decides first, in two tiers. A gentle flick
  moves exactly one step, so it cannot carry the sheet past the detent the
  user was aiming for; a hard flick is the sheet being thrown away and
  goes straight to dismissed from either detent. The second tier is a
  device report: a one-field sheet at full that "sometimes" could not be
  dismissed, because one step from full is half and the slow path needed
  most of the screen. The velocity is measured: Sheet keeps its own
  {x, y, t} timeline and asks pointer-gesture.js at release, as
  Stack.svelte does. It was hardcoded 0 for two phases, which made both of
  sheetDetent's velocity branches unreachable and left the nearest-detent
  comparison the only path it could ever take — so a short fast flick,
  which is how a sheet is actually thrown away, sprang back to where it
  started.

  The scrim is the other half of that report. A sheet with no backdrop has
  no tap-outside, so the only ways out were a drag and the system back —
  and which one the user reached for is what made the bug "sometimes". It
  is a div, not a button (shell-rules.test.js's raw-button rule, and a
  backdrop is not a control a screen reader should announce), it paints
  from --scrim because an element with no background is invisible (the
  Stack lesson), and it always takes the tap: under a dismissable sheet
  the tap closes it, under a `dismissable={false}` one (midnight) the tap
  is absorbed and the sheet stays. Absorbed, not passed through — the
  page beneath midnight is one the writer can no longer type into, and
  "it must be answered" means the page waits, which is the inert
  background aria-modal has been asserting all along.

  Dragging from the content only dismisses when that content is at its
  top. Mid-list the same downward drag is the user reading, and dismissing
  there is the "sheet closes while you scroll it" bug — the same rule
  gesture-owner.js applies one region over. Sheet owns the scroller
  (.shell-sheet-content) so it observes its own scroll position by default
  (contentAtTop = null) via the same atScrollBoundary helper Screen.svelte
  uses — a host cannot correctly answer "is Sheet's internal scroller at
  its top" about an element it has no handle on, and defaulting the prop to
  `true` used to mean every sheet with a scrolling list dismissed on the
  first downward drag mid-list. Passing an explicit boolean still overrides,
  for the rare host that owns the scroll container itself.

  It reads --kb-overlay (written by keyboard-state.js, never by the shell)
  so a field inside it sits above the keyboard rather than behind it.
  --kb-overlay, not --kb-inset: the inset is the keyboard's HEIGHT, and
  lifting a fixed surface by that under interactive-widget=resizes-content
  subtracts the same keyboard twice. See keyboardOverlayPx.

  AND IT READS IT EVEN THOUGH THE FRAME NOW SHRINKS. --app-height is the
  band the keyboard leaves (keyboard-state.js, visibleBandHeight), so
  ShellRoot's frame already ends at the keyboard's top edge — which looks
  like it should make this lift unnecessary. It does not: `position: fixed`
  resolves against the LAYOUT viewport, and a fixed ancestor is not a
  containing block for a fixed descendant (only transform/filter/contain
  are). This sheet is pinned to the bottom of the full display whatever the
  frame does, so the lift is still the only thing holding it above the IME.

  The handle and the content both carry drag handlers, but only the handle
  is aria-hidden: it is a redundant grab affordance that offers nothing a
  screen-reader user can act on. The content is the sheet's substance, so
  it stays exposed to assistive tech — it merely carries drag handlers
  as well as everything the sheet is for.

  aria-modal="true" asserts the background is inert. Two thirds of that
  promise are kept here now: an open sheet pushes a navstack entry, so
  Android system back, Esc and navBack() all reach it and close it rather
  than closing something behind it; and the scrim takes every pointer that
  lands outside the sheet, so nothing beneath is tapped through. The last
  third — a focus trap, so Tab cannot walk out of the sheet — is still not
  enforced by this component, and the host is still what has to supply it.

  What shows is not the `open` prop directly. `open` is a request; the
  sheet shows once it holds the module-scope claim below, and a claim it
  loses (a second sheet opening, a back press, a dismissing drag) takes it
  away without waiting for the host to notice. That costs one flush at
  mount — a test that queries the DOM straight after render() sees nothing
  until it calls flushSync().
-->
<script module>
  // "One sheet at a time" (§1) is an app-wide rule, not a per-instance
  // one: two hosts that each own a Sheet must not both be showing one.
  // The claim therefore lives at module scope — an instance-local flag can
  // only enforce the rule against itself, which is no rule at all.
  //
  // Two variables rather than one, because they answer different
  // questions. The tag is what sheet-stack.js compares (it reasons about
  // sheet identity, not about component instances); the callback is how
  // the sheet holding the claim is actually taken away. A tag alone could
  // say a sheet is up without being able to reach it.
  let showingTag = null;
  let hideShowing = null;
</script>

<script>
  import { sheetDetent } from "../sheet-detent.js";
  import { nextSheet } from "../sheet-stack.js";
  import { recognise } from "../pointer-gesture.js";
  import { getViewportHeight } from "../../lib/keyboard-state.js";
  import { atScrollBoundary } from "../../lib/gesture-arming.js";
  import { navPush, navClose } from "../../lib/navstack.js";
  // The one predicate for "is this what a keyboard is open FOR" — the
  // viewport owner's, so the sheet and the keyboard state cannot disagree
  // about what a text field is.
  import { isTextFieldElement } from "../../lib/keyboard-state.js";

  // The one place either detent fraction is declared. The rendered height
  // does not re-state these as CSS percentages: `.shell-sheet` below reads
  // `--detent-fraction`, an inline custom property this component writes
  // from this object (see the markup), so the visible height and this
  // object are the same source, not two numbers kept equal by hand. That
  // was exactly Important 9: halfPx/fullPx used to be whatever a host
  // happened to pass in, with nothing tying them to what the sheet actually
  // rendered, so a drag could land on a detent the sheet's own CSS didn't
  // draw. detentPx() below still has to read this object directly rather
  // than the rendered custom property, because it needs BOTH candidate
  // detents' pixel heights at once (to compare a drag against), and only
  // one of them is ever the currently-rendered `--detent-fraction`.
  const DETENT_FRACTION = { half: 0.5, full: 0.92 };

  // getPropertyValue("--safe-top") is not guaranteed to hand back a
  // resolved px number: --safe-top is declared from the safe-area inset
  // function (global.css, the one place that literal is allowed to appear —
  // see shell-rules.test.js), and some browsers return that token stream
  // unsubstituted for a custom property rather than resolving it, in which
  // case parseFloat yields NaN. UNREADABLE_SAFE_TOP_PX names that case on
  // purpose rather than letting `|| 0` swallow it silently as "the safe
  // area is 0px" — it means "could not be read." The consequence is
  // bounded either way: this value only feeds the drag-release comparison
  // in sheetDetent() below, never what's rendered (the CSS max-height
  // clamps the actual height independently, from the same --safe-top), so
  // an unreadable safe-top means sheetDetent() compares against a target a
  // few px taller than the sheet can actually render — not a sheet that
  // renders off-screen.
  const UNREADABLE_SAFE_TOP_PX = 0;

  /** Mirrors the CSS: height = fraction of --app-height, capped so the top
   * never goes above the safe area (matches `max-height` below). Only used
   * when the host hasn't supplied an explicit halfPx/fullPx — tests pass
   * those directly so they don't depend on getComputedStyle, which jsdom
   * does not resolve for stylesheet-declared custom properties (it does
   * resolve --app-height/--kb-inset here because keyboard-state.js writes
   * them as inline style on documentElement, not through a stylesheet). */
  function detentPx(name) {
    if (typeof window === "undefined") return 0;
    const vh = getViewportHeight(window);
    const rawSafeTop = parseFloat(
      getComputedStyle(window.document.documentElement).getPropertyValue("--safe-top"),
    );
    const safeTop = Number.isFinite(rawSafeTop) ? rawSafeTop : UNREADABLE_SAFE_TOP_PX;
    return Math.max(0, Math.min(vh * DETENT_FRACTION[name], vh - safeTop));
  }

  /** @type {{
    open?: boolean,
    tag?: string,
    detent?: "half" | "full",
    halfPx?: number,
    fullPx?: number,
    dismissable?: boolean,
    contentAtTop?: boolean | null,
    onDetent?: (detent: "half" | "full") => void,
    onDismiss?: () => void,
    children?: import("svelte").Snippet,
  }} */
  let {
    open = false,
    // Which sheet this is. It is the identity sheet-stack.js compares to
    // decide whether an open is a replacement or a re-open of the sheet
    // already showing, and it is the tag the navstack entry carries, so
    // navstack's snapshot can say what is on top.
    tag = "sheet",
    detent = "half",
    halfPx = undefined,
    fullPx = undefined,
    dismissable = true,
    // null (the default) means "observe my own scroller" — see
    // observedAtTop / resolvedAtTop below. A host that owns the scroll
    // container itself (rare — Sheet owns it in the normal case) can
    // still pass a boolean to override.
    contentAtTop = null,
    onDetent,
    onDismiss,
    children,
  } = $props();

  // Whether this instance currently holds the module claim above. The
  // template renders from this, not from `open` — see the header.
  let showing = $state(false);

  // The navstack entry this instance last pushed. Deliberately NOT cleared
  // when the entry goes away: navClose looks its argument up as
  // `e.id === id && !e.closed` (navstack.js:72) and returns early on a
  // miss, so calling it again on an entry back has already popped is a
  // no-op. Keeping the id means every teardown path calls navClose
  // unconditionally instead of each one needing to know whether another
  // path got there first. If that reading were wrong the cost would be a
  // second history.go(-1) eating an unrelated entry, so Sheet.test.js pins
  // the behaviour rather than trusting the reading.
  let navId = null;

  // True only while navstack is itself in the middle of closing our entry.
  // handlePopState pops the entry BEFORE calling onClose (navstack.js:106-110),
  // so a navClose from inside that callback is the harmless no-op described
  // above — but navPopAll calls onClose BEFORE marking the entry closed
  // (navstack.js:88-91), and there a re-entrant navClose would rewind
  // history once and let navPopAll's own popTrailingClosed rewind it again.
  // The flag makes the callback path skip the call it does not need,
  // without taking it away from the unmount that does.
  let navClosing = false;

  let contentEl = $state(null);
  let observedAtTop = $state(true);

  // The stroke in flight, and the finger that owns it. Plain `let`, as in
  // Stack and ShellRoot: nothing rendered reads either, and a $state array
  // here would invalidate the frame on every sample of every drag.
  let points = [];
  let activePointer = null;

  // ── the tap that opens a sheet is not a tap on the sheet ──────────────
  //
  // The shell's toolbar controls act on `pointerdown` and preventDefault
  // it, so the editor never loses its selection (ToolbarButton's header).
  // A tap still fires `click` afterwards — cancelling pointerdown
  // suppresses the compatibility MOUSE events, not the click — and the
  // browser hit-tests that click against the DOM as it stands THEN. By
  // then this sheet has mounted, under the finger.
  //
  // That is not hypothetical. `+` sits at the bottom of the strip, inside
  // the rectangle the half detent then covers, so one tap on it opened the
  // insert sheet and immediately ran whichever row happened to land at the
  // button's y: measured on android-webview as pointerdown on
  // [data-button-id="insert"] with 0 sheets on screen, then pointerup AND
  // click on `.shell-row-label{list}` with 1 — a list board the user never
  // chose, and a sheet they never saw. The gutter handle escaped it only
  // because it sits high enough on the page that the ghost click misses
  // the sheet entirely, which is geometry, not a rule.
  //
  // So a sheet swallows exactly one click: the ghost belonging to the
  // gesture that opened it. The seal lifts on the first pointerdown that
  // starts ON the sheet or ON its scrim, which can only be a press made
  // with the sheet already on screen — no timer, so nothing here depends
  // on how fast the opening tap was. A click with no pointer behind it
  // (`detail === 0`, which is how Enter on a focused row arrives) is never
  // a ghost and is let through.
  //
  // The scrim shares the seal rather than carrying its own — one ghost, one
  // seal, and no test can tell two apart since either surface lifts its
  // own on pointerdown. Where the ghost lands is geometry: `+`
  // sits inside the half detent's rectangle so its ghost hits the sheet,
  // but a pin row halfway up the pins list or the gutter handle high on the
  // page sit ABOVE that rectangle, and their ghost hits the scrim. A scrim
  // that dismissed on it would close the sheet the instant it opened. And
  // the scrim must lift the seal on its own pointerdown, for the same
  // reason the sheet does: a press that starts on it was made with the
  // sheet on screen, and treating the writer's first tap outside the sheet
  // as the ghost would eat that tap — the reported "sometimes" bug again,
  // one mechanism over.
  let sealed = false;

  // contentAtTop is the override; when the host leaves it at the default
  // (null) the sheet answers the question itself, exactly as Screen.svelte
  // does with the same atScrollBoundary helper. Before this, Sheet asked
  // the HOST whether Sheet's own internal scroller — an element the host
  // has no handle on — was at its top, which no host could ever correctly
  // answer; the default of `true` made every sheet with a scrolling list
  // dismiss on the first downward drag mid-list.
  const resolvedAtTop = $derived(contentAtTop === null ? observedAtTop : contentAtTop);

  function handleContentScroll() {
    observedAtTop = atScrollBoundary(contentEl, "down");
  }

  // Give up the claim and the nav entry, and stop rendering. Silent by
  // design: it says nothing to the host, because two of the three callers
  // are cases the host either performed itself (it set open = false) or is
  // about to be told about separately (dismissSelf, below).
  function stopShowing() {
    showing = false;
    sealed = false;
    // Only if this instance is the one holding it. A sheet closing after
    // it has already been replaced must not clear the replacement's claim.
    if (hideShowing === dismissSelf) {
      showingTag = null;
      hideShowing = null;
    }
    if (!navClosing && navId !== null) navClose(navId);
  }

  // The sheet goes away and the host has to hear about it: a dismissing
  // drag, a back press, or another sheet taking its place. Every one of
  // those originates somewhere the host did not ask for, which is the line
  // between this and stopShowing.
  function dismissSelf() {
    stopShowing();
    onDismiss?.();
  }

  function closedByNav() {
    navClosing = true;
    try {
      dismissSelf();
    } finally {
      navClosing = false;
    }
  }

  // Registering here is what makes back reach a sheet at all: navBack(),
  // Esc and Android system back every one of them funnel through
  // navstack.js, and until this existed a sheet was simply not in the
  // stack they read.
  //
  // The decision of what an open means when another sheet is already up
  // belongs to sheet-stack.js, not here. Its inert case is the one worth
  // naming: re-opening the sheet already showing must not tear down and
  // rebuild its content — the trail picker and the pin note sheet both
  // hold a field, and a rebuild silently discards what was typed into it —
  // and must not push a second history state for one sheet, which would
  // break navstack's one-entry-one-state invariant (navstack.js:11-13).
  $effect(() => {
    const opening = open ? tag : null;
    if (opening === null) {
      // The host closed its own sheet. It does not need onDismiss to hear
      // about a change it just made.
      stopShowing();
      return;
    }
    const { show, dismissed } = nextSheet({ current: showingTag, opening });
    // Whoever is showing goes away FIRST, so navstack never holds two
    // sheets' entries at once, even for an instant. Its history entry is
    // NOT rewound here and then re-pushed — that races its own popstate
    // and leaves the incoming sheet with no entry at all, which closed the
    // app on a back press. navstack defers the rewind and lets the next
    // push take the slot; see the note above its popTrailingClosed.
    if (dismissed !== null) hideShowing?.();
    // sheet-stack's inert case: `show` is still what is already showing, so
    // there is nothing to claim, nothing to push, and nothing to rebuild.
    if (show === showingTag) return;
    showingTag = show;
    hideShowing = dismissSelf;
    showing = true;
    // Armed here rather than at mount: this is the one line that runs
    // because a sheet is newly on screen, which is exactly when a ghost
    // click from the opening gesture is still in flight.
    sealed = true;
    // A MENU TAKES THE KEYBOARD DOWN. See takeKeyboardDown.
    takeKeyboardDown();
    navId = navPush(show, closedByNav);
  });

  // Unmount. Separate from the effect above deliberately: that one's
  // teardown would run before each of its own re-runs, closing the entry it
  // is about to re-register. This one reads nothing reactive, so it runs
  // once and tears down once.
  $effect(() => () => stopShowing());

  /** Put the keyboard away for the menu that just opened.
   *
   *  A sheet is anchored to the bottom of the screen and the keyboard is
   *  the bottom of the screen, so the two were sharing it: on a 360px
   *  phone an eighteen-row insert sheet showed eight rows over a
   *  keyboard nobody was typing into. Worse than the crowding was the
   *  MOVEMENT — the first tap on a row blurred whatever had focus, the
   *  keyboard went down, the sheet re-laid itself out around the freed
   *  space, and the tap landed where the row had been. That was reported
   *  twice from a device, once for the insert sheet and once for the
   *  trail sheet, and fixed twice at the row (`keepFocus`). This is the
   *  same bug's cause rather than its symptom: the keyboard goes when
   *  the menu arrives, once, before a finger is anywhere near a row.
   *
   *  A FIELD INSIDE THE SHEET BRINGS IT BACK, by being tapped — which is
   *  the only way a webview raises it anyway (focus-field.js), and why
   *  no sheet in this shell autofocuses. So the trail sheet, the insert
   *  finder, the chart title and the pin editor all still type; what
   *  they no longer do is open into half a screen.
   *
   *  Blurring is the only way to put a soft keyboard away from script —
   *  there is no API for it — and it is safe for the editor: ProseMirror
   *  keeps its selection through a blur, and every command the sheets run
   *  focuses before it acts. The host hands the caret back after a row
   *  writes to the document (ShellApp's block and insert rows), so the
   *  flow that ends in typing still ends in typing.
   *
   *  Guarded on it being a TEXT field rather than blurring whatever has
   *  focus: a sheet opened from a button would otherwise drop that
   *  button's focus ring for no reason, and assistive tech reads the
   *  sheet from its own dialog role either way. */
  function takeKeyboardDown() {
    const active = document?.activeElement;
    if (isTextFieldElement(active)) active.blur?.();
  }

  function reset() {
    points = [];
    activePointer = null;
  }

  function start(event, region) {
    // The content is a drag surface only at its own scroll top.
    if (region === "content" && !resolvedAtTop) return;
    // One stroke at a time, first finger wins — Stack's guard, for Stack's
    // reason: a second finger appending to this timeline reads as a jump,
    // and a jump on the tail of the list is a flick that never happened.
    if (activePointer !== null) return;
    // Without capture, a real drag's pointermove/pointerup route to
    // whatever element is under the finger — and the handle is only
    // --tap tall, so a downward drag leaves it almost
    // immediately and the gesture dies mid-drag. Capture keeps the
    // events routed here for the rest of the gesture regardless of
    // where the finger wanders. After the guards, never before: capturing
    // a pointer whose events we then drop would steal the rest of that
    // stroke from whatever the finger is actually on. Optional-chained
    // because jsdom does not implement it; no explicit release is needed,
    // capture ends with the pointer.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    activePointer = event.pointerId;
    points = [{ x: event.clientX, y: event.clientY, t: event.timeStamp }];
  }

  function move(event) {
    if (activePointer === null || event.pointerId !== activePointer) return;
    points.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
  }

  function end(event) {
    if (activePointer === null || event.pointerId !== activePointer) return;
    const stroke = points;
    reset();

    // offsetY and velocityY both come off the one recognised stroke, never
    // one from the stroke and one from a separately-tracked position —
    // Stack's rule, for Stack's reason: two numbers describing one gesture
    // are two numbers that can disagree, and the disagreement here dismisses
    // a sheet on a distance the recogniser never saw.
    //
    // The release coordinate is deliberately NOT appended to the timeline.
    // A press and release with no pointermove between them is a tap, and
    // reading the release position would turn the gap between a press on
    // the handle and a release further down the screen into a drag that
    // never arrived. Sheet.test.js pins that case.
    const { dy, velocityY } = recognise({ points: stroke });
    const landed = sheetDetent({
      from: detent,
      offsetY: dy,
      velocityY,
      // undefined halfPx/fullPx (the default) falls through to detentPx —
      // see the comment above DETENT_FRACTION for why this, not two
      // independently-chosen numbers, is the single source of truth.
      halfPx: halfPx ?? detentPx("half"),
      fullPx: fullPx ?? detentPx("full"),
    });
    if (landed === "dismissed") {
      if (dismissable) dismissSelf();
      return;
    }
    onDetent?.(landed);
  }

  // A cancelled pointer lands nowhere: the OS took the stroke, and
  // re-deciding a detent from a gesture the user never finished is the
  // version of this bug they cannot even tell they caused.
  //
  // This handler is not optional now that `start` refuses a second finger.
  // A cancel arrives with no pointerup after it, so without this
  // activePointer stays set forever and every later drag on the sheet is
  // refused by that guard — the sheet keeps rendering and simply stops
  // responding to the handle.
  //
  // The guard is `||`, exactly as in move and end, and the difference is
  // not stylistic: written `activePointer !== null && …` it is FALSE
  // whenever no stroke is in flight, which is most of this component's
  // life, so the body would run for every cancelled pointer bubbling up
  // from anything inside the sheet.
  function cancel(event) {
    if (activePointer === null || event.pointerId !== activePointer) return;
    reset();
  }

  function unseal() {
    sealed = false;
  }

  /** True if this click was the opening tap's ghost — consumed, and the
   * seal is spent on it either way, so the sheet swallows exactly one. */
  function consumeOpeningClick(event) {
    if (!sealed) return false;
    sealed = false;
    if (event.detail === 0) return false;
    event.stopPropagation();
    event.preventDefault();
    return true;
  }

  function swallowOpeningClick(event) {
    consumeOpeningClick(event);
  }

  // The scrim takes the tap whether or not it acts on it. `dismissable`
  // decides only the second half: midnight is the sheet that must be
  // answered, and a tap beside it is neither answer.
  function scrimClick(event) {
    if (consumeOpeningClick(event)) return;
    if (!dismissable) return;
    dismissSelf();
  }
</script>

{#if showing}
  <!-- Before the sheet in DOM order, which is what paints it beneath: both
       are position: fixed with no z-index (nothing in the shell has one),
       so later-in-tree wins. aria-hidden because a backdrop is not a
       control — back, Esc and the drag are the accessible exits.
       data-dismissable is for tests and styling; the decision is in
       scrimClick, not the attribute. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="shell-sheet-scrim"
    data-dismissable={dismissable}
    aria-hidden="true"
    onpointerdowncapture={unseal}
    onclick={scrimClick}
  ></div>
  <div
    class="shell-sheet"
    data-detent={detent}
    data-sheet={tag}
    style="--detent-fraction: {DETENT_FRACTION[detent]}"
    role="dialog"
    aria-modal="true"
    onpointerdowncapture={unseal}
    onclickcapture={swallowOpeningClick}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="shell-sheet-handle"
      aria-hidden="true"
      onpointerdown={(e) => start(e, "handle")}
      onpointermove={move}
      onpointerup={end}
      onpointercancel={cancel}
    ></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="shell-sheet-content"
      bind:this={contentEl}
      onscroll={handleContentScroll}
      onpointerdown={(e) => start(e, "content")}
      onpointermove={move}
      onpointerup={end}
      onpointercancel={cancel}
    >
      {#if children}{@render children()}{/if}
    </div>
  </div>
{/if}

<style>
  /* Sheet and ShellRoot are the only two files the rules test permits
     position: fixed. Everything else lives in the flow. The scrim is the
     second fixed box in this file: the whole layout viewport, painted
     from --scrim (global.css, shell tokens) — an ink wash the page reads
     through, because the midnight sheet's "stay on yesterday" is a
     sentence about the page behind it and the page has to stay legible
     for it to mean anything. --motion-sheet-open alone in the shorthand:
     the token already ends in an easing (shell-rules.test.js's
     --spring rule). */
  .shell-sheet-scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    animation: shell-scrim-fade var(--motion-sheet-open);
  }

  @keyframes shell-scrim-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .shell-sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-top-left-radius: var(--radius-lg);
    border-top-right-radius: var(--radius-lg);
    box-shadow: 0 -0.25rem 1.5rem var(--card-shadow-hover);
    padding-bottom: var(--safe-bottom);
    margin-bottom: var(--kb-overlay, 0px);
    /* max-height, not the height rule below, accounts for the top safe
       area — see src/lib/ui/BottomSheet.svelte:214-225, the reference this follows.
       Without it, 92% of --app-height can still be a few px taller than
       the room actually available above the status bar, pushing the
       handle off the top of the screen. --demo-band-h is the browser
       demo's strip above the frame (global.css), 0px everywhere else. */
    max-height: calc(var(--app-height, 100dvh) - var(--safe-top) - var(--demo-band-h, 0px));
    transition: height var(--motion-sheet-open);
  }

  /* Fraction of --app-height, not a bare percentage, and not a per-detent
     CSS rule either. A bare height: 50%/92% resolves against the layout
     viewport, and a 390×844 phone with a 336px keyboard landed the sheet's
     top edge at y = -268: the handle and ~270px of content off-screen.
     --app-height is read from the VISUAL viewport, so sizing against it
     keeps the whole sheet on-screen keyboard or not, under either widget
     mode.

     The reason recorded here has now been wrong twice, in opposite
     directions, which is worth keeping as a warning about reasoning from
     the widget mode. It first said the layout viewport does not shrink for
     the keyboard and the margin-bottom lifts the sheet by the keyboard's
     height; that was true, then index.html asked for
     interactive-widget=resizes-content (74b6562d) and it was not. It then
     said --kb-overlay is 0 in that mode, so the lift is inert and this rule
     merely treats its symptom. That is false again on the device this ships
     to: Android 15 ignores adjustResize for targetSdk 35+, the layout
     viewport does NOT shrink, and --kb-overlay carries the whole keyboard
     height. The lift is live and load-bearing.

     What survived both reversals is the rule itself. Sizing against
     --app-height is correct in every mode, because --app-height is the
     visible band by definition — whether the browser shrank a viewport to
     produce it or the activity measured the IME. --detent-fraction is written
     inline from DETENT_FRACTION[detent] above (see the markup) — one rule
     here reads it rather than two rules each hardcoding one of the two
     numbers, so there is no second literal this file could let drift from
     the JS constant. data-detent stays, for styling hooks and tests. */
  .shell-sheet { height: calc(var(--app-height, 100dvh) * var(--detent-fraction, 0.5)); }

  .shell-sheet-handle {
    flex: 0 0 auto;
    height: var(--tap);
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: none;
  }

  .shell-sheet-handle::before {
    content: "";
    width: 2.25rem;
    height: 0.25rem;
    border-radius: var(--radius-sm);
    background: var(--hairline);
  }

  .shell-sheet-content {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    padding: 0 var(--space-4) var(--space-4);
  }
</style>
