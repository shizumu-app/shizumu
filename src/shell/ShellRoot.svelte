<!--
  The shell's frame, and the only thing in it that knows about insets.

  Five mobile passes produced the same two bugs over and over: a surface
  that re-added the safe-area inset its parent had already added (memory's
  list sat ~50px too low for a release), and chrome that stacked at the
  bottom because two components each thought they owned that space. Both
  are structural, so the structure answers them: the root subtracts
  --safe-* and --slot-h exactly once, and every screen inside it is
  inset-blind. src/shell/__tests__/shell-rules.test.js fails the build if
  any other shell file reaches for the raw inset function instead of the
  --safe-* tokens.

  It is also where the single viewport owner is started. keyboard-state.js
  is the app's only subscriber to the visual-viewport API, and it writes
  --kb-inset and --app-height onto documentElement; the shell consumes
  those and never writes them. Starting it here means no screen has a
  reason to.

  Both rules are named obliquely on purpose. The scans that enforce them
  are plain substring checks over every file in src/, so spelling either
  literal in this comment would make it their first offender — which is a
  known, accepted property of those guards: they fail closed on prose, and
  a guard that fails closed costs a reworded sentence where one that fails
  open costs a release.

  It is also the shell's one gesture router, for the same structural reason
  it is the one inset owner. gesture-owner.js has held the ownership table
  since P1a with fourteen tests and no caller, while Stack kept a private
  copy of what "left-edge" means and Sheet kept its own idea of the
  sheet-content row — two owners of one rule, which is precisely the drift
  that table exists to end. The consequence was not theoretical: the
  table's FIRST row (a live block drag beats everything) could not be
  enforced at all, because nothing that owned a gesture had a dragActive
  input, so a block lifted near the left edge would arm back at the same
  time and one motion would lose both the block and the screen.

  So the root recognises the stroke and asks the table who owns it. What
  it does NOT do is decide: dragActive, atScrollTop, atScrollBottom, space,
  edgeBackArmed and editing all arrive as props and are passed
  straight through. The root must never read the OS, the viewport, or a
  scroller to fill one in — edgeBackArmed in particular comes from
  platform.js, the shell's only reader of the platform, and a root that
  sniffed a user-agent here would quietly become a second one.

  That rule covers precedence too, which is the harder half of it. The
  first version of this router folded "the stroke started at the left edge"
  into the same region string as "the finger landed on a marked element",
  which meant picking a winner between them right here, in a line no test
  of the ownership table could reach. It picked the marker, and edge-back
  died on the first screen that marked a full-bleed canvas. Both facts now
  go to the table as separate inputs — region and atLeftEdge — and the
  table orders them, because ordering competing claims is the entire job it
  exists to do and this file exists only to hand it the evidence.

  Flow vs fixed, for the keyboard inset specifically. This used to point
  at the desktop's what-settled strip, which stated the same rule at its
  own use site; that surface is gone (CLAUDE.md, "Removed surface"), so
  the rule is stated in full here, and keyboard-state.js's header on
  `--kb-inset` versus `--app-height` is the other place it lives.
  `--app-height` IS the visible viewport: it already excludes the soft
  keyboard, because it is written from the visual-viewport API's height
  (keyboard-state.js). `.shell-
  root` sizes to it, so anything in normal flow inside the root — which
  includes `.shell-slot`, a flex child, not an overlay — is already sitting
  above the keyboard by construction. Adding `margin-bottom: var(--kb-
  inset)` there does not nudge it into place; it lifts it a second full
  keyboard-height off an already-keyboard-clear frame.

  The sentence that used to end this paragraph — that a `position: fixed`
  surface outside the box "has to re-supply the offset itself" with
  `var(--kb-inset)` — was wrong, and Sheet followed it off the top of the
  screen. Fixed positioning resolves against the VIEWPORT, and whether
  that already excludes the keyboard depends on which viewport the browser
  shrank: under interactive-widget=resizes-content (index.html, 74b6562d)
  the layout viewport shrinks and `bottom: 0` is already clear. A fixed
  surface reads `--kb-overlay` (keyboardOverlayPx, keyboard-state.js),
  which is the part of the keyboard the layout viewport did NOT take: 0
  here, the keyboard's height on iOS. `--kb-inset` stays the keyboard's
  height, for flow-level boxes that reserve space by it.
-->
<script>
  import { onMount } from "svelte";
  import { startKeyboardState } from "../lib/keyboard-state.js";
  import ViewportReadout from "./ui/ViewportReadout.svelte";
  import { readoutWanted } from "./viewport-readout.js";
  import { gestureOwner, EDGE_PX } from "./gesture-owner.js";
  import { recognise } from "./pointer-gesture.js";

  /** @type {{
    hasStrip?: boolean,
    hasNav?: boolean,
    startViewport?: (win?: Window) => (() => void),
    dragActive?: boolean,
    atScrollTop?: boolean,
    atScrollBottom?: boolean,
    space?: "page"|"memory"|string,
    edgeBackArmed?: boolean,
    editing?: boolean,
    onGesture?: (g: {
      owner: string, gesture: string,
      velocityX: number, velocityY: number, dx: number, dy: number,
    }) => void,
    children?: import("svelte").Snippet,
    slot?: import("svelte").Snippet,
  }} */
  let {
    hasStrip = false,
    hasNav = false,
    startViewport = startKeyboardState,
    dragActive = false,
    atScrollTop = false,
    atScrollBottom = false,
    space = "page",
    edgeBackArmed = true,
    editing = false,
    onGesture,
    children,
    slot,
    nav,
  } = $props();

  /** THE BAND IS TWO ROWS, and the nav is the lower one.
   *
   *  It used to be one row that navigation and the editor took turns
   *  owning, and a Galaxy A34 showed what that costs. Its webview froze
   *  every viewport-height API at the keyboard-up value and never restored
   *  them, so the shell believed a keyboard was up for the rest of the
   *  session, the editor strip held the slot, and page / memory / settings
   *  were gone until the app was restarted. Navigation is not a mode now;
   *  `nav` renders whenever toolbarFor says so, which is everywhere except
   *  a gate and an overlay.
   *
   *  THE STRIP IS THE UPPER ROW, and that is load-bearing rather than
   *  aesthetic. It anchors the nav to the band's bottom edge, so when the
   *  strip leaves — which a nav tap itself causes, since TabBar does not
   *  preventDefault on pointerdown and so blurs the editor — the band
   *  shrinks upward and the tab stays under the thumb between pointerdown
   *  and click. The other order moves the control mid-tap.
   *
   *  WHAT IT COSTS: 1rem is 14px at the phone's --ui-scale, so --slot-h is
   *  45.5px and the two-row band is 89px. On a 740px screen with a 320px
   *  keyboard that takes the writing band from ~327px to ~283px: thirteen
   *  lines of prose to eleven. Nothing is folded away to pay for it —
   *  taking controls away on a keyboard belief is the bug class this
   *  removes, and nav-collapse.js already refused that trade in writing.
   *
   *  Explicit booleans rather than `{#if slot}`: ShellApp declares both
   *  snippets unconditionally, so a presence test is always true and would
   *  render an empty bordered row. */
  const hasBand = $derived(hasStrip || hasNav);

  onMount(() => startViewport());

  /** One build's diagnostic, off everywhere else — ViewportReadout's
   *  header says why it exists and why it is a build flag rather than a
   *  setting. Read once: a flag that could change under a running app
   *  would be a second thing to reason about in the file that reasons
   *  about the frame. */
  const readout = readoutWanted();

  // The stroke in flight. Deliberately plain `let`, not $state: nothing
  // rendered reads any of these, and a $state array here would invalidate
  // the whole frame on every pointermove of every drag — a re-render per
  // sample, on the one component every screen lives inside.
  let points = [];
  let activePointer = null;
  let downRegion = null;

  function reset() {
    points = [];
    activePointer = null;
    downRegion = null;
  }

  // THE FRAME CAPTURES NO POINTER, and that is a decision rather than an
  // omission — it is the one thing P3 Task 1 had to settle before the
  // router could be switched on at all.
  //
  // This function used to open with
  // `event.currentTarget.setPointerCapture(event.pointerId)`, on Sheet's
  // and Stack's precedent. Both of those are RIGHT to capture: a sheet
  // handle is --tap tall and the stack's edge strip is EDGE_PX wide, so a
  // real drag leaves the element it started on within a few samples and
  // the rest of the stroke would route to whatever is under the finger
  // instead. Neither reason survives being moved to this element. `.shell-
  // root` is `position: fixed; inset: 0` — it IS the viewport — so every
  // pointer event a finger on this screen can produce already bubbles
  // here. There is no "off the element" to protect against, and capture
  // buys the root nothing.
  //
  // What it costs is exact, and Stack is the proof rather than the
  // editor. Capture retargets dispatch to the capturing element, and a
  // second setPointerCapture REPLACES the first — so Stack, whose
  // pointerdown runs first (events bubble target-to-root) and which
  // captures `.shell-stack` for its edge-back drag, would have that
  // capture taken away by this line a moment later. Its pointermove and
  // pointerup would then be delivered to `.shell-root`, which is an
  // ANCESTOR: a retargeted event never travels back down, so Stack's own
  // handlers would not run at all. The screen would stop following the
  // finger and no back would ever commit. The same reasoning is what
  // PageScreen's gutter header predicted for the editor and answered by
  // listening on `window` — events still propagate up from the capture
  // target, so a window listener hears the stroke either way, and a
  // listener on a DESCENDANT does not.
  //
  // The trade, said plainly rather than left to be met: without capture, a
  // MOUSE drag released outside the window produces no pointerup anywhere,
  // so `activePointer` stays set and the router ignores every later
  // stroke. A finger cannot do that — it leaves the glass as a pointerup
  // or a pointercancel — and this is a phone tree, so the exposure is a
  // desktop browser narrowed to phone width. That is worth a stuck router
  // in a non-target environment; the alternative was a dead edge-back
  // gesture and a dead block drag on every device.
  function down(event) {
    // Nothing to route to.
    if (!onGesture) return;
    // One stroke at a time, first finger wins. Without this the entry point
    // overwrote activePointer on any second pointerdown, so a pinch or a
    // palm landing mid-drag silently threw away the first finger's stroke —
    // no gesture ever emitted for it — and re-pointed tracking at a finger
    // that never started a gesture. Taking over is worse, not better: the
    // first finger's pointerup would then die on the id check below, and the
    // second finger's stroke would begin from a mid-drag position and resolve
    // as a phantom short gesture from coordinates nobody aimed.
    if (activePointer !== null) return;
    activePointer = event.pointerId;
    // The region is read at pointerdown, from where the finger LANDED. Read
    // at pointerup it would be wherever the finger ended up, which for
    // every gesture the table arbitrates is a different element than the
    // one that owns it.
    downRegion = event.target?.closest?.("[data-shell-region]")?.dataset?.shellRegion ?? null;
    points = [{ x: event.clientX, y: event.clientY, t: event.timeStamp }];
  }

  // Every handler here checks the pointer id, not just "is a stroke open" —
  // and so does down(), which refuses a second finger outright rather than
  // adopting it. A second finger landing mid-drag would otherwise append its
  // own coordinates to the first finger's timeline, and the jump between them
  // reads as a flick that never happened — pointer-gesture.js measures
  // velocity off the tail of exactly this list.
  function move(event) {
    if (activePointer === null || event.pointerId !== activePointer) return;
    points.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
  }

  function up(event) {
    if (activePointer === null || event.pointerId !== activePointer) return;
    points.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
    const stroke = points;
    const landedIn = downRegion;
    reset();

    const g = recognise({ points: stroke, edgePx: EDGE_PX });
    // Two facts, reported separately, because they are separate: what the
    // finger landed ON, and WHERE on the screen it started. Which of them
    // outranks the other is the table's call, not this function's — see
    // gesture-owner.js's header, and the paragraph above about the root
    // routing rather than deciding.
    //
    // Collapsing them into one region string here is exactly what shipped
    // and had to be undone: a marked region beat the geometry, so the first
    // full-bleed canvas to mark itself swallowed every stroke that started
    // at the edge and back died on it. The bug was not the precedence that
    // was chosen; it was choosing one here at all, where no test of the
    // table can see it. "element" is the table's own name for a spot the
    // shell has not claimed.
    const region = landedIn ?? "element";
    const owner = gestureOwner({
      region,
      atLeftEdge: g.region === "left-edge",
      gesture: g.gesture,
      dragActive,
      atScrollTop,
      atScrollBottom,
      space,
      edgeBackArmed,
      editing,
    });
    onGesture({
      owner,
      gesture: g.gesture,
      velocityX: g.velocityX,
      velocityY: g.velocityY,
      dx: g.dx,
      dy: g.dy,
    });
  }

  // A cancelled pointer emits nothing. The OS took the stroke (a system
  // edge gesture, a call arriving); reporting an owner for a gesture the
  // user never finished is how a screen pops itself while the finger is
  // still down.
  function cancel() {
    reset();
  }
</script>

<!--
  The frame listens for pointers but is not itself a control: every gesture
  it routes has a visible, focusable equivalent elsewhere (NavBar's back
  button, the tab bar, the sheet's own handle), so suppressing the static-
  interaction warning costs assistive tech nothing here — which is the test
  for whether an ignore is honest, rather than "Stack does it too".
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="shell-root"
  class:has-slot={hasBand}
  class:dragging={dragActive}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={cancel}
>
  {#if readout}
    <!-- FIRST INSIDE THE FRAME, in the flow: its own box is then the
         frame's top, which is the measurement the iOS report is missing
         (ViewportReadout's header). -->
    <ViewportReadout />
  {/if}
  <div class="shell-content">
    {#if children}{@render children()}{/if}
  </div>
  {#if hasBand}
    <div class="shell-slot">
      {#if hasStrip}
        <div class="shell-slot-strip">{#if slot}{@render slot()}{/if}</div>
      {/if}
      {#if hasNav}
        <div class="shell-slot-nav">{#if nav}{@render nav()}{/if}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* The frame is fixed so the content band can scroll under a keyboard
     without dragging the chrome with it. This and Sheet are the only two
     files the rules test allows position: fixed. */
  .shell-root {
    position: fixed;
    inset: 0;
    /* THE FRAME FOLLOWS THE VISIBLE BAND, not the layout viewport's top.
       A fixed box is pinned to the layout viewport; when the keyboard
       shrinks only the visual one, the browser pans the visible band down
       inside it to reveal the caret, and a frame left at top 0 rides off
       the top of the screen by that pan — the header under the status
       bar, and the same distance of bare canvas between the editor strip
       and the keyboard. Both were photographed on one Android 15 phone in
       the second device pass, and only when the caret sat low enough to
       need revealing, which is why it read as "sometimes".
       keyboard-state.js measures the pan (it is the only file allowed to)
       and publishes it; this is 0px whenever nothing has panned, which is
       every frame with the keyboard down and every device that resizes
       its layout viewport instead. `bottom: auto` because the height
       below is the band's own, and `inset`'s bottom would fight it. */
    top: var(--vv-offset-top, 0px);
    bottom: auto;
    display: flex;
    flex-direction: column;
    height: var(--app-height, 100dvh);
    /* --demo-band-h is 0px outside the browser demo (global.css); in the
       demo it is the strip's band at the top, which the frame steps under
       rather than lets cover its header. */
    padding-top: calc(var(--safe-top) + var(--demo-band-h, 0px));
    padding-left: var(--safe-left);
    padding-right: var(--safe-right);
    background: var(--canvas-bg);
    color: var(--ink);
    font-family: var(--font-ui);
    overflow: hidden;
  }

  /* Spec §2: the content band is padded by the root on top / bottom / slot.
     With a slot, .shell-slot's own padding-bottom below covers the bottom
     safe area. Without one — every pushed Screen, every screen with a
     sheet open — nothing else in the frame accounts for it, so the root
     pads it directly. Skipping this left the last row of content running
     under the iOS home indicator whenever hasSlot was false. */
  .shell-root:not(.has-slot) {
    padding-bottom: var(--safe-bottom);
  }

  /* A live block drag, on the frame. Two jobs, and the second is why it
     is a class rather than a variable nothing can see.

     What it DOES: a drag that also selects text leaves the writer holding
     a lifted block and a blue smear across three paragraphs, and on a
     phone there is no second click to clear it. The frame is the only
     element that covers every surface a drag can travel over, so the
     suppression belongs here.

     What it also does, said plainly rather than left as an accident:
     `dragActive` is otherwise a prop handed to a pure function, invisible
     to every assertion in the tree. That is exactly how gestureOwner's
     first row sat inert for three phases with fourteen tests over it —
     nothing could tell a producer that worked from one that never fired.
     One class makes the whole chain — handle, PageScreen, ShellApp, this
     prop — assertable end to end. */
  .shell-root.dragging {
    user-select: none;
    -webkit-user-select: none;
  }

  .shell-content {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* --slot-h is the floor for a ONE-row band and keeps its meaning; a
     two-row band exceeds it on content, which is why there is no
     --slot-h-2. A token asserting "two rows" would go stale the day a
     third kind of row appears, and min-height is already a floor.

     --safe-bottom is paid HERE and nowhere below: once, under both rows.
     The rows live in this element's content box and must never mention
     the inset — that is the double-counting rule in CLAUDE.md, and
     shell-rules.test.js checks it by reading this file. */
  .shell-slot {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    min-height: var(--slot-h);
    padding-bottom: var(--safe-bottom);
    border-top: 1px solid var(--hairline);
    background: var(--canvas-bg);
  }

  /* The rows take their height from the frame rather than from a
     percentage inside them: a column flex with an auto height resolves a
     child's `height: 100%` against an indefinite height, which is engine
     territory jsdom cannot see. --tap is the 44px floor the whole shell
     sizes from. */
  .shell-slot-strip,
  .shell-slot-nav {
    flex: 0 0 auto;
    min-height: var(--tap);
  }

  .shell-slot-strip + .shell-slot-nav {
    border-top: 1px solid var(--hairline);
  }
</style>
