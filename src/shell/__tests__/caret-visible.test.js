import { describe, it, expect } from "vitest";
import { caretScrollDelta, caretRecheckWarranted } from "../caret-visible.js";

// The visible band: below the nav bar (120) and above the slot (600).
const BAND = { bandTop: 120, bandBottom: 600 };

describe("caretScrollDelta", () => {
  it("does not move a caret that is already in the band", () => {
    // Zero is the whole point: scrolling a visible caret is the jump that
    // makes typing feel like the page is fighting you.
    expect(caretScrollDelta({ caretTop: 300, caretBottom: 320, ...BAND })).toBe(0);
  });

  it("scrolls the content up when the keyboard covers the caret", () => {
    const d = caretScrollDelta({ caretTop: 610, caretBottom: 630, ...BAND });
    expect(d).toBeGreaterThan(0);
    expect(d).toBe(38); // 630 + 8 margin - 600
  });

  it("scrolls the content down when the caret is behind the nav bar", () => {
    const d = caretScrollDelta({ caretTop: 100, caretBottom: 120, ...BAND });
    expect(d).toBeLessThan(0);
    expect(d).toBe(-28); // 100 - 8 margin - 120
  });

  it("shows the top of a caret taller than the band", () => {
    // A 600px "caret" is a selected block, not a text cursor. Both edges
    // cannot be satisfied, and the top is the one the user is working from —
    // aligning the bottom would scroll the start of their own selection off.
    const d = caretScrollDelta({ caretTop: 100, caretBottom: 900, ...BAND });
    expect(d).toBe(-28);
  });

  it("respects the caller's margin", () => {
    expect(caretScrollDelta({ caretTop: 610, caretBottom: 630, margin: 0, ...BAND })).toBe(30);
  });

  it("does not scroll a caret whose bottom sits exactly on the margin line", () => {
    // Locks no scroll at exactly the margin line: caretBottom + margin = bandBottom.
    // This does NOT pin the strict `>` — at that exact boundary the delta is 0,
    // so `>=` computes the same result. Both operators return 0 because the
    // distance past the threshold is 0. It documents the boundary; it does not
    // pin the operator.
    expect(caretScrollDelta({ caretTop: 560, caretBottom: 592, ...BAND })).toBe(0);
  });

  it("does not scroll a caret whose top sits exactly on the margin line", () => {
    // Locks no scroll at exactly the margin line: caretTop - margin = bandTop.
    // This does NOT pin the strict `<` — at that exact boundary the delta is 0,
    // so `<=` computes the same result. Both operators return 0 because the
    // distance past the threshold is 0. It documents the boundary; it does not
    // pin the operator.
    expect(caretScrollDelta({ caretTop: 128, caretBottom: 160, ...BAND })).toBe(0);
  });

  it("treats a selection that only fits the raw band, not the band minus margins, as too tall", () => {
    // Reviewer's repro. Selection height is 599 - 121 = 478; the raw band
    // is 600 - 120 = 480 (478 < 480, so the old `tooTall` check missed it),
    // but the band actually usable once both 8px margins are reserved is
    // 480 - 16 = 464, and 478 > 464 — this selection does not fit. Missing
    // that sent it into the bottom-alignment branch, which returned 7 and
    // scrolled the selection's TOP to 121 - 7 = 114: six pixels behind the
    // nav bar (bandTop 120). Top-preferring is correct here: -7 keeps the
    // top exactly on the margin line (121 - 8 - 120 = -7).
    const d = caretScrollDelta({ caretTop: 121, caretBottom: 599, ...BAND });
    expect(d).toBe(-7);
  });
});

// The other half of the feature: not how far to scroll, but whether now is a
// moment to scroll at all. The whole of the bug this guard was written for is
// a correction that was arithmetically right and asked at the wrong moment.
describe("caretRecheckWarranted", () => {
  it("answers the first ask", () => {
    // Nothing has been corrected against yet, so there is nothing to
    // compare — the caller has to be allowed to measure once.
    expect(caretRecheckWarranted(null, { keyboardOpen: false })).toBe(true);
  });

  it("refuses a trigger that has not changed", () => {
    // THE REGRESSION. This is not "nothing happens" as a shrug: an unchanged
    // trigger is exactly what a re-handed scroller, a re-render, or any read
    // nobody has noticed yet looks like from here, and the observed failure
    // (android-webview, 2026-09-02) was a page that would not stay at the top
    // because the nav bar unfolding re-ran the caller's effect and the
    // correction obliged, dragging the page back down to a caret the writer
    // had scrolled away from on purpose. False here is what makes those
    // re-runs cost nothing.
    expect(caretRecheckWarranted({ keyboardOpen: false }, { keyboardOpen: false })).toBe(false);
    expect(caretRecheckWarranted({ keyboardOpen: true }, { keyboardOpen: true })).toBe(false);
  });

  it("answers the keyboard arriving", () => {
    // The band's floor rises without the content moving, so a caret that was
    // visible can be behind the keyboard with no selection event to say so.
    expect(caretRecheckWarranted({ keyboardOpen: false }, { keyboardOpen: true })).toBe(true);
  });

  it("answers the keyboard leaving", () => {
    // Both directions, because it is a flip and not a level: a guard written
    // as `now.keyboardOpen && !last.keyboardOpen` would pass the test above
    // and leave the page scrolled up under a band that just got taller.
    expect(caretRecheckWarranted({ keyboardOpen: true }, { keyboardOpen: false })).toBe(true);
  });
});

describe("caretRecheckWarranted — the band moving under the caret", () => {
  it("re-checks when the visible band pans, with the keyboard already up", () => {
    // iOS: the engine moves the band to reveal the caret and the frame
    // follows it, which puts the content back down over the caret. The
    // keyboard does not flip while that happens, so without this the
    // correction is never asked to run again.
    expect(
      caretRecheckWarranted({ keyboardOpen: true, pan: 0 }, { keyboardOpen: true, pan: 120 }),
    ).toBe(true);
  });

  it("re-checks when the pan goes away again", () => {
    expect(
      caretRecheckWarranted({ keyboardOpen: true, pan: 120 }, { keyboardOpen: true, pan: 0 }),
    ).toBe(true);
  });

  it("refuses an unchanged pan, which is every frame on a platform without one", () => {
    // A level, not a change: a band that is panned and stays panned is
    // not a reason to scroll the writer's page under them.
    expect(
      caretRecheckWarranted({ keyboardOpen: true, pan: 120 }, { keyboardOpen: true, pan: 120 }),
    ).toBe(false);
    expect(
      caretRecheckWarranted({ keyboardOpen: true, pan: 0 }, { keyboardOpen: true, pan: 0 }),
    ).toBe(false);
  });

  it("treats a missing pan as none, so a caller that passes none is unchanged", () => {
    expect(caretRecheckWarranted({ keyboardOpen: true }, { keyboardOpen: true })).toBe(false);
    expect(caretRecheckWarranted({ keyboardOpen: true }, { keyboardOpen: true, pan: 0 })).toBe(false);
  });
});

describe("caretRecheckWarranted — the band's own height", () => {
  it("re-checks when the band gains a strip row with the keyboard unchanged", () => {
    // The bottom band holds a strip above the nav row, and the strip comes
    // and goes on inputs this function never hears about: find opening, a
    // sheet, a root switch. Each moves the floor by a --tap while
    // keyboardOpen and pan both stay put, so without this term the caret
    // can end up under a row that appeared after the last correction.
    expect(
      caretRecheckWarranted(
        { keyboardOpen: true, pan: 0, stripRow: false },
        { keyboardOpen: true, pan: 0, stripRow: true },
      ),
    ).toBe(true);
  });

  it("re-checks when it loses one, too", () => {
    expect(
      caretRecheckWarranted(
        { keyboardOpen: true, pan: 0, stripRow: true },
        { keyboardOpen: true, pan: 0, stripRow: false },
      ),
    ).toBe(true);
  });

  it("does not re-check when nothing moved", () => {
    // Not "nothing happens" for its own sake: the correction scrolls the
    // canvas, so running it on every render would fight the writer's own
    // scrolling. The empty answer here is the whole reason the function
    // exists rather than calling keepCaretVisible unconditionally.
    expect(
      caretRecheckWarranted(
        { keyboardOpen: true, pan: 0, stripRow: true },
        { keyboardOpen: true, pan: 0, stripRow: true },
      ),
    ).toBe(false);
  });
});

import { typingElsewhere } from "../caret-visible.js";

describe("typingElsewhere", () => {
  it("is the focus line or any field outside the editor", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(typingElsewhere(input)).toBe(true);
    input.remove();
  });

  // The editor itself, and a field INSIDE it (a table cell's input, a block
  // title), are the editor's own typing: the caret there is the one to keep.
  it("is not the editor, nor a field inside it", () => {
    const pm = document.createElement("div");
    pm.className = "ProseMirror";
    const inner = document.createElement("input");
    pm.appendChild(inner);
    document.body.appendChild(pm);
    expect(typingElsewhere(pm)).toBe(false);
    expect(typingElsewhere(inner)).toBe(false);
    pm.remove();
  });

  it("is nothing focused at all", () => {
    expect(typingElsewhere(null)).toBe(false);
    expect(typingElsewhere(document.body)).toBe(false);
  });
});
