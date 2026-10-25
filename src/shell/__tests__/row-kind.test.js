import { describe, it, expect } from "vitest";
import { ROW_KINDS, rowKind, rowChevron, rowTone } from "../row-kind.js";

const noop = () => {};

describe("rowKind", () => {
  it("takes an explicit kind over everything the other props say", () => {
    // A `save` row has an onSelect — it does something — and it is not a
    // push. The caller's word wins; the derivation below is only for the
    // callers that never said one.
    expect(rowKind({ onSelect: noop, kind: "action" })).toBe("action");
    expect(rowKind({ onSelect: noop, kind: "choice" })).toBe("choice");
    expect(rowKind({ onSelect: noop, destructive: true, kind: "action" })).toBe("action");
    expect(rowKind({ toggle: true, kind: "value" })).toBe("value");
  });

  it("derives destructive before toggle before push before value", () => {
    expect(rowKind({ onSelect: noop, destructive: true })).toBe("destructive");
    expect(rowKind({ toggle: true })).toBe("toggle");
    expect(rowKind({ onSelect: noop })).toBe("push");
    expect(rowKind({})).toBe("value");
    expect(rowKind()).toBe("value");
  });

  it("keeps every existing caller a push — onSelect alone, no kind", () => {
    // The back-compat default the module header records. Before this
    // module, `onSelect` meant button + chevron; a caller written then
    // and never touched must render exactly what it rendered.
    expect(rowKind({ onSelect: noop, kind: null })).toBe("push");
    expect(rowKind({ onSelect: noop, kind: undefined })).toBe("push");
    expect(rowChevron(rowKind({ onSelect: noop }))).toBe(true);
  });

  it("refuses a kind it does not know", () => {
    // A typo would otherwise derive to a chevron-less button — the same
    // markup as `choice` — and pass every test that counts chevrons.
    expect(() => rowKind({ onSelect: noop, kind: "acton" })).toThrow(/unknown kind "acton"/);
  });

  it("names the six kinds and no more", () => {
    expect(ROW_KINDS).toEqual(["push", "action", "choice", "destructive", "toggle", "value"]);
  });
});

describe("rowChevron", () => {
  it("draws the chevron for a push and nothing else", () => {
    expect(rowChevron("push")).toBe(true);
  });

  it("draws no chevron for an action, because an action opens no screen", () => {
    // Not an empty assertion: the chevron is the promise that a tap opens
    // a screen for it to point at. `save` saves and stays; `continue`
    // pops back to the page. A chevron on either is a promise the row
    // breaks the moment it is tapped — the defect this module exists
    // for, `save ›` on the pin editor.
    expect(rowChevron("action")).toBe(false);
  });

  it("draws no chevron for a choice — a sheet closing is not a screen opening", () => {
    expect(rowChevron("choice")).toBe(false);
  });

  it("draws no chevron for destructive, toggle or value", () => {
    // Destructive acts and stays (delete is not a destination), a toggle
    // is its own control, and a value row is inert — none has anywhere
    // to point.
    for (const kind of ["destructive", "toggle", "value"]) {
      expect(rowChevron(kind), kind).toBe(false);
    }
  });
});

describe("rowTone", () => {
  it("draws an action in accent and a destructive row in warm", () => {
    expect(rowTone("action")).toBe("accent");
    expect(rowTone("destructive")).toBe("warm");
  });

  it("draws every other kind in ink", () => {
    for (const kind of ["push", "choice", "toggle", "value"]) {
      expect(rowTone(kind), kind).toBe("ink");
    }
  });
});
