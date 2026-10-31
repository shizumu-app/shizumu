<!--
  The page root's frame: the editorial header in the nav band, the "what
  matters now" title zone at the top of the content band, and the canvas
  below it. The canvas IS the editor — EditorCore, imported from
  src/components/editor/ and mounted as-is, the same headless core the
  desktop chrome (TipTapEditor.svelte) hosts. Nothing in src/components/
  is edited to make that work; the split in P0 is what earns it.

  The mount is conditional on `page` and that is the whole first frame.
  ShellApp renders before its load resolves, so for one frame there is no
  row: pageId would be undefined, initialContent would be undefined, and
  the editor would mount against nothing and then be handed a different
  page a tick later. An empty canvas until the row lands is both cheaper
  and honest.

  This is nav-collapse.js's first caller since it was written. The rule
  itself lives there and stays there; what this file owns is the one thing
  a pure module cannot own — feeding its own last answer back in.

  That feedback is the whole hysteresis band. navCollapsed collapses at
  24px and expands below 8px, and BETWEEN those two numbers it returns the
  `collapsed` it was handed. Hand it a literal and the band silently
  degrades to a single threshold: the header then flips on every frame a
  scroll position hovers on the line, which is the 1px jitter a soft
  keyboard produces on every keystroke, and every layout that reads the
  header's height jitters with it. The unit test for the band cannot catch
  that — it passes the argument itself — so the proof lives in
  PageScreen.test.js, driven by real scroll events.

  Order of the two writes in handleScroll does NOT matter, which is worth
  saying because it looks like it should. navCollapsed is idempotent at a
  fixed scroll position — past 24 it answers true whatever the memory says,
  below 8 false, and inside the band it hands the memory straight back — so
  applying it twice at one position equals applying it once, and the band
  lands on the same answer either way. Checked by reversing the two lines
  and running the suite rather than by reasoning about it: 4 passed,
  unchanged.

  This comment used to claim the opposite, that reading the memory before
  the new scrollTop landed was load-bearing. That was wrong, and a false
  why-comment is worse than none: it invents a rule about Svelte
  reactivity and makes the next reader careful in a place needing no care.

  The title zone sits in the content band, not the nav band, and that is a
  decision rather than an accident (spec §2 puts it below the nav bar, and
  only the nav bar collapses). In the nav snippet it would be pinned above
  the fold forever — a line of chrome the writer scrolls past all day. It
  is a title: it belongs to the page, so it scrolls with the page.

  WHAT IS DELIBERATELY NOT PASSED TO THE EDITOR, and why each absence is
  the honest answer rather than an oversight. EditorCore defaults every
  callback to a no-op, so leaving one off costs nothing; passing a no-op
  of our own would be a silent feature loss dressed as wiring. The shell
  has nowhere to put a toast, a sheet or a destination until P2f, so:

    onPinCreated     desktop refreshes its pin count and panel
    onWordCount      desktop's footer counter
    onDocChange      desktop keeps the doc for its pins panel
    onCreateSubtrail desktop creates a trail from an @-menu entry
    onMentionNavigate / onPinRefNavigate  desktop navigates the page
    onNotice         desktop shows a transient notice
    onUpdate / onFocus / onBlur / onTransaction
                     desktop chrome's hooks; the shell grows its own
                     chrome across P2d-P2e and takes these then

  onChartOpen left that list in P2f-2 Task 5, and it is the first one to
  leave for the reason the list gave for withholding it — "the shell has
  nowhere to put a sheet" stopped being true. It is forwarded to the host
  rather than answered here, like onEditor and for the same reason: what it
  opens is a Sheet, and Sheets are siblings of the frame that ShellApp
  owns. It carries both of the editor's chart routes, the slash command's
  `{mode: "create"}` and a tap on an existing chart's `{mode: "edit", pos,
  attrs}` — and the second one is why the absence mattered more than the
  list suggested: without it a phone could hold a chart it could see and
  not open.

  onSelectionUpdate left that list in P2b: it is what keeps the caret off
  the keyboard. onEditor leaves it now, in P2c, and it is not a chrome
  hook — it is the HANDLE the bottom slot's buttons run their commands on.
  It is forwarded whole to the host, one band up, because that is where
  the slot lives. It is also KEPT here as of P2d — the gutter handle asks
  the editor's view which DOM node the active block is, and that is the
  only member of it this file reads. The header used to say "nothing in
  this file calls it"; that stopped being true rather than stopped being
  written down.

  floatingChrome IS passed, false, and it is the one prop here that says
  something rather than withholding it. Spec §3 refuses three surfaces —
  no bubble menu, no floating slash/mention menu, no floating `+` widget —
  and the shell inherited all of them by sharing buildEditingExtensions
  with the desktop. This is where they are refused.

  What false does, read off shared-extensions.js rather than off the name:
  TouchBlockHandle is omitted outright, and SlashCommands and
  MentionCommand are KEPT with `floatingMenu: false`, which swaps their
  `render` for silentSuggestionRender and leaves pluginKey, char, command,
  items and the plugin's active/range/query state untouched.

  That distinction is the whole seam and it cost a wrong first attempt to
  find. Dropping all three reddens all seven of "ShellApp — the suggestion
  strip", because `SlashCommandsPluginKey.getState(state)` IS what
  computeSnapshot reports as `snapshot.query` (editor-snapshot.js:25) and
  the chips are derived from nothing else: no chips for `/head`, and the
  two liveness guards throw on a plugin key with no state at all. The
  extension is the query state machine as well as the floating menu. The
  shell needs the PLUGIN and refuses the RENDERER, and one boolean could
  not express that until src/lib grew `floatingMenu` to say it.

  MentionCommand goes silent rather than absent for the same reason: its
  live `@` query is what the chip strip reads, and ShellApp fills the
  strip with mention chips from the extension's own `mentionItems`
  (mention-chips.js), so `@` on the phone finds what it finds on the
  desktop, laid flat instead of floating.

  THE GUTTER HANDLE LIVES HERE, not in ShellApp, and the choice was
  between two real options rather than obvious. ShellApp holds the
  snapshot and will hold the sheet, so it is where the handle's ACTION
  ends up. But the handle is not an action, it is a column in the content
  band: ShellRoot's slot snippet is a SIBLING of that band, so nothing
  ShellApp renders can sit beside a block — it would have to reach back
  down through a prop, and the thing it reached down with (activeBlock)
  is produced HERE and sent up in the first place. So the handle renders
  here and the tap goes up through onBlockHandle, which is the same shape
  the editor and the snapshot already take: this file owns where chrome
  sits in its own band, the host owns what chrome does.

  WHY THE GUTTER IS PADDING AND NOT AN OVERLAY. src/lib/editor/
  handle-placement.js was deleted from this repo for existing only to
  place a floating block-handles bar — the fallback phones got when the
  editor's gutter was taken away on small screens — and that layout was
  removed as "the root of a long run of controls-over-content bugs".
  Nothing here revives it: the canvas reserves the handle's column in its
  own left padding, so no text can be laid out under the handle at any
  width. The handle cannot land on prose because there is no prose where
  it lands.

  THE INSET IS ONE TOUCH TARGET, and the number is not invented. Spec §2
  gives the canvas "20px side padding, a 24px gutter" — 44px from the
  band's edge to the first character, which is exactly what var(--tap)
  resolves to — that token is defined in global.css as the 44px floor
  under the scaled touch token, and naming the scaled one here, even in
  prose, is what shell-rules.test.js scans for (it reads comments too;
  this paragraph tripped it once). So the handle's 44px box, flush left,
  ends where the text begins. Any narrower
  inset and the difference is not cosmetic: a 44px target in a 40px inset
  eats the first 4px of every line of the block the writer is editing —
  the tap that was meant to put the caret at the start of the line goes
  to the handle instead. The right padding stays var(--space-4), which
  makes the column asymmetric; the desktop gutter accepted the same trade
  in the same words (TipTapEditor's .tiptap-wrapper), because colliding
  chrome is a functional bug and the reclaimed width is cosmetic.

  The one thing the gutter moved that P2d did not intend — the "what
  matters now" zone left at var(--space-4), 30px left of the prose under
  it — is PAID as of P2f Task 4, and the argument is at .ps-wmn in the
  style block rather than repeated here. P2d deferred it to a screenshot;
  what closed it instead is what the zone IS. It is this page's title, and
  a title that does not share the text column with its body reads as a
  misalignment rather than as a margin.

  HOW THE HANDLE FINDS ITS BLOCK, and why this is not the deleted shape
  wearing a new name. The offset is one subtraction between two boxes in
  the SAME scroller — the block's and the canvas's — so it is a position
  inside the canvas, not a viewport coordinate: scrolling moves both
  boxes together and the answer does not change, which is why nothing
  here subscribes to scroll. (Desktop's equivalent adds wrapperEl
  .scrollTop because ITS wrapper is the scroller. Ours is not; Screen's
  content band is, one level up. Copying that line across would offset
  the handle by the whole scroll position.)

  IT IS RE-RESOLVED ON EVERY SNAPSHOT, which is the whole of Step 4 and
  is not decoration. The desktop tree has a live defect of exactly this
  shape: its touch gutter toolbar is populated on a TAP
  (revealBlockHandlesOnTouchTap) and never re-resolved when the selection
  moves, so pressing Enter and carrying on typing leaves it parked beside
  the block you left, acting on the wrong one. EditorCore republishes the
  snapshot on every transaction, so deriving the handle from the snapshot
  — rather than from a tap, or caching the first answer — is what makes
  the handle follow the caret. Broken twice to find out which test is
  really holding it, because the first break was blunt: freezing the
  derived's whole answer takes 2 of the 4 down (2 failed | 24 passed) —
  but for the wrong reason, since a closure that stops READING
  lastSnapshot also stops depending on it, so the derived never runs
  again and the boxes these tests stub after mount never land at all.
  The sharp break is the desktop defect itself: keep re-measuring, but
  resolve the BLOCK once (`stuckBlock ??= snapshot.activeBlock`).
  Exactly one test sees that — "moves the handle to the block the caret
  moves to", 1 failed | 25 passed, expected "160px", received "40px" —
  and it is the only one that moves the caret, which is why.

  What this does NOT do, said before someone reads it as intent: the
  44px box is anchored at the block's TOP, so beside a one-line
  paragraph the glyph sits low against the line and the box hangs into
  the next block's stretch of gutter. Centring it would need the block's
  height and a rule about tall blocks (a board is 200px; its handle
  belongs at the top, not at its middle), which is a decision, and
  decisions belong in a pure module rather than in an arithmetic
  expression in a component. Left as the simple anchor until a
  screenshot says it needs the rule.

  THE EDITOR IS HANDED UP WHOLE, which is the opposite of what Screen does
  with its scroll container, and the two are worth reading side by side
  before either is called inconsistent. Screen keeps its element private
  and lends bounds() and scrollBy() because that element is its own
  private DOM: a parent holding it could style it, query inside it, or
  bind a second listener, and the first reader to copy
  `querySelector(".shell-screen-content")` turns a private class name into
  an API nobody can rename. The editor is not this file's private
  anything. It is EditorCore's public instance, the same object the
  desktop host holds, and WHICH command each toolbar id runs is the host's
  decision — lending verbs instead of the instance would mean choosing
  them here, in the file that renders no toolbar.

  THE SNAPSHOT ARRIVES BY bind:this, and the alternative was real rather
  than hypothetical. `snapshot` is `export const snapshot = writable(...)`
  on the EditorCore instance (EditorCore:97), so it is a component export,
  and in Svelte 5 a component export is reachable only through a binding —
  there is no prop and no callback that carries it. The other route was
  onEditor plus a computeSnapshot(editor) of our own, recomputed off the
  editor's transaction event. Both work; this one was taken because:

    - the store already IS the answer EditorCore computes on every
      transaction (EditorCore:236). Recomputing it here would be a second
      copy of one truth, re-derived per keystroke, free to drift the
      moment either side changes what a snapshot holds — which is the
      exact shape of P1a's dead suggestion strip, where two sides agreed
      on a name and disagreed on a field;
    - it is what the other host does. TipTapEditor:2155 binds the same
      instance for the same surface, so the core's state has one way in,
      not one per chrome;
    - shell-rules.test.js:33 allows the shell to import EditorCore and not
      editor-snapshot.js, and the second route needed that list widened.
      Widening it is sanctioned rather than an exemption, but widening a
      boundary to avoid a binding the shell already uses in five places
      (Screen, Stack, Field, Sheet, and here) is the wrong trade.

  What it costs, said plainly rather than left for the next reader to
  find: this file now depends on EditorCore's instance surface and not
  only on its props. THREE members of the ~20 as of P2f Task 1 —
  `snapshot`, `moveBlock` for the drop, and `setLiftedBlock` for the lift
  that precedes it — and nothing else is read off `core` HERE. The count
  is kept current rather than left at the number it was written at,
  because a stale "exactly one" is the kind of comment the reader trusts
  and should not. It was stale when this task arrived: it said TWO, and
  `setLiftedBlock` had been the third since P2e Task 4 (:1109).

  `onCore` is why that last word is "here". The core's instance now leaves
  this file as well, by the same route and for the same reason the editor
  does: `confirmPin` is EditorCore's, the strip that presses it is in the
  bottom slot, and the slot is a band above this one. Lending the verb
  instead of the instance would mean deciding a pin's category and title
  in the file that renders no toolbar — which is precisely what EditorCore
  declines to do at :666 and what ShellApp's pin-intent.js decides
  instead. A callback rather than a second bind:this because `core` is
  already bound HERE, and two bindings on one instance is two owners of
  one lifecycle.

  trailMode, isTrailMode and trailLineageId ARE passed, and the KNOWN
  LIMIT that stood here — that they were not — is closed. They were never
  a deferral. What each one gates, read off EditorCore rather than off
  its name:

    trailMode       the Y.Doc gate (EditorCore:156): "continuous" and not
                    readonly binds a CRDT, anything else takes the plain
                    content_json path. Also sends the caret to the end of
                    the doc on a page switch (:393).
    isTrailMode     together with trailLineageId, routes every save
                    through saveTrailContent instead of savePageContent
                    (:375, :444, :954). Nothing else reads either one.
    trailLineageId  the lineage saveTrailContent is told about.

  Why that matters here. getOrCreateToday() is `SELECT * FROM pages WHERE
  date = ? ORDER BY page_number DESC LIMIT 1` (commands.rs:65-72) — no
  lineage filter — so the shell CAN be handed a continuous trail's
  canonical page. Unbound, the editor saved it through savePageContent
  with yjsBytes null, and save_page_content_inner is
  `yjs_state = COALESCE(?, yjs_state)` (commands.rs:2884): None PRESERVES
  the column, it does not clear it. content_json moves forward, yjs_state
  stays where it was, and the next open hydrates that stale doc and skips
  `content` entirely (EditorCore:196-199) because supplying both would
  double-apply. The edit is discarded, silently.

  How live that is, checked rather than assumed, because a wrong severity
  decides how the next reader treats it: yjs_state is empty everywhere
  today. It has exactly one writer reachable from the app,
  save_page_content_inner, and only when the caller ships bytes — and the
  desktop passes isTrailMode={mode === "continuous"} (Page.svelte:1401),
  so every continuous save it makes goes to saveTrailContent, which never
  touches the column. So the loss above is LATENT, not live: it fires the
  first time anything writes yjs_state — a sync merge (sync/merge.rs:192),
  a snapshot restore, or a desktop that stops diverting.

  Why mirror the desktop rather than "fix" the route from here by leaving
  isTrailMode false: passing trailMode alone would make the shell the
  only writer of yjs_state in the system, and every later desktop edit to
  that page — content_json only — would be dropped on the next open in
  favour of the shell's frozen bytes. Closing a latent loss by opening a
  live one is not a fix. Both clients save identically instead, and the
  divergence between that route and the four comments that describe it
  (EditorCore:165 and :445, commands.rs:2819, yjs/feature-flag.js:7 all
  say a continuous save persists yjs_state) is the desktop's to settle —
  src/components/ and src-tauri/ both belong to main's session.

  readonly still reads is_open and nothing else, and for the pages this
  phase can open that IS the desktop rule in full. Desktop's is
  `is_open !== false && (date === today || trail is continuous)`
  (Page.svelte:175). get_or_create_today_inner selects `WHERE date = ?`
  against chrono::Local's today, so the first arm of the disjunction is
  constant true here and the second cannot change an answer this phase
  can produce. Writing `|| trailMode === "continuous"` beside a constant
  true would read as a decision while being dead code — the honest move
  is to leave it out until it decides something. It decides something
  when P2f's date sheet can open a page that is not today's, and the
  clock read that arm then needs belongs to that task's pure module.

  THE CARET BAND, and why it reads no token. The band is the content
  band's own box — Screen's bounds() — and nothing else. Both obvious
  readings are wrong: this task was written as "the content band's bottom
  minus --kb-inset and --slot-h", and caret-visible.js's header says a
  band bottom "reads only --slot-h". Neither survives contact with a box
  read off the element. ShellRoot leaves the flow and sizes itself to
  var(--app-height) — the visible viewport, keyboard already excluded —
  and .shell-slot is a flex sibling BELOW the content band, so
  getBoundingClientRect() on that band already stops above both. Subtract
  either token and the band's floor rises off a floor that was already
  right, by a slot or by a whole keyboard, and the page is yanked upward
  on a caret that was perfectly visible — the jump caret-visible.js's
  explicit zero exists to prevent, arriving from the arithmetic meant to
  prevent it. The rule those two comments are actually making — never
  re-add --kb-inset to a normal-flow measurement — this obeys entirely.

  The band is measured on every correction, never cached, and the keyboard
  is the reason. Nothing announces that it got shorter: --app-height
  changes, the frame reflows, and the box is simply different the next
  time it is asked for. So keyboardOpen is a TRIGGER here and not a term —
  the flip says "re-measure and re-check", and the measurement itself
  never mentions it. Caching bounds at mount passes every load-time
  assertion and fails the single case the feature exists for; the test
  measures one caret against a tall band and then a short one, which is
  what catches that.

  THE FIRST SELECTION THIS PATH SEES IS NOT A CARET, which was a surprise
  and is written down as one. EditorCore's page-switch effect calls
  setContent (:388), and tiptap emits selectionUpdate for the transaction
  that lands the doc — so a correction runs once at open, against a
  selection ProseMirror mapped rather than one anybody made. Found by
  instrumenting the component, after a test written as "does not scroll
  before the writer has put a caret anywhere" passed for the wrong reason:
  the editor had already reported one. It is benign, and on two paths it is
  what you would have asked for anyway — a continuous trail's focus("end")
  at +50ms (:394) and a revisited page's restored cursor (:398) arrive the
  same way, and bringing either into view is exactly this job.

  THE HANDLE'S PRESS IS NO LONGER OVER AT POINTERDOWN, which is the one
  behaviour P2e changed in what P2d shipped, and the reason is mechanical
  rather than stylistic. ToolbarButton acts on `pointerdown` — that is its
  whole design, and it is right for a strip: a command that runs the
  instant the thumb lands cannot lose the editor's selection on the way.
  But §3 wants a HOLD on this one control, and a control that has already
  acted by the time a hold could be recognised has nothing left to hold:
  press the handle for 350ms as P2d wired it and the block sheet is
  already up. Opening it and then taking it away when the lift arms is
  worse than not opening it — a sheet that flashes for a third of a second
  reads as a bug, not as a mode.

  So the handle's ToolbarButton is passed NO onPress, and this file owns
  the press instead: down, move and up on the gutter column, with the
  tap decided at pointerup and the lift decided by a timer.

  WHAT THE BUTTON STILL DOES, because it is easy to read the missing
  onPress as the control being decorative. `press()` calls preventDefault
  BEFORE it looks at onPress (ToolbarButton:30-33), so the one thing that
  handler exists for still happens: the pointerdown is cancelled, focus
  never leaves the editor, and the selection the sheet's rows are built
  from is still there when the finger comes off. Nothing about the focus
  story changed; only WHEN the action runs did. It also keeps the 44px
  floor and the real button element — spelled out rather than written as
  the tag, which shell-rules.test.js scans for as plain text and has
  caught from inside prose before — which is what that rule requires of
  every control in here.

  WHAT CANCELLING POINTERDOWN DOES NOT DO is stop the `click` that follows
  — the defect ee83cb3d was written for — so it is worth saying that this
  change does not move that hazard. Cancelling pointerdown suppresses the
  compatibility MOUSE events, never click, and the browser hit-tests the
  click against the DOM as it stands THEN. Before: pointerdown opened the
  sheet, pointerup, click landed on whatever row had mounted under the
  finger. Now: pointerup opens the sheet, click lands on whatever row
  mounted under the finger. Same event, same order relative to the sheet's
  own mount, and Sheet's one-click seal covers it identically. The one
  case that is new is a click after a LIFT, which no longer has a sheet
  under it to be swallowed by — it lands on the canvas and can move the
  caret. Recorded for the device pass rather than guessed at: jsdom fires
  no compatibility click at all, so nothing here can see it.

  With the drop wired (Task 3), what that click would cost is now sayable
  even though it still cannot be reproduced here. The drop's own
  transaction sets the selection into the block it moved
  (moveNodeToIndex), so the caret — and the gutter handle that follows it
  — land on the block the writer just carried. A stray click arriving
  after that would move both somewhere else, on a page that has just
  reordered. Nothing is lost and no edit is wrong; the handle is simply
  beside the wrong block until the next tap. Still a device finding, and
  still not one any test in this tree can hold.

  ONE CLOCK, ONE SLOP. The 350ms is not re-typed here — pointer-gesture.js
  exports LONG_PRESS_MS and strokeMoved, and this file supplies only the
  timer that asks. That module's own header says why `recognise` could not
  be used directly: it is terminal, and a lift that arrives at pointerup
  is a lift nobody can drag.

  THE STROKE IS FOLLOWED ON `window`, not on the gutter and not on the
  button. Two independent reasons, either sufficient. A finger that has
  lifted a block leaves the 44px column immediately — that is the point of
  the gesture — and pointermove on the element it left is not delivered.
  And ShellRoot, the moment it is given an onGesture, calls
  setPointerCapture on `.shell-root` for every pointerdown in the shell:
  capture retargets dispatch to the capturing element, so a listener on a
  DESCENDANT stops hearing the rest of its own stroke. Events still
  propagate up from the capture target, so window hears the stroke either
  way. Nothing in the shell passes onGesture today, so this is protection
  against a wire the next phase adds rather than a bug being fixed — said
  plainly so it does not read as a fix for something observable now.

  WHAT IS NOT SOLVED HERE, and is a device finding rather than a gap left
  quietly: nothing yet stops the browser PANNING once the block is up.
  Cancelling pointerdown does not prevent scrolling — touch-action does,
  and the browser reads it at touchstart, so a rule turned on when the
  lift arms is already too late for the stroke that armed it. The control
  under the finger is a ToolbarButton, whose touch-action is
  `manipulation`, which permits panning. Fixing it properly means the
  primitive declaring a different value for this one instance, which is a
  change to a file every strip in the shell shares — worth making with
  Task 2's finger-following in hand and a device to check it on, not
  blind. jsdom cannot see any of it and neither can the VR gate, so
  nothing here would have caught it either way; it is written down
  instead of guessed at.

  WITH TASK 2 IN HAND, the shape of that answer is now visible even though
  the answer itself still needs a device. `touch-action: none` on the
  gutter column is the only value that stops a pan, it has to be in the
  stylesheet before the touchstart that arms the lift, and it therefore
  applies to every stroke that begins on the handle — including the tap
  that opens the block sheet, and including a finger that lands on the
  handle only to scroll past it. That last one is the cost, and it is
  real: `pressMove` deliberately abandons a press that leaves the slop
  precisely so a scroll begun on the handle stays a scroll, and
  `touch-action: none` would take the scroll away from a stroke this file
  has already decided not to claim. So the value belongs on the 44px
  COLUMN and not on ToolbarButton (every strip in the shell shares that
  primitive and none of them want it), and the open question is whether
  losing scroll-from-the-gutter is acceptable or whether the column needs
  `pan-y` — which permits vertical panning and would therefore ALSO let
  the page slide during a drag, i.e. not a fix at all. Naming a value here
  would be a guess: nothing in jsdom or the VR gate evaluates touch-action,
  so the choice cannot be made anywhere but on a phone. What Task 2 adds
  is that the loop already re-asks the drop target every frame, so a pan
  during a drag no longer strands the indicator — it makes the block track
  a document that is sliding, which is wrong but self-consistent, and is
  what a device pass will actually be looking at.

  THE DROP INDICATOR IS POSITIONED THE WAY THE HANDLE IS: absolute, inside
  .ps-canvas, which is the same containing block and the same two reasons.
  It is not the lift's answer (relative + transform) because it is not
  ProseMirror's DOM — it is this file's own element, so it can be placed
  rather than nudged. What it shares with the lift is the constraint: the
  canvas auto-scrolls while a block is held at an edge, so a box resolved
  against the viewport would hold still while the document it points into
  slid past. A child of the canvas scrolls with the canvas, and the offset
  it is given is canvas-local — the same subtraction between two boxes in
  one scroller the handle already makes — so it needs no compensation of
  its own. The rule shell-rules.test.js enforces is satisfied on the way
  past rather than being the reason.

  WHAT THE FIRST CALL TO drop-target.js FOUND, because "it has tests" was
  not evidence and this is the eighth module in this workstream to prove
  it. Two things, one in each function.

  autoScrollSpeed answered NaN for a canvas of zero height. Its clamp
  narrows the band to half the canvas so the two edges cannot overlap; on
  a canvas with no height that is 0, and the depth ratio becomes 0/0. The
  caller adds that to a scroll position and `scrollTop += NaN` is NaN,
  which coerces to 0 — a block held anywhere near a degenerate band would
  send the document to the top. Fixed in the module, where the arithmetic
  is, and confirmed reachable from here before being fixed: with the guard
  removed and a throw wired into Screen's scrollBy, one frame of this
  loop against jsdom's unstubbed 0x0 band raised it.

  dropTargetIndex is correct and unusable for drawing, which is the
  subtler of the two. Its index counts in the document the drop LEAVES —
  post-removal, which is what moveBlockTo wants — and the blocks on screen
  are the document as it still is, one longer. A caller that draws a
  hairline at blockRects[thatIndex] draws it one block too high on every
  downward drag. Nothing was wrong with the index; the missing thing was a
  second question nobody had asked yet, so drop-target.js grew
  insertionLineIndex to answer it and this file calls both. The
  alternative — inverting the decrement inline here — is indistinguishable
  at a glance from the double-correction the module's header warns
  against, which is the whole reason it is named instead.

  THE RECTS ARE MEASURED ONCE, ON LIFT, and the compensation is read off
  the canvas's own box rather than off a scroll position. dropTargetIndex
  takes `scrollTop` and `liftScrollTop` but subtracts one from the other
  and uses nothing else, so what it actually wants is how far the canvas
  has travelled since the rects were taken — and the canvas's box reports
  exactly that, negated, synchronously, with no new API on Screen and no
  dependence on a scroll event that jsdom never fires and that a real
  browser delivers a frame late. It is also correct for travel a scrollTop
  cannot see: the nav band collapsing moves the canvas without moving the
  scroll. See dragCanvasTop below.

  WHERE THE DRAG'S STATE LIVES, decided with the files open. It is here,
  in two variables, and not yet in a module beside gesture-owner.js. What
  a module would hold today is one `if`: "the timer fired and the stroke
  has not moved". Both of its terms are already pure and already tested —
  LONG_PRESS_MS and strokeMoved — so a module would add a file and a name
  without adding a decision. That changes in Task 3, where returning to
  origin and leaving the canvas are two cancels that must both leave the
  document untouched: THAT is a state machine with an answer worth
  asserting apart from a component, and it is where the module belongs if
  it is written at all. Recorded here so the next task decides it rather
  than inherits it.

  RE-EXAMINED IN TASK 2 rather than inherited, since the drag grew five
  more variables. They are all measurements — rects, an index, two
  coordinates and a frame handle — and a measurement is not a decision:
  every question asked of them is already answered by a pure function
  (dropTargetIndex, insertionLineIndex, autoScrollSpeed). Moving the
  numbers into a module would move the DOM reads that produce them too,
  and a module that reads getBoundingClientRect is a component with a
  worse name. The answer stands: the state machine, if one is written,
  is Task 3's cancels.

  DECIDED IN TASK 3, and the module was written. drop-release.js holds ONE
  question — "did this stroke end in a drop or a cancel, and which" — and
  not the drag's lifecycle, which stays here beside the DOM it is read
  from. What tipped it was not the rule count. It was that a component
  test cannot see one of the rules at all: both cancels leave the document
  identical, and so does an origin DROP, because moveNodeToIndex refuses a
  target equal to the block's own index. So the doc — the only witness a
  component test has — reads the same whether the origin rule is obeyed or
  ignored, and a probe deleting it would stay green. That is this
  workstream's recurring "two mechanisms hide each other", and the module
  is where the shell's own answer becomes readable. The two cancels that
  ARE doc-visible are asserted on the doc as well; see PageScreen.test.js.

  WHY THE DRAG WALKS THE DOC RATHER THAN THE DOM. drop-target.js's
  contract puts container-filtering on the caller because only the caller
  knows the doc structure, and the structure is ProseMirror's, not the
  element tree's. Resolving the dragged block's position gives its parent,
  and walking that parent's children by nodeSize gives one element per
  sibling in order — so §3's "a top-level block never drops into a board"
  falls out of the walk instead of needing a rule. Worth knowing that the
  board arm is unreachable today: activeBlock.pos is $from.before(1), so
  every block this shell can lift is top-level and every walk is over the
  doc. It is not speculative generality — it is what stops the answer
  being silently wrong the day a handle can address a board's child — but
  it is not proven by anything either, and PageScreen.test.js's nested
  case proves only the half that is live: that the paragraphs INSIDE a
  board never become gaps a top-level drag can name.

  What this does NOT cover, checked rather than assumed. Android animates
  the IME open over several frames and keyboardOpen flips ONCE, at
  keyboard-state.js's 80px threshold, so the box read at that instant can
  be mid-animation and the correction short by whatever keyboard is still
  arriving. Every keystroke and every caret move after it re-corrects, so
  the cost is an under-scrolled frame as the keyboard appears rather than
  a caret stranded behind it. Watching --app-height settle would fix it
  properly and would make this a second visual-viewport subscriber, which
  is the one thing src/shell may not grow. Recorded for the device pass
  instead of answered with a timer no test could prove.
-->
<script>
  import EditorCore from "../components/editor/EditorCore.svelte";
  import Screen from "./ui/Screen.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import Toast from "./ui/Toast.svelte";
  import ToolbarButton from "./ui/ToolbarButton.svelte";
  import TitleField from "./ui/TitleField.svelte";
  import { focusLineWrite } from "./focus-line.js";
  import { blockElementFor, focusEscapesProse } from "./block-focus.js";
  import { navCollapsed } from "./nav-collapse.js";
  // The same call ShellApp makes for `disabledIds`, not a second reading of
  // the same rule — see page-writable.js for what the second arm is and
  // what it was hiding.
  import { pageReadonly, readonlyNote } from "./page-writable.js";
  import { saveHealth } from "../lib/save-health.js";
  import { caretScrollDelta, caretRecheckWarranted, typingElsewhere } from "./caret-visible.js";
  import { viewportSnapshot } from "../lib/keyboard-state.js";
  import { LONG_PRESS_MS, strokeMoved } from "./pointer-gesture.js";
  import { dropTargetIndex, autoScrollSpeed, insertionLineIndex } from "./drop-target.js";
  import { releaseOutcome } from "./drop-release.js";
  import { handleTop, lineHeightPx, tapPx, handleAnchor } from "./gutter-handle-line.js";
  import { handleReadout } from "./editor-readout.js";

  /** @type {{
    dateLabel: string,
    page?: any | null,
    trailName?: string | null,
    trailParents?: string[],
    trailMode?: "discrete" | "continuous" | null,
    pageCount?: number,
    pageNumber?: number,
    pinCount?: number | null,
    whatMattersNow?: string,
    onFocusLine?: ((text: string) => void) | null,
    toast?: string,
    keyboardOpen?: boolean,
    stripRow?: boolean,
    onDate?: (() => void) | null,
    onFind?: (() => void) | null,
    onPins?: (() => void) | null,
    onTrail?: (() => void) | null,
    onPages?: (() => void) | null,
    onNew?: (() => void) | null,
    onEditor?: ((editor: any | null) => void) | null,
    onCore?: ((core: any | null) => void) | null,
    onSnapshot?: ((snapshot: object) => void) | null,
    onBlockHandle?: ((block: object) => void) | null,
    onChartOpen?: ((params: object | null) => void) | null,
    onDragActive?: ((active: boolean) => void) | null,
    onScrollEdges?: ((edges: {atTop: boolean, atBottom: boolean}) => void) | null,
  }} */
  let {
    dateLabel,
    page = null,
    trailName = null,
    trailParents = [],
    trailMode = null,
    // Today by the backend's clock, from ShellApp (see its clockDay). Left
    // undefined, page-writable.js falls back to the WebView's, as in tests.
    todayDateStr = undefined,
    // The id of the page the backend handed out as today (ShellApp's
    // todayPageId): writable by identity, so no frontend clock is asked
    // to agree that it is today. See page-writable.js.
    todayPageId = null,
    pageCount = 1,
    pageNumber = 1,
    pinCount = null,
    whatMattersNow = "",
    // Told only what changed — see the focus line's markup comment. Null
    // when the host does not save (the gallery, a test), in which case the
    // field still edits and the edit goes nowhere, which is honest for a
    // surface with no page behind it.
    onFocusLine = null,
    // Owned by ShellApp, not by this screen: the message is composed from a
    // fetch this file never makes, and its lifetime is a timer this file
    // has no reason to hold. PageScreen renders what it is handed.
    toast = "",
    keyboardOpen = false,
    // Whether the bottom band currently has a strip row above its nav row.
    // Not derived here: toolbarFor decides it and ShellApp asks, and a
    // screen that re-derived it would be a second answer to the same
    // question. Only the caret correction reads it — see the trigger.
    stripRow = false,
    onDate = null,
    onFind = null,
    onPins = null,
    onTrail = null,
    onPages = null,
    onNew = null,
    onEditor = null,
    onCore = null,
    onSnapshot = null,
    onBlockHandle = null,
    // A no-op default rather than the `null` its neighbours take, because
    // this one is handed to EditorCore rather than to a shell primitive:
    // EditorCore's own default is a no-op and passing `null` over it would
    // make the chart extension call null.
    onChartOpen = () => {},
    onDragActive = null,
    onScrollEdges = null,
  } = $props();

  let scrollTop = $state(0);

  // The answer that was on screen at the previous scroll position. This is
  // navCollapsed's `collapsed` argument, and nothing else may write it.
  let bandMemory = $state(false);

  const collapsed = $derived(
    navCollapsed({ scrollTop, collapsed: bandMemory, keyboardOpen }),
  );

  /** @param {{scrollTop: number, atTop: boolean, atBottom: boolean}} state */
  function handleScroll(state) {
    bandMemory = collapsed;
    scrollTop = state.scrollTop;
    // The other two thirds of the same message, passed straight up rather
    // than acted on here. Screen already computes them and this file
    // already threw them away — which is why gestureOwner's canvas row
    // reached its `atScrollBottom` branch from nothing but a test until
    // P3. What a scroll position MEANS for a gesture is the table's call,
    // and the table lives above this screen, not inside it.
    onScrollEdges?.({ atTop: state.atTop, atBottom: state.atBottom });
  }

  /** May the writer type into this page at all. One derivation rather than
   *  an inline call at the EditorCore mount, so that anything else in this
   *  band which ever has to agree about it reads the same answer instead of
   *  making a second call — the two-copies-of-one-rule that
   *  page-writable.js exists to end, one file down instead of one file
   *  across. */
  const readonly = $derived(pageReadonly({ page, trailMode, todayPageId, ...(todayDateStr ? { todayDateStr } : {}) }));

  /** The sentence that goes with it, or null on a page that takes writing.
   *
   *  Derived from the same two inputs rather than from `readonly`, so the
   *  note and the refusal cannot disagree — the one way this could go wrong
   *  is a canvas that is quiet while the note says it is writable, or the
   *  reverse, and reading them off one function in one module is what makes
   *  that unrepresentable. */
  const refusal = $derived(readonlyNote({ page, trailMode, todayDateStr, todayPageId }));

  /** Screen's two lent capabilities: its own box, and moving its scroll. */
  let scroller = $state(null);

  /** EditorCore's instance, bound for exactly one member: its `snapshot`
   *  store. $state because the subscription below has to re-run when the
   *  binding lands — the canvas mounts conditionally on `page`, so this is
   *  null for the first frame of every boot and again whenever the canvas
   *  goes away. */
  let core = $state(null);

  /** The canvas element, bound because it is the handle's frame of
   *  reference: the gutter is this element's own left padding, so an
   *  offset measured against its box is an offset inside the column the
   *  handle sits in. */
  let canvasEl = $state(null);

  /** The editor, kept as well as forwarded. Exactly one member is read
   *  off it — view.nodeDOM — and only to ask which DOM node the active
   *  block is. EditorCore hands over null on teardown (:495), so this is
   *  never a destroyed editor by the time anything reads it; the derived
   *  below checks isDestroyed anyway, because the null arrives on the
   *  core's own schedule and a render can happen in between.
   *
   *  Not selectionEditor, below, which holds the same instance: that one
   *  is set by the selection event and read only inside that path, so it
   *  is null until the writer's first selection and it is a plain `let`
   *  on purpose. The handle needs the editor from the moment it exists,
   *  and needs it reactively — a $derived cannot depend on a plain let. */
  let blockEditor = $state(null);

  /** The last snapshot, kept for the same reason the editor is: the
   *  handle renders from activeBlock. It is still forwarded — the slot
   *  one band up renders from it too — and this is the same value, not a
   *  second copy of it. */
  let lastSnapshot = $state(null);

  /** The block a NON-CARET focus is inside — a table's title, a board's
   *  name, any field a NodeView owns.
   *
   *  REPORTED: "when tap on title it does not show the 3 dots". Those
   *  titles are real inputs inside the node's view, so tapping one moves
   *  the browser's focus and not ProseMirror's selection; `computeSnapshot`
   *  reads `$from` and nothing else, so `activeBlock` stayed wherever the
   *  caret had been, or null. The handle follows activeBlock, so the writer
   *  naming their table had no way to turn it into anything, move it or pin
   *  it — the one block they were demonstrably working on was the one block
   *  with no controls.
   *
   *  A SECOND SOURCE, NOT A REPLACEMENT. The snapshot still wins wherever
   *  it has an answer: a caret in prose is a fact about the document and
   *  this is a guess from the DOM. This only speaks when the selection
   *  cannot (see block-focus.js). */
  let focusBlock = $state(null);

  /** The block a DOM element sits in, as the snapshot would name it:
   *  `{type, pos}` with pos the position immediately BEFORE the top-level
   *  node, which is what `gutterHandle` hands to `nodeDOM` and what every
   *  block action resolves from. */
  function blockFromElement(el) {
    const view = blockEditor?.view;
    if (!view || view.isDestroyed || !el) return null;
    try {
      // No `$`-prefixed name here, however much ProseMirror's own
      // convention asks for one: Svelte 5 reserves that prefix and the
      // component will not compile.
      const resolved = view.state.doc.resolve(view.posAtDOM(el, 0));
      if (resolved.depth === 0) return null;
      const pos = resolved.before(1);
      const node = view.state.doc.nodeAt(pos);
      return node ? { type: node.type.name, pos } : null;
    } catch {
      // posAtDOM throws for an element the view no longer owns — a NodeView
      // mid-teardown. No handle is the right answer there; a guessed
      // position would resolve to another block.
      return null;
    }
  }

  /** Focus moving inside the canvas.
   *
   *  CLEARED ON THE WAY OUT RATHER THAN ON THE NEXT SNAPSHOT, which was the
   *  other tempting rule and is wrong: typing in a title DOES dispatch
   *  transactions (the NodeView writes the name into the node's attrs), so
   *  clearing on a new snapshot would take the handle away again on the
   *  first keystroke — the same absence the report is about, arriving a
   *  letter later. */
  function onCanvasFocusIn(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!focusEscapesProse(target)) {
      focusBlock = null;
      return;
    }
    const root = blockEditor?.view?.dom ?? null;
    const el = blockElementFor(target, root instanceof Element ? root : null);
    focusBlock = el ? blockFromElement(el) : null;
  }

  function onCanvasFocusOut(event) {
    // Focus moving WITHIN the same block keeps the handle: a table's title
    // to its first cell's own field is one block, and a handle that blinked
    // between them would read as a glitch.
    const next = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    const root = blockEditor?.view?.dom ?? null;
    if (next && focusEscapesProse(next)) {
      const el = blockElementFor(next, root instanceof Element ? root : null);
      if (el) {
        focusBlock = blockFromElement(el);
        return;
      }
    }
    focusBlock = null;
  }

  $effect(() => {
    const el = canvasEl;
    if (!el) return;
    el.addEventListener("focusin", onCanvasFocusIn);
    el.addEventListener("focusout", onCanvasFocusOut);
    return () => {
      el.removeEventListener("focusin", onCanvasFocusIn);
      el.removeEventListener("focusout", onCanvasFocusOut);
    };
  });

  // The store arrives with the instance and dies with it. Returning the
  // unsubscribe is what keeps a torn-down EditorCore's store from holding
  // this component's callback: Svelte 5 lets a write into a dead
  // component pass silently (ShellApp's `live` flag carries the same
  // note), so a leak here would never announce itself — no crash, no
  // warning, just a strip somewhere upstream still being told about an
  // editor that no longer exists.
  $effect(() => {
    const store = core?.snapshot;
    if (!store) return;
    return store.subscribe((s) => {
      lastSnapshot = s;
      onSnapshot?.(s);
    });
  });

  function takeEditor(ed) {
    blockEditor = ed;
    onEditor?.(ed);
  }

  // ── the focus line ─────────────────────────────────────────────────
  //
  // The field's text, seeded from the prop and re-seeded whenever the prop
  // moves (a page switch, or the host echoing a commit back). The desktop's
  // WhatMattersNow keeps the same pair (`text`, `lastSyncedValue`) for the
  // same reason: while the writer is typing, the prop is what the ROW
  // says, and the field must not snap back to it on every render.
  //
  // A WRITABLE $derived rather than $state plus a seeding effect. Typing
  // overrides the derived until the prop next changes, which is exactly
  // the pair above in one declaration — and it is synchronous. The effect
  // version seeded one microtask after mount, and a blur in that window
  // committed "" over the real title (PageScreen.test.js caught it in
  // jsdom, where render() does not flush; on a device the window is real
  // but short, which is the kind of bug that ships).
  let focusDraft = $derived(whatMattersNow ?? "");

  /** A blur or an Enter. Whether it is an edit is focus-line.js's call. */
  function commitFocusLine(text) {
    const next = focusLineWrite({ draft: text, synced: whatMattersNow });
    if (next === null) return;
    onFocusLine?.(next);
  }

  /** Enter on the title: the caret goes to the start of the prose, which
   *  is where the desktop sends it (Page.svelte's onEnter → the editor).
   *  Through the editor's own command so the IME stays up — the focus
   *  traces to the writer's keystroke. */
  function focusProse() {
    const ed = blockEditor;
    if (!ed || ed.isDestroyed) return;
    ed.commands.focus("start");
  }

  // The core itself, up to the host that owns the bottom slot (see the
  // header's onCore note). An effect and not a call inside takeEditor,
  // because `core` lands by bind:this on its own schedule and the two are
  // not the same moment: onEditor fires from inside EditorCore's onMount,
  // and the binding is written by the parent afterwards.
  //
  // The teardown hands back null rather than leaving the host holding a
  // destroyed instance. That matters more than it does for the editor —
  // `editor.isDestroyed` is a question the host can ask, and a torn-down
  // component export is not.
  $effect(() => {
    onCore?.(core);
    return () => onCore?.(null);
  });

  /** The active block and where its handle goes, or null for "no handle".
   *  Recomputed whenever the snapshot changes — which EditorCore does on
   *  every transaction — so the handle follows the caret rather than
   *  parking where it was first resolved (see the header).
   *
   *  `top` is canvas-local — the block's box minus the canvas's, two boxes
   *  in one scroller, so it does not change when the page scrolls — and
   *  then shifted so the column's 44px tap box is CENTRED ON THE BLOCK'S
   *  FIRST LINE rather than hung from its top edge. The arithmetic and the
   *  reason are gutter-handle-line.js's; what this reads for it is the
   *  block's computed line-height (the first line box's height for a text
   *  block, empty or not — a Range would measure nothing on the empty
   *  paragraph the defect was photographed on) and the canvas's computed
   *  left padding, which is `var(--tap)` resolved to px — the same token
   *  the gutter's width and the button's min-height are, read off the one
   *  element that exists before the column does. Neither the gutter's
   *  width nor the button's box changes: the hit area is where it was,
   *  moved up as a whole. */
  // THE DERIVED DECIDES AND WRITES NOTHING, and the effect below reports.
  //
  // It used to call handleReadout.set() from in here, which looked harmless
  // and took the whole shell down: the store write wakes $handleReadout in
  // ViewportReadout, that updates component state while this derived is
  // still being evaluated, and Svelte throws state_unsafe_mutation. The
  // shell then rendered an empty document — a blank app behind an
  // onboarding gate that had nothing wrong with it.
  //
  // Nothing in the suite could see it. The store has no subscriber unless
  // ViewportReadout is mounted, and that only happens in a
  // VITE_VIEWPORT_READOUT build; with no subscriber the write touches no
  // state and nothing throws. Every APK handed over for two days was a
  // readout build, so the crash was in all of what was tested and none of
  // what was tested for.
  //
  // `why` rides on the value instead. The null cases return an object with
  // no `block`, which is what the markup now checks.
  const gutterHandle = $derived.by(() => {
    // THE FOCUSED FIELD WINS WHILE IT HAS FOCUS, and the order was the
    // other way round for one draft of this. A title input does not move
    // ProseMirror's selection, so `activeBlock` does not go null when the
    // writer taps one — it goes STALE, pointing at wherever the caret was
    // left. Preferring the snapshot there would put the handle beside a
    // different block than the one being named, which is worse than the
    // absence being fixed: a control that acts on something other than what
    // the writer is touching. focusBlock is null whenever no such field has
    // focus, so prose is unaffected.
    const block = focusBlock ?? lastSnapshot?.activeBlock ?? null;
    if (!block) return { why: "no-block" };
    if (!canvasEl) return { why: "no-canvas" };
    if (!blockEditor || blockEditor.isDestroyed) return { why: "no-editor" };
    let dom;
    try {
      // activeBlock.pos is a DOCUMENT position — `$from.before(1)`, the
      // position immediately before the top-level node — not a pixel
      // offset and not an index, so nodeDOM is the lookup and not
      // childNodes[pos]. It throws on a position the doc no longer has,
      // which a snapshot one transaction stale can be.
      dom = blockEditor.view.nodeDOM(block.pos);
    } catch {
      return { why: "bad-pos" };
    }
    if (!(dom instanceof Element)) return { why: "not-element" };

    // WHERE IT SITS IS NOT WHAT IT ACTS ON.
    //
    // `block` stays the top-level node, because that is what the handle's
    // actions can honestly do — turn into, move up, move down mean the
    // table, not one of its cells. But measuring the COLUMN against that
    // node parked the handle at the table's first row however far down the
    // caret went: reproduced on a device, where every cell reported
    // `table@20` and the caret's chain was div>table>tbody>tr>td>p.
    //
    // So the column lines up with the line the caret is on. domAtPos gives
    // the node at the selection; the nearest element above it is the line.
    // handleAnchor refuses one that is not inside the block, because a
    // stale element from the previous selection would point the handle at
    // another block entirely.
    let lineEl = null;
    try {
      const at = blockEditor.view.domAtPos(lastSnapshot?.from ?? block.pos);
      const node = at?.node ?? null;
      lineEl = node && node.nodeType === 3 ? node.parentElement : node;
    } catch {
      lineEl = null;
    }
    const anchor = handleAnchor(dom, lineEl instanceof Element ? lineEl : null);
    const anchorStyle = getComputedStyle(anchor);
    const top = handleTop({
      blockTop: anchor.getBoundingClientRect().top - canvasEl.getBoundingClientRect().top,
      firstLineHeight: lineHeightPx({
        lineHeight: anchorStyle.lineHeight,
        fontSize: anchorStyle.fontSize,
      }),
      tapPx: tapPx(getComputedStyle(canvasEl).paddingLeft),
    });
    return { block, top, why: "ok" };
  });

  // The report, where a side effect belongs. Reading `gutterHandle` here is
  // a read, not a write into the derived's own evaluation, so the cycle
  // that crashed the shell cannot form.
  $effect(() => {
    handleReadout.set({ why: gutterHandle.why, top: gutterHandle.top ?? null });
  });

  // ── the handle's press: a tap, or a lift ────────────────────────────
  //
  // The block a live drag is carrying, or null for "no drag". $state
  // because the lift is rendered from it; it is the ONLY piece of this
  // that anything reads, which is why the rest below are plain `let`s for
  // ShellRoot's reason — nothing renders from a half-finished stroke, and
  // a $state timeline would invalidate the frame on every pointermove.
  let dragBlock = $state(null);

  /** The pointer id this press belongs to, or null between presses. Every
   *  handler checks it for ShellRoot's reason: a second finger appending
   *  to one timeline is a jump, and a jump reads as a drag nobody made. */
  let pressPointer = null;
  let pressPoints = [];
  let pressBlock = null;
  let pressTimer = null;

  // ── the drag's geometry, measured once on lift ──────────────────────
  //
  // The dragged block's siblings, in order, as viewport-relative boxes.
  // Empty between drags AND when the measurement could not be taken; both
  // make dropTargetIndex answer fromIndex, which is its documented "no
  // geometry yet" answer and a drop that moves nothing.
  let dragRects = [];
  let dragFromIndex = 0;

  /** The canvas's viewport top at lift, and the drag's whole frame of
   *  reference. It does two jobs, and the second is the one worth
   *  spelling out.
   *
   *  It converts a lift-time rect into a canvas-LOCAL offset for the
   *  indicator, the same subtraction between two boxes in one scroller the
   *  gutter handle already makes, so the answer does not change when the
   *  page scrolls.
   *
   *  And it IS the scroll compensation. dropTargetIndex wants
   *  `scrollTop - liftScrollTop` — how far the canvas has travelled since
   *  the rects were taken — and the canvas's own box reports exactly that,
   *  negated: scroll down 100px and every box in the scroller, this one
   *  included, moves up 100px. Reading it off the element rather than off a
   *  scrollTop is better on three counts and worse on none. It is
   *  synchronous, where a scrollTop tracked through Screen's onScroll
   *  arrives an event late and would lag a 12px-per-frame auto-scroll by a
   *  whole frame. Screen lends bounds() and scrollBy() and deliberately not
   *  its element, so there is no scrollTop to read without widening that
   *  contract. And it is correct for travel a scrollTop cannot see at all:
   *  the nav band collapsing moves the canvas without moving the scroll,
   *  and the blocks move with it. */
  let dragCanvasTop = 0;

  /** Where the finger is now. The auto-scroll loop reads it on a frame no
   *  pointer event is delivering, which is the whole point of a loop: a
   *  finger held still in the bottom band must keep scrolling. */
  let dragPointerY = 0;

  /** The post-removal sibling index this drop would land on — the number
   *  pressUp hands moveBlock — or null for no live drag. Rendered only as the
   *  indicator's data-index, which is what lets a test and the VR driver
   *  read the MODEL rather than infer it from a pixel. */
  let dropIndex = $state(null);

  /** The indicator's y, canvas-local, or null for "draw nothing". */
  let dropLineTop = $state(null);

  let scrollFrame = null;

  function pressDown(event) {
    // No handle means no block to lift. gutterHandle always answers an
    // object now — `block` is what says there is one — and the column
    // renders nothing without it, so this is the guard for a press that
    // arrives between the two, not a state a user can aim at.
    if (!gutterHandle.block) return;
    if (pressPointer !== null) return;
    pressPointer = event.pointerId;
    pressBlock = gutterHandle.block;
    pressPoints = [{ x: event.clientX, y: event.clientY, t: event.timeStamp }];
    window.addEventListener("pointermove", pressMove);
    window.addEventListener("pointerup", pressUp);
    window.addEventListener("pointercancel", pressCancel);
    pressTimer = setTimeout(lift, LONG_PRESS_MS);
  }

  function pressMove(event) {
    if (pressPointer === null || event.pointerId !== pressPointer) return;
    pressPoints.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
    // Once lifted the stroke belongs to the drag: the slop has already done
    // its job and the only question left is where the finger has reached.
    if (dragBlock) {
      dragPointerY = event.clientY;
      updateDropTarget();
      return;
    }
    // Moved before the hold fired: this stroke was a drag from the start,
    // so it is neither a lift nor a tap. Dropping it HERE rather than at
    // pointerup is what makes that true — leave the press open and the
    // release would still read as a tap and open the sheet, which is the
    // "scrolled the page and got a menu" complaint the slop exists for.
    if (strokeMoved(pressPoints)) endPress();
  }

  /** ONE CONTAINER'S CHILDREN, and the doc decides which container that is.
   *
   *  drop-target.js's contract puts this filtering on the caller because
   *  only the caller knows the doc structure, and the honest way to know it
   *  is to ask ProseMirror rather than to read `.ProseMirror`'s element
   *  children. Resolving the dragged block's position gives its PARENT, and
   *  walking that parent's children by nodeSize gives one DOM node per
   *  sibling in document order. A board's children resolve to the board and
   *  reorder inside it; a top-level block resolves to the doc and can never
   *  be handed a rect that belongs inside a board, so §3's container rule
   *  falls out of the walk instead of needing a rule of its own.
   *
   *  Worth writing down, because it makes that arm currently unreachable:
   *  activeBlock.pos is `$from.before(1)` — or, for a NodeSelection at depth
   *  0, `$from.pos` — so EVERY block this shell can lift today is top-level
   *  and every walk is over the doc (editor-snapshot.js, readActiveBlock).
   *  The parent lookup is not speculative generality; it is what stops the
   *  answer being wrong the day a handle can address a board's child, and
   *  it costs one resolve.
   *
   *  Returns null rather than a partial list if any sibling has no element:
   *  a list with a hole in it has the wrong INDICES, which is a drop that
   *  lands somewhere the writer did not point. Nothing measured is a drop
   *  that does nothing, and that is the better of the two. */
  function measureSiblings(block) {
    const view = blockEditor?.view;
    if (!view || view.isDestroyed || !canvasEl) return null;
    // `resolved`, not `$pos`: Svelte 5 reserves the `$` prefix for store
    // access and refuses the identifier outright, so ProseMirror's own
    // naming convention cannot be carried into a component.
    let resolved;
    try {
      resolved = view.state.doc.resolve(block.pos);
    } catch {
      return null;
    }
    const parent = resolved.parent;
    const rects = [];
    let pos = resolved.start();
    for (let i = 0; i < parent.childCount; i++) {
      let dom;
      try {
        dom = view.nodeDOM(pos);
      } catch {
        return null;
      }
      if (!(dom instanceof Element)) return null;
      const box = dom.getBoundingClientRect();
      rects.push({ top: box.top, height: box.height });
      pos += parent.child(i).nodeSize;
    }
    return {
      rects,
      fromIndex: resolved.index(),
      canvasTop: canvasEl.getBoundingClientRect().top,
    };
  }

  /** Where the block would land, and where to say so. Called on every move
   *  of a live drag and on every auto-scrolled frame — the canvas moving
   *  under a stationary finger changes the answer exactly as the finger
   *  moving over a still canvas does. */
  function updateDropTarget() {
    if (!dragBlock || dragRects.length === 0 || !canvasEl) return;
    // The travel, not an absolute offset — see dragCanvasTop. liftScrollTop
    // is left at its 0 default because this IS already the difference the
    // module subtracts; passing the same number twice would cancel it.
    const scrolled = dragCanvasTop - canvasEl.getBoundingClientRect().top;
    dropIndex = dropTargetIndex({
      pointerY: dragPointerY,
      blockRects: dragRects,
      fromIndex: dragFromIndex,
      scrollTop: scrolled,
    });
    // NOT dragRects[dropIndex]. That index counts in the document the drop
    // LEAVES, and the blocks on screen are the document as it still is —
    // one longer, because nothing has moved yet. insertionLineIndex is the
    // conversion between the two lists and it lives in drop-target.js, so
    // this is not the caller re-correcting an index the module already
    // corrected (which the module's header warns against); it is the caller
    // counting in the other list.
    const gap = insertionLineIndex(dropIndex, dragFromIndex);
    const last = dragRects[dragRects.length - 1];
    const y = gap < dragRects.length ? dragRects[gap].top : last.top + last.height;
    // Canvas-local, so it needs no compensation of its own: the indicator
    // is a child of the canvas and scrolls with it, which is the same
    // reason the lift is a transform rather than a positioned box.
    dropLineTop = y - dragCanvasTop;
  }

  /** One frame of edge-scrolling. Scheduled again on every frame of a live
   *  drag, not only when it has something to do: the finger can stop moving
   *  inside the band — held still at the bottom of a long document is the
   *  case this whole loop exists for — so a loop that only ran while the
   *  speed was non-zero would stop the first frame it should have kept
   *  going. autoScrollSpeed answers 0 everywhere outside the two bands,
   *  which makes the idle frames cost one arithmetic call. */
  function autoScrollTick() {
    scrollFrame = null;
    if (!dragBlock) return;
    const band = scroller?.bounds();
    if (band) {
      const dy = autoScrollSpeed({
        pointerY: dragPointerY,
        top: band.top,
        bottom: band.bottom,
        // §3's numbers, said at the call site rather than left to the
        // module's defaults, because they are the spec's and not
        // drop-target.js's to change.
        band: 60,
        max: 12,
      });
      // Screen's lent capability, not its element (Screen's header): the
      // caret correction already moves the scroll through this, and a
      // second caller reaching for `.shell-screen-content` is how a
      // private class name becomes an API.
      if (dy !== 0) scroller.scrollBy(dy);
    }
    // Re-asked every frame, not only on the frames this loop scrolled. The
    // drop target is a function of two things — where the finger is, and
    // where the canvas is — and only the first of them announces itself
    // with an event. The canvas moves under a still finger when this loop
    // scrolls it, and ALSO when nothing here is involved: the browser pans
    // it (nothing stops that yet — see the touch-action note above), the
    // nav band collapses, the keyboard arrives and the frame reflows. A
    // recompute conditional on `dy` would leave the indicator pointing at
    // a gap that has since slid somewhere else in every one of those.
    updateDropTarget();
    scrollFrame = requestAnimationFrame(autoScrollTick);
  }

  function stopAutoScroll() {
    if (scrollFrame !== null) {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = null;
    }
  }

  /** The timer's answer. The clock is this file's; the two thresholds are
   *  pointer-gesture.js's, and the second one is re-checked here because a
   *  pointermove that has not been delivered yet is still a stroke that
   *  moved. */
  function lift() {
    pressTimer = null;
    if (!pressBlock || strokeMoved(pressPoints)) return;
    // Measured HERE, once, and never again for this drag. Every rect is a
    // box of the document as it stands before anything moves, which is what
    // dropTargetIndex's post-removal contract is stated against; re-measuring
    // mid-drag would also mean re-measuring while the lifted block carries a
    // scale(1.02), and reading a transformed box back as layout.
    const measured = measureSiblings(pressBlock);
    dragRects = measured?.rects ?? [];
    dragFromIndex = measured?.fromIndex ?? 0;
    dragCanvasTop = measured?.canvasTop ?? 0;
    dragPointerY = pressPoints.at(-1)?.y ?? 0;
    dragBlock = pressBlock;
    onDragActive?.(true);
    updateDropTarget();
    scrollFrame = requestAnimationFrame(autoScrollTick);
  }

  function pressUp(event) {
    if (pressPointer === null || event.pointerId !== pressPointer) return;
    pressPoints.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
    // The stroke is taken BEFORE the reset — ShellRoot's up() to the letter
    // — and the first draft of this function did not take it. endPress
    // empties pressPoints, so the slop check below read a list with nothing
    // in it and answered "did not move" for every release there has ever
    // been. It looked like it worked, because pressMove had already
    // abandoned every stroke the tests moved; the two hid each other so
    // completely that deleting the check changed nothing either.
    const stroke = pressPoints;
    const block = pressBlock;
    const lifted = dragBlock !== null;
    // THE RELEASE IS RE-AIMED BEFORE IT IS JUDGED, for the reason the slop
    // check below already states in its own words: pointerup carries a
    // position and a pointermove at that position is not promised. A fast
    // flick out of the canvas, or a coalescing stream that drops the tail
    // of a stroke, ends somewhere the move handler never saw — and a drop
    // decided on the last SEEN point would put the block where the finger
    // used to be. Same call the frame loop makes; the only new thing is
    // when it is made.
    if (lifted) {
      dragPointerY = event.clientY;
      updateDropTarget();
    }
    // Read before endPress, which clears every one of them. The band is
    // Screen's lent box, not this file's element (Screen's header), and it
    // is asked for here rather than cached at lift because the keyboard,
    // the nav band and a pushed sheet all change it mid-drag.
    const outcome = lifted
      ? releaseOutcome({
          dropIndex,
          fromIndex: dragFromIndex,
          pointerY: event.clientY,
          bounds: scroller?.bounds() ?? null,
        })
      : null;
    const carried = dragBlock;
    endPress();
    // The drop, and §3's two cancels. The DECISION is drop-release.js's —
    // its header says why it left this file, and the short version is that
    // both cancels and one of the drops leave the document identical, so
    // the doc cannot witness the origin rule and only the module's answer
    // can. What stays here is the one thing a pure module must not do:
    // reach into the editor.
    //
    // EditorCore.moveBlock, not editor.commands.moveBlockTo — the spec
    // names it (§3) and it is the core's public surface, the same
    // arrangement the snapshot binding above uses. Worth recording that
    // this is its FIRST caller in the app: the plan said P2d's block sheet
    // already moved blocks through it, and that is not so — ShellApp
    // imports moveBlockAtPos from the extension and dispatches its own
    // transaction, so until now the only thing that had ever called this
    // export was EditorCore's own test.
    //
    // No clamp of our own, and that absence is deliberate. moveNodeToIndex
    // clamps toIndex against the parent's PRE-removal childCount - 1, which
    // is exactly dropTargetIndex's documented maximum, so the two agree —
    // load-bearing, and undocumented on the command's side. A second clamp
    // here would be the double-correction the plan warns about wearing a
    // safety label.
    if (lifted) {
      if (outcome.drop && carried) core?.moveBlock(carried.pos, outcome.toIndex);
      return;
    }
    // Not lifted and not moved: a tap, and P2d's behaviour unchanged. The
    // duration is not re-measured — if it had passed LONG_PRESS_MS the
    // timer would have lifted and `lifted` would be true — so there is one
    // clock in this file rather than one here and one in `recognise`.
    //
    // THE SLOP IS CHECKED TWICE, here and in pressMove, and the second
    // check is not belt-and-braces: it is the only one that sees a stroke
    // whose displacement never arrived as a move. pointerup carries the
    // final position and a move at that position is not promised — a fast
    // flick can end past the last sample the move handler was given, and a
    // coalescing stream can skip the rest. Without this the release would
    // then read as a tap and open a sheet the writer was scrolling away
    // from.
    //
    // Written down because the two hid each other: removing THIS line left
    // the whole shell suite green, since the move handler had already
    // abandoned every stroke the tests moved. "opens no sheet when the
    // release lands away from the handle with no move to report it" is the
    // test that reaches it, and it is the only one that reddens when this
    // line goes.
    if (!strokeMoved(stroke)) onBlockHandle?.(block);
  }

  // The OS took the stroke: a system edge gesture, a call arriving. Same
  // rule ShellRoot's cancel states — a gesture the user never finished
  // reports nothing, so no sheet and no lift.
  function pressCancel(event) {
    if (pressPointer === null || event.pointerId !== pressPointer) return;
    endPress();
  }

  function endPress() {
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    window.removeEventListener("pointermove", pressMove);
    window.removeEventListener("pointerup", pressUp);
    window.removeEventListener("pointercancel", pressCancel);
    pressPointer = null;
    pressBlock = null;
    pressPoints = [];
    // Unconditional, not inside the `if` below. endPress is also the
    // component's teardown and the abandoned-stroke path, and a geometry
    // left behind would be the NEXT drag's first frame — measured against a
    // document that has since changed. There is nothing to keep between
    // drags; the rects are re-measured on every lift.
    stopAutoScroll();
    dragRects = [];
    dropIndex = null;
    dropLineTop = null;
    if (dragBlock) {
      dragBlock = null;
      onDragActive?.(false);
    }
  }

  // Unmounting mid-press. Three window listeners and a pending timer
  // outlive this component otherwise, and the timer would call lift() —
  // and therefore onDragActive(true) — against a host that has already
  // torn the canvas down, leaving the frame permanently in a drag no
  // finger is holding. No reactive read in the body, so this runs once at
  // mount and its teardown is the whole of it.
  $effect(() => endPress);

  /** The lifted block. It cannot be a class in the template — the node is
   *  rendered by the editor, not by this file — so it is asked for through
   *  the core, and the effect's own teardown clears it, whether the drag
   *  was dropped, cancelled or unmounted out from under.
   *
   *  THROUGH THE CORE, not onto the node's DOM, and that is the whole of
   *  this rewrite. This effect used to do `nodeDOM(pos).classList.add(...)`.
   *  It worked in every test and in no browser: ProseMirror's DOMObserver
   *  sees a foreign attribute change on a node it owns, marks the range
   *  dirty and redraws it from the doc — within ~100ms on a device — so the
   *  class rode away on the orphaned element while the effect, whose
   *  dependencies had not changed, never re-ran. The block sat there flat
   *  for the rest of the drag. `shell-page @ block-lift` photographed it;
   *  EditorCore.setLiftedBlock is a decoration, which that same redraw
   *  re-applies instead of undoing.
   *
   *  The STYLE stays here — `.ps-lifted` below is §3's scale and shadow,
   *  and chrome's business — and only the marking moved. */
  $effect(() => {
    const block = dragBlock;
    if (!block || !core) return;
    core.setLiftedBlock(block.pos);
    return () => core?.setLiftedBlock(null);
  });

  // The editor the last selection came from. A plain `let`, not $state,
  // for ShellRoot's reason about its stroke buffer: nothing rendered reads
  // it, so reactivity would buy nothing. NOT for the reason it looks like —
  // it is the same editor instance every time, and Svelte compares before
  // it invalidates, so a $state here would not re-render on each keystroke
  // either. Dead weight rather than a hazard, and worth saying so before
  // someone "fixes" it into one.
  let selectionEditor = null;

  // The rect ProseMirror gives up on, and the reason this function exists
  // at all. A caret in a brand-new EMPTY paragraph — Enter at the end of
  // the doc, the single most common way to need this whole feature —
  // measures {top: 0, bottom: 0, left: 0, right: 0}, because the
  // paragraph's only child at that moment is PM's trailing <br>, which
  // reports no client rects. Fed to caret-visible.js that is a caret at the
  // top of the viewport, and the answer is a scroll to the top of the page
  // on every Enter.
  //
  // The test mirrors prosemirror-view's own `nonZero(rect) || rect.left !=
  // 0`, so this takes over in exactly the cases PM declines and stays out
  // of the way otherwise. Being permissive here would mean fighting PM for
  // the scroll position on every keystroke.
  //
  // DUPLICATED ON PURPOSE, and it must not stay duplicated. `main` carries
  // this rule as isDegenerateCaretRect in src/lib/editor/caret-scroll.js,
  // pure and tested, alongside a caretScrollDelta of its own — written for
  // the same bug in the desktop chrome, which is where PM's handler lives
  // (TipTapEditor's handleScrollToSelection). That file is not in this
  // branch yet; the weekly merge is overdue by 35 commits. At the P2b
  // boundary this becomes an import and this comment goes away, or the two
  // rules drift, which is the thing the rules exist to prevent.
  function isDegenerateRect(r) {
    return !(r.top < r.bottom || r.left < r.right) && r.left === 0;
  }

  /** The nearest ELEMENT ancestor of the caret's DOM position, which has a
   *  box where the caret's own rect may not. For the case this exists for —
   *  an empty paragraph whose only child is ProseMirror's trailing <br> —
   *  that ancestor IS the paragraph. It is not guaranteed to be a block in
   *  general: another degenerate position could stop at an inline mark span.
   *  Said precisely because "the block element" claims a guarantee the walk
   *  does not make, and this file has already corrected two comments whose
   *  reasoning was sound and whose conclusion overreached. */
  function blockRectAt(view, pos) {
    let node = view.domAtPos(pos)?.node ?? null;
    while (node && !(node instanceof Element)) node = node.parentNode;
    return node instanceof Element ? node.getBoundingClientRect() : null;
  }

  function keepCaretVisible() {
    // Not while the writer types in the focus line or another field: that
    // keyboard is not the editor's (caret-visible.js typingElsewhere).
    if (typeof document !== "undefined" && typingElsewhere(document.activeElement)) return;
    const band = scroller?.bounds();
    const view = selectionEditor?.view;
    if (!band || !view || view.isDestroyed) return;

    let head;
    let tail;
    try {
      // from is never after to, so from's top and to's bottom ARE the
      // selection's top and bottom; no min/max, and no decision, which is
      // why this stays here and caret-visible.js keeps the one that is.
      const { from, to } = selectionEditor.state.selection;
      head = view.coordsAtPos(from);
      tail = from === to ? head : view.coordsAtPos(to);
      if (isDegenerateRect(head)) head = blockRectAt(view, from);
      if (isDegenerateRect(tail)) tail = from === to ? head : blockRectAt(view, to);
    } catch {
      // coordsAtPos throws when the position has no rendered box yet — a
      // node view still mounting, a doc mid-replacement. Nothing to keep
      // visible means nothing to do; the next selection or keystroke asks
      // again a frame later.
      return;
    }
    if (!head || !tail) return;

    const delta = caretScrollDelta({
      caretTop: head.top,
      caretBottom: tail.bottom,
      bandTop: band.top,
      bandBottom: band.bottom,
    });
    // Guarded rather than handed a 0, and the suite cannot see the
    // difference — checked by removing the guard: 17 passed, unchanged,
    // because `scrollTop += 0` is a no-op to jsdom. It is here for the
    // device: writing scrollTop mid-fling stops the fling, and 0 is the
    // module's explicit answer for "already visible" rather than a
    // rounding artefact worth passing through. Said plainly instead of
    // dressed as a tested invariant.
    if (delta !== 0) scroller.scrollBy(delta);
  }

  /** What the last correction from the effect below answered to. A plain
   *  `let`: nothing rendered reads it, and it is written from inside the
   *  effect that reads it — $state there would invalidate the effect that
   *  just wrote it, which is a loop dressed as reactivity. */
  let lastCaretTrigger = null;

  $effect(() => {
    // WHAT THIS EFFECT READS, all of it, because the version before this one
    // named one dependency and had three — and the two it did not name are
    // the ones that fired.
    //
    //   keyboardOpen  the trigger, and the only read here that MEANS
    //                 anything. The band is shorter with the keyboard up and
    //                 a caret that was visible a moment ago may not be, and
    //                 no selection event fires when the keyboard alone moves.
    //
    //   scroller      read below through keepCaretVisible's `scroller
    //                 ?.bounds()`. Screen re-hands it on every nav-bar fold
    //                 AND unfold — its own mount effect calls our
    //                 handleScroll, which reads `collapsed`, so Screen's
    //                 effect is a subscriber to this screen's fold state —
    //                 and `$state` proxies the assignment, so even the
    //                 identical object comes back as a new identity and
    //                 invalidates. Nothing about a fold can hide a caret;
    //                 see caret-visible.js for why the geometry says so.
    //
    //   contentEl     Screen's own $state, reached transitively through the
    //                 two closures it lends us (bounds/scrollBy both read it
    //                 at call time). Stable for the life of the screen, and
    //                 harmless — listed because "the effect reads what the
    //                 lent capabilities read" is not obvious from here.
    //
    // The guard is what makes the last two cost nothing, and it also narrows
    // the dependency set in passing: on a refused re-check the effect returns
    // before touching `scroller` at all, so it re-registers `keyboardOpen`
    // and nothing else until the next real correction. Counted rather than
    // reasoned — instrumenting this line and driving four folds gave two
    // runs, the mount and the first re-hand, and then nothing at all: the
    // steady state really is one dependency.
    // `pan` is the second input, and on a platform whose layout viewport
    // shrinks for the keyboard it is 0 forever — caret-visible.js carries
    // the argument and the iOS report behind it. Read off the store the
    // viewport owner publishes, never off the viewport: this file is not
    // allowed a reader of its own and does not need one.
    // `stripRow` is the third, and it is the band's own height. The bottom
    // band holds an editor strip above the nav row now, and the strip comes
    // and goes on inputs this effect never hears about — find opening, a
    // sheet, a root switch — each moving the floor by a --tap with the
    // keyboard unchanged. Same gap `pan` closes, different cause.
    const trigger = { keyboardOpen, pan: $viewportSnapshot.vvOffsetTop, stripRow };
    if (!caretRecheckWarranted(lastCaretTrigger, trigger)) return;
    lastCaretTrigger = trigger;
    keepCaretVisible();
  });
</script>

<!--
  THE CONTENT BAND IS THE CANVAS, and the region goes on Screen's scroller
  rather than on `.ps-canvas` below it. §1's row is "canvas, vertical drag
  | scroll; swipe up at scroll bottom → memory; swipe down at memory's top
  → page", and the two facts that row needs — where the finger landed and
  whether the scroller is at its end — have to describe the SAME element or
  the answer is built from two different boxes. Screen owns the scroller,
  so Screen's element is the one that can carry both.

  Marking `.ps-canvas` instead would also cost the chrome around the prose:
  "what matters now" sits above it in this band and scrolls with it, and a
  swipe that begins there would fall through to "element" — a gesture that
  works over the text and dies an inch above it, which reads as the shell
  being broken rather than as a region boundary nobody can see.
-->
<Screen region="canvas" onScroll={handleScroll} onScroller={(s) => (scroller = s)}>
  {#snippet nav()}
    <PageHeader
      {dateLabel}
      {trailName}
      {trailParents}
      {pageCount}
      {pageNumber}
      {pinCount}
      {collapsed}
      {onDate}
      {onFind}
      {onPins}
      {onTrail}
      {onPages}
      {onNew}
    />
    <!--
      The pin's breadcrumb, in the NAV band rather than in the content —
      which is where Toast's own header said it would go, until something
      called it.

      The content band is the scroll container. A toast rendered at the top
      of it is above the fold for any writer who has scrolled, and a pin is
      taken wherever the caret is: on a page worth pinning from, that is
      almost never the first screenful. The one message this primitive was
      built for would have been invisible on the pages that most need it,
      and neither jsdom nor a load-time screenshot could show that — the
      harness scrolls to nothing.

      It stays in the flow, which is the property Toast's header was
      actually protecting: a DOM sibling in a column, positioned by
      nothing, never over prose. The cost, written down for the device pass
      rather than left to be met on a phone: the nav band grows by the
      toast's height while it is up, so the content band shrinks and the
      prose shifts by that much and back. Placing it in the content has the
      SAME shift for the same reason, so this buys visibility for nothing
      — but it is still a shift, and only a device can say whether four
      seconds of it reads as feedback or as a jolt.
    -->
    <Toast message={toast} />
  {/snippet}

  <!--
    THE FOCUS LINE IS TYPED HERE. It was two spans until the second device
    pass ("what matters are not clickable cannot change"): nothing in the
    shell had ever written `what_matters_now`, and the page's one title
    was a label the writer could read and not set. A writable page gets
    TitleField (src/shell/ui/), which is the desktop's WhatMattersNow input
    in the shell's face; a closed page keeps the text, because past pages
    are read-only and a field on one would be a control that cannot act.

    What a blur WRITES is focus-line.js's decision (`focusLineWrite`): a
    blur is not an edit, so the host is told only when the trimmed text
    differs from what the row holds. Enter hands the caret to the prose —
    the title is the first thing typed on a fresh page and the writing is
    the second.
  -->
  <!--
    WHY THE CANVAS IS QUIET. Without this the page simply stopped taking
    input: on an SM-A065F the whole visible text of a page refusing every
    keystroke was "9 oct · find · pins · + · page · memory · settings", and
    a writer tapping into it got no caret, no keyboard and no sentence.
    page-writable.js's own header had already named that the worse of the
    two failures, because it is indistinguishable from a broken app.

    ABOVE THE FOCUS LINE, not under it: it explains the whole surface
    below, including the missing field, and a page whose focus line is
    empty renders nothing there at all — which is exactly the page this
    sentence most needs to appear on. The words are readonlyNote's, picked
    from the same inputs as `readonly` itself.
  -->
  {#if refusal}
    <p class="ps-refusal">{refusal}</p>
  {/if}

  <!-- A save that did not land. Stays until one does (save-health.js); the
       editor keeps retrying on its own. -->
  {#if $saveHealth.failing}
    <p class="ps-save-failing" role="alert">not saved yet — trying again. your writing is still here.</p>
  {/if}

  <div class="ps-wmn">
    {#if readonly}
      {#if whatMattersNow}
        <span class="ps-wmn-text">{whatMattersNow}</span>
      {/if}
    {:else}
      <TitleField
        label="what matters now"
        placeholder="what matters now"
        tone="accent"
        bind:value={focusDraft}
        onCommit={commitFocusLine}
        onEnter={focusProse}
      />
    {/if}
  </div>

  <div class="ps-canvas" bind:this={canvasEl}>
    {#if gutterHandle.block}
      <!--
        The column carries the press, not the button: ToolbarButton acts on
        pointerdown and there would be nothing left to hold (see the header).
        The button element inside is still the control — it takes the tap target,
        the 44px floor and the label — so the interaction this div carries is
        measurement rather than an affordance of its own, which is what makes
        the ignore honest here.
      -->
      <!--
        THE HANDLE IS ITS OWN REGION, and what it buys is a withholding
        rather than an action. The column sits INSIDE the content band,
        which is marked "canvas" — so without this attribute every stroke
        that starts on the handle is a canvas stroke, and a quick upward
        flick off the handle at the scroll bottom (quicker than the 350ms
        that arms the lift, so `dragActive` is still false and the table's
        first row does not cover it) would leave the page for memory,
        carrying the writer out of the document from the one control whose
        whole job is to act on a block in it.

        The two owners this region DOES produce — "block-actions" on a tap,
        "block-lift" on a long-press — are deliberately not acted on by the
        host. This file already owns that press, decided by its own timer,
        because `recognise` is terminal and a lift that arrives at pointerup
        is a lift nobody can drag (pointer-gesture.js's header). A second
        actor on the same stroke is the bug class the whole table exists to
        end, so the table's answer here is precedence and nothing else.
      -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="ps-gutter"
        class:lifting={dragBlock}
        style="top: {gutterHandle.top}px"
        data-shell-region="gutter-handle"
        onpointerdown={pressDown}
      >
        <!--
          DRAWN, NOT TYPED. This was the character ⋮ (U+22EE) until a
          Galaxy A34 showed a 44px handle that was in the DOM, tappable,
          and invisible. The app bundles its fonts so it does not depend on
          what a platform happens to have — but DM Mono's subset is 138
          codepoints ending at U+2113, so every glyph in shell chrome was
          already being drawn by whatever the platform substituted, and
          this one sits in a block (Mathematical Operators) an Android
          fallback chain need not cover. Three spans cannot go missing.
        -->
        <ToolbarButton id="block-handle" label="block actions">
          <span class="ps-handle-dots" aria-hidden="true">
            <span></span><span></span><span></span>
          </span>
        </ToolbarButton>
      </div>
    {/if}

    {#if page}
      <EditorCore
        bind:this={core}
        pageId={page.id}
        initialContent={page.content_json ?? null}
        initialYjsState={page.yjs_state ?? null}
        {readonly}
        {trailMode}
        isTrailMode={trailMode === "continuous"}
        trailLineageId={page.lineage_id || null}
        lineageId={page.lineage_id || null}
        currentLineageId={page.lineage_id || null}
        currentLineageName={trailName || ""}
        floatingChrome={false}
        onSelectionUpdate={({ editor }) => {
          selectionEditor = editor;
          keepCaretVisible();
        }}
        onEditor={takeEditor}
        {onChartOpen}
      />
    {/if}

    <!--
      The drop indicator. Last in the canvas and above the lift's z-index so
      it paints over both the prose and the block being carried; it is the
      one piece of chrome in this band that is allowed over content, because
      a line drawn under the text it points between says nothing.

      data-index is the MODEL, not decoration. The VR gate compares at a
      0.002 ratio and this hairline is roughly that much of a phone frame on
      its own, so a screenshot alone cannot be trusted to notice it moving —
      P2c-2 watched a 44px control vanish with the baseline still green.
      The number the drop will actually use is readable here instead.
    -->
    {#if dropLineTop !== null}
      <div class="ps-drop-line" style="top: {dropLineTop}px" data-index={dropIndex}></div>
    {/if}
  </div>
</Screen>

<style>
  /* THE LEFT EDGE IS var(--tap) IN BOTH BANDS, and this line is the debt
     P2d wrote down being paid rather than a new opinion.

     P2b set this zone's inset to var(--space-4) when the canvas had the
     same one. P2d gave the canvas a var(--tap) gutter for the block
     handle and left this alone deliberately, saying a 28px alignment
     decision "should be made against a screenshot rather than in the
     dark". The number is 30px, not 28: --space-4 is 1rem and the phone's
     --ui-scale makes that 14px, while --tap has a 44px floor that no scale
     moves — so the gap is the one number in the pair that does not shrink
     with the type.

     What settles it without a screenshot is what the zone IS. This file's
     own header calls it a title — "it belongs to the page, so it scrolls
     with the page" — and the prose under it is that title's body. A title
     and its body are one column or they are a misalignment; the gutter is
     the canvas's reserved column, but the TEXT COLUMN starts where the
     text starts, and that is what these two align to. The zone does not
     grow a handle by aligning with the band that has one.

     The right edge stays var(--space-4) in both, which makes the column
     asymmetric — the same trade the canvas already took and the desktop
     gutter took before it.

     THE FACE IS THE READING FACE (visual pass, Task 9). The zone was set
     in the interface face at --text-sm, which is the role the shell gives
     to what the interface NAMES — a bar's action, a row's value, an
     eyebrow. This line is none of those: it is the writer's own sentence
     about the day, the same line the reading view sets as its Title in
     Lora, and the desktop's `.pv-matters` before it. A title in the label
     face over a body in the prose face reads as chrome sitting on the
     page rather than as the page's first line. So --font-prose at
     --text-base — a step under Title's --text-xl, because on the writing
     surface it sits ABOVE the prose it names and must not outweigh it.
     The face lives in TitleField (src/shell/ui/) as of the second device
     pass, which is where the plan's gate wants every title's font-family;
     this zone keeps the face only for the read-only span, and it is the
     one named font-family exemption left outside src/shell/ui, because
     no primitive is a one-line title set (not typed) in the canvas's
     gutter column. The field takes --text-base through --title-field-size
     (TitleField's default), floored at 16px by the primitive. */
  .ps-wmn {
    display: flex;
    align-items: baseline;
    min-height: var(--tap);
    padding: var(--space-2) var(--space-4) 0 var(--tap);
    font-family: var(--font-prose);
    font-size: var(--text-base);
    line-height: var(--leading-base);
  }

  .ps-wmn-text {
    padding: var(--space-2) 0;
    color: var(--ink);
  }

  /* Chrome, not prose. It takes the interface face and the muted ink the
     shell gives every line that is ABOUT the writing rather than part of
     it — the same register as the provenance line — so a reader scanning
     the column does not take it for the first sentence of the page.

     Aligned on the gutter like the focus line and the canvas below it, so
     the three start on one edge; `--tap` on the left is that gutter, which
     .ps-wmn and .ps-canvas both already use. */
  .ps-save-failing {
    margin: 0;
    padding: var(--space-2) var(--space-4) 0 var(--tap);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    line-height: var(--leading-base);
    color: var(--accent-text);
  }

  .ps-refusal {
    margin: 0;
    padding: var(--space-2) var(--space-4) 0 var(--tap);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    line-height: var(--leading-base);
    color: var(--ink-soft);
  }

  /* The left inset IS the gutter: spec §2's 20px side padding plus its
     24px gutter, which is one touch target exactly. The handle sits flush
     in it and stops where the text starts — see the header for what a
     narrower inset costs. `relative` is what makes that offset local: the
     handle is placed inside this box, never against the viewport. */
  .ps-canvas {
    position: relative;
    padding: 0 var(--space-4) var(--space-8) var(--tap);
  }

  .ps-gutter {
    position: absolute;
    left: 0;
    display: flex;
    justify-content: center;
    width: var(--tap);
  }

  /* While a block is lifted the handle is the thing being held, so it
     stays visible rather than fading with the rest of the chrome. Colour
     only — moving it would make the column jump under a stationary
     finger. */
  .ps-gutter.lifting {
    color: var(--accent-text);
  }

  /* currentColor throughout, so `.lifting` above still recolours it and the
     disabled/active states of the button it sits in still reach it. */
  .ps-handle-dots {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }

  .ps-handle-dots span {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: currentColor;
  }

  /* THE LIFT. §3: "slight scale, strong shadow tier." The block is
     ProseMirror's own DOM, so the rule is :global and the class is applied
     by the effect above rather than by this template.

     `relative` + a z-index, and never the positioning scheme that leaves
     the flow — the answer to the plan's first known unknown, and it is not
     merely the rule shell-rules.test.js enforces (that rule is a text
     scan, so naming the declaration here even in prose would make this
     file its first offender). A block taken out of the flow would resolve
     against the viewport and stop scrolling with the page it belongs to,
     so the
     canvas's auto-scroll (Task 2) would slide the document out from under
     a block standing still. Transform keeps the block in the flow, in its
     own scroller, and leaves Task 2 a translate to add rather than a
     positioning scheme to undo.

     transform-origin is the LEFT edge: scaled from the centre, a
     full-width paragraph grows into the gutter and under the handle the
     finger is holding. */
  /* THE DROP INDICATOR, and how it is placed. Absolute inside .ps-canvas,
     which is the same containing block the gutter handle already uses and
     for the same two reasons. The rule shell-rules.test.js enforces is one
     of them — only Sheet and the shell root may leave the flow — and the
     other is the one Task 1 wrote down for the lift: the canvas auto-scrolls
     while a block is held at an edge, and a box resolved against the
     viewport would stand still while the document it points into slid past
     underneath. An absolutely positioned child of the canvas scrolls with
     the canvas, so the offset here is a position INSIDE the document, in
     the same units the lift-time rects were converted to.

     Inset to the text column rather than the full band: left at the gutter,
     right at the canvas's own padding, so the line spans exactly the prose
     it is pointing between and never crosses the handle the finger is on.

     2px, not 1. A hairline is what §3 asks for and 1px is what that reads
     as, but at 412px wide a 1px line is ~0.0012 of the frame and the VR gate
     compares at 0.002 — it could move, or vanish, with the baseline still
     green. 2px is over that line, and data-index above is what makes the
     assertion independent of it either way.

     pointer-events: none because the finger is mid-stroke and everything
     downstream is listening on window; a box that hit-tests here would
     take a hover it has no use for and, on the frame it lands under the
     finger, whatever the browser does with an element appearing mid-touch. */
  .ps-drop-line {
    position: absolute;
    left: var(--tap);
    right: var(--space-4);
    height: 2px;
    /* Centred on the boundary rather than hanging below it: the offset is a
       block's top edge, and a line drawn from there sits entirely inside the
       block below, which reads as underlining that block rather than as a
       gap between two. */
    margin-top: -1px;
    border-radius: 1px;
    background: var(--warm-accent);
    z-index: 2;
    pointer-events: none;
  }

  :global(.ps-lifted) {
    position: relative;
    z-index: 1;
    transform: scale(1.02);
    transform-origin: left center;
    box-shadow: 0 0.5rem 1.5rem var(--card-shadow-hover);
    border-radius: var(--radius-sm);
    background: var(--canvas-bg);
  }
</style>
