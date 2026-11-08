import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { flushSync, tick } from "svelte";
import { TextSelection, NodeSelection } from "@tiptap/pm/state";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import ShellApp from "../ShellApp.svelte";
import { navBack, initNavStack, _resetForTests } from "../../lib/navstack.js";
// Read only to prove a typed trigger really activated its plugin. The
// shell never reaches for these to DECIDE anything — `computeSnapshot`
// does that — but a test asserting a strip's absence has to be able to
// tell "the query produced no chips" from "there was no query".
import { SlashCommandsPluginKey, commandItems } from "../../lib/slash-commands.js";
// The sheet's rows are this module's answer; the test asserts the sheet
// renders it rather than carrying a second copy of the list.
import { insertMenuSections } from "../insert-menu.js";
// The calendar's own words and arithmetic, so a test never carries a
// second copy of either.
import { monthLabel, monthOf, shiftMonth } from "../calendar-month.js";

/** How many times the calendar's back arrow has to be pressed to get
 *  from `to`'s month to `from`'s. */
function monthsBetween(from, to) {
  let month = monthOf(to);
  let steps = 0;
  while (month !== monthOf(from) && steps < 600) {
    month = shiftMonth(month, -1);
    steps += 1;
  }
  return steps;
}
import { MentionCommandPluginKey } from "../../lib/extensions/mention-command.js";
// The toast's own dwell, imported rather than re-typed: a test carrying its
// own 4000 would still pass with the two out of step, and the failure would
// be a breadcrumb that stays on screen for a duration nothing agrees on.
import { PIN_TOAST_MS } from "../pin-toast.js";
import { PART_PINNED } from "../pin-intent.js";
// Memory's search debounce, imported for the same reason: a test carrying
// its own 200 would still pass with the two out of step.
import { SEARCH_DEBOUNCE_MS } from "../memory-model.js";
// The word the chosen row of an option set shows. Imported rather than
// retyped: a test carrying its own copy would still pass with the two out
// of step, which is the same trap PIN_TOAST_MS above is imported for.
import { CHOSEN, SHELL_OFF_NOTE } from "../settings-model.js";
// The fixture's date, so a page the tests write on is a page the app would
// let them write on — see LONG_AGO below.
import { getLocalDateStr, getYesterdayStr } from "../../lib/utils.js";

// The focus line is a field on a writable page and text on a closed one
// (PageScreen.svelte, the `.ps-wmn` markup); this reads whichever the page
// rendered, so a test about the LINE does not have to know which.
function focusLineText(target) {
  const input = target.querySelector('.ps-wmn input[aria-label="what matters now"]');
  if (input) return input.value;
  return target.querySelector(".ps-wmn-text")?.textContent ?? null;
}

// Mocked at the module boundary: this suite never touches a backend. api.js
// would otherwise fall through to its in-memory createMockInvoke(), which
// seeds a page dated with the real clock — and a header test whose fixture
// is "whatever today is" cannot tell a wired load from the static default it
// exists to catch.
//
// The three calls ShellApp makes are the first three. The rest are
// EditorCore's, and they arrived with P2c's toolbar tests: those drive real
// transactions through the real core, and a transaction schedules a save.
// Left off the mock, savePageContent is undefined by the time the debounce
// fires — after the test that caused it has finished — and lands as an
// unhandled rejection that fails the RUN with every assertion green,
// attributed to whichever test happened to be in flight. The same reason
// PageScreen.test.js carries the same list.
const api = vi.hoisted(() => ({
  getOrCreateToday: vi.fn(),
  // The backend's day. Null by default, which ShellApp reads as "no answer"
  // and falls back to the WebView's clock, so every fixture dated by
  // getLocalDateStr keeps meaning today.
  getLocalToday: vi.fn(() => Promise.resolve(null)),
  getPageCountForDate: vi.fn(),
  getLineages: vi.fn(),
  // The header's own sheets, from P2f Task 3. getThread and
  // getFocusesForDate fill the date and pages sheets; the last four are
  // what a pick in the trail sheet actually does.
  getThread: vi.fn(() => Promise.resolve([])),
  getFocusesForDate: vi.fn(() => Promise.resolve([])),
  // The pages sheet's delete row, and the neighbour it lands on.
  deleteFocus: vi.fn(() => Promise.resolve()),
  getAdjacentPage: vi.fn(() => Promise.resolve(null)),
  getPage: vi.fn(() => Promise.resolve(null)),
  createNewPage: vi.fn(() => Promise.resolve(null)),
  createLineage: vi.fn(() => Promise.resolve(null)),
  getCanonicalTrailPage: vi.fn(() => Promise.resolve(null)),
  setFocusLineage: vi.fn(() => Promise.resolve()),
  getCarryForwardPins: vi.fn(() => Promise.resolve([])),
  savePageContent: vi.fn(() => Promise.resolve()),
  saveTrailContent: vi.fn(() => Promise.resolve()),
  createPin: vi.fn(() => Promise.resolve({ id: "pin-1" })),
  getPins: vi.fn(() => Promise.resolve([])),
  attachmentAddBytes: vi.fn(() => Promise.resolve({})),
  updatePinContent: vi.fn(() => Promise.resolve()),
  updateWhatMattersNow: vi.fn(() => Promise.resolve()),
  updatePinStatus: vi.fn(() => Promise.resolve()),
  // A board rename's cross-page half (savePin → renameOnNode): the source
  // page is read, the node's slot rewritten, the page saved back. The read
  // answers an empty doc by default — the rename tests that need the node
  // to be found seed one.
  loadPageContentForModal: vi.fn(() => Promise.resolve('{"type":"doc","content":[]}')),
  savePageContentWithPinRefresh: vi.fn(() => Promise.resolve()),
  // The pins screen's two other writes (P3 Task 2). Both resolve nothing,
  // because both commands write a column and hand back no row — a mock
  // resolving one would let a test pass on a re-read the app deliberately
  // never makes (it patches its own list instead).
  updatePinAutoInsert: vi.fn(() => Promise.resolve()),
  deletePin: vi.fn(() => Promise.resolve()),
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve()),
  // Memory's search (P3 Task 3). FTS5 over `pages_fts`, the same command
  // the desktop's own search box calls — the shell reuses the query rather
  // than writing a second one.
  searchPages: vi.fn(() => Promise.resolve([])),
  // The trail map's one fetch (the visual pass, Task 8): page count per
  // trail as `[lineage_id, count]` pairs, pageless trails absent. Empty
  // by default — an answer, so the map draws `0 pages` on every trail;
  // the tests that care set a count or make it reject.
  getTrailPageCounts: vi.fn(() => Promise.resolve([])),
  // Its pin twin (0.8.2): each trail's own pins as `[lineage_id | null,
  // count]`, null for the pins on no trail. Feeds the trail sheets'
  // `pages · pins` and the pins screen's `all trails` count.
  getTrailPinCounts: vi.fn(() => Promise.resolve([])),
  // The mention extension's two, added for the reason the note above
  // gives about EditorCore's. A typed `@` activates MentionCommand's
  // Suggestion plugin, whose async `items` awaits these alongside
  // getLineages (mention-command.js:334-347). Its own try/catch would
  // swallow an undefined mock and the suite would stay green — on a
  // fallback path rather than on the one the mention test is about.
  searchPagesForMention: vi.fn(() => Promise.resolve([])),
  searchPinsForMention: vi.fn(() => Promise.resolve([])),
  // The sync stack's seven (P4 Task 2). `syncStatus` is read on every
  // arrival at the settings ROOT, not just inside the stack — the root's
  // sync row carries the state in its value column — so leaving it off
  // this mock throws inside every settings test in the file, not only the
  // sync ones. It defaults to an unconfigured install because that is
  // what a fresh database answers, and because it is the branch that
  // reaches the scanner.
  syncStatus: vi.fn(() =>
    Promise.resolve({ configured: false, enabled: false, revoked: false, device_id: null }),
  ),
  listDevices: vi.fn(() => Promise.resolve([])),
  pairExistingStart: vi.fn(() =>
    Promise.resolve({ pair_token: "aa-bb-cc-dd", qr_payload: '{"relay":"r"}' }),
  ),
  // Rejects by default, which is the relay's ordinary answer until the
  // other device deposits its key — the poll swallows it and asks again.
  // A mock that RESOLVED here would advance every pair test to the digits
  // whether the host polled correctly or not.
  pairExistingFetchSas: vi.fn(() => Promise.reject(new Error("404"))),
  pairExistingConfirm: vi.fn(() => Promise.resolve()),
  pairNewJoin: vi.fn(() => Promise.resolve({ sas: "1234" })),
  pairNewComplete: vi.fn(() => Promise.resolve()),
  // Setup's seven (2026-09-17). The phrase is 24 words as the Rust
  // command answers them — one string — and the relay's health answers
  // `multi_user`, the hosted relay's mode, so init/recover is the branch
  // under test rather than self-enrol.
  syncGeneratePhrase: vi.fn(() => Promise.resolve(SETUP_WORDS.join(" "))),
  syncRelayHealth: vi.fn(() => Promise.resolve({ mode: "multi_user" })),
  syncInit: vi.fn(() => Promise.resolve({ user_id: "u", device_id: "d" })),
  syncRecover: vi.fn(() => Promise.resolve({ user_id: "u", device_id: "d" })),
  syncSelfEnroll: vi.fn(() => Promise.resolve({ user_id: "u", device_id: "d" })),
  syncSetEnabled: vi.fn(() => Promise.resolve()),
  syncForcePull: vi.fn(() => Promise.resolve()),
  // Task 9g: the sync screen's `disconnect`, behind its confirmation sheet.
  syncReset: vi.fn(() => Promise.resolve()),
  // Task 9e: the phone manages trails from memory, and a pin's trail from
  // its screen — the laptop's four commands. The two that answer a row
  // answer it as the backend does, the whole lineage with the change in.
  renameLineage: vi.fn((id, newName) => Promise.resolve({ id, name: newName })),
  setLineageParent: vi.fn((id, parentId) => Promise.resolve({ id, parent_id: parentId })),
  deleteLineage: vi.fn(() => Promise.resolve()),
  updatePinScope: vi.fn(() => Promise.resolve()),
  // Every stamp names a live pin unless a test says otherwise.
  getPinForReference: vi.fn((id) => Promise.resolve({ id })),
  emitTrailMutated: vi.fn(),
}));

/** A 24-word phrase the generate mock answers and the typed tests
 *  paste. Hoisted by `vi.mock`, so it is a `var`-free top-level const
 *  the factory reads lazily (the arrow runs per call, after this line). */
const SETUP_WORDS = Array.from({ length: 24 }, (_, i) => `word${i + 1}`);
vi.mock("../../lib/api.js", () => api);

// The worker's events. jsdom has no Tauri to deliver `sync-pulled`, so the
// handler ShellApp registers is kept here and a test fires it, the way the
// worker would after a pull that brought ops.
const events = vi.hoisted(() => ({ handlers: {} }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name, cb) => {
    events.handlers[name] = cb;
    return Promise.resolve(() => {
      if (events.handlers[name] === cb) delete events.handlers[name];
    });
  },
}));

// The canvas below the header is the real EditorCore, and it asks the yjs
// feature flag exactly when the page it was handed is a continuous trail's
// (EditorCore:156). That question is the only thing in jsdom that can show
// the MODE — not just the name — travelling from the lineage row through
// PageScreen to the editor. Mocked rather than spied through getSetting
// because feature-flag.js caches its answer module-wide: a spy on the api
// would see one call per RUN no matter how many pages were opened, and
// settings' labs row would then be untestable in the same file.
//
// (That reason used to be given as two, the first being "this file's api
// mock has no getSetting to spy". It has had one since P3; corrected here
// rather than left standing.)
//
// setYjsEnabled joins it in P4 Task 1. Labs is the one settings row whose
// write does not go through api.js at all — the shell goes through the
// module that owns the cache rather than setting the key behind its back,
// which would leave the editor reading a stale flag for the rest of the
// session.
const yjs = vi.hoisted(() => ({
  isYjsEnabled: vi.fn(() => Promise.resolve(true)),
  setYjsEnabled: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../lib/yjs/feature-flag.js", () => yjs);

// The QR decoder, for P4 Task 2's scanner. jsdom has no
// `navigator.mediaDevices`, so QrScanner's `decodeFromConstraints` would
// reject and no code could ever be read — decoding is the one step of the
// scan path this environment genuinely cannot run. Standing in for it at
// that seam is what lets the handoff from the camera to `pair_new_join`
// be driven by a real press and a real callback rather than by reaching
// into the shell.
const zxing = vi.hoisted(() => ({ emit: null }));
vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    async decodeFromConstraints(_constraints, _video, callback) {
      zxing.emit = callback;
      return { stop: () => {} };
    }
  },
}));

// Mermaid, because the chart builder's commit puts a chart in the document
// and the chart NodeView lazy-imports the real library to draw it
// (chart-render.js). ~600kB of SVG renderer per test file is the small
// half; the load-bearing half is that the render is fire-and-forget, so a
// rejection inside jsdom lands as an unhandled rejection attributed to
// whichever test happens to be in flight — the same failure mode this
// file's api mock exists to prevent. Same shape ChartBuilder.test.js uses.
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id, syntax) => ({ svg: `<svg data-syntax="${syntax.length}"></svg>` })),
  },
}));

// A date that can never be today or yesterday on any machine that runs
// this suite. The page-model tests inject both reference dates and stay
// deterministic that way; ShellApp does not inject them (production has no
// caller who could), so determinism here has to come from the fixture
// being unmistakably in the past. A fixture dated "a few days ago" would
// flip colour overnight the moment it drifted into the yesterday branch.
//
// IT IS NO LONGER THE DEFAULT, and the reason is the finding P2f Task 3
// opened with. It was the default for four phases, so every test in this
// file that types, pins, inserts or converts was driving a real editor on
// a page dated 1999 — which page-writable.js now (correctly) calls
// read-only, and which production would have refused. The suite was green
// because the shell asked a question that could not see the date. Tests
// about what the header SAYS name this date explicitly; tests about what
// the writer can DO get a page they are allowed to write on.
const LONG_AGO = "1999-01-02";

function pageRow(over = {}) {
  return {
    id: "p1",
    date: getLocalDateStr(),
    page_number: 1,
    lineage_id: null,
    ...over,
  };
}

// getOrCreateToday resolves the WHOLE PageWithLines. Building the fixture
// through this helper rather than inline keeps every test honest about the
// shape: a mock that resolved a bare row would let ShellApp read `result`
// as the page and pass.
function withLines(page) {
  return { page, lines: [], session_markers: [] };
}

// The load is a chain of awaits; one macrotask drains the microtask queue
// behind it, and flushSync lands the resulting state on the DOM.
async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

// getLineages() resolved on a MACROTASK, which is what a Tauri command
// actually is. mockResolvedValue settles on a microtask, and Svelte flushes
// its effects on a microtask too, so with an instant mock the two race and
// the canvas can mount already holding a mode the load has not published
// yet. That hides the one thing the mode test is for: EditorCore reads
// trailMode once, at mount, so the trail lookup has to land BEFORE the row
// does. Proven by reversing those two lines in ShellApp — with
// mockResolvedValue the reversed order stayed green at 16 passed, and with
// this deferral it goes red.
function afterATrip(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), 0));
}

// A continuous trail's page schedules one more thing 50ms after its editor
// mounts: `focus("end")`, so the caret lands at the end of the living
// document (EditorCore:393). That timer must not be left pending: a timer
// that fires against a torn-down editor throws, and it lands as an
// unhandled error, which fails the run at exit code 1 with every assertion
// green, attributed to whichever test happened to be running 50ms later.
//
// It used to be unable to RUN either, because it ends in ProseMirror's
// scrollToSelection and jsdom implements getClientRects on Element but not
// on the Range PM measures a caret with. vitest.setup.js fills that gap
// now, so only the torn-down half is left — which is enough on its own.
//
// So these tests hold the clock rather than race it. Fake timers advanced a
// millisecond at a time carry the load's own setTimeout(0) hops without ever
// reaching 50, and useRealTimers() in afterEach discards the pending caret
// with the fake clock. What the caret does at 50ms is the device pass's and
// the VR gate's to show; jsdom has no layout to show it with.
async function settleContinuous() {
  await vi.advanceTimersByTimeAsync(1);
  flushSync();
  await vi.advanceTimersByTimeAsync(1);
  flushSync();
}

// getOrCreateToday resolves first, then PageScreen mounts EditorCore,
// which builds its editor inside onMount after an await tick(). Three
// rounds is what EditorCore's own suite needs; the settle() in front of
// them is what lets the page row land so the canvas mounts at all.
async function settleWithEditor() {
  await settle();
  for (let i = 0; i < 3; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
}

function editorOf(target) {
  return target.querySelector(".ProseMirror").editor;
}

function buttonIds(target) {
  return [...target.querySelectorAll(".shell-toolbar-strip [data-button-id]")].map(
    (b) => b.dataset.buttonId,
  );
}

// A real transaction on the real editor — the same path a drag-select on
// the phone takes. Deliberately NOT scrollIntoView'd: that runs
// ProseMirror's coordsAtPos, which jsdom has no layout to answer
// (PageScreen.test.js carries the same note).
function selectText(ed, from, to) {
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)));
  flushSync();
}

// A tap: pointerdown and pointerup, and no click. Firing click instead
// would assert nothing — no button in the shell has a click handler, on
// purpose, because a real tap fires both and every command would run twice
// (ToolbarButton's header).
//
// The pointerup is P2e's addition and it costs the strip nothing:
// ToolbarButton still acts on pointerdown and listens for no other event,
// so every assertion in this file below stayed exactly as written. It is
// the GUTTER HANDLE that needs it — that control stopped acting on
// pointerdown, because a control which has already opened a sheet has
// nothing left to hold when §3 asks for a long press. PointerEvent rather
// than MouseEvent for the same reason: the handle's press tracks a pointer
// id, and a MouseEvent carries none.
function tap(target, id) {
  const el = target.querySelector(`[data-button-id="${id}"]`);
  for (const type of ["pointerdown", "pointerup"]) {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1 }));
  }
  flushSync();
}

function textPage(extra = []) {
  return withLines(
    pageRow({
      content_json: JSON.stringify({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "kept going" }] },
          ...extra,
        ],
      }),
    }),
  );
}

// jsdom ships no clipboard at all, so this is the platform for the copy
// tests. Restored per test rather than left installed: a stub navigator
// that outlived its describe would make every later "did not copy"
// assertion pass against a stale spy.
function stubClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  const had = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return {
    writeText,
    restore() {
      if (had) Object.defineProperty(navigator, "clipboard", had);
      else delete navigator.clipboard;
    },
  };
}

// createPin and getPins as a ledger rather than as constants. The hoisted
// defaults resolve `{id: "pin-1"}` and `[]` forever, which is enough for
// tests that only need the pin flow not to explode; it is not enough to
// read a row back.
//
// At module scope rather than inside the pin describe, because the block
// SHEET pins too now and its rows have to be readable back from the same
// ledger. Every describe that calls this restores the three
// implementations in its own afterEach: vi.clearAllMocks() clears CALLS,
// not implementations, so a mockImplementation set here would otherwise
// outlive its describe and hand the next one a getPins that remembers pins
// from another test.
function pinLedger() {
  const rows = [];
  api.createPin.mockImplementation(async (lineageId, sourcePageId, objectType, content, title) => {
    const row = {
      id: `pin-${rows.length + 1}`,
      lineage_id: lineageId,
      source_page_id: sourcePageId,
      object_type: objectType,
      content,
      title,
    };
    rows.push(row);
    return row;
  });
  // The row's content is written TWICE for a board, and the ledger has to
  // model that or an assertion about the stored snapshot reads the wrong
  // one. confirmPin creates the row with the pre-stamp JSON, then stamps
  // pinId into the doc and ships the re-serialised node through
  // updatePinContent (EditorCore:718-723). Recording only the create call
  // would say the stamp never reached the database, which is the opposite
  // of true — this test was written that way first and failed on exactly
  // that.
  api.updatePinContent.mockImplementation(async (id, content, title) => {
    const row = rows.find((r) => r.id === id);
    if (row) {
      row.content = content;
      if (title != null) row.title = title;
    }
  });
  api.getPins.mockImplementation(async () => rows.slice());
  return rows;
}

/** What pinLedger's three mocks were before it replaced them. */
function restorePinMocks() {
  api.createPin.mockImplementation(() => Promise.resolve({ id: "pin-1" }));
  api.getPins.mockImplementation(() => Promise.resolve([]));
  api.updatePinContent.mockImplementation(() => Promise.resolve());
  // Not one of the ledger's three, but the pin-edit tests seed it, and a
  // seeded source page that outlives its test hands the next one a page
  // that holds a block it should not: an orphaned pin's edit then lands
  // in that page instead of in its row.
  api.loadPageContentForModal.mockImplementation(() => Promise.resolve('{"type":"doc","content":[]}'));
}

// confirmPin is async and does four things in order: create the row, stamp
// pinId into the doc, re-serialise non-note pins, flush the save. A
// macrotask drains the microtask queue behind all four.
//
// WHICH ASSERTIONS ACTUALLY NEED IT, measured rather than assumed, and the
// answer is not "all of them". Dropping this await ahead of the ledger
// reads leaves them GREEN: the mock's createPin has no await of its own, so
// its async body runs straight through to `rows.push` before it returns a
// promise at all. The ledger fills in the same turn as the tap — a property
// of the MOCK, not of the real path, where createPin is a Tauri round trip.
//
// The stamp is the assertion that really needs it, and dropping the await
// there goes red on `expected null to be 'pin-1'`: the stamp is dispatched
// after `await createPin(...)`, so the same-turn read sees the pre-stamp
// doc. That is P2e's rule holding exactly where its handoff said it would —
// a synchronous assertion cannot see an asynchronous write any more than it
// could see an asynchronous undo.
//
// Every call keeps the await anyway, so a mock that later grows a real
// deferral cannot silently start hiding a defect in the tests that pass
// without one today.
async function settlePin() {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

beforeEach(() => {
  // NAVSTACK IS A SINGLETON AND ITS REWIND IS DEFERRED. A sheet closed in
  // one test leaves a macrotask queued to rewind history; without this it
  // fires partway through a LATER test and pops a state that test had just
  // pushed — three date-sheet tests failed that way, each passing on its
  // own. Resetting here is the same reason the describe at the stack tests
  // already does it, applied to the whole file now that a close no longer
  // finishes inside its own turn.
  _resetForTests();
  api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
  api.getLineages.mockResolvedValue([]);
  api.getThread.mockResolvedValue([]);
  api.getFocusesForDate.mockResolvedValue([]);
  api.getPage.mockResolvedValue(null);
  api.createNewPage.mockResolvedValue(null);
  api.createLineage.mockResolvedValue(null);
  api.setFocusLineage.mockResolvedValue(undefined);
  // No canonical, which is what a trail with no living document yet
  // answers — and what keeps a continuous row unselectable. Restored
  // here for the reason the comment below gives: clearAllMocks clears
  // calls, not implementations, so a test that points this at a page
  // would otherwise hand one to every test after it.
  api.getCanonicalTrailPage.mockResolvedValue(null);
  api.getCarryForwardPins.mockResolvedValue([]);
  // A key nobody wrote, which is what a fresh database answers. Restored
  // here rather than left to the afterEach because `vi.clearAllMocks`
  // clears CALLS and not implementations — a test that points getSetting
  // at "false" would otherwise leave the layout switch off for every test
  // declared after it, in declaration order, which is the kind of failure
  // that moves when you reorder the file.
  api.getSetting.mockResolvedValue(null);
});

afterEach(() => {
  cleanupAll();
  vi.clearAllMocks();
  // Restores the real clock AND drops whatever the fake one still holds —
  // the continuous caret timer above is exactly that. A no-op for every
  // test that never faked.
  vi.useRealTimers();
});

describe("ShellApp", () => {
  it("renders the frame: root, page screen, and a slot holding the tab bar", () => {
    const { target } = render(ShellApp);
    expect(target.querySelector(".shell-root")).not.toBeNull();
    expect(target.querySelector(".shell-slot")).not.toBeNull();
    expect(target.querySelector(".shell-tabbar")).not.toBeNull();
    expect(target.querySelector(".shell-screen")).not.toBeNull();
  });

  it("starts on the page root", () => {
    const { target } = render(ShellApp);
    const current = target.querySelector('.shell-tabbar [aria-current="page"]');
    expect(current.dataset.tabId).toBe("page");
  });

  it("re-reads the page before showing it again, so a return cannot overwrite it", async () => {
    // THE WRITING THIS LOST. Write a line, glance at memory, come back: the
    // line was gone from the database as well as the screen. Measured on an
    // SM-A065F by asking the backend at each step — it HAD the line after
    // typing, still had it on memory, and had lost it after the return.
    //
    // PageScreen is rendered under `{#if active === "page"}`, so leaving
    // destroys it and returning builds a new one seeded from this
    // component's `page` row. That row had been in hand since the load: the
    // editor held the writing, the row did not, and the new editor's first
    // autosave wrote the old content back over the newer one.
    //
    // ASSERTED THROUGH THE RENDER, not through `api.getPage` having been
    // called. A call-count test passes just as happily when the read lands
    // AFTER the switch, which is the race that loses the writing. The
    // refreshed row here closes the page, and a closed page shows its focus
    // line as static text instead of a field — so the field being gone
    // proves the fresh row reached the canvas before it was built.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    const { target } = render(ShellApp, {});
    await settle();
    expect(target.querySelector('.ps-wmn input[aria-label="what matters now"]')).not.toBeNull();

    target.querySelector('[data-tab-id="memory"]').click();
    await settle();

    // What the backend holds now — as if the editor had saved while the
    // writer was away from the tab.
    api.getPage.mockResolvedValue(withLines(pageRow({ is_open: false })));

    target.querySelector('[data-tab-id="page"]').click();
    await settle();

    expect(api.getPage).toHaveBeenCalled();
    expect(target.querySelector('.ps-wmn input[aria-label="what matters now"]')).toBeNull();
  });

  it("still leaves the page root when the re-read fails", async () => {
    // A writer who cannot get off a screen has a worse problem than a stale
    // one. The read is best-effort: it logs and the tab changes anyway.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    const complained = vi.spyOn(console, "error").mockImplementation(() => {});
    const { target } = render(ShellApp, {});
    await settle();

    target.querySelector('[data-tab-id="memory"]').click();
    await settle();

    api.getPage.mockRejectedValue(new Error("the database is busy"));
    target.querySelector('[data-tab-id="page"]').click();
    await settle();

    expect(target.querySelector('.shell-tabbar [aria-current="page"]').dataset.tabId).toBe("page");
    expect(complained).toHaveBeenCalled();
    complained.mockRestore();
  });

  it("switches roots on a tab tap", () => {
    // Asserts the CONTENT changed, not only the indicator. Checking
    // aria-current alone passes just as happily when the bar highlights a
    // root the content band never navigated to -- a drift a later refactor
    // invites the moment TabBar keeps any highlight state of its own, and
    // one that reads on a device as a tab that lights up and does nothing.
    const { target } = render(ShellApp);
    expect(target.querySelector(".shell-screen")).not.toBeNull();
    expect(target.querySelector(".ph-pins")).not.toBeNull();

    target.querySelector('[data-tab-id="memory"]').click();
    flushSync();

    expect(target.querySelector('.shell-tabbar [aria-current="page"]').dataset.tabId).toBe("memory");
    // Both halves, because memory is a real screen since P3 Task 3 and the
    // two roots now render the same primitives. `.shell-screen` survives
    // the switch (it is Screen's own wrapper, and memory has one too), so
    // the assertion that used to read "the page's screen is gone" would
    // now be false — what changed is WHOSE screen it is. The page's own
    // header is the thing only the page root renders.
    expect(target.querySelector(".ph-pins")).toBeNull();
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("memory");
  });

  it("leaves the page in place when the page tab is re-tapped", () => {
    // TabBar.choose() returns early on the active id, so this fires no
    // callback at all. Asserting the page SURVIVES rather than asserting
    // nothing happened: a re-tap that tore the canvas down and rebuilt it
    // would lose the caret and anything typed since the last save, and an
    // inert-callback test cannot see that.
    const { target } = render(ShellApp);
    const before = target.querySelector(".shell-screen");
    target.querySelector('[data-tab-id="page"]').click();
    flushSync();
    expect(target.querySelector(".shell-screen")).toBe(before);
  });

  it("offers exactly the three roots, in order", () => {
    const { target } = render(ShellApp);
    const ids = [...target.querySelectorAll(".shell-tab")].map((b) => b.dataset.tabId);
    expect(ids).toEqual(["page", "memory", "settings"]);
  });

  it("shows the loaded page's date rather than the default", async () => {
    // The whole point of the task. For all of P2a the header said "today"
    // on every date because ShellApp was rendered with no props and
    // dateLabel sat on a static string. A load that does not reach the bar
    // is decoration, and only a page dated something other than today can
    // tell the two apart — which is why this test names its date rather
    // than taking the fixture's.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ date: LONG_AGO })));
    const { target } = render(ShellApp);
    expect(target.querySelector(".ph-date-label").textContent).toBe("today");

    await settle();

    const label = target.querySelector(".ph-date-label").textContent;
    expect(label).not.toBe("today");
    expect(label).toContain("jan");
  });

  it("shows the trail name of a page on a trail", async () => {
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getLineages.mockResolvedValue([
      { id: "L0", name: "other", mode: "discrete" },
      { id: "L1", name: "the book", mode: "continuous" },
    ]);

    vi.useFakeTimers();
    const { target } = render(ShellApp);
    await settleContinuous();

    expect(api.getLineages).toHaveBeenCalled();
    expect(target.querySelector(".ph-trail").textContent).toBe("the book");
  });

  it("carries the trail's mode to the canvas, not only its name", async () => {
    // The header shows a trail name whether or not the mode came with it,
    // so a load that took `name` and dropped `mode` looked identical on
    // screen — which is how the shell spent a task able to open a
    // continuous trail's canonical page and write it through the discrete
    // save route. getOrCreateToday() filters on date alone
    // (commands.rs:65-72), so that page is reachable on any day the user
    // last wrote on that trail; PageScreen's header carries what the wrong
    // route costs.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getLineages.mockImplementation(() => afterATrip([{ id: "L1", name: "the book", mode: "continuous" }]));

    vi.useFakeTimers();
    render(ShellApp);
    await settleContinuous();

    expect(yjs.isYjsEnabled).toHaveBeenCalled();
  });

  it("leaves a discrete trail's page on the page path", async () => {
    // Same load, same lookup, one field different — and the mode is the
    // only thing that may decide this. Asserting the negative here is what
    // makes the positive above mean something: a PageScreen that bound
    // every trailed page would pass that test and lose this one.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", mode: "discrete" }]);

    render(ShellApp);
    await settle();

    expect(yjs.isYjsEnabled).not.toHaveBeenCalled();
  });

  it("looks up no lineages for an untrailed page", async () => {
    // Untrailed is the ordinary state of a page, not an edge case: most
    // pages never join a trail. Asserting the call count rather than
    // asserting "no trail rendered" — the header looks identical either
    // way, so the only visible cost of a needless round trip is the round
    // trip, and this is the only place it can be seen.
    const { target } = render(ShellApp);
    await settle();

    expect(api.getLineages).not.toHaveBeenCalled();
    expect(target.querySelector(".ph-trail")).toBeNull();
  });

  it("shows a dot per page of the day, filled on the page it loaded", async () => {
    // THE DAY'S ROWS ARE THE ANSWER, and the dot is this page's POSITION in
    // them. Numbered 1, 2, 4 on purpose: page_number is minted MAX+1 per
    // device and never reused, so a day with a deleted page in it has gaps,
    // and the loaded page's own number (4) is not the dot it belongs on.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ id: "p2", page_number: 4 })));
    api.getFocusesForDate.mockResolvedValue([
      { id: "p1", date: getLocalDateStr(), page_number: 1 },
      { id: "p2", date: getLocalDateStr(), page_number: 4 },
      { id: "p3", date: getLocalDateStr(), page_number: 7 },
    ]);

    const { target } = render(ShellApp);
    await settle();

    const dots = [...target.querySelectorAll(".ph-dot")];
    expect(dots.length).toBe(3);
    expect(dots.findIndex((d) => d.classList.contains("ph-dot-on"))).toBe(1);
  });

  it("keeps + and the trail reachable on a day with too many pages to dot", async () => {
    // MEASURED ON AN A16, 28 pages on the day: the dot row was `flex: 0 0
    // auto`, took 329px of a 384px viewport, and pushed `+` to l=364 --
    // off the screen -- with the trail control squeezed to w=0. A writer
    // could not start a new page, and could not put the page they were on
    // onto a trail. jsdom has no layout, so this asserts the thing that
    // CAUSED it rather than the pixels: twenty-eight dots are not rendered
    // at all, the row is a count, and both controls are still in the DOM.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ id: "p12" })));
    api.getFocusesForDate.mockResolvedValue(
      Array.from({ length: 28 }, (_, i) => ({
        id: `p${i + 1}`, date: getLocalDateStr(), page_number: i + 1,
      })),
    );
    const { target } = render(ShellApp);
    await settle();

    expect(target.querySelectorAll(".ph-dot").length).toBe(0);
    expect(target.querySelector(".ph-dot-count").textContent.trim()).toBe("12 / 28");
    // The control is the same control: one tap, the pages sheet behind it.
    expect(target.querySelector("button.ph-dots")).not.toBeNull();
    expect(target.querySelector(".ph-new")).not.toBeNull();
    expect(target.querySelector(".ph-trail-button, .ph-trail")).not.toBeNull();
  });

  it("shows the loaded page's what-matters-now", async () => {
    api.getOrCreateToday.mockResolvedValue(
      withLines(pageRow({ what_matters_now: "finish chapter 4" })),
    );

    const { target } = render(ShellApp);
    await settle();

    expect(focusLineText(target)).toBe("finish chapter 4");
  });

  it("says on the header how many pins the page's pins list holds", async () => {
    // The third device pass: "we don't know how much pin associated to
    // current trail". Measured from the same `getPins` the pins screen
    // reads (pin-count.js), so the number agrees with the next screen.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const { target } = render(ShellApp);
    await settle();

    expect(api.getPins).toHaveBeenCalledWith("L1");
    expect(target.querySelector(".ph-pins").textContent.trim()).toBe("pins · 3");
  });

  it("says pins alone on an untrailed page, and counts nothing there", async () => {
    // An untrailed page's list is every untrailed pin app-wide — a heap,
    // not a trail — and a number over it would state the pile. Asserted
    // uncalled as well as unsaid, the toast test's pairing.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    api.getPins.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const { target } = render(ShellApp);
    await settle();

    expect(target.querySelector(".ph-pins").textContent.trim()).toBe("pins");
    expect(api.getPins).not.toHaveBeenCalledWith(null);
  });

  // A pull re-reads the open page and patches its focus line from the row.
  // The writer's own line is patched in at once and written a moment later,
  // so a pull read that landed in between brought back the line from before
  // and the field went blank under the writer (sync journey J5.3 on the A16,
  // 2026-10-24, on a living document where pulls are frequent).
  it("keeps the line the writer just set when a pull's read lands before it is written", async () => {
    const row = withLines(pageRow({ what_matters_now: "" }));
    api.getOrCreateToday.mockResolvedValue(row);
    let finishWrite;
    api.updateWhatMattersNow.mockImplementation(() => new Promise((r) => { finishWrite = r; }));
    api.getPage.mockResolvedValue(withLines(pageRow({ what_matters_now: "" })));
    const { target } = render(ShellApp);
    await settle();

    const input = target.querySelector('.ps-wmn input[aria-label="what matters now"]');
    input.value = "chapter four, the flood";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("blur"));
    await settle();

    events.handlers["sync-pulled"]();
    await settle();
    await settle();
    finishWrite();
    await settle();

    expect(focusLineText(target)).toBe("chapter four, the flood");
  });

  // The other order: the read leaves before the write lands and comes back
  // after it. It still holds the line from before.
  it("keeps the line when a read that left before the write comes back after it", async () => {
    const row = withLines(pageRow({ what_matters_now: "" }));
    api.getOrCreateToday.mockResolvedValue(row);
    let finishRead;
    api.getPage.mockImplementation(() => new Promise((r) => { finishRead = () => r(withLines(pageRow({ what_matters_now: "" }))); }));
    const { target } = render(ShellApp);
    await settle();

    events.handlers["sync-pulled"]();
    await settle();
    const input = target.querySelector('.ps-wmn input[aria-label="what matters now"]');
    input.value = "chapter four, the flood";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("blur"));
    await settle();
    finishRead();
    await settle();
    await settle();

    expect(focusLineText(target)).toBe("chapter four, the flood");
  });

  it("writes the focus line when the writer leaves it changed, and not when they only pass through", async () => {
    const row = withLines(pageRow({ what_matters_now: "finish chapter 4" }));
    api.getOrCreateToday.mockResolvedValue(row);
    const { target } = render(ShellApp);
    await settle();

    const input = target.querySelector('.ps-wmn input[aria-label="what matters now"]');
    expect(input).not.toBeNull();
    // A blur is not an edit (focus-line.js): passing through the field
    // writes nothing, or every tap off the title would out-clock the real
    // one on another device.
    input.dispatchEvent(new FocusEvent("blur"));
    await settle();
    expect(api.updateWhatMattersNow).not.toHaveBeenCalled();

    input.value = "finish chapter 5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("blur"));
    await settle();
    expect(api.updateWhatMattersNow).toHaveBeenCalledTimes(1);
    expect(api.updateWhatMattersNow).toHaveBeenCalledWith(row.page.id, "finish chapter 5");
    // The row is patched in place, so the field holds the new line and
    // the next blur on it is a pass-through again.
    expect(focusLineText(target)).toBe("finish chapter 5");
    input.dispatchEvent(new FocusEvent("blur"));
    await settle();
    expect(api.updateWhatMattersNow).toHaveBeenCalledTimes(1);
  });

  it("keeps the whole frame on screen when the load rejects", async () => {
    // A failed load must look like an empty page, not a white screen. This
    // is the requirement because the shell is opt-in on real phones behind
    // `try the new shell`: a tester whose database throws on read gets a
    // blank rectangle with no tab bar, so no way back to settings to turn
    // the flag off again. Asserting the root, the header and the tab bar
    // specifically — the three things that are the way out.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    api.getOrCreateToday.mockRejectedValue(new Error("database is locked"));

    const { target } = render(ShellApp);
    await settle();

    expect(target.querySelector(".shell-root")).not.toBeNull();
    expect(target.querySelector(".shell-tabbar")).not.toBeNull();
    expect(target.querySelector(".shell-screen")).not.toBeNull();
    expect(target.querySelector(".ph-date-label").textContent).toBe("today");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("keeps the page it loaded when a follow-up call rejects", async () => {
    // The count is asked for AFTER the page lands, so a throw there must
    // not take the page down with it. Written because the obvious shape —
    // assign everything at the end of one try block — loses a page that
    // was already in hand.
    //
    // The trail lookup used to run after the page too, and this comment
    // said so. Task 3b moved it BEFORE the assignment, because EditorCore
    // reads trailMode once at mount: published late, a continuous page
    // mounted unbound by timing with every prop correct. The rejection
    // this test drives is the count's, which is still the later call.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ date: LONG_AGO })));
    api.getFocusesForDate.mockRejectedValue(new Error("no such table"));

    const { target } = render(ShellApp);
    await settle();

    expect(target.querySelector(".ph-date-label").textContent).toContain("jan");
    err.mockRestore();
  });

  it("carries no exit in the strip, because there is nothing to escape", async () => {
    // The strip used to hold a chevron that blurred the field, for the
    // lockout it was the only way out of: on a Galaxy A34 the shell went on
    // believing a keyboard was up after it had gone (every viewport number
    // short, at zoom 1.00), the slot kept the editor strip, and page, memory
    // and settings could not be reached without restarting the app.
    //
    // The band is two rows now and the nav row cannot be taken away, so the
    // chevron's remaining jobs were a keyboard the system back button
    // already dismisses and a stale belief goRoot now clears. This asserts
    // it did not quietly come back — along with a seventh control in a row
    // whose layout rule counts six.
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settle();
    expect(target.querySelector(".shell-toolbar-dismiss")).toBeNull();
    expect(target.querySelector(".shell-tabbar")).not.toBeNull();
  });

  it("passes keyboardOpen down to the page screen", async () => {
    // PageScreen has no getter to read, so this is asserted through what
    // keyboardOpen still changes: the bottom slot. With the keyboard up it
    // holds the editor's own strip; with it down, navigation
    // (toolbar-model.js). App.svelte already tracks the flag; before this
    // task it rendered <S /> with no props, so the shell's copy was false
    // forever and nothing downstream could react to the keyboard at all.
    //
    // It used to be asserted through the header folding, until the device
    // pass took that away: the keyboard no longer collapses the nav,
    // because that row is how a writer adds a page or changes the trail
    // and a wrong keyboardOpen stranded them (nav-collapse.js).
    const open = render(ShellApp, { editing: true, keyboardOpen: true });
    await settle();
    expect(open.target.querySelector('[data-button-id="insert"]')).not.toBeNull();

    const shut = render(ShellApp, { keyboardOpen: false });
    await settle();
    expect(shut.target.querySelector('[data-button-id="insert"]')).toBeNull();
    expect(shut.target.querySelector(".ph-line2")).not.toBeNull();
  });

  it("lets an explicit prop override the loaded page", async () => {
    // The P2a props are kept as overrides so a harness can pin the header
    // without a backend. Their documented limit is that null reads as
    // absent, not as an override — only a non-null value wins.
    const { target } = render(ShellApp, { dateLabel: "pinned" });
    await settle();
    expect(target.querySelector(".ph-date-label").textContent).toBe("pinned");
  });
});

// The slot is modal from P2c on, and every test here drives it through the
// two things that actually decide it on a phone: the keyboard flag, and a
// real ProseMirror selection dispatched on the real EditorCore this shell
// mounts. Nothing reaches into ShellApp to set a strip.
describe("ShellApp — the modal slot", () => {
  it("keeps the tab bar while the keyboard is down", async () => {
    // Row 3. With no keyboard there is no editing context, so the slot
    // belongs to navigation whatever the editor is doing — and this is the
    // only state the shell had before P2c, so it is also the regression
    // guard on everything below not stealing the bar.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { keyboardOpen: false });
    await settleWithEditor();

    expect(target.querySelector(".shell-tabbar")).not.toBeNull();
    expect(target.querySelector(".shell-toolbar-strip")).toBeNull();
  });

  it("shows the block strip when the keyboard is up and the caret is in text", async () => {
    // Row 6. Asserting the strip's OWN buttons rather than merely that a
    // strip exists: the two strips render from the same component, so
    // "a .shell-toolbar-strip is on screen" is satisfied by either one.
    //
    // The WHOLE list, since the visual pass: six, in toolbarFor's order,
    // with nothing hidden on a written paragraph of an open page — `type`
    // has a paragraph's two targets (turn-into-model.js), `pin` has a
    // block with content, `insert` has a page it may write to. `list` and
    // `keyboard-down` are asserted absent by name rather than left to the
    // equality, because each left for a recorded reason (BLOCK_STRIP's
    // comment) and a reader of a red diff should see which came back.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    // The nav row is UNDER the strip, not replaced by it. This assertion
    // used to read `toBeNull()` and that is what shipped the lockout: a
    // webview that believed a keyboard was up had no tab bar, and this
    // test called it correct.
    expect(target.querySelector(".shell-tabbar")).not.toBeNull();
    const ids = buttonIds(target);
    expect(ids).toEqual(["insert", "type", "bold", "italic", "pin", "undo"]);
    expect(ids).not.toContain("list");
    expect(ids).not.toContain("keyboard-down");
    expect(ids).not.toContain("pin-selection");
  });

  it("keeps the editing strip on a device that has shown no soft keyboard", async () => {
    // THE REPORTS, in order: "the insert toolbar disappear" (the strip was
    // keyed on the keyboard, and dismissing it took every editing control
    // away), then "the insert stay always at bottom even keyboard is active"
    // (keyed on the caret, it would not leave). The rule is both now — and
    // `imeSeen` is the third input, because "not up right now" and "this
    // device has no soft keyboard" are different facts.
    //
    // THIS IS THE SECOND ONE. A caret, no keyboard, and none has ever been
    // reported: a Bluetooth or case keyboard, DeX, a Chromebook — or an
    // Android 15 build where the native publisher did not land, since nothing
    // else on that window can report an IME. The writer gets their controls.
    //
    // The keyboard-went-away case is toolbar-model.test.js's, not this file's:
    // ShellApp latches `imeSeen` from `keyboardOpen`, and the test helper
    // mounts with fixed props, so the up-then-down sequence cannot be driven
    // from here. Stated rather than silently skipped.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: false });
    await settleWithEditor();

    expect(target.querySelector(".shell-toolbar-strip")).not.toBeNull();
    expect(target.querySelector(".shell-tabbar")).not.toBeNull();
  });

  it("reaches memory with the keyboard flag stuck true and the viewport lying", async () => {
    // THE GALAXY A34, and the flag stuck true with no keyboard on screen is
    // not a contrived prop — it is what that webview reported, at zoom 1.00,
    // for the rest of the session. Every viewport-height API froze at the
    // keyboard-up value (411 on a screen painting ~740) and never grew back,
    // so keyboard-state's baseline arithmetic could not tell a stale
    // viewport from a real keyboard, and neither could any rule written over
    // it. The heartbeat and the tap-to-remeasure both re-read the same
    // frozen number. See the pair of cases in keyboard-state.test.js for the
    // producer side: the belief really is reachable and really is permanent.
    //
    // The shell's answer is not to measure better. It is that no belief
    // about a keyboard decides whether navigation exists.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    // The editing context the device believed in is on screen...
    expect(buttonIds(target)).toEqual(["insert", "type", "bold", "italic", "pin", "undo"]);

    // ...and navigation is on screen UNDER it, in the same band.
    const slot = target.querySelector(".shell-slot");
    expect(slot.querySelector(".shell-toolbar-strip")).not.toBeNull();
    const tabbar = slot.querySelector(".shell-tabbar");
    expect(tabbar).not.toBeNull();
    expect(slot.children[0].querySelector(".shell-toolbar-strip")).not.toBeNull();
    expect(slot.children[1].querySelector(".shell-tabbar")).not.toBeNull();

    // And it WORKS, which is the half an existence check cannot claim. The
    // A34 could see no tab bar at all; a tab bar that renders and does not
    // route would be the same lockout one layer up.
    tabbar.querySelector('[data-tab-id="memory"]').click();
    flushSync();
    expect(target.querySelector('.shell-tabbar [aria-current="page"]').dataset.tabId).toBe("memory");
  });

  it("swaps to the selection strip when text is selected", async () => {
    // Row 5, driven by a real selection rather than by a flag. The two
    // strips share bold and italic, so the assertion has to be on what
    // separates them: pin-selection and copy appear on this one only, and
    // undo disappears with the block strip it belongs to (it is the block
    // strip's last control now that keyboard-down is gone).
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    expect(buttonIds(target)).toContain("undo");

    selectText(editorOf(target), 1, 5);

    const ids = buttonIds(target);
    expect(ids).toContain("pin-selection");
    expect(ids).toContain("copy");
    expect(ids).not.toContain("undo");
  });

  it("runs the command on the editor when a strip button is tapped", async () => {
    // The whole point of holding the instance a band above the canvas.
    // Asserted on the DOCUMENT, not on a spy: a handler that fired and
    // marked nothing is exactly the no-op the plan forbids, and a spy on
    // onPress cannot tell the two apart.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = editorOf(target);
    selectText(ed, 1, 5);
    expect(ed.isActive("bold")).toBe(false);

    tap(target, "bold");

    expect(ed.isActive("bold")).toBe(true);
    // And the strip says so back. activeIdsFor is fed marks read off the
    // editor and keyed on the snapshot, so a strip that stayed unpressed
    // here would mean the read never re-runs — the failure mode where the
    // first paint's marks are the only ones the writer ever sees.
    expect(target.querySelector('[data-button-id="bold"]').getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("leaves an id with no command off the strip rather than letting it eat the tap", async () => {
    // A live button that does nothing gives the writer no feedback either
    // way, which is the same failure as a no-op callback — so the absence
    // of a command has to be visible. It used to be visible as a GREY
    // button; since the visual pass it is visible as no button, on the
    // rule that a control which cannot apply here is not drawn (toolbar-
    // state.js's `stripPresence`; ShellApp's `unavailableIds`). The
    // model still lists `link` (toolbarFor's selection strip carries it),
    // so this asserts the host dropped it between the model and the DOM.
    //
    // `link` is the witness because it is the ONLY id left on any strip
    // with no COMMANDS entry: it wants somewhere to type a URL, and the
    // shell has nowhere. It is on the selection strip and not the block
    // strip, which is why this test drives a selection to look for it.
    // bold is asserted present and live alongside, because a strip that
    // hid EVERYTHING would pass the `link` half on its own.
    //
    // `insert` and then `pin` used to head this list and now assert the
    // OPPOSITE, which is the point of leaving them here rather than
    // deleting them: the unavailable set is DERIVED from the command
    // table, so the day a command lands its button has to appear on its
    // own. A test that only ever watched ids stay off could not tell a
    // working derivation from a hardcoded list of three.
    //
    // Proven red: with the ToolbarStrip fed `toolbar.buttons` instead of
    // `presence.shown`, `link` renders and the null assertion fails.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    expect(target.querySelector('[data-button-id="pin"]').disabled).toBe(false);
    expect(target.querySelector('[data-button-id="insert"]').disabled).toBe(false);
    expect(target.querySelector('[data-button-id="bold"]').disabled).toBe(false);

    selectText(editorOf(target), 1, 5);

    expect(buttonIds(target)).toContain("copy");
    expect(target.querySelector('[data-button-id="link"]')).toBeNull();
    expect(target.querySelector('[data-button-id="bold"]').disabled).toBe(false);
    expect(target.querySelector('[data-button-id="pin-selection"]').disabled).toBe(false);
  });

  it("copies the selected text", async () => {
    api.getOrCreateToday.mockResolvedValue(textPage());
    const clip = stubClipboard();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    selectText(editorOf(target), 1, 5);
    tap(target, "copy");
    await Promise.resolve();

    expect(clip.writeText).toHaveBeenCalledWith("kept");
    clip.restore();
  });

  it("leaves the clipboard alone when the selection carries no text", async () => {
    // Not a "nothing happens" assertion dressed up. Task 1's review let
    // copy stay enabled on the reasoning that an empty copy is a harmless
    // no-op where an empty pin is a permanent artifact — and that is only
    // true because of the guard this drives. Without it the handler writes
    // the empty string, and writeText("") does not decline: it CLEARS
    // whatever the writer had on their clipboard.
    //
    // Driven through a selected divider rather than a collapsed caret,
    // because a collapsed caret takes the strip off screen with it. A node
    // selection on an atom is a NON-empty selection that yields no text,
    // which is the case the selection strip can actually present.
    api.getOrCreateToday.mockResolvedValue(textPage([{ type: "horizontalRule" }]));
    const clip = stubClipboard();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = editorOf(target);
    // Found by walking the doc rather than by arithmetic off its size:
    // ProseMirror appends a trailing empty paragraph after a doc that ends
    // in an atom, so "the last position" is not where the divider is.
    let rulePos = -1;
    ed.state.doc.forEach((node, offset) => {
      if (node.type.name === "horizontalRule") rulePos = offset;
    });
    expect(rulePos).toBeGreaterThan(-1);
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, rulePos)));
    flushSync();
    expect(buttonIds(target)).toContain("copy");

    tap(target, "copy");
    await Promise.resolve();

    expect(clip.writeText).not.toHaveBeenCalled();
    clip.restore();
  });

  it("undoes an edit, and opens already live on a step nobody typed", async () => {
    // disabledIdsFor's canUndo branch reaching the slot for the first time,
    // and it did not answer what this test was first written to assert.
    //
    // "A freshly opened page has nothing to undo" is false. EditorCore
    // constructs the editor WITH the page's content and then its
    // page-switch effect calls setContent with the same content again
    // (EditorCore:461), as an ordinary history-tracked transaction — so
    // undo is live from the first frame, on a step the writer did not make.
    // Written down rather than asserted away because the button is right on
    // its own terms: the step is a replace of the doc by itself, so pressing
    // it changes nothing, which the assertion below pins. It stops being
    // harmless the day that setContent is handed content differing from the
    // constructor's, and then the first press blanks the page.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    const opened = JSON.stringify(ed.getJSON());

    expect(target.querySelector('[data-button-id="undo"]').disabled).toBe(false);
    tap(target, "undo");
    expect(JSON.stringify(ed.getJSON())).toBe(opened);

    // The half that is the actual requirement: an edit on the page is
    // undoable from the strip. Made by a transaction rather than by a strip
    // button, because since the visual pass no button on the block strip
    // edits the document directly with a collapsed caret — `list` went
    // under `turn into`, and bold/italic on a collapsed caret set a stored
    // mark, not a history step. The strip-made edit is covered where the
    // sheet harness lives: "undoes a turn into from the strip" in the
    // block sheet describe.
    ed.chain().insertContentAt(1, "more ").run();
    flushSync();
    expect(ed.state.doc.firstChild.textContent).toBe("more kept going");

    tap(target, "undo");
    expect(ed.state.doc.firstChild.textContent).toBe("kept going");
  });

  it("keeps undo on the strip, dead, when there is nothing to undo", async () => {
    // THE LINE BETWEEN HIDDEN AND DEAD, from the host's side. `pin` on an
    // empty block and `insert` on a closed page are gone from the strip;
    // `undo` with an empty history stack must not be, or the strip would
    // change shape on the writer's first keystroke (toolbar-state.js's
    // test "would be wrong to hide undo" says why). Reached by draining the
    // history the mount dirtied — the test above records that a fresh page
    // opens with one step on it — so the state is a real one rather than a
    // fabricated snapshot.
    //
    // Proven red: moving `disabledIdsFor(snapshot)` from `disabledIds` to
    // `unavailableIds` in ShellApp hides the button, and the first
    // assertion fails on null.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);

    tap(target, "undo");
    expect(ed.can().undo()).toBe(false);

    const undo = target.querySelector('[data-button-id="undo"]');
    expect(undo).not.toBeNull();
    expect(undo.disabled).toBe(true);
    expect(buttonIds(target)).toEqual(["insert", "type", "bold", "italic", "pin", "undo"]);
  });

  it("takes pin off the strip on an empty block, and the strip is five wide", async () => {
    // The block strip's own hidden case, asserted as the whole list. A
    // pin is a permanent artifact and an empty paragraph has nothing to
    // keep, so `pin` is absent there — not dead, since nothing about the
    // moment changes the answer; the writer's way to a live `pin` is to
    // write something. Five controls, in the order the six had, minus one.
    // The re-appearance is asserted in the pin describe ("hides pin on an
    // empty block, and shows it on the next word typed").
    //
    // Proven red: with `livePinIntent ? [] : ["pin"]` moved from
    // `unavailableIds` to `disabledIds`, `pin` renders dead and the list
    // is six long.
    api.getOrCreateToday.mockResolvedValue(
      withLines(pageRow({ content_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }) })),
    );
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    expect(buttonIds(target)).toEqual(["insert", "type", "bold", "italic", "undo"]);
  });
});

// The pin, and confirmPin's first call from a phone. The desktop has
// called it since the EditorCore split, so this is not a virgin export —
// but the shell reaches it down a different route (through `onCore`, from
// a strip a band above the canvas) and with a different answer to the one
// question the core declines to answer, so "the desktop uses it" is no
// evidence it works from here.
//
// EVERY ASSERTION BELOW IS ON THE PIN ROW, not on "no error thrown". A
// createPin spy that merely FIRED would be green for a pin whose title is
// undefined, whose category is wrong, and whose content is a JSON string
// of the whole document — three shipped defects that a call-count check
// cannot distinguish from correct behaviour. So the mock keeps a ledger
// and the tests read rows back out of it, which is as close to the
// database as jsdom gets: the api boundary is where this suite stops.
describe("ShellApp — the pin", () => {
  afterEach(restorePinMocks);

  it("writes a pin row for the block the caret is in", async () => {
    api.getOrCreateToday.mockResolvedValue(textPage());
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    tap(target, "pin");
    await settlePin();

    expect(rows).toHaveLength(1);
    const [row] = rows;
    // Every column the shell is responsible for. The page id is the one
    // the load handed down (pageRow's "p1"), which is what makes this a
    // pin OF this page rather than a row floating free of it.
    expect(row.source_page_id).toBe("p1");
    expect(row.lineage_id).toBeNull();
    expect(row.object_type).toBe("note");
    expect(row.title).toBe("kept going");
    // Content is the NODE's json, not the DOM's text and not the whole
    // document: one top-level child, the paragraph the caret was in.
    const doc = JSON.parse(row.content);
    expect(doc.type).toBe("doc");
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe("paragraph");
    expect(doc.content[0].content[0].text).toBe("kept going");
  });

  it("stamps the new pin's id onto the block it came from", async () => {
    // The other half of a pin reaching the database: the row points at
    // the page, and the page points back at the row. Without the stamp,
    // refresh_pin_caches orphans the pin on the next launch (EditorCore's
    // own note at :739) — a pin that exists and reads as deleted.
    //
    // Asserted after an await for P2e's reason, and the reason is not
    // hypothetical here: the stamp is dispatched inside confirmPin AFTER
    // createPin resolves, so the same-turn read sees the pre-stamp doc.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = editorOf(target);
    expect(ed.state.doc.firstChild.attrs.pinId).toBeNull();

    tap(target, "pin");
    await settlePin();

    expect(ed.state.doc.firstChild.attrs.pinId).toBe(rows[0].id);
    // And the stamp is PERSISTED, not merely live in the doc. This is the
    // whole reason confirmPin flushes rather than leaving the 1s debounce
    // to it (EditorCore:739): refresh_pin_caches orphans any pin whose id
    // is absent from the SAVED content_json, so a page closed before the
    // debounce fires would relaunch with the pin dimmed like a deletion.
    // The doc-level assertion above cannot see that — it reads the live
    // editor, which is exactly what a lost save leaves intact.
    const saved = api.savePageContent.mock.calls.at(-1);
    expect(saved[0]).toBe("p1");
    expect(JSON.parse(saved[1]).content[0].attrs.pinId).toBe(rows[0].id);
  });

  it("pins from a closed page, and pays the stamp into it", async () => {
    // A past page is read-only (CLAUDE.md) and `insert` is dead there for
    // exactly that reason — but a past page's block is still PINNABLE,
    // which is the desktop's rule and the one already written down beside
    // READONLY_ROWS. So `pin` is deliberately NOT gated on readonly, and
    // this is what that costs, stated rather than left to be discovered:
    // pinning dispatches a stamp into a document the writer cannot edit
    // and flushes it to disk. The page's prose is untouched; one node
    // attribute is not.
    //
    // Driven because it is the phone's own risk, not the desktop's: the
    // shell shows the block strip on a closed page (`insert` and `type`
    // leave it, being writes; `pin` stays), so the pin button is one tap
    // away there in a way the desktop's hover gutter is not.
    //
    // `insert` is asserted ABSENT, by null, since the visual pass: a page
    // that is closed for good is "cannot apply" rather than "not right
    // now", so the `+` is not drawn rather than drawn dead. Proven red by
    // moving `readonly ? ["insert"] : []` from `unavailableIds` to
    // `disabledIds` — the button renders, dead, and the null fails.
    api.getOrCreateToday.mockResolvedValue(
      withLines(pageRow({ is_open: false, content_json: textPage().page.content_json })),
    );
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = editorOf(target);
    expect(ed.isEditable).toBe(false);
    expect(target.querySelector('[data-button-id="insert"]')).toBeNull();
    expect(target.querySelector('[data-button-id="pin"]').disabled).toBe(false);

    tap(target, "pin");
    await settlePin();

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("kept going");
    expect(ed.state.doc.firstChild.attrs.pinId).toBe(rows[0].id);
  });

  it("names a board by its kind rather than by its run-together items", async () => {
    // node.textContent joins a list's items with NOTHING, so the text of
    // this two-item list is "milkeggs". pin-intent.js's header measures
    // that and takes the kind instead; this is the end-to-end proof that
    // the descriptor ShellApp builds actually carries what the module
    // needs to make that call — the shape-in-between that toolbar-state's
    // header records going unread for a whole phase.
    api.getOrCreateToday.mockResolvedValue(
      withLines(
        pageRow({
          content_json: JSON.stringify({
            type: "doc",
            content: [
              {
                type: "list",
                content: [
                  { type: "listItem", attrs: { marker: "bullet" }, content: [{ type: "paragraph", content: [{ type: "text", text: "milk" }] }] },
                  { type: "listItem", attrs: { marker: "bullet" }, content: [{ type: "paragraph", content: [{ type: "text", text: "eggs" }] }] },
                ],
              },
            ],
          }),
        }),
      ),
    );
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = editorOf(target);
    expect(ed.state.doc.firstChild.type.name).toBe("list");
    expect(ed.state.doc.firstChild.textContent).toBe("milkeggs");

    tap(target, "pin");
    await settlePin();

    expect(rows[0].title).toBe("list");
    expect(rows[0].object_type).toBe("board");
    // A board is re-serialised by the core after the stamp, so the STORED
    // content carries the pinId too — the note path above does not, and
    // that asymmetry is the core's (`category !== "note"`, EditorCore:718).
    expect(JSON.parse(rows[0].content).content[0].attrs.pinId).toBe(rows[0].id);
  });

  it("pins the selected words and calls the pin by them", async () => {
    api.getOrCreateToday.mockResolvedValue(textPage());
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    // "kept" — the first four characters of the only paragraph.
    selectText(editorOf(target), 1, 5);
    tap(target, "pin-selection");
    await settlePin();

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("kept");
    // The content is the WHOLE paragraph, not the four selected
    // characters, and that is the behaviour rather than a bug: confirmPin
    // stamps top-level positions and half a paragraph has none. The
    // desktop's handlePinSelection does the same.
    expect(JSON.parse(rows[0].content).content[0].content[0].text).toBe("kept going");
    // One paragraph, so a note — where the desktop's selection path calls
    // every selection a board. pin-intent.js's header argues the split.
    expect(rows[0].object_type).toBe("note");
  });

  it("pins a line that is only a file as a file, named by the file", async () => {
    // The descriptor's two attachment fields, end to end. `isAttachment`
    // is soleAttachmentNode's answer and NOT isAttachmentBlockNode's: a
    // line mixing words with an inline file is a line, and calling it a
    // file would make the row render a 📎 chip handing the blob to the OS
    // instead of showing what was written (pin-display.js's isFilePin).
    //
    // Worth driving through the real editor rather than trusting the
    // module test: an attachment is schema-INLINE, so the pinnable block
    // is the paragraph wrapping it, and every field here is read one
    // level down from the node ShellApp starts at. block-pin-guard.js's
    // second header records what happened the last time two pin paths
    // disagreed about where an attachment lives.
    api.getOrCreateToday.mockResolvedValue(
      withLines(
        pageRow({
          content_json: JSON.stringify({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "attachment",
                    attrs: {
                      kind: "file",
                      blob_hash: "h1",
                      filename: "budget.pdf",
                      mime_type: "application/pdf",
                      size_bytes: 12,
                      sync: false,
                    },
                  },
                ],
              },
            ],
          }),
        }),
      ),
    );
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = editorOf(target);
    // The line has NO text of its own — an attachment is an inline atom,
    // so the text walk skips it. That is precisely why mayPinBlock has an
    // exemption, and why a text-based guard would render this dead.
    expect(ed.state.doc.firstChild.textContent).toBe("");
    expect(target.querySelector('[data-button-id="pin"]').disabled).toBe(false);

    tap(target, "pin");
    await settlePin();

    expect(rows[0].object_type).toBe("file");
    expect(rows[0].title).toBe("budget.pdf");
    // The attachment node survives into the pin, rather than being
    // flattened to the empty string its text walk produces.
    const doc = JSON.parse(rows[0].content);
    expect(doc.content[0].content[0].type).toBe("attachment");
    expect(doc.content[0].content[0].attrs.blob_hash).toBe("h1");
  });

  it("pins two paragraphs a range crosses as one board", async () => {
    // The multi-block half of the selection rule, which the single-block
    // test above cannot reach: two blocks kept together are a composite,
    // and `board` is what makes the row open the artifact modal and carry
    // a per-kind chip. Both positions must be stamped, or the second
    // paragraph is content in a pin that points at nothing.
    api.getOrCreateToday.mockResolvedValue(
      textPage([{ type: "paragraph", content: [{ type: "text", text: "and then" }] }]),
    );
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = editorOf(target);
    // From inside the first paragraph to inside the second.
    selectText(ed, 6, 16);
    tap(target, "pin-selection");
    await settlePin();

    expect(rows).toHaveLength(1);
    expect(rows[0].object_type).toBe("board");
    expect(JSON.parse(rows[0].content).content).toHaveLength(2);
    expect(ed.state.doc.child(0).attrs.pinId).toBe(rows[0].id);
    expect(ed.state.doc.child(1).attrs.pinId).toBe(rows[0].id);
  });

  it("says why a selection over an already-pinned block cannot be pinned", async () => {
    // The button used to go dead on this range with nothing said, and the
    // writer read it as "select multiple blocks, pin is not working"
    // (2026-10-28). It stays live, pressing it says why, and the pin the
    // second paragraph already belongs to keeps its stamp.
    api.getOrCreateToday.mockResolvedValue(
      textPage([{ type: "paragraph", attrs: { pinId: "old" }, content: [{ type: "text", text: "and then" }] }]),
    );
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = editorOf(target);
    selectText(ed, 6, 16);
    expect(target.querySelector('[data-button-id="pin-selection"]').disabled).toBe(false);
    tap(target, "pin-selection");
    await settlePin();

    expect(rows).toHaveLength(0);
    expect(target.querySelector(".shell-toast")?.textContent).toContain(PART_PINNED);
    expect(ed.state.doc.child(1).attrs.pinId).toBe("old");
  });

  it("pins a table from a caret inside one of its cells", async () => {
    // A caret inside a table cell sits two levels below the table, and
    // the pin must still find the top-level block: a table is pinned
    // whole, like any block the caret is in. (J13.6 edits such a pin's
    // cell from the pins screen; this is the half before it.)
    const cell = (text) => ({ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    api.getOrCreateToday.mockResolvedValue(
      textPage([{ type: "table", content: [{ type: "tableRow", content: [cell("monday"), cell("the early ferry")] }] }]),
    );
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = editorOf(target);
    let pos = null;
    ed.state.doc.descendants((n, p) => {
      if (pos === null && n.isText && n.text === "monday") pos = p + 2;
      return pos === null;
    });
    ed.commands.setTextSelection(pos);
    flushSync();
    tap(target, "pin");
    await settlePin();

    expect(rows).toHaveLength(1);
    expect(ed.state.doc.child(1).type.name).toBe("table");
    expect(ed.state.doc.child(1).attrs.pinId).toBe(rows[0].id);
  });

  it("pins a block again once the pin its stamp names was deleted", async () => {
    // Unpinning leaves the stamp on the page by design, and a stamp naming
    // a deleted pin must not stop the block being kept again
    // (block-already-pinned.js). The phone counted every stamp, so a block
    // pinned once and unpinned could never be pinned again.
    api.getPinForReference.mockImplementation((id) => Promise.resolve(id === "gone" ? null : { id }));
    api.getOrCreateToday.mockResolvedValue(
      textPage([{ type: "paragraph", attrs: { pinId: "gone" }, content: [{ type: "text", text: "and then" }] }]),
    );
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    await settle();

    const ed = editorOf(target);
    selectText(ed, 6, 16);
    tap(target, "pin-selection");
    await settlePin();

    expect(rows).toHaveLength(1);
    expect(ed.state.doc.child(1).attrs.pinId).toBe(rows[0].id);
  });

  it("takes the pin control off a block it has already pinned", async () => {
    // The defect this stops is not a duplicate row, it is a LOST one. A
    // node holds one pinId; confirmPin overwrites it, so a second press
    // would move the first pin's stamp onto the second pin and leave the
    // first orphaned on the next launch — dimmed, "like deleted"
    // (EditorCore:741). Driven end to end because the guard depends on
    // the stamp actually reaching the doc, which only the real core does.
    //
    // Asserted on the STRIP as well as on the ledger. The refusal has to
    // be visible or it is the "tap does nothing" report TipTapEditor:1799
    // records. It used to be visible as a dead button; since the visual
    // pass the control LEAVES the strip on a kept block — a fact about the
    // block, not the moment, so it is "cannot apply" (ShellApp's
    // `unavailableIds`) — and the toast is what says "kept". There is no
    // button to press a second time, which is the assertion: a second row
    // cannot be asked for from here.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    expect(target.querySelector('[data-button-id="pin"]').disabled).toBe(false);

    tap(target, "pin");
    await settlePin();
    expect(rows).toHaveLength(1);

    expect(target.querySelector('[data-button-id="pin"]')).toBeNull();
    expect(buttonIds(target)).toEqual(["insert", "type", "bold", "italic", "undo"]);
    // And the first pin still owns its stamp — the assertion that would
    // catch a second row being written without the strip noticing.
    expect(rows).toHaveLength(1);
    expect(editorOf(target).state.doc.firstChild.attrs.pinId).toBe(rows[0].id);
  });

  it("hides pin on an empty block, and shows it on the next word typed", async () => {
    // The gate, and both directions of it. A pin is a permanent artifact:
    // pinning the empty paragraph the caret sits in half the time writes
    // a row with no title, no snippet and no content — the "'untitled'
    // card that says nothing" block-pin-guard.js exists for. Since the
    // visual pass the control is ABSENT there rather than dead (the strip
    // describe asserts the five-wide strip); this is the return leg.
    //
    // The second half is what stops this being a hardcoded "pin is never
    // there" passing by accident, the way the pre-P2f assertion did.
    //
    // The old press-anyway half is gone with the button: there is nothing
    // to tap. The command's own guard against an empty target is still
    // asserted by its selection twin below ("renders pin-selection dead on
    // a selection that holds nothing to pin"), which taps a dead button and
    // reads an empty ledger.
    api.getOrCreateToday.mockResolvedValue(
      withLines(pageRow({ content_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }) })),
    );
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    expect(target.querySelector('[data-button-id="pin"]')).toBeNull();
    expect(rows).toHaveLength(0);

    const ed = editorOf(target);
    ed.chain().insertContentAt(1, "something").run();
    flushSync();

    expect(target.querySelector('[data-button-id="pin"]').disabled).toBe(false);
    expect(buttonIds(target)).toEqual(["insert", "type", "bold", "italic", "pin", "undo"]);
  });

  it("renders pin-selection dead on a selection that holds nothing to pin", async () => {
    // A node selection on a divider is a NON-empty selection, so
    // disabledIdsFor's own guard passes it and the selection strip is on
    // screen — the exact state where a pin button would look live over a
    // block with no content in text, attrs or anywhere else. Driven the
    // same way the clipboard's twin case is, and for the same reason: a
    // collapsed caret would take the strip off screen with it.
    api.getOrCreateToday.mockResolvedValue(textPage([{ type: "horizontalRule" }]));
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = editorOf(target);
    let rulePos = -1;
    ed.state.doc.forEach((node, offset) => {
      if (node.type.name === "horizontalRule") rulePos = offset;
    });
    expect(rulePos).toBeGreaterThan(-1);
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, rulePos)));
    flushSync();

    expect(buttonIds(target)).toContain("pin-selection");
    expect(target.querySelector('[data-button-id="pin-selection"]').disabled).toBe(true);

    tap(target, "pin-selection");
    await settlePin();
    expect(rows).toHaveLength(0);
  });

  it("carries the page's trail onto the pin", async () => {
    // lineageId is the core's, read off the props PageScreen hands it —
    // so this is the one column the shell does not compute and the one
    // that would go null if the trail stopped travelling down. It is also
    // what makes pin × trail possible at all: a pin with no lineage_id
    // joins no trail.
    api.getOrCreateToday.mockResolvedValue(
      withLines(pageRow({ lineage_id: "L1", content_json: textPage().page.content_json })),
    );
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", mode: "discrete" }]);
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    tap(target, "pin");
    await settlePin();

    expect(rows[0].lineage_id).toBe("L1");
  });

  // ── the toast, and Toast's first call from the app ──────────────────
  //
  // Spec §3 (:225-227). NOT the desktop's `pinned · <title>`: this is a
  // breadcrumb saying where the pin landed and what was already there,
  // which is a different claim from a receipt for the press.
  //
  // Every assertion below reads the RENDERED STRING, not a spy on
  // getPins. A count fetch that merely FIRED would be green for a toast
  // showing a stale number, a hardcoded one, or the total instead of the
  // others — and a wrong number here is a claim about the writer's own
  // trail, made by the one surface they cannot check it against.

  /** The trailed fixture the count tests pin from: three paragraphs on a
   *  trail, so three pins can be taken from one page without re-pinning a
   *  block (which the stamp guard would refuse, correctly). */
  function trailedPage() {
    return withLines(
      pageRow({
        lineage_id: "L1",
        content_json: JSON.stringify({
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "kept going" }] },
            { type: "paragraph", content: [{ type: "text", text: "and then" }] },
            { type: "paragraph", content: [{ type: "text", text: "third" }] },
          ],
        }),
      }),
    );
  }

  /** Put the caret in a top-level paragraph by index, the way a tap in it
   *  would. A collapsed selection, so the BLOCK strip stays on screen and
   *  `pin` is the control under test rather than `pin-selection`. */
  function caretInBlock(ed, index) {
    let at = -1;
    let seen = 0;
    ed.state.doc.forEach((node, offset) => {
      if (seen === index && at === -1) at = offset + 1;
      seen += 1;
    });
    expect(at).toBeGreaterThan(-1);
    selectText(ed, at, at);
  }

  function toastText(target) {
    const el = target.querySelector(".shell-toast");
    return el ? el.textContent.trim() : null;
  }

  it("says what the pin joined, and the count moves with every pin", async () => {
    // Step 5 of the task, and the reason it is three pins rather than
    // one: a toast rendering a hardcoded or stale number passes a
    // single-pin test perfectly. The number has to MOVE, and all three
    // shapes of the sentence are on this path — a first pin joins
    // nothing, a second joins one, a third joins two. "joins 1 pins" is
    // the shipped-on-the-desktop failure this covers ("0 of 3" in the
    // find bar).
    //
    // The count is read from getPins AFTER each write — the ledger's
    // getPins returns the rows actually created — so a toast that showed
    // the total rather than the others would go red on all three lines.
    api.getOrCreateToday.mockResolvedValue(trailedPage());
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", mode: "discrete" }]);
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = editorOf(target);
    // The caret starts at the END of the loaded doc, not at its start —
    // measured, not assumed. Without this line the first pin lands on the
    // THIRD paragraph and the third press then finds a block it has
    // already pinned, which is how this test first went red. Every other
    // pin test in this file uses a one-paragraph fixture, where start and
    // end are the same block and the difference cannot show.
    caretInBlock(ed, 0);

    tap(target, "pin");
    await settlePin();
    expect(rows).toHaveLength(1);
    expect(toastText(target)).toBe("the first pin on the book trail");

    caretInBlock(ed, 1);
    tap(target, "pin");
    await settlePin();
    expect(rows).toHaveLength(2);
    expect(toastText(target)).toBe("joins 1 pin on the book trail");

    caretInBlock(ed, 2);
    tap(target, "pin");
    await settlePin();
    expect(rows).toHaveLength(3);
    expect(toastText(target)).toBe("joins 2 pins on the book trail");
  });

  it("puts the toast in the band that does not scroll", async () => {
    // Toast's header said it "lives in the content". The content band is
    // the SCROLL container, so a toast at the top of it is above the fold
    // for any writer who has scrolled — and a pin is taken wherever the
    // caret is. The one message the primitive exists for would have been
    // invisible on exactly the pages that need it, and no load-time
    // screenshot could show that: the VR harness scrolls to nothing.
    //
    // So this asserts placement, which is the only way the regression is
    // catchable at all. Moving the <Toast /> back below the nav snippet
    // fails the second line here.
    api.getOrCreateToday.mockResolvedValue(trailedPage());
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", mode: "discrete" }]);
    pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    tap(target, "pin");
    await settlePin();

    expect(toastText(target)).toBe("the first pin on the book trail");
    expect(target.querySelector(".shell-screen-nav .shell-toast")).not.toBeNull();
    expect(target.querySelector(".shell-screen-content .shell-toast")).toBeNull();
  });

  it("says nothing on an untrailed page, and does not count the untrailed heap", async () => {
    // A "nothing happens" assertion, so: an untrailed page joins NO
    // trail, and there is nothing for a breadcrumb to point at. The
    // number that exists for it — get_pins(null), which returns every pin
    // ever made on any untrailed page, app-wide and for all time
    // (commands.rs get_pins_inner's None arm) — is a heap rather than a
    // trail and has no name to put in the sentence. Reporting its size as
    // company the pin has joined would state the pile the product exists
    // to refuse.
    //
    // The writer is not left with a silent tap. Task 1's guard is the
    // confirmation on this path and it needs no trail: the pin control
    // goes DEAD on the block that was just kept, which the last two lines
    // assert alongside the silence — that pairing is what separates this
    // from the "tap does nothing" report TipTapEditor:1799 records.
    //
    // getPins is asserted UNCALLED as well as the toast being absent,
    // because those are two different bugs: rendering nothing while still
    // paying for a full scan of the untrailed heap on every pin would
    // pass a toast-only assertion.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    tap(target, "pin");
    await settlePin();

    expect(rows).toHaveLength(1);
    expect(rows[0].lineage_id).toBeNull();
    expect(toastText(target)).toBeNull();
    expect(api.getPins).not.toHaveBeenCalled();
    // The kept block's control has left the strip (absent, not dead, since
    // the visual pass) — on an untrailed page with no toast, that gap is
    // the only confirmation there is.
    expect(target.querySelector('[data-button-id="pin"]')).toBeNull();
    // The zero above is exact rather than approximate, and it is worth
    // knowing why it can be: EditorCore's own pin-cache load is guarded on
    // `lineageId !== prevLineageId` with both null (EditorCore:452), so an
    // untrailed page makes NO getPins call from anywhere. On a trailed
    // page it makes one, which is why the sibling test measures instead.
  });

  it("says nothing when the trail's name did not load", async () => {
    // A second "nothing happens" branch with its own reason: the page
    // carries a lineage_id, so the pin really did join a trail — but the
    // lineage read has its own try/catch in ShellApp and may leave the
    // name null while the id stands. A breadcrumb that cannot name where
    // it points is not a breadcrumb, and "joins 2 pins on the  trail" is
    // the string this branch exists to never render.
    api.getOrCreateToday.mockResolvedValue(trailedPage());
    api.getLineages.mockRejectedValue(new Error("no lineages"));
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    tap(target, "pin");
    await settlePin();

    // The pin itself is unaffected — it lands, on its trail.
    expect(rows).toHaveLength(1);
    expect(rows[0].lineage_id).toBe("L1");
    expect(toastText(target)).toBeNull();
  });

  it("says nothing when the pin did not land", async () => {
    // confirmPin catches its own failures and answers null
    // (EditorCore:747), so without the `if (!created) return` in
    // ShellApp's `pin` the count fetch runs anyway — and on a trail with
    // existing pins it would render "joins 3 pins" over a write that
    // threw. The worst of both: no pin, and a sentence saying otherwise.
    //
    // getPins is stubbed to a populated trail rather than to the ledger,
    // which is what makes the assertion meaningful: there IS a number to
    // report here, and reporting it would be the bug.
    api.getOrCreateToday.mockResolvedValue(trailedPage());
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", mode: "discrete" }]);
    api.createPin.mockRejectedValue(new Error("db is gone"));
    api.getPins.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]);
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    // Measured before the tap rather than asserted as zero, because
    // getPins already has ANOTHER caller on a trailed page: EditorCore
    // loads its pin cache once when lineageId first arrives
    // (EditorCore:452-457). That call is not this toast's, and a
    // `not.toHaveBeenCalled()` here would be red for the wrong reason —
    // it was, first time round.
    const fetches = api.getPins.mock.calls.length;

    tap(target, "pin");
    await settlePin();

    expect(toastText(target)).toBeNull();
    expect(api.getPins.mock.calls.length).toBe(fetches);
  });

  it("takes the breadcrumb away again on its own", async () => {
    // Toast has no lifetime — no timer, no dismiss, no state — which its
    // first real call is what made plain. The timer is ShellApp's, and
    // without it the breadcrumb outlives the pin it describes and goes on
    // asserting a count that later pins have moved past.
    //
    // Fake timers are installed AFTER the editor has settled, because the
    // load and EditorCore's mount both hop through real setTimeout(0)s;
    // from here on the clock is held, so the 4s expiry is driven rather
    // than waited for.
    api.getOrCreateToday.mockResolvedValue(trailedPage());
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", mode: "discrete" }]);
    pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    vi.useFakeTimers();
    tap(target, "pin");
    await vi.advanceTimersByTimeAsync(1);
    flushSync();
    expect(toastText(target)).toBe("the first pin on the book trail");

    // Still up a moment before it is due — the assertion that stops a
    // toast which never rendered at all from passing the line below.
    await vi.advanceTimersByTimeAsync(PIN_TOAST_MS - 100);
    flushSync();
    expect(toastText(target)).toBe("the first pin on the book trail");

    await vi.advanceTimersByTimeAsync(200);
    flushSync();
    expect(toastText(target)).toBeNull();
  });
});

// A pin that reads `source removed` on a page nobody removed. Reported from
// an Android device: pin a block on an untrailed page, open the pins screen,
// the row is `status: "orphaned"`.
//
// THE CAUSE IS TWO SAVES ON THE WIRE AT ONCE. Only two things orphan a pin
// (commands.rs): deleting its page, which the shell never does, and the
// sweep in refresh_pin_caches, which every save_page_content runs — any
// `open` pin whose id is absent from the SAVED content_json flips to
// orphaned, and a later save that carries the id flips it back. So the pin
// stays orphaned exactly when the LAST save the database applies is one
// without the stamp. The shell can produce that: typing schedules a save
// 1s out (EditorCore's debouncedSave); the pin button sits a tap away on
// the strip; and confirmPin's stamp lands only after `await createPin`, a
// round trip. If the debounce fires inside that round trip, a pre-stamp
// save is in flight when the stamped flushSave is sent, and nothing in the
// shell sequenced the two.
//
// WHY SEND ORDER IS NOT APPLY ORDER on the phone, since that is the claim
// the model below rests on. save_page_content is a sync command, and Tauri
// runs a sync command inline on whatever thread carried the IPC request
// (tauri-macros command/wrapper.rs `body_blocking`: `let result = $path(...)`
// with no spawn; tauri ipc/protocol.rs calls `webview.on_message` straight
// from the protocol closure). On Android that thread is the WebView's:
// wry's RustWebViewClient.kt answers `shouldInterceptRequest` by calling
// `handleRequest` synchronously, and Chromium issues those from a request
// thread pool, not the UI thread. Two saves in flight are two threads
// contending for the `Arc<Mutex<Connection>>`, and the one that takes the
// lock first is not necessarily the one JavaScript sent first. The desktop
// webviews hand requests to the main thread one at a time, which is why
// the desktop never showed this.
//
// THE MODEL keeps to the two Rust facts the report turns on and nothing
// else: a save's content lands when the call resolves, and the sweep runs
// then. The adverse interleaving — the later-sent save reaching the lock
// first — is modelled as the later request resolving sooner, which is what
// a request landing on an idle thread beside a busy one does. It is not a
// guess that this CAN happen; it is the interleaving the transport permits
// and the JS side has to be correct under. A model that applied saves in
// send order would make this test pass on the code that shipped the bug,
// which is the one thing a regression test may not do.
//
// Untrailed and trailed alike, because the race owes nothing to the trail:
// `lineage_id` is a column on the row and the sweep never reads it. The
// report says untrailed; the test says both, so a fix scoped to one cannot
// pass.
describe("ShellApp — a pin outlives the save it raced", () => {
  const CREATE_RTT = 30;
  const SLOW_SAVE = 100;
  const FAST_SAVE = 20;

  /** The backend the report happened against, in the ~30 lines the report
   *  needs. `pages` is content_json by page id, written at RESOLVE time;
   *  `sweep` is refresh_pin_caches' status logic, verbatim in shape. */
  function raceBackend(rows) {
    const db = { pages: {}, saves: [], overlaps: 0 };
    let inFlight = 0;
    api.createPin.mockImplementation(async (lineageId, sourcePageId, objectType, content, title) => {
      await new Promise((r) => setTimeout(r, CREATE_RTT));
      const row = {
        id: `pin-${rows.length + 1}`,
        lineage_id: lineageId,
        source_page_id: sourcePageId,
        object_type: objectType,
        content,
        title,
        status: "open",
      };
      rows.push(row);
      return row;
    });
    api.savePageContent.mockImplementation(async (pageId, json) => {
      const entry = { pageId, json, sentWhileInFlight: inFlight };
      db.saves.push(entry);
      if (inFlight > 0) db.overlaps += 1;
      inFlight += 1;
      // The later of two concurrent requests lands on the idle thread and
      // reaches the lock first — see the header.
      await new Promise((r) => setTimeout(r, entry.sentWhileInFlight > 0 ? FAST_SAVE : SLOW_SAVE));
      inFlight -= 1;
      db.pages[pageId] = json;
      sweep(pageId, json);
    });
    function sweep(pageId, json) {
      const found = new Set();
      (function walk(node) {
        if (node?.attrs?.pinId) found.add(node.attrs.pinId);
        for (const child of node?.content ?? []) walk(child);
      })(JSON.parse(json));
      for (const row of rows) {
        if (found.has(row.id) && row.status === "orphaned") row.status = "open";
        else if (row.source_page_id === pageId && row.status === "open" && !found.has(row.id)) {
          row.status = "orphaned";
        }
      }
    }
    return db;
  }

  afterEach(() => {
    restorePinMocks();
    api.savePageContent.mockImplementation(() => Promise.resolve());
  });

  const fixtures = [
    ["untrailed", () => textPage(), []],
    [
      "trailed",
      () => withLines(pageRow({ lineage_id: "L1", content_json: textPage().page.content_json })),
      [{ id: "L1", name: "the book", mode: "discrete" }],
    ],
  ];

  it.each(fixtures)("keeps a pin open when the debounce fires inside createPin (%s)", async (_label, fixture, lineages) => {
    api.getOrCreateToday.mockResolvedValue(fixture());
    api.getLineages.mockResolvedValue(lineages);
    const rows = pinLedger();
    const db = raceBackend(rows);
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    vi.useFakeTimers();
    const ed = editorOf(target);
    // A keystroke: the same dispatch a key produces, so onUpdate schedules
    // the 1s debounce the way typing does.
    ed.view.dispatch(ed.state.tr.insertText("!", ed.state.doc.firstChild.nodeSize - 1));
    flushSync();

    // Tap pin 10ms before the debounce is due. createPin's round trip is
    // 30ms, so the timer fires inside it.
    await vi.advanceTimersByTimeAsync(1000 - 10);
    tap(target, "pin");
    await vi.advanceTimersByTimeAsync(10);
    // The pre-stamp save has been sent and is in flight.
    expect(db.saves).toHaveLength(1);
    expect(JSON.parse(db.saves[0].json).content[0].attrs.pinId).toBeNull();

    // createPin resolves, the stamp lands, confirmPin flushes; then the
    // clock runs far enough for two saves back to back, which is what the
    // fixed code sends — a drain sized to the overlapping pair alone would
    // fail the fix on a save that had not landed yet.
    await vi.advanceTimersByTimeAsync(CREATE_RTT);
    await vi.advanceTimersByTimeAsync(3 * SLOW_SAVE);
    flushSync();

    expect(rows).toHaveLength(1);
    const pinId = rows[0].id;
    expect(ed.state.doc.firstChild.attrs.pinId).toBe(pinId);
    // The stamp was sent under the same page id the row points at.
    for (const save of db.saves) expect(save.pageId).toBe(rows[0].source_page_id);
    // The report: the row reads open, not `source removed`, and what the
    // database holds at the end is the stamped doc.
    expect(rows[0].status).toBe("open");
    expect(JSON.parse(db.pages[rows[0].source_page_id]).content[0].attrs.pinId).toBe(pinId);
    // And the property that made it so: no save was sent while another was
    // still on the wire, so send order is apply order whatever thread
    // answers. Asserted last because it is the mechanism, not the report —
    // a change that keeps the pin open some other way should fail HERE, on
    // a line that says what it gave up, rather than on the row.
    expect(db.overlaps).toBe(0);
  });
});

// The block sheet, and the first time anything in the shell opens a Sheet
// against a screen. Three things are under test that nothing could reach
// before: Sheet's navstack registration and its replace-if-open, the rows
// blockSheetRows offers for a real block, and toolbarFor's row 1 — the
// `strip: "none"` branch P2c wired and could not drive, because `sheetOpen`
// had no producer until this file grew one.
describe("ShellApp — the block sheet", () => {
  // navstack's own harness, copied from Sheet.test.js for its reason: jsdom
  // implements history.back() but asynchronously, so a test that called it
  // would assert against a stack that had not unwound yet. The stubs make
  // one back press one synchronous popstate.
  let historyStates;
  let navTeardown;

  beforeEach(() => {
    _resetForTests();
    historyStates = [];
    vi.spyOn(window.history, "pushState").mockImplementation((state) => {
      historyStates.push(state);
    });
    vi.spyOn(window.history, "back").mockImplementation(() => {
      historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    vi.spyOn(window.history, "go").mockImplementation((n) => {
      for (let i = 0; i < -n; i++) historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    navTeardown = initNavStack();
  });

  // cleanupAll FIRST, and this hook exists to make that order explicit
  // rather than to depend on vitest running the inner afterEach before the
  // outer one. Unmounting is a path that closes a nav entry and therefore
  // rewinds history, so the components have to go while the stubs are still
  // installed — Sheet.test.js records the same ordering requirement.
  afterEach(() => {
    cleanupAll();
    navTeardown();
    vi.restoreAllMocks();
    // The sheet's `pin` row writes through the same ledger the pin describe
    // uses, so this describe owes the same restore: vi.restoreAllMocks()
    // takes back the three window spies above and nothing else.
    restorePinMocks();
  });

  /** A page whose doc is a paragraph, a second paragraph, and a blockquote —
   *  one non-convertible text block and one convertible board, so a single
   *  fixture can drive both halves of "turn into". */
  function blockPage() {
    return textPage([
      { type: "paragraph", content: [{ type: "text", text: "second" }] },
      {
        type: "blockquote",
        content: [{ type: "paragraph", content: [{ type: "text", text: "a thought" }] }],
      },
    ]);
  }

  /** Put the caret in the first top-level node of `typeName`, the way a tap
   *  on that block would. TextSelection.near rather than .create: a board's
   *  own boundary is not a text position, and near() walks in to the first
   *  one inside it. */
  function caretIn(ed, typeName) {
    let at = -1;
    ed.state.doc.forEach((node, offset) => {
      if (at === -1 && node.type.name === typeName) at = offset + 1;
    });
    expect(at).toBeGreaterThan(-1);
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(at))));
    flushSync();
    return at - 1;
  }

  /** Sheet claims the module-scope slot inside an effect, so the tap's own
   *  flush schedules the render and a second one lands it (Sheet's header:
   *  "a test that queries the DOM straight after render() sees nothing
   *  until it calls flushSync()"). */
  function tapAndSettle(target, id) {
    tap(target, id);
    flushSync();
  }

  function rowsOf(target, tag) {
    return [...target.querySelectorAll(`[data-sheet="${tag}"] .shell-row`)].map(
      (r) => r.querySelector(".shell-row-label").textContent,
    );
  }

  function clickRow(target, tag, label) {
    const row = [...target.querySelectorAll(`[data-sheet="${tag}"] .shell-row`)].find(
      (r) => r.querySelector(".shell-row-label").textContent === label,
    );
    expect(row, `no "${label}" row in the ${tag} sheet`).toBeTruthy();
    row.click();
    flushSync();
  }

  it("opens on the gutter handle with the rows this block offers, in order", async () => {
    // Order, not membership: blockActionsFor returns an ordered list and
    // block-sheet-model splices the moves in ahead of delete precisely so
    // the destructive row stays last. A sheet asserted as a set would let
    // that placement rot silently.
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    // The caret is placed rather than assumed. EditorCore opens a revisited
    // page on its restored cursor (EditorCore:398), which for this fixture
    // is the last block — so a test that tapped the handle straight after
    // mount would be asserting the blockquote's rows while claiming a
    // paragraph's, and its `turn into` row would look like a bug in the
    // model rather than a fixture reading the wrong block.
    caretIn(editorOf(target), "paragraph");

    tapAndSettle(target, "block-handle");

    expect(target.querySelector('[data-sheet="block-actions"]')).not.toBeNull();
    // `pin` leads, because blockActionsFor puts it first and the shell
    // passes that order through untouched (block-sheet-model's header).
    // `turn into` is here since the visual pass: a paragraph has two
    // targets of its own (turn-into-model.js), and the sheet's row reads
    // the same gate as the strip's `type` button.
    expect(rowsOf(target, "block-actions")).toEqual([
      "pin",
      "copy",
      "turn into",
      "move up",
      "move down",
      "delete",
    ]);
  });

  it("empties the slot behind it — the frame stops reserving the band", async () => {
    // toolbarFor's row 1, reachable for the first time. Asserting
    // .shell-slot is ABSENT rather than merely empty: ShellRoot's header
    // calls a reserved-but-empty band a bug, so hasSlot going false is the
    // requirement and a strip-less slot div would still fail it.
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    expect(target.querySelector(".shell-toolbar-strip")).not.toBeNull();

    tapAndSettle(target, "block-handle");

    expect(target.querySelector(".shell-slot")).toBeNull();
    expect(target.querySelector(".shell-toolbar-strip")).toBeNull();
    expect(target.querySelector(".shell-tabbar")).toBeNull();
  });

  it("offers pin on a board the writer named and has not filled", async () => {
    // The third device pass: a q&a titled `Cccccc`, question and answer
    // empty, and a sheet with no pin and no copy. The name lives in attrs,
    // which the text-only rule never read (block-pinnable.js).
    api.getOrCreateToday.mockResolvedValue(textPage([
      { type: "paragraph", content: [{ type: "text", text: "second" }] },
      { type: "blockquote", attrs: { blockTitle: "Cccccc" }, content: [{ type: "paragraph" }] },
    ]));
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    caretIn(editorOf(target), "blockquote");
    flushSync();

    tapAndSettle(target, "block-handle");

    const labels = [...target.querySelectorAll('[data-sheet="block-actions"] .shell-row-label')]
      .map((n) => n.textContent.trim());
    expect(labels).toContain("pin");
    expect(labels).toContain("copy");
  });

  it("closes on back, and the slot comes back with it", async () => {
    // Sheet registers a navstack entry on open; nothing had ever driven
    // that from a screen. The slot's return is the other half — a sheet
    // that closed while sheetOpen stayed true would leave the phone with
    // no bottom chrome at all and no way to notice.
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    tapAndSettle(target, "block-handle");
    expect(target.querySelector('[data-sheet="block-actions"]')).not.toBeNull();

    navBack();
    flushSync();

    expect(target.querySelector('[data-sheet="block-actions"]')).toBeNull();
    expect(target.querySelector(".shell-toolbar-strip")).not.toBeNull();
  });

  it("moves the block, and takes the caret with it", async () => {
    // The doc half and the caret half are one requirement, not two.
    // moveBlockAtPos deliberately leaves the selection alone (its header:
    // a board title's <input> holds focus outside the doc), so a caller
    // that dispatches it raw leaves the caret in the block that swapped
    // the OTHER way — and the gutter handle, which follows the caret,
    // then points at the wrong block for the next move.
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    // The second paragraph, not the first: "move up" on the first is a
    // no-op and would pass this test without moving anything.
    ed.view.dispatch(
      ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(ed.state.doc.child(0).nodeSize + 1))),
    );
    flushSync();

    tapAndSettle(target, "block-handle");
    clickRow(target, "block-actions", "move up");

    expect(ed.state.doc.child(0).textContent).toBe("second");
    expect(ed.state.doc.child(1).textContent).toBe("kept going");
    expect(ed.state.selection.$from.node(1).textContent).toBe("second");
    expect(target.querySelector('[data-sheet="block-actions"]')).toBeNull();
  });

  it("deletes the block", async () => {
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    // Four, not the fixture's three: ProseMirror appends a trailing
    // paragraph after a doc that ends in a board, so the count the fixture
    // reads and the count the doc holds are not the same number.
    expect(ed.state.doc.childCount).toBe(4);

    tapAndSettle(target, "block-handle");
    clickRow(target, "block-actions", "delete");

    expect(ed.state.doc.childCount).toBe(3);
    expect(ed.state.doc.child(0).textContent).toBe("second");
  });

  it("copies the whole block, not the selection", async () => {
    // The caret is collapsed here, so the strip's `copy` would write
    // nothing. The sheet's row copies the block the handle points at,
    // which is the difference between the two rows sharing a label.
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const clip = stubClipboard();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    caretIn(editorOf(target), "paragraph");

    tapAndSettle(target, "block-handle");
    clickRow(target, "block-actions", "copy");
    await Promise.resolve();

    expect(clip.writeText).toHaveBeenCalledWith("kept going");
    clip.restore();
  });

  it("pins the block the sheet names, even after the caret has left it", async () => {
    // Step 2's decision, driven. The sheet FREEZES the block it was opened
    // for; the strip's `pin` reads the live caret. Both are right for their
    // own surface: a strip button is a verb with no object, so its object
    // is wherever the writer is now — but a menu was opened ON a block and
    // its rows were computed FOR that block, and the writer read them as a
    // menu about it. The caret really can move underneath an open sheet:
    // nothing makes the background inert (Sheet.svelte's header), and a
    // transaction arriving from a save or a tap through the sheet moves it.
    //
    // This is also the proof a pin from the sheet reaches the database:
    // the row's columns, read back out of the ledger, not "nothing threw".
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");

    tapAndSettle(target, "block-handle");
    expect(rowsOf(target, "block-actions")).toContain("pin");

    // The caret leaves for the second paragraph while the sheet is up.
    ed.view.dispatch(
      ed.state.tr.setSelection(
        TextSelection.near(ed.state.doc.resolve(ed.state.doc.child(0).nodeSize + 1)),
      ),
    );
    flushSync();
    expect(ed.state.selection.$from.node(1).textContent).toBe("second");

    clickRow(target, "block-actions", "pin");
    await settlePin();

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.source_page_id).toBe("p1");
    expect(row.object_type).toBe("note");
    expect(row.title).toBe("kept going");
    expect(JSON.parse(row.content).content[0].content[0].text).toBe("kept going");
    // The stamp lands on the block the sheet named. The second paragraph
    // keeps none — not "nothing happened" in general, but the specific
    // thing a live-caret read would have done instead: pin "second" and
    // leave the block the writer opened the menu about unkept.
    expect(ed.state.doc.child(0).attrs.pinId).toBe(row.id);
    expect(ed.state.doc.child(1).attrs.pinId).toBeNull();
  });

  it("a kept block's sheet asks before unpinning, and the unpin lands", async () => {
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    tapAndSettle(target, "block-handle");
    clickRow(target, "block-actions", "pin");
    await settlePin();
    const pinId = rows[0].id;
    api.getPins.mockImplementation(async () => rows);

    tapAndSettle(target, "block-handle");
    clickRow(target, "block-actions", "unpin");
    await settlePin();
    // Asked, not done: the same ask as the pin's own `more` sheet.
    expect(api.deletePin).not.toHaveBeenCalled();
    const yes = [...target.querySelectorAll("[data-sheet] .shell-row")].find((b) => b.textContent.trim() === "unpin");
    expect(yes).toBeTruthy();
    yes.click();
    await settlePin();
    expect(api.deletePin).toHaveBeenCalledWith(pinId);
  });

  it("takes the pin row away on a block it has already kept", async () => {
    // Step 3's decision. P2d's rule is that a sheet is a menu and a menu
    // implies completeness — a row that does nothing is worse than a
    // dimmed button — so the row goes ABSENT on a block that already
    // carries a pinId. The STRIP's control used to dim in place on the
    // same answer; since the visual pass it is absent too, so the two
    // surfaces match in shape as well as in answer. One pinIntent answers
    // both, so they cannot disagree.
    //
    // What is being prevented is not a duplicate row, it is a LOST one: a
    // node holds ONE pinId, so a second pin takes the first one's stamp and
    // refresh_pin_caches orphans the first (pin-intent.js's header).
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");

    tapAndSettle(target, "block-handle");
    clickRow(target, "block-actions", "pin");
    await settlePin();
    expect(rows).toHaveLength(1);
    expect(ed.state.doc.child(0).attrs.pinId).toBe(rows[0].id);

    // The sheet closed behind the row, so the strip is back — without
    // `pin`, on the same block, from the same answer.
    expect(target.querySelector('[data-button-id="pin"]')).toBeNull();
    expect(buttonIds(target)).toContain("undo");

    tapAndSettle(target, "block-handle");

    // Absent, not dead. Asserted as the whole list so a `pin` row rendered
    // disabled would fail here too, rather than only a missing one.
    expect(rowsOf(target, "block-actions")).toEqual([
      "unpin",
      "copy",
      "turn into",
      "move up",
      "move down",
      "delete",
    ]);
  });

  it("says what a pin from the sheet joined, in the words the strip uses", async () => {
    // Step 4. The row runs the same write, so it gets the same breadcrumb —
    // pin-toast.js's sentence, not a second one worded from the sheet.
    // Asserted on the rendered string rather than on a getPins spy: a
    // fetch that merely fired would be green for a toast saying the wrong
    // number about the writer's own trail.
    api.getOrCreateToday.mockResolvedValue(withLines({ ...blockPage().page, lineage_id: "L1" }));
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", mode: "discrete" }]);
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    caretIn(editorOf(target), "paragraph");

    tapAndSettle(target, "block-handle");
    clickRow(target, "block-actions", "pin");
    await settlePin();

    expect(rows).toHaveLength(1);
    expect(target.querySelector(".shell-toast").textContent.trim()).toBe(
      "the first pin on the book trail",
    );
  });

  it("offers a read-only page only the rows that do not write", async () => {
    // The decision P2d had to make rather than inherit. A closed page can
    // still be read from — copy survives — and every row that dispatches a
    // transaction is gone. Asserted as the WHOLE list, so a future row that
    // forgets the gate fails here rather than shipping a mutation onto a
    // page the editor itself refuses to edit.
    //
    // `pin` is the one row that writes and stays, and it is on the list
    // deliberately: a past page's block is still pinnable (the desktop's
    // rule), and the STRIP's pin is already live here — "pins from a
    // closed page, and pays the stamp into it" drives that. Dropping the
    // row would leave one block with a live pin button and no pin row on
    // the same page. What it costs is the stamp that test states.
    api.getOrCreateToday.mockResolvedValue(
      withLines({ ...blockPage().page, is_open: false }),
    );
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    // A paragraph with text, which on an OPEN page offers copy, both moves
    // and delete — so the single row below is the gate working, not a
    // block that had nothing to offer anyway.
    caretIn(editorOf(target), "paragraph");

    tapAndSettle(target, "block-handle");

    expect(rowsOf(target, "block-actions")).toEqual(["pin", "copy"]);
  });

  it("keeps a closed page's block from its own row, stamp and all", async () => {
    // The other half of the row above: offering `pin` on a closed page is
    // only right if the write actually lands there. The row runs on an
    // editor that refuses every edit, and it does two things to it —
    // restoreFocus, then a stamp — either of which could die quietly
    // inside pinSheetBlock's catch and leave a row that looks live and
    // keeps nothing. Asserted on the ledger and on the doc, not on the
    // absence of a thrown error.
    api.getOrCreateToday.mockResolvedValue(withLines({ ...blockPage().page, is_open: false }));
    const rows = pinLedger();
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    expect(ed.isEditable).toBe(false);
    caretIn(ed, "paragraph");

    tapAndSettle(target, "block-handle");
    clickRow(target, "block-actions", "pin");
    await settlePin();

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("kept going");
    expect(ed.state.doc.child(0).attrs.pinId).toBe(rows[0].id);
  });

  it("reaches the same turn-into sheet from the strip and from the row", async () => {
    // The unification decision, asserted rather than asserted about. `type`
    // on the block strip and `turn into` in the sheet carry one label, so
    // they have to carry one action; two paths reaching two different
    // sheets would make that label a lie.
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "blockquote");

    tapAndSettle(target, "type");
    const fromStrip = rowsOf(target, "block-convert");
    expect(fromStrip).toContain("code block");
    expect(fromStrip).not.toContain("outline");

    navBack();
    flushSync();

    tapAndSettle(target, "block-handle");
    expect(rowsOf(target, "block-actions")).toContain("turn into");
    clickRow(target, "block-actions", "turn into");

    // One sheet at a time (§1): the actions sheet is gone, not stacked
    // under it. NOT via nextSheet's replace-if-open, though it reads that
    // way — runBlockRow nulls openSheet before the row runs, so the
    // closing instance releases its claim first and nextSheet sees
    // `current: null`. The replace branch is reached by the handle
    // instead; see the swap test above.
    expect(target.querySelector('[data-sheet="block-actions"]')).toBeNull();
    expect(rowsOf(target, "block-convert")).toEqual(fromStrip);
  });

  it("offers title on a board that has none, and lands the writer in its slot", async () => {
    // The row this task exists for, and the assertion that says the gate is
    // the right way round: the blockquote's `blockTitle` is null here, so
    // the answer the shell used to pass through — the snapshot's typed-title
    // boolean, called `hasTitle` on both sides of the seam — would have
    // withheld the row on exactly the block it is for. Asserting the null
    // attribute beside the row is what makes that the claim; a fixture with
    // a title would pass under either gate.
    //
    // document.activeElement rather than a focus spy, for the reason the
    // find field's test gives: bindTitleSlot schedules the focus one frame
    // after __enterEdit(), so there is no moment at which a spy could be
    // installed on the element before the call is queued — and the landing
    // is the claim, not the asking. The row is not a transaction and could
    // not be one: a board title is an <input> the NodeView draws at no
    // document position.
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "blockquote");
    expect(ed.state.doc.child(2).type.name).toBe("blockquote");
    expect(ed.state.doc.child(2).attrs.blockTitle).toBeNull();

    tapAndSettle(target, "block-handle");
    expect(rowsOf(target, "block-actions")).toContain("title");
    clickRow(target, "block-actions", "title");
    await new Promise((r) => requestAnimationFrame(() => r()));

    const slot = target.querySelector(".ProseMirror .board-title-slot");
    expect(slot).toBeTruthy();
    expect(document.activeElement).toBe(slot);
  });

  it("keeps the writer in the slot after the editor redraws the board", async () => {
    // P2e's lesson, checked on the far side of the line it draws. What did
    // not survive there was a WRITE to a node the editor owns: classList.add
    // on a ProseMirror node, seen by the DOMObserver, marked dirty and
    // redrawn from the doc within ~100ms. Focus is not a mutation of the
    // tree, so the observer never sees it — but the redraw is still what
    // would take it away if that reasoning were wrong, and a synchronous
    // assertion cannot see an asynchronous undo. So the transaction comes
    // first and the assertion after it: the text lands INSIDE the board, so
    // it is that NodeView's own update() being exercised, not a neighbour's.
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    const at = caretIn(ed, "blockquote");

    tapAndSettle(target, "block-handle");
    clickRow(target, "block-actions", "title");
    await new Promise((r) => requestAnimationFrame(() => r()));
    const slot = target.querySelector(".ProseMirror .board-title-slot");
    expect(document.activeElement).toBe(slot);

    ed.view.dispatch(ed.state.tr.insertText("!", at + 2));
    flushSync();
    await tick();
    await new Promise((r) => requestAnimationFrame(() => r()));

    expect(ed.state.doc.child(2).textContent).toContain("!");
    expect(document.activeElement).toBe(slot);
  });

  it("withholds title on a closed page, where the desktop still offers it", async () => {
    // The row where this branch and the desktop part company, deliberately.
    // TipTapEditor keeps its title reveal on a read-only page because the
    // old hover pill never gated it. But the slot is a live <input>: it
    // sits outside the contenteditable, so `editable: false` never reaches
    // it, and the first keystroke dispatches setNodeAttribute. READONLY_ROWS
    // is an allowlist and its line is "does it write to the document", so
    // this row is a write offered as a reveal, and it goes.
    //
    // The same block on an open page is the test two above, which is what
    // makes this the gate working rather than a board with nothing to
    // offer. Asserted as the whole list so a later row that forgets the
    // allowlist fails here.
    api.getOrCreateToday.mockResolvedValue(
      withLines({ ...blockPage().page, is_open: false }),
    );
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    caretIn(editorOf(target), "blockquote");

    tapAndSettle(target, "block-handle");

    expect(rowsOf(target, "block-actions")).toEqual(["pin", "copy"]);
  });

  it("swaps sheets when the handle is tapped while a sheet is already open", async () => {
    // THE path that reaches nextSheet's replace-if-open branch, and the
    // one the code comment below dismissedSheet used to call impossible.
    // The gutter handle lives in the canvas, not the bottom slot, and
    // nothing makes the background inert (Sheet.svelte says so in its own
    // header), so at half detent a handle above the sheet stays tappable.
    // openBlockSheet assigns openSheet directly — unlike runBlockRow,
    // which nulls it first — so the two Sheets change state in one turn
    // and the OPENING instance, declared first, asks nextSheet while the
    // convert sheet still holds the module claim. It reports the dismissal,
    // and only the tag guard stops that dismissal from closing the sheet
    // that just opened.
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "blockquote");

    tapAndSettle(target, "type");
    expect(target.querySelector('[data-sheet="block-convert"]')).not.toBeNull();

    tapAndSettle(target, "block-handle");

    // One sheet at a time, and it is the NEW one. Drop the tag guard and
    // both of these go null: the convert sheet's onDismiss fires after the
    // actions sheet has already claimed the slot, and an unguarded
    // `openSheet = null` eats the tap entirely.
    expect(target.querySelector('[data-sheet="block-actions"]')).not.toBeNull();
    expect(target.querySelector('[data-sheet="block-convert"]')).toBeNull();
  });

  it("converts the block when a target is chosen", async () => {
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "blockquote");

    tapAndSettle(target, "type");
    clickRow(target, "block-convert", "code block");

    expect(ed.state.doc.child(2).type.name).toBe("codeBlock");
    expect(ed.state.doc.child(2).textContent).toBe("a thought");
    expect(target.querySelector('[data-sheet="block-convert"]')).toBeNull();
  });

  it("shows type beside a paragraph and a board, and not beside a heading", async () => {
    // The gate is the same `turnIntoRowsOf` the sheet uses, so the button
    // and the row cannot disagree about whether this block has somewhere
    // to go. A blockquote goes through block-convert.js; a paragraph has
    // turn-into-model.js's two targets since the visual pass (it used to
    // render `type` DEAD here, and this test said so); a heading has
    // neither, and beside it the button is ABSENT rather than dead —
    // nothing typed into a heading gives it a target, so a grey button
    // there would say "broken" where it means "not here".
    //
    // Proven red twice: with `liveTurnIntoRows.length === 0 ? ["type"]`
    // moved to `disabledIds`, the heading's null fails on a dead button;
    // with turn-into-model's paragraph branch returning [], the
    // paragraph's `.disabled` read throws on null.
    api.getOrCreateToday.mockResolvedValue(
      textPage([
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "a thought" }] }],
        },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "a head" }] },
      ]),
    );
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);

    caretIn(ed, "paragraph");
    expect(target.querySelector('[data-button-id="type"]').disabled).toBe(false);

    caretIn(ed, "blockquote");
    expect(target.querySelector('[data-button-id="type"]').disabled).toBe(false);

    caretIn(ed, "heading");
    expect(target.querySelector('[data-button-id="type"]')).toBeNull();
    expect(buttonIds(target)).toEqual(["insert", "bold", "italic", "pin", "undo"]);
  });

  it("shows type beside a list, offering the converter's targets and not `list`", async () => {
    // The plan's named case. A list is a board, so its rows come from
    // block-convert.js — bullet → numbered, task, outline, and so on — and
    // the paragraph's own `list` row must NOT be appended to them: a list
    // offered `list` is a row that does nothing.
    api.getOrCreateToday.mockResolvedValue(
      textPage([
        {
          type: "list",
          content: [
            { type: "listItem", attrs: { marker: "bullet" }, content: [{ type: "paragraph", content: [{ type: "text", text: "milk" }] }] },
          ],
        },
      ]),
    );
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "list");

    const type = target.querySelector('[data-button-id="type"]');
    expect(type).not.toBeNull();
    expect(type.disabled).toBe(false);

    tapAndSettle(target, "type");
    const rows = rowsOf(target, "block-convert");
    expect(rows).toContain("numbered list");
    expect(rows).toContain("task list");
    expect(rows).not.toContain("bullet list");
    expect(rows).not.toContain("list");
    expect(rows).not.toContain("heading");
  });

  it("turns a paragraph into a list where it stands", async () => {
    // The visual pass's one design step, end to end: `list` left the strip
    // and lives under `turn into`. Asserted on the DOCUMENT and on the
    // block's NEIGHBOUR — the paragraph is wrapped in place, and the
    // paragraph below it is still the paragraph below it. That second
    // assertion is what tells a conversion from an insert: routed through
    // `runSlashInsert(ed, "bullet")` instead of COMMANDS.list, the written
    // line stays a paragraph and an empty list lands under it (slash-
    // insert-target.js's needsFreshLine), and child(1) is no longer
    // "second".
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    const blocksBefore = ed.state.doc.childCount;

    tapAndSettle(target, "type");
    expect(rowsOf(target, "block-convert")).toEqual(["list", "heading"]);
    clickRow(target, "block-convert", "list");

    expect(ed.state.doc.child(0).type.name).toBe("list");
    expect(ed.state.doc.child(0).textContent).toBe("kept going");
    expect(ed.state.doc.child(1).type.name).toBe("paragraph");
    expect(ed.state.doc.child(1).textContent).toBe("second");
    expect(ed.state.doc.childCount).toBe(blocksBefore);
    expect(target.querySelector('[data-sheet="block-convert"]')).toBeNull();
  });

  it("turns a paragraph into a heading where it stands", async () => {
    // The other paragraph target, and the reason it can be one: `heading
    // 1` is an IN_PLACE_COMMAND, so `runSlashInsert` opens no fresh line
    // for it and setNode lands on the caret's own block. Same neighbour
    // assertion as the list, for the same reason.
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    const blocksBefore = ed.state.doc.childCount;

    tapAndSettle(target, "type");
    clickRow(target, "block-convert", "heading");

    expect(ed.state.doc.child(0).type.name).toBe("heading");
    expect(ed.state.doc.child(0).textContent).toBe("kept going");
    expect(ed.state.doc.child(1).textContent).toBe("second");
    expect(ed.state.doc.childCount).toBe(blocksBefore);
  });

  it("goes round: a paragraph into a list, and the list back to paragraphs", async () => {
    // What replaced the strip's list toggle. The way IN is the paragraph's
    // own row; the way OUT is the board's — a list is convertible, and
    // `plain paragraphs` is block-convert's target for it — so the round
    // trip crosses both branches of runConvert and ends where it began.
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");

    tapAndSettle(target, "type");
    clickRow(target, "block-convert", "list");
    expect(ed.state.doc.child(0).type.name).toBe("list");

    caretIn(ed, "list");
    tapAndSettle(target, "type");
    const rows = rowsOf(target, "block-convert");
    expect(rows).toContain("plain paragraphs");
    expect(rows).not.toContain("list");
    clickRow(target, "block-convert", "plain paragraphs");

    expect(ed.state.doc.child(0).type.name).toBe("paragraph");
    expect(ed.state.doc.child(0).textContent).toBe("kept going");
  });

  it("undoes a turn into from the strip", async () => {
    // An edit made from the strip's own sheet is undoable from the strip —
    // the requirement the strip describe's undo test used to drive through
    // the `list` button, carried here with the button's replacement. The
    // sheet closes behind the row, so `undo` is back on screen to press.
    api.getOrCreateToday.mockResolvedValue(blockPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");

    tapAndSettle(target, "type");
    clickRow(target, "block-convert", "list");
    expect(ed.state.doc.child(0).type.name).toBe("list");

    tap(target, "undo");
    expect(ed.state.doc.child(0).type.name).toBe("paragraph");
    expect(ed.state.doc.child(0).textContent).toBe("kept going");
  });

  it("offers a closed page's paragraph no turn into, on the strip or in the sheet", async () => {
    // turn-into-model.js decides the paragraph targets, so `readonly` has
    // to reach it or a closed page would offer to wrap its paragraphs in
    // lists. Both surfaces read the one gate: no `type` on the strip, no
    // `turn into` row on the handle's sheet.
    api.getOrCreateToday.mockResolvedValue(withLines({ ...blockPage().page, is_open: false }));
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    expect(ed.isEditable).toBe(false);
    caretIn(ed, "paragraph");

    expect(target.querySelector('[data-button-id="type"]')).toBeNull();

    tapAndSettle(target, "block-handle");
    expect(rowsOf(target, "block-actions")).not.toContain("turn into");
  });
});

// The insert sheet — §3's `+`, and the second real caller Sheet has ever
// had. What is under test that the block sheet could not reach: the strip
// button that spent a whole phase rendering disabled because nothing
// implemented it, and the reuse of the shared slash commands from a
// surface that has no "/query" to delete.
describe("ShellApp — the insert sheet", () => {
  // Same navstack harness as the block sheet above, and for the same
  // reason: jsdom's history.back() is asynchronous, so an unstubbed back
  // press would assert against a stack that had not unwound yet.
  let historyStates;
  let navTeardown;

  beforeEach(() => {
    _resetForTests();
    historyStates = [];
    vi.spyOn(window.history, "pushState").mockImplementation((state) => {
      historyStates.push(state);
    });
    vi.spyOn(window.history, "back").mockImplementation(() => {
      historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    vi.spyOn(window.history, "go").mockImplementation((n) => {
      for (let i = 0; i < -n; i++) historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    navTeardown = initNavStack();
  });

  // cleanupAll first — unmounting closes a nav entry and rewinds history,
  // so the components have to go while the stubs are still installed.
  afterEach(() => {
    cleanupAll();
    navTeardown();
    vi.restoreAllMocks();
  });

  /** Put the caret in the first top-level node of `typeName`. EditorCore
   *  opens a revisited page on its RESTORED cursor (EditorCore:398), which
   *  for a multi-block fixture is the last block — so a test that tapped
   *  `+` straight after mount would insert relative to a block it never
   *  chose. */
  function caretIn(ed, typeName) {
    let at = -1;
    ed.state.doc.forEach((node, offset) => {
      if (at === -1 && node.type.name === typeName) at = offset + 1;
    });
    expect(at).toBeGreaterThan(-1);
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(at))));
    flushSync();
  }

  /** Sheet claims the module-scope slot inside an effect, so the tap's own
   *  flush schedules the render and a second one lands it. */
  function tapAndSettle(target, id) {
    tap(target, id);
    flushSync();
  }

  function rowsOf(target, tag) {
    return [...target.querySelectorAll(`[data-sheet="${tag}"] .shell-row`)].map(
      (r) => r.querySelector(".shell-row-label").textContent,
    );
  }

  function clickRow(target, tag, label) {
    const row = [...target.querySelectorAll(`[data-sheet="${tag}"] .shell-row`)].find(
      (r) => r.querySelector(".shell-row-label").textContent === label,
    );
    expect(row, `no "${label}" row in the ${tag} sheet`).toBeTruthy();
    row.click();
    flushSync();
  }

  /** Every row, tapped, from the one state the sheet is most often opened
   *  in: the caret in a plain written paragraph.
   *
   *  This exists because the comment at runSlashInsert used to claim
   *  "every title below is asserted against commandItems" and nothing did.
   *  Six of the seven rows reach `commandItems` by TITLE STRING, and the
   *  order test above asserts LABELS ("heading", "list"), not the ids
   *  behind them ("heading 1", "bullet") — so renaming a slash command
   *  upstream turned four rows into permanent no-op taps with the whole
   *  shell tree still green. Proven: typo four ids and 256 shell tests
   *  still pass.
   *
   *  Asserted behaviourally rather than as `SLASH_BY_TITLE.has(id)`,
   *  because a title that resolves is not the same claim as a row that
   *  writes. This catches the rename AND a command that resolves and then
   *  does nothing here. */
  it.each(["paragraph", "heading 1", "heading 2", "task", "bullet", "numbered", "q&a", "recipe", "code block", "outline", "decision", "blockquote", "divider"])(
    "writes to the doc when the %s row is tapped",
    async (label) => {
      api.getOrCreateToday.mockResolvedValue(textPage());
      const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
      await settleWithEditor();
      const ed = editorOf(target);
      caretIn(ed, "paragraph");
      const before = JSON.stringify(ed.state.doc.toJSON());

      tapAndSettle(target, "insert");
      clickRow(target, "insert", label);

      expect(
        JSON.stringify(ed.state.doc.toJSON()),
        `the "${label}" row left the doc untouched`,
      ).not.toBe(before);
      // The sentence the caret was in survives every row. `heading` is the
      // one row that CONVERTS that line rather than inserting below it
      // (slash-insert-target keeps "heading 1" in IN_PLACE_COMMANDS), so
      // this asserts the text is still there, not where it sits.
      expect(ed.state.doc.textContent).toContain("kept going");
      expect(target.querySelector('[data-sheet="insert"]')).toBeNull();
    },
  );

  // ── finding a row by name ──────────────────────────────────────────
  //
  // The second device pass: "insert choice have no search field". The
  // filter is insert-filter.js's; these hold that the sheet asks it, that
  // Enter runs what is left, and that the field is empty on every open.
  const insertLabels = (target) =>
    [...target.querySelectorAll('[data-sheet="insert"] .shell-row-label')].map((el) =>
      el.textContent.trim(),
    );
  it("narrows the rows to the ones whose name contains what is typed", async () => {
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    tapAndSettle(target, "insert");

    const field = target.querySelector('[data-sheet="insert"] input[aria-label="find a block"]');
    expect(field).not.toBeNull();
    field.value = "tab";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(insertLabels(target)).toEqual(["table"]);
  });

  it("says so, in a sentence, when no row's name matches", async () => {
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    tapAndSettle(target, "insert");

    const field = target.querySelector('[data-sheet="insert"] input[aria-label="find a block"]');
    field.value = "zebra";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(insertLabels(target)).toEqual([]);
    expect(target.querySelector('[data-sheet="insert"] .shell-note').textContent.trim())
      .toBe("no block by that name.");
  });

  it("runs the first row left on Enter, and closes", async () => {
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    const before = JSON.stringify(ed.state.doc.toJSON());
    tapAndSettle(target, "insert");

    const field = target.querySelector('[data-sheet="insert"] input[aria-label="find a block"]');
    field.value = "code";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    flushSync();

    expect(JSON.stringify(ed.state.doc.toJSON())).not.toBe(before);
    expect(ed.state.doc.toJSON().content.some((n) => n.type === "codeBlock")).toBe(true);
    expect(target.querySelector('[data-sheet="insert"]')).toBeNull();
  });

  it("puts the caret in what was inserted, so the keyboard comes back with it", async () => {
    // The third device pass: "click on a block from insert, the keyboard
    // disappears, then we need to click again". The focus call is made
    // inside the row's click, so a webview raises the keyboard for it.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    const focus = vi.spyOn(ed.view, "focus");
    tapAndSettle(target, "insert");

    clickRow(target, "insert", "paragraph");

    expect(focus).toHaveBeenCalled();
    expect(target.querySelector('[data-sheet="insert"]')).toBeNull();
  });

  it("does not focus the page for a builder, whose sheet takes over", async () => {
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    const focus = vi.spyOn(ed.view, "focus");
    tapAndSettle(target, "insert");

    clickRow(target, "insert", "table");

    expect(focus).not.toHaveBeenCalled();
    expect(target.querySelector('[data-sheet="table"]')).not.toBeNull();
  });

  it("opens with the field empty and every row back, whatever was typed last time", async () => {
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    tapAndSettle(target, "insert");
    const field = target.querySelector('[data-sheet="insert"] input[aria-label="find a block"]');
    field.value = "tab";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    clickRow(target, "insert", "table");
    // The table builder took over; back out of it and reopen the insert
    // sheet from the strip.
    navBack();
    flushSync();
    tapAndSettle(target, "insert");
    const again = target.querySelector('[data-sheet="insert"] input[aria-label="find a block"]');
    expect(again.value).toBe("");
    // Every row back, which is the whole menu (insert-menu.js) plus the
    // sheet's own paragraph — counted from the model rather than typed,
    // so a command added upstream does not redden this.
    expect(insertLabels(target).length).toBe(
      insertMenuSections({ items: commandItems }).reduce((n, g) => n + g.rows.length, 0),
    );
  });

  it("opens from the block strip's + with the slash menu's own rows, in its order", async () => {
    // The whole list, in order, rather than a membership check on one row.
    // The ORDER is §3's, and a sheet whose rows move between openings is
    // unusable; asserting the whole array is also what makes a future row
    // added without an insert behind it fail here instead of shipping
    // dead.
    //
    // It used to carry the other half of the plan's rule — that a menu
    // implies completeness, so a row the shell could not honour rendered
    // as no row at all. Nothing is withheld any more: `chart` was the last
    // absence and P2f-2 Task 5 gave it the builder it was waiting for, so
    // this is §3's eleven, all eleven.
    //
    // The comment here has been wrong twice by naming what was missing
    // rather than reading the array: "table and chart want the full-detent
    // builder, image and file want the system picker, and all four are
    // P2f" stood for a task after image and file joined, and the `chart`
    // sentence stood for a task after `table` did.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    expect(target.querySelector('[data-button-id="insert"]').disabled).toBe(false);
    tapAndSettle(target, "insert");

    expect(target.querySelector('[data-sheet="insert"]')).not.toBeNull();
    // EVERY BLOCK COMMAND THE EDITOR HAS, in the slash menu's own
    // sections and order (insert-menu.js) — the fourth device pass:
    // "blocks list does not show similar to /". The three list markers
    // and the three headings used to be one row each, and four commands
    // (`heading 2`, `heading 3`, `decision`, `blockquote`, `divider`)
    // were unreachable from this phone except by typing `/`. The two
    // rows that do not write on tap are still here — `table` and `chart`
    // open their builders — and `paragraph` is still the sheet's own.
    //
    // Asserted against `commandItems` rather than written out: a list
    // typed here would be a second copy of the menu, which is the drift
    // the change exists to end.
    // insert-menu.js is the decision and has its own suite; what this
    // asserts is that the SHEET renders it — every row it returns, in its
    // order, with the descriptions beside them.
    const expected = insertMenuSections({ items: commandItems }).flatMap((g) =>
      g.rows.map((r) => r.label),
    );
    expect(rowsOf(target, "insert")).toEqual(expected);
    expect(rowsOf(target, "insert")).toEqual(expect.arrayContaining(["task", "heading 3", "paragraph"]));
    // The sections are on screen as eyebrows, which is what keeps twenty
    // rows readable.
    const eyebrows = [...target.querySelectorAll('[data-sheet="insert"] .shell-eyebrow')]
      .map((n) => n.textContent.trim());
    expect(eyebrows).toEqual(["structure", "lists", "inline & code", "shizumu blocks"]);
    // And each row carries its command's description.
    const taskRow = [...target.querySelectorAll('[data-sheet="insert"] .shell-row')]
      .find((r) => r.querySelector(".shell-row-label").textContent.trim() === "task");
    expect(taskRow.querySelector(".shell-row-value").textContent.trim()).toBe("checkbox");
  });

  /** Drive the file input the picker appends to the body. `pickFileBytes`
   *  (slash-commands.js:18) creates a real <input type="file"> — there is
   *  no Tauri dialog on this path, which is why these rows needed no
   *  hand-off built for them. jsdom's File.arrayBuffer resolves, so the
   *  whole command runs. */
  async function drivePicker(name, type) {
    const input = document.querySelector('input[type="file"]');
    expect(input, "the picker appended no file input").toBeTruthy();
    const file = new File([new Uint8Array([1, 2, 3])], name, { type });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
    // Several hops, not one: the change handler awaits file.arrayBuffer(),
    // resolves the picker promise, then the command awaits
    // attachmentAddBytes before it inserts. A single settle() lands
    // mid-chain and reads a document nothing has written to yet — which is
    // this codebase's recurring "a synchronous assertion cannot see an
    // asynchronous undo", in its waiting-too-little form.
    for (let i = 0; i < 5; i++) await settle();
    return input;
  }

  it("inserts the image where the caret WAS, not where it drifted to", async () => {
    // The whole risk of these two rows. Both commands capture insertPos
    // before awaiting (slash-commands.js:397) because the dialog suspends
    // and the selection can move under it — on a phone that dialog is a
    // whole system UI and the app can be backgrounded. So the test moves
    // the caret DURING the await, which is the only way to tell a captured
    // position from a live one.
    api.attachmentAddBytes.mockResolvedValue({
      blob_hash: "h1", filename: "a.png", mime_type: "image/png",
      size_bytes: 3, sync: false, created_at: 1,
    });
    api.getOrCreateToday.mockResolvedValue(textPage([
      { type: "paragraph", content: [{ type: "text", text: "second line" }] },
    ]));
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");

    tapAndSettle(target, "insert");
    clickRow(target, "insert", "image");

    // The dialog is open. Move the caret to the LAST block, as a
    // backgrounded app would on return.
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.atEnd(ed.state.doc)));
    flushSync();

    await drivePicker("a.png", "image/png");

    // `attachment` is an INLINE atom (attachment.js:9-11), so it lands
    // INSIDE a paragraph rather than as a top-level child — a first draft
    // of this test mapped only `doc.content.content` and read the absence
    // as a failed insert when the node was one level down.
    let holder = -1;
    ed.state.doc.forEach((node, _pos, index) => {
      node.descendants((child) => {
        if (child.type.name === "attachment") holder = index;
      });
    });
    expect(holder, "no attachment anywhere in the document").toBeGreaterThan(-1);
    // The fresh line after the FIRST paragraph — where the caret was when
    // the row was tapped — not after "second line" where it drifted to.
    // `image` is in slash-insert-target's BLOCK_COMMANDS, so insertionPoint
    // opens that line before the picker suspends; the captured position is
    // what survives the await.
    expect(holder).toBe(1);
    expect(ed.state.doc.child(0).textContent).toBe("kept going");
  });

  it("says why a PDF chosen for /image was refused", async () => {
    // `accept="image/*"` is a picker HINT, not a gate — every file dialog
    // offers an all-files escape — so the command refuses the pick and
    // explains what would work. It reports through
    // `element.__shizumuShowToast` (slash-commands.js:398), a host the
    // desktop sets and the shell did NOT, so this message and two others
    // (a failed read, a failed insert) were silent here: the writer picked
    // a file and nothing happened at all.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    const before = JSON.stringify(ed.state.doc.toJSON());

    tapAndSettle(target, "insert");
    clickRow(target, "insert", "image");
    await drivePicker("notes.pdf", "application/pdf");

    expect(target.querySelector(".shell-toast")?.textContent ?? "").toMatch(/pdf|image/i);
    // No attachment, and the blob was never written — a refusal that still
    // stored the file would be worse than a silent one.
    expect(ed.state.doc.content.content.map((n) => n.type.name)).not.toContain("attachment");
    expect(api.attachmentAddBytes).not.toHaveBeenCalled();
    // The doc IS byte-identical, and it did not use to be. `image` is in
    // slash-insert-target's BLOCK_COMMANDS, so insertionPoint opens a
    // fresh line BEFORE the picker suspends, and a refused pick used to
    // leave that blank paragraph behind — recorded here as a finding
    // rather than an expectation. `main`'s `555a9fac` fixed it at
    // `discardOpenedLine`, which acts only when the range says the line
    // was opened by this call, so the fix reached the desktop's
    // `prepareInsertionPoint` and did NOTHING for this file's hand-copy of
    // it until `insertionPoint` was carried across to report `openedLine`.
    //
    // This is the assertion holding that carry in place: drop `openedLine`
    // from insertionPoint's return and this line goes red while every
    // other insert-sheet test stays green.
    expect(JSON.stringify(ed.state.doc.toJSON())).toBe(before);
  });

  it("inserts a heading, and closes behind it", async () => {
    // `heading 1` is in slash-insert-target's IN_PLACE set, so from `+` on
    // a written line it converts THAT line — the finding recorded at
    // INSERT_ROWS. Asserted as the real behaviour rather than as "the doc
    // changed", and the text is asserted too: the module's whole reason for
    // existing is that a block command must never consume what was typed.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    expect(ed.state.doc.child(0).type.name).toBe("paragraph");

    tapAndSettle(target, "insert");
    clickRow(target, "insert", "heading 1");

    expect(ed.state.doc.child(0).type.name).toBe("heading");
    expect(ed.state.doc.child(0).textContent).toBe("kept going");
    expect(target.querySelector('[data-sheet="insert"]')).toBeNull();
  });

  it("puts a block command on a fresh line rather than swallowing the one it is on", async () => {
    // slash-insert-target.js exists because `/outline` on a written line
    // wrapped the sentence into the outline. The sheet inserts the same
    // blocks from a different surface, so it has the same bug available to
    // it — this is the assertion that the shared rule is actually being
    // asked, and it fails the moment the range handed to the command stops
    // being the one insertionPoint prepared.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");

    tapAndSettle(target, "insert");
    clickRow(target, "insert", "bullet");

    expect(ed.state.doc.child(0).type.name).toBe("paragraph");
    expect(ed.state.doc.child(0).textContent).toBe("kept going");
    expect(ed.state.doc.child(1).type.name).toBe("list");
  });

  it("puts a new paragraph below the block the caret is in", async () => {
    // The one row with no slash command behind it. Its absence from
    // needsFreshLine's sets is structural — there is no `/paragraph` — so
    // this row always inserts below, which is the only reading that is
    // never a no-op. Asserting the CARET moved too: a paragraph the writer
    // has to tap into is not an insert, it is litter.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    expect(ed.state.doc.childCount).toBe(1);

    tapAndSettle(target, "insert");
    clickRow(target, "insert", "paragraph");

    expect(ed.state.doc.childCount).toBe(2);
    expect(ed.state.doc.child(0).textContent).toBe("kept going");
    expect(ed.state.doc.child(1).type.name).toBe("paragraph");
    expect(ed.state.doc.child(1).textContent).toBe("");
    expect(ed.state.selection.$from.node(1).textContent).toBe("");
  });

  it("closes on back without touching the document", async () => {
    // Sheet's navstack entry, from the second surface that opens one. The
    // doc assertion is the point of the test rather than decoration: a
    // dismissal path that ran a row's action would be indistinguishable
    // from a correct close in the DOM, and would write to the page every
    // time the writer changed their mind.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    const before = ed.state.doc.toJSON();

    tapAndSettle(target, "insert");
    expect(target.querySelector('[data-sheet="insert"]')).not.toBeNull();

    navBack();
    flushSync();

    expect(target.querySelector('[data-sheet="insert"]')).toBeNull();
    expect(ed.state.doc.toJSON()).toEqual(before);
    expect(target.querySelector(".shell-toolbar-strip")).not.toBeNull();
  });

  it("reaches the same insert sheet from the strip and from an empty block's row", async () => {
    // The second half of Task 3's `insert-below`, left unwired for one
    // task because the shell had nowhere to send it. blockActionsFor only
    // offers that row on an EMPTY block, and the desktop's own handler
    // types "/" at the start of that empty block — so both hosts mean "put
    // a block here", and both shell paths have to reach one sheet or the
    // label is a lie the way `type` / `turn into` would have been.
    //
    // It also closes the dead-handle gap the plan's "Owed" list recorded:
    // before this row, an empty paragraph's rowsFor returned [] and the
    // handle produced no sheet and no feedback.
    api.getOrCreateToday.mockResolvedValue(textPage([{ type: "paragraph" }]));
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    // The SECOND paragraph — the empty one. caretIn takes the first node
    // of a type, and both are paragraphs.
    ed.view.dispatch(
      ed.state.tr.setSelection(
        TextSelection.near(ed.state.doc.resolve(ed.state.doc.child(0).nodeSize + 1)),
      ),
    );
    flushSync();

    tapAndSettle(target, "insert");
    const fromStrip = rowsOf(target, "insert");
    // Not a count. This test's claim is the `toEqual(fromStrip)` below —
    // that both entry points reach ONE sheet — and two empty lists satisfy
    // that vacuously, so the only thing needed here is that the sheet is
    // not empty. It used to assert `.toBe(7)`, which is a second copy of
    // INSERT_ROWS' length written in a file that cannot see it: adding the
    // picker rows reddened this test while the behaviour it names was
    // still correct.
    expect(fromStrip.length).toBeGreaterThan(0);

    navBack();
    flushSync();

    tapAndSettle(target, "block-handle");
    expect(rowsOf(target, "block-actions")).toContain("insert below");
    clickRow(target, "block-actions", "insert below");

    expect(target.querySelector('[data-sheet="block-actions"]')).toBeNull();
    expect(rowsOf(target, "insert")).toEqual(fromStrip);

    // And it inserts into the blank line rather than below it: on an empty
    // line needsFreshLine gives no fresh one, which is what makes "insert
    // below" on an empty block mean the same thing on both hosts.
    // child(1), not child(2): had the sheet given the empty line a fresh
    // one below it, the blank paragraph would still sit here and the list
    // would be third. (childCount is 3 rather than 2 either way —
    // ProseMirror appends a trailing paragraph after a doc that ends in a
    // board, the same count the delete test above records.)
    clickRow(target, "insert", "bullet");
    expect(ed.state.doc.child(0).textContent).toBe("kept going");
    expect(ed.state.doc.child(1).type.name).toBe("list");
  });

  it("leaves + off the strip on a closed page", async () => {
    // Every row writes to the document, so a closed page offers none — and
    // an empty sheet is the reserved-but-empty band ShellRoot's header
    // calls a bug. The button used to render dead to say so; since the
    // visual pass it is absent, because a closed page is closed for good
    // and "cannot apply" is drawn as no control. The strip is still there
    // — `pin` is, a past block being pinnable — so this is the button
    // missing from a live strip, not a missing strip.
    api.getOrCreateToday.mockResolvedValue(
      withLines({ ...textPage().page, is_open: false }),
    );
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    expect(target.querySelector('[data-button-id="insert"]')).toBeNull();
    expect(buttonIds(target)).toEqual(["bold", "italic", "pin", "undo"]);
  });

  // ── the table size grid (Task 4) ──────────────────────────────────────
  //
  // Reached only from the `table` row above, which is why it lives in this
  // describe and reuses its navstack harness rather than standing up a
  // second copy of it.

  /** The 6×6 grid's cell at (row, col), inside the table sheet. */
  function gridCell(target, row, col) {
    const cell = target.querySelector(
      `[data-sheet="table"] .shell-table-grid-cell[data-row="${row}"][data-col="${col}"]`,
    );
    expect(cell, `no cell (${row}, ${col}) in the table sheet`).toBeTruthy();
    return cell;
  }

  function pickCell(target, row, col) {
    gridCell(target, row, col).click();
    flushSync();
  }

  /** Open `+` → `table` and land on the grid. */
  function openGrid(target) {
    tapAndSettle(target, "insert");
    clickRow(target, "insert", "table");
  }

  /** The table node in the doc, wherever it landed. */
  function tableIn(ed) {
    let found = null;
    ed.state.doc.forEach((node) => {
      if (!found && node.type.name === "table") found = node;
    });
    return found;
  }

  it("swaps the insert sheet for the size grid, at full detent, writing nothing", async () => {
    // The row's whole reason for having been absent: `/table` on the
    // desktop does not insert on tap either — it shows a size grid and
    // inserts what the grid commits. So this asserts the tap produces a
    // grid AND that the document is untouched, which is not "nothing
    // happens": it is the difference between this row and the nine around
    // it, and a version that inserted a silent 3×3 here would pass every
    // other assertion in this file.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    const before = ed.state.doc.toJSON();

    openGrid(target);

    expect(target.querySelector('[data-sheet="insert"]')).toBeNull();
    const sheet = target.querySelector('[data-sheet="table"]');
    expect(sheet).not.toBeNull();
    // §3 puts the builder at full detent, and the grid needs it: six 44px
    // cells with gaps do not fit in half a frame alongside a readout and a
    // commit row.
    expect(sheet.dataset.detent).toBe("full");
    expect(target.querySelectorAll('[data-sheet="table"] .shell-table-grid-cell')).toHaveLength(36);
    expect(ed.state.doc.toJSON()).toEqual(before);
  });

  it("opens on 3 × 3 and reads the size back before it commits", async () => {
    // DEFAULT_HOVER is (2, 2), which is the 3×3 /table inserted before the
    // grid existed. Two readouts say so, deliberately: the caption above
    // the cells (the one a thumb cannot cover) and the value on the row
    // that acts.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    caretIn(editorOf(target), "paragraph");

    openGrid(target);

    const caption = target.querySelector('[data-sheet="table"] .shell-table-grid-caption');
    expect(caption.textContent).toBe("3 × 3");
    const value = target.querySelector('[data-sheet="table"] .shell-row-value');
    expect(value.textContent).toBe("3 × 3");

    // Picking moves both, and the reading is cols × rows — the desktop's
    // order, kept so one grid does not read transposed against the other.
    pickCell(target, 3, 4);
    expect(caption.textContent).toBe("5 × 4");
    expect(
      target.querySelector('[data-sheet="table"] .shell-row-value').textContent,
    ).toBe("5 × 4");
  });

  it("inserts the size the grid was left on", async () => {
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");

    openGrid(target);
    pickCell(target, 3, 4);
    clickRow(target, "table", "insert");

    expect(target.querySelector('[data-sheet="table"]')).toBeNull();
    const table = tableIn(ed);
    expect(table).not.toBeNull();
    // Cell (3, 4) is 4 rows by 5 cols — the header row is one of the four,
    // which is the same arithmetic clampTableSize's floor is written for.
    expect(table.childCount).toBe(4);
    expect(table.child(0).childCount).toBe(5);
  });

  it("snaps the grid's top row to two rows rather than leaving it dead", async () => {
    // clampTableSize's floor, reached through the whole surface: rows:1
    // with withHeaderRow:true is a header and no body, so the top row
    // commits 2. The alternative — an unclickable first row — is a dead
    // target inside a menu, which is what the shell's absent-not-dead rule
    // refuses everywhere else.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");

    openGrid(target);
    pickCell(target, 0, 0);
    expect(
      target.querySelector('[data-sheet="table"] .shell-table-grid-caption').textContent,
    ).toBe("1 × 2");

    clickRow(target, "table", "insert");
    const table = tableIn(ed);
    expect(table.childCount).toBe(2);
    expect(table.child(0).childCount).toBe(1);
  });

  it("leaves no blank paragraph behind when the grid is backed out of", async () => {
    // Task 1's finding, which this row was built not to inherit: `image`
    // and `file` are in slash-insert-target's BLOCK_COMMANDS, so
    // insertionPoint opens a fresh line BEFORE the picker suspends and a
    // cancelled pick leaves it behind. `table` is in BLOCK_COMMANDS too and
    // the grid is a longer gap than any file dialog.
    //
    // So the empty result here is not "nothing happened, presumably
    // correctly". It is the specific absence of a paragraph the writer did
    // not ask for: childCount is asserted alongside the whole doc so a
    // future change that opens the line when the SHEET opens fails here
    // rather than shipping litter. Proven by moving the insertionPoint
    // call to openTableSheet — this test goes red, the four above stay
    // green.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    const before = ed.state.doc.toJSON();
    const countBefore = ed.state.doc.childCount;

    openGrid(target);
    pickCell(target, 3, 4);
    navBack();
    flushSync();

    expect(target.querySelector('[data-sheet="table"]')).toBeNull();
    expect(ed.state.doc.childCount).toBe(countBefore);
    expect(ed.state.doc.toJSON()).toEqual(before);
  });

  it("opens the fresh line at commit, so the table lands below the sentence", async () => {
    // The other half of the same decision. Moving the write to commit time
    // must not lose what `insertionPoint` was there for: `table` is a
    // BLOCK_COMMAND, so on a written line it gets a new line below rather
    // than swallowing the sentence — slash-insert-target.js's whole reason
    // for existing.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");

    openGrid(target);
    clickRow(target, "table", "insert");

    expect(ed.state.doc.child(0).textContent).toBe("kept going");
    expect(ed.state.doc.child(1).type.name).toBe("table");
  });

  it("forgets the last size, so the grid always opens on 3 × 3", async () => {
    // A remembered size is a fourth thing to read before tapping, and the
    // one the writer is most likely to be wrong about. Also the guard on
    // the state living in ShellApp rather than in TableSizeGrid: the
    // component unmounts with the sheet and would reset itself, so nothing
    // but this reset stops `tableCell` surviving into the next open.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    caretIn(editorOf(target), "paragraph");

    openGrid(target);
    pickCell(target, 5, 5);
    expect(
      target.querySelector('[data-sheet="table"] .shell-table-grid-caption').textContent,
    ).toBe("6 × 6");
    navBack();
    flushSync();

    openGrid(target);
    expect(
      target.querySelector('[data-sheet="table"] .shell-table-grid-caption').textContent,
    ).toBe("3 × 3");
  });

  // ── the chart builder (Task 5) ────────────────────────────────────────
  //
  // Reached from the `chart` row above and from the chip strip, and — once
  // a chart is in the document — from a tap on the chart itself. Lives in
  // this describe for the same reason the grid does: the navstack harness
  // and the insert sheet are already standing up here.

  /** Open `+` → `chart` and land on the builder. */
  function openBuilder(target) {
    tapAndSettle(target, "insert");
    clickRow(target, "insert", "chart");
  }

  /** The chart node in the doc, wherever it landed. */
  function chartIn(ed) {
    let found = null;
    ed.state.doc.forEach((node) => {
      if (!found && node.type.name === "chart") found = node;
    });
    return found;
  }

  /** The kind tab with this label, inside the chart sheet. */
  function kindTab(target, label) {
    const tab = [...target.querySelectorAll('[data-sheet="chart"] .shell-chart-form button')].find(
      (b) => b.textContent.trim() === label,
    );
    expect(tab, `no "${label}" kind tab in the chart sheet`).toBeTruthy();
    return tab;
  }

  function pickKind(target, label) {
    kindTab(target, label).click();
    flushSync();
  }

  /** Type into one of the borrowed forms' inputs, the way a writer would.
   *  `input` rather than a value assignment, because every form component
   *  is wired through `oninput` and a silent value write would exercise
   *  none of it. */
  function typeInto(input, text) {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
  }

  it("swaps the insert sheet for the builder, at full detent, writing nothing", async () => {
    // The row's whole reason for having been absent, and the shape Task 4
    // set: the tap produces a builder AND the document is untouched. Not
    // "nothing happens" — it is the difference between this row and the
    // nine that write, and a version that inserted an empty chart here
    // would pass every other assertion in this file.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    const before = ed.state.doc.toJSON();

    openBuilder(target);

    expect(target.querySelector('[data-sheet="insert"]')).toBeNull();
    const sheet = target.querySelector('[data-sheet="chart"]');
    expect(sheet).not.toBeNull();
    // §3: "chart and table editing happen in a full-detent sheet".
    expect(sheet.dataset.detent).toBe("full");
    expect(ed.state.doc.toJSON()).toEqual(before);
  });

  it("opens on flowchart, with ChartBuilder's own form re-hosted", async () => {
    // The proof that the FORMS came across rather than being rebuilt: the
    // node card, its shape picker and its connection chip are
    // ChartFormFlowchart's own markup, rendered inside a shell Sheet. A
    // shell-local reimplementation would have shell class names.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    caretIn(editorOf(target), "paragraph");

    openBuilder(target);

    const sheet = target.querySelector('[data-sheet="chart"]');
    // emptySource("flowchart") is two nodes and one edge between them.
    expect(sheet.querySelectorAll(".node-card")).toHaveLength(2);
    expect(sheet.querySelector(".shape-picker")).not.toBeNull();
    expect(sheet.querySelector(".conn-chip")).not.toBeNull();
    // And the frame is the shell's: the commit row says what the tap does
    // and what it will make.
    expect(target.querySelector('[data-sheet="chart"] .shell-row-label').textContent).toBe(
      "insert",
    );
    expect(target.querySelector('[data-sheet="chart"] .shell-row-value').textContent).toBe(
      "flowchart",
    );
  });

  it("inserts the chart the form was left on", async () => {
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");

    openBuilder(target);
    typeInto(target.querySelector('[data-sheet="chart"] .shell-field-input'), "the shape");
    const [first] = target.querySelectorAll('[data-sheet="chart"] .node-input');
    typeInto(first, "start");
    clickRow(target, "chart", "insert");

    expect(target.querySelector('[data-sheet="chart"]')).toBeNull();
    const chart = chartIn(ed);
    expect(chart).not.toBeNull();
    expect(chart.attrs.kind).toBe("flowchart");
    expect(chart.attrs.source.nodes[0].label).toBe("start");
    expect(chart.attrs.blockTitle).toBe("the shape");
  });

  it("keeps the title but not the diagram when the kind changes", async () => {
    // withKind's rule, through the whole surface. `blockTitle` belongs to
    // the block; `source` belongs to the kind, and a flowchart's nodes
    // would assemble into nothing under a timeline.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    caretIn(editorOf(target), "paragraph");

    openBuilder(target);
    typeInto(target.querySelector('[data-sheet="chart"] .shell-field-input'), "the plan");
    typeInto(target.querySelector('[data-sheet="chart"] .node-input'), "start");
    pickKind(target, "mind map");

    const sheet = target.querySelector('[data-sheet="chart"]');
    expect(sheet.querySelectorAll(".node-card")).toHaveLength(0);
    expect(sheet.querySelectorAll(".branch-input")).toHaveLength(2);
    expect(sheet.querySelector(".shell-field-input").value).toBe("the plan");
  });

  it("withholds the commit row until every timeline event has a date", async () => {
    // chartCanCommit, at the surface. emptySource("timeline") is two
    // DATELESS events, so this is the state the tab opens in rather than
    // an edge case a writer has to construct — and an undated event
    // assembles as an orphaned box beside the spine, which is the chart
    // losing the one thing a timeline is for.
    //
    // Row renders a <div> rather than a <button> when it has no onSelect,
    // so "withheld" is asserted as the absence of a control, not as a
    // disabled attribute the primitive does not have.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    const before = ed.state.doc.toJSON();

    openBuilder(target);
    pickKind(target, "timeline");

    expect(target.querySelector('[data-sheet="chart"] button.shell-row')).toBeNull();
    expect(target.querySelector('[data-sheet="chart"] .shell-row-value').textContent).toBe(
      "every event needs a date",
    );
    // Tapping it writes nothing. What that proves is the PRIMITIVE's half
    // — Row renders a <div> for a null onSelect, so there is no control to
    // press — and it is asserted because "the row looks inert" and "the
    // row is inert" are different claims. commitChart's own guard is a
    // fail-safe below this one and nothing here can reach it; its header
    // says so rather than letting this test look like its proof.
    target.querySelector('[data-sheet="chart"] .shell-row').click();
    flushSync();
    expect(ed.state.doc.toJSON()).toEqual(before);

    const dates = target.querySelectorAll('[data-sheet="chart"] .event-date');
    expect(dates).toHaveLength(2);
    typeInto(dates[0], "2026");
    typeInto(dates[1], "2027");

    expect(target.querySelector('[data-sheet="chart"] button.shell-row')).not.toBeNull();
    clickRow(target, "chart", "insert");
    expect(chartIn(ed).attrs.kind).toBe("timeline");
  });

  it("leaves no blank paragraph behind when the builder is backed out of", async () => {
    // Task 1's finding, which this row was built not to inherit, and
    // `chart` had more of it available than `table` did: it is in
    // BLOCK_COMMANDS like every other block insert, so `insertionPoint`
    // opens a fresh line — but unlike the others its command body writes
    // nothing at all, so running it left the blank paragraph and inserted
    // no block to fill it.
    //
    // So the empty result here is not "nothing happened, presumably
    // correctly". It is the specific absence of a paragraph the writer did
    // not ask for. Proven by moving the `insertionPoint` call from
    // commitChart into openChartSheet: this test goes red and the four
    // above stay green.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");
    const before = ed.state.doc.toJSON();
    const countBefore = ed.state.doc.childCount;

    openBuilder(target);
    typeInto(target.querySelector('[data-sheet="chart"] .node-input'), "start");
    navBack();
    flushSync();

    expect(target.querySelector('[data-sheet="chart"]')).toBeNull();
    expect(ed.state.doc.childCount).toBe(countBefore);
    expect(ed.state.doc.toJSON()).toEqual(before);
  });

  it("opens the fresh line at commit, so the chart lands below the sentence", async () => {
    // The other half of the same decision: moving the write to commit time
    // must not lose what `insertionPoint` was there for. `chart` is a
    // BLOCK_COMMAND, so on a written line it gets a new line below rather
    // than swallowing the sentence.
    //
    // THERE IS NO EMPTY PARAGRAPH BETWEEN THEM, and the absence is
    // asserted rather than trimmed out of the expectation so that a change
    // to it — in either direction — is visible here.
    //
    // There used to be one. `insertChart` inserted at `selection.from`,
    // which after insertionPoint is INSIDE the fresh empty paragraph, so
    // the fitter closed that paragraph and reopened one after the chart:
    // paragraph, paragraph, chart, paragraph. This test recorded that as
    // unfixed and predicted where the fix would have to live — "a
    // `main`-side commit rather than something a host can do from
    // outside". `main`'s `c9645be7` is that commit. It did not reuse
    // `insertBoardReplacingEmptyLeadingParagraph` (chart's insert is a
    // separate command run after an async trip through a builder, so the
    // slash-commands helper cannot reach it); it made `insertChart` itself
    // replace an empty top-level paragraph, on the same three-part test
    // that helper uses — top level, a paragraph, and empty.
    //
    // That fix is shared, so it lands on both surfaces at once: this host
    // opens the fresh line at commit time and the desktop opens it from
    // `/chart`, and both now give paragraph, chart, paragraph.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");

    openBuilder(target);
    clickRow(target, "chart", "insert");

    expect(ed.state.doc.child(0).textContent).toBe("kept going");
    expect(ed.state.doc.content.content.map((n) => n.type.name)).toEqual([
      "paragraph",
      "chart",
      "paragraph",
    ]);
  });

  it("forgets the last draft, so the builder always opens empty", async () => {
    // The guard on the draft living in ShellApp rather than in ChartForm:
    // the component unmounts with the sheet and would reset itself, so
    // nothing but openChartSheet's reseed stops a half-typed flowchart
    // surviving into the next open — where it would be a form the writer
    // has to empty before they can use it.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    caretIn(editorOf(target), "paragraph");

    openBuilder(target);
    typeInto(target.querySelector('[data-sheet="chart"] .shell-field-input'), "the plan");
    typeInto(target.querySelector('[data-sheet="chart"] .node-input'), "start");
    pickKind(target, "timeline");
    navBack();
    flushSync();

    openBuilder(target);
    expect(target.querySelector('[data-sheet="chart"] .shell-field-input').value).toBe("");
    expect(target.querySelectorAll('[data-sheet="chart"] .node-card')).toHaveLength(2);
    expect(target.querySelector('[data-sheet="chart"] .node-input').value).toBe("");
  });

  it("reopens the builder on a chart already in the document, and saves in place", async () => {
    // The half of the seam that has nothing to do with the insert sheet,
    // and the one that was silently missing: `onChartOpen` also carries
    // the NodeView's `{mode: "edit", pos, attrs}` (chart.js:568), so with
    // it defaulted to a no-op a phone could hold a chart — written here a
    // minute earlier, or on the desktop — that it could see and not open.
    //
    // Driven through the block's own click listener rather than by calling
    // openChartBuilder, because the listener is what a thumb reaches and
    // it has guards of its own (it declines on a read-only editor).
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    caretIn(ed, "paragraph");

    openBuilder(target);
    typeInto(target.querySelector('[data-sheet="chart"] .node-input'), "start");
    clickRow(target, "chart", "insert");

    const block = target.querySelector(".chart-block");
    expect(block, "the committed chart rendered no NodeView to tap").toBeTruthy();
    block.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    flushSync();

    // Seeded from the node, not from a fresh draft: the label typed above
    // is in the form, and the row says `save` rather than `insert`.
    expect(target.querySelector('[data-sheet="chart"] .node-input').value).toBe("start");
    expect(target.querySelector('[data-sheet="chart"] .shell-row-label').textContent).toBe("save");

    typeInto(target.querySelector('[data-sheet="chart"] .node-input'), "changed");
    clickRow(target, "chart", "save");

    // Updated in place — one chart, not two, and the paragraph count is
    // what it was before the save.
    let charts = 0;
    ed.state.doc.forEach((node) => {
      if (node.type.name === "chart") charts += 1;
    });
    expect(charts).toBe(1);
    expect(chartIn(ed).attrs.source.nodes[0].label).toBe("changed");
  });
});

// Row 2 of toolbarFor, which had no producer at all until P2c-2 Task 2 —
// the strip was written in P1a and had never been on screen. Everything
// here goes through the header's real button, which is the only way in.
describe("ShellApp — find", () => {
  // The header's controls are plain buttons with an onclick (PageHeader is
  // on the rules test's allowlist for exactly that), so a click is the
  // gesture — not ToolbarButton's pointerdown. Using `tap` here would
  // assert nothing.
  function tapHeader(target, cls) {
    target.querySelector(cls).click();
    flushSync();
  }

  // The find strip is FindStrip, not ToolbarStrip, so `buttonIds` (which
  // scans .shell-toolbar-strip) reads nothing here. Its own reader, and it
  // deliberately reports the FIELD as well as the buttons: what this task
  // changed is that one of the four ids stopped being a button, and a
  // helper that only counted buttons would report that as three controls
  // rather than as the field arriving.
  function findControls(target) {
    return [...target.querySelectorAll(".shell-find-strip input, .shell-find-strip [data-button-id]")].map(
      (el) => el.dataset.buttonId ?? `input:${el.getAttribute("aria-label")}`,
    );
  }

  function findInput(target) {
    return target.querySelector(".shell-find-strip input");
  }

  // Typing, as the field defines it: set the value and fire `input`, which
  // is what a keystroke does. Field reads event.currentTarget.value.
  function typeFind(target, value) {
    const input = findInput(target);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
  }

  // Which of the rendered matches carries the active highlight, or -1.
  // find-replace.js:112-118 puts `find-match-active` on exactly the match
  // at activeIdx, so this is the editor's own answer to "where am I",
  // read off the document rather than off the strip that reports it.
  function activeMatch(target) {
    return [...target.querySelectorAll(".find-match")].findIndex((el) =>
      el.classList.contains("find-match-active"),
    );
  }

  function findLabel(target) {
    return target.querySelector(".shell-find-count").textContent;
  }

  // Two matches for "kept", so `next` has somewhere to go that `prev`
  // does not, and the wrap is one tap further on than either assertion.
  function twoMatchPage() {
    return textPage([{ type: "paragraph", content: [{ type: "text", text: "kept at it" }] }]);
  }

  it("opens the find strip from the header, with the keyboard down", async () => {
    // Keyboard DOWN on purpose. It is the state the header entry point was
    // chosen for — you go looking for something when you are not typing —
    // and it is also the ordering claim inside toolbar-model.js: findOpen
    // is tested before keyboardOpen, so the mode the user opened takes the
    // strip row rather than leaving it empty. The nav row underneath is
    // not part of that contest any more.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { keyboardOpen: false });
    await settleWithEditor();
    expect(target.querySelector(".shell-tabbar")).not.toBeNull();

    tapHeader(target, ".ph-find");

    expect(target.querySelector(".shell-tabbar")).not.toBeNull();
    // Four controls, in FIND_STRIP's order, and the first is an INPUT.
    // Between Task 2 and Task 3 this same strip rendered `field` as a
    // ToolbarButton labelled "find" — a button standing where a text
    // input goes, which looked right in a button-id list and could not be
    // typed into. Naming the element kind is what makes that regression
    // visible to a test rather than only to a screenshot.
    expect(findControls(target)).toEqual(["input:find", "prev", "next", "close"]);
    expect(findInput(target).tagName).toBe("INPUT");
  });

  it("focuses the find field on open, which is the only thing that raises the keyboard", async () => {
    // THE constraint Task 2 recorded for this task. Find is opened from
    // the page header with the keyboard DOWN, and the strip lives in the
    // slot, which is only modal while the keyboard is up. If the field
    // does not take focus the keyboard never rises: the strip appears,
    // nothing can be typed into it, and the mode's only exit is `close`.
    //
    // Asserted on document.activeElement rather than on a focus spy. The
    // focus is scheduled inside Field's mount effect, one rAF ahead, so
    // there is no moment at which a spy could be installed on the element
    // before the call is queued — and activeElement is the stronger claim
    // anyway: it says the focus LANDED, not merely that something asked.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { keyboardOpen: false });
    await settleWithEditor();

    tapHeader(target, ".ph-find");
    await new Promise((r) => requestAnimationFrame(() => r()));

    expect(document.activeElement).toBe(findInput(target));
  });

  it("searches the page with what is typed into the field", async () => {
    // The field's whole job, asserted on the rendered .find-match spans
    // rather than on a setFindQuery spy: a call that fires and highlights
    // nothing is exactly the dead field this task replaced, and a spy
    // cannot tell the two apart.
    api.getOrCreateToday.mockResolvedValue(twoMatchPage());
    const { target } = render(ShellApp, { keyboardOpen: false });
    await settleWithEditor();
    tapHeader(target, ".ph-find");

    typeFind(target, "kept");

    expect(target.querySelectorAll(".find-match").length).toBe(2);
    expect(findLabel(target)).toBe("1 of 2");
  });

  it("advances the active match on next, and steps back on prev", async () => {
    // Both arrows through the strip's real buttons, and both read off the
    // document's own active decoration. Matching is find-replace.js's
    // (nextFindMatch mods by matches.length); what is under test here is
    // only that the tap reaches it.
    api.getOrCreateToday.mockResolvedValue(twoMatchPage());
    const { target } = render(ShellApp, { keyboardOpen: false });
    await settleWithEditor();
    tapHeader(target, ".ph-find");
    typeFind(target, "kept");
    expect(activeMatch(target)).toBe(0);

    tap(target, "next");
    expect(activeMatch(target)).toBe(1);
    expect(findLabel(target)).toBe("2 of 2");

    tap(target, "prev");
    expect(activeMatch(target)).toBe(0);
    expect(findLabel(target)).toBe("1 of 2");
  });

  it("renders prev and next dead on a query that matches nothing", async () => {
    // findStripModel's rule, on screen. The label is the other half of the
    // same decision — "no matches" beside two live arrows would be a strip
    // offering to step through nothing — which is why both are asserted
    // here rather than only the disabled flags.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { keyboardOpen: false });
    await settleWithEditor();
    tapHeader(target, ".ph-find");

    typeFind(target, "zzz");

    expect(target.querySelector('[data-button-id="prev"]').disabled).toBe(true);
    expect(target.querySelector('[data-button-id="next"]').disabled).toBe(true);
    expect(findLabel(target)).toBe("no matches");
    // And `close` stays live beside them: the one control a query that
    // found nothing most needs is the way out of the mode.
    expect(target.querySelector('[data-button-id="close"]').disabled).toBe(false);
  });

  it("says nothing beside a field nobody has typed into", async () => {
    // The distinction findStripModel exists for, carried all the way to
    // the DOM: an empty label, not "no matches". A strip that opened
    // reporting a failed search would be accusing the user of something
    // they have not done yet. Not an assertion that nothing happened —
    // the strip is fully rendered here, and the arrows below prove it.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { keyboardOpen: false });
    await settleWithEditor();

    tapHeader(target, ".ph-find");

    expect(findLabel(target)).toBe("");
    expect(target.querySelector('[data-button-id="next"]').disabled).toBe(true);
  });

  it("forgets the last search's count when find is reopened", async () => {
    // The label is read off the window broadcast, and the broadcast only
    // fires on an editor transaction — so a count left standing from the
    // previous session would sit beside an empty field until the user
    // typed, with no highlights on the page to match it.
    //
    // What actually prevents that is an ORDERING, not a reset: closeFind
    // clears the query, the clear dispatches a transaction, and the
    // strip's listener is still subscribed when it broadcasts, because
    // the effect that owns the subscription tears down on the next flush
    // rather than the moment findOpen flips. This test is the only thing
    // in the tree that can see that ordering: removing the clear reddens
    // this AND the highlight test above, but a teardown that ever won the
    // race would redden this one alone.
    //
    // Verified rather than asserted: an earlier version also reset the
    // state inside openFind, and removing that line left the whole suite
    // green — two mechanisms for one condition, each hiding the other's
    // absence. The redundant one is gone, which is what makes this test
    // mean something.
    api.getOrCreateToday.mockResolvedValue(twoMatchPage());
    const { target } = render(ShellApp, { keyboardOpen: false });
    await settleWithEditor();

    tapHeader(target, ".ph-find");
    typeFind(target, "kept");
    expect(findLabel(target)).toBe("1 of 2");
    tap(target, "close");

    tapHeader(target, ".ph-find");

    expect(findLabel(target)).toBe("");
    expect(findInput(target).value).toBe("");
  });

  it("closes on the strip's close, and takes the highlights with it", async () => {
    // The assertion the whole close path exists for. The highlights are
    // DECORATIONS in the extension's plugin state (find-replace.js), not
    // anything the strip owns, so they outlive the strip: close find with
    // a query standing and every match on the page stays marked, with no
    // bar left on screen to clear them from and no keystroke that clears
    // them either. The desktop bar clears on unmount for the same reason
    // (FindBar.svelte:53) — this is that behaviour, on the phone's own
    // way out of the mode.
    //
    // Asserted on the rendered .find-match spans rather than on a spy:
    // a setFindQuery("") that fired and left the marks up is exactly the
    // no-op this guards, and a spy on the command cannot tell them apart.
    //
    // The query goes in through the strip's own field now that Task 3 has
    // built it. Until then this drove editor.commands.setFindQuery
    // directly, which was the same command one step further in; typing it
    // is the whole user path, and it is what a real close has to undo.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { keyboardOpen: false });
    await settleWithEditor();

    tapHeader(target, ".ph-find");
    typeFind(target, "kept");
    expect(target.querySelectorAll(".find-match").length).toBe(1);

    tap(target, "close");

    expect(target.querySelectorAll(".find-match").length).toBe(0);
    // And the slot goes back to whatever the state under the mode says —
    // here the tab bar, since the keyboard is down. A close that cleared
    // the query and left the strip up would be a mode with no exit.
    expect(target.querySelector(".shell-tabbar")).not.toBeNull();
  });

  it("leaves the header's find inert until there is a page to search", async () => {
    // NOT "nothing happens because nothing is wired". The button is wired;
    // openFind declines while there is no editor, and the empty result is
    // the right one for a specific reason: findOpen outranks every row but
    // an open sheet, so opening here would take the tab bar away and put a
    // four-control strip over a page that has not loaded — a mode with
    // nothing to search and, since `close` needs the same editor, no way
    // out of it either.
    const { target } = render(ShellApp, { keyboardOpen: false });
    flushSync();

    tapHeader(target, ".ph-find");

    expect(target.querySelector(".shell-tabbar")).not.toBeNull();
    expect(target.querySelector(".shell-toolbar-strip")).toBeNull();
    // The find strip is its own element now, so the ToolbarStrip check
    // above no longer covers it: without this line the assertion would
    // hold just as happily while a four-control find strip sat in the
    // slot over a page that had not loaded.
    expect(target.querySelector(".shell-find-strip")).toBeNull();

    // Drain the load this test rendered but never waited for, so its
    // resolutions do not land during whatever runs next.
    await settle();
  });
});

describe("ShellApp — the suggestion strip", () => {
  // Its own reader: the chips are SuggestionStrip, not ToolbarStrip, so
  // `buttonIds` scans past them. The two never coexist — one slot — which
  // is what lets each test assert the other's absence as the real check
  // that the row swapped rather than that a strip merely appeared.
  function chipIds(target) {
    return [...target.querySelectorAll(".shell-suggestion-strip [data-button-id]")].map(
      (b) => b.dataset.buttonId,
    );
  }

  // Typing a trigger, through a real transaction on the real editor —
  // never by handing toolbarFor a `query` object. The whole reason row 4
  // needed fixing is that the shape flowing through it was never
  // exercised end to end: the caret has to be somewhere the suggestion
  // plugin will match from (its `allowedPrefixes` default is a space, so
  // a trigger typed hard against a word is not one), the plugin has to
  // activate, computeSnapshot has to report it, and the chips have to
  // resolve from it. A fixture skips all four.
  function typeTrigger(target, text) {
    const ed = editorOf(target);
    ed.view.dispatch(
      ed.state.tr.setSelection(TextSelection.create(ed.state.doc, ed.state.doc.content.size - 1)),
    );
    ed.commands.insertContent(text);
    flushSync();
    return ed;
  }

  function docText(ed) {
    return ed.state.doc.textBetween(0, ed.state.doc.content.size, " ", " ");
  }

  it("lays the slash menu out as chips when a trigger is typed", async () => {
    // Row 4's first real appearance. The phone has no floating slash menu
    // of its own by spec, so before this the slot's answer to `/` was to
    // reserve a band and put nothing in it.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    expect(buttonIds(target)).toContain("undo");

    typeTrigger(target, " /head");

    expect(chipIds(target)).toEqual(["heading 1", "heading 2", "heading 3"]);
    // The block strip is gone, not merely covered: one slot, one owner.
    expect(target.querySelector(".shell-toolbar-strip")).toBeNull();
  });

  it("renders no chip dead — a chip exists exactly when its command does", async () => {
    // The strip takes no disabledIds at all (SuggestionStrip's header
    // says why), so this asserts the OUTCOME of that rather than the
    // prop: had the chips gone through ToolbarStrip, ShellApp's disabled
    // derivation would have measured each title against COMMANDS, found
    // nothing, and greyed out the entire strip.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    typeTrigger(target, " /head");

    const chips = [...target.querySelectorAll(".shell-suggestion-strip [data-button-id]")];
    expect(chips.length).toBe(3);
    expect(chips.every((c) => c.disabled === false)).toBe(true);
  });

  it("keeps the block strip for a trigger that matches no command", async () => {
    // THE defect, at the surface where it was visible. `/zzzz` is a live
    // query with nothing behind it, and row 4 used to take the slot for
    // it and render an empty band — the same reserved-but-empty chrome
    // ShellRoot's header calls a bug, on the most common keystroke in the
    // editor. Asserting the block strip is STILL THERE, not merely that
    // the chip strip is absent: "no chips" and "no strip at all" look
    // identical to a check that only looks for chips.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = typeTrigger(target, " /zzzz");
    // The trigger really is live. Without this the test is the empty
    // assertion CLAUDE.md's second rule is about: a `/zzzz` that never
    // activated the plugin falls through for a reason that was already
    // true before this task, and the row-4 fix would be untested while
    // the test that named it stayed green.
    expect(SlashCommandsPluginKey.getState(ed.state).active).toBe(true);

    expect(target.querySelector(".shell-suggestion-strip")).toBeNull();
    expect(buttonIds(target)).toContain("undo");
  });

  // `@` on the phone: the desktop's mention menu laid flat into the strip,
  // from the same `mentionItems` (mention-chips.js). Waited past the
  // strip's 120 ms debounce and the async search before reading.
  const mentionSettle = async () => {
    await new Promise((r) => setTimeout(r, 200));
    await settle();
    flushSync();
  };

  it("offers the pages @ finds as chips, and a tap writes the reference in place of what was typed", async () => {
    api.searchPagesForMention.mockResolvedValue([
      { page_id: "P9", date: "2026-10-28", page_number: 1, what_matters_now: "ferry times", lineage_id: null },
    ]);
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = typeTrigger(target, " @fer");
    expect(MentionCommandPluginKey.getState(ed.state).active).toBe(true);
    await mentionSettle();

    expect(chipIds(target)).toContain("page:P9");
    const chip = target.querySelector('.shell-suggestion-strip [data-button-id="page:P9"]');
    expect(chip.textContent).toContain("ferry times");

    tap(target, "page:P9");
    await settle();

    const refs = [];
    ed.state.doc.descendants((n) => { if (n.type.name === "pageRef") refs.push(n.attrs.targetId); });
    expect(refs).toEqual(["P9"]);
    expect(docText(ed)).not.toContain("@fer");
  });

  it("offers a pin @ finds, and a tap writes a pin reference", async () => {
    api.searchPinsForMention.mockResolvedValue([{ id: "PIN4", title: "the night boat", scope_label: "global" }]);
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = typeTrigger(target, " @night");
    await mentionSettle();
    expect(chipIds(target)).toContain("pin:PIN4");

    tap(target, "pin:PIN4");
    await settle();
    const refs = [];
    ed.state.doc.descendants((n) => { if (n.type.name === "pinRef") refs.push(n.attrs.pinId); });
    expect(refs).toEqual(["PIN4"]);
  });

  it("keeps the block strip while @ has found nothing yet", async () => {
    // A bare `@` with no pages, no pins and nothing typed to make a trail
    // from: an empty answer, so the slot keeps the strip the writer had
    // rather than blanking. (A real bare `@` lists recent pages, as on the
    // desktop; here the searches answer with nothing.)
    api.searchPagesForMention.mockResolvedValue([]);
    api.searchPinsForMention.mockResolvedValue([]);
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = typeTrigger(target, " @");
    expect(MentionCommandPluginKey.getState(ed.state).active).toBe(true);
    await mentionSettle();

    expect(target.querySelector(".shell-suggestion-strip")).toBeNull();
    expect(buttonIds(target)).toContain("undo");
  });

  it("inserts the block a chip names, on a fresh line below the writing", async () => {
    // The tap, asserted on the DOCUMENT rather than on a spy — the same
    // rule the strip and the sheets are held to. `/outline` on a written
    // line is the case slash-insert-target.js exists for: the block goes
    // BELOW, and the sentence survives. It is also the case a chip that
    // ran its command without consuming the trigger first would get
    // wrong, because the leftover "/outline" makes the line look written.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = typeTrigger(target, " /outline");
    expect(chipIds(target)).toEqual(["outline"]);

    tap(target, "outline");

    const types = ed.state.doc.content.content.map((n) => n.type.name);
    expect(types).toContain("blockquote");
    expect(types[0]).toBe("paragraph");
    expect(ed.state.doc.firstChild.textContent).toBe("kept going ");
  });

  it("consumes the typed trigger the chip acted on", async () => {
    // The trigger consumption, and the only thing that proves it. This
    // used to guard a LATCH — a range copied off every snapshot, because
    // the desktop's floating slash menu was mounted here too and its
    // outside-dismiss listener (document, CAPTURE phase, slash-commands.js)
    // beat the chip's own pointerdown handler and zeroed the plugin's
    // range first. The chip reads the live plugin state at tap time now,
    // and the latch is gone, because PageScreen passes
    // floatingChrome={false}: with `floatingMenu: false` that renderer is
    // silentSuggestionRender, which attaches no listener at all.
    //
    // This test is what licensed that deletion, and it is discriminating
    // both ways — checked rather than assumed, twice:
    //   - neutering the tap-time read to `return null` reddens this and
    //     "inserts the block a chip names" with 'kept going /outline  ';
    //   - restoring floatingChrome={true} while keeping the tap-time read
    //     reddens the identical pair with the identical text, which is
    //     the original bug reproduced on demand.
    // So it goes red the moment a floating menu comes back to this editor.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = typeTrigger(target, " /outline");
    tap(target, "outline");

    expect(docText(ed)).not.toContain("/outline");
    expect(docText(ed)).not.toContain("/");
  });

  it("gives the slot back when the typed trigger is deleted", async () => {
    // The latching bug toolbar-model.js's header warns about, from the
    // consumer's side: a strip that outlives its trigger is worse than one
    // that never opened. Nothing toggles it — the chips leave because the
    // text they came from left.
    //
    // The trigger is deleted with a real transaction rather than by
    // TAPPING a chip, and that is the point of the test rather than a
    // detail of it. A tap does four things at once — dismisses, deletes
    // the range, moves the caret, inserts a block — so a tap-driven
    // version cannot say WHICH of them the strip followed. Written as a
    // tap when the floating menu was still mounted here, it stayed green
    // with the chip's dispatch removed entirely: the menu's own
    // outside-dismiss ended the query by itself, one mechanism covering
    // for another, which is the shape Task 3 of this phase already found
    // once. That particular cover is gone with the menu (the chip strip
    // is the only slash UI now), and the isolation is kept anyway,
    // because it is what makes the assertion mean "the chips left because
    // their text left".
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    const ed = typeTrigger(target, " /outline");
    expect(target.querySelector(".shell-suggestion-strip")).not.toBeNull();

    const end = ed.state.doc.content.size - 1;
    ed.view.dispatch(ed.state.tr.delete(end - "/outline".length, end));
    flushSync();

    expect(target.querySelector(".shell-suggestion-strip")).toBeNull();
    expect(buttonIds(target)).toContain("undo");
  });

  // ── the two chips that open a builder (Task 5) ────────────────────────
  //
  // The strip runs a chip by slash-command TITLE, and for two of the
  // titles running the command is the wrong answer. Both were reachable
  // before this task and neither did what its label says.

  it("opens the builder for the chart chip instead of running a command that cannot finish", async () => {
    // STEP 3'S ANSWER, and the plan's premise turned out to be the other
    // way round: a phone could NOT insert a chart it could not edit. The
    // `chart` command's whole body is `deleteRange` + `openChartBuilder`,
    // which dispatches through the host callback the shell defaulted to a
    // no-op — so the chip deleted the writer's typed `/chart`, opened a
    // fresh paragraph through `insertionPoint`, and inserted nothing. A
    // dead chip that left litter, on a strip whose own model promised it
    // could not have one.
    //
    // The document assertion is what makes this test discriminating.
    // Routing the chip back through `runSlashInsert` now REOPENS the sheet
    // by itself (that is what wiring onChartOpen bought), so a test that
    // only looked for the sheet would stay green on the old path — it is
    // the extra paragraph that reddens. Checked that way round: with
    // BUILDER_SHEETS' branch removed from pickSuggestion the doc grows a
    // paragraph and this test fails on childCount while the sheet is up.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    const countBefore = ed.state.doc.childCount;

    typeTrigger(target, " /chart");
    expect(chipIds(target)).toEqual(["chart"]);
    tap(target, "chart");

    const sheet = target.querySelector('[data-sheet="chart"]');
    expect(sheet, "the chart chip opened no builder").not.toBeNull();
    expect(sheet.dataset.detent).toBe("full");
    // The trigger is consumed — a chip tap means "I chose this command",
    // and the desktop deletes the range before its modal opens too.
    expect(docText(ed)).not.toContain("/chart");
    // And nothing else was written, so backing out here costs the writer
    // nothing the way it costs them nothing from the insert sheet.
    expect(ed.state.doc.childCount).toBe(countBefore);
  });

  it("opens the size grid for the table chip rather than inserting a silent 3 × 3", async () => {
    // Found while wiring the chart chip, and it is the same defect one
    // surface over: `table` is the one command in `commandItems` whose
    // `command` takes a size, and it defaults to {rows: 3, cols: 3}. So
    // the chip inserted a 3×3 with no grid while the `table` ROW on the
    // insert sheet opened a 6×6 picker — one label meaning two things,
    // and the chip's meaning was the one the desktop does not have (its
    // menu wraps the item in the grid, slash-commands.js:1011).
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    const ed = editorOf(target);
    const countBefore = ed.state.doc.childCount;

    typeTrigger(target, " /table");
    expect(chipIds(target)).toEqual(["table"]);
    tap(target, "table");

    expect(target.querySelector('[data-sheet="table"]')).not.toBeNull();
    expect(target.querySelectorAll('[data-sheet="table"] .shell-table-grid-cell')).toHaveLength(36);
    expect(docText(ed)).not.toContain("/table");
    expect(ed.state.doc.childCount).toBe(countBefore);
  });
});

// The producer end of gestureOwner's first row. The table has said "a live
// block drag wins outright" since P1a and nothing in the tree had ever made
// `dragActive` true — fourteen tests over a row that could not fire.
//
// This is the SEAM: the handle's hold, PageScreen's callback, this file's
// state, ShellRoot's prop. The row's own behaviour — that "drag" beats the
// canvas swipe — is asserted where the table is asked, in ShellRoot.test.js
// ("gives a live block drag the canvas's own swipe"). Two tests, one chain,
// and neither is enough alone: the router test would stay green forever
// with no producer, and this one would stay green if the table stopped
// reading the prop.
describe("ShellApp — a lifted block owns the gesture", () => {
  const frame = (target) => target.querySelector(".shell-root");

  it("tells the frame a block is lifted, and takes it back on release", async () => {
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    expect(frame(target).classList.contains("dragging")).toBe(false);

    // The clock is taken only now: settleWithEditor above rides real
    // setTimeout hops, and the hold is the one thing here worth 350ms of
    // nobody's time.
    vi.useFakeTimers();
    const handle = target.querySelector('[data-button-id="block-handle"]');
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }),
    );
    vi.advanceTimersByTime(350);
    flushSync();

    expect(frame(target).classList.contains("dragging")).toBe(true);
    // And the hold is not also a tap: a sheet over a lifted block would
    // leave the writer dragging something they cannot see.
    expect(target.querySelector('[data-sheet="block-actions"]')).toBeNull();

    window.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1 }),
    );
    flushSync();

    expect(frame(target).classList.contains("dragging")).toBe(false);
  });

  it("leaves the frame alone for a tap on the same handle", async () => {
    // The other half, and the reason it is here rather than only in
    // PageScreen.test.js: a producer that fired on every press would put
    // the whole shell into a drag every time the writer opened the block
    // sheet, and nothing downstream of this file could tell.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    tap(target, "block-handle");
    flushSync();

    expect(frame(target).classList.contains("dragging")).toBe(false);
    expect(target.querySelector('[data-sheet="block-actions"]')).not.toBeNull();
  });
});

// The header's own sheets (P2f Task 3). `onDate`, `onPages`, `onNew` and
// the trail tag were declared and forwarded from P2a on and reached
// nothing; these are their producers.
//
// Everything here drives the real header's real controls — PageHeader
// renders ordinary elements with click handlers, so a click IS the tap —
// and asserts on the real Sheet, which claims its slot inside an effect
// (so a flushSync follows every open).
describe("ShellApp — the header's sheets", () => {
  // navstack's harness, copied from the block sheet describe for its
  // reason: jsdom's history.back() is asynchronous, so an unstubbed back
  // press asserts against a stack that has not unwound yet.
  let historyStates;
  let navTeardown;

  beforeEach(async () => {
    // ONE MACROTASK BEFORE ANYTHING, and it is not padding. The describe
    // above this one ends with a sheet still open; its teardown closes
    // that sheet, which calls history.go(-1) on the REAL history because
    // that describe installs no stubs. jsdom delivers the resulting
    // popstate asynchronously — so without this drain it arrives inside
    // the first test HERE, after initNavStack has registered a listener
    // for it, and pops the entry belonging to the sheet that test just
    // opened. The symptom was a sheet that opened and vanished in the
    // first test of this block and nowhere else, and it went away when
    // the test was run alone, which is what a leaked async teardown looks
    // like from the inside.
    await new Promise((r) => setTimeout(r, 0));
    _resetForTests();
    historyStates = [];
    vi.spyOn(window.history, "pushState").mockImplementation((state) => {
      historyStates.push(state);
    });
    vi.spyOn(window.history, "back").mockImplementation(() => {
      historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    vi.spyOn(window.history, "go").mockImplementation((n) => {
      for (let i = 0; i < -n; i++) historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    navTeardown = initNavStack();
  });

  // cleanupAll FIRST — unmounting closes nav entries and rewinds history,
  // so the components have to go while the stubs are still installed.
  afterEach(() => {
    cleanupAll();
    navTeardown();
    vi.restoreAllMocks();
  });

  const TODAY = getLocalDateStr();

  function summary(over = {}) {
    return { id: "s1", date: TODAY, page_number: 1, ...over };
  }

  /** A tap on a header control, plus the flush Sheet's claim effect needs,
   *  plus the settle its fetch needs. Both sheets that fetch open FIRST and
   *  fill behind themselves, so the flush alone would see a sheet with only
   *  its synthesised rows in it. */
  async function openFromHeader(target, selector) {
    const el = target.querySelector(selector);
    expect(el, `no ${selector} in the header`).toBeTruthy();
    el.click();
    flushSync();
    await settle();
  }

  function sheetRows(target, tag) {
    return [...target.querySelectorAll(`[data-sheet="${tag}"] .shell-row`)].map((r) =>
      r.querySelector(".shell-row-label").textContent.trim(),
    );
  }

  function sheetRow(target, tag, label) {
    return [...target.querySelectorAll(`[data-sheet="${tag}"] .shell-row`)].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
    );
  }

  async function clickSheetRow(target, tag, label) {
    const row = sheetRow(target, tag, label);
    expect(row, `no "${label}" row in the ${tag} sheet`).toBeTruthy();
    row.click();
    flushSync();
    await settle();
    flushSync();
  }

  it("opens the date sheet with today first, then the days that have writing", async () => {
    // Today is unconditional — the one day the writer can still write on,
    // and the way back from a past page. The rest are days getThread found
    // something on; a calendar grid would offer to open pages that do not
    // exist.
    // Yesterday is COMPUTED, not written down. The first version of this
    // test hardcoded a date and asserted the label "yesterday" — which was
    // true on the day it was written and false the next morning, so it
    // went red overnight with nothing having changed. A test whose colour
    // depends on the wall clock is not a test. The old day stays literal
    // because "24 aug" is an absolute label whatever today is — until
    // 2027, which is what `dayLabel`'s own year rule is for.
    api.getThread.mockResolvedValue([
      summary({ id: "y", date: getYesterdayStr() }),
      summary({ id: "o", date: "2026-08-24" }),
    ]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-date");
    flushSync();

    expect(target.querySelector('[data-sheet="date"]')).not.toBeNull();
    expect(sheetRows(target, "date")).toEqual(["today", "yesterday", "24 aug"]);
  });

  it("says where other days go when today is the sheet's only row", async () => {
    // A fresh device: getThread answers nothing, so dayRows is today alone,
    // and the half sheet used to open onto one row and a blank band. The
    // sentence is decided in page-picker.js (daySheetNote); this proves the
    // sheet actually RENDERS it, which the pure test cannot see. Delete the
    // {#if daySheetNoteText} block in ShellApp.svelte and this goes red.
    api.getThread.mockResolvedValue([]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-date");
    flushSync();

    expect(sheetRows(target, "date")).toEqual(["today"]);
    // `.shell-note` is Note's own class: the sentence renders through the
    // primitive since the visual pass, not through a rule of ShellApp's.
    const note = target.querySelector('[data-sheet="date"] .shell-note');
    expect(note?.textContent).toBe("days you write on appear here.");
  });

  it("says nothing on the date sheet once another day has writing", async () => {
    // The row above the note already shows a day that got there by being
    // written on, so the sentence would repeat what the list demonstrates.
    api.getThread.mockResolvedValue([summary({ id: "y", date: getYesterdayStr() })]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-date");
    flushSync();

    expect(sheetRows(target, "date")).toEqual(["today", "yesterday"]);
    expect(target.querySelector('[data-sheet="date"] .shell-note')).toBeNull();
  });

  it("marks a day row a choice, and the day already showing a value — no chevron on either", async () => {
    // A date row selects a day and pops, and the chevron is the promise
    // that a tap opens a screen (row-kind.js) — no screen opens here. The
    // row for the day already on screen has no onSelect and no kind, so
    // Row derives `value` for it: passing "choice" to an inert row would
    // stamp a choice on a line that cannot be chosen. Drop `kind` from
    // the date sheet's Row and yesterday's row derives `push` and draws
    // `›`, which is what every date row did until the visual pass.
    api.getThread.mockResolvedValue([summary({ id: "y", date: getYesterdayStr() })]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-date");
    flushSync();

    const rows = [...target.querySelectorAll('[data-sheet="date"] .shell-row')];
    expect(rows.map((r) => r.dataset.kind)).toEqual(["value", "choice"]);
    expect(target.querySelector('[data-sheet="date"] .shell-row-chevron')).toBeNull();
  });

  it("empties the slot behind the date sheet — the frame stops reserving the band", async () => {
    // toolbarFor's row 1, the same requirement the block sheet carries:
    // .shell-slot ABSENT rather than merely empty, because ShellRoot's
    // header calls a reserved-but-empty band a bug.
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    expect(target.querySelector(".shell-toolbar-strip")).not.toBeNull();

    await openFromHeader(target, ".ph-date");
    flushSync();

    expect(target.querySelector(".shell-slot")).toBeNull();
    expect(target.querySelector(".shell-toolbar-strip")).toBeNull();
  });

  it("closes the date sheet on back, and the slot comes back with it", async () => {
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    await openFromHeader(target, ".ph-date");
    flushSync();
    expect(target.querySelector('[data-sheet="date"]')).not.toBeNull();

    navBack();
    flushSync();

    expect(target.querySelector('[data-sheet="date"]')).toBeNull();
    expect(target.querySelector(".shell-toolbar-strip")).not.toBeNull();
  });

  it("opens a past day, and the canvas refuses to be typed into", async () => {
    // The product decision this task had to make before it could build the
    // list. CLAUDE.md: "past pages are read-only… write today on PAGE".
    // Reached from the page root rather than from memory because memory is
    // P3 and a sheet whose every row lands on "not built yet" is a sheet
    // with a dead end behind it; the RULE is what has to hold, and it is
    // page-writable.js that now holds it.
    api.getThread.mockResolvedValue([summary({ id: "old", date: LONG_AGO })]);
    api.getPage.mockResolvedValue(
      withLines(pageRow({ id: "old", date: LONG_AGO, is_open: true })),
    );
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();
    expect(editorOf(target).isEditable).toBe(true);

    await openFromHeader(target, ".ph-date");
    flushSync();
    await clickSheetRow(target, "date", "2 jan");
    await settleWithEditor();

    expect(target.querySelector(".ph-date-label").textContent).toContain("jan");
    expect(editorOf(target).isEditable).toBe(false);
  });

  it("opens a day tapped on the sheet's calendar", async () => {
    // "also in the today" — the fourth device pass asked for the picker
    // here as well as in memory's filters. The list stays for the recent
    // days; the grid is for the day further back than a list can carry.
    api.getThread.mockResolvedValue([summary({ id: "old", date: LONG_AGO })]);
    api.getPage.mockResolvedValue(
      withLines(pageRow({ id: "old", date: LONG_AGO, is_open: true })),
    );
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    await openFromHeader(target, ".ph-date");
    flushSync();
    // It opens on the month of the page being read — today's, here.
    const sheet = () => target.querySelector('[data-sheet="date"]');
    expect(sheet().querySelector(".shell-calendar-month").textContent.trim())
      .toBe(monthLabel(getLocalDateStr()));

    const back = sheet().querySelector('[aria-label="previous month"]');
    for (let i = 0; i < monthsBetween(LONG_AGO, getLocalDateStr()); i += 1) back.click();
    flushSync();
    const day = sheet().querySelector(`[data-date="${LONG_AGO}"]`);
    // The day has a page, so it is a control and it carries the mark.
    expect(day.tagName).toBe("BUTTON");
    expect(day.dataset.marked).toBe("true");
    day.click();
    await settleWithEditor();

    expect(target.querySelector(".ph-date-label").textContent).toContain("jan");
    expect(target.querySelector('[data-sheet="date"]')).toBeNull();
  });

  it("draws a day with no page, and refuses to open it", async () => {
    // The rows here are the days that HAVE pages; a day with none has
    // nothing to open. Drawn and inert rather than absent, because a
    // calendar with holes in it cannot be read.
    api.getThread.mockResolvedValue([summary({ id: "old", date: LONG_AGO })]);
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    await openFromHeader(target, ".ph-date");
    flushSync();
    const sheet = target.querySelector('[data-sheet="date"]');
    const empty = [...sheet.querySelectorAll(".shell-calendar-day")]
      .find((el) => !el.dataset.marked && el.dataset.date !== getLocalDateStr());
    expect(empty.tagName).toBe("SPAN");
    api.getPage.mockClear();
    empty.click();
    await settle();
    expect(api.getPage).not.toHaveBeenCalled();
    // And the sheet is still up: nothing happened, and it says so by
    // staying where it was.
    expect(target.querySelector('[data-sheet="date"]')).not.toBeNull();
  });

  it("addresses the page it opens by id, never by the number that differs per device", async () => {
    // page-address.js's scar: (date, page_number) resolves to a different
    // page on each device, and once opened somebody else's page entirely.
    api.getThread.mockResolvedValue([summary({ id: "u-9", date: LONG_AGO, page_number: 4 })]);
    api.getPage.mockResolvedValue(withLines(pageRow({ id: "u-9", date: LONG_AGO })));
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-date");
    flushSync();
    await clickSheetRow(target, "date", "2 jan");

    expect(api.getPage).toHaveBeenCalledWith(LONG_AGO, 4, "u-9");
  });

  it("makes the dots a control only when the day has more than one page", async () => {
    // §4 removes the right-edge swipe — the gesture that "swung between
    // too eager and dead" — and says "the dots strip and the pages sheet
    // carry page switching". They are its replacement, so the only
    // question left is when there is a second page to switch TO. That gate
    // was written in P2a and this wires the sheet behind it.
    const alone = render(ShellApp);
    await settle();
    expect(alone.target.querySelector("button.ph-dots")).toBeNull();

    api.getFocusesForDate.mockResolvedValue([
      summary({ id: "p1", page_number: 1 }),
      summary({ id: "p2", page_number: 2 }),
      summary({ id: "p3", page_number: 3 }),
    ]);
    const many = render(ShellApp);
    await settle();
    expect(many.target.querySelector("button.ph-dots")).not.toBeNull();
  });

  it("lists the day's pages by ordinal, with the writer's own focus line", async () => {
    api.getFocusesForDate.mockResolvedValue([
      summary({ id: "p1", page_number: 4, what_matters_now: "chapter 4" }),
      summary({ id: "p2", page_number: 9, what_matters_now: "the ending" }),
    ]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, "button.ph-dots");
    flushSync();

    // The list, and under it the one row that can remove from it — see
    // page-picker.js's pageSheetRows. It names the page it would take rather
    // than saying "this page", which is the safeguard for an act that
    // happens at one tap and does not come back.
    expect(sheetRows(target, "pages")).toEqual(["page 1", "page 2", "delete page 1"]);
    expect(sheetRow(target, "pages", "page 2").textContent).toContain("the ending");
    // The page being shown is a fact, not a choice: it renders with no
    // control at all, which is what Row does for a row that only displays.
    expect(sheetRow(target, "pages", "page 1").tagName).toBe("DIV");
    expect(sheetRow(target, "pages", "page 2").tagName).toBe("BUTTON");
  });

  it("deletes the page that is showing and lands on its neighbour", async () => {
    // A PAGE COULD NOT BE REMOVED ON THE PHONE AT ALL until this row: the
    // backend has had delete_focus all along and the desktop wires it through
    // FocusRail, while the shell's sheet only ever opened pages.
    //
    // The fallback is the desktop's on purpose — previous, else next, else
    // today (Page.svelte's handleRailDelete). The two trees disagreeing about
    // where a writer ends up after a delete is the kind of difference nobody
    // notices until it has annoyed them twice.
    api.getFocusesForDate.mockResolvedValue([
      summary({ id: "p1", page_number: 4 }),
      summary({ id: "p2", page_number: 9 }),
    ]);
    //
    // THE MOCK'S SHAPE IS THE POINT, and this test was green with the wrong
    // one while the real path threw on a phone. get_adjacent_page answers
    // {page, lines, session_markers} — a page-with-lines, like get_page — and
    // a mock that handed back a bare row made a handler that looked the
    // neighbour up AGAIN, by an address the wrapper does not carry, look
    // correct. A mock is a claim about the backend; this one was false.
    const neighbour = pageRow({ id: "p2", page_number: 9 });
    api.getAdjacentPage.mockResolvedValue(withLines(neighbour));
    // THE HANDLER'S OWN CATCH, WATCHED. It logs and swallows, which is right
    // for a surface that must not die in a writer's hands — and it is why the
    // real failure was invisible to a test that only counted calls. Both of
    // this day's pages are dated today, so a count-with-today assertion is
    // satisfied by the boot load whether the delete worked or threw.
    const complained = vi.spyOn(console, "error").mockImplementation(() => {});
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, "button.ph-dots");
    flushSync();
    // Two taps (page-picker.js pageSheetRows): the first arms the row and
    // deletes nothing.
    sheetRow(target, "pages", "delete page 1").click();
    await settle();
    expect(api.deleteFocus).not.toHaveBeenCalled();
    sheetRow(target, "pages", "tap again to delete page 1").click();
    await settle();

    expect(api.deleteFocus).toHaveBeenCalledWith("p1");
    // The neighbour is asked for BEFORE the delete: afterwards the page it is
    // computed from is gone and the backend would be answering about a page
    // that no longer exists.
    expect(api.getAdjacentPage).toHaveBeenCalledWith("p1", "prev");
    // AND IT IS NOT LOOKED UP A SECOND TIME. The neighbour arrives whole, so
    // a getPage here would be the bug: the only thing available to address it
    // with is the wrapper, which carries no id and no date, and get_page
    // answers that with "date required when page_id is null" — after the
    // delete has committed, leaving the writer on the page that is gone.
    expect(api.getPage).not.toHaveBeenCalled();
    // The writer really landed on it rather than the failure being swallowed:
    // counting the day's pages is work only adoptPage does.
    expect(api.getFocusesForDate).toHaveBeenCalledWith(neighbour.date);
    expect(complained).not.toHaveBeenCalled();
    complained.mockRestore();
    // Not asserted here: that getOrCreateToday stayed out of it. The shell
    // calls it once on boot to have a page at all, so the count cannot tell
    // the boot from the fallback — and the fallback has its own test below.
  });

  it("lands on a fresh today when the page deleted was the day's last", async () => {
    // Deleting a page with no neighbour on either side leaves the writer on a
    // fresh today — where `+` would have put them — rather than on a day with
    // nothing in it.
    //
    // TWO PAGES IN THE LIST, and the neighbour lookup answering null anyway,
    // because the one-page case cannot be reached from the screen at all: a
    // day with a single page has no dots in the header, so there is nothing
    // to open the sheet with. That is the header's rule and a reasonable one
    // — the sheet exists to choose BETWEEN pages — and it means "delete the
    // only page of a day" is a property of the model rather than a thing a
    // writer can do. Worth knowing, not worth special-casing.
    api.getFocusesForDate.mockResolvedValue([
      summary({ id: "p1", page_number: 1 }),
      summary({ id: "p2", page_number: 2 }),
    ]);
    api.getAdjacentPage.mockResolvedValue(null);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, "button.ph-dots");
    flushSync();
    sheetRow(target, "pages", "delete page 1").click();
    await settle();
    sheetRow(target, "pages", "tap again to delete page 1").click();
    await settle();

    expect(api.deleteFocus).toHaveBeenCalledWith("p1");
    expect(api.getOrCreateToday).toHaveBeenCalled();
  });

  it("forgets an armed delete when the sheet closes, so one later tap deletes nothing", async () => {
    // A confirm that outlived its sheet would make the NEXT visit's first
    // tap the second one: the two-step only protects if it starts over.
    api.getFocusesForDate.mockResolvedValue([
      summary({ id: "p1", page_number: 1 }),
      summary({ id: "p2", page_number: 2 }),
    ]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, "button.ph-dots");
    flushSync();
    sheetRow(target, "pages", "delete page 1").click();
    await settle();
    expect(sheetRow(target, "pages", "tap again to delete page 1")).toBeTruthy();
    target.querySelector(".shell-sheet-scrim").click();
    await settle();

    await openFromHeader(target, "button.ph-dots");
    flushSync();
    const row = sheetRow(target, "pages", "delete page 1");
    expect(row, "the reopened sheet starts unarmed").toBeTruthy();
    row.click();
    await settle();
    expect(api.deleteFocus).not.toHaveBeenCalled();
  });

  it("switches to another page of the day", async () => {
    api.getFocusesForDate.mockResolvedValue([
      summary({ id: "p1", page_number: 1 }),
      summary({ id: "p2", page_number: 2 }),
    ]);
    api.getPage.mockResolvedValue(withLines(pageRow({ id: "p2", page_number: 2 })));
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, "button.ph-dots");
    flushSync();
    await clickSheetRow(target, "pages", "page 2");

    expect(api.getPage).toHaveBeenCalledWith(TODAY, 2, "p2");
    expect(target.querySelector('[data-sheet="pages"]')).toBeNull();
  });

  it("+ starts a new page on TODAY, from whatever day is showing", async () => {
    // A new page is now. createNewPage(pastDate) is a legal call that
    // manufactures a page page-writable.js immediately locks — empty,
    // dated last Tuesday, refusing every keystroke — so `+` on a past page
    // is the way back to now rather than a control that makes dead pages.
    // It is also the shell's whole answer to midnight until the spec's
    // midnight sheet exists.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ date: LONG_AGO })));
    api.createNewPage.mockResolvedValue(withLines(pageRow({ id: "fresh", page_number: 2 })));
    const { target } = render(ShellApp);
    await settle();
    expect(target.querySelector(".ph-date-label").textContent).toContain("jan");

    target.querySelector(".ph-new").click();
    flushSync();
    await settle();
    flushSync();

    expect(api.createNewPage).toHaveBeenCalledWith(TODAY);
    expect(target.querySelector(".ph-date-label").textContent).toBe("today");
  });

  it("says `trail` on an untrailed page, and opens the trails behind it", async () => {
    api.getLineages.mockResolvedValue([
      { id: "L1", name: "the book", mode: "discrete", parent_id: null },
      { id: "L2", name: "job search", mode: "discrete", parent_id: null },
    ]);
    const { target } = render(ShellApp);
    await settle();
    // The untrailed tag is its own class, not an empty .ph-trail: nothing
    // in the tree should have to read a label's TEXT to learn whether the
    // page is on a trail.
    expect(target.querySelector(".ph-trail")).toBeNull();
    expect(target.querySelector(".ph-trail-empty").textContent.trim()).toBe("trail");

    await openFromHeader(target, ".ph-trail-button");
    flushSync();

    // Name order, not the backend's. get_lineages sorts by most recent
    // activity, so the list a writer chooses from used to reshuffle between
    // openings for a reason they could not see; the sheet now reads
    // orderedTrails, which the scope sheet has always read.
    expect(sheetRows(target, "trail")).toEqual(["job search", "the book"]);
    // No "no trail" row: the page is already on none, and a row that names
    // the state you are in cannot act.
    expect(sheetRow(target, "trail", "no trail")).toBeUndefined();
  });

  it("puts the page on the trail that was picked", async () => {
    api.getLineages.mockResolvedValue([
      { id: "L1", name: "the book", mode: "discrete", parent_id: null },
    ]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-trail-button");
    flushSync();
    await clickSheetRow(target, "trail", "the book");

    expect(api.setFocusLineage).toHaveBeenCalledWith("p1", "L1");
    expect(target.querySelector(".ph-trail").textContent.trim()).toBe("the book");
  });

  it("brings the pins kept on the trail onto the page, and says so", async () => {
    // CLAUDE.md's context clause, and the mechanic behind it: first
    // assignment injects every auto_insert pin on the trail and its
    // ancestors. The sentence is not decoration — blocks appearing in a
    // document nobody typed them into read as a bug, and the writer's
    // first instinct is to undo them.
    api.getLineages.mockResolvedValue([
      { id: "L1", name: "the book", mode: "discrete", parent_id: null },
    ]);
    api.getCarryForwardPins.mockResolvedValue([
      { id: "pin-a", object_type: "note", title: null, content: "the ending is the middle" },
    ]);
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp);
    await settleWithEditor();

    await openFromHeader(target, ".ph-trail-button");
    flushSync();
    await clickSheetRow(target, "trail", "the book");
    await settle();
    flushSync();

    expect(api.getCarryForwardPins).toHaveBeenCalledWith("L1");
    expect(editorOf(target).getText()).toContain("the ending is the middle");
    expect(toastOf(target)).toBe("the pins you kept on the book trail, on the page");
  });

  it("does not bring them again when the page moves between trails", async () => {
    // Not an empty-result assertion for its own sake. CLAUDE.md is exact:
    // the injection fires ONCE, on first assignment, and re-trailing a
    // page between trails does not re-inject. A second sweep would append
    // the second trail's pins under writing the first trail's pins had
    // already been part of, on a page the writer has been working on.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getLineages.mockResolvedValue([
      { id: "L1", name: "the book", mode: "discrete", parent_id: null },
      { id: "L2", name: "job search", mode: "discrete", parent_id: null },
    ]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-trail-button");
    flushSync();
    await clickSheetRow(target, "trail", "job search");

    expect(api.setFocusLineage).toHaveBeenCalledWith("p1", "L2");
    expect(api.getCarryForwardPins).not.toHaveBeenCalled();
  });

  it("takes the page off its trail", async () => {
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getLineages.mockResolvedValue([
      { id: "L1", name: "the book", mode: "discrete", parent_id: null },
    ]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-trail-button");
    flushSync();
    await clickSheetRow(target, "trail", "no trail");

    expect(api.setFocusLineage).toHaveBeenCalledWith("p1", null);
    expect(target.querySelector(".ph-trail")).toBeNull();
  });

  it("names a new trail and puts the page on it in one gesture", async () => {
    // Discrete and top-level BY DEFAULT: return, or the create row, starts
    // a trail at the top. Mode still lives where trails are managed; the
    // parent became a choice on 2026-10-04, in the row below this one, and
    // the test for it follows. What must not change is this path staying
    // one gesture for the common case.
    const created = { id: "L9", name: "job search", mode: "discrete", parent_id: null };
    api.createLineage.mockResolvedValue(created);
    // The sheet's own read comes first and must NOT already hold the name,
    // or trail-sheet-model would (correctly) withhold the create row. Every
    // read after it does: adoptPage re-reads the lineages to learn the new
    // trail's name and mode.
    api.getLineages.mockResolvedValueOnce([]).mockResolvedValue([created]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-trail-button");
    flushSync();
    const field = target.querySelector('[data-sheet="trail"] .shell-field-input');
    expect(field).not.toBeNull();
    field.value = "job search";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    await clickSheetRow(target, "trail", "start the trail “job search”");

    expect(api.createLineage).toHaveBeenCalledWith("job search", "discrete", null);
    expect(api.setFocusLineage).toHaveBeenCalledWith("p1", "L9");
    expect(target.querySelector(".ph-trail").textContent.trim()).toBe("job search");
  });

  it("starts a trail inside another, which is the only way to nest one here", async () => {
    // The device pass on 2026-10-04: "we could not create subtrail in
    // phone". createTrail passed a null parent and nothing else on the
    // phone nests a trail, so a writer who wanted chapters under a book had
    // to go to the desktop. This is the whole path, end to end, because the
    // model's rows passing a parentId proves nothing on its own — what
    // matters is that the id reaches createLineage.
    const parent = { id: "L1", name: "the book", mode: "discrete", parent_id: null };
    const child = { id: "L9", name: "chapter two", mode: "discrete", parent_id: "L1" };
    api.createLineage.mockResolvedValue(child);
    api.getLineages.mockResolvedValueOnce([parent]).mockResolvedValue([parent, child]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-trail-button");
    flushSync();
    const field = target.querySelector('[data-sheet="trail"] .shell-field-input');
    field.value = "chapter two";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    // Two steps, as on the desktop: say it goes inside something, then say
    // what. The sheet stays open between them — closing it would lose the
    // name being placed.
    await clickSheetRow(target, "trail", "start it inside a trail…");
    flushSync();
    expect(target.querySelector('[data-sheet="trail"]')).not.toBeNull();

    await clickSheetRow(target, "trail", "the book");

    expect(api.createLineage).toHaveBeenCalledWith("chapter two", "discrete", "L1");
    expect(api.setFocusLineage).toHaveBeenCalledWith("p1", "L9");
  });

  it("offers the top level as the way back out of nesting", async () => {
    // A writer who taps "inside a trail" by accident is one row from what
    // they meant, and that row is the one they were already reaching for.
    const parent = { id: "L1", name: "the book", mode: "discrete", parent_id: null };
    const made = { id: "L9", name: "chapter two", mode: "discrete", parent_id: null };
    api.createLineage.mockResolvedValue(made);
    api.getLineages.mockResolvedValueOnce([parent]).mockResolvedValue([parent, made]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-trail-button");
    flushSync();
    const field = target.querySelector('[data-sheet="trail"] .shell-field-input');
    field.value = "chapter two";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    await clickSheetRow(target, "trail", "start it inside a trail…");
    flushSync();
    await clickSheetRow(target, "trail", "start “chapter two” at the top level");

    expect(api.createLineage).toHaveBeenCalledWith("chapter two", "discrete", null);
  });

  it("starts the trail on the FIRST tap, with the keyboard still up", async () => {
    // The fifth device pass: "on trail popup create trail the first click
    // does nothing, the keyboard disappears, the second one works". The
    // row is a button, so the tap moved focus off the field; the IME went
    // down, the sheet re-laid out around the freed space, and the click
    // landed where the row had been. Row's `keepFocus` (the insert
    // sheet's fix, same mechanism) keeps the focus and the keyboard, so
    // nothing moves between the press and the click.
    const created = { id: "L9", name: "job search", mode: "discrete", parent_id: null };
    api.createLineage.mockResolvedValue(created);
    api.getLineages.mockResolvedValueOnce([]).mockResolvedValue([created]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-trail-button");
    flushSync();
    const field = target.querySelector('[data-sheet="trail"] .shell-field-input');
    field.focus();
    field.value = "job search";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    const create = [...target.querySelectorAll('[data-sheet="trail"] .shell-row')]
      .find((r) => r.textContent.includes("start the trail"));
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    create.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field);

    create.click();
    await settle();

    expect(api.createLineage).toHaveBeenCalledTimes(1);
    expect(api.setFocusLineage).toHaveBeenCalledWith("p1", "L9");
  });

  it("starts a living doc from the sheet, and points the empty page at it", async () => {
    // The phone could not make a continuous trail at all: the sheet
    // created "the PLAIN kind only: discrete, top-level"
    // (trail-sheet-model.js). The canon calls a continuous trail the one
    // deliberate exception, and it was the one thing the phone could not
    // reach — my own device scenario had to stand one up through the
    // backend because "a scenario about the living doc has no way in
    // through the screen".
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    api.createLineage.mockResolvedValue({ id: "L9", name: "the book", mode: "continuous" });
    const { target } = render(ShellApp, {});
    await settle();

    await openFromHeader(target, ".ph-trail-button");
    flushSync();
    const field = target.querySelector('[data-sheet="trail"] .shell-field-input');
    field.focus();
    field.value = "the book";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    const row = [...target.querySelectorAll('[data-sheet="trail"] .shell-row')]
      .find((r) => r.textContent.includes("as a living doc"));
    expect(row, "no living-doc row in the trail sheet").toBeTruthy();
    row.click();
    await settle();

    // The MODE is the assertion. Creating it discrete and calling it a
    // living doc would pass every other check in this test.
    expect(api.createLineage).toHaveBeenCalledWith("the book", "continuous", null);
    expect(api.setFocusLineage).toHaveBeenCalledWith("p1", "L9");
  });

  it("opens a living doc instead of pointing this page at it", async () => {
    // The other half, and the one that keeps the refusal intact. Moving a
    // page onto a trail that already owns a document is the destructive
    // route — the desktop MERGES, which deletes the source row. Pressing
    // that trail here NAVIGATES instead: the canonical is loaded and
    // nothing is written. Asserted as a negative on purpose, because the
    // failure mode is silent and permanent.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    api.getLineages.mockResolvedValue([
      { id: "C1", name: "the book", mode: "continuous", parent_id: null },
    ]);
    api.getCanonicalTrailPage.mockResolvedValue({ id: "canon-1" });
    api.getPage.mockResolvedValue(withLines(pageRow({ id: "canon-1", lineage_id: "C1" })));
    const { target } = render(ShellApp, {});
    await settle();

    await openFromHeader(target, ".ph-trail-button");
    await settle();

    const row = [...target.querySelectorAll('[data-sheet="trail"] .shell-row')]
      .find((r) => r.querySelector(".shell-row-label")?.textContent.trim() === "the book");
    expect(row, "no trail row for the living doc").toBeTruthy();
    row.click();
    await settle();

    // It went somewhere: the canonical was fetched and adopted.
    expect(api.getPage).toHaveBeenCalled();
    // And it wrote NOTHING. This is the refusal the sheet's header argues,
    // held as a negative because the failure is silent: repointing the
    // page would move it onto the trail and, for a trail that owns a
    // document, that is the route that deletes a row.
    expect(api.setFocusLineage).not.toHaveBeenCalled();
  });

  it("finds a trail as the name is typed, with each trail's pages and pins", async () => {
    // 0.8.2 (spec §4): the field was a name only. Typing now narrows the
    // trails (keeping a match's parent) and still offers to start one.
    api.getLineages.mockResolvedValue([
      { id: "S", name: "shizumu", mode: "discrete", parent_id: null },
      { id: "R", name: "the relay", mode: "discrete", parent_id: "S" },
      { id: "J", name: "job search", mode: "discrete", parent_id: null },
    ]);
    api.getTrailPageCounts.mockResolvedValue([["R", 3]]);
    api.getTrailPinCounts.mockResolvedValue([["R", 2]]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-trail-button");
    await settle();
    const field = target.querySelector('[data-sheet="trail"] .shell-field-input');
    expect(field.placeholder).toBe("find a trail…");
    field.value = "relay";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    const rows = [...target.querySelectorAll('[data-sheet="trail"] .shell-row')];
    const labels = rows.map((r) => r.querySelector(".shell-row-label").textContent.trim());
    // The empty page also offers the living doc; what matters here is the
    // tail — the match and the parent that leads to it, and nothing else.
    expect(labels.slice(-2)).toEqual(["shizumu", "the relay"]);
    expect(labels).not.toContain("job search");
    expect(labels[0]).toBe("start the trail “relay”");
    const relay = rows.find((r) => r.querySelector(".shell-row-label").textContent.trim() === "the relay");
    expect(relay.querySelector(".shell-row-value").textContent.trim()).toBe("3 pages · 2 pins");
    expect(relay.querySelector(".shell-row-detail").textContent.trim()).toBe("shizumu");
  });

  it("starts the typed trail on return, which is what the keyboard's Go offers", async () => {
    // The third device pass: the writer typed a name, pressed Go, and
    // nothing happened. Return now runs trailSheetSubmit's row.
    const created = { id: "L9", name: "job search", mode: "discrete", parent_id: null };
    api.createLineage.mockResolvedValue(created);
    api.getLineages.mockResolvedValueOnce([]).mockResolvedValue([created]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-trail-button");
    flushSync();
    // With nothing typed, a line says what to do; the row that does it
    // is not there yet.
    expect(target.querySelector('[data-sheet="trail"] .shell-note').textContent.trim())
      .toBe("type to find a trail, or a new name and return to start one.");
    const field = target.querySelector('[data-sheet="trail"] .shell-field-input');
    field.value = "job search";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(target.querySelector('[data-sheet="trail"] .shell-note')).toBeNull();
    const create = [...target.querySelectorAll('[data-sheet="trail"] .shell-row')]
      .find((r) => r.textContent.includes("start the trail"));
    expect(create.dataset.kind).toBe("action");

    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();

    expect(api.createLineage).toHaveBeenCalledWith("job search", "discrete", null);
    expect(api.setFocusLineage).toHaveBeenCalledWith("p1", "L9");
    expect(target.querySelector('[data-sheet="trail"]')).toBeNull();
  });

  it("lists a continuous trail and refuses to make it a choice", async () => {
    // Every way of pointing this page at a living document is destructive
    // or a navigation: the desktop merges the page in and deletes the
    // source row, or navigates. A row in a bottom sheet is not how a
    // writer commits to the trail exception.
    api.getLineages.mockResolvedValue([
      { id: "L1", name: "the book", mode: "continuous", parent_id: null },
    ]);
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-trail-button");
    flushSync();

    const row = sheetRow(target, "trail", "the book");
    expect(row.tagName).toBe("DIV");
    expect(row.textContent).toContain("living doc");
  });

  it("offers no trail control on a continuous trail's own page", async () => {
    // Unlinking or moving a canonical orphans the trail's whole living
    // document, which is why the desktop refuses every branch there. An
    // affordance that opens onto nothing is worse than the label it
    // replaced, so the tag stays a label.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getLineages.mockResolvedValue([
      { id: "L1", name: "the book", mode: "continuous", parent_id: null },
    ]);
    // The clock is held rather than raced, for this file's documented
    // reason: a continuous page schedules focus("end") 50ms after its
    // editor mounts, and that timer cannot run under jsdom.
    vi.useFakeTimers();
    const { target } = render(ShellApp);
    await settleContinuous();

    expect(target.querySelector(".ph-trail-button")).toBeNull();
    expect(target.querySelector(".ph-trail").textContent.trim()).toBe("the book");
  });

  it("offers no trail control on a page the writer cannot type into", async () => {
    // Assigning a trail to a read-only page would inject carry-forward
    // pins into a document the canvas is refusing edits to.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ is_open: false })));
    const { target } = render(ShellApp);
    await settle();

    expect(target.querySelector(".ph-trail-button")).toBeNull();
  });

  it("swaps sheets when the gutter handle is tapped while a header sheet is open", async () => {
    // The replace-if-open path, reached across the two families of sheet —
    // and the DIRECTION is the whole of it, which a probe had to establish
    // rather than a reading. Svelte runs the claim effects in DECLARATION
    // order, and the block sheets are declared before the header's. So
    // opening a header sheet over a block sheet releases the block sheet
    // FIRST and nextSheet sees `current: null`: no dismissal, no guard
    // needed, and a test written that way round stays green with the guard
    // torn out. This way round the incoming block-actions instance asks
    // while the date sheet still holds the module claim, so the date
    // sheet's onDismiss lands AFTER block-actions has taken the slot — and
    // without the tag guard in `dismissedSheet` it closes the sheet that
    // just opened, so the tap reads as "everything closed".
    //
    // Both taps are real: the header lives in the nav band and the gutter
    // handle in the canvas, and a half-detent sheet covers neither.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    await openFromHeader(target, ".ph-date");
    flushSync();
    expect(target.querySelector('[data-sheet="date"]')).not.toBeNull();

    tap(target, "block-handle");
    flushSync();

    expect(target.querySelector('[data-sheet="block-actions"]')).not.toBeNull();
    expect(target.querySelector('[data-sheet="date"]')).toBeNull();
  });

  it("keeps the sheet usable when the history read fails", async () => {
    // The two rows a writer on a past page actually needs — today, and the
    // day they are on — are synthesised from the loaded page, not fetched.
    // A failed history read must not cost the way back to now.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ date: LONG_AGO })));
    api.getThread.mockRejectedValue(new Error("no such table"));
    const { target } = render(ShellApp);
    await settle();

    await openFromHeader(target, ".ph-date");
    flushSync();

    expect(sheetRows(target, "date")).toEqual(["today", "2 jan"]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  function toastOf(target) {
    const el = target.querySelector(".shell-toast");
    return el ? el.textContent.trim() : null;
  }
});

// ── P3 Task 1: the shell pushes a screen ────────────────────────────────
//
// Four pieces that had been built, reviewed, tested and never run in the
// app get their first caller here at once: Stack (rendered by nothing),
// `pushedScreen` (hardcoded false), `data-shell-region` (read by ShellRoot,
// written nowhere) and `onGesture` (never passed, so the root's router
// returned on the first line of every pointerdown).
//
// THE CAPTURE IS SIMULATED IN THIS FILE, and without that half none of the
// survival tests below prove anything. jsdom implements no pointer capture
// whatsoever — Sheet, Stack and ShellRoot all optional-chain the call — so
// an ordinary dispatch behaves as if nothing ever captured, and a test
// written that way is green with the frame capturing and green with it
// not. `capturing()` models the one property that matters: after
// setPointerCapture, every further event for that pointer is dispatched AT
// the capturing element rather than at whatever is under the finger.
describe("ShellApp — the stack, and the router that feeds it", () => {
  let historyStates;
  let navTeardown;

  beforeEach(async () => {
    // One macrotask first, for the reason the header-sheets block above
    // gives: a describe that ends with a surface open rewinds the REAL
    // history in its teardown, and jsdom delivers that popstate late.
    await new Promise((r) => setTimeout(r, 0));
    _resetForTests();
    historyStates = [];
    vi.spyOn(window.history, "pushState").mockImplementation((state) => {
      historyStates.push(state);
    });
    vi.spyOn(window.history, "back").mockImplementation(() => {
      historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    vi.spyOn(window.history, "go").mockImplementation((n) => {
      for (let i = 0; i < -n; i++) historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    navTeardown = initNavStack();
  });

  afterEach(() => {
    cleanupAll();
    navTeardown();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // A real pointer event with a real timestamp — ShellRoot.test.js's
  // helper, for its reason: jsdom stamps an event at construction, so a
  // stroke built in one synchronous statement lands on a single
  // millisecond and every velocity the recogniser reports comes out 0.
  function pointer(type, { x, y, t, id = 1 }) {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: id,
    });
    Object.defineProperty(event, "timeStamp", { value: t, configurable: true });
    return event;
  }

  /** Pointer capture, as a browser does it and jsdom does not. */
  function capturing() {
    const had = Object.getOwnPropertyDescriptor(Element.prototype, "setPointerCapture");
    const hadRelease = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "releasePointerCapture",
    );
    const held = new Map();
    Element.prototype.setPointerCapture = function (id) {
      held.set(id, this);
    };
    Element.prototype.releasePointerCapture = function (id) {
      held.delete(id);
    };
    return {
      /** Where the browser would deliver this event, given what is held. */
      at: (fallback, id) => held.get(id) ?? fallback,
      restore() {
        if (had) Object.defineProperty(Element.prototype, "setPointerCapture", had);
        else delete Element.prototype.setPointerCapture;
        if (hadRelease) {
          Object.defineProperty(Element.prototype, "releasePointerCapture", hadRelease);
        } else delete Element.prototype.releasePointerCapture;
      },
    };
  }

  /** A whole stroke, dispatched the way a browser would with capture live:
   *  the pointerdown lands on `from`, and everything after it lands
   *  wherever the capture (if any) has since been claimed. */
  function stroke(from, pts) {
    const capture = capturing();
    try {
      from.dispatchEvent(pointer("pointerdown", pts[0]));
      for (const p of pts.slice(1, -1)) {
        capture.at(from, p.id ?? 1).dispatchEvent(pointer("pointermove", p));
      }
      const last = pts[pts.length - 1];
      capture.at(from, last.id ?? 1).dispatchEvent(pointer("pointerup", last));
    } finally {
      capture.restore();
    }
    flushSync();
  }

  const stackEl = (target) => target.querySelector(".shell-stack");
  const depth = (target) => Number(stackEl(target).dataset.depth);
  const canvas = (target) => target.querySelector('[data-shell-region="canvas"]');

  /** Stack measures the screen once, at pointerdown, and stack-back.js
   *  answers "cancel" on a zero width by design — every element in jsdom
   *  reports clientWidth 0, so a drag test that skips this passes for the
   *  wrong reason and keeps passing when the gesture is entirely broken.
   *  Stack.test.js sets it in exactly one place for the same reason. */
  function widthOf(target, width = 400) {
    Object.defineProperty(stackEl(target), "clientWidth", { value: width, configurable: true });
  }

  async function pushPins(target) {
    target.querySelector(".ph-pins").click();
    flushSync();
    await settle();
  }

  it("pushes the pins screen from the page nav bar", async () => {
    // `onPins` was declared in PageScreen, forwarded to PageHeader and
    // reaching nothing since P2a — P2f left it that way deliberately,
    // because §2 makes pins a pushed screen and building it as a sheet
    // would have built the wrong surface. This is its producer.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    api.getPins.mockResolvedValue([]);
    const { target } = render(ShellApp, {});
    await settle();
    expect(depth(target)).toBe(1);

    await pushPins(target);

    expect(depth(target)).toBe(2);
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("pins");
  });

  it("lists the pins it read on the push", async () => {
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([
      { id: "pin-a", object_type: "note", title: "the second reader" },
      { id: "pin-b", object_type: "note", title: "what the trail is for" },
    ]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    // The fetch is the PUSH's, not a screen effect's — which is what keeps
    // this list off the one-behind cache P2f Task 2 found in EditorCore's
    // own getPins call. The lineage it asks for is the page's.
    expect(api.getPins).toHaveBeenCalledWith("L1");
    // Scoped to the TOP entry, because the page root is still mounted
    // underneath it — Stack keeps the top two alive so a back drag reveals
    // a real screen rather than a hole, and any `.shell-row` the page root
    // carries is one too. An unscoped query reads the two screens as one
    // list, which is how this assertion was first written.
    expect(
      [...target.querySelectorAll('.shell-stack-entry[data-top="true"] .shell-row-label')].map(
        (n) => n.textContent.trim(),
      ),
    ).toEqual(["the second reader", "what the trail is for"]);
  });

  it("says the pins are being read before it says there are none", async () => {
    // Two empty states, and the distinction is the whole reason there are
    // two: "nothing kept here" and "not read yet" are different facts, and
    // showing the first while the fetch is in flight tells a writer with
    // fifty pins that they have none. The push renders before the await
    // resolves, which is exactly the window this covers.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    api.getPins.mockReturnValue(new Promise(() => {}));
    const { target } = render(ShellApp, {});
    await settle();

    target.querySelector(".ph-pins").click();
    flushSync();

    expect(target.querySelector(".empty-title").textContent.trim()).toBe("reading the pins");
  });

  it("labels a pin with no title from its own text", async () => {
    // pinDisplayTitle already falls back to the content's first line, so
    // the row must not render blank for the pins that carry no title —
    // which is most of them, since a block pin is titled by the writer
    // only when they choose to.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    api.getPins.mockResolvedValue([
      {
        id: "pin-c",
        object_type: "note",
        title: null,
        content: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "the page is where" }] }],
        }),
      },
    ]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    expect(
      target.querySelector('.shell-stack-entry[data-top="true"] .shell-row-label').textContent.trim(),
    ).toBe("the page is where");
  });

  it("empties the slot behind a pushed screen", async () => {
    // toolbarFor's row 1, whose `pushedScreen` half has been hardcoded
    // false since P1a. §2's band diagram gives the bottom slot to nothing
    // on a pushed screen, so the frame must stop RESERVING it rather than
    // reserve an empty band — the defect ShellRoot's header names.
    // Forcing the input back to false is what reddens this one.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    api.getPins.mockResolvedValue([]);
    const { target } = render(ShellApp, {});
    await settle();
    expect(target.querySelector(".shell-slot")).not.toBeNull();

    await pushPins(target);

    expect(target.querySelector(".shell-slot")).toBeNull();
  });

  // ── Step 5: back, three doors, one act ────────────────────────────────

  it("pops one screen on the nav bar's back", async () => {
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    api.getPins.mockResolvedValue([]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    target.querySelector(".shell-navbar-back").click();
    flushSync();

    expect(depth(target)).toBe(1);
  });

  it("pops one screen on platform back", async () => {
    // Android system back and the browser's own button both arrive as a
    // popstate; navstack turns it into the close of its top entry, which
    // is the entry Stack registered for this screen.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    api.getPins.mockResolvedValue([]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    window.history.back();
    flushSync();

    expect(depth(target)).toBe(1);
  });

  it("pops one screen on Esc", async () => {
    // Two headers in this tree promised this and nothing delivered it:
    // Sheet's ("Android system back, Esc and navBack() all reach it") and
    // Stack's ("Esc on web routes through navBack() regardless"). Before
    // P3 Task 1 the only navBack() caller in src/ was App.svelte's swipe
    // intent, so Esc reached the navstack from nowhere at all.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    api.getPins.mockResolvedValue([]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    flushSync();

    expect(depth(target)).toBe(1);
  });

  it("leaves Esc alone when the shell has nothing open", async () => {
    // Not a vacuous negative. navBack() is history.back(), and on an empty
    // navstack that leaves the app — §1 is explicit that at the page root
    // with nothing open Android backgrounds and web does nothing, neither
    // of which is the shell's to perform. The assertion is on history
    // rather than on the DOM because "nothing moved on screen" is exactly
    // what a navigation away from the app looks like from in here.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    const { target } = render(ShellApp, {});
    await settle();
    expect(depth(target)).toBe(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    flushSync();

    expect(window.history.back).not.toHaveBeenCalled();
    expect(depth(target)).toBe(1);
  });

  it("pops the pushed screen on an edge flick over the marked canvas", async () => {
    // Stack's own gesture, run in the app for the first time, and the
    // stroke deliberately starts on the page's MARKED canvas underneath —
    // the combination ShellRoot.test.js could only build from a synthetic
    // child, because nothing in src/ set data-shell-region until now. The
    // canvas row terminates rather than falling through, so a table that
    // ordered the region above the geometry would answer "element" here
    // and the flick would do nothing.
    //
    // WHAT THIS DOES NOT PROVE, said rather than implied: gestureOwner
    // reports "back" for this same stroke and ShellApp performs nothing
    // on it, because Stack has already performed it — and adding
    // `if (g.owner === "back") popScreen()` to the router reddens
    // nothing here. It cannot: popScreen is `pushed.slice(0, -1)`, the
    // shell can only ever push one screen, and a second pop of an empty
    // array removes nothing. The abstention is right anyway (one owner
    // per stroke, and the router is terminal), but it is a decision this
    // suite is not holding in place, and the day a second push exists it
    // will need a test of its own.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    api.getPins.mockResolvedValue([]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    widthOf(target);

    stroke(canvas(target), [
      { x: 4, y: 300, t: 0 },
      { x: 160, y: 304, t: 40 },
      { x: 320, y: 308, t: 80 },
    ]);

    expect(depth(target)).toBe(1);
    // The page root is what is revealed, not an empty frame.
    expect(target.querySelector(".ph-pins")).not.toBeNull();
  });

  /** Make this environment look like the Tauri Android app to the platform
   *  seam: a Tauri window and the WebView's own user agent, which are the
   *  two facts `currentPlatformProfile` reads. Restored by the caller — a
   *  leaked Android window would disarm the edge for every later test in
   *  this file, and the control above would then pass for the wrong reason.
   *
   *  The user-agent string is Tauri's Android WebView verbatim: `wv` marks
   *  it as an embedded WebView rather than Chrome, and `Android` is the
   *  token `osFromUserAgent` keys off. */
  function asAndroidApp() {
    window.__TAURI_INTERNALS__ = {};
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/121.0.6167.101 " +
        "Mobile Safari/537.36",
      configurable: true,
    });
    return () => {
      delete window.__TAURI_INTERNALS__;
      // Deleting the own property uncovers jsdom's prototype accessor
      // again, which is the real restore; assigning the old string back
      // would leave a shadowing own property behind.
      delete navigator.userAgent;
    };
  }

  it("leaves the same edge flick to the system inside the Android app", async () => {
    // THE REGRESSION THE PLATFORM SEAM EXISTS FOR, Stack's half of it. The
    // stroke is byte-identical to the test above, which pops; the only
    // difference is the platform underneath, and the outcome is the
    // opposite one. Android gesture navigation owns BOTH screen edges, so a
    // shell-drawn edge back competes with the system's — the gesture that
    // swung between firing on every scroll and never firing at all across
    // the v0.6.x releases (§1, "Removed"). ANDROID's profile has said
    // `edgeBackArmed: false` since P1 and nothing read it until now.
    //
    // "Nothing happens" here is not nothing: the SYSTEM back still fires
    // and still pops this screen. What must not happen is the shell ALSO
    // performing one, which is what leaves two owners on one stroke.
    //
    // Not a vacuous negative, and the test above is what makes it so: the
    // same stroke on the same fixture DOES pop on the web profile. Unwire
    // `edgeBackArmed` from `<Stack>` in ShellApp and this goes red while
    // that one stays green — proven by doing it. ShellRoot's half is held
    // separately in ShellApp.platform.test.js, because the two default the
    // flag independently and either one left armed re-draws the shell's own
    // back.
    const restore = asAndroidApp();
    try {
      api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
      api.getPins.mockResolvedValue([]);
      const { target } = render(ShellApp, {});
      await settle();
      await pushPins(target);
      widthOf(target);

      stroke(canvas(target), [
        { x: 4, y: 300, t: 0 },
        { x: 160, y: 304, t: 40 },
        { x: 320, y: 308, t: 80 },
      ]);

      expect(depth(target)).toBe(2);
      expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("pins");
    } finally {
      restore();
    }
  });

  // ── Step 4: the table's rows, driven end to end ───────────────────────

  it("opens memory on a canvas swipe up at the scroll bottom", async () => {
    // gestureOwner's canvas row, from the app rather than from a fixture.
    // Three inputs have to agree and every one of them was a producerless
    // default until this task: the region (nothing wrote the attribute),
    // atScrollBottom (Screen computed it and PageScreen threw it away),
    // and keyboardOpen at the root (passed nowhere).
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    const { target } = render(ShellApp, {});
    await settle();

    stroke(canvas(target), [
      { x: 200, y: 500, t: 0 },
      { x: 203, y: 380, t: 60 },
      { x: 205, y: 260, t: 120 },
    ]);

    // The memory ROOT, named by its own nav bar rather than by the stub it
    // used to land on — P3 Task 3 built the screen behind this gesture.
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("memory");
    expect(target.querySelector(".ph-pins")).toBeNull();
  });

  it("keeps the writer on the page for the same swipe while a field has focus", async () => {
    // Not the same test with a flag flipped: this is gesture-arming.js's
    // incident folded into the table — a flick that lands on the editor
    // mid-keystroke (a fast return-key drag) must never read as a space
    // switch.
    //
    // NOT A keyboardOpen PROP, and the change is the point rather than a
    // test detail. The gate used to ask whether a keyboard was believed to
    // be up; on a Galaxy A34 that belief stuck true with no keyboard on
    // screen and this gesture — the only way off the page once the tab bar
    // had gone with it — degraded to a scroll for the whole session.
    //
    // `editing` is a focused text field. App.svelte derives it from the DOM
    // (focusin/focusout + isTextFieldElement) and hands it down, the same
    // way it hands down the keyboard flag, so the component under test is
    // given the answer rather than reading the document — which is also why
    // this passes the prop instead of focusing a field.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settle();

    stroke(canvas(target), [
      { x: 200, y: 500, t: 0 },
      { x: 203, y: 380, t: 60 },
      { x: 205, y: 260, t: 120 },
    ]);

    expect(target.querySelector(".shell-app-stub-text")).toBeNull();
    expect(target.querySelector(".ph-pins")).not.toBeNull();
  });

  it("switches page of the day on a horizontal pan across the dots", async () => {
    // gestureOwner's SECOND row, and the reason the dots are marked at
    // all. §1 gives the strip "horizontal pan or tap"; the tap has had a
    // producer since P2f (PageHeader's own onclick) and the PAN had none,
    // because nothing wrote the region the row keys off.
    //
    // Driven as a drag with no click after it, which is what separates
    // this from the tap path: if the attribute came off `.ph-dots` this
    // stroke would find no marked ancestor but the canvas, and the canvas
    // row answers "element" to anything horizontal.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    api.getFocusesForDate.mockResolvedValue([]);
    const { target } = render(ShellApp, { pageCount: 3, pageNumber: 1 });
    await settle();
    const dots = target.querySelector(".ph-dots");
    expect(dots.dataset.shellRegion).toBe("header-dots");

    stroke(dots, [
      { x: 300, y: 90, t: 0 },
      { x: 250, y: 92, t: 40 },
      { x: 200, y: 94, t: 80 },
    ]);
    await settle();

    expect(target.querySelector('[data-sheet="pages"]')).not.toBeNull();
  });

  it("gives a live block drag the canvas's own swipe", async () => {
    // THE TABLE'S FIRST ROW, end to end for the first time. P2e built its
    // producer (the gutter handle's hold) and said in as many words that
    // it could only be asserted at module and chain level, because nothing
    // consumed the router's answer. The bug the row exists for is the one
    // gesture-owner.js's header names in its own words: "the canvas swipe
    // that switched spaces mid-block-drag" — one motion losing both the
    // block and the screen.
    //
    // The stroke is byte-identical to the one two tests up, which comes
    // back "memory"; the only difference is the block in the air. So what
    // this asserts is the ROW and not the stroke.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, {});
    await settleWithEditor();

    vi.useFakeTimers();
    const handle = target.querySelector('[data-button-id="block-handle"]');
    expect(handle, "no gutter handle to lift from").toBeTruthy();
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }),
    );
    vi.advanceTimersByTime(350);
    flushSync();
    expect(target.querySelector(".shell-root").classList.contains("dragging")).toBe(true);

    stroke(canvas(target), [
      { x: 200, y: 500, t: 0, id: 2 },
      { x: 203, y: 380, t: 60, id: 2 },
      { x: 205, y: 260, t: 120, id: 2 },
    ]);

    expect(target.querySelector(".shell-app-stub-text")).toBeNull();
    expect(target.querySelector(".ph-pins")).not.toBeNull();
  });

  it("keeps a flick off the gutter handle out of the canvas's row", async () => {
    // What marking the handle as its own region buys, and it is a
    // withholding rather than an action. The column sits INSIDE the band
    // marked "canvas", so without the attribute this stroke — quicker than
    // the 350ms that arms the lift, so the first row does not cover it —
    // is a canvas swipe up at the scroll bottom and carries the writer out
    // of the document from the one control that exists to act on a block
    // in it. Same stroke as "opens memory on a canvas swipe up" above;
    // only the element it starts on differs.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, {});
    await settleWithEditor();
    const gutter = target.querySelector(".ps-gutter");
    expect(gutter, "no gutter column to flick from").toBeTruthy();
    expect(gutter.dataset.shellRegion).toBe("gutter-handle");

    stroke(gutter, [
      { x: 20, y: 500, t: 0 },
      { x: 23, y: 380, t: 60 },
      { x: 25, y: 260, t: 120 },
    ]);

    expect(target.querySelector(".shell-app-stub-text")).toBeNull();
  });

  // ── Step 3: what the router must not cost ─────────────────────────────

  it("still hands the editor the whole of a stroke that starts in it", async () => {
    // THE HAZARD THIS TASK WAS WRITTEN AROUND. ShellApp's own comment
    // recorded it: passing onGesture switches the root's router on for the
    // whole shell, and its down() then captured `.shell-root` on every
    // pointerdown anywhere in the app — retargeting dispatch, so every
    // descendant listening for the rest of its own stroke stops hearing
    // one. ProseMirror is the descendant with the most to lose.
    //
    // The answer was to take the capture out rather than accept it: the
    // frame is position:fixed;inset:0, so it already receives every event
    // by bubbling and capture bought it nothing.
    //
    // Reinstating `setPointerCapture` in ShellRoot.down() reddens this at
    // ["pointerdown"] — the move and the up are delivered to `.shell-root`
    // instead, which is an ancestor, and nothing travels back down.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, {});
    await settleWithEditor();
    const pm = target.querySelector(".ProseMirror");
    const seen = [];
    for (const type of ["pointerdown", "pointermove", "pointerup"]) {
      pm.addEventListener(type, (event) => seen.push(event.type));
    }

    stroke(pm, [
      { x: 120, y: 300, t: 0 },
      { x: 124, y: 302, t: 20 },
      { x: 126, y: 303, t: 40 },
    ]);

    expect(seen).toEqual(["pointerdown", "pointermove", "pointerup"]);
  });

  it("gives the gutter column its whole stroke even under a frame capture", async () => {
    // The second of the three things the router could have cost, and it
    // survives for a reason that is structural rather than lucky: the
    // stroke is followed on `window`, not on the column. PageScreen's own
    // header predicted this exact wire and chose window for it, because
    // events still PROPAGATE UP from a capture target even though they no
    // longer travel DOWN to a descendant.
    //
    // So the capture is claimed here deliberately — `.shell-root` takes
    // the pointer mid-stroke, which is precisely what the removed line
    // did — and the rest of the stroke is then dispatched where a browser
    // would put it. Without that the test proves nothing about capture at
    // all: with nobody capturing, the retarget is the identity and this
    // reduces to the lift test one describe up.
    //
    // What reddens it: moving pressUp's listener from `window` onto the
    // gutter column. The release then lands on `.shell-root`, which is
    // not an ancestor of the column, so it never arrives and the shell
    // stays in a drag with the finger already off the glass.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, {});
    await settleWithEditor();

    vi.useFakeTimers();
    const capture = capturing();
    try {
      const handle = target.querySelector('[data-button-id="block-handle"]');
      handle.dispatchEvent(pointer("pointerdown", { x: 20, y: 300, t: 0 }));
      vi.advanceTimersByTime(350);
      flushSync();
      expect(target.querySelector(".shell-root").classList.contains("dragging")).toBe(true);

      target.querySelector(".shell-root").setPointerCapture(1);
      expect(capture.at(handle, 1)).toBe(target.querySelector(".shell-root"));
      capture.at(handle, 1).dispatchEvent(pointer("pointermove", { x: 24, y: 220, t: 40 }));
      capture.at(handle, 1).dispatchEvent(pointer("pointerup", { x: 24, y: 220, t: 60 }));
      flushSync();
    } finally {
      capture.restore();
    }

    expect(target.querySelector(".shell-root").classList.contains("dragging")).toBe(false);
  });

  it("still lets a sheet dismiss on a drag of its handle", async () => {
    // The third thing the capture could have cost. It survives for a
    // second structural reason, and it is not the same one: the sheets
    // render as SIBLINGS of the frame, so a stroke on a sheet never
    // bubbles through `.shell-root` at all and the router never sees it.
    // That is also why gestureOwner's two sheet rows have no producer on
    // this route — recorded here rather than left as a gap someone later
    // reads as an oversight.
    api.getOrCreateToday.mockResolvedValue(textPage());
    const { target } = render(ShellApp, {});
    await settleWithEditor();
    tap(target, "block-handle");
    const sheet = target.querySelector('[data-sheet="block-actions"]');
    expect(sheet).not.toBeNull();
    // The structural fact, asserted rather than described: the sheet is
    // outside the frame. This is the whole of its immunity — nest the
    // sheets inside `.shell-root` and the frame's pointerdown handler
    // starts seeing sheet strokes, at which point any capture it ever
    // regrows takes them from the handle below.
    expect(target.querySelector(".shell-root").contains(sheet)).toBe(false);

    // A downward flick: sheetDetent steps exactly one detent on velocity,
    // and one step down from half is dismissed.
    stroke(target.querySelector(".shell-sheet-handle"), [
      { x: 200, y: 0, t: 0 },
      { x: 200, y: 100, t: 20 },
      { x: 200, y: 200, t: 40 },
    ]);

    expect(target.querySelector('[data-sheet="block-actions"]')).toBeNull();
  });
});

// ── P3 Task 2: the pins screen ────────────────────────────────────────
//
// The stack describe above proved the push, the list and the three ways
// back. This one is about what the screen DOES: the filter segment, the
// actions a row opens, and the editor sheet behind two of those rows.
//
// It carries the navstack/history setup that describe carries, for the
// same reason — a push registers a navstack entry and every Sheet pushes
// one of its own, so a test that dismisses a sheet with Esc needs a
// history the run owns rather than the real one.
describe("ShellApp — the pins screen", () => {
  let historyStates;
  let navTeardown;

  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 0));
    _resetForTests();
    historyStates = [];
    vi.spyOn(window.history, "pushState").mockImplementation((state) => {
      historyStates.push(state);
    });
    vi.spyOn(window.history, "back").mockImplementation(() => {
      historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    vi.spyOn(window.history, "go").mockImplementation((n) => {
      for (let i = 0; i < -n; i++) historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    navTeardown = initNavStack();
  });

  afterEach(() => {
    cleanupAll();
    navTeardown();
    // pinLedger replaces three implementations and vi.clearAllMocks() only
    // clears CALLS, so without this the next describe inherits a getPins
    // that remembers this one's pins.
    restorePinMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** A trailed page with one paragraph to pin, for the count-agreement
   *  test. `textPage()` is untrailed, and an untrailed page has no toast
   *  at all (pin-toast.js: "a heap, not a trail"). */
  function trailedTextPage() {
    return withLines(
      pageRow({
        lineage_id: "L1",
        content_json: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "kept going" }] }],
        }),
      }),
    );
  }

  async function pushPins(target) {
    target.querySelector(".ph-pins").click();
    flushSync();
    await settle();
  }

  /** Let the rAF that focusField defers into actually run. Two, because
   *  the effect that calls it schedules the first one. */
  async function frames() {
    for (let i = 0; i < 2; i++) {
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
    flushSync();
  }

  /** Scoped to the TOP stack entry: the page root is still mounted
   *  underneath, and its own rows are `.shell-row` too. */
  const top = (target) => target.querySelector('.shell-stack-entry[data-top="true"]');

  const pinRows = (target) =>
    [...top(target).querySelectorAll(".pins-row")].map((row) => ({
      label: row.querySelector(".shell-row-label").textContent.trim(),
      status: row.dataset.pinStatus,
    }));

  const segments = (target) =>
    [...top(target).querySelectorAll(".seg-btn")].map((b) => b.textContent.trim());

  const chosenSegment = (target) => top(target).querySelector(".seg-btn.active")?.textContent.trim();

  function pickSegment(target, label) {
    const button = [...top(target).querySelectorAll(".seg-btn")].find(
      (b) => b.textContent.trim() === label,
    );
    expect(button, `no "${label}" segment`).toBeTruthy();
    button.click();
    flushSync();
  }

  const sheetLabels = (target, tag) =>
    [...target.querySelectorAll(`[data-sheet="${tag}"] .shell-row-label`)].map((n) =>
      n.textContent.trim(),
    );

  function tapSheetRow(target, tag, label) {
    const row = [...target.querySelectorAll(`[data-sheet="${tag}"] .shell-row`)].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
    );
    expect(row, `no "${label}" row in the ${tag} sheet`).toBeTruthy();
    row.click();
    flushSync();
  }

  /** Open the actions sheet on a row, by its label. */
  function tapPinRow(target, label) {
    const row = [...top(target).querySelectorAll(".pins-row .shell-row")].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
    );
    expect(row, `no "${label}" pin row`).toBeTruthy();
    row.click();
    flushSync();
  }

  const note = (id, over = {}) => ({
    id,
    lineage_id: "L1",
    object_type: "note",
    title: id,
    content: `${id} text`,
    ...over,
  });

  // ── Step 1: search and the chip row (0.8.2, rulings 5 and 6) ──────────
  //
  // The segment over the sections is gone: the phone has the desktop
  // panel's search and chips (pin-filter.js over src/lib/pin-panel-filter.js),
  // and each row says what it does in words under the pin.

  const chipLabels = (target) =>
    [...top(target).querySelectorAll(".pins-chips:not(.pins-kinds) .pins-chip")].map((c) =>
      c.textContent.replace(/\s+/g, " ").trim(),
    );

  function pressChip(target, id) {
    const button = top(target).querySelector(`.pins-chip[data-chip="${id}"] button`);
    expect(button, `no "${id}" chip`).toBeTruthy();
    button.click();
    flushSync();
  }

  function searchPinsFor(target, text) {
    const field = top(target).querySelector(".pins-find .shell-field-input");
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
  }

  function pressRowAction(target, pinLabel, word) {
    const row = [...top(target).querySelectorAll(".pins-row")].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === pinLabel,
    );
    expect(row, `no "${pinLabel}" pin row`).toBeTruthy();
    const button = [...row.querySelectorAll(".pins-row-actions button")].find(
      (b) => b.textContent.trim() === word,
    );
    expect(button, `no "${word}" on the "${pinLabel}" row`).toBeTruthy();
    button.click();
    flushSync();
  }

  it("offers the desktop's chip row, each chip with its count", async () => {
    // THE BUG: the phone had one segment over the sections, and only when
    // the list held two of them — no search, no kind, no carries forward.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([note("a", { auto_insert: true }), note("b", { lineage_id: "PARENT" })]);
    api.getTrailPinCounts.mockResolvedValue([["L1", 1], ["PARENT", 1], [null, 2]]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    expect(chipLabels(target)).toEqual([
      "this trail 2",
      "all trails 4",
      "carries forward 1",
      "on this page 0",
      "kind",
    ]);
    expect(top(target).querySelector(".seg-btn")).toBeNull();
  });

  it("filters to what carries forward, and back", async () => {
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([note("a", { auto_insert: true }), note("b", { lineage_id: "PARENT" })]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    pressChip(target, "carries");
    expect(pinRows(target).map((r) => r.label)).toEqual(["a"]);
    pressChip(target, "carries");
    expect(pinRows(target).map((r) => r.label).sort()).toEqual(["a", "b"]);
  });

  it("searches the pins on this trail, and says nothing matches with a way back", async () => {
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([
      note("a", { content: "the relay holds blobs" }),
      note("b", { content: "chapter two" }),
    ]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    expect(top(target).querySelector(".pins-find .shell-field-input").placeholder).toBe(
      "search pins on this trail…",
    );
    searchPinsFor(target, "relay");
    expect(pinRows(target).map((r) => r.label)).toEqual(["a"]);

    searchPinsFor(target, "zebra");
    expect(top(target).querySelector(".empty-title").textContent.trim()).toBe("nothing matches");
    const clear = [...top(target).querySelectorAll(".empty-actions button")].find(
      (b) => b.textContent.trim() === "clear filters",
    );
    clear.click();
    flushSync();
    expect(pinRows(target)).toHaveLength(2);
  });

  it("sections the trail's own pins and its parents', and says where an inherited one came from", async () => {
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getLineages.mockResolvedValue([
      { id: "PARENT", name: "shizumu", parent_id: null, mode: "discrete" },
      { id: "L1", name: "v0.8", parent_id: "PARENT", mode: "discrete" },
    ]);
    api.getPins.mockResolvedValue([note("a"), note("b", { lineage_id: "PARENT" })]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    const eyebrows = [...top(target).querySelectorAll(".shell-eyebrow")].map((e) => e.textContent.trim());
    expect(eyebrows).toEqual(["on this trail · 1", "from parent trails · 1"]);
    const inherited = [...top(target).querySelectorAll(".pins-row")].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === "b",
    );
    expect(inherited.querySelector(".shell-row-detail").textContent.trim()).toBe("from shizumu (parent trail)");
  });

  it("reads every trail's pins the first time all trails is chosen, not before", async () => {
    // The fan-out is N+1 calls; the common push must not pay for it.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getLineages.mockResolvedValue([
      { id: "L1", name: "the book", parent_id: null, mode: "discrete" },
      { id: "L2", name: "the relay", parent_id: null, mode: "discrete" },
    ]);
    api.getPins.mockImplementation((id) =>
      Promise.resolve(
        id === "L1" ? [note("a")] : id === "L2" ? [note("x", { lineage_id: "L2" })] : [note("g", { lineage_id: null })],
      ),
    );
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    expect(api.getPins.mock.calls.map((c) => c[0])).not.toContain("L2");

    pressChip(target, "all");
    await settle();

    expect(api.getPins.mock.calls.map((c) => c[0])).toContain("L2");
    const eyebrows = [...top(target).querySelectorAll(".shell-eyebrow")].map((e) => e.textContent.trim());
    expect(eyebrows).toEqual(["the book · 1", "the relay · 1", "everywhere · 1"]);
  });

  it("tells an untrailed page to choose a trail, and the button opens the page's trail sheet", async () => {
    // THE BUG the desktop shipped: "nothing matches" with nothing searched.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: null })));
    api.getPins.mockResolvedValue([]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    expect(top(target).querySelector(".empty-title").textContent.trim()).toBe("this page has no trail yet.");
    const choose = [...top(target).querySelectorAll(".empty-actions button")].find(
      (b) => b.textContent.trim() === "choose a trail",
    );
    choose.click();
    flushSync();
    await settle();
    expect(target.querySelector('[data-sheet="trail"]')).not.toBeNull();
  });

  it("asks before it unpins from a row's more, keep first", async () => {
    // pin-row-actions.js: unpin sits behind more and asks first — on the
    // desktop it sat one slip from insert with no question asked.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([note("a"), note("b")]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    pressRowAction(target, "b", "more");
    expect(sheetLabels(target, "pin-more")).toContain("unpin…");
    tapSheetRow(target, "pin-more", "unpin…");
    expect(api.deletePin).not.toHaveBeenCalled();
    expect(target.querySelector('[data-sheet="pin-more"] .shell-note').textContent.trim()).toBe(
      "unpin b? the writing stays on its page.",
    );
    expect(sheetLabels(target, "pin-more")).toEqual(["keep", "unpin"]);

    tapSheetRow(target, "pin-more", "unpin");
    await settle();
    expect(api.deletePin).toHaveBeenCalledWith("b");
    expect(pinRows(target).map((r) => r.label)).toEqual(["a"]);
  });

  it("says open and put on page in words on every row", async () => {
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([note("a")]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    const words = [...top(target).querySelectorAll(".pins-row-actions button")].map((b) => b.textContent.trim());
    expect(words).toEqual(["open", "put on page", "more"]);
    const named = [...top(target).querySelectorAll(".pins-row-actions button")].map((b) => b.getAttribute("aria-label"));
    expect(named).toEqual(["open a", "put a on this page", "more for a"]);

    const before = depth(target);
    pressRowAction(target, "a", "open");
    await settle();
    // The pin's own screen, pushed over the list — the row's title does
    // the same, as it always has.
    expect(depth(target)).toBe(before + 1);
  });

  it("shows the trail exactly as many rows as the toast just counted", async () => {
    // THE AGREEMENT pin-toast.js's header commits to from the other end:
    // the breadcrumb is "a POINTER at a list, and the list it points at
    // shows the same rows… A count that disagreed with the list it names
    // would be worse than no count." The toast's number is
    // getPins(lineageId).length unfiltered — ancestors, closed rows and
    // orphans included — so the screen's resting list has to be the same
    // fetch, unfiltered, or the two surfaces contradict each other about
    // the writer's own trail.
    //
    // Driven through a real pin rather than two mocked numbers: the toast
    // is rendered by the app and the rows are rendered by the app, and
    // what is asserted is that "joins N pins" and the row count describe
    // one list. Filtering ANY status out of the screen's default reddens
    // it — the seeded orphan is what makes that true rather than
    // incidental.
    api.getOrCreateToday.mockResolvedValue(trailedTextPage());
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", mode: "discrete" }]);
    const rows = pinLedger();
    rows.push(note("kept earlier"), note("orphaned earlier", { status: "orphaned" }));
    const { target } = render(ShellApp, { editing: true, keyboardOpen: true });
    await settleWithEditor();

    tap(target, "pin");
    await settlePin();
    expect(target.querySelector(".shell-toast").textContent.trim()).toBe(
      "joins 2 pins on the book trail",
    );

    await pushPins(target);

    // Two others plus the pin just written: three rows, and the toast said
    // two others.
    expect(pinRows(target)).toHaveLength(3);
  });

  // ── Step 2: a row opens the pin ───────────────────────────────────────
  //
  // §2's actions sheet and editor sheet are gone (ShellApp's "a pin's
  // screen" section): a row pushes PinArtifactScreen, the actions are
  // rows under the writing, the writing is edited in place and written
  // when the screen is LEFT. The tests below reach every one of those
  // from the surface a finger reaches — the pins screen, the row, the
  // screen — because the tester's two reports ("how to see the content",
  // "pins are not editable") were both about that path and nothing under
  // it.

  const depth = (target) => Number(target.querySelector(".shell-stack").dataset.depth);

  /** Tap a row on the TOP stack entry, by its label. */
  function tapTopRow(target, label) {
    const row = [...top(target).querySelectorAll(".shell-row")].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
    );
    expect(row, `no "${label}" row on the top screen`).toBeTruthy();
    row.click();
    flushSync();
  }

  const topRows = (target) =>
    [...top(target).querySelectorAll(".shell-row-label")].map((n) => n.textContent.trim());

  /** Leave the top screen by the bar's own back. */
  function tapBack(target) {
    top(target).querySelector(".shell-navbar-back").click();
    flushSync();
  }

  const titleField = (target) => top(target).querySelector('input[aria-label="pin title"]');
  const textField = (target) => top(target).querySelector('textarea[aria-label="pin text"]');

  function type(field, value) {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
  }

  const board = (id, over = {}) =>
    note(id, {
      object_type: "board",
      source_page_id: "page-1",
      // Bare-node JSON, which is what `refresh_pin_caches` writes. This is
      // the pin the tester could not open.
      content: JSON.stringify({
        type: "blockquote",
        content: [{ type: "paragraph", content: [{ type: "text", text: "not time, scope" }] }],
      }),
      ...over,
    });

  it("pushes the pin's screen from its row, with its writing live", async () => {
    // THE DEFECT, end to end: the row, the screen, the editor. A board's
    // doc is mounted in ProseMirror (PinEditor) rather than rendered
    // static — "pins are not editable" was the tester's second report.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([board("a")]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", mode: "discrete" }]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    tapPinRow(target, "a");
    await settle();

    // Three: the page root, the pins screen, and this.
    expect(depth(target)).toBe(3);
    expect(target.querySelector('[data-sheet="pin-actions"]')).toBeNull();
    const pm = top(target).querySelector(".ProseMirror");
    expect(pm).not.toBeNull();
    expect(pm.getAttribute("contenteditable")).toBe("true");
    expect(pm.textContent).toContain("not time, scope");
    // The bar says `pin` for every kind now, not the kind — see
    // PinArtifactScreen.test.js for the decision and what it cost.
    expect(top(target).querySelector(".shell-navbar-title").textContent.trim()).toBe("pin");
    expect(titleField(target).value).toBe("a");
  });

  it("puts a note's text in a field, newlines intact", async () => {
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([note("a", { content: "one\ntwo" })]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();

    expect(textField(target).value).toBe("one\ntwo");
    expect(top(target).querySelector(".ProseMirror")).toBeNull();
    expect(top(target).querySelector(".shell-navbar-title").textContent.trim()).toBe("pin");
  });

  it("keeps an orphaned pin, dimmed, and says why on its screen", async () => {
    // CLAUDE.md's pin pointer clause: the pin survives its page with its
    // cache intact, so the writing is still reachable and a row that
    // vanished would say it was not. The desktop dims rather than hides
    // for the same reason (PinRow.svelte:282). The dimming says nothing to
    // assistive tech, which is why the provenance line carries the words.
    //
    // And `carry forward` is absent, which is not tidiness:
    // get_carry_forward_pins reads the flag with `AND so.status !=
    // 'orphaned'` (commands.rs:3899), so the toggle would write a column
    // nothing can ever read back. And no way back: the page is gone.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([board("a", { status: "orphaned" })]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", mode: "discrete" }]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    expect(pinRows(target)).toEqual([{ label: "a", status: "orphaned" }]);

    tapPinRow(target, "a");
    await settle();

    expect(top(target).querySelector(".ProseMirror").textContent).toContain("not time, scope");
    // Only the first words: this file's `board()` carries no timestamps,
    // so the dated segments are dropped — provenance.test.js holds them.
    expect(top(target).querySelector(".shell-provenance").textContent.trim()).toMatch(
      /^source removed/,
    );
    expect(topRows(target)).toEqual(["trail", "unpin"]);
  });

  it("offers no carry forward on an untrailed page's pins", async () => {
    // Every row an untrailed page's screen shows is a global pin
    // (get_pins(null)), and `get_carry_forward_pins` matches on
    // `so.lineage_id = ?1`, which NULL never equals. A whole screen's
    // worth of control that could write a column and change nothing.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    api.getPins.mockResolvedValue([note("a", { lineage_id: null })]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    tapPinRow(target, "a");
    await settle();

    expect(topRows(target)).toEqual(["trail", "unpin"]);
  });

  it("names the trail the pin is kept on, off the list it already loaded", async () => {
    // The trail is the provenance line's first word; there is no chip.
    // The dates on the line are the host's clock, so only the trail half
    // is asserted here — provenance.test.js holds the date words.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([board("a")]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", mode: "discrete" }]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    tapPinRow(target, "a");
    await settle();

    expect(top(target).querySelector(".shell-chip")).toBeNull();
    expect(top(target).querySelector(".shell-provenance").textContent.trim()).toMatch(
      /^from the book/,
    );
    expect(topRows(target)).toEqual(["open the page it came from", "trail", "carry forward", "unpin"]);
  });

  it("opens the source page by its ID, which is the only address it carries", async () => {
    // A pin holds `source_page_id` and no date or number, and page_number
    // is minted per device — page-address.js's whole subject. The
    // assertion is on the ARGUMENTS rather than on the landing, because a
    // page that landed on the wrong device's page 1 would look identical.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([board("a", { source_page_id: "PAGE-9" })]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", mode: "discrete" }]);
    api.getPage.mockResolvedValue(withLines(pageRow({ id: "PAGE-9", lineage_id: "L1" })));
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);

    tapPinRow(target, "a");
    await settle();
    api.getPage.mockClear();
    tapTopRow(target, "open the page it came from");
    await settle();

    expect(api.getPage).toHaveBeenCalledWith(null, null, "PAGE-9");
  });

  it("lands that page on the writing surface, not on a view of it", async () => {
    // REPORTED: "in mobile open source page pin should show us in the editor
    // similar to desktop then user could move to today". The row used to
    // push the reading view, which holds no editor — so the pointer a pin
    // is landed somewhere the writer could look at their writing and not
    // touch it. The stack is left entirely: a pin is reached from the pins
    // screen, which is itself pushed, and both go.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([board("a", { source_page_id: "PAGE-9" })]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", mode: "discrete" }]);
    api.getPage.mockResolvedValue(withLines(pageRow({ id: "PAGE-9", lineage_id: "L1" })));
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();

    tapTopRow(target, "open the page it came from");
    await settle();

    expect(depth(target)).toBe(1);
    expect(target.querySelector(".ps-canvas")).not.toBeNull();
  });

  it("writes the pin's edit BEFORE it reads the page, so the page shows it", async () => {
    // THE DEFECT THIS WAS WRITTEN FOR, reported as "changing a pin content
    // does not appear in its source page". The pin screen writes its draft
    // when it is POPPED, and this row used to PUSH — so the edit was still
    // in memory when the page was read out of the database, and the writer
    // was shown their own words from before the edit. Ordering is the
    // assertion: the save has to be in flight and settled first.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([note("a", { source_page_id: "PAGE-9" })]);
    api.getPage.mockResolvedValue(withLines(pageRow({ id: "PAGE-9" })));
    const order = [];
    api.updatePinContent.mockImplementation(async () => {
      order.push("saved the pin");
    });
    api.getPage.mockImplementation(async () => {
      order.push("read the page");
      return withLines(pageRow({ id: "PAGE-9" }));
    });
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();

    type(textField(target), "a second thought");
    await settle();
    tapTopRow(target, "open the page it came from");
    await settle();

    expect(order).toEqual(["saved the pin", "read the page"]);
  });

  it("unpins the pin from its screen, drops its row, and leaves", async () => {
    // The await is load-bearing: the row is dropped and the screen left
    // only after deletePin resolves (a failed delete must not leave a row
    // that vanished and came back), so a synchronous assertion here sees
    // the old list.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([note("a"), note("b")]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();

    tapTopRow(target, "unpin");
    await settle();

    expect(api.deletePin).toHaveBeenCalledWith("a");
    expect(depth(target)).toBe(2);
    expect(pinRows(target).map((r) => r.label)).toEqual(["b"]);
    // The header's count is re-measured, not decremented — the next read
    // is what the database now holds.
    expect(api.getPins).toHaveBeenLastCalledWith("L1");
  });

  it("does not paint unpin as destructive", async () => {
    // CLAUDE.md's return beat: "unpinning is part of the model, not a
    // failure of it." Row's destructive variant is the accent colouring
    // that means "this takes something away", and the block sheet's
    // `delete` row carries it — so the absence here is a decision about
    // this act rather than a prop nobody passed.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([note("a")]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();

    const row = [...top(target).querySelectorAll(".shell-row")].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === "unpin",
    );
    expect(row.dataset.destructive).toBeUndefined();
    expect(row.dataset.kind).toBe("action");
    expect(row.querySelector(".shell-row-chevron")).toBeNull();
  });

  it("carries a pin forward, and relabels the row under the thumb", async () => {
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([note("a")]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();

    tapTopRow(target, "carry forward");
    await settle();

    expect(api.updatePinAutoInsert).toHaveBeenCalledWith("a", true);
    // patchPin writes through to the frozen pin the screen holds, so the
    // row names what the NEXT tap does without leaving and coming back.
    expect(topRows(target)).toEqual(["trail", "stop carrying forward", "unpin"]);
  });

  it("keeps what was typed on the page across a push that reaches the pin", async () => {
    // Stack keeps only the top two entries alive, so at depth 3 — the
    // page root, the pins screen, the pin — the root's EditorCore is
    // unmounted. Coming back remounts it, and a remount from the host's
    // load-time `page.content_json` would put the page back as it was
    // opened, with the writer's newest lines gone from the screen and
    // the next autosave writing that stale doc over them. Every pin open
    // walks this path since the second device pass.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([note("a", { content: "one" })]);
    const { target } = render(ShellApp, {});
    await settleWithEditor();
    const ed = editorOf(target);
    ed.view.dispatch(ed.state.tr.insertText(" and then some", ed.state.doc.firstChild.nodeSize - 1));
    expect(ed.state.doc.textContent).toContain("and then some");

    await pushPins(target);
    tapPinRow(target, "a");
    await settle();
    expect(depth(target)).toBe(3);
    tapBack(target);
    await settle();
    tapBack(target);
    await settle();

    expect(depth(target)).toBe(1);
    expect(editorOf(target).state.doc.textContent).toContain("and then some");
  });

  // ── Step 3: what leaving the screen writes ────────────────────────────

  it("edits a note's title and body, and writes both columns when the writer leaves", async () => {
    // BOTH, on the row route: update_pin_content is `SET content = ?,
    // title = ?` with no COALESCE (commands.rs:3590), so a null title
    // CLEARS the title and there is no way to send content alone. The ROW
    // is this pin's home because a note's node is a paragraph, which has
    // no `blockTitle` slot to hold a title (pin-title-authority.js).
    //
    // WRITTEN ON LEAVING, not on a save row: the bar's back is the door
    // here, and popScreen is where every door lands.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([note("a", { title: "the second reader", content: "one\ntwo" })]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "the second reader");
    await settle();

    expect(titleField(target).value).toBe("the second reader");
    expect(textField(target).value).toBe("one\ntwo");
    type(titleField(target), "what the trail is for");
    titleField(target).dispatchEvent(new FocusEvent("blur"));
    type(textField(target), "one\ntwo\nthree");
    expect(api.updatePinContent).not.toHaveBeenCalled();

    tapBack(target);
    await settle();

    expect(depth(target)).toBe(2);
    expect(api.updatePinContent).toHaveBeenCalledTimes(1);
    expect(api.updatePinContent).toHaveBeenCalledWith(
      "a",
      "one\ntwo\nthree",
      "what the trail is for",
    );
    // The list is patched, so the row says what the writer just typed
    // rather than what the fetch read.
    expect(pinRows(target).map((r) => r.label)).toEqual(["what the trail is for"]);
  });

  it("writes nothing when the screen is left untouched", async () => {
    // The desktop modal's `dirty` gate, for its reason: a no-op open and
    // close round-tripped through the serializer once overwrote pins with
    // the editor's normalized form. A blur on the title is not an edit
    // either.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([board("a")]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();
    titleField(target).dispatchEvent(new FocusEvent("blur"));

    tapBack(target);
    await settle();

    expect(api.updatePinContent).not.toHaveBeenCalled();
    expect(api.savePageContentWithPinRefresh).not.toHaveBeenCalled();
    expect(pinRows(target).map((r) => r.label)).toEqual(["a"]);
  });

  it("writes a board's edited doc to the page it came from", async () => {
    // THE REPORT: "updating pins does not reflect change in the page where
    // pin exist". The body used to go to the pin's cache and stop, so the
    // block on the page kept the old writing. The page is the thing the
    // pin points at, and refresh_pin_caches re-derives the cache from it.
    // This pin's page is not the one open, so the route is the desktop's
    // cross-page one: load, splice, save through the refresh hook.
    const source = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        {
          type: "blockquote",
          attrs: { pinId: "a" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "not time, scope" }] }],
        },
      ],
    };
    api.loadPageContentForModal.mockResolvedValue(JSON.stringify(source));
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([board("a", { source_page_id: "p-elsewhere" })]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();

    // TipTap hangs the instance on its DOM (`dom.editor = this`), which
    // is the way into a contenteditable jsdom cannot focus.
    const ed = top(target).querySelector(".ProseMirror").editor;
    expect(ed).toBeTruthy();
    ed.view.dispatch(ed.view.state.tr.insertText("still ", 2));
    flushSync();

    tapBack(target);
    await settle();

    expect(api.savePageContentWithPinRefresh).toHaveBeenCalledTimes(1);
    const [pageId, json] = api.savePageContentWithPinRefresh.mock.calls[0];
    expect(pageId).toBe("p-elsewhere");
    const saved = JSON.parse(json);
    // The block the pin points at carries the edit, keeps its id, and the
    // paragraph beside it is untouched.
    expect(JSON.stringify(saved.content[1])).toContain("still not time, scope");
    expect(saved.content[1].attrs.pinId).toBe("a");
    expect(saved.content[0]).toEqual(source.content[0]);
    // And the cache is not written behind the page's back: the refresh
    // that runs with the save is what re-derives it.
    expect(api.updatePinContent).not.toHaveBeenCalled();
  });

  it("splices a board that is on the open page into the live doc", async () => {
    // The other route, and the one that matters most: a database write
    // behind the editor's back would be undone by its next autosave.
    const open = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          attrs: { pinId: "a" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "not time, scope" }] }],
        },
      ],
    };
    api.getOrCreateToday.mockResolvedValue(
      withLines(pageRow({ id: "p1", lineage_id: "L1", content_json: JSON.stringify(open) })),
    );
    api.getPins.mockResolvedValue([board("a", { source_page_id: "p1" })]);
    const { target } = render(ShellApp, {});
    await settle();
    const pageEditor = editorOf(target);
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();

    const ed = top(target).querySelector(".ProseMirror").editor;
    ed.view.dispatch(ed.view.state.tr.insertText("still ", 2));
    flushSync();

    tapBack(target);
    await settle();

    expect(pageEditor.state.doc.textContent).toContain("still not time, scope");
    expect(pageEditor.state.doc.firstChild.attrs.pinId).toBe("a");
    expect(api.savePageContentWithPinRefresh).not.toHaveBeenCalled();
    expect(api.updatePinContent).not.toHaveBeenCalled();
  });

  // ── many blocks back from the pin's screen ─────────────────────────────
  //
  // writePinEdit (main's pin-edit-route.js) splices ONE node. The shell
  // keeps every block the pin's screen hands back, so its two page writers
  // put the whole list where that node went: spliceInEditor sends the list,
  // and the stored-page save re-splices the list at the pinId the spliced
  // node carries. If either seam is lost, the added block is dropped
  // without a word; these say so.

  /** Add a paragraph after the pinned blockquote in the pin's own editor. */
  function addBlockInPinScreen(target, text) {
    const ed = top(target).querySelector(".ProseMirror").editor;
    const { state } = ed.view;
    ed.view.dispatch(
      state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create(null, state.schema.text(text))),
    );
    flushSync();
  }

  it("writes both blocks of a board edited into two to the page it came from", async () => {
    const source = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        {
          type: "blockquote",
          attrs: { pinId: "a" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "not time, scope" }] }],
        },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    };
    api.loadPageContentForModal.mockResolvedValue(JSON.stringify(source));
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([board("a", { source_page_id: "p-elsewhere" })]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();
    addBlockInPinScreen(target, "and a second block");

    tapBack(target);
    await settle();

    expect(api.savePageContentWithPinRefresh).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(api.savePageContentWithPinRefresh.mock.calls[0][1]);
    expect(saved.content.map((n) => n.type)).toEqual(["paragraph", "blockquote", "paragraph", "paragraph"]);
    expect(saved.content[1].attrs.pinId).toBe("a");
    expect(JSON.stringify(saved.content[1])).toContain("not time, scope");
    expect(saved.content[2].content[0].text).toBe("and a second block");
    // Both halves are the pin's (pin-run.js): a half left unstamped would
    // drop out of the pin at the next save.
    expect(saved.content[2].attrs.pinId).toBe("a");
    expect(saved.content[3]).toEqual(source.content[2]);
  });

  it("splices both blocks of a board edited into two into the open page's live doc", async () => {
    const open = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          attrs: { pinId: "a" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "not time, scope" }] }],
        },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    };
    api.getOrCreateToday.mockResolvedValue(
      withLines(pageRow({ id: "p1", lineage_id: "L1", content_json: JSON.stringify(open) })),
    );
    api.getPins.mockResolvedValue([board("a", { source_page_id: "p1" })]);
    const { target } = render(ShellApp, {});
    await settle();
    const pageEditor = editorOf(target);
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();
    addBlockInPinScreen(target, "and a second block");

    tapBack(target);
    await settle();

    const blocks = pageEditor.getJSON().content;
    expect(blocks.map((n) => n.type)).toEqual(["blockquote", "paragraph", "paragraph"]);
    expect(blocks[0].attrs.pinId).toBe("a");
    expect(blocks[1].content[0].text).toBe("and a second block");
    expect(blocks[1].attrs.pinId).toBe("a");
    expect(blocks[2].content[0].text).toBe("after");
    expect(api.savePageContentWithPinRefresh).not.toHaveBeenCalled();
  });

  it("keeps an orphaned pin's edit in its cache, which is the only copy left", async () => {
    // CLAUDE.md's pointer clause from the other end: the page is gone, so
    // there is nothing to write through to, and the cache is the writing.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([board("a", { status: "orphaned" })]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();

    const ed = top(target).querySelector(".ProseMirror").editor;
    ed.view.dispatch(ed.view.state.tr.insertText("still ", 2));
    flushSync();

    tapBack(target);
    await settle();

    expect(api.savePageContentWithPinRefresh).not.toHaveBeenCalled();
    expect(api.updatePinContent).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(api.updatePinContent.mock.calls[0][1])).toContain("still not time, scope");
  });

  it("writes a note's text into its block on the page it came from", async () => {
    // A note's text used to go to the ROW alone. While a page holds the
    // pin's paragraph, the paragraph is the pin: that page's next save, on
    // either device, runs refresh_pin_caches and rewrites the row from the
    // unedited block, and since a save now sends the pins it rewrites
    // (main 1f198150), the old text then wins everywhere. So the edit goes
    // into the block, through main's writePinEdit (pin-edit-route.js).
    const source = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        { type: "paragraph", attrs: { pinId: "a" }, content: [{ type: "text", text: "one" }] },
      ],
    };
    api.loadPageContentForModal.mockResolvedValue(JSON.stringify(source));
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([note("a", { content: "one", source_page_id: "p-elsewhere" })]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();
    type(textField(target), "one\nthen two");

    tapBack(target);
    await settle();

    expect(api.savePageContentWithPinRefresh).toHaveBeenCalledTimes(1);
    const [pageId, json] = api.savePageContentWithPinRefresh.mock.calls[0];
    expect(pageId).toBe("p-elsewhere");
    const saved = JSON.parse(json);
    expect(saved.content[1]).toEqual({
      type: "paragraph",
      attrs: { pinId: "a" },
      content: [{ type: "text", text: "one" }, { type: "hardBreak" }, { type: "text", text: "then two" }],
    });
    expect(saved.content[0]).toEqual(source.content[0]);
    // No title changed, so the row is not written: the save's refresh
    // re-derives it from the block.
    expect(api.updatePinContent).not.toHaveBeenCalled();
  });

  it("writes a note's text into the open page's live block", async () => {
    // The live route: the paragraph is in the doc this editor holds, so a
    // database write behind it would be undone by its next autosave.
    const open = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { pinId: "a" }, content: [{ type: "text", text: "one" }] }],
    };
    api.getOrCreateToday.mockResolvedValue(
      withLines(pageRow({ id: "p1", lineage_id: "L1", content_json: JSON.stringify(open) })),
    );
    api.getPins.mockResolvedValue([note("a", { content: "one", source_page_id: "p1" })]);
    const { target } = render(ShellApp, {});
    await settle();
    const pageEditor = editorOf(target);
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();
    type(textField(target), "one, then two");

    tapBack(target);
    await settle();

    expect(pageEditor.state.doc.firstChild.textContent).toBe("one, then two");
    expect(pageEditor.state.doc.firstChild.attrs.pinId).toBe("a");
    expect(api.savePageContentWithPinRefresh).not.toHaveBeenCalled();
    expect(api.updatePinContent).not.toHaveBeenCalled();
  });

  it("keeps an orphaned note's edit in its row, when no page holds its block", async () => {
    // The pointer clause: the block is gone from its page, so the snapshot
    // is all the pin is, and the edit is the snapshot. Nothing will
    // overwrite it, because there is no block for a save to re-derive it
    // from.
    api.loadPageContentForModal.mockResolvedValue(
      JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "other" }] }] }),
    );
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([
      note("a", { content: "one", source_page_id: "p-elsewhere", status: "orphaned" }),
    ]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();
    type(textField(target), "one, then two");

    tapBack(target);
    await settle();

    expect(api.savePageContentWithPinRefresh).not.toHaveBeenCalled();
    expect(api.updatePinContent).toHaveBeenCalledWith("a", "one, then two", "a");
  });

  it("says so on screen when nothing takes the edit, and the row keeps what it held", async () => {
    // Every place refused it: the page's save failed, and so did the row.
    // A list that showed the typed words would claim a write that did not
    // happen.
    const source = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { pinId: "a" }, content: [{ type: "text", text: "one" }] }],
    };
    api.loadPageContentForModal.mockResolvedValue(JSON.stringify(source));
    api.savePageContentWithPinRefresh.mockRejectedValueOnce(new Error("disk"));
    api.updatePinContent.mockRejectedValueOnce(new Error("disk"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([
      note("a", { title: "the reader", content: "one", source_page_id: "p-elsewhere" }),
    ]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "the reader");
    await settle();
    type(titleField(target), "a new name");
    titleField(target).dispatchEvent(new FocusEvent("blur"));
    type(textField(target), "one, then two");

    tapBack(target);
    await settle();

    expect(target.querySelector(".shell-toast")?.textContent.trim()).toBe(
      "that edit did not save. the pin still holds what it held before.",
    );
    expect(pinRows(target).map((r) => r.label)).toEqual(["the reader"]);
    err.mockRestore();
    warn.mockRestore();
  });

  it("renames a board on its own page's node, never on the row", async () => {
    // A board's title is its `blockTitle` slot — page content, and the doc
    // is authoritative for it (pin-title-authority.js, issue #1). A row
    // write would hold exactly until the next save of the source page:
    // that save's refresh_pin_caches re-derives the row's title from the
    // node, and the node still said the old one. The pin here is on
    // ANOTHER page, so the route is the desktop's cross-page one — load the
    // source, rewrite the one node carrying the pinId, save through the
    // pin-refresh hook — and the row is not written at all.
    const cached = JSON.stringify({ type: "doc", content: [{ type: "table", content: [] }] });
    const source = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        { type: "table", attrs: { pinId: "a", blockTitle: "the shape" }, content: [] },
      ],
    };
    api.loadPageContentForModal.mockResolvedValue(JSON.stringify(source));
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([
      note("a", { object_type: "board", title: "the shape", content: cached, source_page_id: "p-elsewhere" }),
    ]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "the shape");
    await settle();

    type(titleField(target), "the shape of it");
    titleField(target).dispatchEvent(new FocusEvent("blur"));
    tapBack(target);
    await settle();

    expect(api.updatePinContent).not.toHaveBeenCalled();
    expect(api.loadPageContentForModal).toHaveBeenCalledWith("p-elsewhere");
    expect(api.savePageContentWithPinRefresh).toHaveBeenCalledTimes(1);
    const [pageId, json] = api.savePageContentWithPinRefresh.mock.calls[0];
    expect(pageId).toBe("p-elsewhere");
    const saved = JSON.parse(json);
    expect(saved.content[1].attrs).toEqual({ pinId: "a", blockTitle: "the shape of it" });
    // The paragraph beside it is untouched — the walk writes the one node
    // that carries the pinId, not every node.
    expect(saved.content[0]).toEqual(source.content[0]);
    // And the list already says the new name, the same optimistic patch
    // the row route gets.
    expect(pinRows(target).map((r) => r.label)).toEqual(["the shape of it"]);
  });

  it("renames a board that is on the open page in the live doc, not the database", async () => {
    // The other half of the node route, and the one that matters most: the
    // pin is in the doc this editor holds, so a write to the database
    // behind the editor's back would be undone by its next autosave. The
    // title lands on the node itself (EditorCore.setBlockTitleAtPinId) and
    // neither api write happens — the editor's own save is what carries
    // it to the row.
    const cached = JSON.stringify({ type: "doc", content: [{ type: "blockquote", content: [] }] });
    const open = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          attrs: { pinId: "a", blockTitle: "the shape" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "not time, scope" }] }],
        },
      ],
    };
    api.getOrCreateToday.mockResolvedValue(
      withLines(pageRow({ lineage_id: "L1", content_json: JSON.stringify(open) })),
    );
    api.getPins.mockResolvedValue([
      note("a", { object_type: "board", title: "the shape", content: cached, source_page_id: "p1" }),
    ]);
    const { target } = render(ShellApp, {});
    await settle();
    const ed = editorOf(target);
    expect(ed.state.doc.firstChild.attrs.blockTitle).toBe("the shape");
    await pushPins(target);
    tapPinRow(target, "the shape");
    await settle();

    type(titleField(target), "the shape of it");
    titleField(target).dispatchEvent(new FocusEvent("blur"));
    tapBack(target);
    await settle();

    expect(ed.state.doc.firstChild.attrs.blockTitle).toBe("the shape of it");
    expect(ed.state.doc.firstChild.textContent).toBe("not time, scope");
    expect(api.updatePinContent).not.toHaveBeenCalled();
    expect(api.savePageContentWithPinRefresh).not.toHaveBeenCalled();
  });

  it("writes nothing into a pin that was just unpinned", async () => {
    // The draft dies with the pin: a save after the delete would be a
    // write to a row that is gone, and an error in the console for a
    // thing the writer just chose to let go of.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([note("a", { content: "one" })]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();
    type(textField(target), "half a thought");

    tapTopRow(target, "unpin");
    await settle();

    expect(api.deletePin).toHaveBeenCalledWith("a");
    expect(api.updatePinContent).not.toHaveBeenCalled();
    expect(depth(target)).toBe(2);
  });

  it("writes on the platform back too, which is the same door", async () => {
    // Three ways off the screen — the bar's back, the system back, the
    // edge gesture — and one popScreen under all of them, which is where
    // the draft is written. This is the second door; a save wired to the
    // bar's button alone would have passed every test above.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([note("a", { content: "one" })]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();
    type(textField(target), "one, then two");

    navBack();
    flushSync();
    await settle();

    expect(depth(target)).toBe(2);
    expect(api.updatePinContent).toHaveBeenCalledWith("a", "one, then two", "a");
  });

  it("writes the draft when the app goes away, which is how a phone is left", async () => {
    // THE REACHABLE HALF OF "edit pins should presist". A writer types into
    // a pin and then switches apps, locks the screen, or takes a call.
    // Android fires visibilitychange and may never come back — onDestroy
    // does not run on a swipe-away — and the draft lived only in memory
    // until the screen was popped, which now never happens. EditorCore has
    // guarded the page's own content this way since a pin's stamp was lost
    // the same way; the pin screen is the other surface a writer types into
    // and it had nothing.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getPins.mockResolvedValue([note("a", { content: "one" })]);
    const { target } = render(ShellApp, {});
    await settle();
    await pushPins(target);
    tapPinRow(target, "a");
    await settle();
    type(textField(target), "one, then two");

    // The real event, with the state Android actually reports — not a call
    // to the handler, which would pass against a listener that was never
    // registered.
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();

    expect(api.updatePinContent).toHaveBeenCalledWith("a", "one, then two", "a");
  });
});

// The memory root, from the app: what it reads on the way in, what its
// search asks for, what its filter sheet changes, and the half of §1's
// space-gesture pair that only exists once memory has a canvas of its own.
//
// Its own history harness, like the two describes above, because the filter
// sheet pushes a navstack entry.
describe("ShellApp — memory", () => {
  let historyStates;
  let navTeardown;

  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 0));
    _resetForTests();
    historyStates = [];
    vi.spyOn(window.history, "pushState").mockImplementation((state) => {
      historyStates.push(state);
    });
    vi.spyOn(window.history, "back").mockImplementation(() => {
      historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    vi.spyOn(window.history, "go").mockImplementation((n) => {
      for (let i = 0; i < -n; i++) historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    navTeardown = initNavStack();
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    api.getPins.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanupAll();
    navTeardown();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const TODAY = getLocalDateStr();

  function memoryPage(over = {}) {
    return {
      id: "m1",
      date: TODAY,
      page_number: 1,
      lineage_id: "L1",
      what_matters_now: "the second reader",
      pin_count: 0,
      ...over,
    };
  }

  /** Two settles: loadMemory awaits the pages and the trails, and only then
   *  fans out across the trails for their pins. One macrotask drains the
   *  first await; the fan-out is behind the second. */
  async function openMemory(target) {
    target.querySelector('[data-tab-id="memory"]').click();
    flushSync();
    await settle();
    await settle();
  }

  /** Scoped to the content band. The filter sheet is a DOM child of the
   *  same tree and its controls are `.shell-row`s too, so an unscoped query
   *  reads the sheet's rows as list rows the moment it opens. And to a
   *  group's body: every page and pin row sits in a RowGroup in all three
   *  modes, while the trail map's trail header is an inert `Row` outside
   *  one — a reader of every row would count "the book" as a page. */
  const rowLabels = (target) =>
    [
      ...target.querySelectorAll(".shell-screen-content .shell-row-group-body .shell-row-label"),
    ].map((n) => n.textContent.trim());

  const sheetRows = (target, tag) =>
    [...target.querySelectorAll(`[data-sheet="${tag}"] .shell-row-label`)].map((n) =>
      n.textContent.trim(),
    );

  function sheetSegment(target, tag, label) {
    const button = [...target.querySelectorAll(`[data-sheet="${tag}"] .seg-btn`)].find(
      (b) => b.textContent.trim() === label,
    );
    expect(button, `no "${label}" segment in the ${tag} sheet`).toBeTruthy();
    button.click();
    flushSync();
  }

  function tapSheetRow(target, tag, label) {
    const row = [...target.querySelectorAll(`[data-sheet="${tag}"] .shell-row`)].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
    );
    expect(row, `no "${label}" row in the ${tag} sheet`).toBeTruthy();
    row.click();
    flushSync();
  }

  function openFilters(target) {
    target.querySelector(".shell-navbar-action").click();
    flushSync();
  }

  function type(target, text) {
    const input = target.querySelector(".memory-search input");
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
  }

  /** The debounce is real, and so is the wait. Fake timers would have to
   *  cover `settle()` too — which is a setTimeout — so the honest cheap
   *  option is to let 200ms pass. SEARCH_DEBOUNCE_MS is imported rather
   *  than re-typed: a test carrying its own 200 would keep passing with
   *  the two out of step. */
  async function afterDebounce() {
    await new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS + 30));
    flushSync();
  }

  // ShellRoot.test.js's timestamped pointer, and the stroke helper from the
  // stack describe above — jsdom stamps an event at construction, so a
  // stroke built in one synchronous statement lands on a single millisecond
  // and every velocity the recogniser reports comes out 0.
  function pointer(type_, { x, y, t, id = 1 }) {
    const event = new PointerEvent(type_, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: id,
    });
    Object.defineProperty(event, "timeStamp", { value: t, configurable: true });
    return event;
  }

  function stroke(from, pts) {
    from.dispatchEvent(pointer("pointerdown", pts[0]));
    for (const p of pts.slice(1, -1)) from.dispatchEvent(pointer("pointermove", p));
    from.dispatchEvent(pointer("pointerup", pts[pts.length - 1]));
    flushSync();
  }

  const canvas = (target) => target.querySelector('[data-shell-region="canvas"]');

  it("reads the pages, the trails and every trail's pins on the way in", async () => {
    api.getThread.mockResolvedValue([memoryPage()]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", parent_id: null }]);
    const { target } = render(ShellApp, {});
    await settle();
    api.getPins.mockClear();

    await openMemory(target);

    // The desktop's own hundred, in the sort the screen opened with.
    expect(api.getThread).toHaveBeenCalledWith(100, 0, "date");
    // Globals AND every trail: getPins(id) walks ancestors upward and
    // getPins(null) returns only the globals, so neither call alone can
    // answer for a whole account.
    expect(api.getPins).toHaveBeenCalledWith(null);
    expect(api.getPins).toHaveBeenCalledWith("L1");
  });

  it("shows the timeline it read", async () => {
    api.getThread.mockResolvedValue([
      memoryPage({ id: "a", what_matters_now: "the second reader" }),
    ]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", parent_id: null }]);
    const { target } = render(ShellApp, {});
    await settle();

    await openMemory(target);

    expect(target.querySelector(".memory-day-head .shell-eyebrow").textContent.trim()).toBe("today");
    expect(target.querySelector(".memory-trail-name").textContent.trim()).toBe(
      "the book",
    );
    expect(rowLabels(target)).toContain("the second reader");
  });

  it("searches the writing, and keeps only what matched", async () => {
    api.getThread.mockResolvedValue([
      memoryPage({ id: "a", what_matters_now: "the second reader" }),
      memoryPage({ id: "b", what_matters_now: "the first draft" }),
    ]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", parent_id: null }]);
    api.searchPages.mockResolvedValue([{ id: "b" }]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    expect(rowLabels(target)).toEqual(["the second reader", "the first draft"]);

    type(target, "draft");
    // Nothing has been asked yet — the wait is the whole point of a
    // debounce, and asserting it here is what stops the interval quietly
    // becoming zero.
    expect(api.searchPages).not.toHaveBeenCalled();

    await afterDebounce();

    // The desktop's own FTS5 command, not a second query written for the
    // phone.
    expect(api.searchPages).toHaveBeenCalledWith("draft");
    expect(rowLabels(target)).toEqual(["the first draft"]);
  });

  it("gives the whole list back when the field is emptied", async () => {
    // Synchronously, without waiting for a query that will never run: the
    // matching set is cleared on the keystroke rather than by a debounced
    // answer, or a cleared field would keep the previous filter for 200ms.
    api.getThread.mockResolvedValue([
      memoryPage({ id: "a", what_matters_now: "the second reader" }),
      memoryPage({ id: "b", what_matters_now: "the first draft" }),
    ]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", parent_id: null }]);
    api.searchPages.mockResolvedValue([{ id: "b" }]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    type(target, "draft");
    await afterDebounce();
    expect(rowLabels(target)).toEqual(["the first draft"]);

    type(target, "");
    expect(rowLabels(target)).toEqual(["the second reader", "the first draft"]);
  });

  it("takes the page's find strip away when the writer leaves for memory", async () => {
    // toolbarFor's rows below the overlay row are the EDITOR's, and only
    // the page root mounts one. Nothing resets `findOpen` on a root switch,
    // so before `space` the find strip sat under memory's list with its
    // arrows still aimed at a page nobody could see — and the slot that
    // should have held the tab bar held that instead, which is also how
    // the writer would have got back.
    //
    // Reached by the swipe rather than by the tab bar on purpose: with find
    // open there IS no tab bar to click, which is the defect stated as a
    // navigation dead end.
    api.getThread.mockResolvedValue([memoryPage()]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", parent_id: null }]);
    const { target } = render(ShellApp, {});
    await settle();
    target.querySelector(".ph-find").click();
    flushSync();
    expect(target.querySelector(".shell-find-strip")).not.toBeNull();

    stroke(canvas(target), [
      { x: 200, y: 500, t: 0 },
      { x: 203, y: 380, t: 60 },
      { x: 205, y: 260, t: 120 },
    ]);
    await settle();
    await settle();

    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("memory");
    expect(target.querySelector(".shell-find-strip")).toBeNull();
    expect(target.querySelector(".shell-tabbar")).not.toBeNull();
  });

  it("opens the filters sheet from the bar, and narrows the list from it", async () => {
    api.getThread.mockResolvedValue([
      memoryPage({ id: "a", date: TODAY, what_matters_now: "the second reader" }),
      memoryPage({ id: "b", date: "2020-03-04", what_matters_now: "the first draft" }),
    ]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", parent_id: null }]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    expect(rowLabels(target)).toEqual(["the second reader", "the first draft"]);

    openFilters(target);
    expect(target.querySelector('[data-sheet="memory-filters"]')).not.toBeNull();

    sheetSegment(target, "memory-filters", "today");
    expect(rowLabels(target)).toEqual(["the second reader"]);
    // The bar counts what the writer moved, so the way back is visible
    // from outside the sheet.
    expect(target.querySelector(".shell-navbar-action").textContent.trim()).toBe("filters · 1");
  });

  it("names the date filter in force with a pill, counts what it hides, and takes it off", async () => {
    // 0.8.2 (spec §2, §4): a list that is merely shorter says why. The
    // desktop's bug was a pins tab at 1 of 4 under a filter nothing named.
    api.getThread.mockResolvedValue([
      memoryPage({ id: "a", date: TODAY, what_matters_now: "the second reader" }),
      memoryPage({ id: "b", date: "2020-03-04", what_matters_now: "the first draft" }),
    ]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", parent_id: null }]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    // At rest: no pill, and the count line says the whole.
    expect(target.querySelector(".memory-pills")).toBeNull();

    openFilters(target);
    sheetSegment(target, "memory-filters", "today");
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle();

    const pills = [...target.querySelectorAll(".memory-pill button")];
    expect(pills.map((b) => b.getAttribute("aria-label"))).toEqual(["remove today"]);
    expect(target.querySelector(".memory-count").textContent.trim()).toBe(
      '1 of 2 pages · 1 hidden by "today"',
    );

    pills[0].click();
    flushSync();
    await settle();
    expect(target.querySelector(".memory-pills")).toBeNull();
    expect(target.querySelector(".memory-count").textContent.trim()).toBe("2 pages");
    expect(rowLabels(target)).toEqual(["the second reader", "the first draft"]);
  });

  it("shows everything: every pill off and the search cleared", async () => {
    api.getThread.mockResolvedValue([
      memoryPage({ id: "a", date: TODAY, what_matters_now: "the second reader", pin_count: 1 }),
      memoryPage({ id: "b", date: "2020-03-04", what_matters_now: "the first draft" }),
    ]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", parent_id: null }]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    openFilters(target);
    sheetSegment(target, "memory-filters", "today");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle();
    expect(rowLabels(target)).toEqual(["the second reader"]);

    const all = [...target.querySelectorAll(".memory-pills-all button")][0];
    expect(all.textContent.trim()).toBe("show everything");
    all.click();
    flushSync();
    await settle();
    expect(rowLabels(target)).toEqual(["the second reader", "the first draft"]);
    expect(target.querySelector(".shell-navbar-action").textContent.trim()).toBe("filters");
  });

  it("narrows the list to a day picked off the calendar", async () => {
    // The fourth device pass: "the filters does not show date picker
    // similar to desktop". The presets stay; this is the day a preset
    // cannot name.
    const chosen = "2020-03-04";
    api.getThread.mockResolvedValue([
      memoryPage({ id: "a", date: TODAY, what_matters_now: "the second reader" }),
      memoryPage({ id: "b", date: chosen, what_matters_now: "the first draft" }),
    ]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", parent_id: null }]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    openFilters(target);
    // It opens on this month, so the writer starts where they are.
    expect(
      target.querySelector('[data-sheet="memory-filters"] .shell-calendar-month').textContent.trim(),
    ).toBe(monthLabel(TODAY));
    // The days with writing carry a dot — off the list the screen behind
    // is drawn from, so the two cannot disagree.
    expect(
      target.querySelector(`[data-sheet="memory-filters"] [data-date="${TODAY}"]`).dataset.marked,
    ).toBe("true");

    // Page back to the chosen day's month and pick it.
    const back = target.querySelector('[data-sheet="memory-filters"] [aria-label="previous month"]');
    const months = monthsBetween(chosen, TODAY);
    for (let i = 0; i < months; i += 1) back.click();
    flushSync();
    target.querySelector(`[data-sheet="memory-filters"] [data-date="${chosen}"]`).click();
    flushSync();

    expect(rowLabels(target)).toEqual(["the first draft"]);
    expect(target.querySelector(".shell-navbar-action").textContent.trim()).toBe("filters · 1");
  });

  it("lets a preset and a picked day replace one another, never both", async () => {
    // One filter said two ways. Without this the segment would light
    // `today` over a list the calendar had scoped to another day.
    api.getThread.mockResolvedValue([
      memoryPage({ id: "a", date: TODAY, what_matters_now: "the second reader" }),
    ]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", parent_id: null }]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    openFilters(target);

    target.querySelector(`[data-sheet="memory-filters"] [data-date="${TODAY}"]`).click();
    flushSync();
    // The day is chosen and no preset is lit.
    expect(
      target.querySelector(`[data-sheet="memory-filters"] [data-date="${TODAY}"]`)
        .getAttribute("aria-pressed"),
    ).toBe("true");
    // `aria-checked`, not `aria-pressed`: `.seg-btn` is a `role="radio"`
    // (SegmentedControl.svelte) and never carries `aria-pressed`, so the
    // selector this used to name matched nothing and the assertion passed
    // against any sheet at all — including one lighting a preset beside the
    // chosen day, which is the exact thing it was written to forbid.
    // Scoped to the DATE segment too, because the sort segment in the same
    // sheet legitimately has `date` lit the whole time.
    expect(
      target.querySelector(
        '[data-sheet="memory-filters"] [aria-label="date range"] .seg-btn[aria-checked="true"]',
      ),
    ).toBeNull();

    sheetSegment(target, "memory-filters", "this week");
    expect(
      target.querySelector(`[data-sheet="memory-filters"] [data-date="${TODAY}"]`)
        .getAttribute("aria-pressed"),
    ).toBe("false");
    // And clearing takes both back.
    tapSheetRow(target, "memory-filters", "clear filters");
    expect(target.querySelector(".shell-navbar-action").textContent.trim()).toBe("filters");
  });

  it("offers a way to clear only once something is on", async () => {
    api.getThread.mockResolvedValue([memoryPage()]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", parent_id: null }]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    openFilters(target);
    // At rest the sheet's only row is the toggle. A clear row here would be
    // a row that cannot change anything — the same "affordance onto
    // nothing" the block sheet refuses as a dead row.
    expect(sheetRows(target, "memory-filters")).toEqual(["pinned only"]);

    sheetSegment(target, "memory-filters", "this week");
    expect(sheetRows(target, "memory-filters")).toEqual(["pinned only", "clear filters"]);

    tapSheetRow(target, "memory-filters", "clear filters");
    expect(sheetRows(target, "memory-filters")).toEqual(["pinned only"]);
    expect(target.querySelector(".shell-navbar-action").textContent.trim()).toBe("filters");
  });

  it("re-reads from the backend when the sort changes", async () => {
    // Sort is the one filter this screen cannot apply locally: the list is
    // capped at a hundred, so re-sorting what was read would order a
    // different hundred than the one the writer asked for.
    api.getThread.mockResolvedValue([memoryPage()]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", parent_id: null }]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    openFilters(target);
    sheetSegment(target, "memory-filters", "edited");
    await settle();

    expect(api.getThread).toHaveBeenCalledWith(100, 0, "updated_at");
  });

  it("goes back to the page on a swipe down at memory's top", async () => {
    // §1's row is a PAIR and this is its second half — "swipe down at
    // memory's top → page". It had no producer at all before this task:
    // gestureOwner's branch needs `region === "canvas"`, `atScrollTop` and
    // `space === "memory"` together, and memory was a stub that marked no
    // region and reported no edges. The swipe UP that gets here is covered
    // one describe above; this is the way back.
    api.getThread.mockResolvedValue([memoryPage()]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", parent_id: null }]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    expect(target.querySelector(".ph-pins")).toBeNull();

    stroke(canvas(target), [
      { x: 200, y: 200, t: 0 },
      { x: 203, y: 320, t: 60 },
      { x: 205, y: 440, t: 120 },
    ]);
    // Awaited: returning to the page re-reads its row before the canvas is
    // rebuilt from it (see goRoot), so the switch is no longer synchronous.
    await settle();

    // The page root, named by the header only it renders.
    expect(target.querySelector(".ph-pins")).not.toBeNull();
  });

  it("shows a page the other device wrote while memory is open, without a reading state", async () => {
    // The writer's ask: what syncs shows on the phone directly. Memory read
    // its rows once on arrival, so the laptop's page waited for a re-entry.
    api.getThread.mockResolvedValue([memoryPage()]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", mode: "discrete" }]);
    const { target } = render(ShellApp);
    await settle();
    await openMemory(target);
    expect(rowLabels(target)).not.toContain("written on the laptop");

    api.getThread.mockResolvedValue([
      memoryPage({ id: "m2", what_matters_now: "written on the laptop" }),
      memoryPage(),
    ]);
    events.handlers["sync-pulled"]();
    flushSync();
    // Quiet: the list stays on screen while it is re-read.
    expect(target.querySelector(".shell-screen-content").textContent).not.toMatch(/reading/);
    await settle();
    await settle();

    expect(rowLabels(target)).toContain("written on the laptop");
  });

  it("shows the other device's edit on a page held open in the reading view", async () => {
    // Sync journey 20: the laptop ticks a task and edits a table on a page
    // the phone has open from memory. The reading view read the page once,
    // when it opened, so the phone kept showing the copy from before.
    const doc = (text) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    api.getThread.mockResolvedValue([memoryPage({ id: "r1", what_matters_now: "the kitchen plan" })]);
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the book", mode: "discrete" }]);
    api.getPage.mockResolvedValue(withLines(pageRow({ id: "r1", date: "2026-10-01", what_matters_now: "the kitchen plan",
      content_json: doc("the copy it opened with") })));
    const { target } = render(ShellApp);
    await settle();
    await openMemory(target);
    [...target.querySelectorAll(".shell-screen-content .shell-row")]
      .find((r) => r.textContent.includes("the kitchen plan")).click();
    flushSync();
    await settle();
    await settle();
    expect(target.querySelector(".reading-body").textContent).toContain("the copy it opened with");

    // A merge stamps the row's updated_at, which is what tells the reading
    // view's render cache this is a new copy.
    api.getPage.mockResolvedValue(withLines(pageRow({ id: "r1", date: "2026-10-01", what_matters_now: "the kitchen plan",
      content_json: doc("the laptop ticked the electrician"), updated_at: "2026-10-01T09:00:00Z" })));
    events.handlers["sync-pulled"]();
    await settle();
    await settle();

    expect(target.querySelector(".reading-body").textContent).toContain("the laptop ticked the electrician");
  });
});

describe("ShellApp — the reading view, and the index of trails", () => {
  let historyStates;
  let navTeardown;

  beforeEach(async () => {
    // The stack describe's own preamble: a describe that ends with a
    // surface open rewinds the REAL history in its teardown, and jsdom
    // delivers that popstate late.
    await new Promise((r) => setTimeout(r, 0));
    _resetForTests();
    historyStates = [];
    vi.spyOn(window.history, "pushState").mockImplementation((state) => {
      historyStates.push(state);
    });
    vi.spyOn(window.history, "back").mockImplementation(() => {
      historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    vi.spyOn(window.history, "go").mockImplementation((n) => {
      for (let i = 0; i < -n; i++) historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    navTeardown = initNavStack();
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    api.getPins.mockResolvedValue([]);
    // Reset here because one test below makes it reject, and a rejection
    // left standing would take the page chip off every map after it.
    api.getTrailPageCounts.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanupAll();
    navTeardown();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const TODAY = getLocalDateStr();

  const doc = (text) =>
    JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });

  /** A memory row. It is a `PageSummary`, which is the whole point of the
   *  fetch this screen makes: the summary carries no `yjs_state`, so it is
   *  not a row that may reach the canvas. */
  function summary(over = {}) {
    return {
      id: "m1",
      date: TODAY,
      page_number: 1,
      lineage_id: "L1",
      what_matters_now: "the summary's line",
      pin_count: 0,
      ...over,
    };
  }

  const LINEAGES = [
    { id: "L1", name: "the book", parent_id: null, mode: "discrete" },
    { id: "L2", name: "a job search", parent_id: null, mode: "discrete" },
    { id: "L3", name: "chapter three", parent_id: "L1", mode: "discrete" },
  ];

  async function openMemory(target) {
    target.querySelector('[data-tab-id="memory"]').click();
    flushSync();
    await settle();
    await settle();
  }

  const topEntry = (target) => target.querySelector('.shell-stack-entry[data-top="true"]');
  const depth = (target) => Number(target.querySelector(".shell-stack").dataset.depth);

  const topRowLabels = (target) =>
    [...topEntry(target).querySelectorAll(".shell-row-label")].map((n) => n.textContent.trim());

  const topRowFor = (target, label) =>
    [...topEntry(target).querySelectorAll(".shell-row")].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
    );

  function tapTopRow(target, label) {
    const row = topRowFor(target, label);
    expect(row, `no "${label}" row on the top screen`).toBeTruthy();
    row.click();
    flushSync();
  }

  const actionLabels = (target) =>
    [...topEntry(target).querySelectorAll(".shell-navbar-action")].map((b) =>
      b.textContent.trim(),
    );

  /** Memory's PAGE rows, in the content band and inside a group's body —
   *  the memory describe's `rowLabels`, for its reason: the trail map's
   *  trail header is an inert `Row` outside any group, and a reader of
   *  every row would count the trail's name as one of its pages. */
  const memoryRows = (target) =>
    [
      ...target.querySelectorAll(".shell-screen-content .shell-row-group-body .shell-row-label"),
    ].map((n) => n.textContent.trim());

  function tapAction(target, label) {
    const button = [...topEntry(target).querySelectorAll(".shell-navbar-action")].find(
      (b) => b.textContent.trim() === label,
    );
    expect(button, `no "${label}" action on the bar`).toBeTruthy();
    button.click();
    flushSync();
  }

  const sheetRowLabels = (target, tag) =>
    [...target.querySelectorAll(`[data-sheet="${tag}"] .shell-row-label`)].map((n) =>
      n.textContent.trim(),
    );

  function tapSheetRowIn(target, tag, label) {
    const row = [...target.querySelectorAll(`[data-sheet="${tag}"] .shell-row`)].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
    );
    expect(row, `no "${label}" row in the ${tag} sheet`).toBeTruthy();
    row.click();
    flushSync();
  }

  /** Tap the first page row in memory's timeline. */
  function tapPageRow(target, label) {
    const row = [...target.querySelectorAll(".shell-screen-content .shell-row")].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
    );
    expect(row, `no "${label}" page row`).toBeTruthy();
    row.click();
    flushSync();
  }

  // ── the reading view ─────────────────────────────────────────────────

  it("pushes a reading view when a page in memory is tapped", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getPage.mockResolvedValue(withLines(summary({ content_json: doc("kept going") })));
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    expect(depth(target)).toBe(1);

    tapPageRow(target, "the summary's line");
    await settle();

    expect(depth(target)).toBe(2);
    expect(topEntry(target).querySelector(".prose").textContent).toContain("kept going");
  });

  it("addresses the page it reads by id, never by the number that differs per device", async () => {
    // page-address.js's whole reason: page_number is minted per device and
    // renumbered on merge, so a lookup by it "could land the user on
    // someone else's page entirely" — observed on a real account.
    api.getThread.mockResolvedValue([summary({ id: "the-uuid", page_number: 4 })]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getPage.mockResolvedValue(withLines(summary({ id: "the-uuid" })));
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    tapPageRow(target, "the summary's line");
    await settle();

    expect(api.getPage).toHaveBeenCalledWith(TODAY, 4, "the-uuid");
  });

  it("says it is reading before it says the page did not open", async () => {
    // The push renders before the fetch resolves, which is exactly this
    // window — and a writer who tapped a row memory listed must not be
    // told for a frame that the page is gone.
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getPage.mockReturnValue(new Promise(() => {}));
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    tapPageRow(target, "the summary's line");

    expect(topEntry(target).querySelector(".empty-title").textContent.trim()).toBe(
      "reading the page",
    );
  });

  it("says the page did not open when the read fails", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getPage.mockRejectedValue(new Error("no"));
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    tapPageRow(target, "the summary's line");
    await settle();

    expect(topEntry(target).querySelector(".empty-title").textContent.trim()).toBe(
      "this page did not open",
    );
  });

  it("continues onto the page root with the row it FETCHED, not the row it was tapped from", async () => {
    // The whole reason the push fetches at all. `get_thread` returns
    // PageSummary (models.rs:157) — no `yjs_state` — and continue puts the
    // row on the writing surface, where PageScreen hands EditorCore
    // `initialYjsState={page.yjs_state ?? null}`. The two rows differ in
    // their focus line here because that is what the page header renders;
    // the column that actually matters is one jsdom cannot show.
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getPage.mockResolvedValue(
      withLines(summary({ what_matters_now: "the whole row", yjs_state: "bytes" })),
    );
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    tapPageRow(target, "the summary's line");
    await settle();
    expect(topRowLabels(target)).toEqual(["continue"]);

    tapTopRow(target, "continue");
    await settle();

    // Back on the page root, with the stack dropped behind it.
    expect(depth(target)).toBe(1);
    expect(target.querySelector('[data-tab-id="page"]').getAttribute("aria-current")).toBe("page");
    expect(focusLineText(target)).toBe("the whole row");
  });

  // The page root re-reads the page it already holds on the way back
  // (goRoot -> refreshLoadedPage), and continue does not wait for that: the
  // old page's read landed after continue's page and put the old page back
  // on the writing surface (sync journey J10.6 on the A16, 2026-10-24).
  it("keeps the continued page when the old page's re-read lands after it", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getPage.mockImplementation((date, n, id) => id === "p1"
      ? new Promise((r) => setTimeout(() => r(withLines(pageRow({ what_matters_now: "the page that was open" }))), 60))
      : Promise.resolve(withLines(summary({ what_matters_now: "the page continued" }))));
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    tapPageRow(target, "the summary's line");
    await settle();

    tapTopRow(target, "continue");
    await settle();
    await new Promise((r) => setTimeout(r, 120));
    await settle();

    expect(focusLineText(target)).toBe("the page continued");
  });

  it("offers a past page the day it can write on, and opens today there", async () => {
    // CLAUDE.md: "past pages are read-only… write today on PAGE".
    // `continue` on this page would land the writer on a canvas that
    // refuses every keystroke, on a pushed screen with no tab bar behind
    // it. reading-view.js's fork is what this drives end to end.
    api.getThread.mockResolvedValue([summary({ date: LONG_AGO })]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getPage.mockResolvedValue(withLines(summary({ date: LONG_AGO })));
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    tapPageRow(target, "the summary's line");
    await settle();
    // The sentence is a `Note` over the group, not a row in it; the one
    // row is the offer.
    expect(topEntry(target).querySelector(".shell-note").textContent.trim()).toBe(
      "this page is done. today is on the page.",
    );
    expect(topRowLabels(target)).toEqual(["write today"]);

    api.getOrCreateToday.mockClear();
    api.getOrCreateToday.mockResolvedValue(
      withLines(pageRow({ what_matters_now: "today's own line" })),
    );
    tapTopRow(target, "write today");
    await settle();

    // `getOrCreateToday` is the one call in the api that can MAKE a page,
    // which is what a phone left open across midnight needs.
    expect(api.getOrCreateToday).toHaveBeenCalled();
    expect(depth(target)).toBe(1);
    expect(focusLineText(target)).toBe("today's own line");
  });

  it("does not freeze a continuous trail's page, whatever day it started", async () => {
    // CLAUDE.md's trail-exception clause. The mode is the LINEAGE's and is
    // not a column on the page row, so this also proves the host resolved
    // it and published it WITH the page — a screen handed the page first
    // and the mode a round trip later renders the read-only rows for a
    // frame, on the one surface the exception exists to keep open.
    api.getThread.mockResolvedValue([summary({ date: LONG_AGO, lineage_id: "LC" })]);
    api.getLineages.mockResolvedValue([
      ...LINEAGES,
      { id: "LC", name: "the living doc", parent_id: null, mode: "continuous" },
    ]);
    api.getPage.mockResolvedValue(withLines(summary({ date: LONG_AGO, lineage_id: "LC" })));
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    tapPageRow(target, "the summary's line");
    await settle();

    expect(topRowLabels(target)).toEqual(["continue"]);
    // The trail's name is the provenance line's first word (the bar's
    // second line is empty since Task 7, and the chip went in the second
    // device pass), and it is the same lookup that carried the mode — so a
    // line opening with the name is the proof the lineage arrived.
    expect(topEntry(target).querySelector(".shell-provenance").textContent.trim()).toMatch(
      /^the living doc/,
    );
  });

  it("reads the trail it cannot find in memory's list rather than freezing the page", async () => {
    // The fallback, and it is not politeness: `pageReadonly` reads a null
    // mode as "not continuous", so a miss that answered null would freeze
    // a continuous trail's canonical. A missing NAME costs the provenance
    // line (it opens `untrailed`); a missing MODE costs the trail exception.
    api.getThread.mockResolvedValue([summary({ date: LONG_AGO, lineage_id: "LC" })]);
    // Memory's own read returns a list without LC in it.
    api.getLineages.mockResolvedValueOnce(LINEAGES);
    api.getPage.mockResolvedValue(withLines(summary({ date: LONG_AGO, lineage_id: "LC" })));
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    api.getLineages.mockResolvedValue([
      { id: "LC", name: "the living doc", parent_id: null, mode: "continuous" },
    ]);
    tapPageRow(target, "the summary's line");
    await settle();

    expect(topRowLabels(target)).toEqual(["continue"]);
  });

  it("empties the slot behind the reading view, as behind every pushed screen", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getPage.mockResolvedValue(withLines(summary()));
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    expect(target.querySelector(".shell-slot")).not.toBeNull();

    tapPageRow(target, "the summary's line");
    await settle();

    expect(target.querySelector(".shell-slot")).toBeNull();
  });

  it("pops back to memory and leaves the list as it was", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getPage.mockResolvedValue(withLines(summary()));
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    tapPageRow(target, "the summary's line");
    await settle();
    topEntry(target).querySelector(".shell-navbar-back").click();
    flushSync();

    expect(depth(target)).toBe(1);
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("memory");
  });

  // ── the trail scope sheet ───────────────────────────────────────────
  //
  // A sheet since the fifth device pass: "the memory page trail selection
  // is ugly, it takes us to another page; I think we need a similar popup
  // to filters". What it lists is trail-index.js's (its own suite); these
  // hold that the sheet renders it, that a pick scopes the list behind it
  // and closes, and that the screen it replaced is gone.

  const sheetRowsIn = (target, tag) =>
    [...target.querySelectorAll(`[data-sheet="${tag}"] .shell-row-label`)].map((n) =>
      n.textContent.trim(),
    );

  function pickSegment(target, label) {
    const button = [...target.querySelectorAll(".shell-screen-content .seg-btn")].find(
      (b) => b.textContent.trim() === label,
    );
    expect(button, `no "${label}" segment`).toBeTruthy();
    button.click();
    flushSync();
  }

  const memoryPinRows = (target) =>
    [...target.querySelectorAll(".memory-pin .shell-row-label")].map((n) =>
      n.textContent.trim(),
    );

  /** This describe's own, for the reason every describe here has one: the
   *  helpers are scoped to the block that uses them. */
  function tapSheetRow(target, tag, label) {
    const row = [...target.querySelectorAll(`[data-sheet="${tag}"] .shell-row`)].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
    );
    expect(row, `no "${label}" row in the ${tag} sheet`).toBeTruthy();
    row.click();
    flushSync();
  }

  it("opens the trail scope in a sheet, over the list it scopes", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    expect(actionLabels(target)).toEqual(["filters", "trails"]);

    tapAction(target, "trails");

    // A sheet, not a push: the list stays on screen behind it.
    expect(depth(target)).toBe(1);
    expect(target.querySelector('[data-sheet="trail-scope"]')).not.toBeNull();
    expect(sheetRowsIn(target, "trail-scope")).toEqual([
      "all trails",
      "untrailed",
      "a job search",
      "the book",
      "chapter three",
    ]);
  });

  it("asks for nothing when it opens — memory read the trails on the way in", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    api.getLineages.mockClear();
    api.getThread.mockClear();

    tapAction(target, "trails");
    await settle();

    expect(api.getLineages).not.toHaveBeenCalled();
    expect(api.getThread).not.toHaveBeenCalled();
  });

  it("marks the scope that is on, and offers it no tap", async () => {
    // The sheet saying what the bar's label says. Inert, like the row you
    // are looking at in the date and pages sheets.
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    tapAction(target, "trails");
    const rows = [...target.querySelectorAll('[data-sheet="trail-scope"] .shell-row')];
    const all = rows.find((r) => r.textContent.includes("all trails"));
    expect(all.tagName).toBe("DIV");
    expect(all.textContent).toContain("showing");
  });

  it("finds a trail in the scope sheet, keeping its parent, with each trail's own pages and pins", async () => {
    // 0.8.2 (spec §4): the sheet had no search and no counts. The counts
    // are two read-only queries, not a tally of memory's capped list.
    api.getThread.mockResolvedValue([summary({ lineage_id: null })]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getTrailPageCounts.mockResolvedValue([["L1", 6], ["L3", 2]]);
    api.getTrailPinCounts.mockResolvedValue([["L1", 4], [null, 1]]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    tapAction(target, "trails");
    await settle();

    const value = (label) =>
      [...target.querySelectorAll('[data-sheet="trail-scope"] .shell-row')]
        .find((r) => r.querySelector(".shell-row-label").textContent.trim() === label)
        .querySelector(".shell-row-value").textContent.trim();
    expect(value("the book")).toBe("6 pages · 4 pins");
    expect(value("chapter three")).toBe("2 pages · 0 pins");
    // The one untrailed page memory read, and the one pin on no trail.
    expect(value("untrailed")).toBe("1 page · 1 pin");

    const field = target.querySelector('[data-sheet="trail-scope"] .shell-field-input');
    expect(field.placeholder).toBe("find a trail…");
    field.value = "chapter";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(sheetRowsIn(target, "trail-scope")).toEqual([
      "all trails",
      "untrailed",
      "the book",
      "chapter three",
    ]);

    field.value = "zebra";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(target.querySelector('[data-sheet="trail-scope"] .shell-note').textContent.trim()).toBe(
      "no trail is named like that.",
    );
  });

  it("names the scoped trail with a pill, and the pill takes the scope off", async () => {
    api.getThread.mockResolvedValue([
      summary({ id: "a", lineage_id: "L1", what_matters_now: "the book itself" }),
      summary({ id: "c", lineage_id: "L2", what_matters_now: "the cover letter" }),
    ]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    tapAction(target, "trails");
    tapSheetRow(target, "trail-scope", "a job search");
    await settle();

    const pill = target.querySelector(".memory-pill button");
    expect(pill.getAttribute("aria-label")).toBe("remove a job search");
    pill.click();
    flushSync();
    await settle();
    expect(target.querySelector(".memory-pill")).toBeNull();
    expect(actionLabels(target)).toEqual(["filters", "trails"]);
  });

  it("scopes memory to the trail that was picked, and closes", async () => {
    api.getThread.mockResolvedValue([
      summary({ id: "a", lineage_id: "L1", what_matters_now: "the book itself" }),
      summary({ id: "c", lineage_id: "L2", what_matters_now: "the cover letter" }),
    ]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    tapAction(target, "trails");
    tapSheetRow(target, "trail-scope", "a job search");

    // Closed in the same gesture — one decision, and its result is the
    // screen underneath.
    expect(target.querySelector('[data-sheet="trail-scope"]')).toBeNull();
    expect(memoryRows(target)).toEqual(["the cover letter"]);
  });

  it("says which trail is on, on the bar that opens the sheet", async () => {
    // The action IS the scope, which is what makes a scope that outlives
    // the sheet safe to keep.
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    tapAction(target, "trails");
    tapSheetRow(target, "trail-scope", "the book");

    expect(actionLabels(target)).toEqual(["filters", "the book"]);
  });

  it("takes the scope off again from the same sheet", async () => {
    api.getThread.mockResolvedValue([
      summary({ id: "a", lineage_id: "L1", what_matters_now: "the book itself" }),
      summary({ id: "c", lineage_id: "L2", what_matters_now: "the cover letter" }),
    ]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    tapAction(target, "trails");
    tapSheetRow(target, "trail-scope", "the book");
    expect(actionLabels(target)).toEqual(["filters", "the book"]);

    tapAction(target, "the book");
    tapSheetRow(target, "trail-scope", "all trails");

    expect(actionLabels(target)).toEqual(["filters", "trails"]);
    expect(memoryRows(target).sort()).toEqual(["the book itself", "the cover letter"]);
  });

  it("keeps the scope across leaving memory and coming back", async () => {
    api.getThread.mockResolvedValue([
      summary({ id: "a", lineage_id: "L1", what_matters_now: "the book itself" }),
      summary({ id: "c", lineage_id: "L2", what_matters_now: "the cover letter" }),
    ]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    tapAction(target, "trails");
    tapSheetRow(target, "trail-scope", "a job search");
    await settle();

    // Awaited rather than flushed: the page root re-reads its row before
    // rebuilding the canvas (goRoot), so this switch is asynchronous now.
    target.querySelector('[data-tab-id="page"]').click();
    await settle();
    await openMemory(target);

    expect(actionLabels(target)).toEqual(["filters", "a job search"]);
    expect(memoryRows(target)).toEqual(["the cover letter"]);
  });

  it("says what hid the list when the scope is what hid it", async () => {
    api.getThread.mockResolvedValue([
      summary({ id: "a", lineage_id: "L2", what_matters_now: "the cover letter" }),
    ]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    tapAction(target, "trails");
    tapSheetRow(target, "trail-scope", "the book");
    await settle();

    expect(target.querySelector(".empty-title").textContent.trim()).toBe("nothing matches");
    expect(target.querySelector(".empty-body").textContent.trim()).toBe("the book");
  });

  it("opens a pin's screen from memory, not only from the pins screen", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getPins.mockResolvedValue([
      { id: "pin-a", object_type: "note", title: "kept on the book", lineage_id: "L1", source_page_date: TODAY },
    ]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    pickSegment(target, "pins");
    target.querySelector(".memory-pin .shell-row").click();
    flushSync();
    await settle();

    expect(depth(target)).toBe(2);
    const labels = [...target.querySelector('.shell-stack-entry[data-top="true"]').querySelectorAll(".shell-row-label")]
      .map((n) => n.textContent.trim());
    expect(labels).toContain("unpin");
  });

  it("reads a pin from memory, on the same screen", async () => {
    // The second call site, and it needs no wiring of its own:
    // MemoryScreen's pin row and PinsScreen's both hand their pin to
    // `openPinArtifact`. This is the assertion that would go red if either
    // list ever grew its own pin handler — the shape `patchPin` already
    // exists because of, one surface over.
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getPins.mockResolvedValue([
      {
        id: "pin-a",
        object_type: "board",
        title: "kept on the book",
        lineage_id: "L1",
        source_page_id: "page-1",
        source_page_date: TODAY,
        content: JSON.stringify({
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "not time, scope" }] }],
        }),
      },
    ]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    pickSegment(target, "pins");
    target.querySelector(".memory-pin .shell-row").click();
    flushSync();
    await settle();

    const top = target.querySelector('.shell-stack-entry[data-top="true"]');
    expect(top.querySelector(".prose").textContent).toContain("not time, scope");
  });

  it("drops an unpinned row from memory's list, not only from the pins screen's", async () => {
    // The second list patchPin and unpin gained in this task. Both arrays
    // can hold the same pin — the page's pins screen reads one trail, and
    // memory fans out across every trail — so a drop that touched only the
    // list the sheet was opened from would leave memory showing a row
    // whose every action now fails against a deleted database row.
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getPins.mockResolvedValue([
      { id: "pin-a", object_type: "note", title: "kept on the book", lineage_id: "L1", source_page_date: TODAY },
    ]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    pickSegment(target, "pins");
    expect(memoryPinRows(target)).toEqual(["kept on the book"]);

    target.querySelector(".memory-pin .shell-row").click();
    flushSync();
    await settle();
    const unpinRow = [...target.querySelector('.shell-stack-entry[data-top="true"]').querySelectorAll(".shell-row")]
      .find((r) => r.querySelector(".shell-row-label").textContent.trim() === "unpin");
    unpinRow.click();
    flushSync();
    await settle();

    expect(api.deletePin).toHaveBeenCalledWith("pin-a");
    expect(memoryPinRows(target)).toEqual([]);
  });

  it("closes the scope sheet on platform back without changing the scope", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    tapAction(target, "trails");
    expect(target.querySelector('[data-sheet="trail-scope"]')).not.toBeNull();

    window.history.back();
    flushSync();

    expect(target.querySelector('[data-sheet="trail-scope"]')).toBeNull();
    // Backing out is not a choice — leaving the sheet without picking
    // must not clear a scope the writer set a moment ago.
    expect(actionLabels(target)).toEqual(["filters", "trails"]);
  });

  // ── managing a trail, from memory (task 9e) ──────────────────────────
  //
  // The trails sheet scopes on a tap, as before; the row memory is
  // already showing opens that trail's screen (trail-manage.js's
  // `scopeRowAction`). There: the name, `move under…` and `delete trail`,
  // through the laptop's own commands.

  async function openTrailScreen(target, name) {
    tapAction(target, "trails");
    tapSheetRow(target, "trail-scope", name);
    await settle();
    tapAction(target, name);
    tapSheetRow(target, "trail-scope", name);
    await settle();
  }

  const renameField = (target) => topEntry(target).querySelector('input[aria-label="rename"]');

  function typeName(target, text) {
    const input = renameField(target);
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
  }

  it("opens a trail's screen from the row memory is already showing", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);

    tapAction(target, "trails");
    tapSheetRow(target, "trail-scope", "the book");
    await settle();
    // Still one tap to scope: the first pick did not push anything.
    expect(depth(target)).toBe(1);

    tapAction(target, "the book");
    const showing = [...target.querySelectorAll('[data-sheet="trail-scope"] .shell-row')].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === "the book",
    );
    expect(showing.tagName).toBe("BUTTON");
    expect(showing.dataset.kind).toBe("push");
    showing.click();
    flushSync();
    await settle();

    expect(depth(target)).toBe(2);
    expect(target.querySelector('[data-sheet="trail-scope"]')).toBeNull();
    expect(topEntry(target).querySelector(".shell-navbar-title").textContent.trim()).toBe("trail");
    expect(renameField(target).value).toBe("the book");
    expect(topRowLabels(target)).toEqual(["move under…", "delete trail"]);
  });

  it("renames the trail when the name commits, and memory says the new name", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    await openTrailScreen(target, "the book");

    typeName(target, "the novel");
    renameField(target).dispatchEvent(new FocusEvent("blur"));
    await settle();

    expect(api.renameLineage).toHaveBeenCalledTimes(1);
    expect(api.renameLineage).toHaveBeenCalledWith("L1", "the novel");

    topEntry(target).querySelector(".shell-navbar-back").click();
    flushSync();
    await settle();
    // One write: the pop found the name already saved.
    expect(api.renameLineage).toHaveBeenCalledTimes(1);
    expect(actionLabels(target)).toEqual(["filters", "the novel"]);
  });

  it("saves a name still in the field when the screen is left", async () => {
    // A field removed while focused fires no blur; the pop writes the draft.
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    await openTrailScreen(target, "the book");

    typeName(target, "the novel");
    topEntry(target).querySelector(".shell-navbar-back").click();
    flushSync();
    await settle();

    expect(api.renameLineage).toHaveBeenCalledWith("L1", "the novel");
  });

  it("says why a rename did not land, in the laptop's words", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.renameLineage.mockRejectedValueOnce(new Error("lineage_not_found"));
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    await openTrailScreen(target, "the book");

    typeName(target, "the novel");
    renameField(target).dispatchEvent(new FocusEvent("blur"));
    await settle();

    expect(topEntry(target).textContent).toContain("trail no longer exists");
  });

  it("offers every trail but itself and those under it, and moves it under the one picked", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    await openTrailScreen(target, "the book");

    tapTopRow(target, "move under…");
    // `chapter three` is under the book; the book itself is the trail.
    expect(sheetRowsIn(target, "trail-move")).toEqual(["top level", "a job search"]);

    tapSheetRow(target, "trail-move", "a job search");
    await settle();

    expect(api.setLineageParent).toHaveBeenCalledWith("L1", "L2");
    expect(target.querySelector('[data-sheet="trail-move"]')).toBeNull();
    const move = topRowFor(target, "move under…");
    expect(move.querySelector(".shell-row-value").textContent.trim()).toBe("a job search");
  });

  it("moves a trail back to the top level", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    await openTrailScreen(target, "chapter three");

    tapTopRow(target, "move under…");
    expect(sheetRowsIn(target, "trail-move")).toEqual(["top level", "a job search", "the book"]);
    tapSheetRow(target, "trail-move", "top level");
    await settle();

    expect(api.setLineageParent).toHaveBeenCalledWith("L3", null);
  });

  it("reaches delete from the page's own trail sheet, without memory", async () => {
    // The owner looked for "delete trail" in the page's trail sheet
    // (2026-10-28); it was only reachable from memory, by tapping a scoped
    // row a second time. Memory is never opened here, on purpose: the
    // trail screen must not depend on memory's list having been loaded.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1" })));
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();

    target.querySelector(".ph-trail-button").click();
    flushSync();
    await settle();
    tapSheetRowIn(target, "trail", "manage “the book”");
    await settle();

    expect(depth(target)).toBe(2);
    tapTopRow(target, "delete trail");
    tapSheetRowIn(target, "trail-delete", "delete “the book”");
    await settle();

    expect(api.deleteLineage).toHaveBeenCalledWith("L1", null);
    // The page it was open on lost the trail, as an unlinked page does.
    expect(target.querySelector(".ph-trail")).toBeNull();
  });

  it("asks before it deletes, then deletes the way the laptop does", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    await openTrailScreen(target, "the book");

    tapTopRow(target, "delete trail");
    // The row asks; it does not delete.
    expect(api.deleteLineage).not.toHaveBeenCalled();
    const sheet = target.querySelector('[data-sheet="trail-delete"]');
    expect(sheet).not.toBeNull();
    expect(sheet.textContent).toContain("its pages stay in memory");
    expect(sheetRowsIn(target, "trail-delete")).toEqual(["delete “the book”"]);

    api.getLineages.mockResolvedValue(LINEAGES.filter((l) => l.id !== "L1"));
    tapSheetRow(target, "trail-delete", "delete “the book”");
    await settle();

    // No target: pages lose the trail, the trails inside move up — the
    // laptop's default, "unlink pages".
    expect(api.deleteLineage).toHaveBeenCalledWith("L1", null);
    expect(depth(target)).toBe(1);
    // The scope was the trail that is gone, so it comes off.
    expect(actionLabels(target)).toEqual(["filters", "trails"]);
  });

  it("deletes nothing when the confirmation is dismissed", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    await openTrailScreen(target, "the book");

    tapTopRow(target, "delete trail");
    window.history.back();
    flushSync();
    await settle();

    expect(target.querySelector('[data-sheet="trail-delete"]')).toBeNull();
    expect(api.deleteLineage).not.toHaveBeenCalled();
    expect(depth(target)).toBe(2);
  });

  // ── a pin's trail, from the pin's screen (task 9e) ──────────────────

  async function openMemoryPin(target) {
    pickSegment(target, "pins");
    target.querySelector(".memory-pin .shell-row").click();
    flushSync();
    await settle();
  }

  it("shows a pin's trail on its screen and moves it to the trail picked", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getPins.mockResolvedValue([
      { id: "pin-a", object_type: "note", title: "kept on the book", lineage_id: "L1", source_page_date: TODAY },
    ]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    await openMemoryPin(target);

    const row = topRowFor(target, "trail");
    expect(row.querySelector(".shell-row-value").textContent.trim()).toBe("the book");
    tapTopRow(target, "trail");
    await settle();
    expect(sheetRowsIn(target, "pin-trail")).toEqual([
      "no trail",
      "a job search",
      "the book",
      "chapter three",
    ]);

    tapSheetRow(target, "pin-trail", "a job search");
    await settle();

    expect(api.updatePinScope).toHaveBeenCalledWith("pin-a", "L2");
    expect(target.querySelector('[data-sheet="pin-trail"]')).toBeNull();
    expect(topRowFor(target, "trail").querySelector(".shell-row-value").textContent.trim()).toBe(
      "a job search",
    );
  });

  it("takes a pin off every trail with no trail", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getPins.mockResolvedValue([
      { id: "pin-a", object_type: "note", title: "kept on the book", lineage_id: "L1", source_page_date: TODAY },
    ]);
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    await openMemoryPin(target);

    tapTopRow(target, "trail");
    await settle();
    tapSheetRow(target, "pin-trail", "no trail");
    await settle();

    expect(api.updatePinScope).toHaveBeenCalledWith("pin-a", null);
    expect(topRowFor(target, "trail").querySelector(".shell-row-value").textContent.trim()).toBe(
      "no trail",
    );
    // No trail, no carry: the query that reads the flag would ignore it.
    expect(topRowLabels(target)).not.toContain("carry forward");
  });

  it("leaves the pin's trail as it was when the write fails", async () => {
    api.getThread.mockResolvedValue([summary()]);
    api.getLineages.mockResolvedValue(LINEAGES);
    api.getPins.mockResolvedValue([
      { id: "pin-a", object_type: "note", title: "kept on the book", lineage_id: "L1", source_page_date: TODAY },
    ]);
    api.updatePinScope.mockRejectedValueOnce(new Error("boom"));
    const { target } = render(ShellApp, {});
    await settle();
    await openMemory(target);
    await openMemoryPin(target);

    tapTopRow(target, "trail");
    await settle();
    tapSheetRow(target, "pin-trail", "a job search");
    await settle();

    expect(topRowFor(target, "trail").querySelector(".shell-row-value").textContent.trim()).toBe(
      "the book",
    );
  });
});

describe("ShellApp — settings, and the sections it pushes", () => {
  let historyStates;
  let navTeardown;

  beforeEach(async () => {
    // The stack describes' own preamble, for their reason: a describe that
    // ends with a surface open rewinds the REAL history in its teardown,
    // and jsdom delivers that popstate late.
    await new Promise((r) => setTimeout(r, 0));
    _resetForTests();
    historyStates = [];
    vi.spyOn(window.history, "pushState").mockImplementation((state) => {
      historyStates.push(state);
    });
    vi.spyOn(window.history, "back").mockImplementation(() => {
      historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    vi.spyOn(window.history, "go").mockImplementation((n) => {
      for (let i = 0; i < -n; i++) historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    navTeardown = initNavStack();
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
  });

  afterEach(() => {
    cleanupAll();
    navTeardown();
    vi.restoreAllMocks();
  });

  // EVERY READ IS SCOPED TO THE TOP ENTRY, and that is not tidiness: Stack
  // keeps the screen BENEATH the top one mounted so a back drag reveals a
  // real screen rather than a hole, so an unscoped querySelector for a nav
  // title answers with the ROOT's while a section is pushed. The trails
  // describe above scopes for the same reason.
  const topEntry = (target) => target.querySelector('.shell-stack-entry[data-top="true"]');
  const depth = (target) => Number(target.querySelector(".shell-stack").dataset.depth);

  const topRowLabels = (target) =>
    [...topEntry(target).querySelectorAll(".shell-row-label")].map((n) => n.textContent.trim());

  const topRowFor = (target, label) =>
    [...topEntry(target).querySelectorAll(".shell-row")].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
    );

  const valueOf = (target, label) =>
    topRowFor(target, label)?.querySelector(".shell-row-value")?.textContent.trim() ?? "";

  const title = (target) =>
    topEntry(target).querySelector(".shell-navbar-title").textContent.trim();

  async function openSettings(target) {
    target.querySelector('[data-tab-id="settings"]').click();
    flushSync();
    await settle();
  }

  async function openSection(target, label) {
    const row = topRowFor(target, label);
    expect(row, `no "${label}" row on the settings root`).toBeTruthy();
    row.click();
    flushSync();
    await settle();
  }

  it("renders a real root, not the stub", async () => {
    // The stub said "settings: not built yet" for four phases, and
    // ShellApp's own header said so in as many words. Naming the string is
    // what makes this go red if the fallback branch is ever reordered back
    // above the real screen.
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);

    expect(target.textContent).not.toContain("not built yet");
    expect(title(target)).toBe("settings");
    expect(topRowLabels(target)).toEqual(["tone", "font", "data", "lock", "sync", "labs", "about"]);
  });

  it("keeps the tab bar in the slot at the settings root", async () => {
    // toolbarFor's row 2: any non-page root gets the tab bar, because every
    // strip below that row is the EDITOR's. Settings has no editor at all,
    // so the way out is the only thing the slot can honestly hold.
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);

    expect(target.querySelector(".shell-tabbar")).not.toBeNull();
    expect(target.querySelector('.shell-tabbar [aria-current="page"]').dataset.tabId).toBe(
      "settings",
    );
  });

  it("pushes a section onto P3's stack and empties the slot behind it", async () => {
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    expect(depth(target)).toBe(1);

    await openSection(target, "font");

    expect(depth(target)).toBe(2);
    expect(title(target)).toBe("font");
    expect(topRowLabels(target)).toEqual(["lora", "inter", "mono", "system"]);
    // toolbarFor's row 1, which outranks everything: a pushed screen owns
    // the bottom of the display outright, and the frame stops RESERVING the
    // band rather than reserving an empty one.
    expect(target.querySelector(".shell-tabbar")).toBeNull();
    expect(target.querySelector(".shell-slot")).toBeNull();
  });

  it("opens the data section with its export row", async () => {
    // A browser profiles as web, which cannot share a zip, so the row shows
    // with the laptop note under it (platform.js exportZip). J10.2's check
    // looks for this row on the phone.
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await openSection(target, "data");
    expect(title(target)).toBe("data");
    expect(topRowLabels(target)).toEqual(["export"]);
    expect(topEntry(target).textContent).toContain("export works from the laptop for now.");
  });

  it("comes back the way every pushed screen does", async () => {
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await openSection(target, "labs");
    expect(depth(target)).toBe(2);

    topEntry(target).querySelector(".shell-navbar-back").click();
    flushSync();

    expect(depth(target)).toBe(1);
    expect(title(target)).toBe("settings");
    expect(target.querySelector(".shell-tabbar")).not.toBeNull();
  });

  it("pops a section on platform back", async () => {
    // Stack registers a navstack entry per pushed element, so the Android
    // system button and the browser's own back reach a settings section
    // without this file wiring anything of its own.
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await openSection(target, "about");
    expect(depth(target)).toBe(2);

    window.history.back();
    flushSync();

    expect(depth(target)).toBe(1);
    expect(title(target)).toBe("settings");
  });

  it("shows the section that was opened LAST, not the one opened first", async () => {
    // The one hazard in holding the pushed section in a single variable.
    // It is safe only while one section is pushed at a time, and this is
    // what says so: open, pop, open another. A stale `settingsSectionId`
    // would render tone's rows under font's title, which is exactly the
    // failure Stack's keyed {#each} exists to prevent for scroll offsets.
    const { target } = render(ShellApp, { tone: "cream" });
    await settle();
    await openSettings(target);

    await openSection(target, "tone");
    expect(topRowLabels(target)).toEqual(["cream", "white", "dark", "system"]);

    topEntry(target).querySelector(".shell-navbar-back").click();
    flushSync();
    await openSection(target, "labs");

    expect(title(target)).toBe("labs");
    expect(topRowLabels(target)).toEqual(["yjs for continuous trails", "new phone layout"]);
  });

  it("says what the tone is set to before the section is opened", async () => {
    const { target } = render(ShellApp, { tone: "dark", fontFamily: "dm-mono" });
    await settle();
    await openSettings(target);

    expect(valueOf(target, "tone")).toBe("dark");
    // The LABEL of the stored id: `dm-mono` is what the setting holds and
    // "mono" is what every screen calls it.
    expect(valueOf(target, "font")).toBe("mono");
  });

  it("marks the tone in use inside the section", async () => {
    const { target } = render(ShellApp, { tone: "dark" });
    await settle();
    await openSettings(target);
    await openSection(target, "tone");

    expect(valueOf(target, "dark")).toBe(CHOSEN);
    expect(valueOf(target, "cream")).toBe("");
  });

  it("reports a tone upward AND persists it — the two are not alternatives", async () => {
    // `data-tone` has one owner, App.svelte, which also resolves `system`
    // and holds the matchMedia listener that re-applies it; the shell
    // reports the choice there rather than writing the attribute. setSetting
    // is the other half: without it the tone repaints now and reverts on the
    // next launch, and a settings screen that forgets is worse than one that
    // never offered the choice.
    const onTone = vi.fn();
    const { target } = render(ShellApp, { tone: "cream", onTone });
    await settle();
    await openSettings(target);
    await openSection(target, "tone");

    topRowFor(target, "dark").click();
    await settle();

    expect(onTone).toHaveBeenCalledExactlyOnceWith("dark");
    expect(api.setSetting).toHaveBeenCalledWith("canvas_tone", "dark");
  });

  it("does not try to save a page it has just deleted", async () => {
    // MEASURED ON AN A16: deleting the page you are looking at logged
    // `Failed to flush save before page switch: Query returned no rows`.
    // The host deletes the row and then adopts the neighbour; the adopt is
    // a page switch, and the editor flushes the page it is leaving — which
    // by then does not exist. Nothing is lost, and an app that logs an
    // error during an ordinary gesture is an app whose log stops being
    // worth reading. The device harness fails a run on a thrown exception
    // for exactly that reason.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ id: "P1" })));
    api.getFocusesForDate.mockResolvedValue([
      { id: "P1", page_number: 1, what_matters_now: "the first" },
      { id: "P2", page_number: 2, what_matters_now: "the second" },
    ]);
    api.getAdjacentPage.mockResolvedValue({ page: pageRow({ id: "P2" }) });
    const { target } = render(ShellApp, {});
    await settle();

    target.querySelector(".ph-dots")?.click();
    flushSync();
    await settle();
    const row = [...target.querySelectorAll('[data-sheet="pages"] .shell-row')]
      .find((r) => (r.textContent || "").startsWith("delete "));
    expect(row, "the pages sheet offers a delete row").toBeTruthy();
    api.savePageContent.mockClear();
    row.click();
    await settle();
    // The first tap arms the row (pageSheetRows); the second deletes.
    [...target.querySelectorAll('[data-sheet="pages"] .shell-row')]
      .find((r) => (r.textContent || "").startsWith("tap again to delete "))?.click();
    await settle();

    expect(api.deleteFocus).toHaveBeenCalledWith("P1");
    // The page that was removed is never written to afterwards.
    const wroteDeleted = api.savePageContent.mock.calls.some(([id]) => id === "P1");
    expect(wroteDeleted, "no save was sent for the deleted page").toBe(false);
  });

  it("comes back from the section once the choice is made", async () => {
    // MEASURED ON THE A16, and it is the contract this screen writes down
    // in two places: row-kind.js calls a choice row "selects and pops", and
    // SettingsSectionScreen withholds the chevron BECAUSE of that promise —
    // a chevron means a tap opens a screen, and a tone option opens none.
    // The host never popped, so the section stayed under the writer's thumb
    // after they had chosen.
    //
    // What that costs is not only a stray back-press. The device run tapped
    // where the settings ROOT's first row had been, a moment after choosing
    // `dark`, and hit the still-open section's first row instead: the tone
    // went back to cream and the database went with it. Any second tap near
    // the top of that screen is a different setting than the writer thinks
    // they are touching.
    const { target } = render(ShellApp, { tone: "cream", onTone: () => {} });
    await settle();
    await openSettings(target);
    await openSection(target, "tone");
    const deep = depth(target);

    topRowFor(target, "dark").click();
    await settle();

    expect(depth(target)).toBe(deep - 1);
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("settings");
  });

  it("persists a font by its stored id, not by the word on the row", async () => {
    const onFontFamily = vi.fn();
    const { target } = render(ShellApp, { fontFamily: "lora", onFontFamily });
    await settle();
    await openSettings(target);
    await openSection(target, "font");

    topRowFor(target, "mono").click();
    await settle();

    expect(onFontFamily).toHaveBeenCalledExactlyOnceWith("dm-mono");
    expect(api.setSetting).toHaveBeenCalledWith("canvas_font_family", "dm-mono");
  });

  it("writes the labs flag through the module that owns its cache", async () => {
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await openSection(target, "labs");

    const row = () => topRowFor(target, "yjs for continuous trails").querySelector("input");
    expect(row().checked).toBe(true);
    row().click();
    await settle();

    expect(yjs.setYjsEnabled).toHaveBeenCalledExactlyOnceWith(false);
    // Never the key directly: feature-flag.js caches the answer for the
    // whole session, so a setSetting behind its back would leave the editor
    // reading the old flag until the app restarts.
    expect(api.setSetting).not.toHaveBeenCalledWith("enable_yjs", expect.anything());
    expect(row().checked).toBe(false);
  });

  it("opens the escape hatch — turning the layout switch off writes the string boot reads", async () => {
    // THE POINT OF THE CONTROL. Before it, `try_new_shell` was written by
    // nothing in the app: the demo bootstrap, the VR seed and the VR
    // scenes were the only writers in the tree, so a tester whose shell
    // broke could leave only by editing SQLite. This is the path from a
    // thumb to that row, end to end.
    //
    // The VALUE is what shell-switch.test.js holds against
    // `shouldBootShell`; what this adds is that the key and the value
    // travel together from this switch, through the host's toggle table,
    // to setSetting.
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await openSection(target, "labs");

    const box = () => topRowFor(target, "new phone layout").querySelector("input");
    expect(box().checked).toBe(true);
    box().click();
    await settle();

    expect(api.setSetting).toHaveBeenCalledWith("try_new_shell", "false");
    expect(box().checked).toBe(false);
  });

  it("says when the layout changes, because the write changes nothing on screen", async () => {
    // The switch is read once, at App.svelte's boot, so throwing it leaves
    // the reader inside the tree they just asked to leave. A control that
    // appears to have done nothing is the defect this note exists to
    // avoid, and the note is the only feedback available here — the toast
    // band belongs to the page root, and a message fired from a pushed
    // section renders behind it.
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await openSection(target, "labs");
    expect(topEntry(target).querySelector(".shell-note")).toBeNull();

    topRowFor(target, "new phone layout").querySelector("input").click();
    await settle();

    expect(topEntry(target).querySelector(".shell-note").textContent.trim()).toBe(
      SHELL_OFF_NOTE,
    );
    // Still in the shell: nothing reloads and nothing swaps trees, which
    // is what leaves the switch under the reader's thumb.
    expect(title(target)).toBe("labs");
  });

  it("cancels the exit if the switch goes back on, which is the only undo there is", async () => {
    // Opting back IN is not built on the desktop tree — Settings.svelte is
    // a desktop component the shell branch may not touch — so once the app
    // reopens, this choice is one-way. That makes the undo before the next
    // launch load-bearing rather than a nicety, and it works only if the
    // second write is a value `shouldBootShell` enumerates as on.
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await openSection(target, "labs");

    const box = () => topRowFor(target, "new phone layout").querySelector("input");
    box().click();
    await settle();
    box().click();
    await settle();

    expect(api.setSetting).toHaveBeenLastCalledWith("try_new_shell", "true");
    expect(box().checked).toBe(true);
    expect(topEntry(target).querySelector(".shell-note")).toBeNull();
  });

  it("reads the switch back from the database rather than assuming it is on", async () => {
    // A reader who opted out, went off to write, and came back has to find
    // the switch still off — and the value is a string in SQLite, which
    // only a read can report. Assuming "the shell is rendering, so it is
    // on" is true at boot and stops being true the moment this row is used.
    api.getSetting.mockImplementation((key) =>
      Promise.resolve(key === "try_new_shell" ? "false" : null),
    );
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await openSection(target, "labs");

    expect(topRowFor(target, "new phone layout").querySelector("input").checked).toBe(false);
    expect(topEntry(target).querySelector(".shell-note")).not.toBeNull();
  });

  it("keeps the switch on when the read throws, because the shell is on screen", async () => {
    // The read is the same shape as the labs flag's: a rejection is logged
    // and swallowed, leaving `shellEnabled` at its initial `true`. That is
    // the honest answer rather than a fallback — this component only mounts
    // under `bootShell`, so the flag booting the shell is a precondition of
    // the row existing at all, and showing it OFF would be the row lying
    // about the tree it is being drawn in.
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.getSetting.mockRejectedValue(new Error("no database"));
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await openSection(target, "labs");

    expect(topRowFor(target, "new phone layout").querySelector("input").checked).toBe(true);
  });

  it("re-reads the labs flag on every arrival at the root", async () => {
    // goRoot is the only door, as it is for memory and for memory's reason:
    // the desktop writes the same key and feature-flag.js caches it
    // module-wide, so a root that read once would drift from what the
    // editor is actually doing.
    const { target } = render(ShellApp, {});
    await settle();
    yjs.isYjsEnabled.mockClear();

    await openSettings(target);
    expect(yjs.isYjsEnabled).toHaveBeenCalledTimes(1);

    target.querySelector('[data-tab-id="page"]').click();
    flushSync();
    await settle();
    await openSettings(target);

    expect(yjs.isYjsEnabled).toHaveBeenCalledTimes(2);
  });

  it("shows the build on the about section rather than on the root row", async () => {
    // Under vitest neither define is set — vitest.config.js is a separate
    // config that sets no `define` — so both fall to their typeof guards,
    // and the guards are what this asserts. A real version number here
    // would make the test a chore at every release.
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    expect(valueOf(target, "about")).toBe("");

    await openSection(target, "about");
    expect(valueOf(target, "version")).toBe("vdev · dev");
  });
});

describe("ShellApp — the sync stack, and the camera at the end of it", () => {
  let historyStates;
  let navTeardown;

  beforeEach(async () => {
    // The stack describes' own preamble, for their reason: a describe that
    // ends with a surface open rewinds the REAL history in its teardown,
    // and jsdom delivers that popstate late.
    await new Promise((r) => setTimeout(r, 0));
    _resetForTests();
    historyStates = [];
    vi.spyOn(window.history, "pushState").mockImplementation((state) => {
      historyStates.push(state);
    });
    vi.spyOn(window.history, "back").mockImplementation(() => {
      historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    vi.spyOn(window.history, "go").mockImplementation((n) => {
      for (let i = 0; i < -n; i++) historyStates.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
    });
    navTeardown = initNavStack();
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow()));
    // The sync mocks are reset by hand, and that is not belt-and-braces:
    // `vi.restoreAllMocks` restores SPIES, and these are `vi.fn()`s
    // declared once for the whole file — an implementation one test sets
    // survives into the next. Without this, the test below that proves an
    // unconfigured install asks for no device list inherits the previous
    // test's configured status and goes green on the wrong branch.
    api.syncStatus.mockResolvedValue({
      configured: false,
      enabled: false,
      revoked: false,
      device_id: null,
    });
    api.listDevices.mockClear();
    api.listDevices.mockResolvedValue([]);
    api.pairNewJoin.mockClear();
    api.pairNewJoin.mockResolvedValue({ sas: "4821" });
    zxing.emit = null;
    for (const name of [
      "syncGeneratePhrase",
      "syncRelayHealth",
      "syncInit",
      "syncRecover",
      "syncSelfEnroll",
      "syncSetEnabled",
      "syncForcePull",
      "syncReset",
    ]) {
      api[name].mockClear();
    }
    api.syncReset.mockResolvedValue();
    api.syncGeneratePhrase.mockResolvedValue(SETUP_WORDS.join(" "));
    api.syncRelayHealth.mockResolvedValue({ mode: "multi_user" });
    api.syncInit.mockResolvedValue({ user_id: "u", device_id: "d" });
    api.syncRecover.mockResolvedValue({ user_id: "u", device_id: "d" });
  });

  afterEach(() => {
    cleanupAll();
    navTeardown();
    vi.restoreAllMocks();
  });

  // Scoped to the top entry, for the settings describe's reason: Stack
  // keeps the screen BENEATH the top one mounted, so an unscoped read for
  // a nav title answers with the wrong screen's.
  const topEntry = (target) => target.querySelector('.shell-stack-entry[data-top="true"]');
  const depth = (target) => Number(target.querySelector(".shell-stack").dataset.depth);
  const title = (target) =>
    topEntry(target).querySelector(".shell-navbar-title").textContent.trim();
  const topRowFor = (target, label) =>
    [...topEntry(target).querySelectorAll(".shell-row")].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
    );

  async function openSettings(target) {
    target.querySelector('[data-tab-id="settings"]').click();
    flushSync();
    await settle();
  }

  async function press(target, label) {
    const row = topRowFor(target, label);
    expect(row, `no "${label}" row on the "${title(target)}" screen`).toBeTruthy();
    row.click();
    flushSync();
    await settle();
  }

  it("pushes three screens, not one screen that changes its mind", async () => {
    // THE ANSWER TO TASK 2 STEP 1. Task 1 capped settings at two levels
    // because Stack calls `entry.view()` with no arguments, so one
    // component standing for four sections has to be told which one it
    // is and one host variable can only say that once. Sync is the other
    // shape: three levels, three different components, so each is its own
    // `kind` in `pushed` and its own snippet — the route `reading`,
    // `trails` and `pins` already take. Nothing was added to Stack, and
    // no second navigation sits beside it.
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    expect(depth(target)).toBe(1);

    await press(target, "sync");
    expect(depth(target)).toBe(2);
    expect(title(target)).toBe("sync");

    // Unconfigured, which the api mock's default sync_status says — so
    // this device JOINS, which is the branch the scanner is on.
    await press(target, "pair this device");
    expect(depth(target)).toBe(3);
    expect(title(target)).toBe("pair");

    await press(target, "scan a code");
    expect(depth(target)).toBe(4);
    expect(title(target)).toBe("scan");
  });

  it("empties the slot behind all four of them", async () => {
    // toolbarFor's row 1, which outranks everything: a pushed screen owns
    // the bottom of the display outright, and the frame stops RESERVING
    // the band rather than reserving an empty one. The scanner is the
    // deepest surface in the shell and the rule holds unchanged there.
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await press(target, "sync");
    await press(target, "pair this device");
    await press(target, "scan a code");

    expect(target.querySelector(".shell-tabbar")).toBeNull();
    expect(target.querySelector(".shell-slot")).toBeNull();
  });

  it("comes back one screen at a time, all the way down", async () => {
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await press(target, "sync");
    await press(target, "pair this device");
    await press(target, "scan a code");

    for (const expected of ["pair", "sync", "settings"]) {
      topEntry(target).querySelector(".shell-navbar-back").click();
      flushSync();
      expect(title(target)).toBe(expected);
    }
    expect(depth(target)).toBe(1);
  });

  it("pops the scanner on platform back, not the whole stack", async () => {
    // Stack registers a navstack entry per pushed ELEMENT, so the Android
    // system button reaches a screen four deep without this file wiring
    // anything of its own — and it must take exactly one, or a system
    // back at the camera would drop the reader out of pairing entirely.
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await press(target, "sync");
    await press(target, "pair this device");
    await press(target, "scan a code");

    window.history.back();
    flushSync();

    expect(depth(target)).toBe(3);
    expect(title(target)).toBe("pair");
  });

  it("hands a scanned code to the join, and pops the camera first", async () => {
    // `readCode` pops before it joins, so the lens is off while the
    // exchange runs rather than for as long as it takes. The scanned
    // payload is what reaches `pair_new_join` — not a re-read of
    // anything, because the code exists nowhere else on this device.
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await press(target, "sync");
    await press(target, "pair this device");
    await press(target, "scan a code");

    // A real press on QrScanner's own consent button, then a real decode
    // callback — the decoder is the one step jsdom cannot run and the one
    // thing mocked at the top of this file.
    const scanner = topEntry(target).querySelector(".scanner");
    expect(scanner, "the scanner screen is not showing a camera").toBeTruthy();
    scanner.querySelector("button").click();
    await settle();
    expect(zxing.emit, "the camera never started").not.toBeNull();

    zxing.emit({ getText: () => "the-payload" }, null);
    flushSync();
    await settle();

    expect(depth(target)).toBe(3);
    expect(title(target)).toBe("pair");
    expect(target.querySelector(".scanner")).toBeNull();
    expect(api.pairNewJoin).toHaveBeenCalledExactlyOnceWith("the-payload");
    // And the exchange is now at the digits, which is the only step that
    // can move a key and the one the reader has to perform.
    expect(topEntry(target).querySelector(".pair-sas").textContent.trim()).toBe("4821");
  });

  it("says on the settings root what the sync state is", async () => {
    api.syncStatus.mockResolvedValue({
      configured: true,
      enabled: true,
      revoked: false,
      device_id: "self",
    });
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);

    const row = topRowFor(target, "sync");
    expect(row.querySelector(".shell-row-value").textContent.trim()).toBe("on");
  });

  it("reads the devices on the push, not before it", async () => {
    // memory's and PinsScreen's rule: a fetch tied to the event that
    // opens a surface cannot be stale. The settings ROOT reads the status
    // for its value column and stops there — a device list nobody has
    // asked for is a relay round trip on the way to changing the font.
    api.syncStatus.mockResolvedValue({
      configured: true,
      enabled: true,
      revoked: false,
      device_id: "self",
    });
    api.listDevices.mockResolvedValue([{ id: "self", label: "the phone" }]);
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    expect(api.listDevices).not.toHaveBeenCalled();

    await press(target, "sync");

    expect(api.listDevices).toHaveBeenCalled();
    expect(topRowFor(target, "the phone")).toBeTruthy();
  });

  it("asks for no device list when there is no account to ask about", async () => {
    // Not "nothing happens": `sync_list_devices` on an unconfigured
    // install has no relay to ask and rejects, and a rejection logged
    // every time someone opens a screen whose whole message is "you are
    // not set up" is noise that buries the real ones.
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await press(target, "sync");

    expect(api.listDevices).not.toHaveBeenCalled();
    expect(title(target)).toBe("sync");
  });

  it("leaves the camera no exit but a back, which is what unmounts it", async () => {
    // Written after the opposite test failed, and the failure was the
    // right answer. `goRoot` empties `pushed` and would take the camera
    // with it — but it cannot be reached from here: toolbarFor's row 1
    // gives a pushed screen `strip: "none"`, so there is no tab bar
    // behind the scanner to tap. Every way out of this screen is
    // therefore one of the four backs, and all four remove the element,
    // which unmounts the screen, which stops the stream.
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await press(target, "sync");
    await press(target, "pair this device");
    await press(target, "scan a code");
    expect(depth(target)).toBe(4);
    expect(target.querySelector('[data-tab-id="memory"]')).toBeNull();

    topEntry(target).querySelector(".shell-navbar-back").click();
    flushSync();

    expect(target.querySelector(".scanner")).toBeNull();
  });

  it("stops polling for the other device when the pair screen leaves", async () => {
    // The other resource this stack holds: the showing side long-polls
    // the relay for up to 120 batches, and a poll left running behind
    // memory is the network's version of the camera bug — invisible,
    // attributed to nothing, and outliving the screen that asked for it.
    //
    // The cancel follows `pushed` rather than hanging off popScreen, on
    // Stack's own rule for its navstack registrations: there are five ways
    // this screen can leave and only three of them go through that
    // function.
    api.syncStatus.mockResolvedValue({
      configured: true,
      enabled: true,
      revoked: false,
      device_id: "self",
    });
    api.pairExistingStart.mockResolvedValue({
      pair_token: "aa-bb-cc",
      qr_payload: '{"relay":"r"}',
    });
    // Rejecting on a MACROTASK, which is what the relay's 404 really is.
    // A microtask rejection would let all 120 batches drain inside a
    // single settle(), and a loop that has already finished cannot be
    // observed being cancelled.
    api.pairExistingFetchSas.mockImplementation(
      () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error("404")), 0)),
    );

    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await press(target, "sync");
    await press(target, "add a device");
    await settle();
    const polledBefore = api.pairExistingFetchSas.mock.calls.length;
    expect(polledBefore).toBeGreaterThan(0);

    topEntry(target).querySelector(".shell-navbar-back").click();
    flushSync();
    await settle();
    await settle();
    await settle();

    expect(api.pairExistingFetchSas.mock.calls.length).toBe(polledBefore);
  });

  // ── setup: the account wizard, on the phone ─────────────────────────

  const phraseField = (target) => topEntry(target).querySelector('[aria-label="recovery phrase"]');
  const warmNote = (target) =>
    topEntry(target).querySelector('.shell-note[data-tone="warm"]')?.textContent.trim() ?? null;

  function pickSetupSegment(target, label) {
    const button = [...topEntry(target).querySelectorAll(".seg-btn")].find(
      (b) => b.textContent.trim() === label,
    );
    expect(button, `no "${label}" segment`).toBeTruthy();
    button.click();
    flushSync();
  }

  function typePhrase(target, text) {
    const field = phraseField(target);
    expect(field, "no phrase field on the top screen").toBeTruthy();
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
  }

  async function openSetup(target) {
    await openSettings(target);
    await press(target, "sync");
    await press(target, "set up sync");
    await settle();
  }

  it("offers set up sync off-account, and pushes the wizard beside pair", async () => {
    // THE ROW THE FIRST ONLY-DEVICE PHONE DID NOT HAVE. Unconfigured by
    // the mock's default, so both doors show; the wizard sits at depth 3
    // as pair's sibling, and generating the phrase is what opening it
    // does first.
    const { target } = render(ShellApp, {});
    await settle();
    await openSetup(target);
    expect(depth(target)).toBe(3);
    expect(title(target)).toBe("set up");
    expect(api.syncGeneratePhrase).toHaveBeenCalledOnce();
    expect(topEntry(target).querySelector(".setup-words").textContent.trim()).toBe(
      SETUP_WORDS.join(" "),
    );
  });

  it("withholds set up sync on an account", async () => {
    api.syncStatus.mockResolvedValue({
      configured: true,
      enabled: true,
      revoked: false,
      device_id: "self",
    });
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await press(target, "sync");
    expect(topRowFor(target, "set up sync")).toBeUndefined();
    expect(topRowFor(target, "add a device")).toBeTruthy();
  });

  it("stops a 23-word phrase before any command is called", async () => {
    // The count is the screen's guard and the checksum is the backend's;
    // a phrase one word short must be answered here, in the desktop's
    // words, with nothing sent — not by a relay probe followed by a
    // bip39 parse error.
    const { target } = render(ShellApp, {});
    await settle();
    await openSetup(target);
    pickSetupSegment(target, "have a phrase");
    typePhrase(target, SETUP_WORDS.slice(0, 23).join(" "));
    tap(target, "setup-next");
    await settle();
    expect(warmNote(target)).toBe("phrase must be 24 words");
    expect(phraseField(target), "the phrase step was left").toBeTruthy();
    expect(api.syncRelayHealth).not.toHaveBeenCalled();
    expect(api.syncRecover).not.toHaveBeenCalled();
    expect(api.syncInit).not.toHaveBeenCalled();
    expect(api.syncSelfEnroll).not.toHaveBeenCalled();
  });

  it("recovers with a typed phrase, normalised, and never inits with it", async () => {
    // THE TWO PATHS MUST NOT CROSS: `init` with a kept phrase asks the
    // relay to create an account that exists. The typed words arrive
    // lowercased and one space apart, whatever the keyboard did.
    const { target } = render(ShellApp, {});
    await settle();
    await openSetup(target);
    pickSetupSegment(target, "have a phrase");
    typePhrase(target, `  ${SETUP_WORDS.join("  ").toUpperCase()}\n`);
    tap(target, "setup-next");
    await settle();
    expect(warmNote(target)).toBeNull();
    expect(topEntry(target).querySelector('[aria-label="a name for this device"]')).toBeTruthy();

    tap(target, "setup-connect");
    await settle();
    await settle();
    expect(api.syncRelayHealth).toHaveBeenCalledWith("https://relay.shizumu.app");
    expect(api.syncRecover).toHaveBeenCalledWith(
      SETUP_WORDS.join(" "),
      "https://relay.shizumu.app",
      "this device",
    );
    expect(api.syncInit).not.toHaveBeenCalled();
    expect(api.syncSelfEnroll).not.toHaveBeenCalled();
  });

  it("goes back to today after a recovery lands, and not after an init", async () => {
    // Joining can delete the blank page open here (snapshot.rs
    // clear_placeholder_pages). getPage answers null for it, as it does
    // once the row is gone; the pull listener's way back runs at once.
    const { target } = render(ShellApp, {});
    await settle();
    await openSetup(target);
    pickSetupSegment(target, "have a phrase");
    typePhrase(target, `${SETUP_WORDS.join(" ")}\n`);
    tap(target, "setup-next");
    await settle();
    const before = api.getOrCreateToday.mock.calls.length;
    tap(target, "setup-connect");
    await settle();
    await settle();
    expect(api.syncRecover).toHaveBeenCalled();
    expect(api.getOrCreateToday.mock.calls.length).toBeGreaterThan(before);
  });

  it("stays on its page after an init, which deletes nothing", async () => {
    const { target } = render(ShellApp, {});
    await settle();
    await openSetup(target);
    tap(target, "setup-next");
    await settle();
    const before = api.getOrCreateToday.mock.calls.length;
    tap(target, "setup-connect");
    await settle();
    await settle();
    expect(api.syncInit).toHaveBeenCalled();
    expect(api.getOrCreateToday.mock.calls.length).toBe(before);
  });

  it("inits with the generated phrase, and never recovers with it", async () => {
    const { target } = render(ShellApp, {});
    await settle();
    await openSetup(target);
    tap(target, "setup-next");
    await settle();
    const label = topEntry(target).querySelector('[aria-label="a name for this device"]');
    label.value = " phone ";
    label.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    tap(target, "setup-connect");
    await settle();
    await settle();
    expect(api.syncInit).toHaveBeenCalledWith(
      SETUP_WORDS.join(" "),
      "https://relay.shizumu.app",
      "phone",
    );
    expect(api.syncRecover).not.toHaveBeenCalled();
    expect(api.syncSelfEnroll).not.toHaveBeenCalled();
  });

  it("self-enrols on a relay whose health is not multi_user", async () => {
    // The desktop's third case, which the relay's mode picks and not the
    // writer: a single-account relay has no init/recover distinction.
    api.syncRelayHealth.mockResolvedValue({ mode: "single_user" });
    const { target } = render(ShellApp, {});
    await settle();
    await openSetup(target);
    tap(target, "setup-next");
    await settle();
    tap(target, "setup-connect");
    await settle();
    await settle();
    expect(api.syncSelfEnroll).toHaveBeenCalledOnce();
    expect(api.syncInit).not.toHaveBeenCalled();
    expect(api.syncRecover).not.toHaveBeenCalled();
  });

  it("says the relay did not answer, sends nothing, and keeps the typed words", async () => {
    // The probe fails BEFORE anything is written, so every field must be
    // as it was — and the phrase most of all, because it is the one
    // thing on this screen that took a minute to type.
    api.syncRelayHealth.mockRejectedValue(new Error("can't reach https://relay.shizumu.app: dns"));
    const typed = SETUP_WORDS.join(" ");
    const { target } = render(ShellApp, {});
    await settle();
    await openSetup(target);
    pickSetupSegment(target, "have a phrase");
    typePhrase(target, typed);
    tap(target, "setup-next");
    await settle();
    tap(target, "setup-connect");
    await settle();
    await settle();
    expect(warmNote(target)).toBe(
      "the relay did not answer. check the url, and that this phone is online.",
    );
    expect(api.syncRecover).not.toHaveBeenCalled();
    expect(api.syncInit).not.toHaveBeenCalled();
    expect(api.syncSelfEnroll).not.toHaveBeenCalled();
    // Still on the relay step, with the way back to the words a row away.
    await press(target, "change the phrase");
    expect(phraseField(target).value).toBe(typed);
  });

  it("answers a wrong phrase with the relay's own sentence and stays", async () => {
    api.syncRecover.mockRejectedValue(new Error("relay error 404 user_not_found"));
    const { target } = render(ShellApp, {});
    await settle();
    await openSetup(target);
    pickSetupSegment(target, "have a phrase");
    typePhrase(target, SETUP_WORDS.join(" "));
    tap(target, "setup-next");
    await settle();
    tap(target, "setup-connect");
    await settle();
    await settle();
    expect(warmNote(target)).toBe(
      "no account matches this phrase. check the words, or set up a new account instead.",
    );
    expect(title(target)).toBe("set up");
    expect(topRowFor(target, "change the phrase")).toBeTruthy();
  });

  it("turns sync on from done, and lands on the devices screen reading on", async () => {
    // Enrolment leaves `enabled` false and the desktop asks; `turn on` is
    // `sync_set_enabled(true)`, then the pop, and the devices screen is
    // where the new state and the list are read. The status mock walks
    // the same path the backend would: off after connect, on after
    // enable.
    api.syncStatus.mockResolvedValue({
      configured: true,
      enabled: false,
      revoked: false,
      device_id: "d",
    });
    api.listDevices.mockResolvedValue([{ id: "d", label: "phone", created_at: 0 }]);
    const { target } = render(ShellApp, {});
    await settle();
    // Two reads happen before connect — the settings root's and the
    // devices screen's — and both must still answer "not on an account"
    // or the setup row never shows. The default set above is what the
    // third read, after connect, answers.
    api.syncStatus.mockResolvedValueOnce({
      configured: false,
      enabled: false,
      revoked: false,
      device_id: null,
    });
    api.syncStatus.mockResolvedValueOnce({
      configured: false,
      enabled: false,
      revoked: false,
      device_id: null,
    });
    await openSetup(target);
    tap(target, "setup-next");
    await settle();
    tap(target, "setup-connect");
    await settle();
    await settle();
    expect(warmNote(target)).toBeNull();
    // Done: the state row reads the re-read snapshot. Still a WORD, not a
    // switch — this is the setup screen's own row at depth 3, and the
    // wizard reports rather than offers. The devices screen under it is
    // where on and off are set, asserted below once the pop lands.
    const state = topRowFor(target, "sync");
    expect(state.querySelector(".shell-row-value").textContent.trim()).toBe("off");
    expect(topEntry(target).querySelector(".setup-words")).toBeNull();

    api.syncStatus.mockResolvedValue({
      configured: true,
      enabled: true,
      revoked: false,
      device_id: "d",
    });
    tap(target, "setup-turn-on");
    await settle();
    await settle();
    expect(api.syncSetEnabled).toHaveBeenCalledWith(true);
    // A NEW account force-pulls nothing; only a recovered one has history.
    expect(api.syncForcePull).not.toHaveBeenCalled();
    expect(title(target)).toBe("sync");
    expect(depth(target)).toBe(2);
    expect(
      topRowFor(target, "sync").querySelector('input[type="checkbox"]').checked,
    ).toBe(true);
    expect(topRowFor(target, "set up sync")).toBeUndefined();
  });

  it("force-pulls after turning on a recovered account", async () => {
    const { target } = render(ShellApp, {});
    await settle();
    await openSetup(target);
    pickSetupSegment(target, "have a phrase");
    typePhrase(target, SETUP_WORDS.join(" "));
    tap(target, "setup-next");
    await settle();
    tap(target, "setup-connect");
    await settle();
    await settle();
    tap(target, "setup-turn-on");
    await settle();
    await settle();
    expect(api.syncSetEnabled).toHaveBeenCalledWith(true);
    expect(api.syncForcePull).toHaveBeenCalledOnce();
  });

  it("leaves setup on later without turning sync on", async () => {
    const { target } = render(ShellApp, {});
    await settle();
    await openSetup(target);
    tap(target, "setup-next");
    await settle();
    tap(target, "setup-connect");
    await settle();
    await settle();
    await press(target, "later");
    expect(api.syncSetEnabled).not.toHaveBeenCalled();
    expect(title(target)).toBe("sync");
  });

  it("drops an answer that lands after the wizard was left", async () => {
    // pairCancelled's rule for setup: the phrase resolves after the back,
    // and a resolved phrase must not write itself into a screen that is
    // gone — nor be kept for the next open, which generates afresh.
    let answer;
    api.syncGeneratePhrase.mockImplementation(() => new Promise((r) => (answer = r)));
    const { target } = render(ShellApp, {});
    await settle();
    await openSetup(target);
    topEntry(target).querySelector(".shell-navbar-back").click();
    flushSync();
    await settle();
    expect(title(target)).toBe("sync");
    answer(SETUP_WORDS.join(" "));
    await settle();
    api.syncGeneratePhrase.mockResolvedValue("");
    await press(target, "set up sync");
    await settle();
    expect(topEntry(target).querySelector(".setup-words")).toBeNull();
    expect(warmNote(target)).toBe("could not make a phrase. try again.");
  });

  // ── disconnect (task 9g) ─────────────────────────────────────────────
  //
  // J9.1's contract, driven the way J9.1 drives it on a phone: a
  // `disconnect` row on the top entry, a sheet, the sheet's one
  // `[data-destructive="true"]` row, and then a screen that is off the
  // account and offers `set up sync` again.

  const ON_ACCOUNT = { configured: true, enabled: true, revoked: false, device_id: "d" };
  const OFF_ACCOUNT = { configured: false, enabled: false, revoked: false, device_id: null };

  it("disconnects from the sync screen, behind a sheet that asks first", async () => {
    api.syncStatus.mockResolvedValue(ON_ACCOUNT);
    api.listDevices.mockResolvedValue([{ id: "d", label: "phone", created_at: 0 }]);
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await press(target, "sync");

    // Last on the screen: below the devices and the pairing act.
    const labels = [...topEntry(target).querySelectorAll(".shell-row-label")].map((n) =>
      n.textContent.trim(),
    );
    expect(labels.at(-1)).toBe("disconnect");

    await press(target, "disconnect");
    // The row asks; it does not reset.
    expect(api.syncReset).not.toHaveBeenCalled();
    const sheet = target.querySelector('[data-sheet="sync-disconnect"]');
    expect(sheet, "disconnect opened no sheet").not.toBeNull();
    expect(sheet.textContent).toContain("your writing stays on this phone");
    const destructive = [...sheet.querySelectorAll('[data-destructive="true"]')];
    expect(destructive.length).toBe(1);
    expect(destructive[0].querySelector(".shell-row-label").textContent.trim()).toBe(
      "disconnect this phone",
    );

    // The backend's answer after the reset: off the account.
    api.syncStatus.mockResolvedValue(OFF_ACCOUNT);
    destructive[0].click();
    flushSync();
    await settle();
    await settle();

    expect(api.syncReset).toHaveBeenCalledOnce();
    expect(target.querySelector("[data-sheet]")).toBeNull();
    expect(title(target)).toBe("sync");
    expect(topRowFor(target, "sync").querySelector(".shell-row-value").textContent.trim()).toBe(
      "not set up",
    );
    expect(topRowFor(target, "set up sync")).toBeTruthy();
    expect(topRowFor(target, "disconnect")).toBeUndefined();
    expect(topRowFor(target, "phone")).toBeUndefined();
  });

  it("disconnects nothing when the sheet's stay row is pressed, or it is dismissed", async () => {
    api.syncStatus.mockResolvedValue(ON_ACCOUNT);
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await press(target, "sync");

    await press(target, "disconnect");
    const stay = [...target.querySelectorAll('[data-sheet="sync-disconnect"] .shell-row')].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === "keep things as they are",
    );
    expect(stay).toBeTruthy();
    stay.click();
    flushSync();
    await settle();
    expect(target.querySelector('[data-sheet="sync-disconnect"]')).toBeNull();

    await press(target, "disconnect");
    window.history.back();
    flushSync();
    await settle();
    expect(target.querySelector('[data-sheet="sync-disconnect"]')).toBeNull();

    expect(api.syncReset).not.toHaveBeenCalled();
    expect(title(target)).toBe("sync");
    expect(topRowFor(target, "disconnect")).toBeTruthy();
  });

  // Twice: once with the reset resolving, and once REJECTING while the
  // database is left unconfigured anyway — the 9g review's mid-batch
  // failure, where the reset is judged by the re-read, not by the call.
  it.each([
    ["resolves", () => Promise.resolve()],
    ["rejects but leaves the phone off its account", () => Promise.reject(new Error("mid-batch"))],
  ])("offers set up sync again after a disconnect that follows a pairing (reset %s)", async (_case, reset) => {
    // J9's own order: every suite run pairs first, then J9.1 disconnects
    // and looks for `set up sync`. A finished pairing leaves `pairPhase`
    // at `done` for the rest of the session, and `done` is one of the two
    // phases setupRowShows hides setup for — so without disconnectSync's
    // reset the phone is off its account with no way onto one. The
    // shortest real route to `done` is the SHOWING side: already on an
    // account, so no scanner, and the relay answers the digits at once.
    api.syncStatus.mockResolvedValue(ON_ACCOUNT);
    api.pairExistingStart.mockResolvedValue({ pair_token: "aa-bb-cc", qr_payload: '{"relay":"r"}' });
    api.pairExistingFetchSas.mockReset();
    api.pairExistingFetchSas.mockResolvedValue({ sas: "4821", ephemeral_pub_b64: "pub" });
    api.pairExistingConfirm.mockClear();
    try {
      const { target } = render(ShellApp, {});
      await settle();
      await openSettings(target);
      await press(target, "sync");
      await press(target, "add a device");
      await settle();
      await press(target, "the codes match");
      await settle();
      expect(api.pairExistingConfirm).toHaveBeenCalledOnce();
      await press(target, "done");
      expect(title(target)).toBe("sync");

      await press(target, "disconnect");
      api.syncStatus.mockResolvedValue(OFF_ACCOUNT);
      api.syncReset.mockImplementation(reset);
      const confirm = target.querySelector('[data-sheet="sync-disconnect"] [data-destructive="true"]');
      confirm.click();
      flushSync();
      await settle();
      await settle();

      expect(api.syncReset).toHaveBeenCalledOnce();
      expect(topRowFor(target, "sync").querySelector(".shell-row-value").textContent.trim()).toBe(
        "not set up",
      );
      expect(topRowFor(target, "set up sync"), "set up sync did not come back").toBeTruthy();
    } finally {
      // The file-wide mock's default, which the other pair tests rely on:
      // the relay 404s until the other device deposits its key.
      api.pairExistingFetchSas.mockReset();
      api.pairExistingFetchSas.mockImplementation(() => Promise.reject(new Error("404")));
      api.syncReset.mockReset();
      api.syncReset.mockResolvedValue();
    }
  });

  it("offers no disconnect off an account", async () => {
    // Not "nothing happens": an unconfigured phone has no account to
    // leave, and `sync_reset` there would be a control that resets nothing
    // (disconnectRowShows).
    const { target } = render(ShellApp, {});
    await settle();
    await openSettings(target);
    await press(target, "sync");
    expect(topRowFor(target, "set up sync")).toBeTruthy();
    expect(topRowFor(target, "disconnect")).toBeUndefined();
  });
});

describe("midnight", () => {
  // The clock is held, not raced. `clockDay` is polled off a one-minute
  // interval (ShellApp, MIDNIGHT_POLL_MS), so a crossing is `setSystemTime`
  // to the next day plus one advance past that interval — which is also the
  // shape of the real event: nothing tells the app the day changed, it
  // notices.
  // NOT 23:59. `advanceTimersByTimeAsync` moves the system clock as well as
  // the timer queue, so a fixture a minute short of midnight crosses it on
  // the first poll — which made the "still the same day" case below assert
  // the opposite of what it was written for. Every crossing here is an
  // explicit `setSystemTime`, never an advance that drifts into one.
  const EVE = "2026-08-31T20:00:00";
  const DAY = "2026-09-01T00:01:00";

  function sheetOf(target, tag) {
    return target.querySelector(`[data-sheet="${tag}"]`);
  }

  function rowsOf(target, tag) {
    return [...target.querySelectorAll(`[data-sheet="${tag}"] .shell-row`)].map((r) =>
      r.querySelector(".shell-row-label").textContent.trim(),
    );
  }

  async function openAcrossMidnight() {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(EVE));
    // The page the writer is holding is TODAY'S — which on this clock is
    // the 31st. That is what makes the crossing a surprise rather than a
    // past page opened on purpose (midnight.js).
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ date: "2026-08-31" })));
    const { target } = render(ShellApp);
    await vi.advanceTimersByTimeAsync(1);
    flushSync();
    return target;
  }

  async function cross(target) {
    vi.setSystemTime(new Date(DAY));
    await vi.advanceTimersByTimeAsync(60_000);
    flushSync();
    return target;
  }

  it("says nothing while it is still the same day", async () => {
    // Not an idle "nothing happens": this is the state the app spends every
    // waking minute in, and the sheet is non-dismissable — a false positive
    // is a wall in front of the writing surface.
    const target = await openAcrossMidnight();
    await vi.advanceTimersByTimeAsync(60_000);
    flushSync();
    expect(sheetOf(target, "midnight")).toBeNull();
  });

  it("opens the sheet when the day rolls over under the writer", async () => {
    const target = await cross(await openAcrossMidnight());
    expect(sheetOf(target, "midnight")).not.toBeNull();
    expect(rowsOf(target, "midnight")).toEqual(["start fresh", "stay on yesterday"]);
  });

  it("empties the bottom slot while it is up", async () => {
    // Row 1 of toolbarFor, which is how midnight is "chromeless" (§2)
    // without needing the primary-action row the other two chromeless
    // states use: an open sheet owns the bottom of the display, so hasSlot
    // goes false and the frame stops reserving the band.
    const target = await cross(await openAcrossMidnight());
    expect(target.querySelector(".shell-root.has-slot")).toBeNull();
    expect(target.querySelector(".shell-tab-bar")).toBeNull();
  });

  it("makes today's page on `start fresh`", async () => {
    const target = await cross(await openAcrossMidnight());
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ date: "2026-09-01", id: "p2" })));
    target
      .querySelectorAll('[data-sheet="midnight"] .shell-row')[0]
      .click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1);
    flushSync();
    expect(sheetOf(target, "midnight")).toBeNull();
    // `getOrCreateToday` is the one call in the api that makes a page, and
    // it is the same act `+` performs from a past day.
    expect(api.getOrCreateToday.mock.calls.length).toBeGreaterThan(1);
  });

  it("stays put on `stay on yesterday`, and does not ask again that night", async () => {
    // The answer that does NOT change the condition that opened the sheet.
    // Without the stamp, the next poll a minute later reopens it and the
    // writer cannot get past a sheet they have already answered.
    const target = await cross(await openAcrossMidnight());
    const madePages = api.getOrCreateToday.mock.calls.length;
    target
      .querySelectorAll('[data-sheet="midnight"] .shell-row')[1]
      .click();
    flushSync();
    await vi.advanceTimersByTimeAsync(60_000);
    flushSync();
    expect(sheetOf(target, "midnight")).toBeNull();
    expect(api.getOrCreateToday.mock.calls.length).toBe(madePages);
  });

  it("comes back if it is dismissed instead of answered", async () => {
    // "It must be answered, not swiped away" (Sheet.test.js). Sheet's
    // `dismissable={false}` only refuses the DRAG; Android back, Esc and
    // navBack() all reach it through closedByNav and dismiss it anyway, and
    // teaching Sheet to refuse those would leave it up with its navstack
    // entry already popped. So the re-assertion is at the host's end —
    // dismissing does not answer, and the condition is still true.
    //
    // Proven by wrapping that effect's assignment in `untrack` so it no
    // longer depends on `openSheet` at all: this assertion then finds no
    // sheet, 1 failed / 231 skipped.
    //
    // NOT proven by merely deleting the guard line, which was the obvious
    // probe and stayed green — a second mechanism covers it, because
    // Svelte re-runs an effect that WRITES state and the write converges on
    // its own. Two mechanisms hiding each other; the guard is still the one
    // the shipped code depends on, since it is what makes the outside write
    // (`dismissedSheet`) a dependency and what stops the second run.
    const target = await cross(await openAcrossMidnight());
    navBack();
    flushSync();
    await vi.advanceTimersByTimeAsync(1);
    flushSync();
    expect(sheetOf(target, "midnight")).not.toBeNull();

    // ANSWERED BEFORE THE TEST ENDS, and this is not tidiness. Sheet's
    // "one sheet at a time" claim lives at MODULE scope (Sheet.svelte's
    // `showingTag` / `hideShowing`) and nothing releases it on unmount, so
    // a test that walks away from an open sheet hands the claim to the next
    // one — the following test found a midnight sheet it never opened.
    target.querySelectorAll('[data-sheet="midnight"] .shell-row')[1].click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1);
    flushSync();
  });

  it("does not ambush a writer who opened a past page on purpose", async () => {
    // midnight.js's `pageDate !== openedOn` arm, seen from the app. A page
    // reached from the date sheet or the reading view is older than today
    // by design, and the first version of this feature met that with a
    // non-dismissable sheet asking whether to start a new day — caught by
    // this suite's own 1999 fixtures, which took the date sheet's place the
    // moment it opened.
    //
    // IT HAS TO CROSS MIDNIGHT WITH THE PAST PAGE ALREADY OPEN, which the
    // first draft of this test did not do. Opened AFTER the crossing, the
    // `today > openedOn` arm answers first and the case passes with the
    // arm under test deleted — two guards hiding each other. Opened before
    // it, `openedOn` is the 31st and only `pageDate !== openedOn` stands
    // between a deliberately-opened 1999 page and a non-dismissable sheet.
    // Proven: delete that line from midnight.js and this goes red.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(EVE));
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ date: LONG_AGO })));
    const { target } = render(ShellApp);
    await vi.advanceTimersByTimeAsync(1);
    flushSync();
    await cross(target);
    expect(sheetOf(target, "midnight")).toBeNull();
  });
});

describe("ShellApp — a sync pull while a page is open", () => {
  const doc = (text) => JSON.stringify({
    type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

  it("shows the other device's words, so the next save cannot write over them", async () => {
    // THE WRITING THIS LOST. The shell had no `sync-pulled` listener: the
    // laptop's words reached the phone's database and never its editor, and
    // the phone's next keystroke saved the stale copy over them.
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ content_json: doc("phone draft") })));
    const { target } = render(ShellApp);
    await settleWithEditor();
    expect(editorOf(target).getText()).toContain("phone draft");
    // The editor's first normalising update schedules one save on mount, and
    // a pull inside that second is refused by design (pull-reload.js). Wait
    // it out, as a pull arriving any later than that would.
    await new Promise((r) => setTimeout(r, 1500));

    api.getPage.mockResolvedValue(withLines(pageRow({ content_json: doc("the laptop's later words") })));
    expect(events.handlers["sync-pulled"]).toBeTypeOf("function");
    events.handlers["sync-pulled"]();
    await settle();
    await settle();

    expect(editorOf(target).getText()).toContain("the laptop's later words");
  });

  it("tells the mentions on screen to read their labels again", async () => {
    // A rename or delete on the other device left the old label, or a
    // live link to a deleted page, for the rest of the session: the label
    // caches cleared only on this device's own writes (api.js
    // emitTrailMutated, found reading the J16 journey, 2026-10-28).
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ content_json: doc("see the prices page") })));
    render(ShellApp);
    await settleWithEditor();
    api.emitTrailMutated.mockClear();
    events.handlers["sync-pulled"]();
    await settle();
    expect(api.emitTrailMutated).toHaveBeenCalled();
  });

  it("keeps the typing a pending save holds, when a pull lands inside that second", async () => {
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ content_json: doc("phone draft") })));
    const { target } = render(ShellApp);
    await settleWithEditor();
    const ed = editorOf(target);
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, " and a line not saved yet");
    flushSync();

    // The pull's copy lacks the typing. The pull is put off, the typing is
    // saved, and the page is read again (pullReload, "deferred"): the store
    // then holds what was saved, which is the copy shown. Before 25 october
    // the pull was dropped and waited for a next pull that need not come.
    const order = [];
    let stored = doc("the stored copy");
    api.getPage.mockImplementation(async () => { order.push("read"); return withLines(pageRow({ content_json: stored })); });
    api.savePageContent.mockImplementation(async (_id, json) => { order.push("save"); stored = json; });
    events.handlers["sync-pulled"]();
    await settle();
    await settle();
    await settle();

    expect(editorOf(target).getText()).toContain("a line not saved yet");
    expect(order).toEqual(["read", "save", "read"]);
  });

  it("shows the real today when the first pull swept the blank one", async () => {
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ id: "blank" })));
    render(ShellApp);
    await settleWithEditor();
    expect(api.getOrCreateToday).toHaveBeenCalledTimes(1);

    api.getPage.mockResolvedValue(null);
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ id: "real-today" })));
    events.handlers["sync-pulled"]();
    await settle();
    await settle();

    expect(api.getOrCreateToday).toHaveBeenCalledTimes(2);
  });

  it("shows a trail renamed on the other device in the page's header", async () => {
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ lineage_id: "L1", content_json: doc("x") })));
    api.getLineages.mockResolvedValue([{ id: "L1", name: "garden notes", mode: "discrete" }]);
    const { target } = render(ShellApp);
    await settleWithEditor();
    expect(target.textContent).toContain("garden notes");

    api.getPage.mockResolvedValue(withLines(pageRow({ lineage_id: "L1", content_json: doc("x") })));
    api.getLineages.mockResolvedValue([{ id: "L1", name: "the allotment", mode: "discrete" }]);
    events.handlers["sync-pulled"]();
    await settle();
    await settle();

    expect(target.textContent).toContain("the allotment");
    expect(target.textContent).not.toContain("garden notes");
  });

  it("lets the writer type on the page the backend made as today's, when the WebView's clock says yesterday", async () => {
    // THE HOUR THIS LOST. An A06 in Africa/Casablanca had stale tz data:
    // its WebView said the 8th while Rust said the 9th, so the page Rust
    // had just made as today's was yesterday's to page-writable.js and the
    // canvas refused every keystroke. One clock now decides: the backend's.
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const tomorrow = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    api.getLocalToday.mockResolvedValue(tomorrow);
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ date: tomorrow })));
    const { target } = render(ShellApp);
    await settleWithEditor();
    await settle();

    expect(editorOf(target).isEditable).toBe(true);
    api.getLocalToday.mockResolvedValue(null);
  });

  it("lets the writer type on the page the backend made as today's even when the backend's clock cannot be read", async () => {
    // THE SECOND CLOCK, NARROWED BUT NOT GONE. clockDay asks local_today
    // and falls back to the WebView's day when that call has no answer
    // (here: null, as an older backend or a failed call gives). The page
    // get_or_create_today returned is today's by identity, so the
    // WebView's day being behind it must not freeze the canvas.
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const tomorrow = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    api.getLocalToday.mockResolvedValue(null);
    api.getOrCreateToday.mockResolvedValue(withLines(pageRow({ date: tomorrow })));
    const { target } = render(ShellApp);
    await settleWithEditor();
    await settle();

    expect(editorOf(target).isEditable).toBe(true);
  });

  it("stops listening when the shell goes away", async () => {
    // A handler left behind would read and write a destroyed component's
    // state on every pull for the rest of the session.
    render(ShellApp);
    await settle();
    expect(events.handlers["sync-pulled"]).toBeTypeOf("function");
    cleanupAll();
    expect(events.handlers["sync-pulled"]).toBeUndefined();
  });
});
