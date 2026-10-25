import { describe, it, expect } from "vitest";
import { gestureOwner } from "../gesture-owner.js";

describe("gestureOwner", () => {
  it("gives a live block drag every gesture on the screen", () => {
    // Row 1 wins over every row below it: while a block is lifted, an edge
    // drag must not also mean "back", or the user loses the block AND the
    // screen in one motion. The first case is the strongest one available —
    // an edge stroke on a marked canvas, i.e. every input below that claims
    // a drag-right, all true at once.
    expect(
      gestureOwner({ region: "canvas", gesture: "drag-right", atLeftEdge: true, dragActive: true }),
    ).toBe("drag");
    expect(
      gestureOwner({ region: "header-dots", gesture: "drag-right", atLeftEdge: true, dragActive: true }),
    ).toBe("drag");
    expect(gestureOwner({ region: "canvas", gesture: "drag-up", dragActive: true })).toBe("drag");
  });

  it("gives the left edge to back when the shell draws it", () => {
    expect(gestureOwner({ gesture: "drag-right", atLeftEdge: true, edgeBackArmed: true })).toBe("back");
  });

  it("leaves the left edge to the OS on Android", () => {
    // Not "nothing happens": the system back still fires. The shell simply
    // must not draw its own, which is the competing-owner bug from §1.
    expect(gestureOwner({ gesture: "drag-right", atLeftEdge: true, edgeBackArmed: false })).toBe("system");
  });

  it("still gives the left edge to back inside a marked canvas", () => {
    // The row order this whole table was rewritten for. The canvas row
    // TERMINATES — its drag-right returns "element" rather than falling
    // through — so with canvas ahead of the left edge, the first screen to
    // mark a full-bleed canvas killed back outright. Not a near miss: an
    // unreachable row, on the screen type a phone shell is mostly made of.
    expect(
      gestureOwner({ region: "canvas", gesture: "drag-right", atLeftEdge: true, edgeBackArmed: true }),
    ).toBe("back");
  });

  it("gives the header dots a page switch even when they sit on the left edge", () => {
    // The other half of the ordering, and why header-dots leads the left
    // edge rather than trailing it: these are the only two rows that claim
    // drag-right, and a dots strip drawn within EDGE_PX of the screen edge
    // is a real layout. Edge-first would turn a thumb on a visible,
    // named affordance into a back navigation.
    expect(
      gestureOwner({ region: "header-dots", gesture: "drag-right", atLeftEdge: true }),
    ).toBe("page-switch");
  });

  it("reads the left edge from atLeftEdge alone, never from a region named for it", () => {
    // Asserting "element" here is asserting a contract, not an absence of
    // behaviour: "left-edge" is NOT a region value any more, and a caller
    // that spells the geometry as a region is passing an unclaimed region
    // name. If this ever returned "back", the table would accept two
    // spellings of one fact again — which is how the collapsed-region bug
    // above got in, and how the next drift would start.
    expect(gestureOwner({ region: "left-edge", gesture: "drag-right", edgeBackArmed: true })).toBe(
      "element",
    );
  });

  it("gives a vertical canvas drag to the scroller", () => {
    expect(gestureOwner({ region: "canvas", gesture: "drag-up" })).toBe("scroll");
    expect(gestureOwner({ region: "canvas", gesture: "drag-down" })).toBe("scroll");
  });

  it("opens memory on a swipe up at the bottom of the page", () => {
    expect(gestureOwner({ region: "canvas", gesture: "drag-up", atScrollBottom: true })).toBe("memory");
  });

  it("leaves a vertical canvas drag to the canvas even when it starts at the edge", () => {
    // The left-edge row claims drag-right and nothing else, so a stroke
    // that begins inside EDGE_PX and then travels vertically belongs to the
    // canvas exactly as it would from the middle of the screen. Without
    // this, moving the edge row above the canvas would be a way to make a
    // thumb resting near the bezel lose scrolling.
    expect(
      gestureOwner({ region: "canvas", gesture: "drag-up", atScrollBottom: true, atLeftEdge: true }),
    ).toBe("memory");
    expect(
      gestureOwner({
        region: "canvas",
        gesture: "drag-down",
        atScrollTop: true,
        space: "memory",
        atLeftEdge: true,
      }),
    ).toBe("page");
  });

  it("returns to the page on a swipe down at memory's top", () => {
    expect(
      gestureOwner({ region: "canvas", gesture: "drag-down", atScrollTop: true, space: "memory" }),
    ).toBe("page");
  });

  it("scrolls memory mid-list rather than returning to the page", () => {
    // Pins the `atScrollTop &&` conjunct. Without it, a swipe-down anywhere
    // in memory ejects the user to the page — the same bug the sheet-content
    // row below guards against, one region over.
    expect(
      gestureOwner({ region: "canvas", gesture: "drag-down", atScrollTop: false, space: "memory" }),
    ).toBe("scroll");
  });

  it("does not leave the page on a swipe down at the page's own top", () => {
    // The page is home; there is nothing above it. Only memory's top has a
    // space to fall back to.
    expect(
      gestureOwner({ region: "canvas", gesture: "drag-down", atScrollTop: true, space: "page" }),
    ).toBe("scroll");
  });

  it("suppresses swipe-to-memory while a field has focus", () => {
    // gesture-arming.js's incident: a flick that lands on the editor
    // mid-keystroke (e.g. a fast return-key drag) must never be read as
    // swipe-to-memory. Without the gate this returns "memory" regardless,
    // and the user loses the space they were typing in.
    expect(
      gestureOwner({ region: "canvas", gesture: "drag-up", atScrollBottom: true, editing: true }),
    ).toBe("scroll");
  });

  it("suppresses the return-to-page swipe while a field has focus", () => {
    // Same incident, the other space-switch outcome: a swipe-down at
    // memory's top must not eject back to the page mid-keystroke either.
    expect(
      gestureOwner({
        region: "canvas",
        gesture: "drag-down",
        atScrollTop: true,
        space: "memory",
        editing: true,
      }),
    ).toBe("scroll");
  });

  it("no longer asks a keyboard belief, which could not be falsified", () => {
    // A Galaxy A34's webview froze every viewport height at the keyboard-up
    // value, so `keyboardOpen` was true for a whole session with no keyboard
    // on screen — and this table degraded the only gesture off the page for
    // just as long, at the same time the bottom slot stopped drawing a tab
    // bar. The gate stays; the witness is focus, which is state the DOM
    // reports rather than a number the webview infers.
    //
    // Passing the old name must now change nothing, or the rename left a
    // caller behind and the gate is silently off.
    expect(
      gestureOwner({
        region: "canvas",
        gesture: "drag-up",
        atScrollBottom: true,
        keyboardOpen: true,
      }),
    ).toBe("memory");
  });

  it("still lifts a block or dismisses a sheet with the keyboard up", () => {
    // The keyboard gate is scoped to the two space-switch outcomes only —
    // it must not suppress gestures that have nothing to do with switching
    // spaces.
    expect(
      gestureOwner({ region: "gutter-handle", gesture: "long-press", keyboardOpen: true }),
    ).toBe("block-lift");
    expect(
      gestureOwner({ region: "sheet-handle", gesture: "drag-down", keyboardOpen: true }),
    ).toBe("sheet-dismiss");
  });

  it("gives the header dots page switching, by pan, edge drag, or tap", () => {
    expect(gestureOwner({ region: "header-dots", gesture: "pan-horizontal" })).toBe("page-switch");
    expect(gestureOwner({ region: "header-dots", gesture: "tap" })).toBe("page-switch");
    // "drag-left"/"drag-right" are the same physical motion as
    // "pan-horizontal" on this region — forcing the recognizer to know
    // which string to emit per region would duplicate region knowledge
    // that belongs only here.
    expect(gestureOwner({ region: "header-dots", gesture: "drag-left" })).toBe("page-switch");
    expect(gestureOwner({ region: "header-dots", gesture: "drag-right" })).toBe("page-switch");
  });

  it("dismisses a sheet dragged down by its handle", () => {
    expect(gestureOwner({ region: "sheet-handle", gesture: "drag-down" })).toBe("sheet-dismiss");
  });

  it("dismisses a sheet dragged down from its content only at the content's top", () => {
    expect(
      gestureOwner({ region: "sheet-content", gesture: "drag-down", atScrollTop: true }),
    ).toBe("sheet-dismiss");
    // Mid-list, the same drag is the user reading. Dismissing here is the
    // "sheet closes while you scroll it" bug.
    expect(
      gestureOwner({ region: "sheet-content", gesture: "drag-down", atScrollTop: false }),
    ).toBe("scroll");
  });

  it("opens the block actions sheet from a long-press or a handle tap", () => {
    expect(gestureOwner({ region: "block", gesture: "long-press" })).toBe("block-actions");
    expect(gestureOwner({ region: "gutter-handle", gesture: "tap" })).toBe("block-actions");
  });

  it("lifts a block for reorder on a handle long-press", () => {
    expect(gestureOwner({ region: "gutter-handle", gesture: "long-press" })).toBe("block-lift");
  });

  it("reaches the edge row from every region that does not claim drag-right", () => {
    // atLeftEdge is independent of region BY DESIGN, and today that design
    // is true only by exhaustion: no row below the edge row happens to
    // claim drag-right, so none of them shadows it. Exhaustion is not a
    // guard — it holds until someone adds a row, and the failure it would
    // produce is the exact one Task 6 existed to fix (edge-back silently
    // unreachable on one region, working everywhere else, which reads as
    // a device quirk rather than a bug). So assert it rather than leaving
    // it implied by a grep nobody re-runs.
    for (const region of ["sheet-content", "sheet-handle", "block", "gutter-handle", "canvas"]) {
      expect(
        gestureOwner({ region, gesture: "drag-right", atLeftEdge: true, edgeBackArmed: true }),
      ).toBe("back");
    }
  });

  it("gives everything else to whatever is under the finger", () => {
    // The default is not a fallback for unhandled cases — it is the rule
    // that the shell claims no gesture it has not named above.
    expect(gestureOwner({ region: "somewhere", gesture: "tap" })).toBe("element");
    expect(gestureOwner({ region: "canvas", gesture: "tap" })).toBe("element");
  });
});
