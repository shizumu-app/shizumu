<!--
  The shell's root host: the frame, the bottom slot's tab bar, and whichever
  root is showing.

  Three bands and no fourth (spec §2). ShellRoot owns the insets and the
  slot's height; this file owns only which root's screen sits in the content
  band, so switching roots can never move the chrome around it.

  The active root is $state here rather than in TabBar because TabBar is
  fully controlled — it renders `active` and calls back, and re-tapping the
  root you are already on is inert inside it. A bar that kept its own
  selection would have two answers to "where am I" the moment a host
  navigated for any reason other than a tap.

  `page` is written as a literal rather than read as ROOTS[0].id: home is
  the page because it is the page, not because it happens to be leftmost,
  and a future reorder of the bar must not silently change which root the
  app boots into.

  Memory and settings are placeholders, and say so on screen rather than in
  a comment — P3 and P4 build them. A placeholder that renders as an empty
  band is indistinguishable from a root that broke, and the shell is about
  to be handed to Play testers behind `try the new shell`.

  keyboardOpen goes to PageScreen, which is what collapses under it, and to
  toolbarFor, which decides what sits above the nav row. What it no longer
  goes to is ShellRoot: the canvas gesture table asks `editing` instead,
  which this component derives from real DOM focus (see `editing` below).
  What that decides is worth knowing at this end: while the writer is
  typing, the canvas's two space-switch outcomes degrade to "scroll", which
  is gesture-arming.js's rule folded into the table, and it is why a fast
  return-key drag mid-keystroke does not throw the writer into memory.

  This file is where the shell first touches real data. For all of P2a it
  was rendered as `<S />` with no props at all, so every value below sat on
  a static default and the header read "today" on any date — a placeholder
  shaped exactly like data. The load below is what ends that: today's page
  comes from the same getOrCreateToday() the desktop tree calls, and
  page-model.js turns the row into what the two-line bar shows.

  The P2a props survive as OVERRIDES rather than as the source, so a
  harness can pin the header without a backend. Their limit, written down
  because `??` hides it: passing null is not an override, it reads as
  absent and the loaded page wins. Nothing needs to force "no trail" today,
  and the day something does, it wants an explicit sentinel rather than a
  reader guessing which null meant which.

  The ROW goes down alongside those fields, not instead of them. The header
  wants four labels and page-model.js makes them here; the canvas wants the
  page itself — its id, its content, its lineage — and re-deriving that into
  four more props would be a second shape of the same row to keep in sync.
  So the derived labels stay overridable and the row travels whole. The
  overrides do not reach the canvas: pinning `dateLabel` for a harness must
  not make the editor open some other page.

  The trail's MODE travels the same way, and it is not a label: nothing in
  the header renders it. It goes down beside the row because the canvas
  cannot answer which save route a page takes without it, and that answer
  is the difference between an edit persisting and an edit being discarded
  — PageScreen's comment carries the chain. It gets no override for the
  same reason the row gets none: a harness pinning the header must not
  change how the editor writes.

  THE EDITOR AND ITS SNAPSHOT come back UP from the canvas and are held
  here, a band away from the file that mounts them, because the bottom
  slot is here. ShellRoot's `slot` snippet is a SIBLING of the content
  band, not a child of it, so a strip that wants to bold what the caret
  sits in cannot reach the editor from inside PageScreen at all. Up and
  back down is the shortest honest path, and it is the same shape the
  header's four labels already take.

  Both `takeEditor` and `takeSnapshot` are named function declarations
  rather than inline arrows for a mechanical reason: PageScreen's
  subscription effect reads `onSnapshot`, so a fresh arrow on every
  re-render would tear the subscription down and rebuild it on state
  changes that have nothing to do with the editor.

  THE SLOT IS MODAL from this task on, and this file is toolbarFor's
  FIRST caller since it was written in P1a. What that first call turned
  up, written here because the next reader will otherwise re-derive it:

    - `activeIdsFor` wants a bag of booleans keyed by BUTTON ID, and the
      snapshot carries no marks at all — computeSnapshot reports the
      selection, the undo depth, the active block and the live query, and
      nothing about bold. So the marks are read off the editor here, keyed
      off the snapshot so the read re-runs on the transaction that changed
      them. That is the seam Task 1's module was shaped for ("the caller
      reads those from the editor"), but it means the id-to-mark mapping
      below is real translation, not an alias table. The `list` button is
      the case that proves it: there is no `bulletList` node in this
      schema at all, and no toggle command for one either — both tables
      below carry the finding and the source lines.
    - row 4 (`suggestion-strip`) was fed a hardcoded null rather than the
      snapshot's own query, because the row emitted an EMPTY button list
      and passing the live query would have blanked the slot for as long
      as a slash or mention trigger was open — the reserved-but-empty band
      ShellRoot's header calls a bug, arriving on the single most common
      keystroke in the editor. The defence was to keep the row switched
      off. P2c-2 Task 4 fixed the row instead: it takes the chips as a
      second input and declines the slot when it has none, so the query is
      passed for real now and the chips are the slash menu the phone has
      no floating menu to show. Rows 2 and 4 were both hardcoded for this
      one reason and neither is any more.
    - row 2 (`find-strip`) HAS a producer from P2c-2 Task 2 on, and it is
      the header's `find`, not anything in the slot. The rationale is
      recorded in PageHeader's own header; what belongs here is what the
      producer costs this file. `findOpen` outranks every other row except
      an open sheet (toolbar-model.js), so while it is true the tab bar,
      the block strip and the selection strip are all gone — which makes
      `close` the only way out of the mode and therefore the one control
      this task had to wire, ahead of the strip that owns the other three.
      A find mode whose only exit is dead is a trap, and it would have
      been one for exactly the length of a task.
    - row 1 (`none`) was wired and UNREACHABLE for a phase: both of its
      inputs were hardcoded false because the shell had no sheet and no
      pushed screen, so no test could drive it. `sheetOpen` has a real
      producer from P2d Task 3 on, and the branch does what it claimed —
      both hasStrip and hasNav go false, so the frame stops reserving the
      band rather than reserving an empty one. Proven by forcing the input back to
      false with the sheets in place: exactly one test goes red, "empties
      the slot behind it". `pushedScreen` got its producer in P3 Task 1
      and the row now has two ways in — the pins screen is pushed onto
      Stack and `pushed.length` is the input, so both of row 1's clauses
      are reachable from the app for the first time.

  WHICH IDS HAVE A HANDLER decides which ids are ON THE STRIP AT ALL, and
  the list is derived from the command table rather than written down a
  second time. A literal list of "not built yet" ids is free to drift the
  moment a command is added, and drift in this direction is silent — an id
  with no handler renders as a live button that eats the tap and does
  nothing, and the strip gives no feedback either way. Deriving it means
  adding a command is the whole change.

  ONE id has no handler: `link`, which wants somewhere to type a URL. It is
  in toolbarFor's selection strip and never on screen, because
  `unavailableIds` below drops it before the strip renders.

  HIDDEN, NOT GREYED, since the visual pass (2026-09-15). Every control the
  shell could not run used to render dead in place, and a strip a third
  grey at rest reads as a third broken. toolbar-state.js's `stripPresence`
  draws the line this file feeds it: a control that cannot apply to THIS
  block or page is absent (`link` everywhere; `turn into` beside a block
  with nowhere to go; `insert` on a closed page; `pin` on a block with
  nothing to keep, or already kept); a control that could apply here but
  not right now stays and is dead (`undo` with nothing to undo, find's
  arrows on no match, `pin-selection` on an empty range). The four
  hidden ones each have a reason the writer can act on only by being
  somewhere else, which is what makes absence the honest rendering.

  `pin` and `pin-selection` had no handler for four phases, and the reason
  recorded here was that confirmPin's category and title are a decision
  EditorCore deliberately leaves to its host (:666) — so choosing one in
  the file that renders the toolbar would be inventing product behaviour
  where nothing could reach it. That is still the reason; what changed in
  P2f Task 1 is that the decision now has somewhere to live. pin-intent.js
  is it, and this file only reads the editor for it and hands the answer
  to the core.

  `type` and `insert` got their handlers in P2d Tasks 3 and 4. `type`
  opens the same turn-into sheet the gutter handle's `convert` row does,
  and both ask turnIntoRowsOf whether this block has anywhere to go — a
  paragraph has two places since the visual pass (turn-into-model.js: list
  and heading), so the button is present beside nearly every block and
  absent beside the few with no shape to take. `insert` is absent only on
  a CLOSED page, where every row it could offer writes to a document the
  editor beneath is already refusing to change.

  WHAT OPENING A SHEET COSTS THE KEYBOARD, and the one place the shell
  restores focus. A ToolbarButton preventDefaults its pointerdown, so a
  tap on the strip or on the gutter handle never moves focus and the
  keyboard never drops — which is why none of the COMMANDS chains above
  call focus(). A sheet Row renders a real button element and does not
  (spelled out rather than written as the tag, which the rules test scans
  for as plain text and has caught from inside prose before), so tapping a
  row genuinely blurs the editor. The row actions therefore DO restore
  focus, with scrollIntoView off (keeping the caret visible is
  caret-visible.js's job, measured against the real frame). Nothing in the
  suite can see this: removing every restoreFocus() call leaves
  ShellApp.test.js at 35 passed, because jsdom has no soft keyboard and no
  layout. Recorded as a device-pass judgement rather than dressed up as a
  tested invariant — the same treatment the missing focus() above gets.
-->
<script>
  import { onMount, tick } from "svelte";
  import { resetKeyboardBaseline } from "../lib/keyboard-state.js";
  import { editorReadout } from "./editor-readout.js";
  import { dayMarkerStamp } from "./focus-line.js";
  import { lineagePath } from "../lib/trail-utils.js";
  import ShellRoot from "./ShellRoot.svelte";
  import TabBar from "./ui/TabBar.svelte";
  import ToolbarStrip from "./ui/ToolbarStrip.svelte";
  import FindStrip from "./ui/FindStrip.svelte";
  import SuggestionStrip from "./ui/SuggestionStrip.svelte";
  import PageScreen from "./PageScreen.svelte";
  import PinArtifactScreen from "./PinArtifactScreen.svelte";
  import PinsScreen from "./PinsScreen.svelte";
  import TrailScreen from "./TrailScreen.svelte";
  import MemoryScreen from "./MemoryScreen.svelte";
  import ReadingScreen from "./ReadingScreen.svelte";
  import SettingsScreen from "./SettingsScreen.svelte";
  import SettingsSectionScreen from "./SettingsSectionScreen.svelte";
  import SyncDevicesScreen from "./SyncDevicesScreen.svelte";
  import LockSettingsScreen from "./LockSettingsScreen.svelte";
  import { announceLockSettings } from "../lib/auto-lock.js";
  import SyncPairScreen from "./SyncPairScreen.svelte";
  import SyncScanScreen from "./SyncScanScreen.svelte";
  import SyncSetupScreen from "./SyncSetupScreen.svelte";
  import Stack from "./ui/Stack.svelte";
  import Sheet from "./ui/Sheet.svelte";
  import Row from "./ui/Row.svelte";
  import RowGroup from "./ui/RowGroup.svelte";
  import Note from "./ui/Note.svelte";
  import Segment from "./ui/Segment.svelte";
  import Calendar from "./ui/Calendar.svelte";
  import Field from "./ui/Field.svelte";
  import TableSizeGrid from "./ui/TableSizeGrid.svelte";
  import ChartForm from "./ui/ChartForm.svelte";
  import { ROOTS } from "./roots.js";
  import { pageHeaderModel } from "./page-model.js";
  import { pageReadonly } from "./page-writable.js";
  import { dayRows, daySheetNote, markerRows, DAY_SHEET_NOTE, pageSheetRows as composePageSheetRows } from "./page-picker.js";
  // The header's dot is a POSITION, and this is the module that says so.
  import { ordinalOf } from "../lib/page-ordinal.js";
  import { trailSheetRows, trailSheetSubmit } from "./trail-sheet-model.js";
  import { toolbarFor } from "./toolbar-model.js";
  import { midnightDue } from "./midnight.js";
  import { currentPlatformProfile } from "./platform.js";
  import { activeIdsFor, disabledIdsFor, stripPresence } from "./toolbar-state.js";
  import { turnIntoRows } from "./turn-into-model.js";
  import { findStripModel } from "./find-strip-model.js";
  import { suggestionChips } from "./suggestion-strip-model.js";
  import { mentionChips } from "./mention-chips.js";
  import {
    mentionItems,
    commitMention,
    mentionOptionsOf,
    MentionCommandPluginKey,
  } from "../lib/extensions/mention-command.js";
  import { blockSheetRows } from "./block-sheet-model.js";
  import { chartDraft, withKind, chartCanCommit, chartAttrs } from "./chart-draft.js";
  import { pinIntent, pinRefusal } from "./pin-intent.js";
  import { stampedPinIds } from "../lib/pin-node.js";
  import { insertMenuSections, firstInsertRow } from "./insert-menu.js";
  import { monthOf } from "./calendar-month.js";
  // The scopes the trail sheet offers — the same list memory's map hangs
  // its blocks on.
  import { noTrailMatches, trailIndexRows } from "./trail-index.js";
  import { untrailedPageCount } from "../lib/memory-trails.js";
  import {
    moveUnderRows,
    pinTrailRows,
    pinTrailValue,
    renameIntent,
    scopeRowAction,
    trailDeleteLabel,
    trailDeleteNote,
    trailErrorText,
  } from "./trail-manage.js";
  import { blockPinnable } from "./block-pinnable.js";
  import { pinToastMessage, carryForwardMessage, PIN_TOAST_MS } from "./pin-toast.js";
  import { settingsGroups, settingsRowScreen, settingsSection } from "./settings-model.js";
  import { runExportZip } from "../lib/export/run.js";
  import { SHELL_SWITCH_KEY, shellSwitchChecked, shellSwitchValue } from "./shell-switch.js";
  import { UNNAMED_NEW_DEVICE, disconnectSheet, pairErrorText, pairSide } from "./sync-model.js";
  import {
    DEFAULT_DEVICE_LABEL,
    PHRASE_COPIED,
    PHRASE_FAILED,
    defaultRelayChoice,
    deviceLabelFor,
    normalizePhrase,
    phraseProblem,
    relayProblem,
    relayUrlFor,
    setupErrorText,
    setupNext,
    setupVerb,
  } from "./sync-setup-model.js";
  import { isYjsEnabled, setYjsEnabled } from "../lib/yjs/feature-flag.js";
  import {
    DATE_RANGES,
    DEFAULT_RANGE,
    DEFAULT_SORT,
    SEARCH_DEBOUNCE_MS,
    SORTS,
    memoryFilterCount,
    mergePinRows,
    removeMemoryFilter,
    showEverythingPatch,
    yesterdayOf,
  } from "./memory-model.js";
  import { navBack, subscribe as navSubscribe } from "../lib/navstack.js";
  import { pageAddress } from "../lib/page-address.js";
  import { buildCarryForwardNodes, pinToNodes } from "../lib/pin-carry-forward.js";
  import { pinMoreSheet } from "./pin-more-sheet.js";
  import { pinRowLabel } from "./pin-label.js";
  import { getLocalDateStr } from "../lib/utils.js";
  import { listen } from "@tauri-apps/api/event";
  import { pulledReadAddress, pulledPageAction, pullRefreshTargets } from "./pull-refresh.js";
  import {
    isAttachmentBlockNode,
    soleAttachmentNode,
  } from "../lib/editor/block-pin-guard.js";
  import { isBoardType } from "../lib/extensions/block-title.js";
  import { pinTitleAuthority } from "../lib/pin-title-authority.js";
  import { writePinEdit, textIntoNode, findPinNode } from "../lib/pin-edit-route.js";
  import { withNodesAtPinId, withTitleAtPinId } from "./pin-rename.js";
  import { stampPinRun } from "../lib/pin-run.js";
  import { nodeKind, pinDisplayTitle } from "../lib/pin-display.js";
  import { convertTargetsFor, convertBlockNode } from "../lib/editor/block-convert.js";
  import { commandItems, SlashCommandsPluginKey } from "../lib/slash-commands.js";
  import { needsFreshLine } from "../lib/editor/slash-insert-target.js";
  import { DEFAULT_HOVER, gridCellsFor } from "../lib/editor/table-size-picker.js";
  import { deleteBlockAt } from "../lib/extensions/block-delete.js";
  import { moveBlockAtPos } from "../lib/extensions/block-movement.js";
  import { TextSelection } from "@tiptap/pm/state";
  import {
    getOrCreateToday,
    getLocalToday,
    getPage,
    getCanonicalTrailPage,
    createNewPage,
    deleteFocus,
    getAdjacentPage,
    getThread,
    getFocusesForDate,
    getLineages,
    createLineage,
    setFocusLineage,
    getCarryForwardPins,
    getPins,
    // 0.8.2: the trail sheets' `pages · pins` and the pins screen's
    // `all trails` count — two read-only aggregates, one SELECT each.
    getTrailPageCounts,
    getTrailPinCounts,
    updatePinAutoInsert,
    updatePinContent,
    // The focus line's one write (commitFocusLine). The shell rendered the
    // line as text for five phases and never called this; the second
    // device pass found the title could be read and not set.
    updateWhatMattersNow,
    // A board rename's cross-page half (savePinDraft): the pin's node is on a
    // page this editor is not showing, so its source is loaded, the slot
    // rewritten, and the page saved back through the pin-refresh hook.
    loadPageContentForModal,
    savePageContentWithPinRefresh,
    deletePin,
    getPinForReference,
    searchPages,
    getSetting,
    setSetting,
    // The account's one lock (LockSettingsScreen, src-tauri/src/account_lock.rs):
    // the laptop's four lock commands, now on the phone too.
    checkEncryptionStatus,
    setupEncryption,
    changePassphrase,
    removeEncryption,
    setLockTimeout,
    // The sync stack's fourteen, and only these — of the thirty-odd sync
    // commands api.js exposes: seven for the devices list and the pairing
    // exchange, seven more for setup (the account wizard, on the phone
    // since 2026-09-17 — sync-model.js's header says why). `syncStatus`
    // is renamed on the way in: the shell holds the snapshot it returns
    // in a variable, and a variable sharing a name with the command that
    // fills it is how a call gets made where a read was meant.
    syncStatus as readSyncStatus,
    listDevices,
    pairExistingStart,
    pairExistingFetchSas,
    pairExistingConfirm,
    pairNewJoin,
    pairNewComplete,
    syncGeneratePhrase,
    syncRelayHealth,
    syncInit,
    syncRecover,
    syncSelfEnroll,
    syncSetEnabled,
    syncForcePull,
    // Task 9g: the sync screen's `disconnect`, the desktop's own reset.
    syncReset,
    // Task 9e: the laptop's trail management (LineageSelector) and its pin
    // scope move (SharedObjectsPanel), the same four commands.
    renameLineage,
    setLineageParent,
    deleteLineage,
    updatePinScope,
    emitTrailMutated,
  } from "../lib/api.js";

  /** THE TWO APPEARANCE PROPS ARE NOT OVERRIDES, unlike the five header
   *  fields above them, and the difference is the whole reason settings
   *  can offer a tone at all.
   *
   *  `data-tone` and `data-font-family` have exactly one owner: App.svelte,
   *  which applies both at boot, resolves `system` against
   *  prefers-color-scheme, and keeps a matchMedia listener that re-applies
   *  when the OS theme changes under a `system` choice. A shell that wrote
   *  the attribute itself would be a second owner of one attribute AND
   *  would leave that listener holding a stale `tone` — pick `system` here
   *  and the OS switch would stop following.
   *
   *  So the shell does what the desktop's own Settings does: it reports the
   *  choice upward and persists the setting itself. The host applies. Both
   *  halves are needed — `onTone` repaints now, `setSetting` is what makes
   *  it survive a relaunch — and neither is the other's fallback.
   *
   *  @type {{
    dateLabel?: string,
    trailName?: string | null,
    pageCount?: number,
    pageNumber?: number,
    whatMattersNow?: string,
    keyboardOpen?: boolean,
    editing?: boolean,
    tone?: string,
    onTone?: (tone: string) => void,
    fontFamily?: string,
    onFontFamily?: (family: string) => void,
  }} */
  let {
    dateLabel = undefined,
    trailName = undefined,
    pageCount = undefined,
    pageNumber = undefined,
    whatMattersNow = undefined,
    keyboardOpen = false,
    /** A text field has focus — the writer is in the text, whether or not
     *  the soft keyboard is on screen. App.svelte derives it from the DOM,
     *  beside the keyboard store it already owns; this component is handed
     *  the answer the same way it is handed `keyboardOpen`, rather than
     *  reading the document itself. The editing strip keys on this (see
     *  toolbar-model.js) and so does the canvas gesture table. */
    editing = false,
    tone = "cream",
    onTone = () => {},
    fontFamily = "lora",
    onFontFamily = () => {},
  } = $props();

  /** THE PLATFORM SEAM, READ ONCE. `platform.js` is the only file in
   *  `src/shell/` allowed to look at the OS, and this is its only call:
   *  every field below travels down as a prop, so a screen that needs one
   *  asks its parent rather than asking the device a second time. A second
   *  reader is how "one look on iOS and Android" rots back into two trees.
   *
   *  Neither `$state` nor `$derived`: the platform cannot change under a
   *  running app, and making it reactive would only invite the belief that
   *  it can.
   *
   *  WHAT IS WIRED, AND WHAT IS HONESTLY STILL UNREAD.
   *
   *  `edgeBackArmed` is wired, to BOTH ShellRoot and Stack, and it has to
   *  be both: the root decides who OWNS an edge stroke, Stack decides
   *  whether the screen follows the finger, and the two default to `true`
   *  independently. Either one left armed puts the shell's own back beside
   *  Android's system gesture, which is the competing pair that swung
   *  between firing on every scroll and never firing at all across the
   *  v0.6.x releases (§1, "Removed"). Two mechanisms can hide each other,
   *  so both are wired here and both are held by a test.
   *
   *  The other five are read by nothing, each for its own reason:
   *
   *  `back` ("who draws the control") has no branch to feed. The shell
   *  draws NavBar's back button on every platform, and taking it away on
   *  Android is a design decision §5 does not make — its row is about the
   *  GESTURE, and the button is the visible, focusable equivalent that
   *  ShellRoot's own header leans on to justify routing gestures at all.
   *
   *  `popstateBack` has no consumer because gating one would change
   *  nothing. `navstack` listens for popstate unconditionally
   *  (`src/lib/navstack.js`), web and Android both send it, and iOS sends
   *  none — so the listener is already correct on all three, and a gate
   *  would be a wire to nothing wearing the shape of a wire.
   *
   *  `haptics` and `statusBar` name Tauri plugins this tree cannot add: a
   *  Cargo dependency, registration in `lib.rs`, a capabilities entry —
   *  all inside `src-tauri/`, which the two-tree rule (CLAUDE.md) puts off
   *  limits on this branch. There is no call here to gate, and inventing a
   *  no-op to gate would be worse than leaving the field unread.
   *
   *  `backAtRoot: "background"` is the one that is OWED rather than
   *  absent, and it is a device-pass finding for P5. Backgrounding on
   *  Android is `moveTaskToBack`, which nothing in JS can reach — it wants
   *  a Tauri command, so it wants Rust. Today, at the page root with
   *  nothing open, the shell performs nothing for a back: the Esc handler
   *  returns at `navDepth === 0`, and navstack leaves an empty stack alone.
   *  That is the whole of what iOS and web want and short of what Android
   *  wants — whatever its WebView does with a back press at an empty
   *  history, the shell has never asked it to background. Written down for
   *  the device pass rather than faked with a history trick, which would
   *  look like a background and be an unload. */
  const platform = currentPlatformProfile();

  let active = $state("page");

  /** The row from getOrCreateToday().page, or null until the load lands. */
  let page = $state(null);
  /** The id of the row getOrCreateToday() last returned: today's page by
   *  the backend's say-so. page-writable.js treats it as writable by
   *  identity, so no frontend clock has to agree that it is today — the
   *  WebView's can be an hour out on a phone with stale tz data, and
   *  clockDay falls back to it whenever local_today cannot answer. Set
   *  only through `rememberToday`, at every getOrCreateToday site. */
  let todayPageId = $state(null);
  function rememberToday(row) {
    if (row?.id != null) todayPageId = row.id;
    return row;
  }
  /** The device's day when that row came on screen — midnight.js's second
   *  input. Declared beside `page` rather than down in the midnight block
   *  that reads it, because `adoptPage` (the one writer, ~1550) runs far
   *  above that block: a `let` declared below its only writer is a
   *  temporal-dead-zone throw away from a reorder nobody would question. */
  let pageOpenedOn = $state(null);
  let loadedTrailName = $state(null);
  /** Its ancestors, root first, for the header's crumb — see trail-crumb.js. */
  let loadedTrailParents = $state([]);
  let loadedTrailMode = $state(null);
  let loadedPageCount = $state(null);
  /** This page's POSITION in its day, 1-based — what the header's dot row
   *  means by a dot. Never `page_number`; see page-ordinal.js. */
  let loadedPageOrdinal = $state(null);

  /** The TipTap instance the slot's buttons will act on, or null while
   *  there is no canvas. EditorCore hands over null on its own teardown
   *  (EditorCore:482), so this is never a destroyed editor. */
  let editor = $state(null);

  /** What the strips render from. null until the first snapshot arrives,
   *  which is a state EMPTY_SNAPSHOT cannot express: "no editor" and "an
   *  editor with an empty selection" decide different rows of toolbarFor,
   *  and importing EMPTY_SNAPSHOT here would collapse them into one. */
  let snapshot = $state(null);

  /** EditorCore's own instance, for the ONE member the editor cannot
   *  answer for: `confirmPin`. Everything else the slot presses goes
   *  through `editor`, and this is deliberately not a second route to the
   *  same things — pinning is the one command in the table whose work is
   *  a database row plus a stamp plus a flush, and all three live on the
   *  core rather than on the TipTap instance it wraps.
   *
   *  PageScreen holds the same instance by bind:this and hands it up
   *  through `onCore` (its header argues the route). It arrives null on
   *  teardown, so this is never a dead component by the time anything
   *  reads it. */
  let core = $state(null);

  function takeEditor(ed) {
    editor = ed;
  }

  function takeCore(c) {
    core = c;
    // The picker's only way to speak. `image` and `file` report a failed
    // read, a refused file and a failed insert through
    // `editor.options.element.__shizumuShowToast`
    // (slash-commands.js:398) — a property the desktop sets and the shell
    // never did, so all three were SILENT here. The refusal is the one
    // that matters: `accept="image/*"` is a picker hint, not a gate, and
    // every file dialog offers an "all files" escape, so a PDF chosen for
    // /image is refused with a message explaining what WOULD work. Without
    // a host the writer picks a file and nothing happens at all.
    //
    // Set here rather than in PageScreen because this is where the toast
    // lives; `getElement()` is EditorCore's public surface for exactly
    // this kind of host wiring.
    const el = c?.getElement?.();
    if (el) el.__shizumuShowToast = showToast;
  }

  function takeSnapshot(s) {
    snapshot = s;
    // The diagnostic readout's copy, published from the value this
    // component already holds rather than by a second subscriber to the
    // editor — see editor-readout.js. Off in every normal build; this
    // write happens either way, because a branch here would be a second
    // thing that can be wrong about whether the readout is on.
    editorReadout.set({
      activeBlock: s?.activeBlock ? { type: s.activeBlock.type, pos: s.activeBlock.pos } : null,
      canUndo: !!s?.canUndo,
      seen: true,
    });
  }

  /** Is a block lifted right now. gestureOwner's FIRST row — "a live block
   *  drag wins outright" (gesture-owner.js:105) — reads this, and until
   *  P2e it had no producer anywhere in the tree: fourteen tests over a
   *  table whose top row could not fire.
   *
   *  It lives HERE and not in PageScreen for the reason the editor and the
   *  snapshot do: ShellRoot is this file's child and PageScreen's parent,
   *  so the canvas that knows a block is lifted cannot tell the frame
   *  without going up. Same shape as onBlockHandle — the canvas owns what
   *  happens in its own band, the host owns what the shell does about it.
   *
   *  A named function rather than an inline arrow, like takeEditor and
   *  takeSnapshot, so a re-render does not hand PageScreen a fresh
   *  callback identity on every state change. */
  let dragActive = $state(false);

  function takeDragActive(active) {
    dragActive = active;
  }

  // ── the push stack, and the router that feeds the table ───────────────
  //
  // Four pieces built in P1b/P1d, reviewed, tested and never once run in
  // the app, wired here together because none of them can be proven
  // without the other three: `Stack` (rendered by nothing), `pushedScreen`
  // (hardcoded false in toolbarFor's row 1), `data-shell-region` (read by
  // ShellRoot, written nowhere) and `onGesture` (never passed, so the
  // root's own down() returned on the first line of every pointerdown).
  //
  // WHAT THE ROOT'S ROUTER ACTS ON HERE, and what it deliberately does
  // not. gestureOwner names an owner; the owner acts, once. Three of its
  // answers have their actor in this file — "memory" and "page" are the
  // space switch the tab bar performs by tap, "page-switch" is the pages
  // sheet the dots open by tap — and the rest have theirs elsewhere and
  // must not be performed twice:
  //
  //   "back"  — Stack performs it, and only Stack can. The router is
  //     TERMINAL: it recognises at pointerup, so it cannot make the screen
  //     follow the finger, and it has neither the drag's distance nor the
  //     screen's width, which is the whole of stack-back.js's commit rule.
  //     A second actor would be harmless TODAY and only by accident:
  //     popScreen is `pushed.slice(0, -1)`, and the stack the shell can
  //     reach is one deep, so a second pop on an already-empty array
  //     removes nothing. Probed rather than assumed — adding
  //     `if (g.owner === "back") popScreen()` reddens no test in the
  //     suite, which is the reason this is written down instead of
  //     claimed as a tested invariant. It stops being harmless the day
  //     anything pushes twice. What the row buys is precedence — it is what
  //     keeps an edge drag over a marked canvas from resolving as the
  //     canvas's, which is the regression ShellRoot.test.js names — and
  //     precedence is a real product, not a wire to nothing.
  //   "drag" — the block drag is PageScreen's, already in flight. The row
  //     exists to stop everything below it acting, which is exactly what
  //     falling through this switch does.
  //   "block-actions" / "block-lift" — PageScreen's gutter press owns
  //     both, decided by its own timer for the reason recognise() cannot
  //     be used for a lift (pointer-gesture.js's header).
  //   "sheet-dismiss" — Sheet performs its own, and cannot reach this
  //     router anyway: sheets render as SIBLINGS of the frame (see the
  //     comment above them), so a stroke on a sheet never bubbles through
  //     `.shell-root` and gestureOwner's two sheet rows have no producer
  //     on this route at all.
  //   "scroll" / "element" / "system" — the browser, the element under
  //     the finger, and the OS respectively. All three are answers that
  //     mean "not the shell's", and the shell taking them is the whole
  //     bug class the table exists to end.
  //
  // `edgeBackArmed` NOW COMES FROM THE PLATFORM SEAM — see `platform` in
  // the block above the props, which is the shell's one read of it. This
  // paragraph used to say the opposite, and what it described was a live
  // defect rather than a deferral: on Android gesture navigation the system
  // owns both edges, and the shell drew its own back beside the system's
  // for every release the shell has had.

  /** The screens pushed above the active root, shallowest first. Ids are
   *  minted rather than named after the kind: a pins screen popped and
   *  pushed again is a NEW screen, and reusing "pins" would let Stack's
   *  keyed each and navstack's registration both mistake it for the one
   *  that just left.
   *
   *  Each element carries a `kind`, and it is a kind rather than the
   *  snippet itself for the reason the snippets are declared at the top
   *  level at all: a snippet written as a direct child of a component is
   *  passed to that component as a prop, so a stack whose entries held
   *  views would have to build them where they cannot be written. The map
   *  from kind to view is one object beside those declarations. */
  let pushed = $state([]);
  let nextPushId = 1;

  /** Push one screen, and hand back nothing: every caller below wants the
   *  push to have happened before its own fetch starts, and none of them
   *  wants the id. Stack renders the new top on the next flush, which is
   *  what makes a "reading…" state visible while a round trip is in
   *  flight rather than after it. */
  function push(kind) {
    pushed = [...pushed, { id: `${kind}-${nextPushId++}`, kind }];
  }

  /** The rows PinsScreen renders, fetched on the push. See its header for
   *  why they are not read from a store the editor also keeps. */
  let pinList = $state([]);
  let pinsLoading = $state(false);

  /** The lineage those rows were READ for, frozen with them at the push.
   *  Not `page?.lineage_id` read live: the screen labels every row by its
   *  scope relative to this list's trail, and a lineage that changed
   *  underneath would re-caption rows the fetch never re-read. Two numbers
   *  describing one thing must come from one place — Stack's rule about dx
   *  and velocityX, applied to a list and the trail it belongs to. */
  let pinsLineage = $state(null);

  /** 0.8.2: the pins screen's `all trails` (spec §4, ruling 5). The rows
   *  are null until the chip is first pressed — reading them is a fan-out
   *  over every trail (memory's N+1, see loadMemory), which the common
   *  push should not pay for — and the count beside the chip comes from
   *  the per-trail pin counts query until then. The trails are read with
   *  the push for the section headings and the move choices. */
  let pinAllList = $state(null);
  let pinAllCount = $state(null);
  let pinAllReading = false;
  let pinsLineages = $state([]);

  /** The scroller under the finger, as Screen measured it. Straight
   *  through to gestureOwner's canvas row; nothing in this file reads
   *  either. Both were the table's inputs with no producer anywhere —
   *  the branch that turns a swipe up at the bottom of the page into
   *  memory could not be reached from the app at all.
   *
   *  BOTH ROOTS FEED THIS, and they have to: §1's row is a PAIR ("swipe up
   *  at scroll bottom → memory; swipe down at memory's top → page"), so the
   *  return half is dead unless memory's scroller reports its own edges
   *  here too. Only one root is mounted at a time — Stack keys the root
   *  entry by `active`, so switching root replaces the screen — and every
   *  Screen reports at mount as well as on scroll (P3 Task 1), so the
   *  arriving screen overwrites the departing one's last answer without
   *  either of them needing to know the other exists. */
  let atScrollTop = $state(false);
  let atScrollBottom = $state(false);

  function takeScrollEdges(edges) {
    atScrollTop = edges.atTop;
    atScrollBottom = edges.atBottom;
  }

  /** How many dismissable surfaces are open, from navstack's own snapshot.
   *  Read for exactly one decision — whether Esc has anything to close —
   *  because navBack() is history.back() and at an empty stack that leaves
   *  the app. §1: "At the page root with nothing open: Android backgrounds
   *  the app; iOS and web do nothing." */
  let navDepth = $state(0);
  $effect(() => navSubscribe((snap) => { navDepth = snap.depth; }));

  // Esc, which two headers in this tree already promised and nothing
  // delivered. Sheet's says "Android system back, Esc and navBack() all
  // reach it"; Stack's says platform back "(Android system back, Esc on
  // web) routes through navBack() regardless". Both were true of the
  // navstack and false of the app: grep for navBack across src/ before
  // this line and the only caller is App.svelte's swipe intent. The
  // desktop tree never needed one — every desktop surface handles its own
  // Escape key — and the shell's surfaces deliberately do not, because
  // navstack is meant to be the single owner of what closes next.
  //
  // On `window` and not on the frame: the key event goes to whatever has
  // focus, and with a sheet open that is a field inside a surface which is
  // not a descendant of `.shell-root`.
  $effect(() => {
    if (typeof window === "undefined") return;
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      if (navDepth === 0) return;
      navBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** §2: pins is pushed from the page nav bar. The fetch is the push's,
   *  not a screen's — see PinsScreen's header for why that is what keeps
   *  the list off EditorCore's one-behind cache. */
  async function openPins() {
    push("pins");
    pinsLoading = true;
    pinList = [];
    pinAllList = null;
    pinAllCount = null;
    readPinsContext();
    // Read once, here, and handed to the screen with the rows it belongs
    // to — see pinsLineage.
    const lineageId = page?.lineage_id || null;
    pinsLineage = lineageId;
    try {
      const rows = await getPins(lineageId);
      if (live) pinList = Array.isArray(rows) ? rows : [];
      // The list the count names, read in full — so the count is it. A
      // trail's only (measurePinCount says why).
      if (live && lineageId && (page?.lineage_id || null) === lineageId) trailPinCount = pinList.length;
    } catch (err) {
      console.error("shell: could not read the pins", err);
    } finally {
      if (live) pinsLoading = false;
    }
  }

  /** The trails and the all-trails count, beside the push's own fetch and
   *  not before it: neither is needed to show the trail's rows. */
  async function readPinsContext() {
    try {
      const [lineages, counts] = await Promise.all([getLineages(), getTrailPinCounts()]);
      if (!live) return;
      pinsLineages = Array.isArray(lineages) ? lineages : [];
      pinAllCount = Array.isArray(counts) ? counts.reduce((n, pair) => n + (Number(pair?.[1]) || 0), 0) : null;
    } catch (err) {
      console.error("shell: could not read the trails for the pins screen", err);
    }
  }

  /** `all trails`, read the first time the chip asks for it. */
  async function loadAllPins() {
    if (pinAllReading || Array.isArray(pinAllList)) return;
    pinAllReading = true;
    try {
      const lineages = pinsLineages.length ? pinsLineages : (await getLineages()) ?? [];
      const lists = await Promise.all([getPins(null), ...lineages.map((l) => getPins(l.id))]);
      if (live) pinAllList = mergePinRows(lists);
    } catch (err) {
      console.error("shell: could not read every trail's pins", err);
      if (live) pinAllList = [];
    } finally {
      pinAllReading = false;
    }
  }

  /** `put on page`: the desktop panel's `injectPinNow`, against the core
   *  method carry-forward already uses. The pin's title goes with it (the
   *  row's title, derived when the column is blank), and `keepPinIds`
   *  makes the block the pin rather than a copy — the desktop's call. The
   *  screen goes back to the page, so the writer sees where it landed. */
  function putPinOnPage(pin) {
    if (!pin || readonly || !core?.appendNodesToDoc) return;
    const titled = { ...pin, title: (pin.title || "").trim() || pinDisplayTitle(pin) };
    const nodes = pinToNodes(titled, { keepPinIds: true });
    if (nodes.length === 0) return;
    const landed = core.appendNodesToDoc(nodes) ?? 0;
    if (pushed[pushed.length - 1]?.kind === "pins") popScreen();
    if (landed > 0) showToast("the pin is on the page");
  }

  /** The untrailed empty state's `choose a trail`: back to the page, and
   *  the page's own trail sheet over it — choosing is the way back to a
   *  trail's pins (CLAUDE.md's context clause), and it is the page's
   *  choice, not the pins screen's. */
  function chooseTrailFromPins() {
    if (pushed[pushed.length - 1]?.kind === "pins") popScreen();
    openTrailSheet();
  }

  // ── a pin row's `more` sheet ───────────────────────────────────────
  //
  // pin-more-sheet.js decides what it offers (the desktop's list, ruling
  // 6); this is what each row does. `unpin…` re-asks in the same sheet.
  let morePin = $state(null);
  let moreConfirming = $state(false);
  const moreSheet = $derived(
    pinMoreSheet(morePin, {
      lineages: pinsLineages,
      title: morePin ? pinRowLabel(morePin) : "",
      confirming: moreConfirming,
    }),
  );

  function openPinMore(pin) {
    morePin = pin;
    moreConfirming = false;
    openSheet = "pin-more";
  }

  async function runPinMoreRow(row) {
    const pin = morePin;
    if (!pin) return;
    if (row.id === "unpin") {
      moreConfirming = true;
      return;
    }
    openSheet = null;
    if (row.id === "carry") await toggleCarry(pin);
    else if (row.id === "unpinNow") await unpin(pin);
    else if (row.id === "move") await movePin(pin, row.target ?? null);
  }

  /** A move from the `more` sheet: the same write the pin screen's trail
   *  picker makes (pickPinTrail), patched once it has landed. */
  async function movePin(pin, lineageId) {
    try {
      await updatePinScope(pin.id, lineageId);
    } catch (err) {
      console.error("shell: could not move the pin", err);
      return;
    }
    if (!live) return;
    patchPin(pin.id, { lineage_id: lineageId });
    if (pushed.some((entry) => entry?.kind === "pins")) refreshPins();
    measurePinCount();
  }

  // ── memory ───────────────────────────────────────────────────────────
  //
  // The rows are the HOST'S, on PinsScreen's precedent and for the same
  // reason: a fetch tied to the event that opens a surface cannot be stale,
  // and this file is the only one in `src/shell/` that imports the api at
  // all. The event here is the root switch rather than a push, so it hangs
  // off goRoot — through the tab bar and through the swipe alike, because
  // both go through that one function.
  //
  // HOW MANY DAYS THE FILTER SHEET CAN NARROW is decided by this fetch and
  // not by the sheet: `getThread` is capped, so the date range picks from
  // what was read rather than from the whole account. MEMORY_PAGE_FETCH is
  // the desktop's own hundred — the same number Memory.svelte asks for —
  // so the phone shows the same history the desktop does rather than a
  // quietly shorter one.
  //
  // THE PINS TAKE N+1 CALLS and there is no cheaper honest version yet.
  // `getPins(id)` walks ancestors UPWARD from one trail and `getPins(null)`
  // returns only the global rows, so no single call can answer for a whole
  // account; the desktop fans out across every lineage for exactly this
  // reason and dedupes the overlap (mergePinRows). The calls run in
  // parallel and only on entering memory, never on the writing path.
  const MEMORY_PAGE_FETCH = 100;

  let memoryPageList = $state([]);
  let memoryPinList = $state([]);
  let memoryLineages = $state([]);
  let memoryLoading = $state(false);

  /** The filter sheet's three controls. They live here rather than in the
   *  screen because the sheet that changes them is here — every Sheet in
   *  the shell is declared in this file, so that "one sheet at a time" is a
   *  property of one variable rather than a rule two hosts have to keep. */
  let memoryRange = $state(DEFAULT_RANGE);
  /** The day picked off the filter sheet's calendar, or null. It is the
   *  same field as the presets — one date filter, two ways to say it — so
   *  setting either clears the other (see `setMemoryRange` and
   *  `pickMemoryDay`). `applyDateFilter` has understood `specific` all
   *  along; what was missing was a surface to say it from. */
  let memoryDay = $state(null);
  /** The month the filter sheet's calendar is showing. Held by the host
   *  rather than by `Calendar` (its header), and reset to the picked
   *  day's month — or this month — every time the sheet opens. */
  let memoryMonth = $state(null);

  /** The days the calendar puts a dot on: every day memory holds writing
   *  for, pages and pins alike, off the same two lists the timeline is
   *  drawn from. Not a second fetch — a calendar that marked days the
   *  screen behind it does not show would be the count-that-disagrees
   *  failure one surface over (pin-toast.js's rule). */
  const memoryMarkedDays = $derived(
    new Set([
      ...memoryPageList.map((p) => p?.date).filter(Boolean),
      ...memoryPinList.map((p) => p?.source_page_date).filter(Boolean),
    ]),
  );
  let memorySort = $state(DEFAULT_SORT);
  let memoryPinned = $state(false);
  const memoryDateFilter = $derived(
    memoryDay ? { kind: "specific", date: memoryDay } : { kind: memoryRange },
  );

  /** What is in the field, and what FTS5 said about it. `null` is "no
   *  query" and an empty Set is "a query that matched nothing" — the screen
   *  filters on the difference, so they must not be collapsed. */
  let memoryQuery = $state("");
  let memoryMatchingIds = $state(null);
  let memorySearchTimer = null;

  /** Whether the sheet offers a way to clear. MemoryScreen calls the same
   *  function for the count on its `filters` action; both read one rule
   *  from one module, which is the property that matters — a sheet with a
   *  clear row and a bar that says nothing is on would be two answers to
   *  one question. */
  const memoryFilters = $derived(
    memoryFilterCount({ dateFilter: memoryDateFilter, sort: memorySort, pinned: memoryPinned }),
  );

  /** Back to what the screen opened with. Not `emptyFilters()` — that is
   *  the desktop's shape, and its `date: "all"` is a different field on a
   *  different object. The three names below are this surface's whole
   *  filter state. */
  function clearMemoryFilters() {
    memoryRange = DEFAULT_RANGE;
    memoryDay = null;
    memoryPinned = false;
    setMemorySort(DEFAULT_SORT);
  }

  /** A pill's ×, or `show everything` (0.8.2): memory-model.js says what
   *  changes; this applies it to the state that lives here. The sort goes
   *  through setMemorySort, because the backend owns that order. */
  function applyMemoryPatch(patch) {
    if ("trail" in patch) memoryTrail = patch.trail;
    if ("range" in patch) memoryRange = patch.range;
    if ("day" in patch) memoryDay = patch.day;
    if ("pinned" in patch) memoryPinned = patch.pinned;
    if ("query" in patch) searchMemory(patch.query);
    if ("sort" in patch) setMemorySort(patch.sort);
  }

  /** A preset and a picked day are one filter said two ways, so each
   *  clears the other. Without this the segment would light `today` over
   *  a list the calendar had scoped to the eleventh. */
  function setMemoryRange(next) {
    memoryDay = null;
    memoryRange = next;
  }

  function pickMemoryDay(date) {
    // Tapping the day that is already picked clears it, which is the
    // only way back to a preset without leaving the calendar: the row of
    // presets shows nothing lit while a day is on.
    memoryDay = memoryDay === date ? null : date;
    memoryMonth = monthOf(date) ?? memoryMonth;
  }

  /** Each trail's own pages and pins (ruling 1), as Maps keyed by lineage
   *  id — null keys the pins on no trail. Null until first read: the trail
   *  sheets then carry no count rather than a guessed zero. Read with
   *  memory and when the page's trail sheet opens; one SELECT apiece. */
  let trailPageCounts = $state(null);
  let trailPinCounts = $state(null);

  async function readTrailCounts() {
    // Two tries, not one: a failed page count must not cost the pin count,
    // and neither may cost the list it sits beside.
    try {
      const pairs = await getTrailPageCounts();
      if (live && Array.isArray(pairs)) trailPageCounts = new Map(pairs);
    } catch (err) {
      console.error("shell: could not count each trail's pages", err);
    }
    try {
      const pairs = await getTrailPinCounts();
      if (live && Array.isArray(pairs)) trailPinCounts = new Map(pairs);
    } catch (err) {
      console.error("shell: could not count each trail's pins", err);
    }
  }

  async function loadMemory({ quiet = false } = {}) {
    // `quiet` for a sync pull's re-read: the list is already on screen, and
    // a "reading…" state on every pull would blink the archive each time the
    // other device writes.
    if (!quiet) memoryLoading = true;
    try {
      const [rows, lineages] = await Promise.all([
        getThread(MEMORY_PAGE_FETCH, 0, memorySort),
        getLineages(),
      ]);
      if (!live) return;
      memoryPageList = Array.isArray(rows) ? rows : [];
      memoryLineages = Array.isArray(lineages) ? lineages : [];
      const lists = await Promise.all([
        getPins(null),
        ...memoryLineages.map((l) => getPins(l.id)),
      ]);
      if (live) memoryPinList = mergePinRows(lists);
      readTrailCounts();
    } catch (err) {
      // The previous lists are left standing. Pages do not stop existing,
      // so a failed read means the writer sees what they saw a moment ago
      // rather than an empty archive — the same call openDateSheet makes.
      console.error("shell: could not read memory", err);
    } finally {
      if (live) memoryLoading = false;
    }
  }

  /** §2 gives memory a filter SHEET where pins got a filter segment, and
   *  the asymmetry is the spec's rather than an inconsistency: a segment
   *  carries one axis with two to five values, and this surface has three
   *  axes at once. */
  function openMemoryFilters() {
    // The calendar opens on the picked day's month, or on this one — not
    // on wherever it was last paged to. A sheet that reopened three
    // months back would make the writer find their way home before they
    // could pick anything.
    memoryMonth = memoryDay ? monthOf(memoryDay) : monthOf(clockDay);
    openSheet = "memory-filters";
  }

  /** Sort is the one filter the backend owns: `getThread`'s `orderBy` is
   *  what puts the list in "recently edited" order, and re-sorting the
   *  capped hundred locally would order a different hundred than the one
   *  the writer asked for. */
  function setMemorySort(next) {
    if (next === memorySort) return;
    memorySort = next;
    loadMemory();
  }

  /** Debounced, at the desktop's own interval. The trailing edge only: a
   *  leading call would put an FTS query on the first keystroke of every
   *  word, and the answer to one letter is the whole account.
   *
   *  The previous answer is NOT cleared while the next one is in flight,
   *  for the reason the date sheet gives about its rows — the stale list is
   *  the right list plus whatever the extra letter removes, and blanking it
   *  would flash an empty timeline between every two keystrokes. Clearing
   *  the FIELD does clear it, synchronously, because there the previous
   *  answer is no longer about anything. */
  function searchMemory(next) {
    memoryQuery = next;
    if (memorySearchTimer) clearTimeout(memorySearchTimer);
    if (!next.trim()) {
      memoryMatchingIds = null;
      return;
    }
    memorySearchTimer = setTimeout(async () => {
      try {
        const rows = await searchPages(next.trim());
        if (live) memoryMatchingIds = new Set((rows || []).map((r) => r.id));
      } catch (err) {
        console.error("shell: could not search", err);
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  // ── memory's trail scope ────────────────────────────────────────────
  //
  // What the scopes ARE is trail-index.js's; what a pick DOES is here,
  // and it is one assignment: memory is scoped to that trail and
  // everything nested under it. There is no second effect — the screen
  // derives its own filter from the id, so nothing is re-fetched and the
  // three lists narrow in the same frame the row is tapped.
  //
  // THE LISTS ARE NOT RE-READ WHEN THE SHEET OPENS, unlike the pins
  // screen's, and the difference is which surface owns them. Pins belong
  // to the PAGE and the pins screen is pushed from it, so the fetch has
  // to be the push's. The trails belong to MEMORY, which read them on the
  // way in and re-reads on every arrival (`goRoot`); asking again would
  // re-ask a question the screen underneath answered a moment ago.
  //
  // THE SCOPE OUTLIVES THE SCREEN, deliberately, and it outlives leaving
  // memory too — exactly as the range, the sort and the pinned toggle do.
  // It is safe to persist precisely because it is VISIBLE: the bar's second
  // action is labelled with the trail, so a writer returning to memory is
  // told what they are looking at before they read a single row. That is
  // the same test memory-model.js's own header applies to the resting date
  // range ("a list silently cut at thirty days would be a filter the writer
  // cannot see").

  /** null = all trails; `UNTRAILED` = the pages on no trail; otherwise a
   *  lineage id. The three are one field because `applyScopeFilter` takes
   *  one argument, and a screen holding a boolean beside an id is a screen
   *  that can hold both at once. */
  let memoryTrail = $state(null);

  // ── choosing which trail memory shows ───────────────────────────────
  //
  // A SHEET, NOT A PUSH. §2 said "trails are a pushed index, not a drawer
  // — the shell has no drawers", and the index screen was built that way:
  // the two scope rows, then a block per trail with its chips and a spine
  // of the days it was written on. The fifth device pass overruled the
  // shape from outside — "the memory page trail selection is ugly, it
  // takes us to another page; I think we need a similar popup to filters"
  // — and the reading is fair. Choosing a scope is ONE decision about the
  // screen behind it, which is exactly what the filters sheet beside it
  // is; a whole screen to make it left the writer to find their way back
  // afterwards, and a sheet leaves the list they are scoping visible
  // while they choose.
  //
  // A sheet is not a drawer, which is the thing §2's sentence refused: a
  // drawer is a second navigation surface that lives beside the content,
  // and this is the shell's one overlay, opened by one control, holding
  // one decision, dismissed by the same three gestures every other sheet
  // answers to.
  //
  // WHAT WENT WITH THE SCREEN, said here rather than left to be found:
  // the per-trail day map (TrailIndexScreen and trail-map.js, both
  // deleted). Memory's own `trail map` mode shows the same material from
  // the other end — day, then trail, then pages — and is one tap away on
  // the segment. What the screen had that the mode does not is
  // trail-first ordering and the page counts; if either is missed it
  // comes back as a mode on that segment, not as a second screen.
  function openTrails() {
    trailScopeQuery = "";
    openSheet = "trail-scope";
  }

  /** What is typed into the scope sheet's `find a trail…` (0.8.2). Cleared
   *  each time the sheet opens, so it never greets a writer with a list
   *  narrowed by a search they made last time. */
  let trailScopeQuery = $state("");
  const trailScopeNoMatch = $derived(noTrailMatches(memoryLineages, trailScopeQuery));

  /** The rows the scope sheet offers: `all trails`, `untrailed`, then the
   *  tree in name order — `trailIndexRows`, which is also the list
   *  memory's map hangs its blocks on, so the two cannot disagree about
   *  which trails exist or how they nest. */
  const trailScopeRows = $derived(
    trailIndexRows({
      lineages: memoryLineages,
      selectedId: memoryTrail,
      query: trailScopeQuery,
      pageCounts: trailPageCounts,
      pinCounts: trailPinCounts,
      // Memory's own list, while it is under its cap; unknown past it.
      untrailedPages: untrailedPageCount(memoryPageList, MEMORY_PAGE_FETCH),
    }),
  );

  /** A tap on a scope row: scope memory, or — on the trail memory is
   *  already showing — open that trail's screen. trail-manage.js's
   *  `scopeRowAction` decides, and its header says why that row. */
  function tapScopeRow(row) {
    const action = scopeRowAction(row);
    if (action === "scope") pickTrail(row.id);
    else if (action === "manage") openTrailScreen(row.id);
  }

  function pickTrail(id) {
    memoryTrail = id;
    // Closed on pick, rather than staying to show the tick. One decision,
    // and its result is on the screen underneath; leaving the writer to
    // dismiss a sheet after they have already chosen is the extra gesture
    // the page's trail sheet refuses for the same reason.
    openSheet = null;
  }

  // ── managing a trail (task 9e) ──────────────────────────────────────
  //
  // trail-sheet-model.js's header put trail management in memory and not
  // on the writing surface, and this is it arriving: a pushed TrailScreen
  // from memory's trails sheet, with the laptop's three commands —
  // renameLineage, setLineageParent, deleteLineage (LineageSelector). Fold
  // stays laptop-only. What the screen offers, where a trail may move,
  // what a rename means and what the delete says are trail-manage.js's.
  //
  // THE TRAIL IS READ LIVE from memory's list by id, not frozen at the tap
  // the way a pin is: every write here patches that list, so the screen
  // and the sheet behind it say the same thing, and a sync pull that
  // re-reads the list re-reads the screen too (a trail deleted elsewhere
  // turns the screen into its "not here any more" state).

  /** The trail whose screen is pushed, by id. */
  let trailScreenId = $state(null);
  /** The rename field's latest text, written on pop — the pin screen's
   *  draft rule (flushArtifactDraft). A plain let: never rendered. */
  let trailDraft = null;
  /** A name being written, so a commit and the pop after it are one write. */
  let trailRenaming = null;
  /** The last write the backend refused, in the laptop's words. */
  let trailError = $state("");

  const managedTrail = $derived(
    trailScreenId ? (memoryLineages.find((l) => l?.id === trailScreenId) ?? null) : null,
  );

  const trailMoveRows = $derived(
    moveUnderRows({ lineage: managedTrail, lineages: memoryLineages }),
  );

  function openTrailScreen(id) {
    openSheet = null;
    trailScreenId = id;
    trailDraft = null;
    trailRenaming = null;
    trailError = "";
    push("trail");
  }

  /** One lineage row, changed in place: the row the command answered, over
   *  the one memory holds. */
  function patchLineage(id, mut) {
    memoryLineages = memoryLineages.map((l) => (l?.id === id ? { ...l, ...mut } : l));
  }

  /** The page header's trail name and crumb, read again when the trail
   *  written to could be the open page's or one above it. */
  function refreshHeaderAfterTrailWrite() {
    if (page?.lineage_id) refreshHeader(page);
  }

  async function renameTrail(typed) {
    const lineage = managedTrail;
    const intent = renameIntent({ lineage, lineages: memoryLineages, typed });
    if (intent.action !== "rename" || trailRenaming === intent.name) return;
    trailRenaming = intent.name;
    try {
      const updated = await renameLineage(lineage.id, intent.name);
      if (!live) return;
      patchLineage(lineage.id, { ...(updated ?? {}), name: updated?.name ?? intent.name });
      trailError = "";
      refreshHeaderAfterTrailWrite();
    } catch (err) {
      if (live) trailError = trailErrorText(err, intent.name);
    } finally {
      trailRenaming = null;
    }
  }

  function takeTrailDraft(name) {
    trailDraft = name;
  }

  /** Leaving the screen writes a name still in the field. Called by
   *  popScreen when the entry it pops is the trail's. */
  function flushTrailDraft() {
    const draft = trailDraft;
    trailDraft = null;
    if (draft !== null) renameTrail(draft);
  }

  async function moveTrailUnder(row) {
    openSheet = null;
    const lineage = managedTrail;
    if (!lineage || !row?.selectable) return;
    try {
      const updated = await setLineageParent(lineage.id, row.parentId);
      if (!live) return;
      patchLineage(lineage.id, { ...(updated ?? {}), parent_id: row.parentId });
      trailError = "";
      refreshHeaderAfterTrailWrite();
    } catch (err) {
      if (live) trailError = trailErrorText(err);
    }
  }

  /** The laptop's default delete, "unlink pages": no target, so the pages
   *  stay and lose the trail, the trails inside it move up to its parent,
   *  and its pins move up with them (commands.rs `delete_lineage`). The
   *  screen leaves once the delete has landed — unpin's order: a trail
   *  that vanished and came back on a failed write would read as loss. */
  async function deleteManagedTrail() {
    openSheet = null;
    const lineage = managedTrail;
    if (!lineage) return;
    try {
      await deleteLineage(lineage.id, null);
    } catch (err) {
      if (live) trailError = trailErrorText(err);
      return;
    }
    if (!live) return;
    // The draft dies with the trail: a rename after the delete is a write
    // to a row that is gone.
    trailDraft = null;
    if (memoryTrail === lineage.id) memoryTrail = null;
    memoryLineages = memoryLineages
      .filter((l) => l?.id !== lineage.id)
      .map((l) => (l?.parent_id === lineage.id ? { ...l, parent_id: lineage.parent_id ?? null } : l));
    if (pushed[pushed.length - 1]?.kind === "trail") popScreen();
    // Pages and pins moved in the database; memory reads them again.
    loadMemory({ quiet: true });
    if (page?.lineage_id === lineage.id) {
      // The open page lost its trail, as a page unlinked from the trail
      // sheet does — assignTrail's route back onto the header.
      await adoptPage({ ...page, lineage_id: null });
    } else {
      refreshHeaderAfterTrailWrite();
    }
  }

  const TRAIL_ROW_ACTIONS = {
    move: () => {
      openSheet = "trail-move";
    },
    delete: () => {
      openSheet = "trail-delete";
    },
  };

  function runTrailScreenRow(id) {
    TRAIL_ROW_ACTIONS[id]?.();
  }

  // ── reading a page ───────────────────────────────────────────────────
  //
  // §2: "Tapping a page pushes a reading view; 'continue' lives there."
  // What the screen shows and what continue means are ReadingScreen's and
  // reading-view.js's; what the host owes is the page itself, and it is
  // more than the row memory hands it.
  //
  // MEMORY'S ROWS ARE SUMMARIES, AND A SUMMARY MUST NOT REACH THE CANVAS.
  // `get_thread` returns `PageSummary` (models.rs:157) — id, date, focus,
  // counts, and `content_json` — and NOT `yjs_state`. Continue puts the row
  // on the writing surface, where PageScreen hands EditorCore
  // `initialYjsState={page.yjs_state ?? null}`; on a continuous trail's
  // canonical that null is the difference between binding the living
  // document's CRDT and building a fresh one over the same content. So the
  // push fetches the whole page by `pageAddress` and continue hands THAT
  // row on, never the one it was tapped from. The desktop takes the same
  // route for the same reason (Page.svelte:1146, which re-fetches from the
  // address `continueFocus` carries).
  //
  // THE MODE AND THE PAGE ARE PUBLISHED TOGETHER, which is adoptPage's own
  // ordering rule applied to a second screen. `trailMode` is the LINEAGE's
  // and is not a column on the page row, so a screen handed the page first
  // and the mode a round trip later renders one frame in which a
  // continuous trail's canonical is read-only — the exact surface
  // CLAUDE.md's trail-exception clause exists to keep open.
  //
  // THE TRAIL IS READ OFF MEMORY'S OWN LIST FIRST. The push comes from
  // memory, which loaded the lineages on arrival, so the common path costs
  // no round trip. A MISS falls back to a fetch rather than to null,
  // because null is not a neutral answer here: `pageReadonly` reads a null
  // mode as "not continuous", which would freeze the one page that must
  // not be frozen. A missing name costs a subtitle; a missing mode costs
  // the trail exception.

  /** The page the reading view is showing, its trail's name and its
   *  trail's mode — all three assigned in one turn, never one at a time. */
  let readingPage = $state(null);
  let readingTrailName = $state(null);
  let readingTrailMode = $state(null);
  let readingLoading = $state(false);

  async function readingLineage(lineageId) {
    if (!lineageId) return null;
    const known = memoryLineages.find((l) => l?.id === lineageId);
    if (known) return known;
    try {
      const rows = await getLineages();
      if (!live) return null;
      return rows?.find((l) => l?.id === lineageId) ?? null;
    } catch (err) {
      console.error("shell: could not read the page's trail", err);
      return null;
    }
  }

  async function openReading(row) {
    if (!row) return;
    push("reading");
    readingLoading = true;
    readingPage = null;
    readingTrailName = null;
    readingTrailMode = null;
    try {
      const result = await getPage(...pageAddress(row));
      if (!live) return;
      const full = result?.page ?? null;
      const lineage = await readingLineage(full?.lineage_id ?? null);
      if (!live) return;
      readingTrailName = lineage?.name || null;
      readingTrailMode = lineage?.mode || null;
      readingPage = full;
    } catch (err) {
      // The screen's own "did not open" state takes it from here. Leaving
      // `readingPage` null is what selects that state, so there is nothing
      // to set — the catch exists to keep the rejection out of the console
      // as an unhandled one, and to say which read failed.
      console.error("shell: could not read that page", err);
    } finally {
      if (live) readingLoading = false;
    }
  }

  /** The page in the reading view, read again in place after a sync pull:
   *  no loading state, and nothing changes if the reader has moved on or
   *  the page is gone (a delete stays the deleting device's to show). */
  async function refreshReading() {
    const shown = readingPage;
    if (!shown?.id) return;
    try {
      const result = await getPage(...pageAddress(shown));
      const full = result?.page ?? null;
      if (!live || readingPage !== shown || !full) return;
      const lineage = await readingLineage(full.lineage_id ?? null);
      if (!live || readingPage !== shown) return;
      readingTrailName = lineage?.name || null;
      readingTrailMode = lineage?.mode || null;
      readingPage = full;
    } catch (err) {
      console.error("shell: could not re-read the page being read after a sync pull", err);
    }
  }

  /** Both of the reading view's rows end here: leave the stack, go to the
   *  page root, and put a page on it.
   *
   *  `pushed = []` ahead of `goRoot` rather than trusting it: goRoot clears
   *  the stack too, but it returns early when the root is already active,
   *  and a reading view is only pushed from memory TODAY. Writing the
   *  clear where the navigation is decided means the day something pushes
   *  one from the page root, this still leaves it. */
  async function openOnThePage(row) {
    clearStack();
    goRoot("page");
    await adoptPage(row);
  }

  /** A pin's "open the page it came from": the page on the WRITING SURFACE,
   *  with the pin's own block scrolled to and flashed.
   *
   *  IT USED TO PUSH THE READING VIEW, and a writer reported both halves of
   *  what that cost: "changing a pin content does not appear in its source
   *  page", and "in mobile open source page pin should show us in the editor
   *  similar to desktop then user could move to today".
   *
   *  The first half was not a write-through bug — `writePinToPage` has been
   *  driven on a phone in both directions (pin-both-ways.mjs). It was this
   *  row. The pin screen writes its draft when it is POPPED, and this row
   *  PUSHED a screen on top of it, so the edit was still sitting in memory
   *  when the page was read out of the database — and the reading view
   *  faithfully showed the words from before the edit. Hence the await
   *  below: the write lands, then the page is read.
   *
   *  The second half is the desktop's behaviour, which the editor has
   *  always been able to do here (`scrollToPinId`, written for the desktop
   *  panel and never called by this tree). A pin is a pointer at writing;
   *  the pointer should land on the writing, in the surface the writer can
   *  work in, not in a view of it.
   *
   *  AND A PAST PAGE IS SAFE TO LAND ON. `pageReadonly` decides what the
   *  canvas allows after it arrives, exactly as it does for every other way
   *  in, so an old page opens read-only with the sentence that says why
   *  (`readonlyNote`) — and the date control's first row is `today`, which
   *  is the "then user could move to today" the report asks for. The
   *  reading view keeps its job: memory's row taps, where §2 put it.
   *
   *  The row is withheld from an orphaned pin by the model, so there is no
   *  case here for a page that is gone. */
  async function openPinSource(pin) {
    const id = pin?.source_page_id;
    if (!id) return;
    // The draft first, and waited for. This is the one caller that cannot
    // let the write race the read — see flushArtifactDraft.
    try {
      await flushArtifactDraft();
    } catch (err) {
      console.error("shell: could not save the pin before opening its page", err);
    }
    if (!live) return;
    try {
      const result = await getPage(...pageAddress({ id }));
      if (!live) return;
      const full = result?.page ?? null;
      if (!full) {
        console.error("shell: the pin's page did not open", id);
        return;
      }
      await openOnThePage(full);
      if (!live) return;
      revealPin(pin.id);
    } catch (err) {
      console.error("shell: could not open the page the pin came from", err);
    }
  }

  /** Scroll the canvas to a pin's block and flash it, once the editor has
   *  the page.
   *
   *  RETRIED, because adopting a page does not put it in the editor in the
   *  same turn: EditorCore's content effect flushes the previous page's
   *  save before it calls setContent, so the doc the canvas holds for a
   *  frame or two is still the page the writer came from. Asking once lands
   *  on the old doc, finds no such pin, and does nothing — the writer is
   *  left on the right page with no idea which block they came for.
   *
   *  Bounded, and it gives up quietly: `scrollToPinId` answers false for a
   *  pin that is not in the doc, which is also what a block whose `pinId`
   *  was lost looks like. Both end the same way — the page is open and
   *  nothing flashes — and neither is worth an error on screen. */
  function revealPin(pinId, tries = 24) {
    if (!pinId || tries <= 0) return;
    if (!live) return;
    if (core?.scrollToPinId?.(pinId)) return;
    requestAnimationFrame(() => revealPin(pinId, tries - 1));
  }

  const READING_ROW_ACTIONS = {
    // What continue means, in one line: this page, on the writing surface.
    // It does not unlock anything — `pageReadonly` decides that on the
    // canvas afterwards exactly as it did here, which is why this row is
    // only offered on a page that canvas will accept.
    continue: () => openOnThePage(readingPage),
    // The read-only page's row. `getOrCreateToday` is the one call in the
    // api that can make a page, which is what a phone left open across
    // midnight needs — the same act `+` performs from a past day, reached
    // from the other end of the app.
    today: async () => {
      clearStack();
      goRoot("page");
      try {
        const result = await getOrCreateToday();
        // Before the page is adopted, so it is judged by the clock that
        // dated it (see clockDay).
        await readClockDay();
        await adoptPage(rememberToday(result?.page ?? null));
      } catch (err) {
        console.error("shell: could not open today's page", err);
      }
    },
  };

  function runReadingRow(id) {
    const run = READING_ROW_ACTIONS[id];
    // A row exists exactly when its action does — BLOCK_ROW_ACTIONS' rule.
    // The read-only page's sentence never reaches here: ReadingScreen
    // renders it through `Note`, not `Row`, so there is no control to tap.
    if (!run) return;
    run();
  }

  // ── a pin's screen ───────────────────────────────────────────────────
  //
  // §2 said "a row opens an actions sheet; note/artifact editing opens a
  // full-detent sheet with its field above the keyboard", and this file
  // built both. The second device pass ended them: a tester tapped a pin
  // row, got a menu, and asked how to see the pin; then, with the screen
  // built, asked why it could not be edited there. The old section's own
  // header had called the sheet-first split "a measurement, not a
  // redesign", and the measurement came in. So a pin row pushes
  // PinArtifactScreen — from the page's pins screen and from memory's
  // pins mode alike — the actions are rows under the writing there
  // (pin-artifact-view.js, `pinArtifactRows`), and the writing is edited
  // in place (PinEditor). Which rows, and why `carry forward` is withheld
  // from an untrailed or orphaned pin, is the model's decision, for
  // CLAUDE.md's first testing rule.
  //
  // THE PIN IS FROZEN AT THE TAP, the way `sheetBlock` freezes a block:
  // the list underneath can change while the screen is up — a save
  // patches a row, an unpin drops one — and a screen that re-read the
  // list would show whatever had taken the tapped row's place. `patchPin`
  // writes through to the frozen copy too, so a carry toggled on the
  // screen relabels its own row.

  /** Patch one row in place, so the list reflects a write before the round
   *  trip lands. The desktop's `patchPin`, and its SECOND LIST is back as
   *  of P3 Task 4: memory's pins mode opens this same sheet now, so a pin
   *  can be showing in two arrays at once — the page's pins screen and
   *  memory's own fan-out across every trail. Patching only the one the
   *  sheet was opened from leaves the other saying what the pin used to
   *  say, and the two are not alternatives: a pin edited on the pins
   *  screen and then looked at in memory is one round trip and no re-read
   *  apart. Both arrays are keyed by the same pin id, so the same map runs
   *  over each. */
  function patchPin(id, mut) {
    const patch = (rows) => rows.map((row) => (row.id === id ? { ...row, ...mut } : row));
    pinList = patch(pinList);
    if (Array.isArray(pinAllList)) pinAllList = patch(pinAllList);
    memoryPinList = patch(memoryPinList);
    if (artifactPin?.id === id) artifactPin = { ...artifactPin, ...mut };
  }

  /** CLAUDE.md's return beat: "unpinning is part of the model, not a
   *  failure of it." So the row is not `destructive` and the word is not
   *  `delete`, and the row is dropped only once the delete has actually
   *  landed — the desktop's order (`await deletePin; dropPin`). A row that
   *  vanished optimistically and came back on a failed write would be the
   *  one shape of this that reads as data loss. */
  async function unpin(pin) {
    if (!pin) return;
    try {
      await deletePin(pin.id);
      // Its stamp stays on the page; it no longer counts as kept.
      deadPins = new Set([...deadPins, pin.id]);
      // `live` for the reason adoptPage and openPins carry it: the write is
      // after an await and the shell can be unmounted in between.
      //
      // Both lists, for patchPin's reason: the row is gone from the
      // database, so a list still holding it is a row whose every action
      // now fails. This is the drop the pins screen's toast contract
      // already depends on ("a count that disagreed with the list it names
      // would be worse than no count") applied to the second list that can
      // hold the same pin.
      if (!live) return;
      pinList = pinList.filter((row) => row.id !== pin.id);
      if (Array.isArray(pinAllList)) pinAllList = pinAllList.filter((row) => row.id !== pin.id);
      if (pinAllCount != null) pinAllCount = Math.max(0, pinAllCount - 1);
      memoryPinList = memoryPinList.filter((row) => row.id !== pin.id);
      measurePinCount();
    } catch (err) {
      console.error("shell: could not unpin", err);
    }
  }

  /** The flag `get_carry_forward_pins` reads. Withheld by the model where
   *  that query would ignore it, so this only ever runs where it means
   *  something. */
  async function toggleCarry(pin) {
    if (!pin) return;
    const next = !pin.auto_insert;
    patchPin(pin.id, { auto_insert: next });
    try {
      await updatePinAutoInsert(pin.id, next);
    } catch (err) {
      console.error("shell: could not change what the pin carries", err);
    }
  }

  /** Write a screen's draft back — the body where the pin lives, the
   *  title to the one home it has.
   *
   *  THE BODY GOES WHERE THE PIN LIVES, through main's `writePinEdit`
   *  (pin-edit-route.js), in its order: the open editor when it holds the
   *  pin's block, else the block in the stored source page, else — only
   *  when no page holds the block any more — the row. While a page holds
   *  the block, the block IS the pin: every save of that page runs
   *  refresh_pin_caches and rewrites the row from it, and since that save
   *  also sends the pins it rewrites to the other devices (main 1f198150),
   *  a row-only edit is reverted everywhere by the next save on either
   *  device. That is why a NOTE's text now goes into its paragraph too:
   *  this used to write a note to the row alone, on the desktop's old
   *  split, which main dropped for the same reason (4e03571b).
   *
   *  The title's home is the node or the row (pin-title-authority.js,
   *  issue #1). A board's `blockTitle` slot is page content, so a board
   *  rename goes onto the node; a note, a heading or a file chip's
   *  paragraph has no slot, so its title is row metadata.
   *
   *  ONLY WHAT CHANGED. `contentDirty` gates the body; the title is
   *  compared to the pin's. A screen opened and left writes nothing — the
   *  desktop modal's `dirty` gate, which exists because a no-op round
   *  trip through the serializer once overwrote pins with its normalized
   *  form.
   *
   *  The row route writes BOTH COLUMNS: `update_pin_content` is
   *  `SET content = ?, title = ?` with no COALESCE, so a null title CLEARS
   *  the title. An emptied title field really does clear it, and the row
   *  then falls back to the pin's own first line (pinDisplayTitle).
   *
   *  NOTHING TOOK IT: the list is put back and the toast says so, rather
   *  than a row that claims a write which did not happen. */
  async function savePinDraft(pin, draft) {
    if (!pin || !draft) return;
    const title = (typeof draft.title === "string" ? draft.title : "").trim() || null;
    const titleChanged = title !== (pin.title || null);
    const contentChanged = !!draft.contentDirty;
    if (!titleChanged && !contentChanged) return;
    const content = contentChanged
      ? typeof draft.content === "string"
        ? draft.content
        : JSON.stringify(draft.content)
      : pin.content;
    // The list first, so the row the writer lands back on says what they
    // typed whichever route the write takes below.
    patchPin(pin.id, { title, content });

    let landed = null;
    if (contentChanged) {
      const body = await writePinBody(pin, draft.content, content, title);
      landed = body.landed;
      // A row landing wrote both columns. A page landing wrote the node,
      // which carries a board's title only if the draft's node did — so
      // the title still goes to its home when it changed.
      if (landed && landed !== "row" && titleChanged) {
        if (pinTitleAuthority(pin) === "node") {
          if (!(await renameOnNode(pin, title))) landed = null;
        } else {
          try {
            await updatePinContent(pin.id, body.rowAfter, title);
          } catch (err) {
            console.error("shell: could not save the pin's title", err);
            landed = null;
          }
        }
      }
    } else if (pinTitleAuthority(pin) === "node") {
      landed = (await renameOnNode(pin, title)) ? "source" : null;
    } else {
      try {
        await updatePinContent(pin.id, content, title);
        landed = "row";
      } catch (err) {
        console.error("shell: could not save the pin", err);
      }
    }
    if (landed || !live) return;
    patchPin(pin.id, { title: pin.title ?? null, content: pin.content });
    showToast("that edit did not save. the pin still holds what it held before.");
  }

  /** The blocks a draft's content is, for a splice — or none, which is
   *  what a note's plain string and an unreadable cache both give. */
  function draftNodes(content) {
    if (!content || typeof content !== "object") return [];
    if (content.type === "doc") return Array.isArray(content.content) ? content.content : [];
    return typeof content.type === "string" ? [content] : [];
  }

  /** The body of an edited pin, written through `writePinEdit` with the
   *  shell's seams.
   *
   *  THE LIVE NODE is the pin's block in the open EditorCore, looked for
   *  only when the pin's source page is the page showing (the brief's
   *  rule, and the desktop Page's). A pending save on that page lands
   *  before its stored copy is read (`flushPendingSave`), and a write to
   *  the stored copy of the open page is handed to the editor afterwards,
   *  so its next autosave does not put the old block back.
   *
   *  MANY NODES, NOT ONE. A pin can be several blocks, and the pin
   *  screen's editor can hand back more than one (a paragraph added under
   *  a pinned table). Every one is stamped and the pin's whole run is
   *  replaced once (src/lib/pin-run.js). `writePinEdit` splices one node,
   *  so it is given the first, and the shell's two page writers put the
   *  whole list in place of the run: `spliceNodeAtPinId` takes a list, and
   *  the stored-page save re-splices the list with `withNodesAtPinId`.
   *
   *  A NOTE'S TEXT goes into its paragraph or heading (`textIntoNode`);
   *  a block of any other shape cannot take plain text, and that edit is
   *  refused rather than written to a row the page would overwrite.
   *
   *  @returns {Promise<{landed: "editor"|"source"|"row"|null, rowAfter: string}>}
   *    where it landed, and what the row's content is once the page's
   *    refresh has run — for a title write that follows. */
  async function writePinBody(pin, draftContent, content, title) {
    const isNote = typeof draftContent === "string";
    const nodes = isNote ? [] : draftNodes(draftContent);
    // THE ID RIDES ON EVERY BLOCK (pin-run.js): a doc rebuilt by a
    // serializer can come back without the attr, a page spliced with no
    // pinId in it is a pin orphaned by its own save, and a block left
    // unstamped drops out of the pin at the next save.
    const stamped = stampPinRun(nodes, pin.id);
    let written = null;
    // AN ARTIFACT DRAFT WITH NO BLOCKS is refused while a page holds the
    // pin's block (nodeFor answers null, and writePinEdit stops), on
    // purpose: there is nothing to put in the block, removing a pinned
    // block is unpin's job and not a save's, and a row write would be
    // rewritten from the untouched block by the page's next save. An
    // orphaned pin's empty draft still reaches its row, since no page
    // holds the block. The pin screen cannot produce one today: PinEditor
    // reports `getJSON()`, and a ProseMirror doc always holds a block. So
    // no ShellApp test reaches it; the refusal itself is held by main's
    // pin-edit-route.test.js ("does not write the row when the page holds
    // the node but the edit cannot go into it").
    const nodeFor = isNote
      ? (held) => (written = textIntoNode(held, draftContent))
      : () => stamped[0] ?? null;
    const sourceId = typeof pin.source_page_id === "string" ? pin.source_page_id : "";
    const onOpenPage = !!sourceId && sourceId === page?.id;
    const liveNode = onOpenPage ? findPinNode(core?.getEditor?.()?.getJSON?.(), pin.id) : null;
    let lastSaved = null;
    const landed = await writePinEdit({
      pin: { id: pin.id, source_page_id: sourceId || null },
      liveNode,
      nodeFor,
      rowContent: content,
      rowTitle: title,
      deps: {
        spliceInEditor: (id, node) => core?.spliceNodeAtPinId?.(id, isNote ? node : stamped) === true,
        beforeSourceWrite: async (id) => {
          if (id === page?.id) await core?.flushPendingSave?.();
        },
        loadPage: loadPageContentForModal,
        savePage: async (id, json) => {
          lastSaved = isNote ? json : JSON.stringify(withNodesAtPinId(JSON.parse(json), pin.id, stamped));
          await savePageContentWithPinRefresh(id, lastSaved);
        },
        updateRow: updatePinContent,
        onPageWritten: (id) => {
          if (id !== page?.id || !lastSaved) return;
          // Patched in place, never reassigned (refreshOpenPage's rule): a
          // remount seeds from this row, and a mounted editor re-reads it.
          page.content_json = lastSaved;
          core?.reloadFromContent?.(lastSaved);
        },
      },
    });
    const rowAfter = isNote
      ? (written ? JSON.stringify(written) : content)
      : JSON.stringify({ type: "doc", content: stamped });
    return { landed, rowAfter };
  }

  /** The node route, in the desktop's order (SharedObjectsPanel's
   *  commitInlineRename): the live doc first, because if the pin is on the
   *  page this editor holds, a database write behind its back would be
   *  undone by its next autosave; the source page only when the node is
   *  not here. `setBlockTitleAtPinId` answers false for a pinId it cannot
   *  find and for a node with no slot, and either sends this to the page
   *  in the database — the desktop's `walkAndSetTitle`, here as
   *  pin-rename.js. A pin whose page is gone (orphaned) has no node left to
   *  carry a title, and that is the one rename this cannot land, on either
   *  surface; the error says so rather than a row write pretending to. */
  async function renameOnNode(pin, title) {
    if (core?.setBlockTitleAtPinId?.(pin.id, title)) return true;
    try {
      const source = await loadPageContentForModal(pin.source_page_id);
      // A source that did not load is a rename that cannot land — NOT an
      // empty page to rename inside. This used to fall through to
      // `'{"type":"doc","content":[]}'`, which would have SAVED an empty
      // doc over the source page on any failed read; the error says so
      // instead.
      if (!source) {
        console.error("shell: could not read the pin's page to rename it on", pin.source_page_id);
        return false;
      }
      const doc = JSON.parse(source);
      // A page that no longer holds the node has nowhere to put the title:
      // saving it back unchanged would report a rename that landed nowhere.
      if (!findPinNode(doc, pin.id)) return false;
      await savePageContentWithPinRefresh(
        pin.source_page_id,
        JSON.stringify(withTitleAtPinId(doc, pin.id, title)),
      );
      return true;
    } catch (err) {
      console.error("shell: could not rename the pin on its page", err);
      return false;
    }
  }


  // ── the pin's screen, and what leaving it writes ────────────────────
  //
  // The way in is the pin ROW — from the pins screen and from memory's
  // pins mode — and the way out is any of the three backs, which all land
  // in popScreen. The draft the screen reports is written there, once,
  // when the entry popped is this one: a screen cannot save itself from
  // inside its own teardown, and three doors that each saved would be
  // three copies of one rule.
  //
  /** The pin the artifact screen is showing, and its trail's name. */
  let artifactPin = $state(null);
  let artifactTrailName = $state(null);

  /** The screen's latest draft (`{ title, content, contentDirty }`), or
   *  null when it has reported none since the push. A plain let: it is
   *  read only when the screen leaves, never rendered. */
  let artifactDraft = null;

  function takeArtifactDraft(draft) {
    artifactDraft = draft;
  }

  /** Leaving the screen writes the draft, once. Called by popScreen when
   *  the entry it pops is the pin's. The write is not awaited: the pop
   *  has already happened, and the lists it patches are patched first
   *  (savePinDraft) so the row the writer lands back on already says what
   *  they typed. */
  function flushArtifactDraft() {
    const pin = artifactPin;
    const draft = artifactDraft;
    artifactDraft = null;
    if (!pin || !draft) return null;
    // HANDED BACK, not awaited here. Every other caller is a navigation that
    // has already happened and must not wait on a write; the one caller that
    // does wait is the row that opens the pin's own source page, where the
    // page would otherwise be read out of the database BEFORE the edit
    // reached it — and show the writer their old words. See openPinSource.
    return savePinDraft(pin, draft);
  }

  /** Drop the whole pushed stack, writing anything a screen in it was
   *  holding on to first.
   *
   *  popScreen called itself "the one door every way off the pin's screen
   *  goes through". It was the only door that WROTE; it was not the only
   *  door. `pushed = []` was written out three times — here, and in both of
   *  the reading view's rows — and any of them would have dropped a pin's
   *  unwritten draft on the floor.
   *
   *  STATED HONESTLY: no route reaches that today. The tab bar is not
   *  rendered while a screen is pushed, so a root switch cannot happen from
   *  the pin's screen, and the one row that leaves it for the page root
   *  (openPinSource) writes the draft itself and waits for it. This is the
   *  invariant made true rather than a defect repaired — which is why there
   *  is no test for it: a test would have to reach a state the shell cannot
   *  produce, and a green one would only be describing the mock that got it
   *  there. The two doors that ARE reachable, the pop and the background,
   *  each have one. */
  function clearStack() {
    if (pushed.some((entry) => entry?.kind === "pin-artifact")) flushArtifactDraft();
    if (pushed.some((entry) => entry?.kind === "trail")) flushTrailDraft();
    pushed = [];
  }

  /** The app going away, which on a phone is the ordinary way to leave a
   *  screen rather than an edge case.
   *
   *  THE REACHABLE HALF OF "edit pins should presist". A writer opens a pin,
   *  types into it, and then does what people do with phones: switches apps,
   *  locks the screen, takes a call. Android fires `visibilitychange` and
   *  `pagehide` and may never come back — `onDestroy` does not run on a
   *  swipe-away — and the pin's draft lived only in memory until the screen
   *  was popped. It was never written, and there was nothing to pop.
   *
   *  EditorCore has carried exactly this guard for the page's own content
   *  since a just-created pin's stamp was lost the same way (its handleHide,
   *  and the comment above it). The pin screen is the other surface a writer
   *  types into, and it had none. */
  function handleHide() {
    if (typeof document !== "undefined" && document.visibilityState === "visible") return;
    flushArtifactDraft();
  }

  $effect(() => {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", handleHide);
    window.addEventListener("pagehide", handleHide);
    return () => {
      document.removeEventListener("visibilitychange", handleHide);
      window.removeEventListener("pagehide", handleHide);
    };
  });

  /** Push the screen, then name the trail.
   *
   *  NOTHING IS FETCHED FOR THE CONTENT, and that is CLAUDE.md's pin
   *  pointer clause rather than a shortcut: the pin caches its writing and
   *  the cache IS the artifact, so the screen renders what the row already
   *  carries and is complete in the frame it is pushed. The only round
   *  trip is the trail's NAME, which costs a provenance line if it misses
   *  and nothing else — `readingLineage` already answers this exact
   *  question off memory's loaded list first, so the common path costs
   *  none at all. */
  async function openPinArtifact(pin) {
    if (!pin) return;
    artifactPin = pin;
    artifactTrailName = null;
    artifactDraft = null;
    push("pin-artifact");
    const lineage = await readingLineage(pin.lineage_id ?? null);
    if (!live) return;
    // Guarded on identity, not on truthiness: a second pin opened while
    // this lookup was in flight has already set `artifactPin`, and writing
    // the first pin's trail name over it would caption one pin with
    // another's provenance.
    if (artifactPin?.id === pin.id) artifactTrailName = lineage?.name || null;
  }

  const ARTIFACT_ROW_ACTIONS = {
    /** The way back into the writing the pin was taken from — the return
     *  beat's other half. See openPinSource. */
    source: () => openPinSource(artifactPin),
    /** The flag `get_carry_forward_pins` reads — withheld by the model
     *  where that query would ignore it (pin-artifact-view.js), so this
     *  only ever runs where it means something. patchPin writes through
     *  to `artifactPin`, which is what relabels the row under the thumb. */
    carry: () => toggleCarry(artifactPin),
    /** The pin's trail — the picker sheet (`pinTrailRows`). */
    trail: () => openPinTrailSheet(),
    /** The return beat: unpinning is part of the model. The draft dies
     *  with the pin — a write after the delete would be a save to a row
     *  that is gone — and the screen leaves once the delete has landed,
     *  `unpin`'s own order (a row that vanished and came back on a failed
     *  write is the one shape of this that reads as data loss). */
    unpin: async () => {
      const pin = artifactPin;
      if (!pin) return;
      artifactDraft = null;
      await unpin(pin);
      if (!live) return;
      if (pushed[pushed.length - 1]?.kind === "pin-artifact") popScreen();
    },
  };

  /** The pin's trail row's value — trail-manage.js's `pinTrailValue`. */
  const artifactTrailValue = $derived(
    pinTrailValue({ pin: artifactPin, trailName: artifactTrailName }),
  );

  /** The trails the pin's trail sheet offers. Memory's list when it has
   *  one, read again on open: the pins screen is reached from the page,
   *  where memory may never have been opened. */
  let pinTrailLineages = $state([]);
  const pinTrailSheetRows = $derived(
    pinTrailRows({ pin: artifactPin, lineages: pinTrailLineages }),
  );

  async function openPinTrailSheet() {
    pinTrailLineages = memoryLineages;
    openSheet = "pin-trail";
    try {
      const rows = await getLineages();
      if (live && Array.isArray(rows)) pinTrailLineages = rows;
    } catch (err) {
      console.error("shell: could not read the trails for a pin", err);
    }
  }

  /** SharedObjectsPanel's `applyScopeAction`, with any trail as the
   *  target: `updatePinScope(id, lineageId)`, null for no trail (the
   *  laptop's "make global"). Patched once the write has landed, not
   *  before — a row that moved and moved back on a failure would say a
   *  thing that never happened. */
  async function pickPinTrail(row) {
    openSheet = null;
    const pin = artifactPin;
    if (!pin || !row?.selectable) return;
    try {
      await updatePinScope(pin.id, row.lineageId);
    } catch (err) {
      console.error("shell: could not move the pin to that trail", err);
      return;
    }
    if (!live) return;
    patchPin(pin.id, { lineage_id: row.lineageId });
    if (artifactPin?.id === pin.id) {
      const lineage = pinTrailLineages.find((l) => l?.id === row.lineageId);
      artifactTrailName = lineage?.name || null;
    }
    // The page's pins screen lists one trail's pins; a pin moved off it
    // must leave that list, and the header's count with it.
    if (pushed.some((entry) => entry?.kind === "pins")) refreshPins();
    measurePinCount();
  }

  function runArtifactRow(id) {
    const run = ARTIFACT_ROW_ACTIONS[id];
    // A row exists exactly when its action does — BLOCK_ROW_ACTIONS' rule.
    // The facts that used to sit among these are the provenance line now
    // (provenance.js), which is text under the title and not a control.
    if (!run) return;
    run();
  }

  // ── settings ─────────────────────────────────────────────────────────
  //
  // §2: "Grouped rows (`Row`), each pushing a section." Which rows, in
  // which groups, and which of the desktop's eight sections are absent and
  // why is settings-model.js. What lives here is the three things a model
  // cannot hold: the read that fills it, the writes a row performs, and the
  // push.
  //
  // THE READS HANG OFF `goRoot`, on memory's precedent and for memory's
  // reason: a fetch tied to the event that opens a surface cannot be stale.
  // Tone and font are not among them — they arrive as props already
  // applied — and the build string is a compile-time constant. What is read
  // is the two labs flags: `enable_yjs`, which can change two ways at once
  // (the desktop writes the same key, and feature-flag.js caches it
  // module-wide), and `try_new_shell`, which this screen itself writes and
  // which has to read back the same on the next arrival.
  //
  // EVERY WRITE UPDATES LOCALLY FIRST AND DOES NOT ROLL BACK ON FAILURE.
  // That is the desktop's behaviour (Settings.svelte:87-137) rather than an
  // oversight, and copying it is deliberate: a toggle that flicks back
  // under the thumb reads as the control being broken, and the failure it
  // reports — a setting write that did not reach SQLite — is one the next
  // write retries anyway.

  /** `enable_yjs` — the first lab. Default true, which is what
   *  `isYjsEnabled` answers for an install that has never touched it. */
  let yjsEnabled = $state(true);

  /** `try_new_shell` — the second lab, and the way OUT of this tree.
   *
   *  Initialised to true, which is not a guess: this component only mounts
   *  under App.svelte's `bootShell`, so the flag booting the shell is a
   *  precondition of the line running at all. The read below can only
   *  confirm it or report the "false" a previous visit here wrote; a read
   *  that THROWS leaves this alone, which is the right answer for the same
   *  reason — the shell is on screen, so it is on. */
  let shellEnabled = $state(true);

  /** The build, from vite's `define`. Test runs load vitest.config.js,
   *  which sets neither, so both are genuinely undefined there and the
   *  typeof guards are what make that safe — Settings.svelte carries the
   *  same pair with the same guards. */
  const appVersion = `v${typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev"}`;
  const buildSha = typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : "dev";

  /** Which section is pushed, or null. ONE variable, which is what caps
   *  settings at two levels: Stack renders `entry.view()` with no
   *  arguments, so a pushed screen cannot be told which section it is, and
   *  a second pushed section would have nowhere to be recorded. Same
   *  arrangement as `readingPage`, and it is safe for the same reason —
   *  only one of these is pushed at a time. */
  let settingsSectionId = $state(null);

  const settingsRootGroups = $derived(
    settingsGroups({ tone, font: fontFamily, sync: syncState, lock: lockOn }),
  );
  const settingsSectionModel = $derived(
    settingsSection(settingsSectionId, {
      tone,
      font: fontFamily,
      yjsEnabled,
      shellEnabled,
      // The browser demo unsets the key on every load, so the switch would
      // strand a reader on a layout they cannot leave.
      offerShellSwitch: !import.meta.env.VITE_DEMO,
      version: `${appVersion} · ${buildSha}`,
      exportZip: platform.exportZip,
      exportStatus,
    }),
  );

  async function loadSettings() {
    try {
      const enabled = await isYjsEnabled();
      if (live) yjsEnabled = enabled;
    } catch (err) {
      console.error("shell: could not read the labs flag", err);
    }
    // The layout switch, read from SQLite rather than assumed, and read on
    // every arrival for the labs flag's reason: the desktop tree can write
    // this key too (nothing there does yet — see the plan's one-way note),
    // and a reader who turned it off, went to write, and came back has to
    // find it still off. `shellSwitchChecked` is what stops this row and
    // App.svelte's boot fork disagreeing about a stored value.
    try {
      const stored = await getSetting(SHELL_SWITCH_KEY);
      if (live) shellEnabled = shellSwitchChecked(stored);
    } catch (err) {
      console.error("shell: could not read the layout switch", err);
    }
    // The root's sync row carries the state in its value column, so the
    // root has to know it. Devices are NOT read here — the settings root
    // shows one word and the list is a screen away.
    await loadSyncState();
    // The lock row's on or off, the same way.
    await loadLock();
  }

  // ── the account's lock (LockSettingsScreen) ──────────────────────
  //
  // Whether THIS device's file is locked, read from the file itself
  // (commands.rs encryption_status_inner), and the inactivity timeout. A
  // change here goes to the account (account_lock.rs) and every paired
  // device follows; the root row's value and the App's inactivity timer
  // follow here at once.
  let lockOn = $state(false);
  let lockTimeout = $state(0);
  let lockBusy = $state(false);
  let lockError = $state(/** @type {string|null} */ (null));

  async function loadLock() {
    try { lockOn = !!(await checkEncryptionStatus()); } catch {}
    try { lockTimeout = parseInt((await getSetting("lock_timeout_minutes")) || "0", 10) || 0; } catch {}
  }

  async function submitLock(form, values) {
    if (lockBusy) return;
    lockBusy = true;
    lockError = null;
    try {
      if (form === "setup") await setupEncryption(values.next);
      else if (form === "change") await changePassphrase(values.current, values.next);
      else if (form === "off") await removeEncryption(values.current);
      await loadLock();
      announceLockSettings({ encrypted: lockOn });
      if (pushed[pushed.length - 1]?.kind === "lock") popScreen();
      showToast(form === "setup" ? "the lock is on, on every device" : form === "off" ? "the lock is off, on every device" : "the passphrase changed, on every device");
    } catch (err) {
      // The backend's own words ("that is not the current passphrase").
      lockError = String(err?.message ?? err);
    } finally {
      lockBusy = false;
    }
  }

  async function chooseLockTimeout(minutes) {
    lockTimeout = minutes;
    try {
      await setLockTimeout(minutes);
      announceLockSettings({ timeoutMin: minutes });
    } catch (err) {
      console.error("shell: could not save the lock timeout", err);
    }
  }

  /** The push, and it is the model's own id that travels. Nothing here
   *  invents one — every caller is a row `settingsGroups` produced — which
   *  is what makes `settingsSection` returning null for an unknown id a
   *  refusal rather than a state the app can reach.
   *
   *  WHICH SCREEN a row opens is the model's answer too, not a name
   *  matched here. `sync` is a stack of its own (§2) and the other four
   *  are one component parameterised by `settingsSectionId`; asking
   *  `settingsRowScreen` is what stops this function growing a second
   *  opinion about a row settings-model.js did not list. */
  function openSettingsRow(id) {
    if (settingsRowScreen(id) === "sync") {
      push("sync");
      loadSyncDevices();
      return;
    }
    if (settingsRowScreen(id) === "lock") {
      lockError = null;
      push("lock");
      loadLock();
      return;
    }
    settingsSectionId = id;
    push("settings");
  }

  async function selectTone(next) {
    // Report first, persist second. The order is what the writer sees: the
    // repaint is synchronous through the host, the round trip is not.
    onTone(next);
    try {
      await setSetting("canvas_tone", next);
    } catch (err) {
      console.error("shell: could not save the tone", err);
    }
  }

  async function selectFont(next) {
    onFontFamily(next);
    try {
      await setSetting("canvas_font_family", next);
    } catch (err) {
      console.error("shell: could not save the font", err);
    }
  }

  /** Which section's rows mean which choice. Keyed by SECTION rather than
   *  by row, because a choice row's id is the option's (`cream`,
   *  `dm-mono`) and two sections could one day offer the same option
   *  name. A section with no entry picks nothing, which is the same
   *  "a row exists exactly when its action does" rule ARTIFACT_ROW_ACTIONS
   *  keeps. */
  const SETTINGS_CHOICES = {
    tone: selectTone,
    font: selectFont,
  };

  /** A choice row selects AND POPS, which is the promise the row itself
   *  makes: `row-kind.js` defines the kind that way, and
   *  SettingsSectionScreen withholds its chevron BECAUSE of it — a chevron
   *  says a tap opens a screen, and a tone option opens none.
   *
   *  THE HOST DID NOT KEEP THAT PROMISE, found on an A16. The section
   *  stayed open after the choice, and the cost is not just a stray
   *  back-press: a tap aimed at the settings root a moment later lands on
   *  the still-open section instead. The run that caught this chose `dark`,
   *  tapped where the root's first row had been, and hit the section's
   *  first row — the tone went back to cream, and the database with it.
   *
   *  Popped only when a choice actually ran: a section with no entry in
   *  SETTINGS_CHOICES (labs is toggles, about is values) must not pop on a
   *  row that did nothing. The pop is not awaited because the write is not
   *  — `selectTone` repaints through the host first and persists second, so
   *  what the writer sees on the way back is already right. */
  function chooseSetting(optionId) {
    const choose = SETTINGS_CHOICES[settingsSectionId];
    if (!choose) return;
    choose(optionId);
    popScreen();
  }

  async function setYjs(next) {
    yjsEnabled = next;
    try {
      await setYjsEnabled(next);
    } catch (err) {
      console.error("shell: could not save the labs flag", err);
    }
  }

  /** The escape hatch's control. Writes the key App.svelte's boot fork
   *  reads, through shell-switch.js so the string is the one
   *  `shouldBootShell` recognises — "false" exactly, not any of the near
   *  misses that would also leave the desktop tree and would not come back
   *  from it.
   *
   *  ── NOTHING HAPPENS AFTER THE WRITE, AND THAT IS THE DECISION ───────
   *
   *  `try_new_shell` is read once, at App.svelte's boot, into a `$state`
   *  nothing re-reads — so the write cannot change the tree on screen, and
   *  the choice is what to do about that. Three were on the table:
   *
   *  RELOAD the window (`src/lib/demo/bootstrap.js` does exactly this
   *  after its own settings write) would deliver the desktop tree at once.
   *  Rejected, and the reason is this task's own premise: opting back IN
   *  is not built. `src/components/Settings.svelte` is a desktop component
   *  this branch may not touch, so there is no control on that tree to
   *  turn the shell back on. A switch that ejects you the instant it is
   *  touched would make one mis-tap unrecoverable without editing SQLite,
   *  which is the exact state this control exists to end. Leaving the
   *  reader here leaves the switch under their thumb: flick it back and
   *  the write becomes "true", which shell-boot reads as on, and the exit
   *  is cancelled with no trace.
   *
   *  REPORT UPWARD and let App.svelte swap trees live would need a second
   *  owner of `shellFlag`, and would mount the desktop tree into a session
   *  whose `onMount` has already run — a tree booting against something
   *  other than what it boots against on a real launch.
   *
   *  SAY SO, which is what this does. The model puts a note under the
   *  switch (`SHELL_OFF_NOTE`) naming when the layout changes, so the
   *  control reports what it did rather than appearing to do nothing.
   *
   *  Local first, no rollback on failure — the section's own rule, three
   *  screens up. */
  async function setShellEnabled(next) {
    shellEnabled = next;
    try {
      await setSetting(SHELL_SWITCH_KEY, shellSwitchValue(next));
    } catch (err) {
      console.error("shell: could not save the layout switch", err);
    }
  }

  /** Toggle rows, keyed by row id — these ARE unique across sections, and
   *  a toggle carries its own new value rather than reading the old one
   *  back off state that the click has already changed. */
  const SETTINGS_TOGGLES = {
    yjs: setYjs,
    shell: setShellEnabled,
  };

  function toggleSetting(rowId, checked) {
    SETTINGS_TOGGLES[rowId]?.(checked);
  }

  /** The data section's export: what it last did, for the note under the
   *  row. null until pressed. settings-model.js decides what it says. */
  let exportStatus = $state(null);

  /** Every page, packed into one zip and handed to the share sheet
   *  (runExportZip). The model holds the row while this runs, so a second
   *  press is not reachable; the guard here is for a caller that is not
   *  the row. */
  async function exportEverything() {
    if (exportStatus?.state === "working") return;
    exportStatus = { state: "working" };
    try {
      const summary = await runExportZip();
      if (live) exportStatus = { state: "done", pageCount: summary.pageCount };
    } catch (err) {
      console.error("shell: the export did not finish", err);
      if (live) exportStatus = { state: "failed" };
    }
  }

  /** Action rows, by row id: a row exists exactly when its action does. */
  const SETTINGS_ACTIONS = {
    export: exportEverything,
  };

  function actOnSetting(rowId) {
    SETTINGS_ACTIONS[rowId]?.();
  }

  // ── sync ─────────────────────────────────────────────────────────────
  //
  // §2: "Sync is a stack: devices → pair → scanner (full-screen camera
  // with its own back)." What each of those three screens SHOWS is
  // sync-model.js, and its header names what of the desktop's 2392-line
  // sync surface is absent and why. What lives here is what a model
  // cannot hold: the reads, the pairing exchange, and the three pushes.
  //
  // THREE LEVELS NEEDED NO NEW MACHINERY, and saying so is the answer to
  // the question Task 1 left open. Task 1 capped SETTINGS at two levels
  // because Stack calls `entry.view()` with no arguments — one component
  // standing for four sections has to be told which one it is, and one
  // host variable can only say that once. Sync is the other shape: three
  // levels, three different components, so each is a `kind` in `pushed`
  // and a snippet beside the others, exactly as `reading`, `trails` and
  // `pins` already are. No router, no second navigation, no id variable.
  //
  // THE CAMERA IS NOT MANAGED FROM HERE. It belongs to the screen that
  // owns it, whose mount is its lifetime — see SyncScanScreen's header
  // for what happens when it is backgrounded, refused, or popped
  // mid-scan. This file's only part in it is that `readCode` pops before
  // it joins.

  /** The `sync_status` snapshot, or null before one is read. Null is a
   *  third state and not a spelling of "off": `syncStateLabel` answers ""
   *  for it, so the settings root's value column stays empty rather than
   *  telling a synced writer their account is gone for the length of a
   *  round trip. */
  let syncState = $state(null);
  let syncDevices = $state([]);
  let syncDevicesLoading = $state(false);

  async function loadSyncState() {
    try {
      const snapshot = await readSyncStatus();
      if (live) syncState = snapshot;
    } catch (err) {
      // Not fatal and not silent. Every sync command goes through Tauri,
      // and in a browser — the PWA, the dev server, the VR harness —
      // there is no backend to answer. The row shows nothing, which is
      // what null means.
      console.error("shell: could not read the sync state", err);
      if (live) syncState = null;
    }
  }

  /** The devices screen's fetch, hung off its push for memory's and
   *  PinsScreen's reason: a read tied to the event that opens a surface
   *  cannot be stale. Called again when a pairing completes, because the
   *  list is exactly what changed. */
  async function loadSyncDevices() {
    syncDevicesLoading = true;
    await loadSyncState();
    try {
      // Only when there is an account to list. `sync_list_devices` on an
      // unconfigured install has no relay to ask and rejects, and a
      // rejection logged on every open of a screen whose whole message is
      // "you are not set up" is noise that hides the real ones.
      const rows = syncState?.configured ? await listDevices() : [];
      if (live) syncDevices = rows;
    } catch (err) {
      console.error("shell: could not read the devices", err);
      if (live) syncDevices = [];
    } finally {
      if (live) syncDevicesLoading = false;
    }
  }

  /** The status row's switch. `syncSetEnabled` is the whole act — the
   *  desktop's own call, and the same one the setup wizard's `turn on`
   *  makes — and the re-read after it is what puts the answer on screen:
   *  the row draws from `syncState`, so a flip that did not reload would
   *  show a switch in a position the backend never took.
   *
   *  The failure is logged and the row springs back, because the state is
   *  derived from the status rather than held beside it. Nothing else to
   *  say: the one error this can raise is a database write failing, which
   *  is not a sentence a writer can act on, and this screen has no error
   *  surface (see the omission on the raw error string). */
  async function setSyncEnabled(next) {
    try {
      await syncSetEnabled(!!next);
    } catch (err) {
      console.error("shell: could not change whether sync is on", err);
    }
    await loadSyncDevices();
  }

  /** Task 9g. The screen's `disconnect` row asks; this sheet's destructive
   *  row is the act. `sync_reset` clears the sync state and keys, stops the
   *  worker and marks every sent op local-only again — pages, trails, pins
   *  and settings stay (commands.rs `sync_reset`, the desktop's own
   *  disconnect). Then the screen re-reads, setSyncEnabled's way, and the
   *  re-read is what turns it back into `set up sync`.
   *
   *  The sheet closes before the await, deleteManagedTrail's order, and
   *  `disconnecting` holds a second press out while the first is in
   *  flight: one tap is one reset. `pairPhase` returns to `waiting`
   *  because a `done` left over from a pairing earlier in the session is
   *  one of the two phases `setupRowShows` hides setup for, and the account
   *  it finished onto is gone. A failure is logged with no sentence, the
   *  toggle's reason — this screen has no error surface — and the re-read
   *  shows whatever the backend actually holds. */
  let disconnecting = false;
  const disconnectWords = $derived(disconnectSheet(syncState));

  async function disconnectSync() {
    openSheet = null;
    if (disconnecting) return;
    disconnecting = true;
    try {
      await syncReset();
    } catch (err) {
      console.error("shell: could not disconnect sync", err);
    } finally {
      disconnecting = false;
    }
    await loadSyncDevices();
    // After the re-read, and on what it says rather than on whether the
    // call resolved (9g review): a reset that fails mid-batch can leave the
    // database unconfigured with the call rejected, and a leftover `done`
    // would then hide both `set up sync` and the pair row's purpose for
    // the session. Off an account, no pairing is in progress to keep.
    if (live && !syncState?.configured) pairPhase = "waiting";
  }

  /** How long a pairing code lives, and how many times the showing device
   *  asks whether the other one has joined. Both are the desktop's own
   *  (SyncSettings.svelte:666, 708): fifteen minutes because five was too
   *  tight for someone typing a code by hand on a second device, and 120
   *  batches of a five-attempt poll because the relay 404s until the
   *  joining device deposits its key. */
  const PAIR_TTL_SECONDS = 900;
  const PAIR_POLL_BATCHES = 120;

  /** `starting` · `waiting` · `verify` · `working` · `done`. The showing
   *  side starts at `starting` with a command in flight; the joining side
   *  starts at `waiting` with a row to press. */
  let pairPhase = $state("waiting");
  let pairWords = $state("");
  let pairQr = $state("");
  let pairSas = $state("");
  let pairToken = $state("");
  let pairEphemeralPub = $state("");
  let pairBundle = $state("");
  let pairLabel = $state("");
  /** The side the pairing was CONFIRMED on. Kept because the live one is
   *  `pairSide(syncState)`, and a joining device becomes configured at
   *  exactly the moment it is done — so read live, the end of a join would
   *  describe itself as the end of a show. */
  let pairedSide = $state(null);
  let pairError = $state("");

  /** Whether the exchange in flight still has a screen to land on. Plain
   *  `let`: nothing rendered reads it, and it is written from inside
   *  awaits that outlive the screen. */
  let pairCancelled = true;

  /** CANCELLATION FOLLOWS THE STACK, NOT A DOOR — Stack's own rule for
   *  its navstack registrations, applied to a network exchange. There are
   *  five ways the pair screen can leave: its back button, the edge
   *  flick, the Android system button, `goRoot` emptying the stack on a
   *  tab tap, and `adoptPage` doing the same. Hanging the cancel off
   *  `popScreen` would cover the first three and leave a poll running
   *  behind memory for the other two. Reading `pushed` covers all five,
   *  because every one of them removes the element. */
  $effect(() => {
    if (!pushed.some((screen) => screen.kind === "sync-pair")) pairCancelled = true;
  });

  function openPair() {
    // openSetup's demo gate, for the same reason and one more: the pair
    // screen's scan row opens the camera (SyncScanScreen calls
    // getUserMedia), which on the public demo is a permission prompt for a
    // pairing that cannot happen, and a scanned code then reaches
    // pair_new_join, whose null answer the screen reports as an error
    // beside the strip's notice. pair_existing_start is noticed
    // (src/lib/demo/unavailable.js), so the strip says why instead.
    if (import.meta.env.VITE_DEMO) {
      pairExistingStart().catch(() => {});
      return;
    }
    pairCancelled = false;
    pairPhase = "waiting";
    pairWords = "";
    pairQr = "";
    pairSas = "";
    pairToken = "";
    pairEphemeralPub = "";
    pairBundle = "";
    pairLabel = "";
    pairedSide = null;
    pairError = "";
    push("sync-pair");
    if (pairSide(syncState) === "show") startPairShow();
  }

  /** Level 4. The push is all there is to it: the camera opens and closes
   *  with the screen, which is what makes every way out of it — this
   *  shell's four backs plus a tab tap — release the lens without any of
   *  them knowing there was one. */
  function openScanner() {
    // Only the pair screen reaches this, and the demo never opens that
    // screen (openPair). Gated here too so a second way in, added later,
    // cannot be the one that asks a demo visitor for their camera.
    if (import.meta.env.VITE_DEMO) {
      pairExistingStart().catch(() => {});
      return;
    }
    push("sync-scan");
  }

  /** The showing side: mint a code, draw it, then wait for the other
   *  device to deposit its key. */
  async function startPairShow() {
    pairPhase = "starting";
    let started;
    try {
      started = await pairExistingStart(PAIR_TTL_SECONDS);
    } catch (err) {
      console.error("shell: could not start a pairing", err);
      pairError = pairErrorText(err);
      pairPhase = "waiting";
      return;
    }
    if (pairCancelled || !live) return;
    // The words are the contract and the image is a convenience, so they
    // are set in that order and the encoder's failure below cannot take
    // the code away.
    pairToken = started.pair_token;
    pairBundle = started.qr_payload;
    pairWords = started.pair_token.replace(/-/g, " ");
    pairPhase = "waiting";
    // The poll starts BEFORE the picture is drawn, and neither awaits the
    // other. The other device can read the words the moment they are on
    // screen, so a join can land while the encoder is still loading — and
    // an encoder that is slow or broken must not be what decides when
    // this device starts listening.
    waitForPairJoin();
    drawPairCode(started.qr_payload);
  }

  async function drawPairCode(payload) {
    try {
      // Imported on demand: `qrcode` is the only thing in the shell's
      // dependency graph that exists for one screen of one stack, and a
      // static import would put it in the bundle every writer downloads
      // to open a page.
      const { default: QRCode } = await import("qrcode");
      const url = await QRCode.toDataURL(payload, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 280,
      });
      if (!pairCancelled && live) pairQr = url;
    } catch (err) {
      // The words still work. A missing image is a smaller failure than a
      // screen that says pairing broke when it did not.
      console.error("shell: could not draw the pairing code", err);
    }
  }

  async function waitForPairJoin() {
    for (let batch = 0; batch < PAIR_POLL_BATCHES; batch++) {
      if (pairCancelled || !live) return;
      try {
        const answer = await pairExistingFetchSas(pairToken, 5);
        if (pairCancelled || !live) return;
        pairSas = answer.sas;
        pairEphemeralPub = answer.ephemeral_pub_b64;
        pairPhase = "verify";
        return;
      } catch {
        // Not yet. The relay 404s until the other device has deposited
        // its ephemeral key, so a rejection here is the ordinary answer
        // and not an error to report — the desktop's own loop swallows it
        // for the same reason. A real failure surfaces as the timeout
        // below.
      }
    }
    if (!pairCancelled && live) pairError = pairErrorText("timed out");
  }

  /** The joining side, once the scanner has read a code. */
  async function joinWithCode(payload) {
    pairBundle = payload;
    pairError = "";
    pairPhase = "working";
    try {
      const answer = await pairNewJoin(payload);
      if (pairCancelled || !live) return;
      pairSas = answer.sas;
      pairPhase = "verify";
    } catch (err) {
      console.error("shell: could not join with that code", err);
      if (pairCancelled || !live) return;
      pairError = pairErrorText(err);
      pairPhase = "waiting";
    }
  }

  /** The scanner read a code, so its job is done and the stack goes back
   *  to the pair screen the exchange runs on.
   *
   *  The pop is NAVIGATION, not what releases the camera — the scanner
   *  has already stopped its own stream on the read, before this is
   *  called (SyncScanScreen's handleResult, and the test that drives a
   *  real decode and asserts the stop). Written that way round on
   *  purpose: swapping these two lines is invisible to every test in the
   *  suite, so an ordering claim here would be a claim nothing holds. */
  function readCode(payload) {
    popScreen();
    joinWithCode(payload);
  }

  /** The one act on both sides that exchanges anything, and the reader
   *  performs it. Nothing before this point has moved a key: a malicious
   *  relay can substitute its own ephemeral key, and the comparison of
   *  these digits on two screens is the only thing that catches it
   *  (SyncSettings.svelte:697-701). */
  async function confirmPair() {
    const side = pairSide(syncState);
    pairError = "";
    pairPhase = "working";
    try {
      if (side === "show") {
        await pairExistingConfirm({
          pairToken,
          ephemeralPubB64: pairEphemeralPub,
          newDeviceLabel: pairLabel.trim() || UNNAMED_NEW_DEVICE,
        });
      } else {
        // The label argument is discarded on this side — commands.rs:6477,
        // `let _ = device_label;`, because the existing device is what
        // sends the name to the relay's pair_finalize. That is why this
        // screen offers no field for it. The desktop's own default goes
        // in anyway, so that if the argument is ever read the two trees
        // say the same thing rather than this one writing an empty name.
        await pairNewComplete(pairBundle, DEFAULT_DEVICE_LABEL, PAIR_POLL_BATCHES);
      }
      if (pairCancelled || !live) return;
      pairedSide = side;
      pairPhase = "done";
      // The joining side's backend may have deleted the blank page this
      // screen has open (snapshot.rs clear_placeholder_pages); the pull
      // listener's way back to today runs now, not at the first pull.
      if (side !== "show") await refreshOpenPage();
      await loadSyncDevices();
    } catch (err) {
      console.error("shell: could not finish the pairing", err);
      if (pairCancelled || !live) return;
      pairError = pairErrorText(err);
      // Back to the digits rather than to the start: the code is still
      // live, both devices still hold it, and a failure here is usually
      // the other side not having confirmed yet.
      pairPhase = "verify";
    }
  }

  // ── sync setup ───────────────────────────────────────────────────────
  //
  // The account wizard, for the phone that has no other device to pair
  // with. What each step DECIDES is sync-setup-model.js — which step is
  // next, whether the words may go, which url a choice means, which
  // command the relay's mode picks, what a failure says. What lives here
  // is what a model cannot hold: the phrase in flight, the four calls,
  // and the push.
  //
  // THE PROBE COMES FIRST, and it is not only a reachability check. The
  // desktop's `connect` asks `sync_relay_health` and reads its `mode`
  // before choosing a command, because a single-account relay takes
  // `sync_self_enroll` and only a `multi_user` one distinguishes a new
  // account (`sync_init`) from a kept phrase (`sync_recover`). A host that
  // skipped the probe would have to guess the relay's shape from the url.
  //
  // THE WORDS LEAVE MEMORY when the relay has them. Both the generated
  // phrase and the typed one are cleared on a successful enrol, the
  // desktop's own move: the state row is the proof of the account from
  // then on, and a phrase held in a host variable for the life of the
  // app is a secret with no reason to be there.

  let setupStep = $state("phrase");
  let setupMode = $state("generate");
  /** The generated words. "" until `sync_generate_phrase` answers, and
   *  again once the relay holds them. */
  let setupPhrase = $state("");
  /** The typed words, as typed. Normalised at the count and at the call,
   *  never in the field — a field that rewrites under the writer's thumb
   *  is a field that eats the word they are halfway through. */
  let setupTyped = $state("");
  let setupRelayChoice = $state(defaultRelayChoice());
  let setupRelayUrl = $state("");
  let setupLabel = $state("");
  let setupWorking = $state(false);
  let setupError = $state("");

  /** `pairCancelled`'s shape and reason: read from `pushed`, so every
   *  way off the screen — five of them — stops an answer landing on a
   *  screen that is gone. */
  let setupCancelled = true;
  $effect(() => {
    if (!pushed.some((screen) => screen.kind === "sync-setup")) setupCancelled = true;
  });

  function openSetup() {
    // The browser demo cannot make a recovery phrase, and the setup screen's
    // first act is to ask for one: pushed, it answered the demo strip's
    // "runs in the installed app" with "could not make a phrase. try again."
    // underneath, which reads as the demo being broken. In the demo build
    // the row asks the same command and stops there; the demo classifies it
    // as noticed (src/lib/demo/unavailable.js), so the strip says why.
    if (import.meta.env.VITE_DEMO) {
      syncGeneratePhrase().catch(() => {});
      return;
    }
    setupCancelled = false;
    setupStep = "phrase";
    setupMode = "generate";
    setupPhrase = "";
    setupTyped = "";
    setupRelayChoice = defaultRelayChoice();
    setupRelayUrl = "";
    setupLabel = "";
    setupWorking = false;
    setupError = "";
    push("sync-setup");
    generateSetupPhrase();
  }

  /** `sync_generate_phrase` answers a string of 24 words (commands.rs:
   *  `Ok(generate_seed_phrase().to_string())`); the browser mock answers
   *  null. Anything that is not a non-empty string is the failure
   *  sentence, not an empty box the writer might copy down. */
  async function generateSetupPhrase() {
    setupWorking = true;
    try {
      const words = await syncGeneratePhrase();
      if (setupCancelled || !live) return;
      setupPhrase = typeof words === "string" ? words.trim() : "";
      if (!setupPhrase) setupError = PHRASE_FAILED;
    } catch (err) {
      console.error("shell: could not make a recovery phrase", err);
      if (setupCancelled || !live) return;
      setupError = PHRASE_FAILED;
    } finally {
      if (live) setupWorking = false;
    }
  }

  function chooseSetupMode(mode) {
    setupMode = mode;
    setupError = "";
    // Back to `new account` after a failed generate asks again; after a
    // successful one the words are still here and nothing is asked.
    if (mode === "generate" && !setupPhrase && !setupWorking) generateSetupPhrase();
  }

  /** The phrase the enrol command receives: the generated words on the
   *  new-account path, the typed words normalised on the other. One
   *  function, so the two paths cannot cross by reading different
   *  variables in two places. */
  function setupPhraseToSend() {
    return setupMode === "existing" ? normalizePhrase(setupTyped) : setupPhrase;
  }

  function setupNextStep() {
    setupError = "";
    if (setupMode === "existing") {
      const problem = phraseProblem(setupTyped);
      if (problem) {
        setupError = problem;
        return;
      }
    } else if (!setupPhrase) {
      setupError = PHRASE_FAILED;
      return;
    }
    setupStep = setupNext("phrase");
  }

  function setupBackToPhrase() {
    setupError = "";
    setupStep = "phrase";
  }

  function chooseSetupRelay(choice) {
    setupRelayChoice = choice;
    setupError = "";
  }

  async function copySetupPhrase() {
    if (await writeClipboard(setupPhrase)) showToast(PHRASE_COPIED);
  }

  async function connectSetup() {
    setupError = "";
    const url = relayUrlFor(setupRelayChoice, setupRelayUrl);
    const problem = relayProblem(url);
    if (problem) {
      setupError = problem;
      return;
    }
    const phrase = setupPhraseToSend();
    const label = deviceLabelFor(setupLabel);
    setupWorking = true;
    try {
      const health = await syncRelayHealth(url);
      if (setupCancelled || !live) return;
      const verb = setupVerb({ mode: setupMode, relayMode: health?.mode ?? null });
      if (verb === "recover") await syncRecover(phrase, url, label);
      else if (verb === "init") await syncInit(phrase, url, label);
      else await syncSelfEnroll(phrase, url, label);
      if (setupCancelled || !live) return;
      // A recovery or a self-enroll can join an account and delete the
      // blank page open here, as a pairing can; a new account cannot.
      if (verb !== "init") await refreshOpenPage();
      setupPhrase = "";
      setupTyped = "";
      setupStep = setupNext("relay");
      // The devices screen beneath re-reads: its state row says `off`
      // now and its setup row is gone, and the done step's own state row
      // reads the same snapshot.
      await loadSyncDevices();
    } catch (err) {
      // The probe's failure lands here too, before anything was written,
      // and it leaves every field as it was — the phrase included, which
      // is why the words are cleared only after the enrol call returns.
      console.error("shell: sync setup did not finish", err);
      if (setupCancelled || !live) return;
      setupError = setupErrorText(err);
    } finally {
      if (live) setupWorking = false;
    }
  }

  /** The done step's `turn on`: the desktop's `enable`. Enrolment leaves
   *  `enabled` false, so this is what starts the worker; a recovered
   *  account then force-pulls, because it has history to fetch and a
   *  fresh one has none. Pops on success — the devices screen beneath is
   *  where `on` and the device list are read. */
  async function enableSetup() {
    setupError = "";
    setupWorking = true;
    try {
      await syncSetEnabled(true);
      if (setupCancelled || !live) return;
      await loadSyncDevices();
      if (setupMode === "existing") {
        syncForcePull().catch((err) =>
          console.warn("shell: force-pull after recovery failed", err),
        );
      }
      popScreen();
    } catch (err) {
      console.error("shell: could not turn sync on", err);
      if (setupCancelled || !live) return;
      setupError = setupErrorText(err);
    } finally {
      if (live) setupWorking = false;
    }
  }

  /** The one act every back converges on, whichever door it came through:
   *  Stack's committed edge drag calls it directly, the nav bar's back
   *  button calls it, and platform back reaches it through the navstack
   *  entry Stack registered. Removing the top ELEMENT is the whole
   *  contract Stack asks of a host (its header). */
  function popScreen() {
    const top = pushed[pushed.length - 1];
    pushed = pushed.slice(0, -1);
    // The one door every way off the pin's screen goes through — the
    // bar's back, the system back (stack-back.js), the edge gesture — so
    // this is where the screen's draft is written. See flushArtifactDraft.
    if (top?.kind === "pin-artifact") flushArtifactDraft();
    if (top?.kind === "trail") flushTrailDraft();
  }

  /** A root switch drops the page's stack. Pins is pushed FROM the page
   *  (§2) and belongs to it; carrying it over the tab bar would leave a
   *  pins screen sitting on top of memory with a back that reveals the
   *  wrong root underneath. */
  /** Re-read the loaded page's row before the canvas is built from it again.
   *
   *  ── THE WRITING THIS LOST ────────────────────────────────────────────
   *
   *  Write a line, glance at memory, come back: the line was gone, from the
   *  database as well as the screen. Measured on an SM-A065F, asking the
   *  backend at each step rather than the screen that had already forgotten:
   *
   *      typed, 4s settled ............ the backend HAS the line
   *      after BACK hid the keyboard ... HAS
   *      after leaving for memory ...... HAS
   *      after RETURNING to the page ... GONE
   *
   *  So the save was never the problem. The RETURN destroyed it, which is a
   *  worse thing than a save that does not land: the row was correct on
   *  disk and got overwritten with an older copy of itself.
   *
   *  `rootView` renders PageScreen under `{#if active === "page"}`, so
   *  leaving the tab DESTROYS it and coming back builds a new one. The new
   *  one is seeded from this component's `page` (PageScreen:1609,
   *  `initialContent={page.content_json ?? null}`) — and that row has been
   *  sitting here since it was loaded. The editor holds the writing; the
   *  row does not. The fresh editor therefore starts from the old content
   *  and its first autosave writes that over the newer row.
   *
   *  Re-reading here is the same move `loadMemory` and `loadSettings`
   *  already make two lines below, for the reason goRoot's own comment
   *  gives about memory: re-entering re-reads rather than showing what was
   *  true last time. The page arm simply never had that argument applied to
   *  it, because until the canvas could be destroyed it was never wrong.
   *
   *  ── WHY IT IS AWAITED BEFORE THE SWITCH, NOT AFTER ───────────────────
   *
   *  `active = id` is synchronous and PageScreen mounts on that assignment.
   *  A re-read started afterwards is a race against the new editor's first
   *  autosave, and losing that race loses the writing exactly as before —
   *  so the read has to have landed before there is anything to seed.
   *
   *  It NEVER REFUSES THE SWITCH. A writer who cannot leave a screen has a
   *  worse problem than a stale one, so a failed read is logged and the tab
   *  changes anyway.
   *
   *  Not adoptPage: the trail, its ancestors and the day's page count have
   *  not changed by walking to memory and back, and re-deriving them would
   *  put three more round trips in front of a tab tap. */
  async function refreshLoadedPage() {
    if (!page) return;
    const reading = page.id;
    try {
      const fresh = await getPage(...pageAddress(page));
      // `live` for adoptPage's reason: the shell can be unmounted mid-read.
      // And only onto the page it was read for: continue (openOnThePage)
      // adopts its page without waiting for this, and the old page's read
      // landing afterwards put the old page back on the writing surface
      // (sync journey J10.6, 2026-10-24).
      if (live && fresh?.page && page?.id === reading) page = fresh.page;
    } catch (err) {
      console.error("shell: could not re-read the page before showing it", err);
    }
  }

  async function goRoot(id) {
    if (active === id) return;
    // Before anything changes, so a slow read shows the screen the writer is
    // still on rather than a half-switched one.
    if (id === "page") await refreshLoadedPage();
    clearStack();
    active = id;
    // A ROOT SWITCH IS NOT TYPING, so forget any keyboard baseline learned
    // on the way here. It is the one operation that does not re-read the
    // viewport — zeroing the baseline makes the shrink 0 whatever a frozen
    // webview claims — and this is where it belongs now that the strip's
    // chevron is gone: a belief that went stale clears itself the moment
    // the writer leaves the page, with no control to find and no pixels
    // spent on one. See resetKeyboardBaseline (keyboard-state.js) for why
    // nothing else can do it.
    resetKeyboardBaseline();
    // Memory reads on arrival, and this is the only door: the tab bar and
    // the canvas swipe both come through here. Re-entering re-reads rather
    // than showing what was true last time — the writer has been on the
    // page in between, and a memory that opens on a list missing the page
    // they just wrote is the shape of an archive nobody trusts.
    if (id === "memory") loadMemory();
    // The same door, for the same reason: `enable_yjs` is cached
    // module-wide by feature-flag.js and the desktop writes the same key,
    // so a settings root that showed what it read once would drift from
    // what the editor is actually doing.
    if (id === "settings") loadSettings();
  }

  function routeGesture(g) {
    if (g.owner === "memory") goRoot("memory");
    else if (g.owner === "page") goRoot("page");
    else if (g.owner === "page-switch") openPagesSheet();
    // Every other owner belongs to something else — see the section
    // header, which names each of them and what performs it.
  }

  // Every write in adoptPage happens after an await, and the shell can be
  // unmounted mid-load — a tester flipping `try the new shell` back off
  // does exactly that. `live` stops those resolutions landing in a
  // component that is gone, and stops getLineages() being asked for at all
  // once nobody is listening.
  //
  // No test covers this, and saying so is the point rather than an
  // omission: removing the flag and all its checks leaves the shell suite
  // unchanged. Svelte 5 tolerates a write to a destroyed component's
  // $state silently, so the guard buys a spared round trip and an honest
  // lifecycle — not a caught crash. Do not add a mount-then-unmount test
  // to "prove" it: there is nothing observable to assert, and a green test
  // would claim a protection that does not exist.
  //
  // It is component scope rather than onMount-local from P2f Task 3 on,
  // because the load is no longer only the mount's: the date sheet, the
  // pages sheet, `+` and the trail sheet all hand a different row to the
  // same function, and a flag one of five callers could see is a flag.
  let live = true;

  /** Take a page row as the one the shell is showing: its trail, its mode,
   *  the day's page count, and finally the row itself.
   *
   *  ORDER IS LOAD-BEARING and it is the trail lookup that decides it.
   *  Untrailed is the ordinary state of a page, not an edge case, so it
   *  must not cost a round trip — mode lives on the LINEAGE, and
   *  `page.lineage_mode` (which Page.svelte:296 reads) is not a field the
   *  Rust Page struct has, so this lookup is the only place the shell can
   *  learn it.
   *
   *  The lookup runs BEFORE the row is published, and that order decides
   *  the outcome rather than merely tidying it. EditorCore reads trailMode
   *  once, inside onMount (:156). A canvas that mounts on the row and is
   *  told the mode a round trip later has already built its editor
   *  unbound, and the late prop changes nothing — so a continuous page
   *  would take the discrete save route by TIMING, which looks identical
   *  on screen to taking it by omission. Proven by reversing the two:
   *  ShellApp.test's "carries the trail's mode to the canvas" goes red.
   *
   *  Its own try/catch because the page is already in hand: a lineage read
   *  that throws must cost the trail name and the mode, not the page.
   *  Untrailed pages skip the whole block and publish immediately. The
   *  count gets the same treatment for the same reason — it is asked for
   *  after the row lands, so a throw there must not take the row down. */
  /** The focus line's write. PageScreen has already asked focus-line.js
   *  whether this is an edit, so every call here is one — the row is
   *  patched in place first (the reading view and memory's list read
   *  `what_matters_now` off this same object), then the command runs.
   *  Mutated rather than reassigned: the page object is the identity
   *  EditorCore was mounted against, and a fresh object would re-run
   *  every effect that reads `page` for a change of one column.
   *
   *  The command takes the text as given and the row stores `null` for
   *  an emptied title, which is what the desktop's Page.svelte writes
   *  into its rail for the same case (`text || null`). */
  async function commitFocusLine(text) {
    if (!page || readonly) return;
    const id = page.id;
    page.what_matters_now = text || null;
    // On a living document the focus is also today's marker in the doc
    // (focus-line.js dayMarkerStamp); the editor's own transaction saves it.
    const stamp = dayMarkerStamp({ trailMode: loadedTrailMode, lineageId: page.lineage_id, readonly, text, day: clockDay });
    if (stamp) core?.stampDayMarker?.(stamp.date, stamp.whatMatters);
    focusWrites += 1;
    focusWritesBegun += 1;
    try {
      await updateWhatMattersNow(id, text);
    } catch (err) {
      console.error("shell: could not save what matters now", err);
    } finally {
      focusWrites -= 1;
    }
  }

  /** Focus-line writes still on their way to the row. While one is, a pull's
   *  read of the page holds the line from before it, and patching the field
   *  from that read blanked what the writer had just set (refreshOpenPage,
   *  sync journey J5.3). Plain, not state: only that read consults it. */
  let focusWrites = 0;
  /** Every write ever begun, so a read can tell one started while it was out
   *  even if it has already finished by the time the read lands. */
  let focusWritesBegun = 0;

  async function adoptPage(row) {
    if (!live || !row) return;

    let name = null;
    let mode = null;
    let parents = [];
    if (row.lineage_id) {
      try {
        const lineages = await getLineages();
        if (!live) return;
        const lineage = lineages?.find((l) => l.id === row.lineage_id) || null;
        name = lineage?.name || null;
        mode = lineage?.mode || null;
        // The ancestors, for the header's crumb. Read here because the
        // whole list is already in hand for the name — a second fetch to
        // answer "what is this inside" would be a round trip for something
        // that arrived in the first one.
        parents = lineagePath(row.lineage_id, lineages ?? [])
          .filter((l) => l.id !== row.lineage_id)
          .map((l) => l.name);
      } catch (err) {
        console.error("shell: could not read the page's trail", err);
      }
    }
    loadedTrailName = name;
    loadedTrailMode = mode;
    loadedTrailParents = parents;

    page = row;
    trailPinCount = null;
    measurePinCount();
    // The device's day at the moment this page came on screen — midnight.js's
    // second input, and the one that separates "the clock rolled over under
    // the writer" from "the writer opened last Tuesday on purpose". Stamped
    // beside the assignment rather than derived from it, because the fact it
    // records is about the CLOCK, not about the row.
    pageOpenedOn = clockDay;

    // THE DAY'S PAGES, ONCE — the count and this page's position in it come
    // out of the same answer, so they cannot disagree. They used to: the
    // count came from `getPageCountForDate` and the header lit its dot by
    // `page_number`, which is minted MAX+1 per device and never reused. One
    // delete leaves a day of twenty-one pages numbered 1..19, 21, 22, and the
    // dot row drew twenty-one dots with nothing lit. `ordinalOf` is the
    // position, which is what a dot in a row of dots means.
    try {
      const rows = await getFocusesForDate(row.date);
      if (!live) return;
      loadedPageCount = Array.isArray(rows) ? rows.length : null;
      loadedPageOrdinal = ordinalOf(rows, row.id);
    } catch (err) {
      console.error("shell: could not read the day's pages", err);
    }
  }

  onMount(() => {
    live = true;

    (async () => {
      try {
        // getOrCreateToday() resolves the WHOLE PageWithLines —
        // { page, lines, session_markers } — not a page row. Page.svelte:208
        // carries the scar from the mirror-image mistake: passing
        // result.page where the full result was expected "made page =
        // undefined and the editor froze on an empty white view". Here the
        // .page is required; without it every field read below is
        // undefined and the header quietly falls back to its defaults,
        // which is the P2a defect wearing a load.
        const result = await getOrCreateToday();
        await readClockDay(); // judge it by the clock that dated it (clockDay)
        await adoptPage(rememberToday(result?.page ?? null));
      } catch (err) {
        // A failed load must look like an empty page, not a white screen.
        // Everything above writes into $state that already has a usable
        // value, and pageHeaderModel answers for a null page, so swallowing
        // here leaves the frame — root, header, tab bar — on screen. The
        // alternative is a phone showing nothing with no way back.
        console.error("shell: could not load today's page", err);
      }
    })();

    // THE OTHER DEVICE WROTE. See pull-refresh.js for why the shell must
    // listen at all: without it the phone's editor kept the copy it opened
    // with and its next save wrote that over the laptop's words.
    let unlistenPull = null;
    listen("sync-pulled", () => onSyncPulled())
      .then((off) => { if (live) unlistenPull = off; else off(); })
      .catch((err) => console.error("shell: could not listen for sync pulls", err));

    return () => {
      live = false;
      unlistenPull?.();
    };
  });

  async function onSyncPulled() {
    // Mention labels name other pages and trails, which the pull may have
    // renamed or deleted (api.js emitTrailMutated).
    emitTrailMutated();
    const targets = pullRefreshTargets({
      pageOpen: !!page,
      active,
      pushed: pushed.map((p) => p.kind),
      sheet: openSheet,
    });
    if (targets.includes("memory")) loadMemory({ quiet: true });
    if (targets.includes("pins")) refreshPins();
    if (targets.includes("trails")) loadTrails();
    if (targets.includes("reading")) refreshReading();
    if (targets.includes("page")) await refreshOpenPage();
  }

  /** The pins list, read again under the screen showing it. Same lineage
   *  the push froze (pinsLineage says why it is frozen). */
  async function refreshPins() {
    try {
      const rows = await getPins(pinsLineage);
      if (live) pinList = Array.isArray(rows) ? rows : [];
    } catch (err) {
      console.error("shell: could not re-read the pins after a sync pull", err);
    }
  }

  /** The header's trail name, crumb and the day's page dots, read again for
   *  the page already on screen. adoptPage reads the same things but also
   *  reassigns the row, which the open editor must not see. */
  async function refreshHeader(row) {
    try {
      if (row.lineage_id) {
        const lineages = await getLineages();
        if (!live || page !== row) return;
        const lineage = lineages?.find((l) => l.id === row.lineage_id) || null;
        loadedTrailName = lineage?.name || null;
        loadedTrailParents = lineagePath(row.lineage_id, lineages ?? [])
          .filter((l) => l.id !== row.lineage_id)
          .map((l) => l.name);
      }
      const rows = await getFocusesForDate(row.date);
      if (!live || page !== row) return;
      loadedPageCount = Array.isArray(rows) ? rows.length : null;
      loadedPageOrdinal = ordinalOf(rows, row.id);
    } catch (err) {
      console.error("shell: could not re-read the header after a sync pull", err);
    }
  }

  async function refreshOpenPage(again = true) {
    const open = page;
    const writesBefore = focusWritesBegun;
    const address = pulledReadAddress({ page: open, trailMode: loadedTrailMode });
    if (address.how === "none") return;
    try {
      const result = address.how === "trail"
        ? await getCanonicalTrailPage(address.lineageId)
        : await getPage(...pageAddress(open));
      // `live` for adoptPage's reason, and `page !== open` because the
      // writer may have opened another page while this read was out.
      if (!live || page !== open) return;
      const fresh = result?.page ?? null;
      const action = pulledPageAction({ open, fresh, todayStr: clockDay });
      if (action === "reload") {
        // The editor decides whether it may take the words: never while a
        // save of newer typing is pending (pull-reload.js).
        // Put off for typing not yet saved: save it now and read again, as
        // no later pull may come (pull-reload.js, pullReload). Once.
        if (fresh.content_json && core?.reloadFromContent(fresh.content_json) === "deferred" && again) {
          await core?.flushPendingSave?.();
          return refreshOpenPage(false);
        }
        // Patched in place, never reassigned: the row is the identity
        // EditorCore was mounted against (see the focus line's write).
        // Not over a line the writer set that is still being written: this
        // read may predate it (focusWrites).
        if (focusWrites === 0 && focusWritesBegun === writesBefore) page.what_matters_now = fresh.what_matters_now;
        page.is_open = fresh.is_open;
        page.content_json = fresh.content_json;
        measurePinCount();
        refreshHeader(open);
      } else if (action === "retrail") {
        await adoptPage(fresh);
        if (fresh.content_json) core?.reloadFromContent(fresh.content_json);
      } else if (action === "today") {
        const today = await getOrCreateToday();
        await readClockDay(); // judge it by the clock that dated it (clockDay)
        await adoptPage(rememberToday(today?.page ?? null));
      }
    } catch (err) {
      console.error("shell: could not refresh the page after a sync pull", err);
    }
  }

  const model = $derived(
    pageHeaderModel({
      page,
      lineageName: loadedTrailName,
      pageCount: loadedPageCount,
      pageOrdinal: loadedPageOrdinal,
    }),
  );

  // Button id → is it on right now. Five of the six are the id read
  // straight off the editor, and the sixth is why this is a table of
  // questions rather than a table of names.
  //
  // There is no `bulletList` in this schema. StarterKit's list extensions
  // are switched off (shared-extensions.js:63) and unified-list.js replaces
  // them with ONE container node called `list` whose items carry a `marker`
  // attribute — bullet, task, ordered or plain. So the obvious
  // `isActive("bulletList")` is not merely the wrong spelling, it names a
  // node type that does not exist, and tiptap answers false forever: a list
  // button that never lights up, which on screen is indistinguishable from
  // a caret that is not in a list. Written that way first here, and the
  // press test in ShellApp.test.js is what caught it — when `list` was a
  // strip button. It is not one since the visual pass; the read stays
  // because COMMANDS.list's toggle is decided off it.
  //
  // No `link` entry. It used to be read here so the selection strip's
  // `link` could render lit-and-dead at once (the caret in a link, the
  // shell with nowhere to type a URL); that button is absent now rather
  // than dead, so there is no control for the mark to light.
  const MARK_ACTIVE = {
    bold: (ed) => ed.isActive("bold"),
    italic: (ed) => ed.isActive("italic"),
    strike: (ed) => ed.isActive("strike"),
    code: (ed) => ed.isActive("code"),
    list: (ed) => ed.isActive("listItem", { marker: "bullet" }),
  };

  // What each strip button DOES. One table, so the press handler decides
  // nothing and the disabled derivation below can ask this same object
  // which ids exist rather than keeping a second list.
  //
  // None of these chains begins with .focus(), and the desktop's every
  // equivalent does. The strip is only on screen while the keyboard is up,
  // and ToolbarButton's preventDefault means the tap never moved focus in
  // the first place, so focus() would restore a focus nobody lost. What it
  // would also do is scroll — tiptap's focus command brings the selection
  // into view by default — and keeping the caret visible on this phone is
  // caret-visible.js's job, off a band measured against the real frame.
  //
  // NOTHING IN THE SUITE PROVES THIS, and the check that says so was run
  // rather than assumed: putting .focus() back into all three chains
  // leaves ShellApp.test.js at 24 passed. jsdom has no layout, so it
  // cannot tell a scroll that happened from one that did not. This is a
  // judgement about who owns the scroll and the device pass is the only
  // thing that can see it — recorded so the next reader does not mistake
  // an unguarded omission for one a test is holding in place.
  const COMMANDS = {
    bold: (ed) => ed.chain().toggleBold().run(),
    italic: (ed) => ed.chain().toggleItalic().run(),
    strike: (ed) => ed.chain().toggleStrike().run(),
    code: (ed) => ed.chain().toggleCode().run(),
    // `toggleBulletList` exists and is not a toggle. unified-list.js
    // registers it as an alias for setMarker("bullet") (:374), and
    // setMarker only ever sets: pressed twice it converts a bullet item to
    // a bullet item, so the strip's list button would be a one-way trip
    // into a list with no way back out of it. The toggle is the caller's,
    // and this is the desktop's own (TipTapEditor's toggleMarker, :101-116)
    // reduced to one marker: already bullet → plain, which lifts a sole
    // item out of its list and unmarks it otherwise.
    //
    // NOT A STRIP BUTTON since the visual pass. It is reached from the
    // turn-into sheet's `list` row on a paragraph (PARAGRAPH_TURN_INTO,
    // below runConvert), where the block is by construction not a bullet
    // item, so only the set half runs from any surface on the phone today.
    // The toggle half is kept because it is what makes this entry the
    // desktop's toggleMarker rather than a one-way alias of it — and a
    // caller with the caret in a bullet item would be wrong to get a
    // one-way trip from a command called `list`.
    list: (ed) =>
      ed
        .chain()
        .setMarker(MARK_ACTIVE.list(ed) ? "plain" : "bullet")
        .run(),
    undo: (ed) => ed.chain().undo().run(),
    // Tab and Shift-Tab's commands (unified-list.js), for a list item.
    indent: (ed) => ed.chain().sinkListItemOnce().run(),
    outdent: (ed) => ed.chain().liftListItemOnce().run(),
    // No `keyboard-down` entry: toolbar-model.js's BLOCK_STRIP took the
    // control off the strip and records why, and the open iOS question. If
    // it returns, its command is `(ed) => ed.commands.blur()` — the one
    // press that moves focus on purpose, against ToolbarButton's
    // preventDefault, which stops every other tap moving it.
    copy: copySelection,
    // The two that ignore their `ed` because they read it back off the
    // module scope anyway — `pin` needs the CORE, not the editor, and
    // taking the argument would suggest the editor were enough. Both
    // land in the same place; the scope is the only difference between
    // "the block I am in" and "the words I dragged over".
    pin: () => pin("block"),
    "pin-selection": () => pin("selection"),
    // The only entry that opens chrome rather than acting on the doc, and
    // the only one that ignores its `ed`. `type` and the sheet's `turn
    // into` row carry one label (toolbar-model.js records why) so they run
    // one function — the same openConvertSheet, against the same block the
    // gutter handle would have handed over.
    type: () => openConvertSheet(snapshot?.activeBlock),
    // The other sheet-opener, and the only strip button that acts on the
    // document WITHOUT knowing which block the caret is in — an insert
    // lands relative to the selection, so it needs no frozen block.
    insert: openInsertSheet,
    // The find strip's three buttons. Matching is entirely the extension's
    // (find-replace.js) — these dispatch its commands and compute nothing,
    // because a second implementation of "where is the next match" would
    // be a second answer to disagree with the highlights the plugin is
    // already drawing.
    //
    // Neither arrow guards on the match count, unlike FindBar.svelte:79-86
    // which returns early when total is 0. Two reasons it is not needed
    // here: the commands themselves decline on an empty match list
    // (find-replace.js:150, :164 both return false), and findStripModel
    // renders both buttons disabled in exactly that state, which
    // ToolbarButton's own contract stops from firing. A third check
    // reading a THIRD copy of the count — this file's `findState`, which
    // arrives on an event that can lag the editor by a tick — would be
    // the only one of the three that could be stale.
    prev: (ed) => ed.commands.prevFindMatch(),
    next: (ed) => ed.commands.nextFindMatch(),
    // The strip's way out. `field` is the one id here with no entry: it is
    // not pressed, it is typed into, and runFindQuery below is its command.
    close: closeFind,
  };

  // Task 1 disabled `pin-selection` on an empty selection and left `copy`
  // alone, and its review accepted the split while rejecting the reason
  // given for it: both ids sit on the same strip and both render from
  // whatever snapshot last arrived, so "a stale snapshot" argues for
  // neither over the other. The asymmetry that does hold is that an empty
  // pin writes a permanent artifact and an empty copy does not.
  //
  // That reasoning is only true once this guard exists, which is why it is
  // here rather than in a comment saying copy is harmless. The obvious
  // implementation — write textBetween(from, to) whatever it is — hands
  // the platform an empty string on an empty selection, and writeText("")
  // does not decline: it CLEARS the clipboard. Silently destroying
  // something the user put there is a smaller wrong than an empty pin,
  // but it is not the no-op the split was justified by.
  //
  // Guarded on the extracted text rather than on selection.empty because
  // the text is what gets written: a range that spans only an atom — an
  // image, a chart, a day marker — is a non-empty selection that yields no
  // text, and it would clear the clipboard through the other door.
  async function copySelection(ed) {
    const { from, to } = ed.state.selection;
    await writeClipboard(ed.state.doc.textBetween(from, to, "\n"));
  }

  // The write itself, shared with the block sheet's `copy` row. Extracted
  // rather than duplicated because the guard above IS the behaviour: a
  // second copy path with its own `if (!text)` is a second chance to omit
  // it, and the omission clears the clipboard silently.
  async function writeClipboard(text) {
    if (!text) return false;
    try {
      await navigator.clipboard?.writeText(text);
      return true;
    } catch (err) {
      // A denied or absent clipboard is the platform's answer, not a
      // crash: the writer keeps their selection and their page. The
      // answer is returned so a caller that confirms the copy (setup's
      // `phrase copied` toast) confirms only one that happened.
      console.error("shell: could not copy", err);
      return false;
    }
  }

  // ── pinning ─────────────────────────────────────────────────────────
  //
  // `pin` and `pin-selection` rendered dead from P2c to here, and the
  // comment at the top of this file said why: confirmPin wants a category
  // and a title, and EditorCore leaves both to its host on purpose
  // (:666). pin-intent.js is the host's answer; this section is the two
  // reads it needs and the one call it makes.
  //
  // WHAT THE SHELL STORES AS A PIN'S CONTENT is the node's JSON, on every
  // path and for every category. The desktop has two answers and they
  // disagree: `quickPinFromCursor` serialises the node, and
  // `handlePinBlock`'s note branch stores `hoveredBlock.textContent` — the
  // rendered DOM's text. block-pin-guard.js's header measured what that
  // second string actually contains, in a live editor: a code block's
  // reads "copyconst … = truecode", because the NodeView's copy button and
  // the block-type chip are real text nodes inside the block shell. It
  // also flattens marks and drops an inline attachment entirely. So the
  // shell takes the node, which is chrome-free by construction.
  //
  // AN ALREADY-PINNED BLOCK IS REFUSED, through the descriptor's `pinned`
  // field. pin-intent.js's header argues why the rule is the STAMP rather
  // than the desktop's content comparison — briefly: a node holds one
  // pinId, so re-pinning does not add a pin beside the old one, it takes
  // the old one's stamp and orphans it.
  //
  // What belongs here is what the refusal looks like without a toast, and
  // the answer is that it is not a silent tap: the same call answers the
  // presence derivation below, so the control LEAVES the strip on a block
  // that is already kept. Until the visual pass it went dead in place —
  // the phone's version of the desktop's dimmed pin glyph — and either way
  // it is what stops this being the defect TipTapEditor:1799 records ("tap
  // on toolbar button does nothing"), which was a guard that refused and
  // said nothing.
  //
  // THE SHEET REFUSES IN THE SAME SHAPE NOW, and it is the same call
  // saying it. A sheet is a MENU, and P2d's rule is that a menu implies
  // completeness, so a row that cannot act is not rendered at all
  // (rowsFor); the strip used to be the fixed row where a control that
  // cannot act dims instead, and since the visual pass it drops the
  // control too (`unavailableIds` says where that line is drawn and what
  // it costs). Both read `pinIntent` returning null — one question, one
  // idiom — so the two surfaces cannot disagree about whether this block
  // is already kept.

  /** Pin ids stamped on the open page whose pin no longer exists. A stamp
   *  outlives its pin (unpin leaves it, by design), and until this is
   *  known every stamp counts as live: refusing a pin for a moment is the
   *  safe mistake, orphaning a live pin by stamping over it is not.
   *  Checked once per stamp per session, when a page opens. */
  let deadPins = $state(new Set());
  const checkedStamps = new Set();
  $effect(() => {
    const json = page?.content_json;
    if (typeof json !== "string" || !json.includes("pinId")) return;
    let ids = [];
    try { ids = stampedPinIds(JSON.parse(json)).filter((id) => !checkedStamps.has(id)); } catch { return; }
    if (ids.length === 0) return;
    ids.forEach((id) => checkedStamps.add(id));
    Promise.all(ids.map((id) => getPinForReference(id).then((row) => (row ? null : id), () => null))).then((gone) => {
      const dead = gone.filter(Boolean);
      if (live && dead.length) deadPins = new Set([...deadPins, ...dead]);
    });
  });

  /** One top-level block, as pin-intent.js wants to be told about it.
   *  Every field is read off the ProseMirror node and none off the DOM. */
  function describeBlock(pos, node) {
    const attachment = soleAttachmentNode(node);
    return {
      pos,
      isBoard: isBoardType(node.type.name),
      isAttachment: !!attachment,
      // Its own stamp or one inside it, naming a pin that still exists:
      // unpinning leaves the stamp on the page by design, and a stamp
      // naming a deleted pin must not stop the block being kept again
      // (block-already-pinned.js). `deadPins` says which are gone.
      pinned: stampedPinIds(node).some((id) => !deadPins.has(id)),
      hasContent: mayPin(node),
      text: node.textContent || "",
      blockTitle: node.attrs?.blockTitle || "",
      filename: attachment?.attrs?.filename || "",
      // The same word the pin row's own chip will show (pin-display.js),
      // which is what makes it usable as a board's name: the title and the
      // chip agree instead of the title inventing a second vocabulary.
      kind: nodeKind(node),
    };
  }

  /** The top-level blocks a range overlaps, in document order.
   *
   *  The same overlap rule handlePinSelection uses (`start < to &&
   *  end > from`), written as a loop that BREAKS rather than as
   *  `doc.forEach`, which has no way out. This runs on every snapshot
   *  while a selection is up, and a continuous trail's doc is a 50k-word
   *  document with thousands of top-level children; walking all of them
   *  to find the two under the thumb is a cost the phone's typing budget
   *  should not carry. */
  function coveredBlocks(ed, from, to) {
    const doc = ed.state.doc;
    const out = [];
    let offset = 0;
    for (let i = 0; i < doc.childCount; i += 1) {
      const node = doc.child(i);
      const start = offset;
      offset += node.nodeSize;
      if (offset <= from) continue;
      if (start >= to) break;
      out.push(describeBlock(start, node));
    }
    return out;
  }

  /** One activeBlock as pin-intent.js's `blocks` — or [] when the position
   *  no longer resolves, which a snapshot one transaction stale produces as
   *  a miss rather than a throw (blockNodeAt).
   *
   *  Takes a block rather than reading the caret, because the sheet's `pin`
   *  row asks this about a block the caret may since have left. */
  function blocksAt(block) {
    const node = blockNodeAt(block);
    return node ? [describeBlock(block.pos, node)] : [];
  }

  /** The caret's own block, as one descriptor. Reads `snapshot.activeBlock`
   *  rather than re-resolving the selection because readActiveBlock already
   *  answers the awkward half: a NodeSelection on a top-level atom sits at
   *  depth 0, where `$from.node(1)` throws. */
  function caretBlocks() {
    return blocksAt(snapshot?.activeBlock);
  }

  /** Which blocks a press would pin, for `pin` and for `pin-selection`.
   *  One function so the PRESENCE derivation and the COMMAND ask the same
   *  question — the pattern `type` already follows with turnIntoRowsOf,
   *  and the reason the two cannot disagree about whether a control is
   *  there. */
  function pinBlocksFor(scope) {
    if (!editor || editor.isDestroyed) return [];
    if (scope === "block") return caretBlocks();
    const { from, to } = editor.state.selection;
    return coveredBlocks(editor, from, to);
  }

  /** What a pin from THIS block would be — the sheet's question, asked
   *  about the frozen `sheetBlock` rather than about the caret.
   *
   *  It is the same call `livePinIntent` makes for the strip, and that is
   *  the point: the row that is OFFERED and the pin that is WRITTEN both
   *  come from here, so a menu cannot show a `pin` row over a block
   *  pin-intent.js would refuse. Same one-gate-two-surfaces shape
   *  turnIntoRowsOf already has for `turn into`. */
  function pinIntentFor(block) {
    return pinIntent({ scope: "block", blocks: blocksAt(block) });
  }

  /** The write half of a pin: re-read the nodes, hand them to the core,
   *  then say where it landed.
   *
   *  Shared by the strip's `pin` and `pin-selection` and by the block
   *  sheet's `pin` row, because those three differ ONLY in which blocks
   *  they ask about. A second copy of this in the sheet's row would be a
   *  second place for the content, the stamp or the breadcrumb to go
   *  missing — and the breadcrumb is the half that would go quietly. */
  async function writePin(intent) {
    // Nothing worth pinning. Not silent-by-accident: every surface that
    // can reach this is rendered refusing in exactly this state — `pin`
    // is off the strip (see unavailableIds), `pin-selection` is dead on it
    // (see disabledIds) and the sheet's row is not there at all (see
    // rowsFor) — so a press that gets here means that surface's own
    // contract was broken, the same pairing `press` keeps for a missing
    // command.
    if (!intent || !core) return;

    // The blocks are re-read HERE rather than carried through the
    // module, because the module decides and does not serialise: it
    // takes plain descriptors, and a ProseMirror node passed through it
    // would make it testable only against an editor (toolbar-state.js's
    // header records that scar).
    const nodes = intent.positions
      .map((pos) => editor.state.doc.nodeAt(pos))
      .filter(Boolean)
      .map((node) => node.toJSON());
    if (nodes.length === 0) return;

    const created = await core.confirmPin({
      title: intent.title,
      category: intent.category,
      content: JSON.stringify({ type: "doc", content: nodes }),
      nodePositions: intent.positions,
      // No onStamped. The desktop flashes the source block there; the
      // shell's confirmation is the toast below, and a flash on a block
      // the thumb is covering says nothing.
    });
    // confirmPin catches its own failures and answers null (EditorCore:747).
    // The breadcrumb is a claim that a pin LANDED, so it waits on the row
    // rather than on the press: a toast reading "joins 11 pins" over a
    // write that threw would be the worst of both — no pin, and a
    // sentence saying otherwise.
    if (!created) return;
    await announcePin();
  }

  /** The pin the STRIP asks for. Async, and `press` does not await it —
   *  nothing on screen depends on the result yet, and confirmPin already
   *  catches its own failures and answers null (EditorCore:747). The
   *  try/catch here is for the reads AROUND that call: a stale position, a
   *  node that will not serialise. Neither may reach the top as an
   *  unhandled rejection, which fails a whole vitest run with every
   *  assertion green. */
  async function pin(scope) {
    try {
      const blocks = pinBlocksFor(scope);
      const intent = pinIntent({
        scope,
        blocks,
        selectionText:
          scope === "selection"
            ? editor.state.doc.textBetween(
                editor.state.selection.from,
                editor.state.selection.to,
                " ",
              )
            : "",
      });
      const refusal = intent ? null : pinRefusal({ scope, blocks });
      if (refusal) {
        showToast(refusal);
        return;
      }
      await writePin(intent);
    } catch (err) {
      console.error("shell: could not pin", err);
    }
  }

  /** The pin the SHEET asks for, and the difference is which block: the
   *  one the sheet was opened for, frozen, not whatever the caret is in by
   *  the time the row is tapped. See BLOCK_ROW_ACTIONS for why that is the
   *  right subject for a row in a menu about a specific block.
   *
   *  Its own try/catch rather than `pin`'s, because runBlockRow does not
   *  await a row either: an unhandled rejection here would fail the run
   *  from inside a tap that looked like it worked.
   *
   *  Focus is restored FIRST, ahead of the write. A sheet Row is a real
   *  button, so the tap dropped the keyboard (this file's header), and the
   *  writer should get it back on the tap rather than three round trips
   *  later — the pin is durable by then, but the caret never moved. */
  /** The block's own way back: the same ask and the same write as the pin's
   *  `more` sheet (unpinNow, `unpin`), about the pin this block carries. */
  async function unpinSheetBlock(block) {
    const node = blockNodeAt(block);
    const id = node && stampedPinIds(node).find((pinId) => !deadPins.has(pinId));
    if (!id) return;
    try {
      const lineages = pinsLineages.length ? pinsLineages : (await getLineages()) ?? [];
      const lists = await Promise.all([getPins(null), ...lineages.map((l) => getPins(l.id))]);
      const pin = mergePinRows(lists).find((row) => row.id === id);
      if (!pin || !live) return;
      openPinMore(pin);
      moreConfirming = true;
    } catch (err) {
      console.error("shell: could not read the block's pin", err);
    }
  }

  async function pinSheetBlock(block) {
    try {
      const intent = pinIntentFor(block);
      restoreFocus();
      await writePin(intent);
    } catch (err) {
      console.error("shell: could not pin", err);
    }
  }

  // ── the pin's breadcrumb ────────────────────────────────────────────
  //
  // Spec §3: pinning shows `joins 11 pins on the book trail` under the nav
  // bar. NOT the desktop's `pinned · <title>` (TipTapEditor:1848, :1993),
  // which is a receipt for the press; this says where the pin landed and
  // what was already there. pin-toast.js's header argues the split, owns
  // the copy, and owns both silences.
  //
  // THE COUNT COSTS A FETCH, and that is the question Step 2 of the plan
  // asks out loud. `getPins(lineageId)` returns the trail's whole pin list
  // to be measured for its length — a hundred rows carrying titles and
  // cached content, for one integer. It is acceptable here, and the
  // reasons are about WHEN rather than about how much:
  //
  //   - it runs once per PIN, not per keystroke. Nothing in the typing
  //     path touches it. The nearest thing this file does on every
  //     transaction is pinBlocksFor, and that one was written as a
  //     breaking loop precisely because it IS on that path.
  //   - it runs after `confirmPin`, which has already awaited a create,
  //     an update for boards, and a full flushSave. It is a fourth round
  //     trip behind three, and it blocks nothing on screen: the pin, the
  //     stamp and the save are all done and durable before it starts.
  //
  // What the alternative would be, since "acceptable" is only meaningful
  // against one. Three exist and each is worse:
  //
  //   - A COUNT COMMAND (`SELECT count(*)`) would be the right answer if
  //     this were hot. It is new Rust, a new command in the surface, and a
  //     new op-log call site to keep in step, for a saving no phone can
  //     feel once per pin. Worth doing the day a trail dashboard reads
  //     counts for many trails at once, which is the v2 surface this toast
  //     is a placeholder for — not for one number after one write.
  //   - CACHING the length and adding one per pin. This is the option that
  //     looks free and is the actual trap: pins are created, deleted,
  //     re-scoped and orphaned from the desktop tree and from sync, so a
  //     remembered number is wrong as soon as anything else touches the
  //     trail — and it would be wrong SILENTLY, in a sentence about the
  //     writer's own trail. Measured, or not said.
  //   - SAYING SOMETHING THAT COSTS NOTHING ("pinned"). That is the
  //     desktop's toast, and Step 1 of this task exists to stop it being
  //     built here by proximity. The pointer at the trail is the whole
  //     content of the spec's line.
  //
  // AND A FOURTH THAT LOOKS FREE AND IS NOT, found by this fetch turning
  // out to be the SECOND getPins on the page. EditorCore already loads the
  // trail's pins into `existingPinContents` and exports
  // `hasPinnedContent` (EditorCore:101-110) — a list of the same rows, in
  // hand, whose size is the number this toast wants. It cannot be used,
  // and the reason is in its guard: that load runs from an effect keyed on
  // `lineageId !== prevLineageId` (:452), so it fires ONCE, when the
  // lineage first arrives, and never again. It does not know about the pin
  // just written, nor about any pin made since the page opened. Reading
  // its size would produce a count that is correct on the first pin of a
  // session and one short from the second onward — stale in the exact
  // shape the "measured, or not said" rule above refuses, and green in
  // every test that only pins once.
  //
  // WHY THE FETCH DOES NOT ALSO BUY THE RE-PIN FIX. pin-intent.js's header
  // closes by noting the limit of a stamp-based guard — pinId survives an
  // edit, so a rewritten paragraph cannot be re-pinned until it is
  // unpinned — and says the trade would be worth revisiting "where that
  // fetch is made anyway", meaning here. It is not, on two counts:
  //
  //   - TIMING. This fetch happens AFTER the write. The guard runs BEFORE
  //     one, inside `livePinIntent`, which is a `$derived` recomputed on
  //     every snapshot — i.e. on every keystroke. A guard that needs the
  //     trail's pins would need them synchronously there, which means a
  //     cached list, which is the trap two bullets up wearing a different
  //     hat: a stale cache would let a re-pin through and orphan the
  //     earlier pin, which is the exact defect the stamp rule exists to
  //     prevent.
  //   - AND THE FIX WOULD NOT BE A FIX. Suppose the pins were in hand and
  //     the guard compared content rather than the stamp. The node still
  //     holds ONE pinId. Allowing the second pin because the text changed
  //     creates a second row and moves the stamp to it, and
  //     refresh_pin_caches then orphans the first — dimmed, "like
  //     deleted" (EditorCore:741). The writer would have edited a
  //     paragraph, pinned it again, and silently lost the earlier pin.
  //     The stamp rule is not a conservative approximation of a
  //     content rule; it is the correct rule for a one-slot stamp.
  //
  //   So the trade is DECLINED on the merits, not on cost, and the real
  //   answer to an edited pinned block is a different feature: update the
  //   pin the block already owns (`updatePinContent` on its pinId) rather
  //   than write a second one. That is a pin-row command, it belongs
  //   beside unpin, and it is not this task's.

  /** The toast's current message. "" is the resting state and the value
   *  Toast renders no band for. */
  let toastMessage = $state("");

  /** Toast has no lifetime of its own — its first call is what made that
   *  plain — so the timer lives here. Held so a second pin inside four
   *  seconds replaces the message rather than being cleared out from
   *  under by the first pin's timer. */
  let toastTimer = null;

  function showToast(message) {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    toastMessage = message;
    if (!message) return;
    toastTimer = setTimeout(() => {
      toastMessage = "";
      toastTimer = null;
    }, PIN_TOAST_MS);
  }

  // A timer that outlives the component writes into torn-down state, which
  // under vitest lands as an unhandled error attributed to whichever test
  // was running four seconds later.
  $effect(() => () => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
  });

  /** Measure the trail and say what the pin joined.
   *
   *  `page.lineage_id` and `loadedTrailName` rather than the header's
   *  `trailName`: the header's label is overridable by a harness prop (see
   *  this file's own header), and a toast naming a trail the pin's row does
   *  not carry would be a false breadcrumb. These two are the row's own
   *  trail and the name the load read for it.
   *
   *  An untrailed page returns before the fetch. The empty-string branch in
   *  pin-toast.js would answer for it anyway, and this early return is not
   *  redundancy for its own sake: it is what keeps `get_pins(null)` — a
   *  scan of every untrailed pin in the database, app-wide — off a path
   *  the writer takes on every page they have not trailed. The module's
   *  header argues why that number must not be rendered even if fetched. */
  // ── how many pins the header's `pins` opens onto ─────────────────────
  //
  // The third device pass: "we don't know how much pin associated to
  // current trail". The count is MEASURED at the moments it can change
  // from this device — the page arriving, a pin written, a pin unpinned,
  // the pins list read — and never kept as a running tally (the toast's
  // argument above: pins are also created and removed from the desktop and
  // by sync, and a remembered number goes wrong silently). Null between a
  // page switch and its measurement, which pin-count.js renders as the
  // plain word.
  //
  // A TRAIL'S COUNT ONLY. An untrailed page's list is `getPins(null)`,
  // every pin ever made on any untrailed page, app-wide — a heap, not a
  // trail (the toast declines to count it for that reason, and its test
  // holds `getPins` uncalled there). A number over it would state the pile
  // the product exists to refuse; the user's words were "current trail".
  let trailPinCount = $state(null);

  async function measurePinCount() {
    const pageId = page?.id ?? null;
    const lineageId = page?.lineage_id || null;
    if (!lineageId) {
      trailPinCount = null;
      return;
    }
    try {
      const pins = await getPins(lineageId);
      // Only if the page is still the one measured for: a switch while
      // this was in flight must not put the last page's count on the new
      // page's header.
      if (!live || (page?.id ?? null) !== pageId) return;
      trailPinCount = Array.isArray(pins) ? pins.length : null;
    } catch (err) {
      console.error("shell: could not count the page's pins", err);
    }
  }

  async function announcePin() {
    const lineageId = page?.lineage_id || null;
    // No trail, no count and no toast — see measurePinCount.
    if (!lineageId) return;
    try {
      const pins = await getPins(lineageId);
      if (live && (page?.lineage_id || null) === lineageId) {
        trailPinCount = Array.isArray(pins) ? pins.length : trailPinCount;
      }
      showToast(
        pinToastMessage({
          trailName: loadedTrailName,
          pinCount: Array.isArray(pins) ? pins.length : 0,
        }),
      );
    } catch (err) {
      // A failed count costs the breadcrumb, not the pin — which is
      // already written, stamped and flushed by the time this runs.
      console.error("shell: could not count the trail's pins", err);
    }
  }

  // ── the block sheets ────────────────────────────────────────────────
  //
  // Which sheet is up, by tag, or null. ONE variable rather than a boolean
  // per sheet, because "one sheet at a time" (§1) is then a property of the
  // state shape instead of a rule two booleans have to be kept obeying.
  // The tags are Sheet's own `tag` prop: the identity sheet-stack.js
  // compares and the label the navstack entry carries.
  let openSheet = $state(null);

  // ── midnight ────────────────────────────────────────────────────────
  //
  // §2 lists midnight with onboarding and lock; §1 lists it among the
  // sheets, "non-dismissable variant". It is built as the sheet, and
  // midnight.js argues why at length — two answers of equal weight do not
  // fit a slot that holds "the primary action", and a full-screen gate
  // would cover the very page "stay on yesterday" refers to. Chromeless it
  // still is: row 1 of toolbarFor takes the slot away from an open sheet.
  //
  // WHAT IT IS FOR is not the greeting. page-writable.js turns the page
  // read-only the moment the date on it stops being today, and nothing on
  // screen changes when that happens — so a phone left open across the
  // boundary is a writing surface that has silently stopped accepting
  // keystrokes. Until now `+` and the date sheet's `today` row were the
  // two ways out, and both need the writer to already know they are the
  // answer.
  //
  // POLLED, not scheduled for the boundary. A timeout computed to the next
  // midnight is wrong after every sleep, every suspend and every timezone
  // change, and it is wrong silently — the wake-up simply never arrives.
  // A minute of lag on a day boundary is invisible; a missed boundary is
  // the bug this exists to fix.
  const MIDNIGHT_POLL_MS = 60_000;
  //
  // ONE CLOCK. The backend dates every page with its own clock, and on
  // Android the WebView's can disagree: an A06 in Africa/Casablanca had
  // stale tz data, so its WebView said 23:20 on the 8th while Rust said
  // 00:20 on the 9th. For that hour the page Rust had just made as today's
  // was yesterday's here, read-only, and the writer could not type at all.
  // So "today" is asked of the backend, and the WebView's clock is only the
  // answer when the backend cannot give one (a test, the demo, a failure).
  let clockDay = $state(getLocalDateStr());
  async function readClockDay() {
    let day = getLocalDateStr();
    try {
      const backend = await getLocalToday();
      if (typeof backend === "string" && /^\d{4}-\d{2}-\d{2}$/.test(backend)) day = backend;
    } catch {
      // The WebView's day, as before. Better a clock that may be an hour out
      // than none.
    }
    if (live) clockDay = day;
    return day;
  }
  $effect(() => {
    const id = setInterval(readClockDay, MIDNIGHT_POLL_MS);
    return () => clearInterval(id);
  });

  // The day the writer last answered. Either row stamps it, which is what
  // stops the sheet coming straight back after "stay on yesterday" — that
  // answer deliberately does not change the condition that opened it.
  let midnightAnswered = $state(null);

  const midnightOpen = $derived(
    midnightDue({
      pageDate: page?.date ?? null,
      openedOn: pageOpenedOn,
      today: clockDay,
      answered: midnightAnswered,
      space: active,
    }),
  );

  // IT RE-ASSERTS. The guard reads `openSheet`, so a write from anywhere
  // else — `dismissedSheet`, when back closes the sheet — re-runs this
  // effect, which finds the condition still true and puts the sheet back.
  //
  // A SECOND MECHANISM SITS UNDER THAT ONE, and it is recorded rather than
  // relied on: Svelte re-runs an effect that writes state, so deleting the
  // guard line leaves the behaviour green (the write converges, because
  // setting `openSheet` to the value it already holds invalidates
  // nothing). Deleting the guard is therefore NOT the probe that proves
  // this — untracking the write is, and ShellApp.test.js's "comes back if
  // it is dismissed instead of answered" says so at its own site. The
  // guard stays because it is the readable half and the terminating half.
  //
  // `dismissable={false}` on the Sheet refuses the two things a FINGER can
  // do — the drag (Sheet's `end`) and, since the scrim landed, a tap on the
  // page beneath (Sheet's `scrimClick`). Android system back, Esc and
  // navBack() all reach it through closedByNav, which calls dismissSelf
  // unconditionally. Teaching Sheet to
  // refuse those is not the fix available here: navstack pops the entry
  // BEFORE calling onClose (navstack.js:106-110), so a sheet that declined
  // to close would stay up with no entry left in the stack and the NEXT
  // back press would eat something else. So the answer is at this end —
  // back closes it, the condition is still true, and it comes back. That is
  // "it must be answered" (Sheet.test.js:170) enforced by the host rather
  // than mimed by a prop.
  //
  // It converges: the write makes this effect's own guard true on the next
  // run, and `midnightAnswered` is what ends it for good.
  $effect(() => {
    if (openSheet === "midnight") return;
    if (!midnightOpen) return;
    openSheet = "midnight";
  });

  /** Either answer, and both stamp the day FIRST.
   *
   *  `start fresh` re-stamps `pageOpenedOn` through adoptPage and would
   *  settle the condition on its own — but the await between here and there
   *  is a window with the sheet closed and the condition still true, which
   *  is long enough for the effect above to reopen it over the load. `stay
   *  on yesterday` has nothing else that could settle it at all. */
  async function answerMidnight(id) {
    midnightAnswered = clockDay;
    openSheet = null;
    if (id !== "fresh") return;
    try {
      // `getOrCreateToday` is the one call in the api that makes a page,
      // which is exactly what a phone left open across midnight needs —
      // the same act `+` performs from a past day and the reading view's
      // `today` row performs from the other end of the app.
      const result = await getOrCreateToday();
      await readClockDay(); // judge it by the clock that dated it (clockDay)
      await adoptPage(rememberToday(result?.page ?? null));
    } catch (err) {
      console.error("shell: could not start the new day's page", err);
    }
  }

  // The block the open sheet's rows were built for, frozen when it opened.
  // Not read live off the snapshot: the rows offered and the block acted on
  // have to be the same block, and a transaction arriving while the sheet
  // is up (a save, a collaborator, an appended trailing paragraph) would
  // otherwise leave a `delete` row pointing somewhere its label never
  // described.
  let sheetBlock = $state(null);

  // A page the writer may not type into. This used to be the literal
  // `page?.is_open === false`, written here and again in PageScreen, with
  // a comment promising that the day it grew the desktop's second arm it
  // would become one derivation both files import. That day is the date
  // sheet: it is the first thing in the shell that can hand this file a
  // page from another day, and a page from another day is read-only
  // (CLAUDE.md). page-writable.js is that derivation, and it carries what
  // the missing arm was hiding — including that every fixture in this
  // file's own suite was a page from 1999.
  const readonly = $derived(pageReadonly({ page, trailMode: loadedTrailMode, todayDateStr: clockDay, todayPageId }));

  /** The ProseMirror node an activeBlock points at, or null. `pos` is a
   *  document position (`$from.before(1)`), so nodeAt is the lookup — and
   *  it can miss on a snapshot one transaction stale, which is a null
   *  rather than a throw. */
  function blockNodeAt(block) {
    if (!block || !editor || editor.isDestroyed) return null;
    try {
      return editor.state.doc.nodeAt(block.pos);
    } catch {
      return null;
    }
  }

  /** The node's outer DOM element, for the one shared helper that wants an
   *  element rather than a position (deleteBlockAt). The round trip
   *  pos → DOM → pos is deliberate: block-delete.js owns the rule that a
   *  doc must keep at least one block, and re-implementing that rule here
   *  to save a lookup would be a second copy of a decision the desktop
   *  already tests. */
  function blockDomAt(block) {
    if (!block || !editor || editor.isDestroyed) return null;
    let dom;
    try {
      dom = editor.view.nodeDOM(block.pos);
    } catch {
      return null;
    }
    return dom instanceof Element ? dom : null;
  }

  /** Whether a block holds anything a pin could keep. The shared
   *  `mayPinBlock` (block-pin-guard.js) takes TEXT, and a board's name is
   *  not text, so this goes through block-pinnable.js, which is that rule
   *  plus the named-but-empty board.
   *
   *  canPin gates three of the sheet's rows, not one: blockActionsFor
   *  offers `pin` and `copy` on it and `delete` on `canPin || isBoard`. So
   *  it is what a block has to have before any of the three appear, and
   *  `pin` needs one thing more — see rowsFor. */
  function mayPin(node) {
    if (!node) return false;
    // The shared rule plus one case it misses — a board named and not yet
    // filled, whose title is in attrs where the text walk never looks.
    // block-pinnable.js carries the argument; the third device pass found
    // it as a titled q&a whose sheet offered no pin.
    return blockPinnable({
      text: node.textContent,
      isBoard: isBoardType(node.type.name),
      blockTitle: node.attrs?.blockTitle || "",
      // Both cases block-pin-guard.js exempts: content that does not live
      // in the node's text. A chart is `atom: true` with its data in attrs;
      // an attachment is an inline atom the text walk skips entirely.
      hasNonTextContent: isAttachmentBlockNode(node) || node.type.name === "chart",
    });
  }

  /** Which BOARD shapes this block can become, from block-convert.js.
   *  Empty for a paragraph, always — CONVERTIBLE_TYPES is board types
   *  only — which is why this is no longer the gate on its own. */
  function convertTargetsOf(block) {
    if (readonly) return [];
    const node = blockNodeAt(block);
    return node ? convertTargetsFor(node) : [];
  }

  /** The rows `turn into` offers this block. Empty means "nothing to turn
   *  into", which is both the sheet's gate for the `turn into` row and the
   *  strip's gate for the `type` button — one call, so the two cannot
   *  disagree about whether this block has somewhere to go. A board's rows
   *  are its convert targets; a paragraph's are turn-into-model.js's two,
   *  and that module says what a paragraph can honestly become and why
   *  `readonly` has to reach it. */
  function turnIntoRowsOf(block) {
    return turnIntoRows({
      activeBlock: block,
      convertTargets: convertTargetsOf(block),
      readonly,
    });
  }

  // What each sheet row DOES, and — as with COMMANDS above — the table is
  // also the list of rows that exist. blockSheetRows offers eight ids; the
  // seven here are the seven the shell can honour, and the rows filter
  // through this object rather than through a written-down list of
  // exclusions, so a row appears the day its action does.
  //
  // WHICH BLOCK A ROW ACTS ON is the sheet's `sheetBlock`, frozen when it
  // opened, and never the live caret — including for `pin`, which is the
  // one row whose twin on the strip reads the live snapshot instead. The
  // two are right for different questions rather than one being sloppy: the
  // strip's button is a verb with no object, so its object is wherever the
  // writer is now; a sheet was opened ON a block, its rows were computed
  // FOR that block, and the writer read them as a menu about it. A row that
  // re-read the caret would be a menu that promised one block and kept
  // another — and it is reachable, because nothing makes the background
  // inert (Sheet.svelte's header): a transaction arriving while the sheet
  // is up, or a tap through it, can move the caret before the row is
  // pressed. The frozen block is also what makes `delete` and `move up`
  // safe, and `pin` writes a permanent artifact, so it is the row with the
  // least business guessing.
  //
  // Every row blockSheetRows can offer is now here; nothing is absent. The
  // three that used to be, and what each one cost:
  //
  //   title         was absent because `hasTitle` meant two opposite things.
  //                 block-actions.js documented it as "this block instance
  //                 actually renders a .board-title-slot element to focus" —
  //                 CAN be titled — and readActiveBlock answered
  //                 `!!(node.attrs.blockTitle || "").trim()` — IS titled.
  //                 Same name, same type, so nothing type-checked it and the
  //                 shell would have offered the row only on boards that
  //                 already had a title and never on the untitled board it
  //                 exists to title. The gate is `hasTitleSlot` now and the
  //                 snapshot's field is `isTitled`; the shared module throws
  //                 on the retired name rather than defaulting it closed.
  //
  //                 The second half was reaching the <input>. A board's
  //                 title is chrome the editor draws at no document
  //                 position, so there is no transaction that focuses it —
  //                 which is also why P2e's answer does not apply: a
  //                 decoration can put a class on a node, it cannot put a
  //                 caret in an element the doc does not contain. What P2e
  //                 actually proved is that WRITING to a node the editor
  //                 owns does not survive its redraw; focus is not a
  //                 mutation, the DOMObserver does not watch it, and the
  //                 slot's own `editing` flag is what keeps the next
  //                 transaction from rewriting the value underneath it. So
  //                 the reach is a seam on the core — `hasBlockTitleSlot`
  //                 for the gate, `focusBlockTitle` for the row — and not a
  //                 querySelector from the shell into ProseMirror's DOM.
  //   convert       is here, under its §3 name. It is one of two rows that
  //                 do not act on the doc: it replaces this sheet with the
  //                 target chooser.
  //   insert-below  is here from Task 4, and it is the other. It was left
  //                 out for one task because the shell had nowhere to send
  //                 it; the insert sheet is that somewhere, and it is the
  //                 desktop's behaviour rather than an approximation of it.
  //                 The id reads like "put a block AFTER this one", which
  //                 an insert sheet gated on the caret would not deliver —
  //                 but blockActionsFor only offers this row when the block
  //                 isEmpty (block-actions.js:84), and the desktop's own
  //                 handler types "/" at the START of that empty block
  //                 (insertSlashAtBlock, TipTapEditor:602). So both hosts
  //                 mean "put a block HERE, in the blank line you are
  //                 standing on", and needsFreshLine agrees: on an empty
  //                 line no block command gets a fresh one.
  //
  //                 It also closes the gap Task 3 recorded in the plan's
  //                 "Owed" list — a read-only page's empty paragraph left
  //                 the handle dead because rowsFor returned nothing. On an
  //                 OPEN page that block now has a row, so the tap produces
  //                 a sheet. The read-only half of that finding stands:
  //                 READONLY_ROWS is an allowlist and this row writes, so a
  //                 closed page still offers an empty paragraph nothing.
  const BLOCK_ROW_ACTIONS = {
    // The row P2f Task 1 made possible and this task wired: same intent,
    // same write, same breadcrumb as the strip's `pin` — about the block
    // the sheet names rather than about the caret.
    pin: pinSheetBlock,
    unpin: unpinSheetBlock,
    copy: copyBlock,
    // The only row that deliberately does NOT restoreFocus() afterwards.
    // Every other one hands the writer back to the doc; this one hands
    // them somewhere else on purpose, and a focus() behind it would take
    // the title slot away in the same turn it was given.
    title: titleBlock,
    convert: openConvertSheet,
    // Ignores its block, and that is the difference between this row and
    // every other one here: the insert sheet acts on the CARET, and the
    // handle only ever appears on the block the caret is in.
    "insert-below": () => openInsertSheet(),
    delete: deleteBlock,
    "move-up": (block) => moveBlock(block, "up"),
    "move-down": (block) => moveBlock(block, "down"),
  };

  // Rows a CLOSED page may still offer — the readonly decision, made here
  // rather than inherited, and written as an allowlist so it fails closed:
  // a row added to the table above and forgotten here is withheld from a
  // read-only page rather than let through onto one.
  //
  // The line is "does it write to the document", not the desktop's line.
  // TipTapEditor filters copy out too (its openBlockActionSheet), and says
  // why: it mirrors the old hover pill's per-button gates. That is a
  // faithful account of where its rule came from, not an argument for it —
  // copying text off a page you cannot edit is exactly what a phone is for,
  // and the editor beneath is already refusing every edit on its own. So
  // copy stays and everything that dispatches a transaction goes.
  //
  // `pin` is the exception the previous task predicted, and it is here on
  // the rule it appears to break. A past page's block is still pinnable —
  // the desktop's rule, and the shell already ships it: `pin` on the strip
  // is deliberately not gated on readonly, and "pins from a closed page,
  // and pays the stamp into it" drives exactly that. Withholding the ROW
  // would leave one block offering a live pin button and no pin row on the
  // same closed page: one question, two answers, which is the drift this
  // workstream keeps catching. What it costs is stated where that test
  // states it — pinning stamps a pinId into a document the writer cannot
  // edit and flushes it. The prose is untouched; one node attribute is not,
  // and the pin would be orphaned on the next launch without it.
  //
  // `title` is NOT here. The slot is a live `<input>` this NodeView draws
  // as chrome OUTSIDE the contenteditable, so TipTap's `editable: false`
  // does not reach it on its own: the field still takes focus and still
  // accepts keystrokes on a page the app says is closed. A row that hands
  // the writer a working text field there is a write, offered as a reveal,
  // and the allowlist's line is "does it write to the document".
  //
  // This used to be the row where this branch and the desktop's parted
  // company — TipTapEditor kept its title reveal on a read-only page
  // because the old hover pill never gated it. `main`'s `3dfcfbf4` closed
  // that gap in BOTH halves and the two hosts now agree: `title-slot.js`
  // gained `mayWriteTitle` (`view.editable !== false`, checked at
  // `dispatchTitle` and `commitTitleAndEnterBoard`), which is the
  // correctness fix and reaches every route including this one, and
  // TipTapEditor's `openBlockActionSheet` and `revealBlockHandlesForNode`
  // gained `!readonly` on their own `hasTitleSlot`, which is the
  // affordance half the desktop was missing.
  //
  // So this entry is no longer a divergence — it is this host's affordance
  // half, reached through the allowlist rather than through a `!readonly`
  // on the gate, because `hasTitleSlot` here is `core.hasBlockTitleSlot`,
  // a pure DOM question the core answers without knowing about readonly.
  // Withholding it in `rowsFor`'s filter is the same answer at a different
  // seam, and it fails closed the way the allowlist is meant to.
  const READONLY_ROWS = new Set(["copy", "pin", "unpin"]);

  /** The rows for a block, or [] for none. A plain function rather than
   *  only a $derived because the open handlers have to know whether there
   *  is anything to show BEFORE they show it: an empty sheet is the
   *  reserved-but-empty band one surface over. */
  function rowsFor(block) {
    if (!block) return [];
    const node = blockNodeAt(block);
    // `pin` is offered by blockActionsFor on `canPin` alone, which is
    // whether the block has anything worth keeping — one of the two
    // questions pin-intent.js answers. The other is whether it is already
    // kept, and on a block that is, the row goes ABSENT. The strip's
    // button does the same since the visual pass (it used to dim in
    // place; `unavailableIds` says why absence is the honest rendering),
    // so the two surfaces now agree in shape as well as in answer. Asked
    // through the same pinIntent the action itself will use, so the sheet
    // can never offer a pin the write would refuse.
    const keepable = !!pinIntentFor(block);
    return blockSheetRows({
      activeBlock: block,
      canPin: mayPin(node),
      canUnpin: !!node && stampedPinIds(node).some((id) => !deadPins.has(id)),
      // NOT `block.isTitled`, which is the neighbouring question and the
      // whole reason this row was absent for three phases. The gate is
      // whether a slot EXISTS to focus, a DOM fact the snapshot is pure of,
      // so the core is asked — and asked HERE, once, as the sheet opens, so
      // the answer is frozen with the block the sheet was opened on like
      // every other row's.
      hasTitleSlot: core?.hasBlockTitleSlot(block.pos) ?? false,
      // blockSheetRows reads only the length, and the length it must read
      // is the turn-into sheet's — a paragraph's two rows included — or
      // the handle's `turn into` row and the strip's button would
      // disagree about the same block.
      convertTargets: turnIntoRowsOf(block).map((row) => row.id),
    }).filter(
      (row) =>
        BLOCK_ROW_ACTIONS[row.id] &&
        (!readonly || READONLY_ROWS.has(row.id)) &&
        (row.id !== "pin" || keepable),
    );
  }

  const sheetRows = $derived(rowsFor(sheetBlock));

  const convertRows = $derived(turnIntoRowsOf(sheetBlock));

  // Live, for the strip's `type` button — read off the snapshot rather than
  // off the frozen sheetBlock, and reading `snapshot` is what subscribes it
  // to the editor (see activeIds below for the same seam).
  const liveTurnIntoRows = $derived(snapshot ? turnIntoRowsOf(snapshot.activeBlock) : []);

  /** Would a press produce a pin, right now. The COMMAND's own decision,
   *  asked ahead of the press, so the absent (or, for the selection, dead)
   *  button and the refusing command cannot disagree about whether there
   *  is anything here — the same one-gate-two-surfaces shape
   *  turnIntoRowsOf already has.
   *
   *  Two derivations rather than one, because the two controls never
   *  share a strip: `pin` is on the block strip and `pin-selection` on
   *  the selection strip (toolbar-model.js), so exactly one of these is
   *  about a button that is on screen. The selection one is guarded on
   *  `selectionEmpty === false` so the doc walk in coveredBlocks does not
   *  run on every keystroke of ordinary typing, when there is no range
   *  and no strip to gate. */
  const livePinIntent = $derived(
    snapshot ? pinIntent({ scope: "block", blocks: pinBlocksFor("block") }) : null,
  );

  const liveSelectionPinIntent = $derived(
    snapshot?.selectionEmpty === false
      ? pinIntent({ scope: "selection", blocks: pinBlocksFor("selection") })
      : null,
  );

  /** A selection that cannot be pinned but should say why: the button
   *  stays live, and pressing it explains (pin-intent.js `PART_PINNED`). */
  const liveSelectionPinRefusal = $derived(
    snapshot?.selectionEmpty === false && !liveSelectionPinIntent
      ? pinRefusal({ scope: "selection", blocks: pinBlocksFor("selection") })
      : null,
  );

  function openBlockSheet(block) {
    if (rowsFor(block).length === 0) return;
    sheetBlock = block;
    openSheet = "block-actions";
  }

  function openConvertSheet(block) {
    if (turnIntoRowsOf(block).length === 0) return;
    sheetBlock = block;
    openSheet = "block-convert";
  }

  // Sheet also dismisses itself — a drag, a back press, or another sheet
  // taking its place — and tells the host through onDismiss.
  //
  // The tag guard is LOAD-BEARING, and it took a probe to establish which
  // way round that went. Removing it leaves this file at 35 passed, which
  // read as "nothing needs it" and was really "nothing covers it" — the
  // blindness, not the claim, being true. The path it protects is the
  // gutter handle tapped while a sheet is already open: the handle lives
  // in the canvas, not the bottom slot, and nothing makes the background
  // inert (Sheet.svelte's header says as much), so at half detent a handle
  // above the sheet is visible and tappable.
  //
  // What makes that path different from every other one here is the
  // absence of an intermediate state. runBlockRow sets `openSheet = null`
  // before reopening, so the effects see one settled turn and the closing
  // instance releases its claim before the opening one asks — nextSheet
  // sees `current: null` and reports no dismissal. openBlockSheet assigns
  // openSheet DIRECTLY, so both Sheets change in one turn and Svelte runs
  // their claim effects in declaration order: block-actions is declared
  // first (below), so the OPENING instance asks while block-convert still
  // holds the module claim. nextSheet returns `dismissed: "block-convert"`
  // and that onDismiss lands AFTER the new sheet has already claimed the
  // slot. Unguarded, it nulls the sheet that just opened and the tap
  // silently closes everything.
  //
  // So P1d's replace-if-open branch has a caller, and it is this one.
  // Asserted in "swaps sheets when the handle is tapped while a sheet is
  // already open" — which is the only test that reddens when the guard
  // goes, in either direction.
  //
  // P2f Task 3 put three more sheets on the other side of that handoff,
  // and the DIRECTION turned out to decide it in a way the obvious reading
  // misses. The header's date, dots and trail controls live in the NAV
  // band, which a half-detent sheet does not cover, so the block sheets
  // and the header's three can replace each other in either order — but
  // only ONE order reaches this guard, because Svelte runs the claim
  // effects in DECLARATION order and the header's three are declared BELOW
  // the block sheets.
  //
  // The two builders (P2f-2 Tasks 4 and 5) are a third case and reach this
  // guard from neither direction: they are opened from a ROW of the insert
  // sheet, which is declared above them, so the insert sheet has released
  // the claim by the time either asks. Counted here rather than numbered —
  // this sentence used to say "all six sheets" and the shell has gained
  // three since.
  //
  // Opening a header sheet over a block sheet therefore releases the block
  // sheet FIRST, nextSheet sees `current: null`, and no dismissal is
  // reported at all. Written that way round, a test for this guard stays
  // GREEN with the guard torn out — which is what the probe found, and why
  // the test in the suite is the other way round: the gutter handle tapped
  // while the DATE sheet is up, where block-actions is declared first and
  // so asks for a claim the date sheet is still holding. "swaps sheets
  // when the gutter handle is tapped while a header sheet is open" is that
  // test, and it reddens with the guard gone.
  function dismissedSheet(tag) {
    if (openSheet === tag) openSheet = null;
  }

  function runBlockRow(id) {
    const run = BLOCK_ROW_ACTIONS[id];
    if (!run) return;
    const block = sheetBlock;
    // Every row leaves the actions sheet, including convert — which then
    // opens its own in the same synchronous turn, so the two Sheets see one
    // settled state rather than an intermediate one.
    openSheet = null;
    run(block);
  }

  // Focus, restored, and this is the one place in the shell that restores
  // it. The strip deliberately does NOT (see COMMANDS above): its buttons
  // are ToolbarButtons, whose preventDefault means the tap never moved
  // focus, so a focus() there would restore a focus nobody lost and scroll
  // for no reason. A sheet Row renders a real button element with no
  // preventDefault, so the tap genuinely blurs the editor and drops the
  // keyboard with it.
  // scrollIntoView is off because keeping the caret visible is
  // caret-visible.js's job, measured against the real frame.
  function restoreFocus() {
    if (!editor || editor.isDestroyed) return;
    editor.commands.focus(null, { scrollIntoView: false });
  }

  async function copyBlock(block) {
    const node = blockNodeAt(block);
    if (!node) return;
    await writeClipboard(node.textContent);
  }

  /** Put the writer in this board's title slot. The one row that does not
   *  hand focus back to the doc, and the one that is not a transaction: a
   *  board title is an `<input>` the NodeView draws at no document
   *  position, so there is nothing to dispatch and nothing a decoration
   *  could reach. `core.focusBlockTitle` is that reach, and the row was
   *  only offered because `core.hasBlockTitleSlot` already said there is a
   *  slot — so the false return is a block that vanished between the sheet
   *  opening and the tap, not a row that does nothing. */
  function titleBlock(block) {
    core?.focusBlockTitle(block.pos);
  }

  function deleteBlock(block) {
    const dom = blockDomAt(block);
    if (!dom) return;
    deleteBlockAt(editor, dom);
    restoreFocus();
  }

  // ONE transaction, and the selection is set inside it. moveBlockAtPos
  // leaves the selection alone on purpose — its header explains that a
  // board's title is an <input> outside the doc, so moving the caret would
  // pull focus out of what the user is typing in. That is right for the
  // keyboard path and wrong for this one: dispatched raw, a "move up" maps
  // the caret into the block that swapped the other way, so the gutter
  // handle — which follows the caret — lands on the wrong block and the
  // next move moves the wrong thing. Capturing the transaction instead of
  // dispatching a second one keeps it a single undo step.
  function moveBlock(block, direction) {
    if (!block || !editor || editor.isDestroyed) return;
    let tr = null;
    const to = moveBlockAtPos(editor.state, (t) => (tr = t), block.pos, direction);
    if (to === null || !tr) return;
    try {
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(to + 1), 1));
    } catch {
      // No text position inside the moved block (an atom, an empty board).
      // Whatever replaceWith's own mapping produced still stands.
    }
    editor.view.dispatch(tr);
    restoreFocus();
  }

  // What a PARAGRAPH turns into, keyed by turn-into-model.js's row ids —
  // which are disjoint from block-convert.js's target ids by that module's
  // own test, so `runConvert` below can route on a lookup. Each runs a
  // command the shell already runs elsewhere, and each acts IN PLACE on
  // the caret's block; turn-into-model.js's header is where "in place" was
  // established for both, by reading `runSlashInsert`, and why four other
  // shapes are not here.
  //
  // Not `(ed) => runSlashInsert(ed, "bullet")` for `list`: `bullet` is a
  // BLOCK_COMMAND, so on a written line insertionPoint would open a fresh
  // paragraph BELOW and the list would land there — an insert wearing this
  // row's name. COMMANDS.list is setMarker on the caret's own block.
  const PARAGRAPH_TURN_INTO = {
    list: (ed) => COMMANDS.list(ed),
    heading: (ed) => runSlashInsert(ed, "heading 1"),
  };

  // The other half of "turn into", and the same transaction shape the
  // desktop's runBlockConvert uses: replaceWith + setSelection + one
  // dispatch, never lift/toggleX on these structured shapes (qa-block.js's
  // unwrapSoleQABlock, D-8).
  //
  // A paragraph target takes the first branch. The two commands act on the
  // CARET, and the sheet's rows were computed for the frozen `sheetBlock`
  // (see BLOCK_ROW_ACTIONS's header for why a row must act on the block it
  // was opened on) — so the caret is put back inside that block first,
  // and only if the block is still the paragraph the rows were offered
  // for. A transaction that changed it while the sheet was up makes the
  // row a no-op rather than a conversion of whatever is there now.
  function runConvert(target) {
    const block = sheetBlock;
    openSheet = null;
    if (!block || !editor || editor.isDestroyed) return;
    const node = blockNodeAt(block);
    if (!node) return;
    const asParagraph = PARAGRAPH_TURN_INTO[target];
    if (asParagraph) {
      if (node.type.name !== "paragraph" || readonly) return;
      try {
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(block.pos + 1))),
        );
      } catch {
        return;
      }
      asParagraph(editor);
      restoreFocus();
      return;
    }
    const converted = convertBlockNode(node.toJSON(), target, editor.schema);
    if (!converted) return;
    const replacement = Array.isArray(converted)
      ? converted.map((json) => editor.schema.nodeFromJSON(json))
      : editor.schema.nodeFromJSON(converted);
    let tr = editor.state.tr.replaceWith(block.pos, block.pos + node.nodeSize, replacement);
    try {
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(block.pos + 1)));
    } catch {
      // Fall through with whatever replaceWith itself produced.
    }
    editor.view.dispatch(tr);
    restoreFocus();
  }

  // ── the insert sheet ────────────────────────────────────────────────
  //
  // §3: "`+` opens the insert sheet (half detent): paragraph, heading,
  // list, q&a, recipe, code, table, board, chart, image, file."
  //
  // FOUR DECISIONS THIS TASK MADE, written here because each one is a
  // choice a reader would otherwise have to re-derive from the spec.
  //
  // 1. THE ROWS REUSE `commandItems` RATHER THAN GETTING THEIR OWN
  //    INSERTS. Those commands take `{ editor, range }` and open with
  //    `deleteRange(range)`, and the sheet has no typed "/query" to
  //    delete — so at first sight reusing them costs a fake argument.
  //    It does not: `prepareInsertionPoint` (slash-commands.js:785) hands
  //    every command a COLLAPSED range at the cursor for exactly this
  //    reason, so a zero-width range is the shape the commands already
  //    receive in production, not a shim invented here. What reuse buys
  //    is three fixed defects the shell would otherwise re-import by
  //    reimplementing: D-5's stray paragraph above /recipe and /q&a
  //    (insertBoardReplacingEmptyLeadingParagraph), the leading-paragraph
  //    guard, and armPendingTitleFocus, which is what makes a new board
  //    open with its title slot in edit mode. A second copy of those in
  //    the shell would be a second place to get them wrong, on a surface
  //    whose suite covers none of them.
  //
  // 2. "BOARD" IS THE OUTLINE. `dom.dataset.board = typeName`
  //    (block-shell.js:69) makes "board" a CATEGORY, not a node, so the
  //    spec's list names a slot rather than a block. The slash menu's
  //    "shizumu blocks" section holds two blocks the spec's eleven never
  //    name — `outline` and `decision` — and one of them fills the slot.
  //    Outline, because: the spec already names the genre-specific boards
  //    it wants by their own names (recipe, q&a), and `decision`
  //    (considered · chose · because) is a third of exactly that kind, so
  //    a generic word would be an odd way to ask for it; outline
  //    ("structure your thinking") is the one board with no genre at all.
  //    And "outline" is already this shell's word for that shape —
  //    turn-into-model.js's CONVERT_TARGET_LABELS maps `blockquote` to it
  //    — so a writer who
  //    turned a paragraph into an outline finds the same word when they
  //    want a fresh one. `decision` is therefore reachable on the desktop
  //    and nowhere on the phone; that is a gap in the SPEC's list, and it
  //    is reported rather than quietly patched by shipping a twelfth row.
  //
  // 3. `code` IS THE FENCED BLOCK, NOT THE INLINE MARK. slash-commands.js
  //    carries both: "code" (:244) toggles the inline monospace mark and
  //    "code block" (:251) sets the fenced node. A sheet reached from `+`
  //    inserts blocks, and the inline mark is already on the selection
  //    strip as `code`, so the fenced one is the only reading that adds
  //    anything. The row is LABELLED "code block" rather than the spec's
  //    "code" for the same reason the convert sheet labels it that way:
  //    two rows named "code" doing different things is the confusion.
  //
  // 4. THE LIST LIVES HERE, NOT IN A PURE MODULE beside
  //    block-sheet-model.js — the one decision that went against the
  //    precedent, so here is the argument. `blockSheetRows` earns its
  //    module: it takes five inputs and computes a varying, ordered
  //    answer, and getting the order wrong is invisible without a test.
  //    This list computes nothing. It is a constant sequence of ten,
  //    and the only thing that varies is a single boolean (a closed page
  //    offers none), which is one `if` at one call site. Putting it in a
  //    module would cost the property that makes the block sheet honest:
  //    there, the ACTION TABLE IS THE ROW LIST, so a row exists exactly
  //    when its action does and "no dead rows" is structural rather than
  //    remembered. Split label from insert across a file boundary and the
  //    two are free to drift, which reintroduces precisely the dead row
  //    the plan's Step 2 forbids. CLAUDE.md's rule is that DECISIONS go
  //    in pure modules — geometry, gesture intent, viewport arithmetic,
  //    shape conversion — and the one real decision in this block already
  //    lives in one: `needsFreshLine`, imported below.
  //
  // NOTHING IS ABSENT ANY MORE. This block held a list, on P2d's rule that
  // a sheet is a menu and a menu implies completeness, so a row the shell
  // could not honour rendered as no row at all rather than as a dead tap.
  // Every entry on that list has since been spent, and the last of them
  // went in P2f-2 Task 5. Count INSERT_ROWS against §3's eleven; there is
  // no reason written here for a row to be missing, because none is.
  //
  // `chart` was the last one — "`/chart` calls openChartBuilder, and
  // re-hosting ChartBuilder's forms in a full-detent sheet is P2f-2 Task
  // 5". It opens `openChartSheet` now, through BUILDER_SHEETS, and the
  // forms themselves are imported into ChartForm.svelte rather than
  // rebuilt (its header argues where the line between form and frame
  // falls).
  //
  // `table` used to be listed beside it — "the desktop's `/table` row does
  // not insert on tap, it swaps the menu for a row×col size grid, and
  // inserting a silent 3×3 here would ship one label meaning two different
  // things". That reason was true and it is now spent: the row opens
  // TableSizeGrid in a full-detent sheet (openTableSheet below) and the
  // grid's `insert` row is what calls the command, so the label still
  // means what it means on the desktop.
  //
  // `image` and `file` used to be listed here too, "hands off to the
  // system picker, then to an attachment write and a toast the shell has
  // no host for". Both halves of that were wrong, and finding out cost a
  // probe rather than a build:
  //
  //   the picker  is `pickFileBytes` (slash-commands.js:18) — a real
  //               <input type="file"> appended to the body. No Tauri
  //               dialog, nothing to hand off to, and it runs in jsdom.
  //   the toast   was the only true part, and it is now hosted: takeCore
  //               sets `__shizumuShowToast` on the editor element, which
  //               is where slash-commands.js:398 looks. Before that, a
  //               failed read, a failed insert and — worst — the refusal
  //               of a PDF chosen for /image were all SILENT here.
  //
  // So they are rows now. What the probe surfaced was recorded here as
  // unfixed for three phases and is now fixed: both are in
  // slash-insert-target's BLOCK_COMMANDS, so insertionPoint opens a fresh
  // line BEFORE the picker suspends, and a refused or cancelled pick left
  // that blank paragraph behind. It was shared with the desktop, and the
  // desktop fixed it first — `main`'s `555a9fac` gives the line back from
  // `discardOpenedLine` on every abandon path (cancel, read error, a PDF
  // refused for /image). That helper acts only on a range carrying
  // `openedLine`, so it did nothing here until `insertionPoint` was
  // carried across to report the flag; see its own comment.
  //
  // `table` and `chart` are in BLOCK_COMMANDS too, and a builder is a
  // longer gap than any picker, so both would have inherited the same
  // litter — and neither did, because the gap sits on the other side of
  // the write. Their sheets open without touching the document at all, and
  // the one write runs from the commit row, so the fresh line and the
  // block arrive in one transaction. Backing out leaves nothing behind,
  // which is what "the writer backed out" should look like. See
  // commitTableSize and commitChart.
  //
  // WHERE AN INSERTED BLOCK LANDS IS NOT DECIDED HERE.
  // slash-insert-target.js owns that rule and exists because a block
  // command run on a line that already had writing on it SWALLOWED that
  // writing — `/outline` wrapped the user's sentence into the outline.
  // The sheet inserts the same blocks from a different surface and so has
  // the same bug available to it, which is why `needsFreshLine` is
  // imported rather than re-derived.
  //
  // ONE FINDING ABOUT THAT MODULE, from being its second caller: its
  // split is keyed to the SLASH surface's affordance, not to the block
  // type. `heading 1` sits in IN_PLACE_COMMANDS because typing `/heading`
  // at the end of a sentence plainly means "make this line a heading",
  // and giving it a fresh empty heading below would be the mirror-image
  // surprise. Reached from `+`, the same row instead converts the line
  // the caret is on. Both readings are defensible; the rule is followed
  // UNCHANGED rather than overridden for this one surface, because a
  // shell-local exception would give one question two answers — the drift
  // class this workstream keeps catching — and the outcome here preserves
  // every character the writer typed and is one `undo` away on the same
  // strip. Recorded for the spec owner rather than decided by this file.
  const SLASH_BY_TITLE = new Map(commandItems.map((item) => [item.title, item]));

  /** The collapsed range a reused slash command is handed, after the
   *  cursor has been moved to wherever the new block should land. Same
   *  shape and same transaction as prepareInsertionPoint, minus the
   *  deleteRange it opens with: there is no typed query to consume.
   *
   *  Scoped to top-level textblocks for the reason that function gives —
   *  inside a list item or a board the schema's own auto-escape already
   *  decides where a block may go, and second-guessing it here would
   *  fight rules this file does not own. */
  function insertionPoint(ed, title) {
    // `at`, not the `$from` the desktop's copy of this destructures.
    // Svelte reserves the `$` prefix for variables and imports, so
    // `const { $from } = ...` is a COMPILE error inside a component —
    // caught by the build, not silently, but worth naming here because
    // every ProseMirror snippet a reader copies in from src/lib/ carries
    // that destructure and will not compile as written.
    const at = ed.state.selection.$from;
    const lineHasOtherText = at.parent.isTextblock && at.parent.content.size > 0;
    // Did WE open this line? `image` and `file` are in BLOCK_COMMANDS, so
    // they get a fresh one — and they are the two commands that then
    // SUSPEND on a picker. Cancel it and `discardOpenedLine` takes the line
    // back, but only if the range says the line was ours: it opens with
    // `if (!range?.openedLine) return false`. This hand-copy returned
    // `{ from, to }`, so `main`'s fix (`555a9fac`) reached the desktop's
    // `prepareInsertionPoint` and silently did nothing here — the writer
    // asked for a picture, got no picture, and got a blank line instead.
    // Carried across rather than merged in, because this copy exists.
    let openedLine = false;
    if (at.depth === 1 && needsFreshLine(title, lineHasOtherText)) {
      try {
        const after = at.after(1);
        let tr = ed.state.tr.insert(after, ed.state.schema.nodes.paragraph.create());
        tr = tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1), 1));
        ed.view.dispatch(tr);
        openedLine = true;
      } catch {
        // Leave the cursor where it is rather than abandoning the insert:
        // acting in place is the old behaviour, not a broken one.
      }
    }
    const pos = ed.state.selection.from;
    return { from: pos, to: pos, openedLine };
  }

  /** Run one of the shared slash commands.
   *
   *  TWO SURFACES, ONE PATH. The insert sheet calls this with no `trigger`,
   *  because there is no typed text to consume; the suggestion strip calls
   *  it with the `/query` range the writer actually typed. That third
   *  argument is the only difference between THOSE TWO, and it is what makes
   *  `insertionPoint` below a faithful copy of `prepareInsertionPoint`
   *  (slash-commands.js:797) rather than a near one: that function opens
   *  with exactly this `deleteRange`, and the hand-copy dropped it because
   *  the sheet had nothing to delete. The strip does. Adding the line back
   *  here, conditionally, is what stopped this task needing a third way to
   *  run a slash command.
   *
   *  The order is not interchangeable. Deleting the trigger FIRST is what
   *  lets `insertionPoint` read the line correctly: with `/heading` still
   *  sitting on an otherwise empty paragraph the line looks written, and
   *  `needsFreshLine` would strand an empty paragraph above every block
   *  the writer makes from the strip.
   *
   *  No restoreFocus() after it, because every one of these chains opens
   *  with .focus() and the focus the Row's real button took is already
   *  back. That is redundancy avoided, NOT a guard — and the distinction
   *  is written down because the first draft of this comment claimed the
   *  omission was load-bearing, on the theory that a focus() dispatched
   *  after a board insert would yank the caret out of the title slot
   *  armPendingTitleFocus had just handed it to. It would not:
   *  block-title.js:505 consumes that arm inside a requestAnimationFrame,
   *  so a synchronous focus() here lands a frame BEFORE the title slot
   *  asks for the caret and loses the race it was supposed to win.
   *
   *  Probed rather than reasoned: adding restoreFocus() here leaves this
   *  file at 50 passed — re-measured after the per-row tests landed, the
   *  first draft having recorded 42 from before the last test existed.
   *  Nothing in the suite can see focus at all — jsdom
   *  has no soft keyboard and no layout — so this is a device-pass
   *  judgement, the same treatment the missing focus() in COMMANDS gets,
   *  and it is recorded as one rather than dressed up as an invariant a
   *  test is holding in place.
   *
   *  THE FOURTH ARGUMENT is the size the table grid picked, and it exists
   *  because `table` is the one entry in `commandItems` whose `command`
   *  takes a second parameter — `command({editor, range}, size)`,
   *  slash-commands.js:264. Passing it through here rather than opening a
   *  third way to run a slash command keeps that property intact: the
   *  desktop's grid does exactly this (slash-commands.js:1011 wraps the
   *  item so its command runs with the chosen size), so both grids reach
   *  the same command body with the same argument.
   *
   *  Safe for the other rows precisely because it is `undefined` for them:
   *  `size = {rows: 3, cols: 3}` is a DEFAULT parameter, so an explicit
   *  undefined and a missing argument are the same call, and every command
   *  that takes one parameter ignores a second regardless. */
  function runSlashInsert(ed, title, trigger = null, arg = undefined) {
    const item = SLASH_BY_TITLE.get(title);
    // A title this file names that the shared list does not carry. The
    // first draft of this comment said that could not happen "because
    // every title below is asserted against commandItems" — nothing did.
    // The order test asserts LABELS ("heading", "list"), not the ids
    // behind them ("heading 1", "bullet"), so renaming a slash command
    // upstream turned four of these rows into permanent no-op taps with
    // 256 shell tests still green. What holds it now is behavioural:
    // "writes to the doc when the <row> row is tapped" taps all seven and
    // asserts the doc changed, and typoing these four ids reddens exactly
    // those four. The early return stays as the fail-safe it always was.
    if (!item) return;
    // The typed "/query", consumed once, here — not by the command, whose
    // own `deleteRange(range)` is then a no-op on the collapsed range
    // `insertionPoint` hands it. Exactly prepareInsertionPoint's first
    // line, for exactly its reason: the cursor has to move to a fresh line
    // in between, and it cannot while the trigger text is still under it.
    if (trigger) ed.chain().focus().deleteRange(trigger).run();
    item.command({ editor: ed, range: insertionPoint(ed, title) }, arg);
  }

  /** The one row with no slash command behind it: there is no
   *  `/paragraph`, because on the desktop you make a paragraph by
   *  pressing Enter.
   *
   *  needsFreshLine cannot key this row — its sets are keyed by
   *  slash-command title and neither holds one for "paragraph" — and that
   *  is a structural absence rather than a gap to work around. The rule
   *  exists to stop a CONVERTING command acting on a written line; a
   *  paragraph insert converts nothing, so it has no in-place branch to
   *  choose between. It always lands a new empty paragraph after the
   *  top-level block the caret is in, which can neither swallow the line
   *  nor be a no-op — and "in place" would be exactly a no-op, i.e. a
   *  dead row in the most common state the sheet is opened from. */
  function insertParagraph(ed) {
    try {
      const after = ed.state.selection.$from.after(1);
      let tr = ed.state.tr.insert(after, ed.state.schema.nodes.paragraph.create());
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1), 1));
      ed.view.dispatch(tr);
    } catch {
      // No top-level ancestor to insert after (a selection the editor is
      // not in). Nothing is written, and the sheet still closes.
    }
    // Unlike the slash rows above, this dispatch does no focusing of its
    // own, so the focus the Row took has to come back here — on BOTH
    // paths, which is why it sits after the catch rather than inside the
    // success branch. The catch used to return early instead, dropping
    // the keyboard for good on a write that never happened.
    restoreFocus();
  }

  /** The slash-command titles the shell answers with a BUILDER instead of
   *  with a write, and the openers it answers them with.
   *
   *  It is a table because there are two surfaces asking, not one. The
   *  insert sheet's row is the obvious caller; the SUGGESTION STRIP is the
   *  other, and it was getting a different answer. A chip's id is a slash
   *  title, `pickSuggestion` ran every one of them through
   *  `runSlashInsert`, and for these two titles that is the wrong path in
   *  two different ways:
   *
   *    table   the command inserts at its `size` DEFAULT, so the chip put
   *            a silent 3×3 in the document while the row one surface over
   *            opened a 6×6 grid — one label, two behaviours, and neither
   *            of them what the desktop's `/table` does (its menu wraps the
   *            item in the grid, slash-commands.js:1011).
   *    chart   the command's whole body is `openChartBuilder`, which
   *            dispatches through the `onOpen` the shell defaulted to a
   *            no-op. The chip consumed the writer's typed `/chart`, opened
   *            a fresh paragraph through `insertionPoint`, and then did
   *            nothing at all — a DEAD CHIP, on a strip whose own model
   *            says it cannot have one.
   *
   *  Both were probed rather than reasoned, by routing the chip back
   *  through `runSlashInsert` and reading the document: `/table` + tap
   *  leaves a table of 3 rows by 3 columns and no grid, and `/chart` + tap
   *  leaves the document one paragraph longer with nothing in it.
   *
   *  Reading the openers off one table is what stops the two surfaces
   *  disagreeing again: a title in here is answered by a sheet wherever it
   *  is tapped, and `runSlashInsert` never sees it.
   *
   *  The openers ignore the argument `run` hands them (the editor), which
   *  is the point rather than an oversight — nothing is written until the
   *  builder commits. */
  const BUILDER_SHEETS = new Map([
    ["table", () => openTableSheet()],
    ["chart", () => openChartSheet({ mode: "create" })],
  ]);

  // THE ROWS ARE THE SLASH MENU'S, since the fourth device pass:
  // "blocks list does not show similar to /, task as an example". They
  // were eleven written out here, with three list commands collapsed into
  // one `list` row and three headings into one `heading`, because eleven
  // rows at 44px overfilled the half detent §3 gave this sheet. The sheet
  // takes the full detent and has a finder over it now (the third device
  // pass), so the collapse bought nothing and cost a writer who typed
  // `task` every row.
  //
  // insert-menu.js groups `commandItems` into the menu's own sections and
  // says which titles this surface withholds and why. What stays HERE is
  // the half a pure module cannot hold: which id runs what.
  const insertSections = $derived(insertMenuSections({ items: commandItems, query: insertQuery }));

  /** Every row ends in a write to the document — `table` and `chart` by
   *  way of a builder, the rest immediately — so a closed page offers none,
   *  which makes the SHEET empty, and an empty sheet is the
   *  reserved-but-empty band one surface over. The `+` is not on the
   *  strip there at all (see unavailableIds), and this guard is the other
   *  half: a button that is absent cannot be pressed, and this is what
   *  happens if that ever stops being true. */
  function openInsertSheet() {
    if (readonly) return;
    // Reset on every open rather than remembered — the table sheet's rule
    // for its size (openTableSheet): a sheet that reopens on the last
    // query is a fourth thing to read before the row is there.
    insertQuery = "";
    openSheet = "insert";
  }

  // ── finding a row by name ───────────────────────────────────────────
  //
  // The second device pass: "insert choice have no search field". Eleven
  // rows, the keyboard up, half of them under it. The field at the top of
  // the sheet narrows the rows as the writer types — insert-filter.js's
  // rule — and Enter runs the first one left, so `tab` + Enter opens the
  // table builder without a tap on a row the keyboard half-covers. The
  // desktop's slash menu is the same two moves after `/`.
  //
  // NOT AUTOFOCUSED, the pin editor's argument (its sheet's header):
  // focusField defers into a rAF, outside the gesture, and a webview
  // raises no keyboard for that — so an autofocus would leave a caret in
  // a field with no IME whenever the sheet was opened with the keyboard
  // down (the block sheet's `insert below`). Opened from the strip the
  // keyboard is already up, and a tap on the field keeps it.
  let insertQuery = $state("");

  function runFirstInsertRow() {
    const row = firstInsertRow(insertSections);
    if (row) runInsertRow(row);
  }

  /** What each row id does. Three shapes: the sheet's own paragraph, the
   *  two builders, and — for everything else — the slash command of that
   *  name, which is what makes the sheet and `/` one implementation. */
  function runInsertRow(row) {
    // Closed before the insert runs, like every block-sheet row: the two
    // Sheets then see one settled turn rather than an intermediate one.
    openSheet = null;
    if (!editor || editor.isDestroyed || readonly) return;
    const builder = BUILDER_SHEETS.get(row.id);
    if (builder) {
      builder();
      return;
    }
    if (row.id === "paragraph") insertParagraph(editor);
    else runSlashInsert(editor, row.id);
    // THE CARET GOES INTO WHAT WAS JUST INSERTED, and the keyboard with
    // it — the third device pass: "click on a block from insert, the
    // keyboard disappears, then we need to click again". The row keeps
    // focus where it was (Row's `keepFocus`), which covers a sheet opened
    // from the strip with the editor focused; this covers the rest — a
    // sheet opened from the block handle with the keyboard down, or a tap
    // made after typing in the finder. Synchronous, inside the click, so
    // the focus traces to the writer's tap and a webview raises the
    // keyboard for it (focus-field.js's rule). The builders are skipped:
    // `table` and `chart` open their own sheet, and nothing is inserted
    // until that sheet commits — they returned above.
    if (editor.isDestroyed) return;
    editor.view.focus();
  }

  // ── /table's size grid ──────────────────────────────────────────────
  //
  // THE CELL, NOT THE SIZE, is what is held here, because the cell is what
  // the grid renders and the size is derived from it by the same function
  // the desktop paints with (`gridCellsFor`). Holding the size instead
  // would mean the highlight and the `insert` row each deciding what the
  // tap meant, and the top row is exactly where those two answers differ:
  // it commits 2 rows, not the 1 its coordinates say.
  //
  // The default is reset on every open rather than remembered. A sheet
  // that reopens on the last size would be a fourth thing the writer has
  // to read before tapping, and 3×3 is what `/table` has always inserted
  // when nothing was chosen (DEFAULT_HOVER exists for that reason).
  let tableCell = $state(DEFAULT_HOVER);
  const tableSize = $derived(gridCellsFor(tableCell));

  function openTableSheet() {
    tableCell = DEFAULT_HOVER;
    openSheet = "table";
  }

  /** The grid's one write, and the only place a table is inserted from the
   *  shell.
   *
   *  NOTHING RAN WHEN THE SHEET OPENED, which is the whole shape of this.
   *  Task 1 found that `image` and `file` open a fresh line through
   *  `insertionPoint` BEFORE the picker suspends, so a refused pick leaves
   *  a blank paragraph the writer never asked for. A grid is a longer gap
   *  than a file dialog and backing out of one is more likely, not less —
   *  so the fresh line is opened HERE, inside `runSlashInsert`, in the same
   *  synchronous turn as the insertTable it exists for. Back out of the
   *  grid and the document has not been touched at all.
   *
   *  It reads the LIVE selection, like every other row on the insert
   *  sheet, rather than freezing a position when the sheet opened. The
   *  block sheet freezes because it was opened ON a block and its rows were
   *  computed FOR it; this sheet is opened on a caret and computes nothing
   *  from it. Freezing would also buy a staleness the other reading cannot
   *  have — a stored position that a save or a collaborator's transaction
   *  can invalidate — and the sheet is at FULL detent, so unlike the half
   *  detent P2f Task 2 reasoned about there is no page left to tap through
   *  to. */
  function commitTableSize() {
    const size = tableSize;
    openSheet = null;
    if (!editor || editor.isDestroyed || readonly) return;
    runSlashInsert(editor, "table", null, size);
  }

  // ── /chart's builder ────────────────────────────────────────────────
  //
  // THE SEAM WAS ALREADY THERE AND WAS ANSWERED WITH A NO-OP.
  // `buildEditingExtensions` configures the Chart node with `onOpen`
  // (shared-extensions.js:213), EditorCore forwards it as `onChartOpen`
  // (:242), and `openChartBuilder` is the one command both routes into it
  // dispatch through: `{mode: "create"}` from the slash command
  // (slash-commands.js:352) and `{mode: "edit", pos, attrs}` from a tap on
  // a chart already in the document (chart.js:568). PageScreen listed
  // `onChartOpen` among the callbacks it deliberately withheld because
  // "the shell has nowhere to put a sheet"; it has one now, so the prop is
  // forwarded and this is what receives it.
  //
  // BOTH ROUTES ARRIVE HERE, which is the thing to keep true. The tap on
  // an existing chart is not a nicety: without it a phone can hold a chart
  // — written on the desktop, or written on the phone a minute earlier —
  // that it can see and cannot open. That half of the seam costs nothing
  // extra precisely because it is the same callback.
  //
  // THE DRAFT IS THE STATE, and it is reset on every open rather than
  // remembered, for the reason the table grid resets its cell: a builder
  // that reopens holding the last chart's nodes is a form the writer has
  // to empty before they can use it. `chartDraft(null)` is also what it
  // holds while the sheet is shut, so the markup below never has to test
  // for null.
  let chart = $state(chartDraft(null));

  /** Whether the draft may be written, and what the commit row says when
   *  it may not. One derivation, two readings, so the row's label and its
   *  liveness cannot disagree — the same pairing findStripModel makes for
   *  the find arrows and their caption. */
  const chartCommits = $derived(chartCanCommit(chart));

  function openChartSheet(params) {
    chart = chartDraft(params);
    openSheet = "chart";
  }

  /** The builder's one write, and the only place a chart is inserted or
   *  updated from the shell.
   *
   *  NOTHING RAN WHEN THE SHEET OPENED — commitTableSize's shape, for
   *  commitTableSize's reason, and `chart` had MORE of the hazard than
   *  `table` did rather than less. It is in BLOCK_COMMANDS too, so its
   *  slash command opens a fresh line through `insertionPoint`; but unlike
   *  every other entry in that set its command body writes nothing at all,
   *  so before this task running it left the blank paragraph and inserted
   *  no block to put in it. The fresh line is opened HERE instead, in the
   *  same synchronous turn as the `insertChart` it exists for. Back out of
   *  the builder and the document has not been touched.
   *
   *  CREATE AND EDIT DIVERGE ON ONE LINE and are otherwise the same call.
   *  An edit acts at the position the NodeView handed over — a FROZEN one,
   *  and here that is right where the table grid's live read was right:
   *  this sheet was opened ON a block and its whole content was computed
   *  FROM it, which is the block sheet's rule (P2f Task 2) rather than the
   *  insert sheet's. `updateChart` re-checks the node at that position and
   *  returns false if it is no longer a chart, so a document that moved
   *  underneath is a no-op rather than a write to the wrong block.
   *
   *  THE FIRST LINE IS A FAIL-SAFE AND NO TEST CAN SEE IT, which is
   *  written down rather than implied. `chartCommits` already decides
   *  whether the row is a control at all — Row renders an inert line when
   *  `onSelect` is null — so the only caller of this function cannot reach
   *  it in the state it guards, and deleting it reddens nothing. It is
   *  kept for the reason `openInsertSheet`'s readonly guard is kept, and
   *  it is the same sentence: the contract is that a control the shell
   *  withheld cannot be pressed, and this is what happens if that contract
   *  is ever broken. Recorded as redundancy, not dressed up as an
   *  invariant a test is holding in place. */
  function commitChart() {
    if (!chartCanCommit(chart)) return;
    const draft = chart;
    openSheet = null;
    if (!editor || editor.isDestroyed || readonly) return;
    const attrs = chartAttrs(draft);
    if (draft.mode === "edit" && typeof draft.pos === "number") {
      editor.commands.updateChart({ pos: draft.pos, attrs });
    } else {
      insertionPoint(editor, "chart");
      editor.commands.insertChart({ attrs });
    }
    // `insertChart` sets the selection into the paragraph it leaves after
    // the chart and `updateChart` moves nothing, but neither focuses — so
    // unlike the slash rows, whose chains all open with .focus(), the
    // focus the commit Row took has to be handed back here.
    restoreFocus();
  }

  // ── the header's own sheets ─────────────────────────────────────────
  //
  // `onDate`, `onPages`, `onNew` and the trail tag have been declared in
  // PageScreen and forwarded to PageHeader since P2a, reaching nothing.
  // Three of them open a sheet; one does not, and the one that does not is
  // where this section starts, because it is the decision the other three
  // are shaped around.
  //
  // `onPins` is the fifth and it is the one that is NOT a sheet, which is
  // why it waited: spec §2 makes pins a PUSHED SCREEN — "it has filters,
  // actions and a list" — and until P3 Task 1 the shell had no stack to
  // push onto. Opening it as a sheet to have something behind the control
  // would have built the wrong surface and then had to unbuild it. It is
  // wired now, to `openPins` in the stack section above, and the screen it
  // pushes is PinsScreen.
  //
  // ── `+` CREATES. IT DOES NOT ASK. ──
  //
  // Spec §1's gesture table is explicit — "header dots, horizontal pan or
  // tap | switch page of the day; `+` creates" — and a confirmation sheet
  // in front of the one control whose whole value is that it is instant
  // would be friction bought with nothing. What `+` needed deciding was
  // not whether to ask but WHICH DAY it writes on, and the answer is
  // today, from whatever day is showing. `createNewPage(pastDate)` is a
  // legal call that manufactures a page page-writable.js immediately
  // locks: an empty page, dated last Tuesday, that refuses every
  // keystroke. A control that can only produce that on a past page is a
  // control that is dead exactly where the writer is most likely to press
  // it. New writing is now — which is CLAUDE.md's rule, not this file's —
  // so `+` is also the way BACK to now, and that is the shell's whole
  // answer to a phone left open across midnight until the spec's midnight
  // sheet is built.
  //
  // ── THE DATE SHEET OPENS THE PAST READ-ONLY ──
  //
  // "Past pages are read-only… open yesterday in memory, write today on
  // PAGE" (CLAUDE.md). The second half of that sentence names a ROUTE, and
  // memory was P3 — a date sheet that switched roots would have landed on a
  // stub that says "memory: not built yet", which is a sheet with a dead
  // end behind every row. The first half names the RULE, and the rule is
  // what has to hold: the desktop renders past pages on this same surface
  // with `isWritable` false (Page.svelte:175), reached from memory, and the
  // phone renders them the same way, reached from here.
  //
  // THIS SENTENCE USED TO PREDICT THE WRONG THING, and it is corrected
  // rather than dropped, because the prediction is the interesting part.
  // It said "when memory lands it pushes the same read-only view rather
  // than a second one". It pushes a second one: ReadingScreen, which holds
  // no editor, no gutter and no cursor and renders the doc as static
  // prose. §2 asks for it by name — "tapping a page pushes a reading view;
  // 'continue' lives there" — and continue is the reason it cannot be this
  // surface: a view whose one offer is "take this page to the writing
  // surface" is meaningless on the writing surface.
  //
  // So there are two surfaces and one rule. THIS SHEET STAYS, and it stays
  // because it answers a different question: it is the page root's own day
  // switcher, its first row is TODAY, and that row is the shell's only way
  // back to now for a phone left open across midnight. Nothing about it
  // bends the read-only rule — `pageReadonly` has held on both routes since
  // P2f. Removing it would have cost the day switcher and the way back and
  // bought nothing.
  //
  // Which is why this task's first change was page-writable.js. Without
  // its date arm the sheet hands the writer a live cursor on a page from
  // last week and every keystroke saves into it — and `is_open` cannot
  // stand in, because nothing in the backend flips that column at a day
  // boundary. What "read-only" then looks like on the phone is what it
  // already looked like on a closed page: `+` dead, the insert sheet's
  // rows gone, the block sheet down to the rows that do not write. The
  // chrome that says so is already built and already tested.
  //
  // ── THE PAGES SHEET IS NOT "TOO EAGER", AND §4 SAYS SO ABOUT SOMETHING
  //    ELSE ──
  //
  // The plan cites §4 (:130) as recording that the dots strip and this
  // sheet "have oscillated between too eager and dead across releases".
  // Read at the source, that is not what the line says. The subject of
  // "that gesture has swung between 'too eager' and 'dead'" is the
  // RIGHT-EDGE SWIPE, which §4 removes because Android gesture navigation
  // owns both edges — and the sentence after it is "The dots strip and the
  // pages sheet carry page switching." They are the REPLACEMENT for the
  // oscillating gesture, not co-defendants. So the warning to heed is the
  // opposite of the one the plan reports: this sheet has to be reliably
  // there, because the gesture that used to do its job is gone.
  //
  // WHEN IT APPEARS is therefore already decided, one file over, and
  // needed no new rule: PageHeader renders the dots as a control only when
  // there is more than one page on the day ("one dot is not a page
  // indicator, it is a smudge"). That is exactly the condition under which
  // this sheet has something to offer — a one-page day would list the page
  // the writer is already on and nothing else. Wiring `onPages` is the
  // whole change; the gate was written in P2a and is right.

  /** `getThread` rows for the date sheet, and `getFocusesForDate` rows for
   *  the pages sheet. Both are fetched when their sheet opens rather than
   *  held live: they are a menu's contents, read once at the moment the
   *  menu is asked for, and a subscription would put a query on the
   *  writer's typing path for a list nobody is looking at. */
  let dayList = $state([]);
  let pageList = $state([]);

  /** `getLineages()` for the trail sheet, and what is typed into its
   *  field. The field's text is NOT a filter — see the trail sheet below. */
  let trailList = $state([]);
  let newTrailName = $state("");

  /** How many thread rows to ask for. `getThread` returns PAGES, and the
   *  sheet's rows are DAYS, so this is not the row count: a writer with
   *  four pages a day fills fourteen days with fifty-six rows. Sixty is
   *  the over-ask that makes the cap in `dayRows` the thing that decides,
   *  rather than this number silently deciding it on a busy account. */
  const DAY_FETCH = 60;

  const daySheetRows = $derived(
    dayRows({ summaries: dayList, currentDate: page?.date ?? null }),
  );
  /** The sheet's one sentence when today is its only row — decided in
   *  page-picker.js (`daySheetNote`), because "is this list empty apart
   *  from today" is a rule about the rows, not about the sheet. A fresh
   *  device used to open onto one row and a blank half-screen. */
  const daySheetNoteText = $derived(daySheetNote(daySheetRows));

  /** The living document's day markers, read when its days sheet opens. */
  let markerList = $state([]);
  const markerSheetRows = $derived(markerRows({ markers: markerList, todayDateStr: clockDay }));

  /** A day picked from a living document's days: the sheet goes, and the
   *  editor takes the caret to that day's marker. */
  async function openMarkerDay(date) {
    openSheet = null;
    await tick();
    core?.scrollToDate?.(date);
  }

  /** The page whose delete row has been tapped once (page-picker.js
   *  pageSheetRows: the second tap deletes). Cleared whenever the pages
   *  sheet is not open, so a confirm never waits for a writer who left. */
  let armedDeleteId = $state(null);
  $effect(() => { if (openSheet !== "pages") armedDeleteId = null; });

  const pageSheetRows = $derived(
    composePageSheetRows({ summaries: pageList, currentPageId: page?.id ?? null, armedDeleteId }),
  );

  /** Is the trail sheet asking WHERE a new trail begins, rather than which
   *  trail this page joins. One flag rather than a second sheet: the list
   *  is the same list, and the question changes what a row means, not what
   *  the rows are. Cleared whenever the sheet opens or closes, so it never
   *  greets a writer who did not ask for it. */
  let trailNesting = $state(false);

  const trailRows = $derived(
    trailSheetRows({
      lineages: trailList,
      currentLineageId: page?.lineage_id ?? null,
      typedName: newTrailName,
      nesting: trailNesting,
      // WHETHER THE PAGE HAS ANYTHING ON IT, which is the whole condition
      // on offering a living doc: becoming a continuous trail's canonical
      // is permanent, so it is offered only where it costs nothing. The
      // editor is asked when it is mounted, because it holds what the
      // writer has typed but not yet saved; the row is the fallback for
      // the frame before it mounts, and "not empty" is the safe answer to
      // be wrong with — it withholds the irreversible row, never offers it.
      pageEmpty: pageLooksEmpty,
      canonicalByLineage: trailCanonicals,
      pageCounts: trailPageCounts,
      pinCounts: trailPinCounts,
    }),
  );

  /** Is the sheet SHOWING parents right now — read off the rows, not off
   *  the flag that asked for them.
   *
   *  `trailNesting` is the request; the model decides whether it can be
   *  honoured, and it declines when the typed name is empty or already
   *  taken. Asking the flag meant the sheet could say "choose the trail X
   *  goes inside" over a list of assignment rows, because nothing cleared
   *  it when the name stopped being creatable. One source for the question
   *  and the answer, so they cannot disagree.
   *
   *  The flag itself is deliberately NOT cleared there: a writer who typed
   *  a name that collides, then fixes it, meant to keep nesting. */
  const nestingNow = $derived(trailRows.some((r) => r.kind === "nest-target"));

  /** The sheet opens FIRST and fills behind itself, on both of the two
   *  that fetch. A phone tap that shows nothing until a round trip lands
   *  reads as a dropped press, and neither sheet is ever empty in that
   *  gap: `dayRows` synthesises today and the day being shown with no
   *  input at all, and the pages sheet only has a control to open it when
   *  the day has more than one page.
   *
   *  The previous list is NOT cleared on the way in. Days do not stop
   *  existing, so the stale answer is the right answer plus whatever has
   *  been written since; blanking the list to avoid one frame of that
   *  would trade a correct row for an empty sheet. `showing` follows the
   *  loaded page rather than the fetch, so it is never stale. */
  /** The month the day sheet's calendar shows, reset on every open to the
   *  month of the page being read — the day sheet's whole subject. */
  let dayMonth = $state(null);

  /** The days the grid marks: every day the sheet's own list holds a page
   *  for. One source, so the grid and the rows cannot disagree about
   *  which days exist. */
  const dayMarkedDays = $derived(
    new Set(dayList.map((row) => row?.date).filter(Boolean)),
  );

  /** A day tapped on the grid. The sheet's rows carry the page to open;
   *  the grid carries only a date, so the row is looked up — and today is
   *  handled by `openDay` itself, which creates the page if there is
   *  none. A date with neither is left alone rather than opening the
   *  reading view's "this page did not open": the primitive does not
   *  offer those days at all (`markedOnly`), so this is the guard for a
   *  list that changed under a sheet already open. */
  function openDayByDate(date) {
    if (date === clockDay) {
      openDay({ date });
      return;
    }
    const row = daySheetRows.find((r) => r.date === date);
    if (row && !row.showing) openDay(row);
  }

  async function openDateSheet() {
    // A living document is one page: its days are the markers inside it,
    // listed from the open editor (page-picker.js markerRows, J5.4).
    if (loadedTrailMode === "continuous") {
      markerList = core?.getDayMarkers?.() ?? [];
      openSheet = "days";
      return;
    }
    dayMonth = monthOf(page?.date ?? clockDay);
    openSheet = "date";
    try {
      const rows = await getThread(DAY_FETCH, 0, "date");
      if (live) dayList = Array.isArray(rows) ? rows : [];
    } catch (err) {
      // The sheet keeps today and the day being shown, which are the two
      // rows a writer on a past page actually needs. A failed history read
      // must not cost the way back to now.
      console.error("shell: could not read the days with writing", err);
    }
  }

  /** Gated on a date for the reason `openInsertSheet` is gated on
   *  `readonly`: an open handler that declines beats a sheet that opens
   *  onto nothing. There is no day to list until the load lands, and
   *  PageHeader's dots — the only control that calls this — do not exist
   *  before then either. */
  async function openPagesSheet() {
    if (!page?.date) return;
    openSheet = "pages";
    try {
      const rows = await getFocusesForDate(page.date);
      if (live) pageList = Array.isArray(rows) ? rows : [];
    } catch (err) {
      console.error("shell: could not read the day's pages", err);
    }
  }

  /** Open a page the writer picked, from either sheet.
   *
   *  ADDRESSED BY `pageAddress`, never by (date, page_number). That module
   *  exists because the number is minted per device and renumbered on
   *  merge, and a lookup by it "could land the user on someone else's page
   *  entirely" — observed on a real account. Every row from both sheets
   *  carries its whole summary row so this call can have the id.
   *
   *  Today goes through `getOrCreateToday` instead, and it is the only
   *  branch here that can WRITE anything: the day may have no page yet,
   *  which is exactly the state a phone left open past midnight is in, and
   *  it is the one call in the api that makes one. */
  async function openDay(row) {
    openSheet = null;
    try {
      if (row.date === clockDay) {
        const result = await getOrCreateToday();
        await readClockDay(); // judge it by the clock that dated it (clockDay)
        await adoptPage(rememberToday(result?.page ?? null));
        return;
      }
      // Unreachable from the sheet — `dayRows` only ever omits the page on
      // a row it also marks `showing`, and a showing row renders inert.
      // Kept because the day it becomes reachable, the alternative is
      // `pageAddress(null)` resolving to a lookup with three nulls in it.
      if (!row.page) return;
      const result = await getPage(...pageAddress(row.page));
      await adoptPage(result?.page ?? null);
    } catch (err) {
      console.error("shell: could not open that day", err);
    }
  }

  async function openPageRow(row) {
    openSheet = null;
    try {
      const result = await getPage(...pageAddress(row.page));
      await adoptPage(result?.page ?? null);
    } catch (err) {
      console.error("shell: could not open that page", err);
    }
  }

  /** Remove the page the writer is looking at, and land them somewhere.
   *
   *  THE FALLBACK IS THE DESKTOP'S, deliberately: previous page, else next,
   *  else today (Page.svelte's `handleRailDelete`). Sharing the rule rather
   *  than re-deriving it is the point — the two trees disagreeing about where
   *  a writer ends up after a delete is the kind of difference nobody
   *  discovers until it has annoyed them twice.
   *
   *  `getOrCreateToday` rather than a plain load for the last case: deleting
   *  the only page of a day leaves the writer on a fresh empty page, which is
   *  where `+` would have put them, instead of on a day with nothing in it.
   *
   *  THE ADJACENT PAGE IS FOUND FIRST, before the delete. Afterwards the row
   *  it is computed from is gone, and `getAdjacentPage` would be answering
   *  about a page that no longer exists.
   *
   *  AND IT ARRIVES WHOLE. `get_adjacent_page` returns a `PageWithLines`, the
   *  same shape `getPage` answers with — so the neighbour is adopted directly
   *  rather than looked up again by address. The first version did look it up
   *  again, passing the wrapper to `pageAddress`, which found no `id` on it
   *  and produced `getPage(null, null, null)`: "date required when page_id is
   *  null", the delete already committed and the writer left on the page that
   *  was gone. Found by the device run, in the exception collector.
   */
  async function deletePageRow(row) {
    openSheet = null;
    try {
      let target = null;
      for (const direction of ["prev", "next"]) {
        if (target) break;
        try { target = await getAdjacentPage(row.pageId, direction); } catch {}
      }
      // THE EDITOR IS HOLDING THIS PAGE, and adopting the neighbour below
      // is a page switch — which flushes the page being left. Without this
      // it flushed the one just deleted and the backend answered "Query
      // returned no rows", on an A16, during an ordinary delete. The editor
      // cannot know a row is gone; this is the host saying so.
      core?.forgetPage?.(row.pageId);
      await deleteFocus(row.pageId);
      if (target?.page) {
        await adoptPage(target.page);
      } else {
        const result = await getOrCreateToday();
        await readClockDay(); // judge it by the clock that dated it (clockDay)
        await adoptPage(rememberToday(result?.page ?? null));
      }
      // The day's page list is not refreshed here on purpose: `adoptPage`
      // re-counts it for the header's dots, and the sheet re-reads it on its
      // next open (`openPagesSheet`). The sheet is closed by the first line
      // of this function, so there is no stale list on screen to correct.
    } catch (err) {
      console.error("shell: could not delete that page", err);
    }
  }

  /** `+`. See the section header for why it always writes on today. */
  async function newPage() {
    try {
      const result = await createNewPage(clockDay);
      await adoptPage(result?.page ?? null);
    } catch (err) {
      console.error("shell: could not start a new page", err);
    }
  }

  // ── the trail sheet ─────────────────────────────────────────────────
  //
  // What it offers is trail-sheet-model.js's decision; what a pick DOES is
  // this file's, and it is deliberately one thing: `setFocusLineage`. The
  // desktop's `handleLineageChange` (Page.svelte:495) has seven branches
  // because it also merges pages into a canonical, deletes source rows and
  // stamps day markers. The model's header records why none of that is
  // reachable from here — continuous trails are listed and are not choices
  // — so this function has one path and no way to destroy anything.
  //
  // WHO GETS THE CONTROL AT ALL is decided at the call site below, and two
  // pages do not: a read-only page, because assigning a trail to a page
  // whose canvas is refusing edits would then inject pins into it (see
  // carryForward); and a continuous trail's canonical, because every row
  // the sheet could offer it is one the desktop refuses — unlinking or
  // moving that page orphans the trail's whole living document. Both are
  // the absent-rather-than-dead treatment the insert sheet's missing rows
  // already take.

  function openTrailSheet() {
    // The call site does not offer the control in either of these cases;
    // this is the other half, the same way `openInsertSheet` guards
    // `readonly` that the disabled `+` already covers.
    if (!page || readonly || loadedTrailMode === "continuous") return;
    newTrailName = "";
    trailNesting = false;
    openSheet = "trail";
    loadTrails();
  }

  /** Which continuous trails already own a document, as {id: pageId}.
   *
   *  Read when the sheet opens rather than kept current: the sheet is the
   *  only reader, a canonical is created once and never moves, and a phone
   *  that polled for this would be asking a question nobody is looking at
   *  the answer to. */
  let trailCanonicals = $state({});

  /** Has the writer put anything on this page yet?
   *
   *  `editor.isEmpty` while the editor is mounted — it knows about the
   *  keystroke that has not been saved. Falling back to the row is for the
   *  frame before the editor arrives, and it errs towards NOT empty, which
   *  withholds the permanent row rather than offering it on a guess. */
  const pageLooksEmpty = $derived.by(() => {
    if (editor && !editor.isDestroyed) {
      try { return !!editor.isEmpty; } catch { return false; }
    }
    const json = page?.content_json;
    if (typeof json !== "string" || json === "") return false;
    try {
      const doc = JSON.parse(json);
      const kids = Array.isArray(doc?.content) ? doc.content : [];
      return kids.length === 0
        || (kids.length === 1 && !(kids[0]?.content?.length));
    } catch { return false; }
  });

  /** The canonicals, for the sheet that is about to list them. Failures are
   *  swallowed into "no canonical", which makes the row unselectable — the
   *  same answer a trail with no document gets, and the safe one: a row
   *  that cannot be pressed is better than one that opens nothing. */
  async function loadTrailCanonicals(rows) {
    const continuous = (rows || []).filter((l) => l?.mode === "continuous" && l.id);
    if (continuous.length === 0) { trailCanonicals = {}; return; }
    const pairs = await Promise.all(continuous.map(async (l) => {
      try {
        const got = await getCanonicalTrailPage(l.id);
        return [l.id, got?.page?.id ?? got?.id ?? null];
      } catch { return [l.id, null]; }
    }));
    if (live) trailCanonicals = Object.fromEntries(pairs);
  }

  async function loadTrails() {
    try {
      const rows = await getLineages();
      if (live) trailList = Array.isArray(rows) ? rows : [];
      readTrailCounts();
      await loadTrailCanonicals(trailList);
    } catch (err) {
      // The sheet keeps its field and whatever list it already had. A
      // failed read costs the choices, not the ability to name a new one.
      console.error("shell: could not read the trails", err);
    }
  }

  /** Return in the trail sheet's field — trail-sheet-model.js decides
   *  which row it runs, and whether any. */
  function submitTrailName() {
    const row = trailSheetSubmit({ rows: trailRows, lineages: trailList, typedName: newTrailName });
    if (row) runTrailRow(row);
  }

  function runTrailRow(row) {
    // The one row that does not close the sheet: it changes the question
    // the sheet is asking. Closing and reopening would lose the typed name,
    // which is the thing being placed.
    if (row.kind === "nest") {
      trailNesting = true;
      return;
    }
    openSheet = null;
    trailNesting = false;
    if (row.kind === "create" || row.kind === "nest-target") {
      createTrail(row.name, row.parentId ?? null);
      return;
    }
    // A LIVING DOC, started here. The page is empty — the model only offers
    // this row then — so becoming the trail's canonical carries nothing in,
    // which is what makes a permanent choice safe to make from a sheet.
    if (row.kind === "create-continuous") {
      createTrail(row.name, row.parentId ?? null, "continuous");
      return;
    }
    // AND GOING TO ONE, which writes nothing. `assignTrail` below would
    // point this page at the trail; that is the move the sheet refuses for
    // a trail that already owns a document, and this is the other verb.
    if (row.kind === "open-doc") {
      openCanonical(row.pageId);
      return;
    }
    // THE TRAIL'S OWN SCREEN, from the page (trail-sheet-model.js "manage").
    // It reads the trail live from memory's list, which is empty until
    // memory has been opened once; this sheet's list is the same
    // getLineages answer, so it stands in rather than a fetch.
    if (row.kind === "manage") {
      if (!memoryLineages.some((l) => l?.id === row.lineageId)) memoryLineages = trailList;
      openTrailScreen(row.lineageId);
      return;
    }
    assignTrail(row.lineageId ?? null);
  }

  /** Discrete and top-level, and the model's header argues both. The
   *  created trail is assigned immediately: a writer who names a trail in
   *  this sheet has said which trail this page belongs on, and leaving
   *  them to tap it again in a list they have to re-open is a second
   *  gesture for a decision already made. */
  async function createTrail(name, parentId = null, mode = "discrete") {
    let lineage = null;
    try {
      // Discrete still, and the model's header argues that half. The parent
      // is new (2026-10-04): a trail started on the phone was always
      // top-level, and the device pass found no other way to nest one.
      lineage = await createLineage(name, mode, parentId);
    } catch (err) {
      console.error("shell: could not create that trail", err);
      return;
    }
    if (!live || !lineage?.id) return;
    trailList = [lineage, ...trailList];
    await assignTrail(lineage.id);
  }

  /** Open a continuous trail's living document. A NAVIGATION: it loads
   *  that page and writes nothing — no lineage is repointed, no row is
   *  deleted, and the page the writer was on is left exactly as it was.
   *
   *  Addressed by `pageAddress` like every other page load in this file,
   *  so a wrapper handed in by mistake throws rather than resolving to a
   *  lookup with three nulls in it. */
  async function openCanonical(pageId) {
    if (!pageId) return;
    try {
      const result = await getPage(...pageAddress({ id: pageId }));
      if (!live) return;
      if (result?.page) await adoptPage(result.page);
    } catch (err) {
      console.error("shell: could not open that trail's document", err);
    }
  }

  async function assignTrail(lineageId) {
    if (!page) return;
    // Read BEFORE the write, because `adoptPage` below replaces the row.
    // This is the whole condition on the carry-forward injection and
    // CLAUDE.md is exact about it: the pins come back on FIRST assignment,
    // and re-trailing a page between trails does not re-inject.
    const wasUntrailed = !page.lineage_id;
    const target = page;
    try {
      await setFocusLineage(target.id, lineageId);
    } catch (err) {
      console.error("shell: could not put the page on that trail", err);
      return;
    }
    if (!live) return;
    // The row this file holds, with the one field that changed. Not a
    // re-fetch: `setFocusLineage` writes exactly this column, and going
    // back for the row would cost a round trip to learn something already
    // known. adoptPage does the rest — it re-reads the lineage for the
    // name and the MODE, which is what PageScreen needs to tell EditorCore
    // which save route the page now takes.
    await adoptPage({ ...target, lineage_id: lineageId });
    if (lineageId && wasUntrailed) await carryForward(lineageId);
  }

  /** The context clause, made to happen (CLAUDE.md, Project Overview):
   *  choosing a trail for the first time brings every `auto_insert` pin on
   *  it and its ancestors onto the page itself. The desktop's version is
   *  `injectCarryForwardPins` (Page.svelte:676) and this is the same three
   *  steps — fetch, dedupe by id, append — against the same core method.
   *
   *  THE TOAST IS NOT DECORATION HERE. Blocks appearing in a document
   *  nobody typed them into is, with no sentence attached, indistinguishable
   *  from a bug — and the writer's first instinct would be to undo them,
   *  which is the one response that throws away the context they just
   *  asked for. It fires only on what actually landed: `appendNodesToDoc`
   *  skips a node whose shape the doc already holds, so its return value
   *  is the difference between "pins are on the page" being measured and
   *  being assumed. That return value did not exist before this task. */
  async function carryForward(lineageId) {
    let pins;
    try {
      pins = await getCarryForwardPins(lineageId);
    } catch (err) {
      console.error("shell: could not read the trail's carry-forward pins", err);
      return;
    }
    if (!live || !Array.isArray(pins) || pins.length === 0) return;

    // Dedupe by id before fanning out, exactly as the desktop does:
    // appendNodesToDoc dedupes by node shape as well, but building JSON
    // that is only going to be discarded is work for nothing.
    const seen = new Set();
    const unique = pins.filter((pin) => {
      if (!pin?.id || seen.has(pin.id)) return false;
      seen.add(pin.id);
      return true;
    });

    const nodes = buildCarryForwardNodes(unique);
    if (nodes.length === 0) return;
    const landed = core?.appendNodesToDoc?.(nodes) ?? 0;
    if (landed > 0) showToast(carryForwardMessage({ trailName: loadedTrailName }));
  }

  // ── find ────────────────────────────────────────────────────────────
  //
  // Is the find strip up. The whole of row 2's producer, and it is a mode
  // flag rather than a derivation because find is the one thing in the
  // slot the USER opens and the user closes: nothing about the editor's
  // state can answer whether they are still looking for something.
  let findOpen = $state(false);

  /** The header's `find`. Gated on an editor for the reason
   *  `openInsertSheet` is gated on `readonly` — an open handler that
   *  declines beats a mode that opens onto nothing. There is nothing to
   *  search until the canvas has mounted, and `findOpen` outranks every
   *  other row, so opening early would take the tab bar away and put a
   *  strip over a page that has not loaded.
   *
   *  NOT gated on `readonly`. Searching a page you cannot edit is exactly
   *  what a phone is for — the same reading that keeps `copy` on a closed
   *  page's block sheet — and find writes nothing to the document.
   *
   *  WHERE THE FOCUS GOES, and why this function does not send it there.
   *  It goes to the strip's own field: the mode is entered from the header
   *  with the keyboard DOWN (that is the point of the header), and a find
   *  mode you cannot type into is a mode with nothing in it. The field is
   *  a `Field`, never the editor — focusing the editor would raise the
   *  keyboard and then send every keystroke into the document instead of
   *  into the query, which is worse than no keyboard at all.
   *
   *  That field now exists (FindStrip), and the ordering never needed a
   *  seam: `Field` takes `autofocus` and routes it through focusField
   *  (focus-field.js), one rAF focus per element per open-cycle. The
   *  strip mounts when this flips, so the field focuses at mount and the
   *  keyboard comes up as a consequence of the strip existing — nothing
   *  registered from one task and called from another. FindStrip
   *  hardcodes the autofocus rather than taking it as a prop, because
   *  mounting it IS opening find; the test that catches it going away is
   *  "focuses the find field on open, which is the only thing that raises
   *  the keyboard". */
  function openFind() {
    if (!editor || editor.isDestroyed) return;
    findOpen = true;
    // NOTHING resets `findState` here, and that is a decision this task
    // made TWICE — the first version cleared it on the way in, and the
    // probe that should have proved the line necessary stayed green. Why:
    // closeFind's setFindQuery("") broadcasts an empty state, and the
    // listener below is still attached when it does, because an effect's
    // teardown runs on the next flush rather than the moment its
    // dependency flips. So the mode always reopens clean, by one
    // mechanism rather than two — and an `if it ever changed` reset was a
    // second answer to a condition that already has one, which is what
    // drifts. The ordering that makes it work is not obvious, so it is
    // held by a test rather than by this comment: "forgets the last
    // search's count when find is reopened" goes red if the teardown ever
    // wins the race, while the highlight test alongside it stays green.
  }

  /** Leaving find CLEARS THE QUERY, and that is not tidiness. The
   *  highlight decorations live in the extension's plugin state
   *  (find-replace.js), not in the strip, so they survive the strip going
   *  away: close find with "the" typed and every "the" on the page stays
   *  marked, on a writing surface with no bar left to clear them from.
   *  The desktop bar does the same on unmount and for the same reason
   *  (FindBar.svelte:53).
   *
   *  Takes the editor from `press`, like every other COMMANDS entry, so
   *  the strip's contract — no editor, no press — is the only guard it
   *  needs.
   *
   *  It clears the STRIP's state too, though nothing here says so: the
   *  command dispatches a transaction, the transaction broadcasts, and
   *  the listener below is still subscribed at that instant — see
   *  openFind for why that ordering holds and which test holds it. So the
   *  order of these two lines is load-bearing in one direction only: flip
   *  them and it still works, drop the clear and the strip reopens
   *  reporting a search whose highlights are also still on the page. */
  function closeFind(ed) {
    findOpen = false;
    ed.commands.setFindQuery("");
  }

  /** What the field types into. The extension owns matching entirely —
   *  this hands it the raw string and reads the answer back off the
   *  broadcast below, which is the same loop FindBar.svelte:76-79 runs.
   *
   *  Not trimmed, and not debounced. Not trimmed because collectMatches
   *  (find-replace.js:28-45) searches the raw string, so a leading space
   *  is a real search someone can mean; not debounced because the
   *  extension's own apply() is a single doc walk per keystroke and the
   *  desktop has run it undebounced since B.5. */
  function runFindQuery(value) {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setFindQuery(value);
  }

  /** The last `shizumu:find-state` the extension broadcast, verbatim, or
   *  null before the first one. `findStripModel` turns it into the label
   *  and the dead ids.
   *
   *  A GLOBAL BROADCAST, not a subscription to this editor. The extension
   *  dispatches on `window` (find-replace.js:59-67) because FindReplaceKey
   *  is module-private and there is no other way out of the plugin. That
   *  is safe HERE only because the shell mounts no FindBar and exactly one
   *  EditorCore: a host that mounted both would put two listeners on one
   *  event, and a host with two editors would feed this strip whichever
   *  one moved last. Neither exists on this branch, and the day one does,
   *  the event needs a source on its detail — not a second listener. */
  let findState = $state(null);

  /** Subscribed only while find is up. The extension broadcasts on EVERY
   *  editor update (find-replace.js's view.update), not only on find
   *  transactions, so an always-on listener would write component state on
   *  every keystroke in the document and re-render the whole shell for a
   *  strip that is not on screen.
   *
   *  What that costs: the initial broadcast (find-replace.js:121-124) fires
   *  at editor mount, long before this subscribes, so the first frame of
   *  the mode has no state at all. `findStripModel` falls to the untyped
   *  case there, which is correct — `closeFind` clears the query on the way
   *  out and the plugin starts empty, so an unsubscribed gap is a gap in
   *  which the query is genuinely "". */
  $effect(() => {
    if (!findOpen) return;
    const read = (event) => {
      findState = event.detail ?? null;
    };
    window.addEventListener("shizumu:find-state", read);
    return () => window.removeEventListener("shizumu:find-state", read);
  });

  const findModel = $derived(findStripModel(findState ?? {}));

  // ── the suggestion strip ────────────────────────────────────────────
  //
  // The chips for whatever trigger is live, or none. Derived off
  // `snapshot`, which is the only thing here that announces a change: the
  // slash plugin's state is read by `computeSnapshot` on every transaction
  // and arrives as `snapshot.query`, so the chips re-resolve on the
  // keystroke that changed them and vanish on the one that closed the
  // trigger. Reading the plugin key directly instead would compute once
  // and never move.
  // ── `@` on the phone ────────────────────────────────────────────────
  //
  // The desktop's floating `@` menu, laid flat into the same strip `/`
  // uses. What `@` finds is `mentionItems`, the function the desktop menu
  // calls (mention-command.js), read with the editor's own mention options
  // so the current trail and the "new trail" callback are the desktop's
  // too; mention-chips.js only turns the answer into chips. The answer is
  // async, so each query gets a token and a late answer for an older query
  // is dropped rather than shown under a newer one.
  let mentionChipList = $state([]);
  let mentionToken = 0;
  $effect(() => {
    const q = snapshot?.query;
    if (!q || q.kind !== "mention" || !editor || editor.isDestroyed) {
      mentionToken += 1;
      if (mentionChipList.length) mentionChipList = [];
      return;
    }
    const my = ++mentionToken;
    const opts = mentionOptionsOf(editor);
    const timer = setTimeout(() => {
      mentionItems({
        query: q.text,
        currentLineage: opts?.getCurrentLineage?.() || null,
        onCreate: opts?.onCreate ?? null,
      })
        .then((items) => {
          if (live && my === mentionToken) mentionChipList = mentionChips(items);
        })
        .catch((err) => console.error("shell: the @ search failed", err));
    }, 120);
    return () => clearTimeout(timer);
  });
  const mentionLabels = $derived(Object.fromEntries(mentionChipList.map((c) => [c.id, c.label])));

  const suggestions = $derived(
    snapshot?.query?.kind === "mention" ? mentionChipList.map((c) => c.id) : suggestionChips(snapshot?.query),
  );

  /** The `/query` range a chip has to consume, read off the live plugin
   *  state at tap time — the same place, and the same moment, the
   *  desktop's own `suggestion.command` gets its `range`.
   *
   *  THIS USED TO BE A LATCH, written on every snapshot and read back
   *  inside the tap, and the reason it is not one any more is the whole
   *  point of P2c's chrome seam. The desktop's floating slash menu was
   *  mounted in the shell too, and it dismissed itself on any pointerdown
   *  outside its own element — `document.addEventListener("pointerdown",
   *  …, true)`, in CAPTURE phase, on the document (slash-commands.js). A
   *  chip is outside that element, so a chip tap ran the menu's dismissal
   *  FIRST and `exitSuggestion` had zeroed `range` and `query` before the
   *  chip's own handler was reached: `/head` stayed sitting inside the
   *  heading it had just made.
   *
   *  PageScreen now passes `floatingChrome={false}`, which gives both
   *  suggestion extensions `floatingMenu: false` — their `render` becomes
   *  silentSuggestionRender, which draws no DOM and therefore attaches no
   *  document listener, while the plugin underneath keeps `active`,
   *  `range` and `query` exactly as before. There is no longer anything
   *  between the pointerdown and this read that could close the session.
   *
   *  Proven rather than assumed, because a latch removed on a wrong
   *  diagnosis fails only on a device: the latch was deleted first and
   *  "consumes the typed trigger the chip acted on" was run against the
   *  tap-time read — the test that reddened for exactly this bug, and
   *  which asserts the document holds no `/` afterwards. It stayed green,
   *  and it goes red again the moment a floating menu comes back to this
   *  editor. "inserts the block a chip names, on a fresh line below the
   *  writing" is the second guard, because a leftover "/outline" makes the
   *  line look written to needsFreshLine.
   *
   *  A plain function and not `$derived`: it must answer for the editor
   *  state as it is when the thumb lands, not for a value memoised on the
   *  last transaction. */
  function slashTrigger() {
    if (!editor || editor.isDestroyed) return null;
    const state = SlashCommandsPluginKey.getState(editor.state);
    return state?.active ? state.range : null;
  }

  /** Tapping a chip runs its command and takes the typed trigger with it.
   *
   *  No `readonly` gate, and none is needed: every chip writes to the
   *  document, but a closed page's editor is not editable, so there is no
   *  `/` to have typed and no trigger to be live. The strip cannot appear
   *  there at all — which is a stronger guard than a check here, and the
   *  reason `insert` needs one where this does not (its `+` sits on the
   *  block strip, which a closed page shows). */
  function pickSuggestion(title) {
    if (!editor || editor.isDestroyed) return;
    // A mention chip: committed by the desktop menu's own commit, over the
    // live `@query` range the extension holds.
    if (snapshot?.query?.kind === "mention") {
      const chip = mentionChipList.find((c) => c.id === title);
      const range = MentionCommandPluginKey.getState(editor.state)?.range;
      if (chip && range) commitMention(editor, range, chip.item);
      return;
    }
    // The two titles the shell answers with a builder (BUILDER_SHEETS says
    // what each of them was doing here before). The trigger is consumed
    // and NOTHING ELSE is written: no `insertionPoint`, so no fresh line
    // to leave behind if the writer backs out of the builder.
    //
    // The trigger goes at tap time rather than at commit time, which is
    // the one thing a writer loses by backing out — the `/chart` they
    // typed does not come back. That is deliberate on two counts: it is
    // what every other chip does (a typed query is menu input, not
    // writing), and it is what the DESKTOP does with the same keystroke —
    // `prepareInsertionPoint` deletes the range before the chart command
    // runs, so cancelling its modal leaves the trigger gone there too. The
    // alternative, holding the range across an open sheet, would buy a
    // stored position for the only thing on this path that is not already
    // frozen.
    const openBuilder = BUILDER_SHEETS.get(title);
    if (openBuilder) {
      const trigger = slashTrigger();
      if (trigger) editor.chain().focus().deleteRange(trigger).run();
      openBuilder();
      return;
    }
    runSlashInsert(editor, title, slashTrigger());
  }

  // HAS A SOFT KEYBOARD EVER SHOWN UP THIS SESSION. A latch, not a level, and
  // the difference is the whole point: `keyboardOpen` false means "not up
  // right now", which on a Bluetooth keyboard, DeX or a Chromebook means "and
  // it never will be". toolbarFor's editing row needs to tell those apart —
  // see the comment there — so it is told once and never un-told.
  //
  // $effect rather than a derived: this is state that outlives its input.
  let imeSeen = $state(false);
  $effect(() => {
    if (keyboardOpen) imeSeen = true;
  });

  const toolbar = $derived(
    toolbarFor({
      editing,
      keyboardOpen,
      imeSeen,
      selectionEmpty: snapshot?.selectionEmpty,
      activeBlock: snapshot?.activeBlock,
      inListItem: snapshot?.inListItem,
      // Row 4's producer at last, and the reason it could not be turned on
      // before now is that row 4 emitted an empty button list: passing the
      // live query blanked the slot for as long as a trigger was open, on
      // `/`, which is the most common keystroke in the editor. The row
      // takes `suggestions` now and declines the slot when it has nothing
      // to put in it (toolbar-model.js), so the query is safe to pass.
      //
      // A MENTION QUERY gets chips too since 2026-10-29: the pages, pins
      // and "new trail" rows `@` finds, from the same `mentionItems` the
      // desktop menu calls (mention-chips.js; the `@` block above). The
      // old answer, falling through to the block strip, left the phone no
      // way to mention anything. A query with nothing found still falls
      // through rather than blanking the slot.
      query: snapshot?.query ?? null,
      suggestions,
      findOpen,
      // Row 1's other input, and the last hardcoded false in this call.
      // A pushed screen owns the display the way an open sheet does: §2's
      // band diagram gives the bottom slot to "nothing" on a pushed
      // screen, so the frame stops reserving it rather than reserving an
      // empty band. Proven the way `sheetOpen` was — force it back to
      // false with pins pushed and "empties the slot behind a pushed
      // screen" is the test that goes red.
      pushedScreen: pushed.length > 0,
      // Row 1's producer, and the reason it existed unreachable for a
      // phase. An open sheet owns the bottom of the display outright, so
      // the slot does not merely empty — it is the one row besides a gate
      // that answers `nav: false` too, so the frame stops reserving the
      // band rather than leaving a nav row peeking from under the sheet.
      sheetOpen: openSheet !== null,
      // The row memory needed. Its search field is the first field in the
      // shell outside the editor, so `keyboardOpen` stopped meaning "the
      // writer is editing" — see toolbar-model.js's `space`.
      space: active,
    }),
  );

  const activeIds = $derived.by(() => {
    // Reading `snapshot` is what subscribes this to the editor: the marks
    // themselves are pulled off a plain object that never announces a
    // change, so without a reactive read here the strip would light the
    // marks that were on at the first paint and never move again.
    //
    // Checked by dropping the `!snapshot` term from this guard, which is
    // the whole of the reactive read — "runs the command on the editor
    // when a strip button is tapped" goes red on the aria-pressed half,
    // 1 failed / 23 passed. The command still runs; only the strip stops
    // reporting it, which is exactly the silent half.
    if (!snapshot || !editor || editor.isDestroyed) return [];
    const marks = {};
    for (const id in MARK_ACTIVE) marks[id] = MARK_ACTIVE[id](editor);
    return activeIdsFor(marks);
  });

  // TWO LISTS, NOT ONE, since the visual pass. toolbar-state.js's header
  // draws the line: `unavailableIds` is "cannot apply to this block or
  // page" and those controls are ABSENT; `disabledIds` is "could apply,
  // not right now" and those stay, dead. `stripPresence` folds the two
  // into what the strip renders. Every entry below says which side of the
  // line it is on and why; an entry that moves sides is a design change,
  // not a tidy-up.
  const unavailableIds = $derived([
    ...new Set([
      // Every id on the strip that this file cannot run. Derived from the
      // command table, never listed, so the day a command lands its button
      // appears with it. Today that is `link` alone, on the selection
      // strip: it wants somewhere to type a URL and the shell has nowhere,
      // and no caret position changes that, which is what makes it
      // unavailable rather than disabled.
      //
      // `field` is exempt because it is the one id on any strip that is
      // not a button: it is typed into, so it has no COMMANDS entry BY
      // CONSTRUCTION and this derivation would otherwise take the find
      // field off the find strip.
      //
      // The chip strip is exempt WHOLE, for the same reason `field` is
      // exempt singly: its ids are slash-command titles, not strip button
      // ids, so every one of them fails the COMMANDS lookup and the
      // derivation would empty the entire strip. It cannot HAVE an
      // unavailable chip — the list and the command table are the same
      // list (suggestion-strip-model.js). SuggestionStrip renders from
      // `toolbar.buttons` directly, so this changes nothing on screen; it
      // is here so the two producers of "which controls exist" agree.
      ...(toolbar.strip === "suggestion-strip"
        ? []
        : toolbar.buttons.filter((id) => id !== "field" && !COMMANDS[id])),
      // `type` has a command, so the derivation above stops covering it —
      // and it is there only when the block has somewhere to go. Since the
      // visual pass a paragraph has two places (turn-into-model.js), so
      // the button is present beside nearly every block; a heading, a
      // table, a chart have none, and beside those it is absent rather
      // than dead because nothing typed into the block changes the
      // answer. Same call as the sheet's row: one gate, two surfaces.
      ...(liveTurnIntoRows.length === 0 ? ["type"] : []),

      // `insert` has a command too, and its gate is the page rather than
      // the block: every row the sheet offers writes to the doc, so on a
      // closed page the sheet would open with nothing in it. Unavailable
      // rather than disabled because the page is closed for good — the
      // writer's way to a live `+` is a different page, not a different
      // moment on this one.
      ...(readonly ? ["insert"] : []),

      // `pin` has a command from P2f Task 1 and needs its own gate: a pin
      // is a permanent artifact, and the empty paragraph the caret sits in
      // half the time would write a row with no title, no snippet and no
      // content. pinIntent answers null there, and on a block that is
      // ALREADY kept, and this is the same call the command makes. Both
      // are facts about the block rather than the moment — nothing the
      // writer does on an empty line short of writing on it, and nothing
      // on a kept block short of unpinning it, changes the answer — so
      // both are absence. The block sheet already dropped its `pin` row on
      // the same answer; the two surfaces now match in shape.
      //
      // WHAT THIS COSTS, recorded for the device pass (the plan's gate
      // names it): a control that leaves as the caret enters an empty
      // paragraph, and leaves under the thumb after a successful press,
      // moves its neighbours, and `undo` is the one to its right — so a
      // second tap where `pin` was can land on `undo` and take the stamp
      // back. Whether that reads as a shift on a phone is not a thing
      // jsdom can see.
      //
      // NOT gated on `readonly`, unlike `insert` above, and the difference
      // is real rather than an omission: a past page's block is still
      // pinnable — the desktop's own reasoning, already written down at
      // READONLY_ROWS. Pinning from a closed page does dispatch a stamp
      // and a save into it, which is what the desktop does too.
      ...(livePinIntent ? [] : ["pin"]),

    ]),
  ]);

  const disabledIds = $derived([
    ...new Set([
      // `undo` with nothing to undo, and `pin-selection` on an empty
      // range. Both could apply a keystroke from now: the first edit
      // lights `undo` where it stands, and the selection strip is only on
      // screen while a range exists, so a dead `pin-selection` there is a
      // stale snapshot's one frame, not a state the writer sits in.
      ...disabledIdsFor(snapshot),

      // Find's own two. They come from findStripModel rather than from a
      // count read here, because the label beside them is the same
      // decision: `total === 0` is exactly when the strip says "no
      // matches" and exactly when the arrows have nothing to step
      // between, and two homes for one condition drift. Disabled, not
      // unavailable: the next character typed can give them a match.
      ...(findOpen ? findModel.disabledIds : []),
      // disabledIdsFor already disables this one on an empty selection,
      // and the Set dedupes. What this adds is the non-empty selection
      // that still holds nothing to pin: a node selection on a divider,
      // which puts the strip on screen with a live-looking button over a
      // block that has no content in text, attrs or anywhere else. On the
      // dead side of the line rather than `pin`'s absent side, and the
      // asymmetry is deliberate: a selection is the writer's OWN act, made
      // a moment ago and about to change, and a strip whose members come
      // and go as a drag handle moves across a divider is the shift the
      // gate above worries about at its worst. `pin` answers for a block
      // the caret merely sits in; this answers for a range being drawn.
      ...(liveSelectionPinIntent || liveSelectionPinRefusal ? [] : ["pin-selection"]),
    ]),
  ]);

  // What the strip actually draws: the model's order, minus the
  // unavailable, with the disabled reported against what is left.
  const presence = $derived(
    stripPresence({ buttons: toolbar.buttons, unavailable: unavailableIds, disabled: disabledIds }),
  );

  function press(id) {
    const run = COMMANDS[id];
    // No handler, no editor, or an editor the canvas already tore down.
    // The first case cannot reach here — an id with no command is not on
    // the strip at all (unavailableIds) — and it is checked anyway because
    // the two guards protect different things: that one is the strip's
    // contract, this one is what happens if it is ever broken.
    if (!run || !editor || editor.isDestroyed) return;
    run(editor);
  }
</script>

<!--
  THE ROOT'S SCREEN IS A STACK ENTRY, not a child of the frame. Both live
  screens render into one grid cell inside `.shell-stack`, which is what
  lets a back drag reveal the screen underneath instead of a hole — and
  Stack keeps exactly the top two alive, so a deep stack is not ten
  editors.

  Every entry is rebuilt on every render and that is the shape Stack's
  header asks for: its registration effect is idempotent by construction,
  so the same ids push and close nothing. The root entry's id carries
  `active` so a root switch replaces the base screen rather than reusing
  its DOM — an unkeyed swap would hand memory the page's scroll offset and
  field state, which reads as the app remembering something it should not.

  onGesture is passed now, and the reason it was withheld for six phases —
  that the root's down() called setPointerCapture on `.shell-root` for
  every pointerdown, retargeting dispatch away from every descendant
  listening for the rest of its own stroke — is gone rather than accepted:
  the capture was removed, because a frame that IS the viewport gains
  nothing from capturing a pointer that cannot leave it. ShellRoot's down()
  carries the argument and the cost.
-->
<!--
  Declared at the top level rather than inside `<ShellRoot>`: a snippet
  written as a direct child of a component is passed to that component as
  a prop, and these two are neither ShellRoot's business nor its props —
  they are the views Stack renders. Out here they are plain declarations
  in the component's scope, which is what `{#snippet dotRow()}` is in
  PageHeader.
-->
{#snippet rootView()}
  {#if active === "page"}
    <PageScreen
      todayDateStr={clockDay}
      {todayPageId}
      dateLabel={dateLabel ?? model.dateLabel}
      trailName={trailName ?? model.trailName}
      trailParents={loadedTrailParents}
      pageCount={pageCount ?? model.pageCount}
      pageNumber={pageNumber ?? model.pageNumber}
      whatMattersNow={whatMattersNow ?? page?.what_matters_now ?? ""}
      pinCount={trailPinCount}
      onFocusLine={commitFocusLine}
      toast={toastMessage}
      trailMode={loadedTrailMode}
      {page}
      {keyboardOpen}
      stripRow={toolbar.strip !== "none"}
      onDate={openDateSheet}
      onFind={openFind}
      onPins={openPins}
      onPages={openPagesSheet}
      onNew={newPage}
      onTrail={page && !readonly && loadedTrailMode !== "continuous" ? openTrailSheet : null}
      onEditor={takeEditor}
      onCore={takeCore}
      onSnapshot={takeSnapshot}
      onBlockHandle={openBlockSheet}
      onChartOpen={openChartSheet}
      onDragActive={takeDragActive}
      onScrollEdges={takeScrollEdges}
    />
  {:else if active === "memory"}
    <MemoryScreen
      pages={memoryPageList}
      pins={memoryPinList}
      lineages={memoryLineages}
      loading={memoryLoading}
      todayStr={clockDay}
      query={memoryQuery}
      matchingIds={memoryMatchingIds}
      dateFilter={memoryDateFilter}
      sort={memorySort}
      pinned={memoryPinned}
      trailScopeId={memoryTrail}
      onSearch={searchMemory}
      onFilters={openMemoryFilters}
      onTrails={openTrails}
      onScrollEdges={takeScrollEdges}
      onPage={openReading}
      onPin={openPinArtifact}
      onRemoveFilter={(id) => applyMemoryPatch(removeMemoryFilter(id))}
      onShowEverything={() => applyMemoryPatch(showEverythingPatch())}
    />
  {:else if active === "settings"}
    <SettingsScreen groups={settingsRootGroups} onOpen={openSettingsRow} />
  {:else}
    <!-- No root reaches this branch any more: ROOTS is frozen at three and
         all three are above. It stays because the {#if} needs a final
         answer, and a visible name is a better one than a blank band — the
         shell ships behind `try the new shell`, and an empty content band
         is indistinguishable from a root that broke. -->
    <div class="shell-app-stub">
      <p class="shell-app-stub-text">{active}: not built yet</p>
    </div>
  {/if}
{/snippet}

{#snippet pinsView()}
  <PinsScreen
    pins={pinList}
    allPins={pinAllList}
    allCount={pinAllCount}
    loading={pinsLoading}
    lineageId={pinsLineage}
    pageId={page?.id ?? null}
    lineages={pinsLineages}
    canPutOnPage={!!page && !readonly && (page?.lineage_id || null) === pinsLineage}
    onBack={popScreen}
    onPin={openPinArtifact}
    onPutOnPage={putPinOnPage}
    onMore={openPinMore}
    onChooseTrail={page && !readonly && loadedTrailMode !== "continuous" ? chooseTrailFromPins : null}
    onNeedAllPins={loadAllPins}
  />
{/snippet}

{#snippet pinArtifactView()}
  <!-- Its own kind and its own snippet, the route `reading`, `trails` and
       `pins` already take. It can be pushed from either list that renders
       pins — the page's pins screen and memory's pins mode — and from
       either it is the same push, because both send their row through
       `openPinArtifact`. -->
  <!-- Both reference dates, from one clock read apiece — the reading
       view's shape, for the same reason (memory-model.js's `yesterdayOf`).
       They govern the provenance line's `kept today`, and in the VR
       harness the clock is the fixture's, so the photograph's date is
       the fixture's too. -->
  <PinArtifactScreen
    pin={artifactPin}
    trailName={artifactTrailName}
    trailValue={artifactTrailValue}
    todayStr={clockDay}
    yesterdayStr={yesterdayOf(clockDay)}
    onBack={popScreen}
    onRow={runArtifactRow}
    onDraft={takeArtifactDraft}
  />
{/snippet}

{#snippet trailView()}
  <!-- Task 9e: a trail's screen, pushed from memory's trails sheet. -->
  <TrailScreen
    lineage={managedTrail}
    lineages={memoryLineages}
    error={trailError}
    onBack={popScreen}
    onRename={renameTrail}
    onDraft={takeTrailDraft}
    onRow={runTrailScreenRow}
  />
{/snippet}

{#snippet readingView()}
  <!-- Both reference dates, from one clock read apiece. `yesterdayOf`
       derives the second from the first rather than letting dayLabel
       default it — memory-model.js's header records the day a screen
       handed one reference date labelled the wrong row "yesterday". -->
  <ReadingScreen
    page={readingPage}
    trailName={readingTrailName}
    trailMode={readingTrailMode}
    loading={readingLoading}
    todayStr={clockDay}
    {todayPageId}
    yesterdayStr={yesterdayOf(clockDay)}
    onBack={popScreen}
    onRow={runReadingRow}
  />
{/snippet}

{#snippet settingsSectionView()}
  <!-- One snippet for every section, because the screen renders row KINDS
       rather than settings by name. A snippet per section would be the
       only alternative — Stack calls `entry.view()` with no arguments — and
       it would cost a `kind` per section in the chain below. -->
  <SettingsSectionScreen
    section={settingsSectionModel}
    onBack={popScreen}
    onChoose={chooseSetting}
    onToggle={toggleSetting}
    onAction={actOnSetting}
  />
{/snippet}

<!-- The sync stack's four screens. FOUR SNIPPETS, one per kind, which is
     what a stack deeper than two costs when its levels are different
     screens: nothing. Settings needed a single snippet and a host variable
     because its four sections are one component; these four are four
     components, so they take the same route `reading`, `trails` and `pins`
     already take. Setup and pair are siblings at depth 3, both pushed
     from the devices screen. -->
{#snippet lockSettingsView()}
  <LockSettingsScreen
    on={lockOn}
    timeout={lockTimeout}
    busy={lockBusy}
    error={lockError}
    onBack={popScreen}
    onSubmit={submitLock}
    onTimeout={chooseLockTimeout}
    onFormChange={() => (lockError = null)}
  />
{/snippet}

{#snippet syncDevicesView()}
  <SyncDevicesScreen
    status={syncState}
    devices={syncDevices}
    loading={syncDevicesLoading}
    nowMs={Date.now()}
    {pairPhase}
    onBack={popScreen}
    onPair={openPair}
    onSetup={openSetup}
    onEnabled={setSyncEnabled}
    onDisconnect={() => {
      openSheet = "sync-disconnect";
    }}
  />
{/snippet}

{#snippet syncSetupView()}
  <SyncSetupScreen
    step={setupStep}
    mode={setupMode}
    phrase={setupPhrase}
    typed={setupTyped}
    relayChoice={setupRelayChoice}
    relayUrl={setupRelayUrl}
    label={setupLabel}
    working={setupWorking}
    error={setupError}
    status={syncState}
    onBack={popScreen}
    onMode={chooseSetupMode}
    onTyped={(next) => (setupTyped = next)}
    onCopy={copySetupPhrase}
    onNext={setupNextStep}
    onChangePhrase={setupBackToPhrase}
    onRelayChoice={chooseSetupRelay}
    onRelayUrl={(next) => (setupRelayUrl = next)}
    onLabel={(next) => (setupLabel = next)}
    onConnect={connectSetup}
    onEnable={enableSetup}
    onLater={popScreen}
  />
{/snippet}

{#snippet syncPairView()}
  <SyncPairScreen
    side={pairPhase === "done" && pairedSide ? pairedSide : pairSide(syncState)}
    phase={pairPhase}
    words={pairWords}
    qr={pairQr}
    sas={pairSas}
    error={pairError}
    label={pairLabel}
    onBack={popScreen}
    onScan={openScanner}
    onLabel={(next) => (pairLabel = next)}
    onConfirm={confirmPair}
    doneDevice={pairLabel}
    doneEnabled={!!syncState?.enabled}
    onDone={popScreen}
  />
{/snippet}

{#snippet syncScanView()}
  <SyncScanScreen onBack={popScreen} onRead={readCode} />
{/snippet}


<ShellRoot
  hasStrip={toolbar.strip !== "none"}
  hasNav={toolbar.nav}
  {dragActive}
  {editing}
  {atScrollTop}
  {atScrollBottom}
  space={active}
  edgeBackArmed={platform.edgeBackArmed}
  onGesture={routeGesture}
>
  <Stack
    entries={[
      { id: `root:${active}`, view: rootView },
      // The kind decides the view, through a table built HERE rather than
      // in the script: a map in the script cannot name snippets the markup
      // declares, and a top-level `{@const}` is not legal Svelte — but a
      // literal inside this expression is in the same scope the snippets
      // are, so it can. It was a ternary chain until P4 Task 2 took the
      // stack from four kinds to seven, at which point the chain was six
      // levels of nesting saying one thing. Eight since sync setup.
      //
      // An unknown kind still lands as `undefined`, and Stack's
      // `{@render entry.view()}` throws on it — the right failure, because
      // a push with no screen behind it must not render some other kind
      // wearing the wrong title.
      ...pushed.map((screen) => ({
        id: screen.id,
        view: {
          reading: readingView,
          pins: pinsView,
          "pin-artifact": pinArtifactView,
          trail: trailView,
          settings: settingsSectionView,
          lock: lockSettingsView,
          sync: syncDevicesView,
          "sync-pair": syncPairView,
          "sync-scan": syncScanView,
          "sync-setup": syncSetupView,
        }[screen.kind],
      })),
    ]}
    {dragActive}
    edgeBackArmed={platform.edgeBackArmed}
    onPop={popScreen}
  />

  {#snippet nav()}
    <!-- Through goRoot, not a bare assignment: a root switch also drops
         the page's push stack, and one door onto that rule is the
         point of having it.

         ITS OWN SNIPPET now, not a branch of the strip chain. Navigation
         used to be one of the things that could win the slot, and on a
         Galaxy A34 whose webview froze its viewport numbers at the
         keyboard-up height it lost that contest for the whole session —
         no tab bar, no way off the page, until the app was restarted.
         The band has two rows and this is the lower one; nothing about a
         keyboard decides whether it is drawn. -->
    <TabBar tabs={ROOTS} {active} onSelect={goRoot} />
  {/snippet}

  {#snippet slot()}
    {#if toolbar.strip === "find-strip"}
      <!--
        Its own renderer, not ToolbarStrip with a `field` branch — FindStrip's
        header argues it. It still takes `buttons` from toolbarFor, so the
        strip's composition and order stay in toolbar-model.js, and it still
        routes presses through `press`, so the arrows reach the editor by the
        same path every other strip button does.
      -->
      <FindStrip
        buttons={presence.shown}
        label={findModel.label}
        disabledIds={presence.disabled}
        onQuery={runFindQuery}
        onPress={press}
      />
    {:else if toolbar.strip === "suggestion-strip"}
      <!--
        Its own renderer too, and not through `press`: a chip's id is a
        slash-command title rather than a strip button id, so COMMANDS has
        no entry for it and never should. `pickSuggestion` is the route
        instead, and it ends in the same `runSlashInsert` the insert sheet
        uses — one implementation of "run a slash command", reached from
        two surfaces.
      -->
      <SuggestionStrip chips={toolbar.buttons} labels={mentionLabels} onPick={pickSuggestion} />
    {:else if toolbar.strip !== "none"}
      <!--
        TESTED EXPLICITLY rather than left as the else: "none" used to fall
        through to the tab bar, and with that arm gone a bare `{:else}`
        would hand an empty strip the editor's six controls. `hasStrip`
        already stops the wrapper rendering, but a chain that is only
        correct because of a boolean in its parent breaks on the next edit.

        `presence.shown`, not `toolbar.buttons`: the model decides the order
        and the host decides who is there. What cannot apply to this block
        or page is not drawn (unavailableIds); what could but cannot right
        now is drawn dead (disabledIds).
      -->
      <ToolbarStrip
        buttons={presence.shown}
        {activeIds}
        disabledIds={presence.disabled}
        onPress={press}
      />
    {/if}
  {/snippet}
</ShellRoot>

<!--
  The sheets are siblings of the frame, not children of it. Sheet is the
  one surface in the shell that leaves the flow, so where it sits in the
  tree decides nothing about where it renders — but nesting it inside the
  content band would say it belongs to the page, and it does not: it owns
  the bottom of the display while it is up, which is exactly what row 1 of
  toolbarFor says by taking the slot away.

  ONE INSTANCE PER TAG rather than one instance whose `tag` changes — the
  count has grown every phase, so it is stated as a rule rather than as a
  number that goes stale. This one is read off Sheet's source rather than
  proven by a test here. Its claim effect
  compares the tag it is opening against the module-scope tag showing
  (Sheet.svelte, the `nextSheet` effect): on one instance, switching tags
  makes `hideShowing` that same instance's own dismissSelf, so it would
  dismiss and re-show ITSELF — an onDismiss the host never asked for, a
  second navstack push, and the content teardown Sheet's header warns a
  re-show costs. Two instances hand the claim over instead. See
  dismissedSheet below for what actually happens on the handoff, which is
  not what the obvious reading predicts.

  EVERY SHEET'S ROWS SIT IN A FLUSH RowGroup, and each row says what kind
  it is. A Row draws no line of its own any more (Row's header): the line
  between rows is the group's, so a sheet that listed bare Rows would show
  them unruled. `flush` because the sheet is already a surface — a group
  that drew its own inside one would be a card on a card. The kind is the
  chevron rule made explicit (row-kind.js): `choice` for a row that
  selects and pops, `action` for one that does something and stays,
  `push` for the one row in these sheets that opens a screen, and the
  chevron is drawn for the push alone.

  The block sheet's rows are choices: `runBlockRow` sets `openSheet =
  null` before it runs anything, so every one of them pops, including
  `turn into`, which then opens its own sheet in the same turn. `delete`
  is the exception, destructive, and last for the reason the pin sheet
  keeps `unpin` last.
-->
<Sheet
  open={openSheet === "block-actions"}
  tag="block-actions"
  detent="half"
  onDismiss={() => dismissedSheet("block-actions")}
>
  <RowGroup flush>
    {#each sheetRows as row (row.id)}
      <Row
        label={row.label}
        kind={row.id === "delete" ? "destructive" : "choice"}
        destructive={row.id === "delete"}
        keepFocus={true}
        onSelect={() => runBlockRow(row.id)}
      />
    {/each}
  </RowGroup>
</Sheet>

<Sheet
  open={openSheet === "block-convert"}
  tag="block-convert"
  detent="half"
  onDismiss={() => dismissedSheet("block-convert")}
>
  <RowGroup flush>
    {#each convertRows as row (row.id)}
      <Row label={row.label} kind="choice" keepFocus={true} onSelect={() => runConvert(row.id)} />
    {/each}
  </RowGroup>
</Sheet>

<!--
  Half detent, as §3 asks — and this is the sheet the detent was specified
  for. Nothing is withheld from it any more: every row §3 names has an
  action behind it since P2f-2 Task 5 gave `chart` its builder, so the
  absent-not-dead rule has nothing left to hide here.

  The sentence that used to sit here counted the rows, and it was wrong
  three times running by being remembered rather than counted — seven after
  `image` and `file` joined in Task 1, nine after `table` joined in Task 4,
  ten after `chart` joined in Task 5. There is no number in it now. Count
  INSERT_ROWS.
-->
<!--
  FULL DETENT since the second device pass, which is a change to §3's
  half and is argued rather than slipped in. Half was specified for a
  list of rows and the list outgrew it (the counting note above); with
  the finder field on top, half shows three rows under the keyboard on a
  360px phone, and the point of the field is to make the row the writer
  wants VISIBLE, not merely present in a scroll. With the keyboard up,
  full is the height that is left, so a detent bought for room costs the
  page nothing it still had.
-->
<Sheet
  open={openSheet === "insert"}
  tag="insert"
  detent="full"
  onDismiss={() => dismissedSheet("insert")}
>
  <Field
    label="find a block"
    placeholder="find a block"
    bind:value={insertQuery}
    onSubmit={runFirstInsertRow}
  />
  {#if insertSections.length > 0}
    <!-- One group per section, with the section as its eyebrow — the
         slash menu's own grouping, which is also what keeps a list of
         twenty rows readable: the eyebrow says where the thumb is. -->
    {#each insertSections as group (group.section)}
      <RowGroup flush eyebrow={group.section}>
        {#each group.rows as row (row.id)}
          <Row
            label={row.label}
            value={row.value}
            kind="choice"
            keepFocus={true}
            onSelect={() => runInsertRow(row)}
          />
        {/each}
      </RowGroup>
    {/each}
  {:else}
    <!-- A query no row's name contains. A sentence rather than an empty
         group: an empty group is a blank band, and a blank band under a
         field reads as the sheet having broken rather than as the query
         having missed. -->
    <Note>no block by that name.</Note>
  {/if}
</Sheet>

<!--
  FULL DETENT, because §3 says the table builder lives at one, and because
  a 6×6 grid of 44px-floored cells plus a readout and a commit row does not
  fit in half a screen. It replaces the insert sheet rather than sitting
  over it, and it is DECLARED BELOW that sheet for the reason dismissedSheet
  records: Svelte runs the claim effects in declaration order, so the insert
  sheet releases the module claim before this one asks for it and nextSheet
  reports no dismissal at all. Declared above it the handoff would instead
  take dismissedSheet's guard, which works — but only because that guard
  exists. "swaps the insert sheet for the size grid" is the test that sees
  the handoff either way round.

  THERE IS NO "BACK" ROW, and the desktop has one ("‹ table"). The desktop
  needs it because its grid REPLACES the item list inside one popover, so
  without a way back the writer would have to retype `/table` to see the
  menu again. Here the grid is its own sheet with three ways out that cost
  nothing — the drag, Android back, Esc — and `+` reopens the insert sheet
  in one tap. A row that navigated backwards would also be the only one in
  the shell, and it would make this sheet's rows mean two different kinds
  of thing.

  BACKING OUT WRITES NOTHING. Not a property of the dismissal, a property
  of the commit: the document is untouched until commitTableSize runs. See
  its header for why that is not how the picker rows behave.

  ONE ROW, and its VALUE is the size. It is the same reading the caption
  above the grid gives, deliberately twice: the caption is what a writer
  can see while a thumb is over the cells (TableSizeGrid's header for why
  it sits above them), and the row is the control that acts, which should
  say what it is about to do. `insert`, not `table` — the label names what
  the tap does, and what it makes is already on screen. It is an ACTION,
  not a push: the tap writes a table and closes the sheet, and there is no
  screen for a chevron to point at.
-->
<Sheet
  open={openSheet === "table"}
  tag="table"
  detent="full"
  onDismiss={() => dismissedSheet("table")}
>
  <TableSizeGrid cell={tableCell} onPick={(cell) => (tableCell = cell)} />
  <RowGroup flush>
    <Row
      label="insert"
      value={`${tableSize.cols} × ${tableSize.rows}`}
      kind="action"
      onSelect={commitTableSize}
    />
  </RowGroup>
</Sheet>

<!--
  FULL DETENT, for §3 ("chart and table editing happen in a full-detent
  sheet") and because the forms need it: a flowchart card is a shape
  picker, a label and a connection row, and three of them plus a title
  field and a commit row is more than half a frame holds.

  DECLARED BELOW THE INSERT SHEET, for the reason the table grid is —
  Svelte runs the claim effects in declaration order, so the insert sheet
  releases the module claim before this one asks and `nextSheet` reports no
  dismissal at all.

  THE TITLE FIELD IS THE HOST'S, not the form's. ChartBuilder puts a title
  input at the top of its modal and it is part of the FRAME rather than of
  the forms: `blockTitle` is the attribute every board carries, not
  something a flowchart has and a timeline does not. So it is a shell
  `Field`, which is the same control the trail sheet uses, and
  it is not autofocused for LineageSelector's finding (a mobile webview
  raises the IME only for focus that traces to a user gesture).

  ONE COMMIT ROW, and its LABEL is the divergence between the two modes:
  `insert` when there is no chart yet and `save` when the sheet was opened
  on one. The word names what the tap does, which is the rule the table
  grid's `insert` row follows — and here the two taps genuinely do
  different things (insertChart vs updateChart at a frozen position), so
  one word for both would be the lie.

  ITS VALUE IS THE KIND, or the reason it cannot act. A timeline event with
  no date assembles as an orphaned box beside the spine (chart-draft.js's
  `chartCanCommit`), so the row goes inert and says why rather than
  committing a chart that has lost the thing a timeline is for. Row renders
  a value with no control when `onSelect` is null, which is the primitive
  saying what the sheet means: this line is a fact, not a choice. It is not
  a dead row in P2d's sense either — a dead row is one that could act and
  does not, and this one is telling the writer what to type next.

  So the row is an ACTION only while it can act. `kind` is passed only
  then; with `onSelect` null and no kind, row-kind.js derives `value` on
  its own, and the row is drawn in ink rather than in the accent an offer
  takes. Passing `action` unconditionally would paint the inert line as an
  offer the tap cannot keep.

  BACKING OUT WRITES NOTHING, which is a property of the commit rather than
  of the dismissal: the document is untouched until commitChart runs. See
  its header, and the insert sheet's absence note for the litter this
  shape exists to avoid.
-->
<Sheet
  open={openSheet === "chart"}
  tag="chart"
  detent="full"
  onDismiss={() => dismissedSheet("chart")}
>
  <Field label="chart title" placeholder="title (optional)" bind:value={chart.blockTitle} />
  <ChartForm
    kind={chart.kind}
    source={chart.source}
    onKind={(next) => (chart = withKind(chart, next))}
    onSource={(next) => (chart.source = next)}
  />
  <RowGroup flush>
    <Row
      label={chart.mode === "edit" ? "save" : "insert"}
      value={chartCommits ? chart.kind : "every event needs a date"}
      kind={chartCommits ? "action" : null}
      keepFocus={true}
      onSelect={chartCommits ? commitChart : null}
    />
  </RowGroup>
</Sheet>

<!--
  The header's three. Each row is a CHOICE — it selects a day or a page
  and pops — except the one that names what is already on screen, which is
  inert: `Row` renders a value with no control when `onSelect` is null,
  and with no kind passed it derives `value` on its own. The primitive
  saying the same thing the sheet does: the row you are looking at is a
  fact, not a choice.

  The date sheet's one sentence, when today is its only row, is a Note
  under the group rather than a Row: a Row with no onSelect renders as an
  inert list line, and this is the sheet's sentence rather than one of its
  choices. `size="base"` because it is the first thing on the surface
  after the row, not a caption under one.
-->
<Sheet
  open={openSheet === "date"}
  tag="date"
  detent="half"
  onDismiss={() => dismissedSheet("date")}
>
  <!--
    "also in the today" — the fourth device pass asked for the picker
    here as well as in memory's filters. The list under it stays: it is
    the recent days with their page counts, which is what a writer wants
    most of the time, and the grid is for the day that is further back
    than a list can carry.

    `markedOnly`, unlike memory's: the rows here are the days that HAVE
    pages, and a day with none has nothing to open. An unmarked day is
    drawn and not pressable rather than absent, because a calendar with
    holes in it cannot be read. Today is the exception the primitive
    makes for `getOrCreateToday`.
  -->
  <Calendar
    month={dayMonth ?? monthOf(page?.date ?? clockDay)}
    today={clockDay}
    marked={dayMarkedDays}
    selected={page?.date ?? null}
    markedOnly={true}
    label="open a day"
    onMonth={(next) => (dayMonth = next)}
    onPick={openDayByDate}
  />
  <RowGroup flush>
    {#each daySheetRows as row (row.date)}
      <Row
        label={row.label}
        value={row.value}
        kind={row.showing ? null : "choice"}
        onSelect={row.showing ? null : () => openDay(row)}
      />
    {/each}
  </RowGroup>
  {#if daySheetNoteText}
    <Note size="base">{daySheetNoteText}</Note>
  {/if}
</Sheet>

<!-- A living document's days (page-picker.js markerRows): one page, so the
     date control lists the day markers inside it instead of other pages. -->
<Sheet
  open={openSheet === "days"}
  tag="days"
  detent="half"
  onDismiss={() => dismissedSheet("days")}
>
  <RowGroup flush>
    {#each markerSheetRows as row (row.date)}
      <Row label={row.label} value={row.value} kind="choice" onSelect={() => openMarkerDay(row.date)} />
    {/each}
  </RowGroup>
  {#if markerSheetRows.length === 0}
    <Note size="base">{DAY_SHEET_NOTE}</Note>
  {/if}
</Sheet>

<Sheet
  open={openSheet === "pages"}
  tag="pages"
  detent="half"
  onDismiss={() => dismissedSheet("pages")}
>
  <RowGroup flush>
    {#each pageSheetRows as row (row.id)}
      {#if row.kind === "delete"}
        <!--
          THE ONE ROW THAT TAKES SOMETHING AWAY. `destructive` is the colour
          Row reserves for an act that cannot be undone (row-kind.js), and the
          label names the page rather than saying "this page". The first tap
          arms it, the second deletes (pageSheetRows).
        -->
        <Row
          label={row.label}
          destructive={true}
          onSelect={() => (row.armed ? deletePageRow(row) : (armedDeleteId = row.pageId))}
        />
      {:else}
        <Row
          label={row.label}
          value={row.value}
          kind={row.showing ? null : "choice"}
          onSelect={row.showing ? null : () => openPageRow(row)}
        />
      {/if}
    {/each}
  </RowGroup>
</Sheet>

<!--
  MEMORY'S FILTERS. §2 gives this surface a sheet where it gives pins a
  segment, and P3 Task 2 recorded that asymmetry rather than smoothing it
  over: a segment is one axis, and three of them side by side is a toolbar.

  THE CONTROLS ARE THE DESKTOP'S, down to their words and their order —
  DatePopover's four range presets, MemoryFiltersPanel's sort segment, its
  "pinned only". What is missing from it is the month grid under the
  presets and the trail list above them, and neither absence is a
  simplification. The grid is its own primitive with its own gallery entry
  and its own baseline; the trail list is a PUSHED INDEX in §2 ("trails are
  a pushed index, not a drawer"), and it landed in Task 4 as
  TrailIndexScreen, reached from the OTHER action on this bar. So the trail
  scope really is on this screen — it is just not in this sheet, and
  memory-model.js's `memoryFilterSummary` carries the one consequence: the
  count on this action does not include the scope, because clearing it is
  not something this sheet can offer.

  HALF DETENT: three controls and a clear row is about five rows of sheet,
  and the full detent is what the shell reserves for a field plus the list
  it chooses between (see the trail sheet's header).

  THREE FLUSH GROUPS, two of them with an eyebrow. `date` and `sort` name
  the segment under each — an eyebrow rather than a Row, because a Row is
  a control or a value and a heading is neither. The segment is the
  shell's own `Segment`, which floors each option at --tap and spreads
  them across the band (its header for the 40px debt it closes), so the
  four date presets share the width rather than scrolling off the edge
  the way the bare leaf's nowrap segments did. The third group holds the
  toggle and, when there is anything to clear, the row that clears it.
-->
<Sheet
  open={openSheet === "memory-filters"}
  tag="memory-filters"
  detent="half"
  onDismiss={() => dismissedSheet("memory-filters")}
>
  <RowGroup flush eyebrow="date">
    <Segment
      options={DATE_RANGES}
      value={memoryDay ? "" : memoryRange}
      onChange={setMemoryRange}
      ariaLabel="date range"
    />
  </RowGroup>

  <!--
    THE PICKER THE FOURTH DEVICE PASS ASKED FOR: "the filters does not
    show date picker similar to desktop". The presets stay over it — one
    tap where the grid is two, and `today` is what a writer asks for most
    — and a day tapped here is the same filter said another way, so each
    clears the other (setMemoryRange, pickMemoryDay). Every day is
    pressable, written on or not: a filter naming an empty day answers
    with an empty list, which is an answer.

    The dots are the days that have writing, off the same list the
    timeline is drawn from (`memoryDays`), so the calendar cannot mark a
    day the screen behind it does not show.
  -->
  <RowGroup flush eyebrow="pick a day">
    <Calendar
      month={memoryMonth ?? monthOf(clockDay)}
      today={clockDay}
      marked={memoryMarkedDays}
      selected={memoryDay}
      label="pick a day"
      onMonth={(next) => (memoryMonth = next)}
      onPick={pickMemoryDay}
    />
  </RowGroup>

  <RowGroup flush eyebrow="sort">
    <Segment
      options={SORTS}
      value={memorySort}
      onChange={setMemorySort}
      ariaLabel="sort order"
    />
  </RowGroup>

  <RowGroup flush>
    <Row
      label="pinned only"
      toggle
      checked={memoryPinned}
      onToggle={(next) => (memoryPinned = next)}
    />

    {#if memoryFilters > 0}
      <!-- Offered only when there is something to clear, which is the rule
           every row in every sheet here follows: a row that cannot change
           what is on screen is an affordance onto nothing. An action: it
           resets the filters and the sheet stays up, showing the reset. -->
      <Row label="clear filters" kind="action" onSelect={clearMemoryFilters} />
    {/if}
  </RowGroup>
</Sheet>

<!--
  FULL DETENT — the first sheet in the shell to take it, and no longer the
  only one: the table grid took it in P2f-2 Task 4 and the chart builder in
  Task 5, both because a builder does not fit in half a frame. Stated
  without a count, because that number has now moved twice and the reason
  below is what this comment is actually for.

  What this one takes it for is a field AND the list the writer is choosing
  between, on a screen the keyboard has taken half of. §2 sets the
  precedent for the pin note sheet ("a full-detent sheet with its field
  above the keyboard"). Note what the detent is NOT buying: Sheet lifts on
  --kb-overlay at either height (P2c-2 fixed that), so getting the field
  clear of the keyboard is free — the room for the list underneath it is
  what costs. A sheet holding a field and one row would make the same call
  the other way for exactly that reason.

  THE FIELD IS NOT AUTOFOCUSED, and that is LineageSelector's finding
  rather than an oversight: "a mobile webview only raises the IME for
  focus that traces to a user gesture — programmatic .focus() cannot be
  relied on". Its sheet opened with an un-typable field and, because the
  keyboard never came, no lift either. The writer taps the field and the
  tap raises the keyboard. FindStrip's autofocus is the opposite call for
  the opposite surface: mounting that strip IS opening find, and there is
  nothing else in it to tap.
-->
<Sheet
  open={openSheet === "trail"}
  tag="trail"
  detent="full"
  onDismiss={() => dismissedSheet("trail")}
>
  <!-- 0.8.2: the field finds as well as names (trail-sheet-model.js's
       header) — typing narrows the trails below and still offers to start
       a trail no name matches. -->
  <Field
    label="find or name a trail"
    placeholder="find a trail…"
    bind:value={newTrailName}
    onSubmit={submitTrailName}
  />
  <!--
    The third device pass: "the trail creation is not clear — user taps
    text and no indication". The field said what to type and nothing said
    what came next. This line says it, while there is nothing typed; once
    there is, the row under the field says it instead, in the action tone,
    and return runs it (trailSheetSubmit).
  -->
  {#if nestingNow}
    <Note>choose the trail “{newTrailName.trim()}” goes inside.</Note>
  {:else if !newTrailName.trim()}
    <Note>type to find a trail, or a new name and return to start one.</Note>
  {/if}
  <!--
    The eyebrow says what the list IS, because in nesting mode it is the
    same rows meaning something else. They are keyed by lineage id in both
    modes, so the DOM rows are REUSED across the switch — nothing moves,
    nothing transitions, and without a heading the only thing that changes
    under the finger is the second column. A writer who taps "start it
    inside a trail…" and then looks down deserves to be told what they are
    now looking at.
  -->
  <RowGroup flush eyebrow={nestingNow ? "put it inside" : ""}>
    {#each trailRows as row (row.id)}
      <Row
        label={row.label}
        value={row.value}
        detail={row.detail ?? ""}
        kind={row.kind === "create" || row.kind === "nest"
          ? "action"
          : row.kind === "manage"
            ? "push"
            : row.selectable
            ? "choice"
            : null}
        keepFocus={true}
        onSelect={row.selectable ? () => runTrailRow(row) : null}
      />
    {/each}
  </RowGroup>
</Sheet>

<!--
  MEMORY'S TRAIL SCOPE. The other half of the fifth device pass's
  finding, and a sheet for the filters sheet's reason: one decision about
  the list behind it, made where that list stays visible.

  HALF DETENT, like every other list-of-rows sheet: a writer with four
  trails sees all of them, and one with forty scrolls inside the sheet
  rather than being handed a screen. `all trails` and `untrailed` head
  the list because they are the way back out of a scope, not trails
  (trail-index.js says why they are not derived from the lineages).

  The row that is ON says `showing` and is inert — the sheet saying the
  same thing the bar's label does, and the convention the date and pages
  sheets already use for the row you are looking at.

  Nesting is the label's, not an indent: `trailIndexRows` carries a
  depth, and a Row has one shape. A sheet that indented rows would put a
  tap target's left edge somewhere different per row, which is what the
  page's own trail sheet declined when it flattened to breadcrumbs.
-->
<Sheet
  open={openSheet === "trail-scope"}
  tag="trail-scope"
  detent="half"
  onDismiss={() => dismissedSheet("trail-scope")}
>
  <!-- 0.8.2: `find a trail…` and each row's own `pages · pins`. The two
       scope rows stay while searching (trail-index.js says why). -->
  <Field label="find a trail" placeholder="find a trail…" bind:value={trailScopeQuery} />
  {#if trailScopeNoMatch}
    <Note>no trail is named like that.</Note>
  {/if}
  <RowGroup flush>
    {#each trailScopeRows as row (row.id ?? "all")}
      <!-- The showing row is a push for a trail — its screen, task 9e —
           and inert for all trails and untrailed (scopeRowAction). -->
      <Row
        label={row.label}
        value={row.value}
        detail={row.detail}
        kind={scopeRowAction(row) === "scope" ? "choice" : scopeRowAction(row) === "manage" ? "push" : null}
        onSelect={scopeRowAction(row) ? () => tapScopeRow(row) : null}
      />
    {/each}
  </RowGroup>
</Sheet>

<!--
  TASK 9e: A TRAIL'S MOVE, ITS DELETE, AND A PIN'S TRAIL. Three list
  sheets at half detent, the trail-scope sheet's shape. The rows are
  trail-manage.js's: the place a trail or pin already is is listed and
  inert (`now`, `this pin`), the way the page sheet lists `this page`.

  THE DELETE IS CONFIRMED BY A SHEET, the shell's one overlay: the screen's
  `delete trail` row asks, and the one destructive row here — naming the
  trail, the pages sheet's safeguard — deletes. Dismissing it is the cancel.
-->
<Sheet
  open={openSheet === "trail-move"}
  tag="trail-move"
  detent="half"
  onDismiss={() => dismissedSheet("trail-move")}
>
  <RowGroup flush eyebrow="move under">
    {#each trailMoveRows as row (row.id)}
      <Row
        label={row.label}
        value={row.value}
        kind={row.selectable ? "choice" : null}
        onSelect={row.selectable ? () => moveTrailUnder(row) : null}
      />
    {/each}
  </RowGroup>
</Sheet>

<Sheet
  open={openSheet === "trail-delete"}
  tag="trail-delete"
  detent="half"
  onDismiss={() => dismissedSheet("trail-delete")}
>
  {#if managedTrail}
    <Note size="base">{trailDeleteNote({ lineage: managedTrail, lineages: memoryLineages })}</Note>
    <RowGroup flush>
      <Row label={trailDeleteLabel(managedTrail)} destructive={true} onSelect={deleteManagedTrail} />
    </RowGroup>
  {/if}
</Sheet>

<!--
  TASK 9g: DISCONNECT, CONFIRMED BY A SHEET — the trail delete's shape. The
  sync screen's `disconnect` row asks; the one destructive row here resets.
  Two rows, `keep things as they are` first and the destructive one last, so the
  row that takes the account away is not where a thumb lands first
  (pin-artifact-view's rule); dismissing is a cancel too.
-->
<Sheet
  open={openSheet === "sync-disconnect"}
  tag="sync-disconnect"
  detent="half"
  onDismiss={() => dismissedSheet("sync-disconnect")}
>
  <Note size="base">{disconnectWords.note}</Note>
  <RowGroup flush>
    <Row label={disconnectWords.stay} kind="action" onSelect={() => dismissedSheet("sync-disconnect")} />
    <Row label={disconnectWords.confirm} destructive={true} onSelect={disconnectSync} />
  </RowGroup>
</Sheet>

<!--
  0.8.2: A PIN ROW'S `more`, from the pins screen. What it offers is
  pin-more-sheet.js's (the desktop's own list, ruling 6). `unpin…` asks in
  the same sheet: the question as its note, `keep` first, `unpin` last.
  Dismissing it is a keep.
-->
<Sheet
  open={openSheet === "pin-more"}
  tag="pin-more"
  detent="half"
  onDismiss={() => dismissedSheet("pin-more")}
>
  {#if moreSheet.note}
    <Note size="base">{moreSheet.note}</Note>
  {/if}
  <RowGroup flush eyebrow={moreSheet.note ? "" : (morePin ? pinRowLabel(morePin) : "")}>
    {#each moreSheet.rows as row (row.key)}
      <Row label={row.label} kind={row.kind} onSelect={() => runPinMoreRow(row)} />
    {/each}
  </RowGroup>
</Sheet>

<Sheet
  open={openSheet === "pin-trail"}
  tag="pin-trail"
  detent="half"
  onDismiss={() => dismissedSheet("pin-trail")}
>
  <RowGroup flush>
    {#each pinTrailSheetRows as row (row.id)}
      <Row
        label={row.label}
        value={row.value}
        kind={row.selectable ? "choice" : null}
        onSelect={row.selectable ? () => pickPinTrail(row) : null}
      />
    {/each}
  </RowGroup>
</Sheet>

<!--
  MIDNIGHT. §1's "non-dismissable variant", and the last Sheet declared in
  this file on purpose: it is the only one that opens from an EFFECT rather
  than from a tap, so it can arrive while another sheet is already up. Svelte
  runs the claim effects in declaration order, so declared last it is the one
  that asks after every other has released — `nextSheet` reports the handoff
  cleanly instead of taking dismissedSheet's guard. Every other sheet here
  has that argument written at its own site; this one has the reason for
  being at the bottom of the list.

  HALF DETENT, and the height is the argument. "stay on yesterday" is a
  sentence about the page behind the sheet, so the page has to still be
  visible for it to mean anything. That is also the whole reason midnight is
  a sheet and not one of ShellGate's full-screen chromeless states — see
  midnight.js.

  TWO ROWS, BOTH ACTIONS, NEITHER `destructive`. Row's destructive kind
  means "this takes something away and will not give it back", and neither
  answer does: yesterday's page is untouched either way, and the day it
  stopped being writable was the clock's doing rather than this sheet's.
  `start fresh` makes today's page; `stay on yesterday` leaves the writer
  where they already are, reading a page they can no longer type into —
  which is the fact the sheet exists to tell them. Neither opens a screen,
  so neither carries a chevron.

  THE GREETING IS A Note, `size="base"`: the sheet's sentence, not one of
  its choices, and the first thing on the surface rather than a caption
  under one. Note owns the face and the inset (its header); this file
  used to keep a rule of its own for it and no longer does.

  The words are the desktop MidnightModal's, unchanged. Two names for one
  choice would manufacture a phantom second feature across the two trees,
  which is the argument TOOLBAR_BUTTON_LABELS makes about `turn into`.
-->
<Sheet
  open={openSheet === "midnight"}
  tag="midnight"
  detent="half"
  dismissable={false}
  onDismiss={() => dismissedSheet("midnight")}
>
  <Note size="base">a new day. yesterday is still here.</Note>
  <RowGroup flush>
    <Row label="start fresh" kind="action" onSelect={() => answerMidnight("fresh")} />
    <Row label="stay on yesterday" kind="action" onSelect={() => answerMidnight("stay")} />
  </RowGroup>
</Sheet>

<style>
  .shell-app-stub {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
  }

  .shell-app-stub-text {
    margin: 0;
    color: var(--ink-soft);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }
</style>
