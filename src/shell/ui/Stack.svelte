<!--
  A root's push stack: the screens that are live, and the interactive back
  the phone expects.

  Whether a drag commits is stack-back.js's decision — velocity first in
  both directions, distance only for a slow release — because "past 40%"
  alone strands a fast flick and "fast enough" alone strands a careful
  drag that changed its mind. That velocity was hardcoded 0 here for two
  phases, which made both of stack-back's velocity branches unreachable
  and left `dx >= width * 0.4` the only path it could ever take. A real
  edge flick travels 15-35% of the screen, so the gesture missed on the
  common case, not the edge case, with no nearby detent to soften the
  near-miss and the deepest muscle memory on the device to compete with.
  The stroke is measured now: Stack keeps its own {x, y, t} timeline and
  asks pointer-gesture.js at release.

  It keeps that timeline even though ShellRoot also tracks pointers and
  routes them through the ownership table. It is not an oversight: the
  alternative — taking velocityX as a prop fed from ShellRoot's onGesture
  — is always one gesture stale, because ShellRoot is an ancestor and
  pointer events bubble target-to-root, so this component's own pointerup
  runs first. That prop would pass a test that dispatches two strokes and
  fail every real first flick.

  P3 Task 1 is the "when one screen hosts both" this note was logged for,
  and the answer it settled is that the duplication STAYS and the second
  actor does not appear. `gestureOwner` reports "back" for the same stroke
  this component commits, and ShellApp deliberately performs nothing on it
  — the router recognises at pointerup, so it can neither make the screen
  follow the finger nor supply the drag-versus-width comparison that is
  the whole of stack-back.js. Two owners for one stroke is the bug class
  the table exists to end, and the table naming an owner this component
  already IS does not make it a second one. What the row buys instead is
  precedence: it is what stops an edge drag over a marked canvas resolving
  as the canvas's.

  ShellRoot no longer captures the pointer, which is what makes any of the
  above reachable. Its down() used to call setPointerCapture on
  `.shell-root`, and since that runs AFTER this component's own capture
  (events bubble target-to-root) it would have replaced it — every
  pointermove and pointerup of an edge drag would have been delivered to
  an ANCESTOR, where nothing travels back down, and this component's
  handlers would not have run at all.

  dx and velocityX both come off that one recognised stroke, never one
  from the stroke and one from the rendered drag position. Two numbers
  describing one gesture are two numbers that can disagree, and the
  disagreement commits a navigation on a distance the recogniser never
  saw.

  Only the root and the top two entries render. A stack ten deep holding
  ten live screens is ten scroll containers and ten editors; keeping
  exactly one beneath the top is what a back drag needs, so it reveals a
  real screen rather than a hole.

  THE ROOT STAYS ALIVE AT ANY DEPTH, and that is a data-loss fix, not a
  convenience. The root is a tab's base screen, and the page's root holds
  the editor. Under the plain top-two rule it unmounted at depth 3 — the
  page, the pins list, a pin — and came back on the pop as a REMOUNT from
  the host's load-time `page.content_json`: the writer's newest lines
  gone from the screen, and the next autosave ready to write that stale
  doc over them (ShellApp.test.js, "keeps what was typed on the page
  across a push that reaches the pin", which was red on exactly this).
  Every pin open walks that path since the second device pass. A live
  root also keeps its scroll, its caret and its debounced save, and is
  the instance a pin rename on the open page writes into rather than
  reaching for the database behind it. Three live entries, never more.
  That second live entry is also why .shell-stack-entry
  has to paint its own background: this header used to claim the top screen
  "covers the one beneath by DOM order alone", and it does not — DOM order
  decides paint order, not opacity, so both screens read through each other
  until an entry painted. See the rule below. The {#each} is keyed on entry.id: unkeyed, Svelte
  reuses the DOM across a push, so the incoming screen inherits the
  outgoing one's scroll offset and field state — which reads as "the app
  remembered something it shouldn't" and traces back to nothing.

  Whether the shell may draw an edge back at all comes from the platform
  profile and arrives as a boolean. On Android gesture navigation the
  system owns both edges, and a shell-drawn back there is the gesture that
  swung between firing on every scroll and never firing at all across the
  v0.6.x releases. This component never checks the OS itself; platform.js
  is the only place in the shell that does.

  dragActive is gestureOwner's first row, applied here rather than asked
  for: while a block is lifted, an edge drag must not ALSO mean back, or
  one motion loses both the block and the screen.

  Host contract: onPop must actually remove the top entry. A committed
  drag parks that entry a full width to the right and leaves it there,
  because it is the screen that just left — snapping it back to 0 first
  would flash it across the screen backwards for a frame before it
  unmounts. The offset is tied to the entry's id, so whatever is revealed
  underneath starts at 0 no matter what the screen above it was doing.

  One navstack entry per ELEMENT of `entries`, mounted or not. That reads
  like a detail and is the difference between back working and back
  closing a screen the user cannot see. The obvious version registers on
  mount, and mounting stopped tracking the stack the moment only the top
  two entries were kept alive: with [a,b,c,d], `b` unmounts and its close
  rewinds no history, because navstack rewinds only a TRAILING run of
  closed entries and `b` is not on top. Back then pops `d`, the host drops
  to [a,b,c], and `b` remounts and pushes a FRESH entry above `c` — so the
  next back closes `b`, the deeper screen, and leaves `c` open. Back
  closing the wrong screen is worse than back not working, because nothing
  on screen says what happened. `entries` is the stack; the mounted pair
  is a rendering optimisation, and registration follows the stack.

  Every element EXCEPT the first, and that exception is the same rule as
  the `depth < 2` guard in start(), not a second rule that happens to
  agree with it. A stack root is a tab's base screen: nothing is beneath
  it, so back there is not this shell's to answer — navstack already says
  so in as many words (navstack.js:112, "Empty stack: the OS owns back.").
  The edge gesture refuses to commit at depth 1 because a commit there
  would leave the shell showing nothing; registering the root would
  honour that identical intent when it arrives from the system button
  instead, and blank the shell on a press that should switch app or go
  home. One rule, two doors — refuse the gesture, register no entry.

  Spec §4 assigns this to Screen. It cannot live there and the spec is
  otherwise the authority, so the reason is written down rather than left
  implicit: a Screen cannot see the stack it is in, and what needs an
  entry each is every element of `entries` — not the two that happen to
  be alive.

  Back arrives two ways and both converge on one act: the HOST removing
  the element. Platform back pops the entry, navstack marks it closed and
  fires its onClose, which calls onPop; the edge gesture calls onPop
  directly. Either way the element leaves `entries`, and that departure is
  the single authoritative place the registration is closed. It closes
  unconditionally and does not need to know which direction it came from,
  because navClose looks its argument up as `e.id === id && !e.closed`
  (navstack.js:72) and returns on a miss — and handlePopState has already
  popped the entry off the array before onClose runs at all
  (navstack.js:106-110). Nothing here mirrors that with a flag: a flag
  would be a second copy of a property navstack already guarantees, free
  to drift from it silently, and the cost if the reading were wrong is a
  second history.go(-1) eating an unrelated entry. Stack.test.js pins the
  property in both orders instead of trusting the reading.

  Sheet.svelte does carry such a flag, for a case that cannot arise here:
  navPopAll fires onClose BEFORE marking its entries closed, and Sheet
  closes synchronously inside that callback. This component never does —
  the host's change to `entries` schedules the effect below, which runs on
  the next flush rather than re-entrantly inside navstack's own loop.

  A multi-entry departure — an unmount, a host resetting a tab's stack
  back to its root — rewinds history exactly once, and that is
  popTrailingClosed's doing rather than an ordering trick here. Departures
  are walked in `entries` order, shallowest first, because that is the
  order the Map was filled in. popTrailingClosed rewinds only a TRAILING
  run from the top of navstack's stack, so each shallow close is a no-op
  that leaves its entry marked closed, and the close of the true top then
  sweeps the whole accumulated run into a single history.go(-N). Walking
  deepest-first — which this comment used to claim, of a loop that never
  did it — would instead fire go(-1) N times, one popstate each. The order
  is therefore load-bearing, and Stack.test.js counts the calls rather
  than leaving the property described three times and pinned nowhere.
  navstack.test.js:90 shows the same shape from navstack's own side: B
  closed underneath C rewinds nothing, and C's close then rewinds both.
-->
<script>
  import { stackBackOutcome } from "../stack-back.js";
  import { recognise } from "../pointer-gesture.js";
  import { EDGE_PX } from "../gesture-owner.js";
  import { navPush, navClose } from "../../lib/navstack.js";

  /** @type {{
    entries?: {id: string, view: import("svelte").Snippet}[],
    edgeBackArmed?: boolean,
    dragActive?: boolean,
    onPop?: () => void,
  }} */
  let { entries = [], edgeBackArmed = true, dragActive = false, onPop } = $props();

  // The whole stack's size, of which only the root and the last two are
  // ever mounted.
  const depth = $derived(entries.length);

  // Top entry LAST, so DOM order paints it over the one beneath without
  // either leaving the flow — see the grid in the style block. The root
  // first, for the header's reason; at depth 1 and 2 the two spellings
  // are the same list.
  const live = $derived(entries.length > 2 ? [entries[0], ...entries.slice(-2)] : entries);

  let stackEl = $state(null);
  let dragFrom = $state(null);
  let dragAt = $state(0);
  // Measured once, at pointerdown. Reading clientWidth per sample would be
  // a forced layout on every pointermove of every drag, and the width
  // cannot change mid-stroke anyway.
  let dragWidth = $state(0);
  // Where the top entry rests between strokes: 0 after a cancel, a full
  // width after a commit (see the host contract in the header).
  let settledOffset = $state(0);
  let settling = $state(null);
  // Which entry that offset belongs to. Without it the number would be the
  // component's rather than the screen's, and the entry a pop reveals
  // would inherit the departing screen's full-width translate — a back
  // gesture that appears to empty the shell.
  let gestureId = $state(null);

  // The stroke in flight, and the finger that owns it. Plain `let`, as in
  // ShellRoot: nothing rendered reads either, and a $state array here
  // would invalidate the frame on every sample of every drag.
  let points = [];
  let activePointer = null;

  // entry.id -> the navstack id registered for it, in stack order (Map
  // keeps insertion order, and arrivals below are appended in `entries`
  // order). The root holds no record at all — see the header. Plain `let`
  // for the reason `points` is: nothing rendered reads it, and it must not
  // invalidate a frame.
  //
  // A record is kept even after navstack has closed the entry itself, and
  // dropped only when the element departs. That is deliberate — see the
  // header: every departure calls navClose unconditionally, and the
  // already-closed case is navClose's own no-op rather than a state this
  // component tracks in parallel.
  let navIds = new Map();

  function closeNav(id) {
    const navId = navIds.get(id);
    navIds.delete(id);
    if (navId !== undefined) navClose(navId);
  }

  // Registration follows `entries`, not the mounted pair. Idempotent by
  // construction: a host that rebuilds its array on every render (the
  // ordinary `entries={screens.map(...)}` shape) re-runs this with the
  // same ids and pushes and closes nothing.
  $effect(() => {
    // slice(1), not the whole array: the root's back belongs to the OS,
    // for the reason the header gives beside start()'s `depth < 2`.
    const ids = entries.slice(1).map((entry) => entry.id);
    const present = new Set(ids);
    // Departures first, in `entries` order — shallowest first, which is
    // what makes a multi-entry departure rewind ONCE: navstack defers the
    // close of an entry that is not on top, and the top's close then
    // sweeps the accumulated run into one history.go(-N). Reversing this
    // loop issues N rewinds instead (header, and Stack.test.js counts
    // them). Keys are snapshotted because closeNav mutates the Map.
    for (const id of [...navIds.keys()]) {
      if (!present.has(id)) closeNav(id);
    }
    // Arrivals bottom-up, so navstack's stack — and the history states
    // under it — come out in the same order as this one.
    for (const id of ids) {
      if (navIds.has(id)) continue;
      // The entry's own close is the platform-back path: navstack has
      // already popped it by the time this runs, and all that is left is
      // to tell the host, which removes the element and closes the
      // registration on the way past.
      navIds.set(id, navPush(id, () => onPop?.()));
    }
  });

  // Unmount. Separate from the effect above deliberately — Sheet's reason:
  // that one's teardown would run before each of its own re-runs, closing
  // every entry it is about to re-register. This one reads nothing
  // reactive, so it runs once and tears down once. Same shallowest-first
  // walk as the departure loop above, for the same reason: one rewind for
  // the whole stack rather than one per entry.
  $effect(() => () => {
    for (const id of [...navIds.keys()]) closeNav(id);
  });

  const dragOffset = $derived(
    dragFrom === null
      ? settledOffset
      : // Clamped at BOTH ends. Past `width` the screen keeps travelling
        // off the right edge; below 0 — a finger that lands on the edge
        // strip and moves left — it slides off the opposite side and
        // reveals the screen beneath from the wrong direction.
        Math.min(Math.max(dragAt - dragFrom, 0), dragWidth),
  );

  function offsetFor(entry) {
    return entry.id === gestureId ? dragOffset : 0;
  }

  function reset() {
    points = [];
    activePointer = null;
    dragFrom = null;
    dragAt = 0;
  }

  function start(event) {
    // gestureOwner's first row, in its order: a live block drag beats
    // everything, this included.
    if (dragActive) return;
    // Under two entries there is nothing to reveal. `depth` is
    // entries.length now, not a pushed-depth prop, so the root screen is
    // depth 1 and this bound is 2 — at 1 a commit would pop the shell down
    // to nothing at all. The registration effect refuses the same press
    // arriving from the system button by never giving the root an entry;
    // the header explains why these are one rule and not two.
    if (!edgeBackArmed || depth < 2) return;
    if (event.clientX > EDGE_PX) return;
    // One stroke at a time, first finger wins — ShellRoot's guard, for
    // ShellRoot's reason: a second finger appending to this timeline reads
    // as a jump, and a jump on the tail of the list is a flick that never
    // happened.
    if (activePointer !== null) return;
    // Capture, and only after the guards, or the events follow the finger
    // off the 24px edge strip and the gesture dies mid-swipe on a device —
    // invisibly to jsdom, which dispatches straight at the element
    // whatever the pointer really did. Capturing a pointer whose events we
    // then drop would steal the rest of that stroke from whatever the
    // finger is actually on.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    activePointer = event.pointerId;
    gestureId = live[live.length - 1]?.id ?? null;
    settling = null;
    settledOffset = 0;
    dragWidth = stackEl?.clientWidth ?? 0;
    dragFrom = event.clientX;
    dragAt = event.clientX;
    points = [{ x: event.clientX, y: event.clientY, t: event.timeStamp }];
  }

  function move(event) {
    if (activePointer === null || event.pointerId !== activePointer) return;
    dragAt = event.clientX;
    points.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
  }

  function end(event) {
    if (activePointer === null || event.pointerId !== activePointer) return;
    points.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
    const stroke = points;
    const width = dragWidth;
    reset();

    const { dx, velocityX } = recognise({ points: stroke, edgePx: EDGE_PX });
    const outcome = stackBackOutcome({ dx, width, velocityX });
    settling = outcome;
    settledOffset = outcome === "commit" ? width : 0;
    if (outcome === "commit") onPop?.();
  }

  // A cancelled pointer commits nothing. The OS took the stroke — a system
  // edge gesture, a call arriving — and popping a screen out from under a
  // finger that never finished the gesture is the worst version of this
  // bug, because the user cannot even tell what they did.
  //
  // The guard is `||`, exactly as in move and end, and the difference is not
  // stylistic. Written `activePointer !== null && …` it is FALSE whenever no
  // stroke is in flight — which is most of this component's life — so the
  // body ran for every cancelled pointer anywhere beneath this container,
  // whatever finger it belonged to. This div wraps the whole screen, and a
  // scroll the browser reinterprets mid-gesture (ordinary on iOS) fires a
  // cancel that bubbles here from an editor or a list. That wiped
  // settledOffset to 0, and a just-committed entry still parked at
  // translateX(width) awaiting the host's onPop snapped back across the
  // display for a frame — the exact flash the settle-by-id design above
  // exists to prevent.
  function cancel(event) {
    if (activePointer === null || event.pointerId !== activePointer) return;
    reset();
    settling = "cancel";
    settledOffset = 0;
  }
</script>

<!--
  The stack is a container that also listens for an edge gesture; it is not
  itself an interactive control, so it gets no role. The gesture is a
  redundant shortcut, not the only way back: NavBar renders a labelled back
  button whenever a screen supplies onBack, and platform back (Android
  system back, Esc on web) routes through navBack() regardless. Suppressing
  the warning therefore costs assistive tech nothing — which is the test for
  whether an ignore is honest, rather than "another component does it".

  Deliberately NOT aria-hidden: unlike Sheet's decorative handle, this
  element holds every screen in the stack. Hiding it would hide them all.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="shell-stack"
  bind:this={stackEl}
  data-depth={depth}
  onpointerdown={start}
  onpointermove={move}
  onpointerup={end}
  onpointercancel={cancel}
>
  {#each live as entry, i (entry.id)}
    <div
      class="shell-stack-entry"
      class:dragging={dragFrom !== null && entry.id === gestureId}
      data-entry={entry.id}
      data-top={i === live.length - 1 ? "true" : null}
      data-settle={entry.id === gestureId ? settling : null}
      style="transform: translateX({offsetFor(entry)}px)"
    >
      {@render entry.view()}
    </div>
  {/each}
</div>

<style>
  /* One grid cell, both live entries in it: the top screen covers the one
     beneath by DOM order alone. Absolute positioning would stack them the
     same way and is how every earlier phone pass ended up painting
     controls over prose — a stacking context that costs nothing to reach
     for is one that gets reached for. */
  .shell-stack {
    display: grid;
    grid-template-areas: "screen";
    flex: 1 1 auto;
    min-height: 0;
    /* The dragged screen travels up to a full width rightward. Without
       this it widens its own container on the way out. */
    overflow: hidden;
  }

  .shell-stack-entry {
    grid-area: screen;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    /* An entry PAINTS. Without this the shell's pushed screens were
       transparent and unreadable: two entries share one grid cell (see
       `live` above), .shell-root paints --canvas-bg once for the frame,
       and nothing between it and a screen painted anything — so memory's
       nav bar, search field, mode segment and every timeline row showed
       THROUGH the reading view's writing, letter over letter.

       This file's own header used to say the top screen "covers the one
       beneath by DOM order alone". DOM order decides paint ORDER; it does
       not make a transparent element opaque. Corrected there.

       Every model assertion passed while it was broken — rows, values,
       the back control's 44px, the emptied slot, zero contenteditable —
       because jsdom applies no scoped stylesheet and has no compositing.
       The VR states for the five pushed screens are what hold it, which
       is why they were committed red rather than photographed. */
    background: var(--canvas-bg);
    /* The settle after the finger lifts: this is the spring back, the rule
       below is the slide out.

       No `var(--spring)` after either token, deliberately. Both motion
       tokens already END in an easing function (global.css), and the
       transition shorthand accepts exactly one — a second makes the whole
       declaration invalid, so it is DROPPED rather than partly applied.
       Verified in chromium: `transition: transform 220ms cubic-bezier(...)
       cubic-bezier(...)` computes to the initial `all`, i.e. no transition
       at all. That failure is silent on a device — the animation simply
       never runs and nothing appears in the console — which is why this is
       written down rather than left to whoever next reaches for --spring.

       Both tokens collapse to 0ms under reduced motion (global.css), which
       is what the VR harness drives, so there is no separate rule here for
       it. */
    transition: transform var(--motion-swipe-cancel);
  }

  .shell-stack-entry[data-settle="commit"] {
    transition: transform var(--motion-swipe-commit);
  }

  /* While the finger is down there is no transition at all. An easing
     curve between samples is the screen lagging the thumb, which is the
     one thing "follow the finger" means not doing. */
  .shell-stack-entry.dragging {
    transition: none;
  }
</style>
