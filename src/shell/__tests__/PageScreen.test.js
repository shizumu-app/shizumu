import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { flushSync, tick } from "svelte";
import { writable, fromStore } from "svelte/store";
import { TextSelection } from "@tiptap/pm/state";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import PageScreen from "../PageScreen.svelte";
import { readFileSync } from "node:fs";
import { getLocalDateStr } from "../../lib/utils.js";
import { handleReadout } from "../editor-readout.js";
import ViewportReadout from "../ui/ViewportReadout.svelte";
// The pan the caret correction's second input comes from — published by
// the viewport owner, which this suite drives directly rather than
// through a viewport it has no way to move.
import { viewportSnapshot } from "../../lib/keyboard-state.js";

// The canvas mounts the real EditorCore, so this file inherits the two
// mocks EditorCore's own suite uses, for the same two reasons.
//
// api.js: the core saves, reads its pin cache and asks the backend
// whether yjs is on. Unmocked, api.js falls through to its in-memory
// createMockInvoke() — a real backend as far as this file is concerned,
// and one whose fixtures would decide what the editor mounts with.
// getPins is spied rather than merely stubbed: it is how the lineageId
// prop is asserted below, since the core asks for pins per lineage.
const api = vi.hoisted(() => ({
  savePageContent: vi.fn(() => Promise.resolve()),
  saveTrailContent: vi.fn(() => Promise.resolve()),
  createPin: vi.fn(() => Promise.resolve({ id: "pin-1" })),
  getPins: vi.fn(() => Promise.resolve([])),
  attachmentAddBytes: vi.fn(() => Promise.resolve({})),
  updatePinContent: vi.fn(() => Promise.resolve()),
  updatePinStatus: vi.fn(() => Promise.resolve()),
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../lib/api.js", () => api);

// feature-flag.js is mocked rather than driven through getSetting because
// it CACHES its answer in a module-level `cached` and never asks twice.
// Spying on getSetting would therefore prove the yjs gate opened only in
// whichever test ran first, and every later "did not bind" assertion would
// pass on the warm cache regardless of what the component did — a false
// green on the exact branch these tests exist to hold.
const yjs = vi.hoisted(() => ({ isYjsEnabled: vi.fn(() => Promise.resolve(true)) }));
vi.mock("../../lib/yjs/feature-flag.js", () => yjs);

// shared-extensions: the full editing extension set drags in every
// shizumu node type, its menus and its input rules. What this file
// asserts is that the core mounted and which props it got — none of
// which the extension list changes — so a minimal schema keeps the
// mount honest and the run short.
//
// It is a spy rather than a plain arrow because ONE prop is observable
// nowhere else: `floatingChrome` never reaches the DOM — it decides the
// extension list this mock is replacing — so the options object it is
// called with is the only place the canvas's refusal of §3's floating
// chrome can be read back in jsdom.
//
// Blockquote joined the three in P2e, and it is the one node here that is
// not minimal on purpose. The drag measures ONE CONTAINER'S children, and
// a schema with no nesting cannot tell that apart from measuring every
// paragraph in the document — both answer the same list. A blockquote
// holding two paragraphs makes the two answers differ (2 top-level
// children, 3 <p> elements in the DOM), which is what "a top-level block
// never drops into a board" needs to be assertable at all. It is a
// stand-in for the real board types, which live behind extensions this
// mock is replacing. It changes nothing for the tests above: every other
// document here is flat paragraphs, and blockquote's only input rule
// needs a "> " nobody types.
//
// BlockMovement is the fifth, and unlike the other four it is not a node
// type — it is the extension that REGISTERS `moveBlockTo`, which is the
// command EditorCore.moveBlock runs and therefore the whole of P2e Task
// 3's drop. Left out, the drop threw `commands.moveBlockTo is not a
// function` out of a window event listener, which vitest reports as an
// uncaught exception attributed to whichever test was running. That is
// worth recording rather than quietly fixing: EditorCore.moveBlock guards
// `!editor || editor.isDestroyed` and not the command's existence, so an
// extension list without it fails loudly here and would fail loudly on a
// device too. The real app's buildEditingExtensions includes it
// (shared-extensions.js:203); this mock is what has to catch up.
const extensions = vi.hoisted(() => ({ buildEditingExtensions: vi.fn() }));
vi.mock("../../lib/render/shared-extensions.js", async () => {
  const { Document } = await import("@tiptap/extension-document");
  const { Paragraph } = await import("@tiptap/extension-paragraph");
  const { Text } = await import("@tiptap/extension-text");
  const { Blockquote } = await import("@tiptap/extension-blockquote");
  const { BlockMovement } = await import("../../lib/extensions/block-movement.js");
  extensions.buildEditingExtensions.mockImplementation(() => [
    Document, Paragraph, Text, Blockquote, BlockMovement,
  ]);
  return {
    READONLY_EXTENSIONS: [],
    buildEditingExtensions: extensions.buildEditingExtensions,
  };
});

afterEach(() => {
  cleanupAll();
  // Restores the real clock AND drops whatever the fake one still holds —
  // the continuous caret timer above is exactly that. A no-op for every
  // test that never faked.
  vi.useRealTimers();
  // The metrics sheet stubBoxes installs (see it), which lives in <head>
  // and not under the mount cleanupAll removes.
  document.getElementById("ps-test-metrics")?.remove();
});
beforeEach(() => vi.clearAllMocks());

const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });

// `date` is today's, not a fixed string, and that is load-bearing rather
// than tidy: page-writable.js (P2f Task 3) makes a page from another day
// read-only, which is CLAUDE.md's rule and which the shell could not see
// until it could open another day. A hardcoded past date made every
// editing test here drive a canvas production would have frozen. The
// read-only tests still say so with `is_open: false` — a different arm of
// the same rule, and unaffected.
function pageRow(over = {}) {
  return {
    id: "p1",
    date: getLocalDateStr(),
    page_number: 1,
    is_open: true,
    lineage_id: null,
    content_json: JSON.stringify({ type: "doc", content: [para("kept going")] }),
    ...over,
  };
}

// EditorCore constructs the editor inside onMount, after an await tick().
// Three rounds of microtask + tick is what its own suite needs before the
// editor exists; the same wait applies here.
async function settle() {
  for (let i = 0; i < 3; i++) { await Promise.resolve(); await tick(); }
  flushSync();
}

// A continuous trail's page schedules one more thing 50ms after its editor
// mounts: `focus("end")`, so the caret lands at the end of the living
// document (EditorCore:393). That timer must not be left pending: a timer
// that fires against a torn-down editor throws, and it lands as an
// unhandled error — the run exits 1 with every assertion green, attributed
// to whichever test happened to be running 50ms later rather than to the
// one that opened the page.
//
// It used to be unable to RUN either, because it ends in ProseMirror's
// scrollToSelection and jsdom implements getClientRects on Element but not
// on the Range that PM measures a caret with. vitest.setup.js fills that
// gap now, so the measuring half is survivable and only the torn-down half
// is left. The clock is still held rather than raced, because that half is
// enough on its own.
//
// So the continuous tests below hold the clock: vi.useFakeTimers() before
// the render, never advanced as far as 50, and useRealTimers() in afterEach
// discards the pending caret with the fake clock. It is not needed by the
// discrete or untrailed cases — they schedule no such timer — and it costs
// nothing there, so it stays with the tests that need it rather than
// becoming a file-wide default nobody can see the reason for. What the caret
// does at 50ms is the device pass's and the VR gate's to show.

function scrollTo(target, top) {
  // Flush BEFORE the event, not only after. Screen binds its content
  // element in an effect, so at the first dispatch after mount its
  // handler still sees a null element and early-returns -- the event
  // reads as if it never fired, and a collapse test written without this
  // fails on the component being right. Screen.test.js records the same
  // thing at its own first dispatch. Proven here rather than assumed: an
  // identical second dispatch collapsed the header while the first did
  // not, which is the binding landing, not the threshold moving.
  flushSync();
  const band = target.querySelector(".shell-screen-content");
  Object.defineProperty(band, "scrollTop", { value: top, configurable: true });
  band.dispatchEvent(new Event("scroll"));
  flushSync();
}

describe("PageScreen", () => {
  it("collapses the header past the threshold and expands below it", () => {
    const { target } = render(PageScreen, { dateLabel: "today", trailName: "the book" });
    expect(target.querySelector(".ph-line2")).not.toBeNull();

    scrollTo(target, 40);
    expect(target.querySelector(".ph-line2")).toBeNull();

    scrollTo(target, 2);
    expect(target.querySelector(".ph-line2")).not.toBeNull();
  });

  it("holds its state inside the hysteresis band", () => {
    // navCollapsed takes collapseAt 24 / expandAt 8 so a header cannot
    // flutter on the 1px scroll a soft keyboard produces. Between those
    // two numbers the answer is "whatever it already was" -- asserting
    // no-change here asserts the band exists, not that nothing ran.
    const { target } = render(PageScreen, { dateLabel: "today" });
    scrollTo(target, 40);
    expect(target.querySelector(".ph-line2")).toBeNull();
    scrollTo(target, 16);
    expect(target.querySelector(".ph-line2")).toBeNull();
  });

  it("keeps the trail row up while the keyboard is, since that row is the way out", () => {
    // It used to collapse here, and the device pass priced that: line 2
    // carries the trail, its + for a new page and the trail's own control,
    // so a keyboardOpen that goes wrong takes every one of them away. On a
    // Galaxy A34 a page zoom measured as a keyboard and the writer's only
    // way out was restarting the app. Scrolling still collapses the row —
    // see nav-collapse.js — because scrolling back up undoes itself.
    const { target } = render(PageScreen, { dateLabel: "today", keyboardOpen: true });
    expect(target.querySelector(".ph-line2")).not.toBeNull();
  });

  it("shows what matters now above the canvas, as a field the writer can type in", () => {
    const { target } = render(PageScreen, {
      dateLabel: "today", whatMattersNow: "finish the chapter",
    });
    const input = target.querySelector(".ps-wmn input");
    expect(input).not.toBeNull();
    expect(input.value).toBe("finish the chapter");
    expect(input.getAttribute("placeholder")).toBe("what matters now");
  });
});

// ProseMirror does not meaningfully run under jsdom: there is no layout,
// no composition, and no real caret, so a test that "types" here proves
// nothing about typing on a phone. What these assert is the WIRING — that
// the core mounted, where it mounted, and which props reached it. Editing
// behaviour is the device pass's and P2's VR gate's to prove.
describe("PageScreen when saves fail", () => {
  it("says the writing is not being kept while saves fail, and stops once one lands", async () => {
    // Until 2026-10-15 a failed save was console.error and nothing else.
    const { saveFailed, saveSucceeded, _resetSaveHealth } = await import("../../lib/save-health.js");
    const { flushSync } = await import("svelte");
    _resetSaveHealth();
    const { target } = render(PageScreen, { dateLabel: "today" });
    expect(target.querySelector(".ps-save-failing")).toBeNull();

    saveFailed("disk I/O error");
    flushSync();
    expect(target.querySelector(".ps-save-failing")?.textContent).toContain("not saved yet");

    saveSucceeded();
    flushSync();
    expect(target.querySelector(".ps-save-failing")).toBeNull();
  });
});

describe("PageScreen canvas", () => {
  it("mounts the editor in the content band, not the nav band", async () => {
    const { target } = render(PageScreen, { dateLabel: "today", page: pageRow() });
    await settle();

    const editor = target.querySelector(".tiptap-editor");
    expect(editor).not.toBeNull();
    // Not `.ps-canvas .tiptap-editor` alone: that would pass just as well
    // with the canvas hoisted into the nav snippet, which is the shape
    // that puts chrome permanently over the writing. The band the editor
    // is in is the assertion.
    expect(target.querySelector(".shell-screen-content .tiptap-editor")).toBe(editor);
    expect(target.querySelector(".shell-screen-nav .tiptap-editor")).toBeNull();
    expect(target.querySelector(".ps-canvas .tiptap-editor")).toBe(editor);
  });

  it("opens the page's own content", async () => {
    const { target } = render(PageScreen, {
      dateLabel: "today",
      page: pageRow({
        content_json: JSON.stringify({ type: "doc", content: [para("kept going")] }),
      }),
    });
    await settle();

    // content_json arrives from Rust as a JSON STRING, not an object.
    // Asserting the rendered text is what proves PageScreen handed the
    // field over intact rather than, say, a stringified [object Object].
    expect(target.querySelector(".tiptap-editor").textContent).toContain("kept going");
  });

  it("makes a closed page read-only and an open one writable", async () => {
    const shut = render(PageScreen, {
      dateLabel: "today", page: pageRow({ is_open: false }),
    });
    await settle();
    expect(shut.target.querySelector(".ProseMirror").getAttribute("contenteditable")).toBe("false");

    const open = render(PageScreen, { dateLabel: "today", page: pageRow({ is_open: true }) });
    await settle();
    expect(open.target.querySelector(".ProseMirror").getAttribute("contenteditable")).toBe("true");
  });

  it("says why the canvas is refusing, and says nothing when it is not", async () => {
    // THE SILENCE THIS ENDS. A read-only page stopped taking input and
    // nothing on screen said why: on an SM-A065F the whole visible text of
    // a page refusing every keystroke was "9 oct / find / pins / + / page /
    // memory / settings". A writer tapping into that gets no caret, no
    // keyboard and no sentence, which is indistinguishable from a broken
    // app — page-writable.js's header called that the worse of the two
    // failures, and then the shell shipped it.
    //
    // Asserted through the rendered text rather than the class, because
    // what was missing was WORDS. An empty element with the right class
    // would satisfy a selector and still tell the writer nothing.
    const shut = render(PageScreen, {
      dateLabel: "today", page: pageRow({ is_open: false }),
    });
    await settle();
    expect(shut.target.querySelector(".ps-refusal").textContent.trim())
      .toBe("this page is done. write on today's page.");

    // And the ordinary page carries no such line. This half is the one that
    // keeps a sentence of chrome off every page in the app.
    const open = render(PageScreen, { dateLabel: "today", page: pageRow({ is_open: true }) });
    await settle();
    expect(open.target.querySelector(".ps-refusal")).toBeNull();
  });

  it("hands the page's lineage to the editor", async () => {
    // The core loads its pin cache per lineage, so the argument getPins is
    // called with is the only observable proof that lineage_id reached the
    // editor rather than being dropped on the way through the canvas.
    render(PageScreen, {
      dateLabel: "today", trailName: "the book", page: pageRow({ lineage_id: "L1" }),
    });
    await settle();

    expect(api.getPins).toHaveBeenCalledWith("L1");
  });

  it("renders an empty canvas, and does not throw, before the page loads", async () => {
    // ShellApp renders one frame before its load resolves. Empty is right
    // here rather than merely harmless: mounting the editor against an
    // undefined pageId would open a page that does not exist and then be
    // handed the real row a tick later, and the core's page-switch path
    // would flush a save of the wrong doc against the wrong id. The frame
    // around it must still be whole, so the header and the title zone are
    // asserted present next to the absent editor.
    const { target } = render(PageScreen, { dateLabel: "today", page: null });
    await settle();

    expect(target.querySelector(".tiptap-editor")).toBeNull();
    expect(target.querySelector(".ps-canvas")).not.toBeNull();
    expect(target.querySelector(".ps-canvas").children.length).toBe(0);
    expect(target.querySelector(".ph-date-label")).not.toBeNull();
    expect(target.querySelector(".ps-wmn")).not.toBeNull();
  });

  it("refuses floating editor chrome, so the gutter holds one handle", async () => {
    // Spec §3: no bubble menu, no floating slash/mention menu, no
    // floating `+`. The canvas passes floatingChrome={false} and that is
    // the whole refusal — every other half of it lives in src/lib and is
    // held by shared-extensions-floating-chrome.test.js (TouchBlockHandle
    // omitted; the two suggestion plugins kept with their menus off).
    //
    // This is the only test in the tree that fails if the prop is dropped
    // from the mount. Checked by deleting it: the shell suite stayed at
    // 394 passed, because floatingChrome changes no markup, no callback
    // and no api call — nothing else here can see it.
    //
    // The `+` half is what makes the gutter single. TouchBlockHandle
    // draws a floating `+` in the gutter on any coarse pointer, which is
    // exactly where the shell's own `⋮` sits (see .ps-gutter below), and
    // nothing in src/shell listens for the shizumu-block-insert event it
    // fires — so with it mounted the phone showed two handles in one
    // column and only one of them did anything the shell knew about.
    render(PageScreen, { dateLabel: "today", page: pageRow() });
    await settle();

    expect(extensions.buildEditingExtensions).toHaveBeenCalled();
    for (const [options] of extensions.buildEditingExtensions.mock.calls) {
      expect(options.floatingChrome).toBe(false);
    }
  });
});

// What these four assert, and what they cannot. EditorCore consults the yjs
// feature flag from INSIDE `if (trailMode === "continuous" && !readonly)`
// (EditorCore:156) and from nowhere else, so the flag being asked is the one
// observable proof in jsdom that the mode reached the gate that decides
// whether this page binds a Y.Doc. It is a proof about the PROPS and the
// branch they open, not about the binding: ProseMirror does not run
// meaningfully here, Collaboration is not in this file's stub extension set,
// and no edit can be typed — so nothing below shows a save going to
// saveTrailContent rather than savePageContent. That route is asserted by
// the props travelling together in one expression, and proven for real only
// on a device. The full chain the props close is in PageScreen's header.
describe("PageScreen canvas — which save route the page takes", () => {
  it("opens the yjs gate for a continuous trail's page", async () => {
    vi.useFakeTimers();
    render(PageScreen, {
      dateLabel: "today", trailMode: "continuous",
      page: pageRow({ lineage_id: "L1" }),
    });
    await settle();

    expect(yjs.isYjsEnabled).toHaveBeenCalled();
  });

  it("leaves a discrete trail's page on the page path", async () => {
    // Not-binding is the right answer here, not merely a harmless one: a
    // discrete page's source of truth is content_json, and binding one
    // would start writing a yjs_state that every later open would then
    // hydrate in preference to the content — inventing on discrete pages
    // exactly the discard this task closes on continuous ones.
    render(PageScreen, {
      dateLabel: "today", trailMode: "discrete",
      page: pageRow({ lineage_id: "L1" }),
    });
    await settle();

    expect(yjs.isYjsEnabled).not.toHaveBeenCalled();
  });

  it("leaves an untrailed page on the page path", async () => {
    // The ordinary case, and the one the shell shows most: no lineage, so
    // no mode, so nothing to bind. Asserted separately from the discrete
    // case because they arrive by different routes — null because the page
    // has no trail at all, versus "discrete" because it has one.
    render(PageScreen, { dateLabel: "today", page: pageRow() });
    await settle();

    expect(yjs.isYjsEnabled).not.toHaveBeenCalled();
  });

  it("binds nothing on a continuous page it cannot write", async () => {
    // The gate is `continuous && !readonly`, and both halves matter: a
    // closed page makes no edits to persist, so hydrating a CRDT for it
    // buys nothing and puts a live Y.Doc behind a surface that can never
    // flush it.
    vi.useFakeTimers();
    render(PageScreen, {
      dateLabel: "today", trailMode: "continuous",
      page: pageRow({ lineage_id: "L1", is_open: false }),
    });
    await settle();

    expect(yjs.isYjsEnabled).not.toHaveBeenCalled();
  });
});

// jsdom has no layout: every box is 0x0 at 0,0, and that is all
// ProseMirror's coordsAtPos can be told (vitest.setup.js gives Range the
// same empty answer jsdom already gives Element, so it measures rather
// than throws — and measures nothing). So both halves of the geometry are
// stubbed with fixed rectangles — the band
// the caret must land inside, and the caret itself — and what these tests
// hold is the arithmetic and the wiring around caretScrollDelta, never that
// a real caret on a real device ends up where it should. That is the device
// pass's and P2's VR gate's to show.
//
// Same band as caret-visible.test.js throughout — nav bar at 120, floor at
// 600 — so a delta asserted here can be read straight off that file's cases.

/** The content band: its box (what bounds() returns) and a real scrollTop.
 *  The existing scrollTo() helper above defines scrollTop as a VALUE
 *  property, which is non-writable — the component's `scrollTop += delta`
 *  would throw against it under module strict mode. This one is a real
 *  accessor, so the write lands and can be asserted. */
function stubBand(target, { top = 120, bottom = 600 } = {}) {
  const el = target.querySelector(".shell-screen-content");
  let box = { top, bottom };
  let position = 0;
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({
      top: box.top, bottom: box.bottom, height: box.bottom - box.top,
      left: 0, right: 0, width: 0, x: 0, y: box.top,
    }),
    configurable: true,
  });
  Object.defineProperty(el, "scrollTop", {
    get: () => position,
    set: (v) => { position = v; },
    configurable: true,
  });
  return {
    /** The keyboard arriving: --app-height shrinks, the frame reflows, and
     *  the band's box is simply shorter the next time anyone asks. */
    floorAt: (b) => { box = { ...box, bottom: b }; },
    get scrollTop() { return position; },
    /** A scroll the WRITER made: the band's own position moves and the
     *  element reports it, which is the whole of what a wheel or a finger
     *  does. Not the file's `scrollTo` helper above — that one redefines
     *  scrollTop as a non-writable value property, so a correction firing
     *  during the event would throw instead of being observable, which is
     *  precisely what these tests need to watch. */
    scrollTo: (v) => {
      flushSync();
      position = v;
      el.dispatchEvent(new Event("scroll"));
      flushSync();
    },
  };
}

/** Put the caret at a fixed rectangle and report it the way tiptap does.
 *  The event is emitted on the editor rather than produced by a real
 *  setTextSelection because a real selection change routes through
 *  ProseMirror's DOM-selection sync, which jsdom cannot run — this is the
 *  editor's own event, on the editor's own emitter, carrying the payload
 *  EditorCore's handler is registered for (@tiptap/core:5734, :6148). */
function caretAt(target, { top, bottom }) {
  const editor = target.querySelector(".ProseMirror").editor;
  editor.view.coordsAtPos = () => ({ top, bottom, left: 0, right: 0 });
  editor.emit("selectionUpdate", { editor, transaction: editor.state.tr });
  flushSync();
}

describe("PageScreen — the caret stays above the keyboard", () => {
  it("scrolls a caret the keyboard has covered back into the band", async () => {
    const { target } = render(PageScreen, { dateLabel: "today", page: pageRow() });
    await settle();
    const band = stubBand(target);

    caretAt(target, { top: 610, bottom: 630 });

    // 630 + 8 margin - 600 floor. Positive moves the content up, which is
    // an increase in scrollTop.
    expect(band.scrollTop).toBe(38);
  });

  it("leaves a caret that is already in the band exactly where it is", async () => {
    // Nothing-happens is the requirement here, not a side effect worth
    // tolerating: the recurring phone bug is not a caret going off-screen,
    // it is a correction firing when it should not and the page jumping
    // under a caret the writer could already see. The second half of the
    // test is what makes the first half mean anything — a wire that was
    // never connected would also leave scrollTop at 0, so the same mount
    // is then given a caret below the floor and has to move.
    const { target } = render(PageScreen, { dateLabel: "today", page: pageRow() });
    await settle();
    const band = stubBand(target);

    caretAt(target, { top: 300, bottom: 320 });
    expect(band.scrollTop).toBe(0);

    caretAt(target, { top: 610, bottom: 630 });
    expect(band.scrollTop).toBe(38);
  });

  it("measures the caret's block when ProseMirror reports no rect for it", async () => {
    // Enter at the end of the doc — the commonest way to need this feature
    // at all — puts the caret in a brand-new empty paragraph, whose only
    // child is PM's trailing <br>, which reports no client rects. coordsAtPos
    // answers {0,0,0,0}, and that reads as a caret at the top of the
    // viewport: without the fallback the page scrolls to the TOP on every
    // Enter, which is the opposite of the job. main hit this in the desktop
    // chrome and fixed it the same way (src/lib/editor/caret-scroll.js,
    // not in this branch yet).
    const { target } = render(PageScreen, { dateLabel: "today", page: pageRow() });
    await settle();
    const band = stubBand(target);

    const editor = target.querySelector(".ProseMirror").editor;
    editor.view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
    const block = document.createElement("p");
    block.getBoundingClientRect = () => ({ top: 610, bottom: 640 });
    editor.view.domAtPos = () => ({ node: block, offset: 0 });
    editor.emit("selectionUpdate", { editor, transaction: editor.state.tr });
    flushSync();

    // 640 + 8 margin - 600 floor, off the BLOCK's box. Deleting the
    // fallback gives -128 instead — the scroll-to-top this guards.
    expect(band.scrollTop).toBe(48);
  });

  it("re-checks against the shorter band when the keyboard opens", async () => {
    // The band is measured on every correction rather than cached, and this
    // is the case that says why: one caret, never moved, visible in the tall
    // band and behind the keyboard in the short one. A version that read
    // bounds() once at mount passes every other test in this file.
    const kb = writable(false);
    const kbState = fromStore(kb);
    const { target } = render(PageScreen, {
      dateLabel: "today",
      page: pageRow(),
      get keyboardOpen() { return kbState.current; },
    });
    await settle();
    const band = stubBand(target, { top: 120, bottom: 700 });

    caretAt(target, { top: 500, bottom: 520 });
    expect(band.scrollTop).toBe(0);

    band.floorAt(400);
    kb.set(true);
    flushSync();

    // 520 + 8 margin - 400 floor. No selection event fired here — the
    // keyboard flip alone is what re-checked.
    expect(band.scrollTop).toBe(128);
  });

  // The keyboard that opens for the FOCUS LINE is not the editor's. On a long
  // living document the editor's remembered caret sits at the end, and the
  // keyboard raised by a tap on the title chased it there: one jump to the
  // bottom, the title off-screen while it held focus, so nothing typed
  // reached it (sync journey J5.3 on the A16, 2026-10-24, the 5000-word book).
  it("does not chase the editor's caret while the writer is in the focus line", async () => {
    const kb = writable(false);
    const kbState = fromStore(kb);
    const { target } = render(PageScreen, {
      dateLabel: "today",
      page: pageRow(),
      get keyboardOpen() { return kbState.current; },
    });
    await settle();
    const band = stubBand(target, { top: 120, bottom: 700 });
    caretAt(target, { top: 500, bottom: 520 });
    expect(band.scrollTop).toBe(0);

    target.querySelector('.ps-wmn input[aria-label="what matters now"]').focus();
    band.floorAt(400);
    kb.set(true);
    flushSync();

    // Not 128: the caret behind the keyboard is not the one being typed at.
    expect(band.scrollTop).toBe(0);
  });

  it("re-checks when the band pans under a keyboard that is already up", async () => {
    // The iOS shape: the engine moves the visible band to reveal the
    // caret and the shell's frame follows it, which puts the content
    // back down over the caret — with no keyboard flip to trigger the
    // correction. The pan is the second input (caret-visible.js), read
    // off the store the viewport owner publishes.
    const { target } = render(PageScreen, {
      dateLabel: "today",
      page: pageRow(),
      keyboardOpen: true,
    });
    await settle();
    const band = stubBand(target, { top: 120, bottom: 700 });
    caretAt(target, { top: 500, bottom: 520 });
    expect(band.scrollTop).toBe(0);

    // The band shrinks the way a revealed keyboard leaves it, and the
    // pan arrives on its own — no selection, no keyboard change.
    band.floorAt(400);
    viewportSnapshot.update((v) => ({ ...v, vvOffsetTop: 120 }));
    flushSync();

    expect(band.scrollTop).toBe(128);
  });

  it("does not move the page for a selection with no rendered box", async () => {
    // This test was written as "does not scroll before the writer has put a
    // caret anywhere" and that premise is false — proven by instrumenting
    // the component, not by reading it. EditorCore's page-switch effect
    // calls setContent (EditorCore:388) and tiptap emits selectionUpdate for
    // the transaction that lands the doc, so a selection is already in hand
    // by the time this runs. What is really being held is the branch below
    // it: `coordsAtPos` FAILING, which on a device means a node view still
    // mounting or a doc mid-replacement.
    //
    // The failure is injected rather than borrowed from the environment,
    // and that is this test's second rewrite. It used to rely on jsdom
    // having no `Range.getClientRects`, which made `coordsAtPos` throw on
    // its own — a real throw, but an accidental one: the test passed
    // because of a gap in the runner rather than because of anything it
    // did. vitest.setup.js now fills that gap (jsdom answers the same
    // question on Element and PM measures a caret sitting after text with
    // a Range, so the hole showed up as unhandled errors attributed to
    // whichever test was running a frame later). With the hole filled,
    // nothing here throws by itself, and a test whose subject is a `catch`
    // has to produce the throw it is about.
    //
    // Not scrolling is the requirement rather than a shrug: with no caret
    // rectangle there is nothing to keep visible, and moving anyway would
    // throw away the scroll position the writer left the page at. Delete
    // EditorCore's try/catch and this goes red — the spy's error escapes
    // the effect instead of being swallowed.
    const kb = writable(false);
    const kbState = fromStore(kb);
    const { target } = render(PageScreen, {
      dateLabel: "today",
      page: pageRow(),
      get keyboardOpen() { return kbState.current; },
    });
    await settle();
    const band = stubBand(target, { top: 120, bottom: 400 });
    const ed = target.querySelector(".ProseMirror").editor;
    vi.spyOn(ed.view, "coordsAtPos").mockImplementation(() => {
      throw new Error("no box: the node view is still mounting");
    });

    kb.set(true);
    flushSync();

    expect(band.scrollTop).toBe(0);
  });

  it("leaves the page where the writer scrolled it when the nav bar folds and unfolds", async () => {
    // In the product: write a page, scroll back up to re-read it, and the
    // page will not stay at the top. Measured on android-webview 2026-09-02
    // as an oscillation — 0, then a correction to 222, then 22, then 0, then
    // 222 — for as many wheels as it was given, and it is what held
    // `shell-page @ collapsed` red for the whole of P4.
    //
    // The route is four links long and none of them is about carets.
    // handleScroll reads `collapsed`; Screen calls handleScroll from its own
    // mount effect, so Screen's effect subscribes to this screen's fold
    // state; every fold and unfold therefore re-runs it and it re-hands its
    // scroller; and `$state` proxies that assignment, so the identical
    // object arrives as a new identity and invalidates anyway. The caret
    // effect read it through `scroller?.bounds()` and corrected — against a
    // caret at the end of the document that the writer had just deliberately
    // scrolled away from.
    //
    // Both scrolls assert, because the correction fires on the FOLD as well
    // as the unfold — anything that CHANGES `collapsed` re-hands the
    // scroller. Delete the caretRecheckWarranted guard in PageScreen and
    // this reads 78 and then 38 instead of 40 and 0.
    const { target } = render(PageScreen, { dateLabel: "today", page: pageRow() });
    await settle();
    const band = stubBand(target);

    // The state a writer is in after writing a page: the caret is at the end
    // of the document, below the band, and the correction has already
    // brought it back.
    caretAt(target, { top: 610, bottom: 630 });
    expect(band.scrollTop).toBe(38);

    band.scrollTo(40);
    expect(target.querySelector(".ph-line2")).toBeNull();
    expect(band.scrollTop).toBe(40);

    band.scrollTo(0);
    expect(target.querySelector(".ph-line2")).not.toBeNull();
    expect(band.scrollTop).toBe(0);
  });
});

// The two things the canvas now hands to whoever hosts it: the editor
// instance, and the state the bottom slot renders from. Asserted HERE
// rather than in ShellApp.test.js because this is the seam where either
// one is observable — ShellApp holds them in private fields and, until
// P2c's slot reads them, has no rendered effect a test could read back.
//
// What the shell does with them is not this file's business and is
// deliberately not asserted: PageScreen forwards, it does not decide.
describe("PageScreen — the shell takes the editor", () => {
  it("hands the editor up as soon as the core has one", async () => {
    const onEditor = vi.fn();
    const { target } = render(PageScreen, {
      dateLabel: "today", page: pageRow(), onEditor,
    });
    await settle();

    expect(onEditor).toHaveBeenCalled();
    // Identity, not truthiness. The slot's buttons run commands on THIS
    // object, so an editor that is merely an editor is not the assertion —
    // a forward that handed up some other instance (a stale one from a
    // previous page, say) would satisfy every weaker check and then act on
    // a document the writer is not looking at.
    expect(onEditor.mock.calls.at(-1)[0]).toBe(
      target.querySelector(".ProseMirror").editor,
    );
  });

  it("hands the snapshot up, and again when the selection changes", async () => {
    const onEditor = vi.fn();
    const onSnapshot = vi.fn();
    render(PageScreen, {
      dateLabel: "today", page: pageRow(), onEditor, onSnapshot,
    });
    await settle();

    expect(onSnapshot).toHaveBeenCalled();
    expect(onSnapshot.mock.calls.at(-1)[0].selectionEmpty).toBe(true);

    // A real ProseMirror transaction, dispatched on the editor the wire
    // just handed over — the same path a tap on the phone takes. Not
    // scrollIntoView'd: that would send EditorCore's own
    // handleScrollToSelection through coordsAtPos, which jsdom has no
    // layout to answer.
    const ed = onEditor.mock.calls.at(-1)[0];
    ed.view.dispatch(
      ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 1, 5)),
    );
    flushSync();

    // The FIELDS, not the call count. A forwarder that pushed the same
    // frozen EMPTY_SNAPSHOT on every transaction satisfies a count and
    // leaves every strip deciding on a document nobody is editing —
    // selectionEmpty is the exact field toolbarFor switches the selection
    // strip on, so a stuck `true` here is a selection strip that never
    // appears.
    const last = onSnapshot.mock.calls.at(-1)[0];
    expect(last.selectionEmpty).toBe(false);
    expect(last.from).toBe(1);
    expect(last.to).toBe(5);
  });

  it("tells the shell the editor is gone before it destroys it", async () => {
    // Teardown, asserted through the half of it that IS observable from
    // outside. EditorCore calls onEditor(null) in onDestroy (:482) before
    // editor.destroy(), and it matters because the shell holds this
    // instance to run commands on: a host still holding a destroyed editor
    // throws on the first press after the canvas goes away, and nothing
    // upstream checks isDestroyed unless it was told.
    //
    // The other half — that the snapshot subscription is unsubscribed —
    // has no assertion, and the absence is deliberate rather than an
    // omission. Proving it needs a handle on the store, and the store is a
    // component export on an EditorCore instance that only PageScreen's
    // binding can reach; once the canvas is gone the instance is
    // unreachable from any test, and the editor that could have driven a
    // further update is destroyed. ShellApp.svelte's `live` flag carries
    // the same finding in the same words: Svelte 5 swallows a write into a
    // dead component, so a green test there would claim a protection it
    // never exercised. The unsubscribe is the return value of the
    // subscribing $effect, which Svelte runs on teardown.
    const onEditor = vi.fn();
    const view = render(PageScreen, {
      dateLabel: "today", page: pageRow(), onEditor,
    });
    await settle();
    expect(onEditor.mock.calls.at(-1)[0]).not.toBeNull();

    view.cleanup();

    expect(onEditor.mock.calls.at(-1)[0]).toBeNull();
  });

  it("hands the core up, and it is the instance confirmPin lives on", async () => {
    // The third thing the canvas lends, from P2f Task 1. `confirmPin` is
    // EditorCore's and the strip that presses it sits a band above this
    // file, so the instance has to travel the same way the editor does.
    //
    // Asserted on the MEMBERS rather than on truthiness: what the host
    // needs from this object is one function, and a forward that handed
    // up the editor, or a stale core, or this component's own props would
    // satisfy every weaker check and then fail on the first pin.
    const onCore = vi.fn();
    render(PageScreen, { dateLabel: "today", page: pageRow(), onCore });
    await settle();

    const core = onCore.mock.calls.at(-1)[0];
    expect(core).not.toBeNull();
    expect(typeof core.confirmPin).toBe("function");
    // The same instance the snapshot arrives from, not a second one:
    // `core` is one binding, and two bindings would be two lifecycles.
    expect(typeof core.snapshot?.subscribe).toBe("function");
  });

  it("takes the core back on teardown", async () => {
    // The same requirement onEditor(null) meets in the test below,
    // reached a different way and therefore worth its own assertion.
    // EditorCore announces its own editor's death from inside onDestroy;
    // nothing announces the COMPONENT's, so this null is the $effect's
    // teardown rather than a message from the core.
    //
    // It matters more here than it does for the editor: a host holding a
    // destroyed editor can ask `isDestroyed`, and a host holding a torn
    // down component export can ask nothing at all.
    const onCore = vi.fn();
    const view = render(PageScreen, { dateLabel: "today", page: pageRow(), onCore });
    await settle();
    expect(onCore.mock.calls.at(-1)[0]).not.toBeNull();

    view.cleanup();

    expect(onCore.mock.calls.at(-1)[0]).toBeNull();
  });

  it("hands up nothing before the page loads", async () => {
    // ShellApp renders one frame before its load resolves, so this path
    // runs on every boot. There is no EditorCore to bind then, so `core`
    // is null and the subscription must not be attempted rather than
    // attempted against undefined.
    //
    // Silence is the requirement, not merely the outcome: a host handed a
    // snapshot before there is an editor would light toolbar buttons for a
    // document that does not exist, and a host handed a null editor at
    // boot cannot tell that from the null EditorCore sends on teardown.
    const onEditor = vi.fn();
    const onSnapshot = vi.fn();
    const { target } = render(PageScreen, {
      dateLabel: "today", page: null, onEditor, onSnapshot,
    });
    await settle();

    expect(target.querySelector(".tiptap-editor")).toBeNull();
    expect(onEditor).not.toHaveBeenCalled();
    expect(onSnapshot).not.toHaveBeenCalled();
  });
});

// The gutter handle. jsdom has no layout, so every box here is stubbed and
// what these hold is which BLOCK the handle addresses and that it moves
// when the caret does — never that 44px of gutter looks right beside a line
// of Lora. That is P2d's VR task and the device pass.
//
// The two blocks are `first` (node positions 0-7, caret inside at 1) and
// `second` (7-15, caret inside at 9). activeBlock.pos is $from.before(1) —
// 0 and 7 — which is what the component feeds view.nodeDOM.
const TWO_BLOCKS = JSON.stringify({
  type: "doc",
  content: [para("first"), para("second")],
});

/** Give the canvas and each top-level block a fixed box, a line height and
 *  a tap box. The handle's `top` is the block's box minus the canvas's —
 *  140 - 100 = 40 — shifted so the tap box is centred on the block's first
 *  line: (25.6 - 44) / 2 = -9.2, so 30.8 (gutter-handle-line.js).
 *
 *  The line height and the tap box are a STYLE SHEET in <head>, not a
 *  patched getComputedStyle and not inline styles on the blocks. jsdom has
 *  no layout, but its getComputedStyle does cascade declared rules onto
 *  matching elements, and that is the same call the component makes on a
 *  device. Not inline, because the blocks are ProseMirror's DOM: setting
 *  `style` on one is a mutation its DOMObserver answers by redrawing the
 *  node, and the redraw threw away these very rect stubs — eleven drag
 *  tests went red the first time this helper was written that way, with
 *  every indicator reading "past the last block". A sheet touches nothing
 *  the editor owns. `lineHeight` rules every top-level block; `tap` is the
 *  canvas's padding-left, which is where the component reads `var(--tap)`
 *  resolved (see gutter-handle-line.js for why the canvas and not the
 *  gutter). Pass `lineHeight: null` to install no sheet, which is the
 *  bare-jsdom reading the fallback test wants; afterEach removes it.
 *
 *  Heights default to 0, which is what every pre-P2e test here wanted: the
 *  handle reads a top and nothing else. The drag reads midpoints, so its
 *  tests pass real heights.
 *
 *  The children are `> *`, not `> p`: P2e's container test puts a
 *  blockquote at the top level, and a selector that only saw paragraphs
 *  would silently mis-stub the very document written to catch that.
 *
 *  scrollCanvas is the canvas moving under a stationary finger — an
 *  auto-scrolled frame, or the writer's own pan. It moves the CANVAS's box
 *  and leaves the blocks' where they are, which is not a contradiction: the
 *  drag freezes the blocks' boxes at lift by design and reads the canvas's
 *  live, so this stubs exactly the two things the component actually
 *  consults after the lift. */
const METRICS_SHEET = "ps-test-metrics";

function stubBoxes(target, {
  canvasTop, blockTops, blockHeights = [], lineHeight = "25.6px", tap = "44px",
}) {
  let canvasY = canvasTop;
  const boxAt = (top, height = 0) => ({
    top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top,
  });
  const fix = (el, read) =>
    Object.defineProperty(el, "getBoundingClientRect", {
      value: read,
      configurable: true,
    });
  fix(target.querySelector(".ps-canvas"), () => boxAt(canvasY));
  const blocks = [...target.querySelectorAll(".ProseMirror > *")];
  blocks.forEach((el, i) => fix(el, () => boxAt(blockTops[i], blockHeights[i] ?? 0)));
  expect(blocks.length).toBe(blockTops.length);
  document.getElementById(METRICS_SHEET)?.remove();
  if (lineHeight !== null) {
    const sheet = document.createElement("style");
    sheet.id = METRICS_SHEET;
    sheet.textContent =
      `.ps-canvas { padding-left: ${tap} } ` +
      `.ps-canvas .ProseMirror > * { line-height: ${lineHeight} }`;
    document.head.appendChild(sheet);
  }
  return {
    scrollCanvas: (dy) => { canvasY -= dy; },
  };
}

/** Move the caret, the way a tap on another block does: a real transaction
 *  on the real editor, which is what makes EditorCore republish its
 *  snapshot. Not scrollIntoView'd — see the canvas tests above. */
function caretTo(target, pos) {
  const ed = target.querySelector(".ProseMirror").editor;
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
  flushSync();
}

const handles = (target) => target.querySelectorAll(".ps-gutter");

describe("PageScreen — the gutter handle", () => {
  it("puts one handle beside the block the caret is in, and none beside the others", async () => {
    const { target } = render(PageScreen, {
      dateLabel: "today", page: pageRow({ content_json: TWO_BLOCKS }),
    });
    await settle();
    stubBoxes(target, { canvasTop: 100, blockTops: [140, 260] });

    caretTo(target, 1);

    // One, not one per block: the gutter is a single column with a single
    // control in it, and a handle on every block is the "which one does
    // this act on" ambiguity the active-block rule exists to remove.
    expect(handles(target).length).toBe(1);
    expect(handles(target)[0].style.top).toBe("30.8px");
  });

  it("keeps the handle on the block whose title took focus", async () => {
    // REPORTED: "when tap on title it does not show the 3 dots". A table, a
    // board and a recipe each carry a real <input> inside their NodeView,
    // and focusing one does not move ProseMirror's selection — so the
    // snapshot went on naming whichever block the caret was last left in,
    // and the writer naming their table had no control over it at all.
    //
    // The input here is appended to the second block rather than built by
    // mounting a real table: what is under test is the wiring from a focus
    // event to the handle's block, and `blockElementFor` has the DOM walk
    // itself covered (block-focus.test.js). posAtDOM resolves the real
    // block either way, which is the part that has to be true.
    const { target } = render(PageScreen, {
      dateLabel: "today", page: pageRow({ content_json: TWO_BLOCKS }),
    });
    await settle();
    stubBoxes(target, { canvasTop: 100, blockTops: [140, 260] });

    // The caret starts in the FIRST block, and stays there: that is what
    // makes this a test rather than a coincidence. If the handle followed
    // the stale selection it would answer 30.8px, the first block's top.
    caretTo(target, 1);
    expect(handles(target)[0].style.top).toBe("30.8px");

    const second = target.querySelectorAll(".ProseMirror > *")[1];
    const title = document.createElement("input");
    second.appendChild(title);
    title.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    flushSync();

    // 260 - 100 = 160, less the same 9.2 that centres the tap box on the
    // line: the handle is beside the block being named, not the one the
    // caret was abandoned in.
    expect(handles(target).length).toBe(1);
    expect(handles(target)[0].style.top).toBe("150.8px");
  });

  it("gives the handle back to the caret when the title lets go", async () => {
    // The other half: a focus that leaves for nothing in particular puts
    // the selection back in charge. Without this the handle would sit on
    // the last-focused title for the rest of the session.
    const { target } = render(PageScreen, {
      dateLabel: "today", page: pageRow({ content_json: TWO_BLOCKS }),
    });
    await settle();
    stubBoxes(target, { canvasTop: 100, blockTops: [140, 260] });
    caretTo(target, 1);

    const second = target.querySelectorAll(".ProseMirror > *")[1];
    const title = document.createElement("input");
    second.appendChild(title);
    title.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    flushSync();
    expect(handles(target)[0].style.top).toBe("150.8px");

    title.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    flushSync();

    expect(handles(target)[0].style.top).toBe("30.8px");
  });

  it("centres the tap box on the block's first line, not on the block's top", async () => {
    // The device defect: the `⋮` sat a line below the text it belonged to.
    // The column's only content is a 44px ToolbarButton, so a column whose
    // top IS the block's top has its glyph 22px down, while a 25.6px prose
    // line's centre is 12.8px down. The stub is the same 140 - 100 = 40 as
    // above; the three tops below differ only in what the block's computed
    // style says, which is what proves the number is READ off the block and
    // the canvas rather than assumed:
    //   paragraph  40 + (25.6 - 44) / 2 = 30.8
    //   heading    40 + (34.8 - 44) / 2 = 35.4   (h2: 24px × 1.45)
    //   bigger tap 40 + (25.6 - 48) / 2 = 28.8   (--tap above its floor)
    // Reintroducing the old placement — `top: blockTop` — answers 40px to
    // all three, which is how this test was proved before it was kept.
    const { target } = render(PageScreen, {
      dateLabel: "today", page: pageRow({ content_json: TWO_BLOCKS }),
    });
    await settle();

    stubBoxes(target, { canvasTop: 100, blockTops: [140, 260] });
    caretTo(target, 1);
    expect(handles(target)[0].style.top).toBe("30.8px");

    stubBoxes(target, { canvasTop: 100, blockTops: [140, 260], lineHeight: "34.8px" });
    caretTo(target, 2);
    expect(handles(target)[0].style.top).toBe("35.4px");

    stubBoxes(target, { canvasTop: 100, blockTops: [140, 260], tap: "48px" });
    caretTo(target, 1);
    expect(handles(target)[0].style.top).toBe("28.8px");
  });

  it("sits at the block's top when the line height cannot be read", async () => {
    // The block's top is not "nothing happened": it is the fallback
    // gutter-handle-line.js chooses when the computed line-height cannot
    // be turned into pixels — bare jsdom answers `normal` over a font-size
    // of `medium`, and a block the stylesheet never reached is the device
    // shape of the same thing — because it is
    // the honest bound of the error (the glyph stays within one tap box of
    // its line) and because the alternative is `top: NaNpx`, which the
    // browser drops, parking the column at the canvas's top beside a block
    // it does not belong to. The paragraph case above is what makes this
    // one meaningful: the same mount, the same boxes, and only the style
    // missing.
    const { target } = render(PageScreen, {
      dateLabel: "today", page: pageRow({ content_json: TWO_BLOCKS }),
    });
    await settle();
    stubBoxes(target, { canvasTop: 100, blockTops: [140, 260], lineHeight: null });

    caretTo(target, 1);
    expect(handles(target)[0].style.top).toBe("40px");
  });

  it("moves the handle to the block the caret moves to", async () => {
    // The defect this is written against is live in the desktop tree: its
    // touch gutter toolbar is populated on a tap and never re-resolved on a
    // selection change, so it stays beside the block you left and acts on
    // it. Asserting the TOP as well as the block is what catches a handle
    // that re-resolves its target but not its place.
    const onBlockHandle = vi.fn();
    const { target } = render(PageScreen, {
      dateLabel: "today",
      page: pageRow({ content_json: TWO_BLOCKS }),
      onBlockHandle,
    });
    await settle();
    stubBoxes(target, { canvasTop: 100, blockTops: [140, 260] });

    caretTo(target, 1);
    expect(handles(target)[0].style.top).toBe("30.8px");

    // 260 - 100 - 9.2: the second block's top, shifted the same way.
    caretTo(target, 9);
    expect(handles(target)[0].style.top).toBe("150.8px");

    tapHandle(target);
    expect(onBlockHandle.mock.calls.at(-1)[0].pos).toBe(7);
  });

  it("hands the active block up when the handle is tapped", async () => {
    const onBlockHandle = vi.fn();
    const { target } = render(PageScreen, {
      dateLabel: "today",
      page: pageRow({ content_json: TWO_BLOCKS }),
      onBlockHandle,
    });
    await settle();
    stubBoxes(target, { canvasTop: 100, blockTops: [140, 260] });
    caretTo(target, 1);

    tapHandle(target);

    // The block itself, not a position or an element: what the host does
    // with it is decide the sheet's rows, and blockActionsFor wants three
    // of these five fields (block-actions.js). A handle that handed up a
    // pos alone would make the host re-derive what the snapshot already
    // computed.
    expect(onBlockHandle).toHaveBeenCalledTimes(1);
    expect(onBlockHandle.mock.calls[0][0]).toMatchObject({
      type: "paragraph", pos: 0, isBoard: false, isTitled: false, isEmpty: false,
    });
  });

  it("reports which step declined, with a live subscriber watching", async () => {
    // THE CRASH THIS CLOSES, and the reason nothing here saw it. The reason
    // used to be published from INSIDE gutterHandle's $derived. A store
    // write there wakes $handleReadout in ViewportReadout, which updates
    // component state while the derived is still evaluating, and Svelte
    // throws state_unsafe_mutation — the whole shell rendered an empty
    // document behind an onboarding gate that was working fine.
    //
    // The suite could not see it because handleReadout has no subscriber
    // unless ViewportReadout is mounted, and that only happens in a
    // VITE_VIEWPORT_READOUT build. With nobody listening the write touches
    // no state and nothing throws. So the subscriber is the fixture: this
    // test IS the readout, standing in for a build flag.
    // The subscriber has to be a COMPONENT, not a bare store.subscribe:
    // the error needs a `$store` auto-subscription, which is what creates
    // the reactive state Svelte then refuses to let a derived write into. A
    // plain subscribe does not reproduce it — checked, by reintroducing the
    // bug and watching this stay green.
    render(ViewportReadout, {});

    const seen = [];
    const stop = handleReadout.subscribe((v) => seen.push(v.why));

    const { target } = render(PageScreen, {
      dateLabel: "today", page: pageRow({ content_json: TWO_BLOCKS }),
    });
    await settle();
    stubBoxes(target, { canvasTop: 100, blockTops: [140, 260] });
    caretTo(target, 1);
    await tick();

    stop();
    // It got as far as drawing one, which is the half that proves the
    // derived ran to completion rather than dying in the middle.
    expect(seen.at(-1)).toBe("ok");
    expect(handles(target).length).toBe(1);
  });

  it("draws the handle as three dots, not as a character", async () => {
    // The glyph was ⋮ (U+22EE) until a device showed a 44px handle that was
    // in the DOM, tappable, and invisible: the bundled DM Mono is a
    // 138-codepoint subset ending at U+2113, so every symbol in shell
    // chrome is drawn by whatever the platform substitutes, and an Android
    // fallback chain need not carry Mathematical Operators. Three spans
    // cannot go missing. shell-rules.test.js refuses the character; this
    // holds that what replaced it is actually rendered.
    const { target } = render(PageScreen, {
      dateLabel: "today", page: pageRow({ content_json: TWO_BLOCKS }),
    });
    await settle();
    stubBoxes(target, { canvasTop: 100, blockTops: [140, 260] });
    caretTo(target, 1);

    const dots = target.querySelector(".ps-gutter .ps-handle-dots");
    expect(dots).not.toBeNull();
    expect(dots.querySelectorAll("span").length).toBe(3);
  });

  it("shows no handle before the page loads", async () => {
    // No handle is the requirement, not an artefact of nothing having
    // happened yet: the canvas renders on every boot before the row lands,
    // and a handle with no block to address would sit at the top of an
    // empty canvas offering actions on nothing.
    //
    // THIS COMMENT USED TO CLAIM this was the ONLY no-active-block state
    // the schema can reach — "a live editor always has a caret at depth 1
    // or a NodeSelection at depth 0". That was wrong, and it cost a device
    // pass: a GapCursor is depth 0 with no `node`, a phone produces one by
    // tapping the margin under the last block, and the handle vanished
    // along with `turn into` and `pin`. AllSelection is a third. Both are
    // now answered in editor-snapshot.js and tested there; a comment that
    // says a state is unreachable is how the next reader stops looking.
    const { target } = render(PageScreen, { dateLabel: "today", page: null });
    await settle();

    expect(target.querySelector(".tiptap-editor")).toBeNull();
    expect(handles(target).length).toBe(0);
  });
});

// The lift. §3: a long press on the gutter handle lifts the block, and
// `dragActive` — gestureOwner's first row, and the only row of that table
// that had never had a producer anywhere in the tree — gets one.
//
// Every test here holds the clock. The hold threshold is 350ms of real
// time, and a suite that waited it out would spend a third of a second per
// case for a number that is not what is being asserted: what these hold is
// that the press is decided by LONG_PRESS_MS and the touch slop, not that
// setTimeout works.
describe("PageScreen — a long press lifts the block", () => {
  async function liftable(props = {}) {
    vi.useFakeTimers();
    const rendered = render(PageScreen, {
      dateLabel: "today",
      page: pageRow({ content_json: TWO_BLOCKS }),
      ...props,
    });
    await settle();
    stubBoxes(rendered.target, { canvasTop: 100, blockTops: [140, 260] });
    caretTo(rendered.target, 1);
    return rendered;
  }

  const firstBlock = (target) => target.querySelector(".ProseMirror > p");

  it("arms the drag when the handle is held past the threshold", async () => {
    const onDragActive = vi.fn();
    const onBlockHandle = vi.fn();
    const { target } = await liftable({ onDragActive, onBlockHandle });

    handlePointer(target, "pointerdown", { x: 20, y: 140 });
    vi.advanceTimersByTime(350);
    flushSync();

    // The block the HANDLE addresses, not whatever the finger is over: the
    // handle follows the caret, and the press picks its block up at
    // pointerdown so a transaction arriving mid-hold cannot move it.
    expect(onDragActive).toHaveBeenCalledTimes(1);
    expect(onDragActive).toHaveBeenCalledWith(true);
    // Visible, and on ProseMirror's own node — the block is the editor's
    // DOM, so the lift cannot be a class in PageScreen's template.
    expect(firstBlock(target).classList.contains("ps-lifted")).toBe(true);
    expect(target.querySelector(".ps-gutter").classList.contains("lifting")).toBe(true);
    // A hold is not a tap: the sheet P2d opens must not also be up, or the
    // writer is dragging a block behind a menu.
    expect(onBlockHandle).not.toHaveBeenCalled();
  });

  it("keeps the block lifted once ProseMirror has had a turn", async () => {
    // The one assertion in this file that ever leaves the synchronous turn,
    // and the reason it had to. Every other lift test asserts immediately
    // after flushSync — which is why nine phases of them agreed the lift
    // worked while it was invisible on a device.
    //
    // The mark used to be `nodeDOM(pos).classList.add("ps-lifted")`, here
    // in PageScreen. ProseMirror's DOMObserver reads a foreign attribute
    // change on a node it owns as a DOM change to reconcile: it marks the
    // node dirty and redraws it from the doc, and the class leaves with the
    // element it replaced. The observer delivers on a microtask under jsdom
    // (~100ms in a browser, measured by `shell-page @ block-lift`), so a
    // single `await` is the whole difference between the two
    // implementations. Restore the classList version and this reddens on
    // the second expect while the first still passes — which is exactly the
    // shape of what shipped.
    //
    // What it does NOT prove is that a redraw HAPPENED here: the fix works
    // by not being a foreign mutation in the first place, so there may be
    // nothing for the observer to react to. "keeps the mark when
    // ProseMirror redraws the node" (EditorCore.test.js) forces a redraw
    // and proves it survives one; the VR state photographs the result.
    const { target } = await liftable();

    handlePointer(target, "pointerdown", { x: 20, y: 140 });
    vi.advanceTimersByTime(350);
    flushSync();
    expect(firstBlock(target).classList.contains("ps-lifted")).toBe(true);

    // Real microtasks — the fake clock above holds setTimeout, and the
    // observer is a MutationObserver, which it does not hold.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Re-queried, not held: a redraw hands the paragraph a NEW element, and
    // a reference captured before the await would answer for the orphan.
    expect(firstBlock(target).classList.contains("ps-lifted")).toBe(true);
  });

  it("still opens the block sheet on a short tap", async () => {
    // P2d's behaviour, through P2e's mechanism. The handle stopped acting
    // on pointerdown — ToolbarButton's own contract — because a control
    // that has already opened a sheet has nothing left to hold, so the tap
    // is now decided at pointerup. This is the test that says the change
    // cost nothing.
    const onDragActive = vi.fn();
    const onBlockHandle = vi.fn();
    const { target } = await liftable({ onDragActive, onBlockHandle });

    handlePointer(target, "pointerdown", { x: 20, y: 140 });
    vi.advanceTimersByTime(349);
    handlePointer(target, "pointerup", { x: 20, y: 140 });
    flushSync();

    expect(onBlockHandle).toHaveBeenCalledTimes(1);
    expect(onBlockHandle.mock.calls[0][0].pos).toBe(0);
    // Never armed, so nothing to disarm: a `false` here would mean the
    // press had lifted and let go, which is a different gesture and would
    // put the frame through a drag the user never started.
    expect(onDragActive).not.toHaveBeenCalled();
  });

  it("arms nothing when the finger drags off the handle before the hold", async () => {
    // NOT "nothing happens" for want of a better assertion: this stroke is
    // a scroll that began on the handle, and the two wrong answers are both
    // real. Arming would lift a block the writer was only scrolling past.
    // Opening the sheet at pointerup — which is what a tap decided on
    // duration alone would do — is the "I scrolled and got a menu"
    // complaint the touch slop exists to prevent. So BOTH callbacks are
    // asserted silent, and the timer is run out afterwards to prove the
    // press was dropped at the move rather than merely still pending.
    const onDragActive = vi.fn();
    const onBlockHandle = vi.fn();
    const { target } = await liftable({ onDragActive, onBlockHandle });

    handlePointer(target, "pointerdown", { x: 20, y: 140 });
    handlePointer(target, "pointermove", { x: 22, y: 100 });
    vi.advanceTimersByTime(350);
    handlePointer(target, "pointerup", { x: 22, y: 100 });
    flushSync();

    expect(onDragActive).not.toHaveBeenCalled();
    expect(onBlockHandle).not.toHaveBeenCalled();
    expect(firstBlock(target).classList.contains("ps-lifted")).toBe(false);
  });

  it("opens no sheet when a lift is released without ever moving", async () => {
    // Press, hold, think better of it, let go. The finger never left the
    // slop, so every other test of a still stroke says "tap" — and the only
    // thing that stops this one opening the sheet is that the press had
    // already become a lift. Without that guard the writer gets a block
    // sheet for a drag they abandoned, which is the P2d behaviour leaking
    // through the new gesture rather than surviving it.
    //
    // Probed rather than assumed: removing the lifted check left the shell
    // suite green at 411, because every other lift test moves the finger
    // and a moved stroke is refused by the slop instead. This is the only
    // stroke that reaches it.
    const onBlockHandle = vi.fn();
    const onDragActive = vi.fn();
    const { target } = await liftable({ onBlockHandle, onDragActive });

    handlePointer(target, "pointerdown", { x: 20, y: 140 });
    vi.advanceTimersByTime(350);
    flushSync();
    handlePointer(target, "pointerup", { x: 20, y: 140 });
    flushSync();

    expect(onDragActive.mock.calls).toEqual([[true], [false]]);
    expect(onBlockHandle).not.toHaveBeenCalled();
  });

  it("opens no sheet when the release lands away from the handle with no move to report it", async () => {
    // The stroke the move handler never sees. pointerup carries the final
    // position, and a pointermove at that position is not promised: a fast
    // flick ends past the last sample delivered, and a coalescing stream
    // can skip the rest of one. So the release itself is the first evidence
    // that this was a drag, and without the slop check on that release it
    // would read as a tap and open a sheet the writer was scrolling away
    // from.
    //
    // This is the only test that reaches the second of the two slop checks.
    // Removing it left the shell suite green at 410, because pressMove had
    // already abandoned every other moved stroke — the two mechanisms hid
    // each other exactly.
    const onDragActive = vi.fn();
    const onBlockHandle = vi.fn();
    const { target } = await liftable({ onDragActive, onBlockHandle });

    handlePointer(target, "pointerdown", { x: 20, y: 140 });
    handlePointer(target, "pointerup", { x: 24, y: 420 });
    flushSync();

    expect(onBlockHandle).not.toHaveBeenCalled();
    expect(onDragActive).not.toHaveBeenCalled();
  });

  it("keeps the lift while the finger moves after it, and drops it on release", async () => {
    // The slop stops mattering once the block is up — that is the whole
    // gesture — so a move after the hold must not disarm what the hold
    // armed. The release ends the drag; WHERE the block lands is Task 3.
    const onDragActive = vi.fn();
    const { target } = await liftable({ onDragActive });

    handlePointer(target, "pointerdown", { x: 20, y: 140 });
    vi.advanceTimersByTime(350);
    handlePointer(target, "pointermove", { x: 24, y: 240 });
    flushSync();
    expect(firstBlock(target).classList.contains("ps-lifted")).toBe(true);

    handlePointer(target, "pointerup", { x: 24, y: 240 });
    flushSync();

    expect(onDragActive.mock.calls).toEqual([[true], [false]]);
    expect(firstBlock(target).classList.contains("ps-lifted")).toBe(false);
  });

  it("drops the lift when the system takes the stroke", async () => {
    // pointercancel is the OS claiming the gesture — a system edge swipe, a
    // call arriving. ShellRoot reports nothing for one; this must not leave
    // a block lifted with no finger on it, which is a frame stuck in a drag
    // that can never end.
    const onDragActive = vi.fn();
    const { target } = await liftable({ onDragActive });

    handlePointer(target, "pointerdown", { x: 20, y: 140 });
    vi.advanceTimersByTime(350);
    handlePointer(target, "pointercancel", { x: 20, y: 140 });
    flushSync();

    expect(onDragActive.mock.calls).toEqual([[true], [false]]);
    expect(firstBlock(target).classList.contains("ps-lifted")).toBe(false);
  });

  it("leaves no listener and no pending hold behind when the canvas goes", async () => {
    // The press outlives the component otherwise: three window listeners
    // and a timer that would call the host's onDragActive(true) against a
    // canvas that no longer exists, leaving the frame in a drag no finger
    // is holding and nothing left to end it.
    const onDragActive = vi.fn();
    const { target, cleanup } = await liftable({ onDragActive });

    handlePointer(target, "pointerdown", { x: 20, y: 140 });
    cleanup();
    vi.advanceTimersByTime(350);

    expect(onDragActive).not.toHaveBeenCalled();
  });
});

// The drag. §3: the lifted block follows the finger, a hairline draws
// between blocks where it would land, and the canvas scrolls itself within
// 60px of either edge.
//
// jsdom has no layout and no scrolling, so every box below is stubbed and
// what these hold is the MODEL the indicator renders from — which gap it
// names, and that the gap changes when it should. Whether 2px of accent
// looks like a hairline beside Lora is Task 4's screenshot and the device
// pass's.
//
// Three blocks, not two, because two cannot tell a tracking indicator from
// a stuck one: with two blocks every downward drag ends at the same gap.
// `first` (0-7, caret at 1), `second` (7-15, caret at 8), `third` (15-22).
const THREE_BLOCKS = JSON.stringify({
  type: "doc",
  content: [para("first"), para("second"), para("third")],
});

// A blockquote standing in for a board: two paragraphs inside one top-level
// node, then a top-level paragraph after it. The doc has TWO children; the
// DOM has THREE <p> elements. Every assertion about container-bound
// dragging turns on that difference.
const NESTED = JSON.stringify({
  type: "doc",
  content: [
    { type: "blockquote", content: [para("one"), para("two")] },
    para("tail"),
  ],
});

/** The indicator, or null. */
const dropLine = (target) => target.querySelector(".ps-drop-line");

/** Which gap the model named — the number Task 3 will hand moveBlock — read
 *  off the element rather than inferred from its pixel offset. */
const dropIndex = (target) => dropLine(target)?.dataset.index ?? null;

describe("PageScreen — the block follows the finger", () => {
  /** A page whose blocks have real heights, lifted at the first one.
   *  Viewport tops 140/240/340, 100px each, so the midpoints the drop
   *  target turns on are 190/290/390. The canvas sits at 100, which makes
   *  the canvas-local gaps 40/140/240 and the end 340. */
  async function dragging({
    content = THREE_BLOCKS,
    caret = 1,
    blockTops = [140, 240, 340],
    blockHeights = [100, 100, 100],
    ...props
  } = {}) {
    vi.useFakeTimers();
    const rendered = render(PageScreen, {
      dateLabel: "today",
      page: pageRow({ content_json: content }),
      ...props,
    });
    await settle();
    const boxes = stubBoxes(rendered.target, {
      canvasTop: 100,
      blockTops,
      blockHeights,
    });
    caretTo(rendered.target, caret);
    return { ...rendered, boxes };
  }

  function liftAt(target, y) {
    handlePointer(target, "pointerdown", { x: 20, y });
    vi.advanceTimersByTime(350);
    flushSync();
  }

  it("draws no indicator until a block is lifted", async () => {
    // Nothing-drawn is the requirement, not an artefact of an empty page:
    // a hairline on a page nobody is dragging tells the writer a block is
    // about to move when none is. The second half is what stops this
    // passing on an indicator that never renders at all — the same mount
    // then lifts and the line has to appear.
    const { target } = await dragging();
    expect(dropLine(target)).toBeNull();

    liftAt(target, 140);
    expect(dropLine(target)).not.toBeNull();
  });

  it("draws the indicator at the gap the finger is over", async () => {
    const { target } = await dragging();
    liftAt(target, 140);

    // Lifted on its own top, so the gap is its own: index 0, and the line
    // sits on the block's top edge — canvas-local 40.
    expect(dropIndex(target)).toBe("0");
    expect(dropLine(target).style.top).toBe("40px");

    // Past the second block's midpoint (290): the block would land between
    // `second` and `third`. The MODEL index is 1, because moveBlockTo walks
    // the parent with `first` already removed — [second, third], and
    // "between them" is 1. The LINE is at the third block's top (240),
    // because nothing has moved yet and that is the gap on screen. Those
    // two numbers disagreeing is the whole reason insertionLineIndex
    // exists; asserting only one of them would hide it.
    handlePointer(target, "pointermove", { x: 24, y: 300 });
    flushSync();
    expect(dropIndex(target)).toBe("1");
    expect(dropLine(target).style.top).toBe("240px");

    // Past the last block entirely: append. The gap below the last block
    // has no rect of its own, so it is read off that block's bottom —
    // 340 + 100, canvas-local 340.
    handlePointer(target, "pointermove", { x: 24, y: 500 });
    flushSync();
    expect(dropIndex(target)).toBe("2");
    expect(dropLine(target).style.top).toBe("340px");
  });

  it("moves the indicator the moment the finger crosses a boundary", async () => {
    // Step 5, and the one thing an indicator must do: 10px of finger either
    // side of the second block's midpoint (290) is the difference between
    // "stays where it is" and "goes after second". An indicator that
    // renders and does not track is worse than none, because it is a
    // confident answer that is wrong.
    const { target } = await dragging();
    liftAt(target, 140);

    handlePointer(target, "pointermove", { x: 24, y: 280 });
    flushSync();
    expect(dropIndex(target)).toBe("0");
    expect(dropLine(target).style.top).toBe("40px");

    handlePointer(target, "pointermove", { x: 24, y: 300 });
    flushSync();
    expect(dropIndex(target)).toBe("1");
    expect(dropLine(target).style.top).toBe("240px");
  });

  it("tracks an upward drag without the downward shift", async () => {
    // Lifted at `third` (index 2) and carried up into `first`'s top half.
    // The raw gap is 1 and so is the model index — removing a block that
    // sits AFTER the target shifts nothing before it — so unlike the
    // downward case above, the two numbers agree. Asserted because a
    // caller that "corrected" for the removal in both directions would
    // put every upward drop one slot too high, and every downward
    // assertion in this file would still pass.
    const { target } = await dragging({ caret: 16 });
    liftAt(target, 340);
    expect(dropIndex(target)).toBe("2");

    handlePointer(target, "pointermove", { x: 24, y: 200 });
    flushSync();
    expect(dropIndex(target)).toBe("1");
    expect(dropLine(target).style.top).toBe("140px");
  });

  it("puts the indicator away on release and on a cancelled stroke", async () => {
    // Both ends of the drag, in one test because the requirement is the
    // same: no finger, no line. A hairline left behind after the drop is a
    // permanent claim about where a block is going.
    const { target } = await dragging();

    liftAt(target, 140);
    handlePointer(target, "pointerup", { x: 24, y: 300 });
    flushSync();
    expect(dropLine(target)).toBeNull();

    liftAt(target, 140);
    expect(dropLine(target)).not.toBeNull();
    handlePointer(target, "pointercancel", { x: 24, y: 300 });
    flushSync();
    expect(dropLine(target)).toBeNull();
  });

  it("scrolls the canvas while the finger is held in the bottom band", async () => {
    // §3's 60px band, on a band running 120-600: 590 is 50px into it, so
    // autoScrollSpeed answers round(50/60 * 12) = 10px per frame. The
    // finger never moves again — that is the case the loop exists for, and
    // a scroll driven off pointermove alone would stop dead here.
    const { target } = await dragging();
    const band = stubBand(target, { top: 120, bottom: 600 });
    liftAt(target, 140);

    const before = band.scrollTop;
    handlePointer(target, "pointermove", { x: 24, y: 590 });
    flushSync();
    vi.advanceTimersByTime(100);

    expect(band.scrollTop).toBeGreaterThan(before);
    expect(band.scrollTop % 10).toBe(0);
  });

  it("does not scroll while the finger is in the middle of the canvas", async () => {
    // Zero everywhere but the two bands, and this is not a spare assertion:
    // a canvas that creeps whenever a block is up is unusable, and the loop
    // runs on EVERY frame of every drag, so a wrong answer here fires
    // sixty times a second. Proven to be a real check rather than a mount
    // that never scrolls by the test above, which moves the same band.
    const { target } = await dragging();
    const band = stubBand(target, { top: 120, bottom: 600 });
    liftAt(target, 140);

    handlePointer(target, "pointermove", { x: 24, y: 360 });
    flushSync();
    vi.advanceTimersByTime(100);

    expect(band.scrollTop).toBe(0);
  });

  it("re-aims the indicator when the canvas moves under a still finger", async () => {
    // The lift-time rects stop describing the screen the instant the canvas
    // scrolls, which is exactly what the band above does to itself. The
    // finger is held at 280 throughout: before the scroll that is `first`'s
    // own gap, after 100px of scroll the blocks have travelled up past it
    // and the same finger is between `second` and `third`.
    //
    // No pointer event fires here. The frame loop is what re-asks, and it
    // is the only thing that can — this is the case a recompute wired to
    // pointermove alone cannot see.
    const { target, boxes } = await dragging();
    stubBand(target, { top: 120, bottom: 600 });
    liftAt(target, 140);

    handlePointer(target, "pointermove", { x: 24, y: 280 });
    flushSync();
    expect(dropIndex(target)).toBe("0");

    boxes.scrollCanvas(100);
    vi.advanceTimersByTime(20);
    flushSync();

    expect(dropIndex(target)).toBe("1");
    expect(dropLine(target).style.top).toBe("240px");
  });

  it("keeps a top-level block out of a board's children", async () => {
    // §3's container rule. The doc here has two children — a blockquote
    // standing in for a board, and a paragraph — while the DOM has three
    // <p> elements inside them. The rects are walked from the doc, so the
    // paragraphs inside the blockquote are not gaps this drag can name: the
    // model can only answer 0 or 1, and it never gets to say "between the
    // blockquote's two lines".
    //
    // A walk over `.ProseMirror p` would answer differently at the very
    // first probe — index 1 rather than 0 — which is what makes this a test
    // of the container filter rather than of the drag in general.
    //
    // Two boxes, not three: the blockquote is 200px tall and holds both of
    // its paragraphs, and the tail paragraph follows it. stubBoxes asserts
    // the count against the DOM's top-level children, so getting this wrong
    // fails loudly rather than stubbing the wrong element.
    const { target } = await dragging({
      content: NESTED,
      caret: 2,
      blockTops: [140, 340],
      blockHeights: [200, 100],
    });
    liftAt(target, 140);

    handlePointer(target, "pointermove", { x: 24, y: 200 });
    flushSync();
    expect(dropIndex(target)).toBe("0");
    expect(dropLine(target).style.top).toBe("40px");

    // Carried past everything: the last gap in a two-child container is 1,
    // full stop. An extra rect anywhere in the list would show up here as
    // a 2.
    handlePointer(target, "pointermove", { x: 24, y: 800 });
    flushSync();
    expect(dropIndex(target)).toBe("1");
  });
});

// The drop, and §3's two cancels. Every assertion in this block reads the
// DOCUMENT, because the document is the only witness that can tell a drop
// from a cancel: `dragActive` goes false either way, the indicator is put
// away either way, and no error is thrown either way. "No error" is
// precisely the assertion this codebase has shipped a silent bug behind
// before, so it is not the assertion here.
//
// WHAT THESE CANNOT SEE, said up front rather than left implied. The
// origin cancel is protected TWICE — once by drop-release.js's rule and
// once by moveNodeToIndex, which returns false when the target index
// equals the block's own — so the doc-level assertion below stays green
// even if the component drops on origin anyway. Proven, not assumed:
// forcing every release to drop reddens the leaving-the-canvas case and
// leaves the origin case passing. That is why the origin rule has its own
// unit test in drop-release.test.js; this one holds the outcome, not the
// rule.
describe("PageScreen — the drop, and two ways to change your mind", () => {
  /** The document's top-level blocks, as text, read off the live editor.
   *  Not the rendered DOM: after a drop ProseMirror re-creates elements and
   *  a DOM read would be asserting the view's recovery rather than the doc's
   *  order, which is what actually persists. */
  const blockTexts = (target) =>
    target
      .querySelector(".ProseMirror")
      .editor.getJSON()
      .content.map((n) => n.content?.[0]?.text ?? "");

  /** Three 100px blocks at 140/240/340 — midpoints 190/290/390 — a canvas
   *  at 100 and a real content band at 120-600. The band is stubbed rather
   *  than left at jsdom's 0x0 on purpose: a box measuring nothing is the
   *  case drop-release.js deliberately declines to read as "left the
   *  canvas", so a drop over an unstubbed band would prove the degenerate
   *  path rather than the live one. */
  async function dropping({ content = THREE_BLOCKS, caret = 1 } = {}) {
    vi.useFakeTimers();
    const rendered = render(PageScreen, {
      dateLabel: "today",
      page: pageRow({ content_json: content }),
    });
    await settle();
    stubBoxes(rendered.target, {
      canvasTop: 100,
      blockTops: [140, 240, 340],
      blockHeights: [100, 100, 100],
    });
    stubBand(rendered.target, { top: 120, bottom: 600 });
    caretTo(rendered.target, caret);
    return rendered;
  }

  function liftAt(target, y) {
    handlePointer(target, "pointerdown", { x: 20, y });
    vi.advanceTimersByTime(350);
    flushSync();
  }

  it("moves the block into the gap the indicator named", async () => {
    const { target } = await dropping();
    expect(blockTexts(target)).toEqual(["first", "second", "third"]);

    liftAt(target, 140);
    handlePointer(target, "pointermove", { x: 24, y: 300 });
    flushSync();
    // The model the writer was shown: past `second`'s midpoint, so the
    // block lands between `second` and `third`. Asserted first so a
    // failure below can be told apart from the drag having aimed wrong.
    expect(dropIndex(target)).toBe("1");

    handlePointer(target, "pointerup", { x: 24, y: 300 });
    flushSync();

    // The document, not a callback and not a class. This is the whole
    // point of the task: the index the hairline promised is the index the
    // doc ends up in.
    expect(blockTexts(target)).toEqual(["second", "first", "third"]);
    expect(dropLine(target)).toBeNull();
  });

  it("carries a block upward as well as down", async () => {
    // The direction dropTargetIndex applies no shift in. A caller that
    // double-corrected would put this one slot too high — landing
    // ["third", "first", "second"] — and every downward assertion in this
    // file would still pass. moveNodeToIndex clamps against the
    // PRE-removal childCount - 1, which is exactly dropTargetIndex's
    // documented maximum, so this also stands as the check that the two
    // agree at the one place they meet.
    const { target } = await dropping({ caret: 16 });
    liftAt(target, 340);
    handlePointer(target, "pointermove", { x: 24, y: 200 });
    flushSync();
    expect(dropIndex(target)).toBe("1");

    handlePointer(target, "pointerup", { x: 24, y: 200 });
    flushSync();

    expect(blockTexts(target)).toEqual(["first", "third", "second"]);
  });

  it("aims at where the finger came off, not at the last move it reported", async () => {
    // pointerup carries a position and a pointermove at that position is
    // not promised — the same fact the tap's second slop check exists for.
    // Here the stroke's last MOVE is over `first`'s own gap and its
    // RELEASE is past everything, so a drop decided on the stale point
    // would cancel as "origin" and the doc would not move at all. The
    // release is re-aimed instead.
    const { target } = await dropping();
    liftAt(target, 140);
    handlePointer(target, "pointermove", { x: 24, y: 160 });
    flushSync();
    expect(dropIndex(target)).toBe("0");

    handlePointer(target, "pointerup", { x: 24, y: 500 });
    flushSync();

    expect(blockTexts(target)).toEqual(["second", "third", "first"]);
  });

  it("leaves the document untouched when the block is released back where it started", async () => {
    // §3's first cancel. The empty result is right because the writer
    // said so: they carried the block out to the gap after `second`, saw
    // the hairline there, brought it back over its own gap and let go.
    // That is the gesture for "no", and an app that reordered anyway
    // would be moving a block on a stroke whose last frame promised it
    // would not.
    //
    // What this assertion does NOT prove — and the reason it is written
    // down rather than left as an unqualified green — is that the shell
    // obeyed the rule. moveNodeToIndex refuses a target equal to the
    // block's own index, so the document reads the same whether
    // drop-release.js's origin branch ran or not. The rule itself is held
    // by drop-release.test.js, where the ANSWER ("origin", not "drop") is
    // visible; this holds the outcome the writer sees.
    const { target } = await dropping();
    liftAt(target, 140);
    handlePointer(target, "pointermove", { x: 24, y: 300 });
    flushSync();
    expect(dropIndex(target)).toBe("1");

    handlePointer(target, "pointermove", { x: 24, y: 160 });
    flushSync();
    expect(dropIndex(target)).toBe("0");

    handlePointer(target, "pointerup", { x: 24, y: 160 });
    flushSync();

    expect(blockTexts(target)).toEqual(["first", "second", "third"]);
  });

  it("leaves the document untouched when the finger leaves the canvas", async () => {
    // §3's second cancel, and the sharp one: the release is at 700, below
    // the band's 600 floor, over what on a phone is the bottom slot. The
    // gap under the finger there is 2 — emphatically NOT the origin — so
    // nothing but this rule can produce the empty result. Without it the
    // doc would read ["second", "third", "first"].
    //
    // The empty result is right because leaving the writing surface is
    // how a writer says "no" to a drag they have already committed a
    // finger to; there is nowhere below the canvas for a block to go, and
    // guessing the last gap it passed over is a reorder the writer never
    // asked for.
    const { target } = await dropping();
    liftAt(target, 140);
    handlePointer(target, "pointermove", { x: 24, y: 300 });
    flushSync();
    expect(dropIndex(target)).toBe("1");

    handlePointer(target, "pointerup", { x: 24, y: 700 });
    flushSync();

    expect(blockTexts(target)).toEqual(["first", "second", "third"]);
    expect(dropLine(target)).toBeNull();
  });

  it("leaves the document untouched when the system takes the stroke", async () => {
    // Not one of §3's two, and included because it is the path that would
    // reorder by accident rather than by a wrong rule: pointercancel is
    // the OS claiming the gesture mid-drag — an edge swipe, a call
    // arriving — and it never reaches the release decision at all. The
    // empty result is right because the writer never let go: a stroke the
    // system took away carries no instruction, and finishing it on their
    // behalf would move a block they were still deciding about.
    const { target } = await dropping();
    liftAt(target, 140);
    handlePointer(target, "pointermove", { x: 24, y: 300 });
    flushSync();
    expect(dropIndex(target)).toBe("1");

    handlePointer(target, "pointercancel", { x: 24, y: 300 });
    flushSync();

    expect(blockTexts(target)).toEqual(["first", "second", "third"]);
  });
});

/** One pointer event of a press on the handle.
 *
 *  pointerdown goes to the button, so it reaches the gutter column by
 *  bubbling exactly as a real touch does. Everything after it goes to
 *  `window`, which is where the component listens — see its header: a
 *  finger that has lifted a block leaves the 44px column immediately, and
 *  a listener on the element it left hears nothing more.
 *
 *  Coordinates matter now. The column measures the stroke against
 *  pointer-gesture.js's touch slop, so a helper that left them at 0 could
 *  never describe a drag. */
function handlePointer(target, type, { x = 0, y = 0, id = 1 } = {}) {
  const from = type === "pointerdown" ? target.querySelector(".ps-gutter button") : window;
  from.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: id,
    }),
  );
}

/** A tap on the handle: down and up, inside the slop, released before the
 *  hold threshold.
 *
 *  It used to be pointerdown alone, because ToolbarButton acts on
 *  pointerdown — and that is precisely what P2e had to change, since a
 *  control that has already opened a sheet has nothing left to hold. What
 *  this helper drives is unchanged behaviour through a changed mechanism:
 *  every assertion below it stayed as written. */
function tapHandle(target) {
  handlePointer(target, "pointerdown");
  handlePointer(target, "pointerup");
  flushSync();
}

// jsdom applies no scoped Svelte stylesheet, so nothing rendered can see a
// padding — the same limit Field.test.js and ShellRoot.test.js hit, and
// shell-rules.test.js answers the same way: read the source.
describe("PageScreen — the left edge", () => {
  it("aligns the page's two bands on one left edge", () => {
    // What this holds is the P2d debt P2f Task 4 paid. The canvas reserves
    // var(--tap) on the left for the block handle; the title zone above it
    // was at var(--space-4), which is 30px narrower on a phone (--space-4
    // is 1rem against a scaled root; --tap has a 44px floor no scale
    // moves). A title and its body share one column or they read as a
    // misalignment.
    const src = readFileSync("src/shell/PageScreen.svelte", "utf8");
    const rule = (selector) => {
      const m = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(src);
      expect(m, `no ${selector} rule in PageScreen.svelte`).toBeTruthy();
      return m[1];
    };
    expect(rule("\\.ps-wmn")).toMatch(/padding:[^;]*var\(--tap\)/);
    expect(rule("\\.ps-canvas")).toMatch(/padding:[^;]*var\(--tap\)/);
  });

  it("sets the title zone in the reading face, a step under the reading view's title", () => {
    // Visual pass, Task 9. The zone is the writer's own sentence about
    // the day — the line the reading view sets as its Title in Lora — and
    // it was in the interface face at --text-sm, the role the shell gives
    // to what the interface NAMES. Prose over prose, at --text-base rather
    // than Title's --text-xl because here it sits above the body it names
    // and must not outweigh it. Source-read for the same reason as the
    // edge test above.
    const src = readFileSync("src/shell/PageScreen.svelte", "utf8");
    const m = /\.ps-wmn\s*\{([^}]*)\}/.exec(src);
    expect(m, "no .ps-wmn rule in PageScreen.svelte").toBeTruthy();
    expect(m[1]).toMatch(/font-family:\s*var\(--font-prose\)/);
    expect(m[1]).toMatch(/font-size:\s*var\(--text-base\)/);
    expect(m[1]).not.toMatch(/var\(--font-ui\)/);
  });
});

// ── the focus line ────────────────────────────────────────────────────
//
// The second device pass: "what matters are not clickable cannot change".
// The line was two spans, and nothing in the shell had ever written the
// column. These hold the field, and what leaving it writes.
describe("PageScreen focus line", () => {
  it("sets the line as text, not a field, on a page it cannot write", async () => {
    const { target } = render(PageScreen, {
      dateLabel: "yesterday",
      page: pageRow({ is_open: false }),
      whatMattersNow: "the closed day",
    });
    await settle();
    expect(target.querySelector(".ps-wmn input")).toBeNull();
    expect(target.querySelector(".ps-wmn-text").textContent).toBe("the closed day");
  });

  it("writes nothing when the writer only passes through the field", () => {
    // A blur is not an edit — focus-line.js, quoting WhatMattersNow's own
    // handleBlur. Every tap that leaves the field blurs it; a write here
    // would send the same title on every one, each with a newer clock.
    const onFocusLine = vi.fn();
    const { target } = render(PageScreen, {
      dateLabel: "today", whatMattersNow: "the book", onFocusLine,
    });
    // No flush between render and blur, on purpose: the draft is a
    // writable $derived of the prop (PageScreen's `focusDraft`), so it is
    // right synchronously. It was $state seeded by an effect once, and
    // this test — blurring before the effect ran — committed "" over "the
    // book"; the window is a microtask here and real on a device.
    const input = target.querySelector(".ps-wmn input");
    input.dispatchEvent(new FocusEvent("blur"));
    expect(onFocusLine).not.toHaveBeenCalled();
  });

  it("writes the trimmed line when the writer leaves it changed", () => {
    const onFocusLine = vi.fn();
    const { target } = render(PageScreen, {
      dateLabel: "today", whatMattersNow: "the book", onFocusLine,
    });
    const input = target.querySelector(".ps-wmn input");
    input.value = "  the book, chapter 4 ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("blur"));
    expect(onFocusLine).toHaveBeenCalledTimes(1);
    expect(onFocusLine).toHaveBeenCalledWith("the book, chapter 4");
  });

  it("hands the caret to the prose on Enter, after writing the line", async () => {
    const onFocusLine = vi.fn();
    let editor = null;
    const { target } = render(PageScreen, {
      dateLabel: "today", page: pageRow(), onFocusLine, onEditor: (e) => { editor = e; },
    });
    await settle();
    // A spy on the view, not document.activeElement: jsdom will not focus
    // a contenteditable host (measured — activeElement stays BODY and
    // editor.isFocused stays false after view.focus()), so the strongest
    // claim this environment can make is that the editor was ASKED. TipTap's
    // focus command reaches view.focus() one frame later.
    const focus = vi.spyOn(editor.view, "focus");
    const input = target.querySelector(".ps-wmn input");
    input.focus();
    input.value = "finish the chapter";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(onFocusLine).toHaveBeenCalledWith("finish the chapter");
    // The desktop's order: the input is released BEFORE the editor is
    // focused, or ProseMirror's focus races the input's own key cycle.
    expect(document.activeElement).not.toBe(input);
    await new Promise((r) => requestAnimationFrame(() => r()));
    expect(focus).toHaveBeenCalled();
  });
});
