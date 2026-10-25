import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import ShellRoot from "../ShellRoot.svelte";

afterEach(cleanupAll);

// A real pointer event with a real timestamp. jsdom stamps an event at
// construction time, so three events built in one synchronous statement
// land on the same millisecond and every velocity the root reports comes
// out 0 — which would make the seam test below assert a flick it never
// actually described. Stamping the instance is how a test drives a
// timeline the recogniser can measure; timeStamp is a read-only accessor
// on the prototype, and an own property shadows it.
// `id` is the pointerId; every stroke built here carries one explicitly, so
// a test that involves two fingers reads as two fingers rather than relying
// on a default. Single-finger tests leave it at 1.
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

/** Dispatch a whole stroke from `from` (an element inside the root, so the
 *  events bubble to it exactly as a real touch would). */
function stroke(from, pts) {
  from.dispatchEvent(pointer("pointerdown", pts[0]));
  for (const p of pts.slice(1, -1)) from.dispatchEvent(pointer("pointermove", p));
  from.dispatchEvent(pointer("pointerup", pts[pts.length - 1]));
}

/** Mount the root with a gesture sink, and hand back a child carrying
 *  `region` as data-shell-region — nothing in src/ sets that attribute yet,
 *  so the convention is introduced here rather than borrowed. */
function mountRoot(props = {}, region = null) {
  const onGesture = vi.fn();
  const { target } = render(ShellRoot, { ...props, onGesture });
  flushSync();
  const root = target.querySelector(".shell-root");
  if (region === null) return { onGesture, root, from: root };
  const child = document.createElement("div");
  child.setAttribute("data-shell-region", region);
  target.querySelector(".shell-content").appendChild(child);
  return { onGesture, root, from: child };
}

describe("ShellRoot", () => {
  it("renders its content", () => {
    const { target } = render(ShellRoot, {});
    expect(target.querySelector(".shell-root")).not.toBeNull();
  });

  it("reserves the bottom band only when there is a row to show", () => {
    // The band is the one place chrome may sit at the bottom, and it holds
    // up to two rows: an editor strip above, the nav row below (§2).
    // Reserving its height when neither is shown leaves a dead band above
    // the home indicator — the inverse of the inset double-count that put
    // memory's list ~50px too low for a release.
    const band = (props) =>
      render(ShellRoot, props).target.querySelector(".shell-root").classList.contains("has-slot");
    expect(band({ hasStrip: true, hasNav: true })).toBe(true);
    expect(band({ hasStrip: true, hasNav: false })).toBe(true);
    expect(band({ hasStrip: false, hasNav: true })).toBe(true);
    expect(band({ hasStrip: false, hasNav: false })).toBe(false);
  });

  it("exposes each row of the band on its own prop", () => {
    const rows = (props) => {
      const target = render(ShellRoot, props).target;
      return {
        band: !!target.querySelector(".shell-slot"),
        strip: !!target.querySelector(".shell-slot-strip"),
        nav: !!target.querySelector(".shell-slot-nav"),
      };
    };
    expect(rows({ hasStrip: false, hasNav: false })).toEqual({ band: false, strip: false, nav: false });
    expect(rows({ hasStrip: false, hasNav: true })).toEqual({ band: true, strip: false, nav: true });
    expect(rows({ hasStrip: true, hasNav: false })).toEqual({ band: true, strip: true, nav: false });
    expect(rows({ hasStrip: true, hasNav: true })).toEqual({ band: true, strip: true, nav: true });
  });

  it("puts the strip above the nav row", () => {
    // Load-bearing, not aesthetic. The nav row is anchored to the band's
    // bottom edge, so when the strip leaves — which a nav tap itself
    // causes, since TabBar does not preventDefault on pointerdown and so
    // blurs the editor — the band shrinks UPWARD and the tab stays under
    // the thumb between pointerdown and click. The other order moves the
    // control mid-tap.
    const slot = render(ShellRoot, { hasStrip: true, hasNav: true }).target.querySelector(
      ".shell-slot",
    );
    expect(slot.children[0].classList.contains("shell-slot-strip")).toBe(true);
    expect(slot.children[1].classList.contains("shell-slot-nav")).toBe(true);
  });

  it("carries the has-slot class only when there is a band", () => {
    // What this proves: the `.has-slot` class flips with the band's two
    // props, same as "reserves the bottom band..." above — this test is
    // assertion-identical to that one, because jsdom does not apply any
    // scoped Svelte stylesheet (confirmed directly: a rendered component's
    // document.styleSheets.length is 0 here), so there is no computed-style
    // assertion this suite can make that would actually observe padding.
    // What this does NOT prove: that `.shell-root:not(.has-slot)` still
    // carries `padding-bottom: var(--safe-bottom)` — deleting that CSS rule
    // leaves this test green, because the class it checks never touches the
    // rule. The real proof is the source-text guard in shell-rules.test.js
    // ("pads --safe-bottom at the root when there is no slot"), which reads
    // ShellRoot.svelte's own text for the selector and the declaration.
    const withSlot = render(ShellRoot, { hasNav: true }).target.querySelector(".shell-root");
    const without = render(ShellRoot, {}).target.querySelector(".shell-root");
    expect(withSlot.classList.contains("has-slot")).toBe(true);
    expect(without.classList.contains("has-slot")).toBe(false);
  });

  it("starts the keyboard-state owner on mount and stops it on unmount", () => {
    // keyboard-state.js is the app's ONLY visualViewport subscriber
    // (src/lib/keyboard-state.js:45, and the rule is enforced by
    // src/lib/__tests__/single-viewport-owner.test.js). The root starts it
    // once for the whole shell so no screen is ever tempted to.
    const stop = vi.fn();
    const start = vi.fn(() => stop);
    const { cleanup } = render(ShellRoot, { startViewport: start });
    flushSync();
    expect(start).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
    cleanup();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("gives a left-edge drag-right to back when the shell draws back", () => {
    const { onGesture, from } = mountRoot({ edgeBackArmed: true });
    stroke(from, [
      { x: 4, y: 300, t: 0 },
      { x: 90, y: 302, t: 40 },
      { x: 180, y: 305, t: 80 },
    ]);
    expect(onGesture).toHaveBeenCalledOnce();
    expect(onGesture.mock.calls[0][0].owner).toBe("back");
  });

  it("leaves the same drag to the OS when the platform owns the edge", () => {
    // Not "nothing happens": the owner is "system", and the system back
    // still fires. What must not happen is the shell ALSO drawing one —
    // the competing-owner bug that swung between firing on every scroll
    // and never firing at all across the v0.6.x releases. The root gets
    // this from a prop; platform.js is the only shell file that may look
    // at the OS to decide it.
    const { onGesture, from } = mountRoot({ edgeBackArmed: false });
    stroke(from, [
      { x: 4, y: 300, t: 0 },
      { x: 90, y: 302, t: 40 },
      { x: 180, y: 305, t: 80 },
    ]);
    expect(onGesture.mock.calls[0][0].owner).toBe("system");
  });

  it("claims nothing for the same drag started away from the edge", () => {
    // Not a vacuous negative: "element" is the table's own answer for
    // anything the shell has not named, and it is the only assertion in
    // this file that proves EDGE_PX is consulted at all. Without it the
    // root could pass edgePx: Infinity — every left-edge test above stays
    // green while every horizontal drag anywhere on screen means back,
    // which is the too-eager half of the v0.6.x edge-back bug.
    const { onGesture, from } = mountRoot({ edgeBackArmed: true });
    stroke(from, [
      { x: 200, y: 300, t: 0 },
      { x: 290, y: 302, t: 40 },
      { x: 376, y: 305, t: 80 },
    ]);
    expect(onGesture.mock.calls[0][0].owner).toBe("element");
  });

  it("still gives a left-edge drag-right to back inside a marked canvas", () => {
    // THE regression test for Task 6, and the reason it is driven from real
    // pointer events rather than by handing gestureOwner a region string:
    // both modules were individually correct and the seam between them was
    // the defect. The root used to fold "started at the left edge" into the
    // same region string as "landed on a marked element", preferring the
    // marker — so this exact stroke resolved to region "canvas", hit the
    // canvas row, and came back "element", because that row terminates
    // rather than falling through to the left edge below it. The first
    // screen to mark a full-bleed canvas therefore killed back outright.
    // Fails against 2313835 with "element".
    const { onGesture, from } = mountRoot({ edgeBackArmed: true }, "canvas");
    stroke(from, [
      { x: 4, y: 300, t: 0 },
      { x: 90, y: 302, t: 40 },
      { x: 180, y: 305, t: 80 },
    ]);
    expect(onGesture).toHaveBeenCalledOnce();
    expect(onGesture.mock.calls[0][0].owner).toBe("back");
  });

  it("switches pages rather than going back when the dots strip sits on the edge", () => {
    // The ordering's other constraint, end to end: header-dots and the left
    // edge are the only two rows that claim drag-right, and a dots strip
    // drawn within EDGE_PX of the screen edge is a real layout. Same stroke
    // as the regression test above — only the marked region differs — so
    // this fails the moment the two rows are swapped back.
    const { onGesture, from } = mountRoot({ edgeBackArmed: true }, "header-dots");
    stroke(from, [
      { x: 4, y: 300, t: 0 },
      { x: 90, y: 302, t: 40 },
      { x: 180, y: 305, t: 80 },
    ]);
    expect(onGesture.mock.calls[0][0].owner).toBe("page-switch");
  });

  it("still opens memory on a canvas swipe up that starts at the edge", () => {
    // The vertical half of the same seam: promoting the left edge above the
    // canvas must not cost the canvas any stroke it already owned. The
    // left-edge row claims drag-right and nothing else, so a swipe up from
    // inside EDGE_PX is still the canvas's — a thumb resting near the bezel
    // does not lose scrolling or the space switch.
    const { onGesture, from } = mountRoot({ atScrollBottom: true }, "canvas");
    stroke(from, [
      { x: 6, y: 500, t: 0 },
      { x: 9, y: 380, t: 60 },
      { x: 11, y: 260, t: 120 },
    ]);
    expect(onGesture.mock.calls[0][0].owner).toBe("memory");
  });

  it("gives a live block drag the gesture even at the left edge", () => {
    // The table's first row, unenforceable until now: nothing that owned a
    // gesture had a dragActive input, so a block lifted near the edge armed
    // back at the same time and one motion lost both the block and the
    // screen. Same stroke as the "back" test above; only dragActive differs.
    const { onGesture, from } = mountRoot({ edgeBackArmed: true, dragActive: true });
    stroke(from, [
      { x: 4, y: 300, t: 0 },
      { x: 90, y: 302, t: 40 },
      { x: 180, y: 305, t: 80 },
    ]);
    expect(onGesture.mock.calls[0][0].owner).toBe("drag");
  });

  it("gives a live block drag the canvas's own swipe", () => {
    // The bug gesture-owner.js's header names in its own words: "the canvas
    // swipe that switched spaces mid-block-drag". Identical inputs to
    // "still opens memory on a canvas swipe up that starts at the edge"
    // above — canvas region, drag-up, at the scroll bottom — with dragActive
    // the only difference, so what this asserts is the row and not the
    // stroke.
    //
    // The edge case above was already covered; the canvas was not, and the
    // canvas is the region a phone shell is mostly made of. A block lifted
    // over it and dragged upward past the bottom of the doc is the ordinary
    // way to reach this row, not a corner of it.
    const { onGesture, from } = mountRoot({ atScrollBottom: true, dragActive: true }, "canvas");
    stroke(from, [
      { x: 200, y: 500, t: 0 },
      { x: 203, y: 380, t: 60 },
      { x: 205, y: 260, t: 120 },
    ]);
    expect(onGesture.mock.calls[0][0].owner).toBe("drag");
  });

  it("reflects a live drag on the frame", () => {
    // `dragActive` is otherwise a prop handed to a pure function and
    // visible to nothing — which is exactly how gestureOwner's first row
    // sat inert for three phases under fourteen tests of its own. The class
    // is what makes the producer chain assertable from ShellApp downward,
    // and it carries the drag's selection suppression (ShellRoot's style).
    const dragging = render(ShellRoot, { dragActive: true });
    const resting = render(ShellRoot, { dragActive: false });
    expect(dragging.target.querySelector(".shell-root").classList.contains("dragging")).toBe(true);
    expect(resting.target.querySelector(".shell-root").classList.contains("dragging")).toBe(false);
  });

  it("asks the table rather than reimplementing a row of it", () => {
    // The point of this one is the combination, not the outcome: canvas +
    // drag-down + at the scroll top + space "memory" is reachable ONLY
    // through gestureOwner's canvas row, which needs three inputs to agree.
    // A hand-rolled left-edge check inside the root — the shape Stack and
    // Sheet each grew privately — passes every other owner test in this
    // file and cannot produce "page" here.
    const { onGesture, from } = mountRoot(
      { atScrollTop: true, space: "memory" },
      "canvas",
    );
    stroke(from, [
      { x: 200, y: 40, t: 0 },
      { x: 203, y: 120, t: 60 },
      { x: 205, y: 220, t: 120 },
    ]);
    expect(onGesture.mock.calls[0][0].owner).toBe("page");
  });

  it("routes a real edge flick end to end, timeline and all", () => {
    // The seam, driven by real pointer events rather than a hand-built
    // recognise() return fed to gestureOwner. Task 1's incident is why:
    // an edge flick of 195px right with 10px of drift classified as
    // "pan-horizontal", gestureOwner's left-edge row keys off the literal
    // "drag-right", the owner came back "element", and BOTH modules' unit
    // tests were green while the back gesture was dead. Only a test that
    // starts at pointerdown and ends at an owner sees that.
    //
    // The stroke is a thumb arc: 195px right, 10px of vertical drift, and
    // a terminal flick after a crawl — 15px over the first 380ms, then
    // 180px over the last 60ms (3.0 px/ms, well past the 0.5 px/ms
    // stack-back.js commits on), where the whole stroke averages only 0.44
    // px/ms and would commit nothing. Asserting the velocity is the other
    // half of the seam: the timeline has to survive the root intact. A
    // root that kept only pointerdown and pointerup — which is what every
    // handler in this tree did before P2 — reports that 0.44 instead, a
    // plausible-looking number in place of a flick, which is the silent
    // failure pointer-gesture.js's header calls worse than the bug.
    const { onGesture, from } = mountRoot({ edgeBackArmed: true });
    stroke(from, [
      { x: 5, y: 300, t: 0 },
      { x: 12, y: 303, t: 200 },
      { x: 20, y: 306, t: 380 },
      { x: 105, y: 308, t: 410 },
      { x: 200, y: 310, t: 440 },
    ]);
    const g = onGesture.mock.calls[0][0];
    expect(g.owner).toBe("back");
    expect(g.gesture).toBe("drag-right");
    expect(g.dx).toBe(195);
    expect(g.dy).toBe(10);
    expect(g.velocityX).toBeCloseTo(3.0, 5);
  });

  it("keeps the first finger's stroke when a second one lands mid-drag", () => {
    // Every other test in this file drives one pointer id, which is why this
    // shipped: down() overwrote activePointer, downRegion and points on ANY
    // pointerdown, while move() and up() both checked the id. So a second
    // finger landing mid-drag re-pointed tracking at itself and the first
    // finger's remaining moves and its pointerup were then dropped on that
    // id check — the stroke in flight emitted no gesture at all. On a device
    // that is a pinch, or a palm brushing the screen, cancelling a back
    // gesture the user was halfway through.
    //
    // The stroke is the seam test's thumb arc, so the assertions are the
    // same ones: an owner AND the timeline that produced it. Asserting only
    // that something fired would still pass if the second finger's landing
    // point had been folded into the first finger's points — dx would come
    // back measured from coordinates the user never gestured from.
    const { onGesture, from } = mountRoot({ edgeBackArmed: true });
    from.dispatchEvent(pointer("pointerdown", { x: 5, y: 300, t: 0, id: 1 }));
    from.dispatchEvent(pointer("pointermove", { x: 12, y: 303, t: 200, id: 1 }));
    from.dispatchEvent(pointer("pointermove", { x: 20, y: 306, t: 380, id: 1 }));
    // The second finger lands far from the edge and far down the screen — a
    // position that on its own owns nothing and would recognise as noise.
    from.dispatchEvent(pointer("pointerdown", { x: 300, y: 600, t: 395, id: 2 }));
    from.dispatchEvent(pointer("pointermove", { x: 305, y: 604, t: 405, id: 2 }));
    from.dispatchEvent(pointer("pointermove", { x: 105, y: 308, t: 410, id: 1 }));
    from.dispatchEvent(pointer("pointerup", { x: 200, y: 310, t: 440, id: 1 }));
    from.dispatchEvent(pointer("pointerup", { x: 306, y: 605, t: 460, id: 2 }));

    expect(onGesture).toHaveBeenCalledOnce();
    const g = onGesture.mock.calls[0][0];
    expect(g.owner).toBe("back");
    expect(g.gesture).toBe("drag-right");
    expect(g.dx).toBe(195);
    expect(g.dy).toBe(10);
    expect(g.velocityX).toBeCloseTo(3.0, 5);
  });

  it("reports nothing for a stroke the OS took away", () => {
    // Not an empty assertion for its own sake: pointercancel means the
    // platform claimed the pointer mid-stroke (its own edge gesture, a
    // call arriving). Emitting an owner there pops a screen while the
    // finger is still down, and the next real pointerup would emit a
    // second gesture built from the abandoned stroke's points.
    const { onGesture, from, root } = mountRoot({ edgeBackArmed: true });
    from.dispatchEvent(pointer("pointerdown", { x: 4, y: 300, t: 0 }));
    from.dispatchEvent(pointer("pointermove", { x: 90, y: 302, t: 40 }));
    root.dispatchEvent(pointer("pointercancel", { x: 90, y: 302, t: 40 }));
    root.dispatchEvent(pointer("pointerup", { x: 180, y: 305, t: 80 }));
    expect(onGesture).not.toHaveBeenCalled();
  });

  it("captures no pointer, so a descendant keeps the rest of its own stroke", () => {
    // The decision P3 Task 1 had to settle before the router could be
    // switched on at all, and the only guard in the tree that can see it
    // come undone.
    //
    // down() used to open with setPointerCapture on `.shell-root`.
    // Capture retargets every later event for that pointer AT the
    // capturing element, and a second setPointerCapture REPLACES the
    // first — so this line, which runs LAST (events bubble target-to-
    // root), would take away the capture Stack sets on `.shell-stack` for
    // an edge-back drag and the capture Sheet sets on its own handle.
    // Their pointermove and pointerup would then be delivered to an
    // ANCESTOR, which nothing travels back down from, and neither
    // component's handlers would run again for the rest of the gesture.
    // The frame gains nothing in exchange: it is position:fixed;inset:0,
    // so it IS the viewport and every pointer event a finger can produce
    // already bubbles to it.
    //
    // Asserted on a spy because jsdom implements no pointer capture at
    // all — Sheet optional-chains the call for that reason. Nothing
    // downstream can observe the damage here: reinstating the line leaves
    // every other test in this suite green, and the tests that DO go red
    // for it live in ShellApp.test.js, where a real Stack is mounted
    // inside a real frame.
    const had = Object.getOwnPropertyDescriptor(Element.prototype, "setPointerCapture");
    const captured = [];
    Element.prototype.setPointerCapture = function (id) {
      captured.push([this.className, id]);
    };
    try {
      const { onGesture, from } = mountRoot({ edgeBackArmed: true });
      stroke(from, [
        { x: 4, y: 300, t: 0 },
        { x: 90, y: 302, t: 40 },
        { x: 180, y: 305, t: 80 },
      ]);
      // The router really ran — otherwise "captured nothing" would be true
      // of a frame that also routed nothing, which is the state this whole
      // phase exists to leave.
      expect(onGesture.mock.calls[0][0].owner).toBe("back");
      expect(captured).toEqual([]);
    } finally {
      if (had) Object.defineProperty(Element.prototype, "setPointerCapture", had);
      else delete Element.prototype.setPointerCapture;
    }
  });

  it("survives a stroke when no one is listening for gestures", () => {
    // Every existing consumer of this component passes no onGesture, and
    // the root is the frame every screen lives inside — a throw here takes
    // the whole app down, not one gesture.
    const { target } = render(ShellRoot, {});
    flushSync();
    const root = target.querySelector(".shell-root");
    expect(() =>
      stroke(root, [
        { x: 4, y: 300, t: 0 },
        { x: 180, y: 305, t: 80 },
      ]),
    ).not.toThrow();
  });
});
