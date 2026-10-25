import { describe, it, expect } from "vitest";
import { pinRowLabel } from "../pin-label.js";

// The fallback chain both pin lists share, tested where it now lives. It
// was PinsScreen's local function until memory's pins mode needed the same
// answer, and it had no test of its own then — the two ShellApp tests that
// covered it ("labels a pin with no title from its own text", and the row
// list) still do, from the screen's side.

describe("pinRowLabel", () => {
  it("says the pin's own title first", () => {
    expect(pinRowLabel({ id: "a", object_type: "note", title: "the second reader" })).toBe(
      "the second reader",
    );
  });

  it("falls back to the pin's text when it has no title", () => {
    expect(
      pinRowLabel({
        id: "a",
        object_type: "note",
        content: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "a trail is a project" }] }],
        }),
      }),
    ).toBe("a trail is a project");
  });

  it("falls back to the kind for a pin with no readable text at all", () => {
    // An image or a file. Its row would otherwise render as an empty line
    // the writer cannot tell from a broken one — which is the whole reason
    // the chain has a third link.
    expect(pinRowLabel({ id: "a", object_type: "file" })).toBe("file");
  });

  it("still says a word for a row with nothing on it at all", () => {
    // The property that matters is that the label is never empty, not that
    // it is any particular word: an empty row reads as a broken pin. The
    // word is "text" because `pinKind` is total and falls through its type
    // guards to that — which is also why the chain no longer carries a
    // `|| "pin"` behind it. See pin-label.js's header; that link could
    // never fire, on any input including this one.
    expect(pinRowLabel({})).toBe("text");
    expect(pinRowLabel(null)).toBe("text");
  });
});
