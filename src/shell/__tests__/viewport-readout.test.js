import { describe, it, expect } from "vitest";
import { readoutWanted, viewportReadoutLines, viewportReadoutSummary } from "../viewport-readout.js";

const snap = (over = {}) => ({
  innerHeight: 844, vvHeight: 508, offsetTop: 0, scrollY: 0,
  appHeight: 508, kbInset: 336, kbOverlay: 336, vvOffsetTop: 0,
  isOpen: true, focused: true, event: "resize",
  ...over,
});

describe("viewportReadoutLines", () => {
  it("carries every number the report cannot be settled without", () => {
    const [raw, derived, state] = viewportReadoutLines(snap(), { top: 0, height: 508 });
    expect(raw).toBe("inner 844  vv 508  pan 0  scroll 0");
    expect(derived).toBe("app 508  inset 336  overlay 336  top 0");
    expect(state).toBe("frame 0..508  kb up  field yes  resize");
  });

  it("shows the pan and the frame that followed it, which is one candidate", () => {
    // WebKit panned the band down to reveal the caret; the frame followed
    // by the same amount. Both numbers on one line is what makes that
    // readable from a photograph.
    const [raw, derived, state] = viewportReadoutLines(
      snap({ offsetTop: 120, vvOffsetTop: 120, kbOverlay: 216 }),
      { top: 120, height: 508 },
    );
    expect(raw).toContain("pan 120");
    expect(derived).toContain("top 120");
    expect(state).toContain("frame 120..628");
  });

  it("shows a layout scroll with no pan, which is the other candidate", () => {
    const [raw] = viewportReadoutLines(snap({ scrollY: 96 }), { top: 0, height: 508 });
    expect(raw).toContain("pan 0");
    expect(raw).toContain("scroll 96");
  });

  it("says the frame is unmeasured rather than zero", () => {
    // Before the box is read there is no frame, and `0..0` would read as
    // a frame collapsed to nothing — the failure this line exists to
    // report.
    expect(viewportReadoutLines(snap(), null)[2]).toContain("frame —");
  });

  it("survives a snapshot with nothing in it", () => {
    // The store's initial value, and whatever a browser with no visual
    // viewport reports. A readout that threw would take the screen it is
    // diagnosing with it.
    expect(viewportReadoutLines(null, null)).toHaveLength(7);
    expect(viewportReadoutLines({ innerHeight: NaN }, null)[0]).toBe(
      "inner 0  vv 0  pan 0  scroll 0",
    );
  });

  it("says plainly when the native signal never arrived", () => {
    // The line to read first on a device. A dash is not a cosmetic gap: it
    // means the activity never published IME visibility, so every number
    // above it is an inference again — and an inference is exactly what a
    // Galaxy A34's frozen viewport makes unfalsifiable. Diagnosing that
    // from the other four lines is what cost four builds.
    expect(viewportReadoutLines(snap(), null)[4]).toBe("nat —");
    expect(viewportReadoutLines(snap({ native: { visible: true, heightPx: 312 } }), null)[4]).toBe(
      "nat up 312",
    );
    expect(viewportReadoutLines(snap({ native: { visible: false, heightPx: 0 } }), null)[4]).toBe(
      "nat down 0",
    );
  });

  it("separates no block from no snapshot", () => {
    // The two failures that looked identical on a phone. The gutter handle
    // vanished; one photograph had the `turn into` chip (so a block was
    // reported and the handle was in the DOM, invisible) and the next did
    // not and had `undo` dead (so nothing had ever been reported). Those
    // are opposite hunts, and this line is what tells them apart without
    // another build.
    const line = (editor) => viewportReadoutLines(snap(), null, editor)[5];

    // Never heard from the editor at all — a subscription that did not
    // deliver, not an editor with nothing to say.
    expect(line(null)).toBe("blk —  snap —");
    expect(line({ activeBlock: null, canUndo: false, seen: false })).toBe("blk —  snap —");

    // A live snapshot that reports no block: a depth-0 selection, or a
    // page that has not loaded. `undo` is the second opinion — it comes
    // from the editor's history rather than its selection.
    expect(line({ activeBlock: null, canUndo: true, seen: true })).toBe(
      "blk —  snap live  undo y",
    );

    expect(line({ activeBlock: { type: "paragraph", pos: 42 }, canUndo: true, seen: true })).toBe(
      "blk paragraph@42  snap live  undo y",
    );
  });

  it("names which step declined to draw the handle", () => {
    // The second round of the missing-⋮ hunt. The block line proved the
    // snapshot was alive and named a block — so the handle was NOT missing
    // for want of one, and the four remaining causes inside PageScreen's
    // gutterHandle are indistinguishable from a photograph. `ok` with a
    // top means it is in the DOM and the question becomes why it does not
    // paint; anything else is the step that said no.
    const line = (handle) => viewportReadoutLines(snap(), null, null, handle)[6];
    expect(line(null)).toBe("hdl —");
    expect(line({ why: "no-editor", top: null })).toBe("hdl no-editor");
    expect(line({ why: "bad-pos", top: null })).toBe("hdl bad-pos");
    expect(line({ why: "ok", top: 31 })).toBe("hdl ok top 31");
    // A top of 0 is a real measurement, not an absence: the first block's
    // handle sits near the canvas top and `top ?? ""` would hide it.
    expect(line({ why: "ok", top: 0 })).toBe("hdl ok top 0");
  });
});

describe("readoutWanted", () => {
  it("is off by default, which is every build but one", () => {
    expect(readoutWanted({ search: "" }, {})).toBe(false);
    expect(readoutWanted(null, null)).toBe(false);
  });

  it("is on for a build that asked for it", () => {
    expect(readoutWanted({ search: "" }, { VITE_VIEWPORT_READOUT: "1" })).toBe(true);
  });

  it("is on for a dev server told on the URL", () => {
    expect(readoutWanted({ search: "?viewport=1" }, {})).toBe(true);
    expect(readoutWanted({ search: "?inset=notch&viewport=1" }, {})).toBe(true);
  });

  it("is not turned on by a query that merely starts the same", () => {
    expect(readoutWanted({ search: "?viewport=10" }, {})).toBe(false);
    expect(readoutWanted({ search: "?viewportish=1" }, {})).toBe(false);
  });
});

describe("viewportReadoutSummary — the collapsed line", () => {
  // IT EXISTS BECAUSE THE DIAGNOSTIC WAS IN THE WAY: eight lines in the
  // flow, reported from a phone as taking the room the bottom buttons
  // needed. One line, and the other seven on a tap.
  const A16 = { appHeight: 522, kbInset: 310, isOpen: true, native: { visible: true, heightPx: 310 } };

  it("says which band, which keyboard, which inset and which handle branch", () => {
    expect(viewportReadoutSummary(A16, { why: "ok", top: 23 }, "48px"))
      .toBe("app 522  kb nat 310  safe 48px  hdl ok");
  });

  it("distinguishes a measured keyboard from an inferred one", () => {
    // The whole diagnosis of the Android pass in one word. `inf` means the
    // arithmetic answered, which on a phone that reports no viewport change
    // means nobody answered at all.
    expect(viewportReadoutSummary({ ...A16, native: null })).toContain("kb inf 310");
    expect(viewportReadoutSummary({ ...A16, native: { visible: false, heightPx: 0 } }))
      .toContain("kb nat down");
    expect(viewportReadoutSummary({ appHeight: 832, isOpen: false })).toContain("kb down");
  });

  it("says so rather than lying when there is nothing to report", () => {
    // Not an empty-result assertion: a dash is a readable answer on a
    // photograph and 0 is not — `safe 0px` is a measurement, `safe —` is the
    // absence of one, and the device pass turned on telling them apart.
    expect(viewportReadoutSummary(null)).toBe("app 0  kb down  safe —  hdl —");
  });
});

describe("the native line carries the two numbers that settle the bars", () => {
  it("shows the raw IME inset and the navigation bar beside the published height", () => {
    // They exist to be read off a photograph: if `nav` is 0 while the IME is
    // up, the subtraction that produces `heightPx` is dead and that height
    // includes the bar's strip, which decides whether the band is 48px short
    // or exactly right. Nothing in this repository can ask that question.
    const lines = viewportReadoutLines({
      native: { visible: true, heightPx: 310, imeRawPx: 358, navPx: 48 },
    });
    expect(lines.find((l) => l.startsWith("nat "))).toBe("nat up 310  raw 358  nav 48");
  });

  it("says nothing extra where there is no activity to ask", () => {
    // iOS, desktop and the demo report no native state at all, and a line
    // reading "raw 0 nav 0" there would be four invented numbers.
    expect(viewportReadoutLines({}).find((l) => l.startsWith("nat "))).toBe("nat —");
    expect(
      viewportReadoutLines({ native: { visible: false, heightPx: 0 } })
        .find((l) => l.startsWith("nat ")),
    ).toBe("nat down 0");
  });
});
