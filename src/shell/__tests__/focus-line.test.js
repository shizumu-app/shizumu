import { describe, it, expect } from "vitest";
import { focusLineWrite } from "../focus-line.js";

describe("focusLineWrite", () => {
  it("writes a new title", () => {
    expect(focusLineWrite({ draft: "finish the chapter", synced: null })).toBe("finish the chapter");
  });

  it("writes nothing when the field still says what the row says", () => {
    // A blur is not an edit — WhatMattersNow.svelte's handleBlur, quoted in
    // the module header. Every tap that leaves the field blurs it, and a
    // write here would broadcast the same title from every device that
    // ever focused it, with a newer clock each time.
    expect(focusLineWrite({ draft: "the book", synced: "the book" })).toBeNull();
  });

  it("treats an empty field over an empty row as no edit", () => {
    // The desktop's bug, exactly: an autofocused empty field blurring wrote
    // "" and out-clocked the real title on the other device. Empty over
    // null is the state every fresh page opens in.
    expect(focusLineWrite({ draft: "", synced: null })).toBeNull();
    expect(focusLineWrite({ draft: "", synced: "" })).toBeNull();
  });

  it("writes an emptied title, because un-naming a day is an edit", () => {
    expect(focusLineWrite({ draft: "", synced: "the book" })).toBe("");
  });

  it("compares the trimmed text, and writes the trimmed text", () => {
    expect(focusLineWrite({ draft: "the book ", synced: "the book" })).toBeNull();
    expect(focusLineWrite({ draft: "  the book  ", synced: null })).toBe("the book");
  });

  it("takes a missing draft as empty rather than throwing", () => {
    expect(focusLineWrite({ draft: undefined, synced: null })).toBeNull();
    expect(focusLineWrite({ draft: undefined, synced: "x" })).toBe("");
  });
});

// A continuous trail is one living document; each day's focus is stamped
// into it as that day's marker (CLAUDE.md, trail modes). The desktop stamps
// on the focus line's commit (Page.svelte onCommit); the phone never did,
// so a day written on the phone had no marker carrying its focus (sync
// journey J5.3, 2026-10-24).
import { dayMarkerStamp } from "../focus-line.js";

describe("dayMarkerStamp", () => {
  const base = { trailMode: "continuous", lineageId: "book", readonly: false, text: "chapter four", day: "2026-10-24" };

  it("stamps today's marker with the focus on a living document", () => {
    expect(dayMarkerStamp(base)).toEqual({ date: "2026-10-24", whatMatters: "chapter four" });
  });

  it("stamps an emptied focus too, so the marker follows it", () => {
    expect(dayMarkerStamp({ ...base, text: "" })).toEqual({ date: "2026-10-24", whatMatters: "" });
  });

  // Discrete trails and untrailed pages have no living document to mark.
  it("stamps nothing anywhere else", () => {
    expect(dayMarkerStamp({ ...base, trailMode: "discrete" })).toBeNull();
    expect(dayMarkerStamp({ ...base, lineageId: null })).toBeNull();
  });

  // A page that cannot be written cannot take a marker either.
  it("stamps nothing on a read-only page", () => {
    expect(dayMarkerStamp({ ...base, readonly: true })).toBeNull();
  });
});
