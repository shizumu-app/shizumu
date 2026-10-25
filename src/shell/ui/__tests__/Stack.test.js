import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { flushSync, createRawSnippet } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import {
  navBack, navPush, subscribe, initNavStack, _resetForTests,
} from "../../../lib/navstack.js";
import Stack from "../Stack.svelte";

// jsdom implements pushState/back, but back() is async and flaky in tests —
/** navstack defers its history rewind to a macrotask so that a push in
 *  the same turn takes the freed slot over instead of racing the pending
 *  popstate — the defect where back on a sheet opened from another sheet
 *  closed the whole app (see popTrailingClosed in navstack.js). An
 *  assertion about history AFTER a close has to cross that boundary. */
const afterRewind = () => new Promise((r) => setTimeout(r, 0));

// navstack.test.js's setup, reused rather than reinvented, exactly as
// Sheet.test.js reuses it. historyStates is what the assertions below
// actually care about: navstack's invariant is one history state per entry
// (navstack.js:11-13), and the way to break it is to rewind one too many.
let historyStates;
let navTeardown;
// The same `go` stub, kept by reference: a multi-entry departure is
// supposed to rewind with ONE go(-N) rather than N of them, and the count
// is only visible on the spy. Nothing else in this file needs it, so it
// stays a plain handle rather than a second stub set up alongside.
let historyGo;
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
  historyGo = vi.spyOn(window.history, "go").mockImplementation((n) => {
    for (let i = 0; i < -n; i++) historyStates.pop();
    window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
  });
  navTeardown = initNavStack();
});

// One hook in one explicit order, rather than two afterEach registrations
// whose relative order is a vitest configuration detail — Sheet.test.js's
// reason: the stacks have to unmount while the history stubs are still
// installed, because unmounting closes every entry the stack registered and
// therefore rewinds history.
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

/** The tag of every history state currently pushed, oldest first. */
function historyTags() {
  return historyStates.map((s) => s.shizumu);
}

// A real pointer event with a real timestamp — ShellRoot.test.js's helper,
// for its reason: jsdom stamps an event at construction, so a stroke built
// in one synchronous statement lands entirely on the same millisecond and
// every velocity the recogniser reports comes out 0. A test written that
// way describes a flick it never performed. timeStamp is a read-only
// accessor on the prototype; an own property shadows it.
function pointer(type, { x, y = 0, t, id = 1 }) {
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

// clientWidth is 0 for every element in jsdom, and stack-back.js:30 returns
// "cancel" on a zero width — a deliberate guard, not defensive noise: a 0
// there means the measurement failed, and committing a navigation on a
// number nobody trusts is how a screen vanishes out from under a finger.
// So a drag test that does not set a real width passes for the wrong
// reason, and keeps passing when the gesture is completely broken. Every
// stroke below goes through here, and here is the only place the width is
// set.
function stroke(el, points, { width = 400 } = {}) {
  Object.defineProperty(el, "clientWidth", { value: width, configurable: true });
  el.dispatchEvent(pointer("pointerdown", points[0]));
  for (const p of points.slice(1, -1)) el.dispatchEvent(pointer("pointermove", p));
  el.dispatchEvent(pointer("pointerup", points[points.length - 1]));
}

/** A screen body, distinguishable in the DOM by the entry's own id. */
function view(id) {
  return createRawSnippet(() => ({
    render: () => `<p data-body="${id}">${id}</p>`,
  }));
}

/** `stackOf("root", "detail")` — root at the bottom, detail on top. */
function stackOf(...ids) {
  return ids.map((id) => ({ id, view: view(id) }));
}

function mount(props = {}) {
  const onPop = vi.fn();
  const { target } = render(Stack, { entries: stackOf("root", "detail"), onPop, ...props });
  flushSync();
  return { onPop, el: target.querySelector(".shell-stack"), target };
}

/**
 * A real host: it owns the entries array and its onPop removes the top
 * element, which is the whole of the contract Stack's header states.
 *
 * The stack lives in a SvelteMap rather than a plain array because mount()
 * hands the props object to the component RAW (svelte internal render.js:
 * `Component(anchor_node, props)`) — so a plain array reassigned after mount
 * is invisible to it, and a test written that way would drive a stack that
 * never actually changed while every assertion still passed. The getter below
 * reads a reactive source, so the prop tracks and the component sees the
 * push and the pop.
 */
function hostStack(...ids) {
  const screens = new SvelteMap(ids.map((id) => [id, view(id)]));
  const onPop = vi.fn(() => {
    const top = [...screens.keys()].at(-1);
    if (top !== undefined) screens.delete(top);
  });
  const rendered = render(Stack, {
    get entries() {
      return [...screens].map(([id, body]) => ({ id, view: body }));
    },
    onPop,
  });
  flushSync();
  return {
    ...rendered,
    onPop,
    el: rendered.target.querySelector(".shell-stack"),
    /** What the host still holds. */
    ids: () => [...screens.keys()],
    /** What is actually alive in the DOM — the top two, at most. */
    mountedIds: () =>
      [...rendered.target.querySelectorAll(".shell-stack-entry")].map((n) => n.dataset.entry),
    /** The host pushes a screen, as a tap on a row would. */
    push: (id) => {
      screens.set(id, view(id));
      flushSync();
    },
    /**
     * The host drops everything but `keep`, in ONE update — a tab switch
     * resetting that tab's stack to its root, or a deep link replacing the
     * whole stack. Several entries therefore depart on a single effect run,
     * which is the case the single-rewind property is about.
     */
    resetTo: (...keep) => {
      for (const id of [...screens.keys()]) if (!keep.includes(id)) screens.delete(id);
      flushSync();
    },
  };
}

function topTransform(target) {
  return target.querySelector('.shell-stack-entry[data-top="true"]').style.transform;
}

describe("Stack", () => {
  it("mounts the root, the top entry and the one beneath it, and nothing else", () => {
    // Three, never four: the one beneath is what a back drag reveals, so it
    // has to be real rather than a hole — and a stack ten deep holding ten
    // live screens is ten scroll containers and ten editors alive at once.
    // The ROOT stays for the header's reason: the page root holds the
    // editor, and a root that unmounted at depth 3 came back as a remount
    // from load-time content, with the writer's newest lines gone.
    const { target } = mount({ entries: stackOf("a", "b", "c", "d") });
    expect([...target.querySelectorAll(".shell-stack-entry")].map((n) => n.dataset.entry))
      .toEqual(["a", "c", "d"]);
    expect(target.querySelector('[data-body="b"]')).toBeNull();
    expect(target.querySelector('[data-body="a"]')).not.toBeNull();
    expect(target.querySelector('.shell-stack-entry[data-top="true"]').dataset.entry).toBe("d");
    expect(target.querySelector(".shell-stack").dataset.depth).toBe("4");
  });

  it("mounts exactly the two there are at depth two", () => {
    const { target } = mount({ entries: stackOf("a", "b") });
    expect([...target.querySelectorAll(".shell-stack-entry")].map((n) => n.dataset.entry))
      .toEqual(["a", "b"]);
  });

  it("commits a fast short flick — 80px of 400, a fifth of the way", () => {
    // THE case this component existed without. 80 of 400 is 20%, nowhere
    // near stack-back's 40% distance line, and it commits only because the
    // tail of the stroke reads 2px/ms. With velocityX pinned at 0 — which
    // is what shipped — stack-back's two velocity branches are unreachable
    // and `dx >= width * 0.4` is the only path it can take, so this exact
    // gesture, which is what a real back flick looks like, did nothing.
    const { onPop, el } = mount();
    stroke(el, [
      { x: 0, t: 0 },
      { x: 40, t: 20 },
      { x: 80, t: 40 },
    ]);
    expect(onPop).toHaveBeenCalledOnce();
  });

  it("still commits a slow drag that crosses the distance line", () => {
    // The other half of stack-back's rule: velocity decides first, but a
    // careful 200px drag released almost stationary (5px over the last
    // 100ms) has no velocity to decide on, and distance carries it.
    const { onPop, el } = mount();
    stroke(el, [
      { x: 0, t: 0 },
      { x: 180, t: 1000 },
      { x: 195, t: 1100 },
      { x: 200, t: 1200 },
    ]);
    expect(onPop).toHaveBeenCalledOnce();
  });

  it("cancels a stroke thrown back leftward, even from past the commit line", () => {
    // Released at 200 of 400 — half the screen, comfortably past the 40%
    // line — but the last 40ms travel left at 1.5px/ms. The user dragged
    // out and changed their mind, and stack-back's negative-velocity branch
    // is what reads that.
    //
    // This is also what pins that the outcome comes from the tracked
    // stroke rather than from its endpoints: an implementation that
    // subtracted pointerdown's x from pointerup's x sees 200 of 400 here
    // and pops the screen.
    const { onPop, el } = mount();
    stroke(el, [
      { x: 0, t: 0 },
      { x: 260, t: 300 },
      { x: 230, t: 320 },
      { x: 200, t: 340 },
    ]);
    expect(onPop).not.toHaveBeenCalled();
  });

  it("springs back from a drag short of the commit line", () => {
    // Not "nothing happened": the screen followed the finger and returned,
    // which the transform assertions below prove separately. Popping here
    // would lose the screen on a hesitant touch.
    const { onPop, el } = mount();
    stroke(el, [
      { x: 0, t: 0 },
      { x: 120, t: 800 },
      { x: 120, t: 1600 },
    ]);
    expect(onPop).not.toHaveBeenCalled();
  });

  it("ignores the edge entirely while a block is being dragged", () => {
    // gestureOwner's first row, and the case its header names: while a
    // block is lifted, an edge drag must not ALSO mean back, or one motion
    // loses both the block and the screen. Suppressed at pointerdown, so
    // the screen does not even follow the finger — a translate here would
    // tell the user a back gesture is in flight while they are placing a
    // block.
    const { onPop, el, target } = mount({ dragActive: true });
    stroke(el, [
      { x: 0, t: 0 },
      { x: 150, t: 20 },
      { x: 300, t: 40 },
    ]);
    flushSync();
    expect(onPop).not.toHaveBeenCalled();
    expect(topTransform(target)).toBe("translateX(0px)");
  });

  it("ignores the edge entirely when the platform owns it", () => {
    // Android gesture navigation owns both edges (§5). Drawing our own
    // there is the gesture that swung between too-eager and dead across
    // four releases; the profile disarms it and the stack obeys.
    const { onPop, el } = mount({ edgeBackArmed: false });
    stroke(el, [
      { x: 0, t: 0 },
      { x: 150, t: 20 },
      { x: 300, t: 40 },
    ]);
    expect(onPop).not.toHaveBeenCalled();
  });

  it("ignores a drag that did not start at the edge", () => {
    // A swipe that begins mid-screen is content panning, not navigation.
    const { onPop, el } = mount();
    stroke(el, [
      { x: 200, t: 0 },
      { x: 300, t: 20 },
      { x: 380, t: 40 },
    ]);
    expect(onPop).not.toHaveBeenCalled();
  });

  it("does not pop the root", () => {
    // One entry is the root screen: there is nothing beneath it, so a
    // commit here would leave the shell showing nothing at all. `depth` is
    // entries.length now, not a pushed-depth prop, which moves this bound
    // from 1 to 2 — the off-by-one is the difference between back working
    // and the shell emptying itself.
    const { onPop, el } = mount({ entries: stackOf("root") });
    stroke(el, [
      { x: 0, t: 0 },
      { x: 150, t: 20 },
      { x: 300, t: 40 },
    ]);
    expect(onPop).not.toHaveBeenCalled();
  });

  it("does not pop on a press and release at the same point", () => {
    // A tap on the edge strip is a tap on whatever is there, not a back
    // gesture: no distance and no velocity, so stack-back cancels on both
    // counts.
    const { onPop, el } = mount();
    stroke(el, [
      { x: 12, t: 0 },
      { x: 12, t: 40 },
    ]);
    expect(onPop).not.toHaveBeenCalled();
  });

  it("commits a two-point stroke: a press at the edge, a release 300px out", () => {
    // The scenario an older test used to assert did NOT pop, back when the
    // release position was not part of the timeline and a stroke with no
    // pointermove between down and up was a single point with dx 0. That
    // implementation is gone: end() pushes the release sample, and a
    // deliberate choice replaces it — this commits, and should.
    //
    // A two-point stroke is not a synthetic curiosity. A browser coalesces
    // moves under load and delivers the tail of a fast flick as the
    // pointerup position alone, so the strokes most likely to arrive with
    // no intervening samples are precisely the fastest ones. Refusing them
    // would strand the gesture exactly where it is most emphatic, and the
    // user has no way to tell why: they flicked hard and the screen stayed.
    // The finger really did travel 300px from the edge, and that is a back
    // gesture on any reading of the timeline.
    //
    // Both stack-back branches are asserted, because which one carries it
    // depends on the timestamps the stream happens to supply — and the
    // decision above must not hinge on that. With a real gap the tail reads
    // 7.5px/ms and velocity commits it; with both samples on one
    // millisecond the velocity is a refused 0 (pointer-gesture.js:66) and
    // 300 of 400 clears the distance line instead. Same outcome either way.
    const fast = mount();
    stroke(fast.el, [
      { x: 0, t: 0 },
      { x: 300, t: 40 },
    ]);
    expect(fast.onPop).toHaveBeenCalledOnce();

    const sameMs = mount();
    stroke(sameMs.el, [
      { x: 0, t: 0 },
      { x: 300, t: 0 },
    ]);
    expect(sameMs.onPop).toHaveBeenCalledOnce();
  });

  it("returns the screen to zero when the OS cancels the stroke that owns it", () => {
    // The cancel path's own case, and the reason the guard below cannot
    // simply be tightened to "always return": a system edge gesture or an
    // arriving call takes the finger mid-drag, and the screen has to come
    // back rather than hang half-open forever.
    const { onPop, el, target } = mount();
    Object.defineProperty(el, "clientWidth", { value: 400, configurable: true });
    el.dispatchEvent(pointer("pointerdown", { x: 0, t: 0 }));
    el.dispatchEvent(pointer("pointermove", { x: 120, t: 40 }));
    flushSync();
    expect(topTransform(target)).toBe("translateX(120px)");

    el.dispatchEvent(pointer("pointercancel", { x: 120, t: 60 }));
    flushSync();
    expect(topTransform(target)).toBe("translateX(0px)");
    expect(onPop).not.toHaveBeenCalled();
  });

  it("leaves a committed screen parked when an unrelated pointer is cancelled", () => {
    // pointercancel bubbles, and this container wraps the whole screen —
    // every editor and every scroll container inside it. A scroll the
    // browser reinterprets mid-gesture (ordinary on iOS) fires a cancel
    // that arrives here carrying a pointerId this component never owned.
    //
    // The guard in cancel() read `activePointer !== null && …`, which is
    // FALSE the moment no stroke is in flight, so the body ran for every
    // one of those. It wiped settledOffset to 0, and the entry parked a
    // full width right — waiting for the host's onPop to unmount it —
    // flashed backwards across the display for a frame. That is the exact
    // failure the settle-by-id design was written to prevent, reintroduced
    // through the one handler that did not match move/end.
    //
    // data-settle is asserted alongside the transform because the two fail
    // separately: the offset is what jumps, the settle token is what picks
    // the transition it jumps with.
    const { onPop, el, target } = mount();
    stroke(el, [
      { x: 0, t: 0 },
      { x: 40, t: 20 },
      { x: 80, t: 40 },
    ]);
    flushSync();
    expect(onPop).toHaveBeenCalledOnce();
    expect(topTransform(target)).toBe("translateX(400px)");

    el.dispatchEvent(pointer("pointercancel", { x: 250, t: 60, id: 999 }));
    flushSync();
    expect(topTransform(target)).toBe("translateX(400px)");
    expect(
      target.querySelector('.shell-stack-entry[data-top="true"]').dataset.settle,
    ).toBe("commit");
  });

  it("translates the top entry with the finger and returns it to zero on cancel", () => {
    const { el, target } = mount();
    expect(topTransform(target)).toBe("translateX(0px)");

    Object.defineProperty(el, "clientWidth", { value: 400, configurable: true });
    el.dispatchEvent(pointer("pointerdown", { x: 0, t: 0 }));
    el.dispatchEvent(pointer("pointermove", { x: 120, t: 800 }));
    flushSync();
    expect(topTransform(target)).toBe("translateX(120px)");
    // The screen beneath does not move with it — it is what the drag is
    // uncovering, not part of the gesture.
    expect(target.querySelector('.shell-stack-entry[data-entry="root"]').style.transform)
      .toBe("translateX(0px)");

    el.dispatchEvent(pointer("pointerup", { x: 120, t: 1600 }));
    flushSync();
    expect(topTransform(target)).toBe("translateX(0px)");
  });

  it("clamps the translate at both ends", () => {
    const { el, target } = mount();
    Object.defineProperty(el, "clientWidth", { value: 400, configurable: true });

    // Leftward from inside the edge strip. 0, not -20: a screen that slid
    // off the left would reveal the one beneath from the wrong side, which
    // is the opposite of what a back drag means.
    el.dispatchEvent(pointer("pointerdown", { x: 20, t: 0 }));
    el.dispatchEvent(pointer("pointermove", { x: 0, t: 100 }));
    flushSync();
    expect(topTransform(target)).toBe("translateX(0px)");

    // And past the far edge: a full width, never more.
    el.dispatchEvent(pointer("pointermove", { x: 900, t: 200 }));
    flushSync();
    expect(topTransform(target)).toBe("translateX(400px)");
    el.dispatchEvent(pointer("pointercancel", { x: 900, t: 300 }));
  });

  it("parks the committed screen off the edge and leaves the one beneath at zero", () => {
    // The committed screen holds a full width to the right rather than
    // snapping back, because it is the screen that just left: snapping it
    // to 0 would flash it backwards across the display for a frame before
    // the host's pop unmounts it.
    //
    // The second assertion is the load-bearing one. That offset has to
    // belong to the ENTRY, not to the component — held on the component it
    // would apply to whatever is on top after the pop, so the screen the
    // back gesture just revealed would start 400px off-screen and the
    // shell would look emptied by its own back gesture.
    const { onPop, el, target } = mount();
    stroke(el, [
      { x: 0, t: 0 },
      { x: 40, t: 20 },
      { x: 80, t: 40 },
    ]);
    flushSync();
    expect(onPop).toHaveBeenCalledOnce();
    expect(topTransform(target)).toBe("translateX(400px)");
    expect(target.querySelector('.shell-stack-entry[data-entry="root"]').style.transform)
      .toBe("translateX(0px)");
  });

  describe("the nav stack", () => {
    it("back closes the screen on top, four deep — not the one that remounted", () => {
      // THE test this whole task exists for. Registration used to be keyed
      // to mounting, and mounting stopped tracking the stack when only the
      // top two entries were kept alive: with [a,b,c,d], `b` is unmounted,
      // so back pops `d`, the host drops to [a,b,c], and `b` remounts and
      // pushes a FRESH entry above `c`. The next back then closes `b` — the
      // deeper screen — and leaves `c` open.
      //
      // FOUR deep, not three, and the depth is the test. At three, the
      // registered set (entries.slice(1) — every element but the root) and
      // the mounted pair (entries.slice(-2)) are the same two ids, so the
      // design and the mutant it exists to exclude produce identical
      // registrations and this test passes on both. At four they diverge:
      // slice(1) is [b,c,d] and slice(-2) is [c,d]. A test that cannot tell
      // the design from its mutant is decoration measured in depth rather
      // than in assertions.
      //
      // Asserted as WHICH screen each back closes, never as a depth count.
      // A depth assertion is green at every step of that sequence while
      // back is closing the wrong screen, which is the entire defect: the
      // user sees a screen disappear either way and has no way to tell that
      // the wrong one went.
      const { ids } = hostStack("a", "b", "c", "d");
      expect(nav().top).toBe("d");

      navBack();
      flushSync();
      // "c", not "b". Under the mounted-keyed version this reads "b",
      // because `b` remounted above `c` — and it is the entry the NEXT
      // back would consume, so this assertion is the wrong screen being
      // named one press before it vanishes.
      expect(nav().top).toBe("c");
      expect(nav().has("d")).toBe(false);
      expect(ids()).toEqual(["a", "b", "c"]);

      navBack();
      flushSync();
      // `c` is the screen that just left, so `c` is the entry that closed.
      // Both halves matter: the mounted-keyed version closes `b` here and
      // leaves `c` live, so a test that only checked `c` was gone would
      // pass on the bug.
      expect(nav().has("c")).toBe(false);
      expect(nav().top).toBe("b");
      expect(ids()).toEqual(["a", "b"]);

      navBack();
      flushSync();
      // Down to the root, which owns no entry: the stack is empty and `a`
      // is still on screen. The next press after this one is the OS's.
      expect(nav().has("b")).toBe(false);
      expect(nav().depth).toBe(0);
      expect(ids()).toEqual(["a"]);
    });

    it("registers one entry per element of entries EXCEPT the root, in stack order", () => {
      // Four deep, three registered, three mounted (the root, and the top
      // two) — the registered and the mounted lists differ at both ends,
      // which is the point of doing this at four rather than at three. The
      // history tags are the load-bearing assertion: navstack's invariant
      // is one history state per entry, and their order is the order back
      // will consume them in, so a stack registered out of order is a back
      // button that walks the app sideways. `a` is absent from that list
      // because a stack root's back belongs to the OS.
      const { mountedIds } = hostStack("a", "b", "c", "d");
      expect(nav().depth).toBe(3);
      expect(nav().top).toBe("d");
      expect(historyTags()).toEqual(["b", "c", "d"]);
      expect(mountedIds()).toEqual(["a", "c", "d"]);
    });

    it("registers a screen the host pushes, above the one it covers", () => {
      const { push, mountedIds } = hostStack("a", "b", "c");
      expect(historyTags()).toEqual(["b", "c"]);

      push("d");
      expect(nav().top).toBe("d");
      expect(historyTags()).toEqual(["b", "c", "d"]);
      // `b` left the DOM and kept its entry. That is the whole point. (`a`
      // is the root and stays mounted at any depth — the header.)
      expect(mountedIds()).toEqual(["a", "c", "d"]);
      expect(nav().has("b")).toBe(true);
    });

    it("registers nothing for a stack that is only its root", () => {
      // The other door on the rule `depth < 2` guards for the edge gesture.
      // A commit at depth 1 would leave the shell showing nothing, so the
      // gesture refuses; a system back at depth 1 is the identical intent
      // arriving the other way, and honouring it would blank the shell on
      // the press that should switch app or go home.
      //
      // `below` stands in for whatever owns back underneath this stack —
      // on a device that is the OS, which no test can hold a handle on. So
      // the assertion is not "onPop went uncalled" (true even if the root
      // registered and something else swallowed the press) but that the
      // press reached the thing beneath, which it cannot do if the root
      // holds a history state in front of it.
      const belowClosed = vi.fn();
      navPush("below", belowClosed);
      const { ids, onPop } = hostStack("root");

      // One history state, and it is not the root's.
      expect(historyTags()).toEqual(["below"]);
      expect(nav().depth).toBe(1);
      expect(nav().top).toBe("below");

      navBack();
      flushSync();

      expect(belowClosed).toHaveBeenCalledOnce();
      expect(nav().depth).toBe(0);
      // The root screen is still there. With the root registered this reads
      // [] — the shell emptied by a press it should never have consumed.
      expect(ids()).toEqual(["root"]);
      expect(onPop).not.toHaveBeenCalled();
    });

    it("closes exactly one entry when platform back is followed by the departure", () => {
      // The first of the two orders. handlePopState has already popped the
      // entry and fired its onClose — which calls onPop, which is how the
      // host hears about a back it did not initiate — by the time the host
      // removes the element. The departure then calls navClose on that same
      // id, and navClose looks it up as `e.id === id && !e.closed`
      // (navstack.js:72) and finds nothing, so it returns.
      //
      // Verified in source rather than assumed, and pinned here rather than
      // trusted: if that early return were ever removed, navClose's
      // popTrailingClosed would fire a second history.go(-1) and eat the
      // entry underneath. `below` is that entry, and its survival is the
      // assertion — a depth check alone passes even when the stack's own
      // entry is closed twice.
      //
      // Three deep, so that the entry left standing afterwards is one the
      // stack registered rather than its unregistered root — a two-deep
      // version would leave `below` on top and prove nothing about the
      // stack's own bookkeeping.
      const belowClosed = vi.fn();
      navPush("below", belowClosed);
      const { ids } = hostStack("a", "b", "c");
      expect(historyStates.length).toBe(3);

      navBack();
      flushSync();

      expect(belowClosed).not.toHaveBeenCalled();
      expect(ids()).toEqual(["a", "b"]);
      expect(nav().depth).toBe(2);
      expect(nav().top).toBe("b");
      expect(historyStates.length).toBe(2);
    });

    it("closes exactly one entry when the edge gesture pops before any popstate", async () => {
      // The other order, and the one navstack never sees coming: the
      // gesture commits, calls onPop, the host removes the element, and the
      // departure is what closes the registration — the only path where
      // navClose actually does work rather than returning early. One
      // history state consumed, not two.
      const belowClosed = vi.fn();
      navPush("below", belowClosed);
      const { el, ids } = hostStack("a", "b", "c");
      expect(historyStates.length).toBe(3);

      stroke(el, [
        { x: 0, t: 0 },
        { x: 40, t: 20 },
        { x: 80, t: 40 },
      ]);
      flushSync();

      expect(ids()).toEqual(["a", "b"]);
      expect(nav().depth).toBe(2);
      expect(nav().top).toBe("b");
      await afterRewind();
      expect(historyStates.length).toBe(2);
      expect(belowClosed).not.toHaveBeenCalled();

      // And the rewind the gesture's close performed left no residual
      // suppression behind: the next back closes `b`, the stack's own
      // deepest registered entry, rather than being swallowed and taking
      // `below` with it on the press after that.
      navBack();
      flushSync();
      expect(nav().has("b")).toBe(false);
      expect(nav().top).toBe("below");
      expect(belowClosed).not.toHaveBeenCalled();
    });

    it("closes every entry it registered when the stack itself unmounts", async () => {
      // Including `b`, which was registered and never mounted. An entry
      // left behind owns a history state nobody can reach, and the back
      // press that eventually lands on it appears to do nothing at all.
      //
      // One go(-3), not three go(-1): the unmount walks the same
      // shallowest-first order the departure loop does, so `b` and `c`
      // close as deferred no-ops and `d`'s close rewinds the run.
      const belowClosed = vi.fn();
      navPush("below", belowClosed);
      const { cleanup } = hostStack("a", "b", "c", "d");
      expect(historyStates.length).toBe(4);

      cleanup();

      await afterRewind();
      expect(historyGo.mock.calls).toEqual([[-3]]);
      expect(nav().depth).toBe(1);
      expect(nav().top).toBe("below");
      expect(historyStates.length).toBe(1);
      expect(belowClosed).not.toHaveBeenCalled();
    });

    it("rewinds a multi-entry departure with one history.go, not one per entry", async () => {
      // The property the header states and nothing pinned — asserted three
      // times in prose across this component and navstack, which is how it
      // would survive being broken.
      //
      // It holds because departures are walked in `entries` order —
      // shallowest first — and navstack defers the close of an entry that
      // is not on top: `b` and `c` close as no-ops that only mark
      // themselves closed, and `d`'s close sweeps all three into one
      // history.go(-3). Reverse the loop to walk deepest-first, which the
      // header used to claim it did, and this reads [[-1], [-1], [-1]] —
      // three rewinds fired back to back, each with its own popstate for
      // the suppression counter to swallow.
      //
      // The argument matters as much as the count: go(-1) three times and
      // go(-3) once both end at the same history depth, so a bare
      // "was called" assertion is green on the broken version.
      const { resetTo, ids } = hostStack("a", "b", "c", "d");
      expect(historyTags()).toEqual(["b", "c", "d"]);

      resetTo("a");

      await afterRewind();
      expect(historyGo.mock.calls).toEqual([[-3]]);
      expect(historyTags()).toEqual([]);
      expect(nav().depth).toBe(0);
      expect(ids()).toEqual(["a"]);
    });
  });
});
