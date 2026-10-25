import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { flushSync, createRawSnippet } from "svelte";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import {
  navBack, navPush, subscribe, initNavStack, _resetForTests,
} from "../../../lib/navstack.js";
import Sheet from "../Sheet.svelte";

// jsdom implements pushState/back, but back() is async and flaky in tests —
// navstack.test.js's setup, reused rather than reinvented. historyStates is
// the thing the assertions below actually care about: navstack's invariant
// is one history state per entry, and the way to break it is to rewind one
// too many.
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

// One hook, in one explicit order, rather than two afterEach registrations
// whose relative order is a vitest configuration detail: the sheets have to
// unmount while the history stubs are still installed, because unmounting is
// one of the paths that closes a nav entry and therefore rewinds history.
afterEach(() => {
  cleanupAll();
  navTeardown();
  vi.restoreAllMocks();
});

/** navstack's live view, read the way a host reads it. */
function nav() {
  let snap = null;
  subscribe((s) => { snap = s; })();
  return snap;
}

/** Every sheet on screen, across every mounted test container. */
function sheetsOnScreen() {
  return [...document.querySelectorAll(".shell-sheet")].map((n) => n.dataset.sheet);
}

// A real pointer event with a real timestamp — Stack.test.js's helper, for
// its reason: jsdom stamps an event at construction, so a stroke built in
// one synchronous statement lands on a single sub-millisecond and the
// velocity the recogniser reports is whatever the clock happened to do.
// timeStamp is a read-only accessor on the prototype; an own property
// shadows it.
function pointer(type, { y, t, id = 1 }) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 0,
    clientY: y,
    pointerId: id,
  });
  Object.defineProperty(event, "timeStamp", { value: t, configurable: true });
  return event;
}

// A slow release, which is the only kind sheetDetent decides by position.
// 1200ms over the whole stroke puts the tail — the last 600ms, which is
// what pointer-gesture measures — at roughly 0.2px/ms, comfortably under
// sheetDetent's 0.5px/ms threshold. Every position-decided test below goes
// through here, and the duration is set here rather than at each call so
// there is one place to look when one of them starts flicking.
function drag(el, { from, to, ms = 1200, id = 1 }) {
  el.dispatchEvent(pointer("pointerdown", { y: from, t: 0, id }));
  el.dispatchEvent(pointer("pointermove", { y: (from + to) / 2, t: ms / 2, id }));
  el.dispatchEvent(pointer("pointermove", { y: to, t: ms, id }));
  el.dispatchEvent(pointer("pointerup", { y: to, t: ms, id }));
}

/** The same stroke thrown rather than dragged: same points, 10ms apart. */
function flick(el, { from, to, ms = 10, id = 1 }) {
  drag(el, { from, to, ms, id });
}

// jsdom reports 0 for every layout box (see Screen.test.js), so scroll
// geometry is stubbed explicitly rather than faked by writing to scrollTop
// and hoping.
function setGeometry(el, { scrollTop, scrollHeight, clientHeight }) {
  Object.defineProperty(el, "scrollTop", { value: scrollTop, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
}

/** A field inside the sheet, so a teardown of its content is visible. */
function body(id) {
  return createRawSnippet(() => ({ render: () => `<input data-body="${id}" />` }));
}

// The sheet shows once it holds the module claim, which an effect decides,
// and mount effects are batched — nothing is in the DOM until this flushes.
function open(props = {}) {
  const mounted = render(Sheet, { open: true, detent: "half", halfPx: 300, fullPx: 600, ...props });
  flushSync();
  return mounted;
}

describe("Sheet", () => {
  it("renders at the detent it was given", () => {
    const { target } = open({ detent: "half" });
    expect(target.querySelector(".shell-sheet").dataset.detent).toBe("half");
  });

  it("renders nothing when closed", () => {
    // Not merely hidden: a closed sheet must not be in the tree at all,
    // or its content keeps focus and its handle stays a drag target.
    const { target } = render(Sheet, { open: false, detent: "half" });
    flushSync();
    expect(target.querySelector(".shell-sheet")).toBeNull();
  });

  it("asks sheet-detent where a downward drag from the handle lands", () => {
    const onDetent = vi.fn();
    const onDismiss = vi.fn();
    const { target } = open({ detent: "full", onDetent, onDismiss });
    // 250px down from full: past half's midpoint, so the module answers "half".
    drag(target.querySelector(".shell-sheet-handle"), { from: 0, to: 250 });
    expect(onDetent).toHaveBeenCalledWith("half");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("dismisses when the module says dismissed", () => {
    const onDetent = vi.fn();
    const onDismiss = vi.fn();
    const { target } = open({ onDetent, onDismiss });
    drag(target.querySelector(".shell-sheet-handle"), { from: 0, to: 260 });
    expect(onDismiss).toHaveBeenCalledOnce();
    // "dismissed" is not a detent the sheet can rest at, so it is reported
    // through onDismiss and never through onDetent.
    expect(onDetent).not.toHaveBeenCalled();
    // And the sheet takes itself away rather than waiting for the host to
    // notice: it was dragged off the screen, so it is off the screen.
    flushSync();
    expect(target.querySelector(".shell-sheet")).toBeNull();
  });

  it("does not drag from its content while that content is scrolled", () => {
    // §1: content-at-top drags dismiss; mid-list the same drag is the user
    // reading. Dismissing there is the "sheet closes while you scroll it"
    // bug, one region over from the same rule in gesture-owner.
    const onDismiss = vi.fn();
    const { target } = open({ contentAtTop: false, onDismiss });
    drag(target.querySelector(".shell-sheet-content"), { from: 0, to: 260 });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("drags from its content when that content is at its top", () => {
    const onDismiss = vi.fn();
    const { target } = open({ contentAtTop: true, onDismiss });
    drag(target.querySelector(".shell-sheet-content"), { from: 0, to: 260 });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("cannot be dismissed by a drag when non-dismissable", () => {
    // The midnight sheet is the case: it must be answered, not swiped away.
    const onDismiss = vi.fn();
    const { target } = open({ dismissable: false, onDismiss });
    drag(target.querySelector(".shell-sheet-handle"), { from: 0, to: 400 });
    expect(onDismiss).not.toHaveBeenCalled();
    // Still there, because "not dismissable" has to mean the sheet stays.
    flushSync();
    expect(target.querySelector(".shell-sheet")).not.toBeNull();
  });

  it("ignores a press and release with no movement between them", () => {
    // Pins that the drag is tracked through pointermove rather than
    // inferred from the down/up coordinates. Without an intervening move
    // the timeline holds one point, so the recogniser reports dy 0 and the
    // sheet keeps its detent — a down/up-only implementation reading
    // clientY off the release would read 260px of travel and dismiss.
    const onDetent = vi.fn();
    const onDismiss = vi.fn();
    const { target } = open({ onDetent, onDismiss });
    const handle = target.querySelector(".shell-sheet-handle");
    handle.dispatchEvent(pointer("pointerdown", { y: 0, t: 0 }));
    handle.dispatchEvent(pointer("pointerup", { y: 260, t: 40 }));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onDetent).toHaveBeenCalledWith("half");
  });

  it("dismisses on a fast flick that is nowhere near far enough to dismiss slowly", () => {
    // sheetDetent's velocity branch, which has never executed anywhere:
    // Sheet passed a hardcoded velocityY of 0 for two phases, so only the
    // nearest-detent comparison could ever run and a thrown sheet sprang
    // back. The two halves of this test are the same 30px of travel from
    // the same detent, and the ONLY difference is how long the finger took.
    //
    // Released slowly, 30px from half (300px) leaves the sheet 270px tall,
    // nearest to half by 30px against dismissed's 270 — so position alone
    // says "stay". That is what makes the flick assertion non-vacuous: it
    // cannot be passing on distance, because the distance is measured here
    // and it says the opposite.
    const slowDetent = vi.fn();
    const slowDismiss = vi.fn();
    const slow = open({ onDetent: slowDetent, onDismiss: slowDismiss });
    drag(slow.target.querySelector(".shell-sheet-handle"), { from: 0, to: 30 });
    expect(slowDismiss).not.toHaveBeenCalled();
    expect(slowDetent).toHaveBeenCalledWith("half");
    // Unmount before the next one, or the module-scope claim makes the
    // second sheet a replacement rather than a fresh open.
    slow.cleanup();

    const fastDismiss = vi.fn();
    const fast = open({ onDismiss: fastDismiss });
    // 30px in 10ms is 3px/ms, past both of sheetDetent's tiers (0.5px/ms
    // steps one detent, 2px/ms throws the sheet away) — and from half
    // either tier is the exit, so this test cannot tell them apart. The
    // one below can.
    flick(fast.target.querySelector(".shell-sheet-handle"), { from: 0, to: 30 });
    expect(fastDismiss).toHaveBeenCalledOnce();
  });

  it("throws a full sheet away in one flick", () => {
    // The device report: a one-field sheet at full that could not be
    // dismissed, because one step from full is half. Same 30px, same 10ms
    // as the flick above, from the other detent — the slow drag at 250px
    // in "asks sheet-detent where a downward drag from the handle lands"
    // is what proves this is not passing on distance. With
    // sheet-detent.js's dismissVelocity tier removed this lands on half
    // and onDetent fires instead.
    const onDetent = vi.fn();
    const onDismiss = vi.fn();
    const { target } = open({ detent: "full", onDetent, onDismiss });
    flick(target.querySelector(".shell-sheet-handle"), { from: 0, to: 30 });
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onDetent).not.toHaveBeenCalled();
    flushSync();
    expect(target.querySelector(".shell-sheet")).toBeNull();
  });

  // The backdrop. The report's other half: with no scrim, the only exits
  // from a sheet were the drag and the system back, and which one the
  // writer reached for is what made "could not dismiss" a sometimes.
  describe("the scrim", () => {
    /** A real tap on the scrim: a press that starts on it, then its click. */
    function tapScrim(target) {
      const scrim = target.querySelector(".shell-sheet-scrim");
      scrim.dispatchEvent(pointer("pointerdown", { y: 100, t: 0 }));
      scrim.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    }

    it("is behind the sheet, painted, and not a control", () => {
      const { target } = open();
      const scrim = target.querySelector(".shell-sheet-scrim");
      expect(scrim).not.toBeNull();
      // Earlier sibling: DOM order is what paints the sheet over it, since
      // nothing in the shell carries a z-index.
      expect(scrim.nextElementSibling.classList.contains("shell-sheet")).toBe(true);
      // Not a button (shell-rules), not announced (a backdrop offers a
      // screen-reader user nothing back and Esc do not).
      expect(scrim.tagName).toBe("DIV");
      expect(scrim.getAttribute("aria-hidden")).toBe("true");
    });

    it("is gone with the sheet", () => {
      // A scrim that outlived its sheet would be an invisible wall over
      // the whole page — the Stack lesson in reverse.
      const { target } = open();
      navBack();
      flushSync();
      expect(target.querySelector(".shell-sheet-scrim")).toBeNull();
    });

    it("dismisses a dismissable sheet on the first tap, and tells the host", () => {
      // FIRST tap: no press on the sheet before it. If the scrim did not
      // lift the seal on its own pointerdown, this tap would be swallowed
      // as the opening ghost and the writer would need a second one.
      const onDismiss = vi.fn();
      const { target } = open({ tag: "pin-edit", detent: "full", onDismiss });
      tapScrim(target);
      expect(onDismiss).toHaveBeenCalledOnce();
      flushSync();
      expect(target.querySelector(".shell-sheet")).toBeNull();
      expect(nav().depth).toBe(0);
    });

    it("absorbs the tap under a non-dismissable sheet — the sheet stays", () => {
      // Nothing happens, and that is the behaviour: midnight must be
      // answered, and a tap beside it is neither "start fresh" nor "stay
      // on yesterday". The scrim still takes the tap rather than passing
      // it to the page, which the writer can no longer type into anyway.
      const onDismiss = vi.fn();
      const { target } = open({ tag: "midnight", dismissable: false, onDismiss });
      tapScrim(target);
      expect(onDismiss).not.toHaveBeenCalled();
      flushSync();
      expect(target.querySelector(".shell-sheet")).not.toBeNull();
      expect(target.querySelector(".shell-sheet-scrim").dataset.dismissable).toBe("false");
    });

    it("does not fire on the click the opening press left behind", () => {
      // The ghost lands on the scrim, not the sheet, whenever the opener
      // sat above the sheet's rectangle — a pin row halfway up the list,
      // the gutter handle. Same seal as the sheet's, same one-click rule:
      // no pointerdown on the scrim precedes this click, so it is the
      // ghost, and a scrim that acted on it would close the sheet the
      // instant it opened.
      const onDismiss = vi.fn();
      const { target } = open({ tag: "pin-actions", onDismiss });
      target.querySelector(".shell-sheet-scrim")
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
      expect(onDismiss).not.toHaveBeenCalled();
      expect(target.querySelector(".shell-sheet")).not.toBeNull();

      // And the very next real tap is not mistaken for a second ghost.
      tapScrim(target);
      expect(onDismiss).toHaveBeenCalledOnce();
    });
  });

  describe("observes its own scroller when contentAtTop is left at its default", () => {
    // Sheet owns .shell-sheet-content; asking the HOST whether that
    // scroller is at its top is a question no host can correctly answer
    // about an element it has no handle on. The default was `true`, so
    // out of the box every sheet with a scrolling list dismissed on the
    // first downward drag mid-list — exactly the bug this component's own
    // header claims to prevent. This proves the self-observed path instead.

    it("does not dismiss on a downward drag once its content has scrolled off the top", () => {
      const onDismiss = vi.fn();
      const { target } = open({ onDismiss });
      const content = target.querySelector(".shell-sheet-content");
      setGeometry(content, { scrollTop: 400, scrollHeight: 1000, clientHeight: 500 });
      content.dispatchEvent(new Event("scroll"));
      drag(content, { from: 0, to: 260 });
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it("still dismisses on a downward drag while its content is genuinely at the top", () => {
      const onDismiss = vi.fn();
      const { target } = open({ onDismiss });
      const content = target.querySelector(".shell-sheet-content");
      setGeometry(content, { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });
      content.dispatchEvent(new Event("scroll"));
      drag(content, { from: 0, to: 260 });
      expect(onDismiss).toHaveBeenCalledOnce();
    });
  });

  describe("the nav stack", () => {
    it("registers exactly one entry while it is open", () => {
      // Exactly one, not one-or-more: navstack's invariant is one history
      // state per entry (navstack.js:11-13), so a sheet that registered
      // twice would leave a state behind that a later back press consumes
      // silently — a back that appears to do nothing.
      open({ tag: "trail" });
      expect(nav().depth).toBe(1);
      expect(nav().top).toBe("trail");
      expect(historyStates.length).toBe(1);
    });

    it("is reached by back, which closes it and tells its host", () => {
      // What aria-modal="true" has been claiming since P1b. Android system
      // back, Esc and navBack() all arrive here as one popstate.
      const onDismiss = vi.fn();
      const { target } = open({ tag: "trail", onDismiss });
      navBack();
      flushSync();
      expect(onDismiss).toHaveBeenCalledOnce();
      expect(target.querySelector(".shell-sheet")).toBeNull();
      expect(nav().depth).toBe(0);
    });

    it("closes exactly one entry when back is followed by its own unmount", () => {
      // The dangerous ordering. handlePopState has already popped the
      // entry and fired onClose by the time the host unmounts the sheet,
      // and the unmount then calls navClose on that same id. navClose
      // looks it up as `e.id === id && !e.closed` (navstack.js:72) and
      // finds nothing, so it returns — if it did not, its
      // popTrailingClosed would fire a second history.go(-1) and eat the
      // entry underneath. The screen below is that entry, and its survival
      // is the assertion: a depth check alone would pass even if the
      // sheet's own entry were closed twice.
      const belowClosed = vi.fn();
      navPush("screen", belowClosed);
      const sheet = open({ tag: "trail" });
      expect(historyStates.length).toBe(2);

      navBack();
      flushSync();
      sheet.cleanup();

      expect(belowClosed).not.toHaveBeenCalled();
      expect(nav().depth).toBe(1);
      expect(nav().top).toBe("screen");
      expect(historyStates.length).toBe(1);
    });
  });

  describe("one sheet at a time", () => {
    it("replaces the sheet already showing rather than stacking on it", () => {
      const firstDismiss = vi.fn();
      const secondDismiss = vi.fn();
      const first = open({ tag: "trail", onDismiss: firstDismiss, children: body("trail") });
      const second = open({ tag: "note", onDismiss: secondDismiss, children: body("note") });

      expect(firstDismiss).toHaveBeenCalledOnce();
      expect(secondDismiss).not.toHaveBeenCalled();
      expect(first.target.querySelector(".shell-sheet")).toBeNull();
      expect(second.target.querySelector(".shell-sheet")).not.toBeNull();
      expect(sheetsOnScreen()).toEqual(["note"]);
      // Replaced, not stacked: one entry and one history state, so one
      // back press returns to whatever was behind the first sheet.
      expect(nav().depth).toBe(1);
      expect(nav().top).toBe("note");
      expect(historyStates.length).toBe(1);
    });

    it("is inert when the sheet already showing is opened again, and keeps its content", () => {
      // sheet-stack.js's whole reason for existing. The obvious
      // implementation dismisses whatever is current and shows whatever is
      // opening, which for the same sheet means tearing its content down
      // and rebuilding it — and this sheet holds a field, so the rebuild
      // silently discards what the user typed.
      const firstDismiss = vi.fn();
      const first = open({ tag: "trail", onDismiss: firstDismiss, children: body("trail") });
      const field = first.target.querySelector('[data-body="trail"]');
      field.value = "half-written trail name";

      const second = open({ tag: "trail", onDismiss: vi.fn(), children: body("trail") });

      expect(firstDismiss).not.toHaveBeenCalled();
      // The surviving node, not merely a node: querying again after a
      // teardown-and-rebuild would find a fresh input with an empty value,
      // which is exactly the bug, so identity AND value are both asserted.
      expect(first.target.querySelector('[data-body="trail"]')).toBe(field);
      expect(field.value).toBe("half-written trail name");
      // The second instance defers rather than drawing a duplicate sheet.
      expect(second.target.querySelector(".shell-sheet")).toBeNull();
      expect(sheetsOnScreen()).toEqual(["trail"]);
      // And no second registration: re-opening pushes no history state.
      expect(nav().depth).toBe(1);
      expect(historyStates.length).toBe(1);
    });
  });

  // The ghost click. Shell toolbar controls act on `pointerdown` (so the
  // editor keeps its selection) and the browser still fires `click`
  // afterwards, hit-testing it against the DOM the pointerdown just
  // changed — which is this sheet, mounted under the finger. On
  // android-webview one tap on `+` opened the insert sheet and ran the row
  // that landed at the button's y, inserting a list board nobody chose.
  describe("the tap that opened it", () => {
    /** A row inside the sheet that reports being activated. */
    function rowBody(onSelect) {
      return createRawSnippet(() => ({
        render: () => '<button data-body="row" type="button">list</button>',
        setup: (node) => { node.addEventListener("click", onSelect); },
      }));
    }

    function clickRow(target, { detail = 1 } = {}) {
      target.querySelector('[data-body="row"]')
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
    }

    it("does not reach a row with the click the opening press left behind", () => {
      const onSelect = vi.fn();
      const { target } = open({ tag: "insert", children: rowBody(onSelect) });

      // No pointerdown on the sheet first: the press that opened it landed
      // on the `+`, one layer up, before this sheet existed.
      clickRow(target);

      expect(onSelect).not.toHaveBeenCalled();
    });

    it("reaches a row on the next press, which is one the user made at it", () => {
      const onSelect = vi.fn();
      const { target } = open({ tag: "insert", children: rowBody(onSelect) });
      clickRow(target);

      target.querySelector('[data-body="row"]')
        .dispatchEvent(pointer("pointerdown", { y: 10, t: 0 }));
      clickRow(target);

      expect(onSelect).toHaveBeenCalledOnce();
    });

    it("lets a keyboard activation through — it has no press behind it to be", () => {
      // Enter on a focused row arrives as a click with detail 0 and no
      // pointer events at all, so the seal would otherwise eat the first
      // row a keyboard user ever chooses.
      const onSelect = vi.fn();
      const { target } = open({ tag: "insert", children: rowBody(onSelect) });

      clickRow(target, { detail: 0 });

      expect(onSelect).toHaveBeenCalledOnce();
    });

    it("seals again when the sheet is replaced by another one", () => {
      // The replacement is opened by a press too, and lands under the
      // finger the same way. A seal that only armed on the first sheet of
      // a session would leave every sheet after it exposed.
      const onSelect = vi.fn();
      open({ tag: "trail", children: body("trail") });
      const second = open({ tag: "insert", children: rowBody(onSelect) });

      clickRow(second.target);

      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});

describe("Sheet — the keyboard it opens over", () => {
  it("takes the keyboard down by blurring the field that raised it", () => {
    // A menu and a keyboard were sharing the bottom of the screen: eight
    // of eighteen rows visible, and the first tap on a row blurring the
    // field, dropping the keyboard and moving the row out from under the
    // finger mid-tap. Reported twice from a device.
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    expect(document.activeElement).toBe(field);

    open({ tag: "insert" });

    expect(document.activeElement).not.toBe(field);
    field.remove();
  });

  it("blurs a contenteditable too, which is what the page's editor is", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    // jsdom does not implement isContentEditable off the attribute.
    Object.defineProperty(editor, "isContentEditable", { value: true });
    document.body.appendChild(editor);
    editor.focus();

    open({ tag: "block-actions" });

    expect(document.activeElement).not.toBe(editor);
    editor.remove();
  });

  it("leaves a focused control alone — only a keyboard is being put away", () => {
    // A sheet opened from a button would otherwise lose that button's
    // focus ring for no reason; there is no keyboard to dismiss.
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();

    open({ tag: "date" });

    expect(document.activeElement).toBe(button);
    button.remove();
  });
});
