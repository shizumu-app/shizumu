import { describe, it, expect } from "vitest";
import { blockAlreadyPinned } from "../block-already-pinned.js";

describe("blockAlreadyPinned", () => {
  it("says yes on the stamp, whatever the stored content looks like", () => {
    // THE regression. `existingPinContents` holds what was STORED, and
    // quickPinFromCursor stores the node's JSON while both callers looked
    // up the block's plain text — so the content check could never match
    // on that path and a second press re-stamped the node, orphaning the
    // first pin. The stamp is in the DOM already (pin-id.js renders
    // data-pin-id); asking it is exact.
    const pinnedContents = new Set(['{"type":"paragraph","content":[]}']);
    expect(
      blockAlreadyPinned({ pinId: "pin_123", text: "a kept thought", pinnedContents }),
    ).toBe(true);
  });

  it("still says yes when the same words are kept somewhere else", () => {
    // The weaker check, deliberately kept. It is the only one that can see
    // a block pasted from a page whose pin lives on another one — that
    // block carries no stamp of its own.
    const pinnedContents = new Set(["a kept thought"]);
    expect(
      blockAlreadyPinned({ pinId: null, text: "a kept thought", pinnedContents }),
    ).toBe(true);
  });

  it("says no for an unstamped block whose words are not kept", () => {
    // Not a placeholder: this is the state in which the pin affordance must
    // stay live, and the one a guard that over-answers would break by
    // dimming a control the writer can still use.
    const pinnedContents = new Set(["something else entirely"]);
    expect(
      blockAlreadyPinned({ pinId: null, text: "a new thought", pinnedContents }),
    ).toBe(false);
  });

  it("does not treat an empty block as kept just because '' is absent", () => {
    // An empty string must not fall through to a Set lookup that could
    // accidentally hold "". Asserted because the early return for falsy
    // text is easy to delete as redundant.
    expect(
      blockAlreadyPinned({ pinId: null, text: "", pinnedContents: new Set([""]) }),
    ).toBe(false);
  });

  it("answers no rather than throwing when nothing has loaded yet", () => {
    // refreshExistingPinContents is async; the gutter can ask before it has
    // returned. A throw here would take out the block-handle reveal.
    expect(blockAlreadyPinned({ pinId: null, text: "anything" })).toBe(false);
    expect(blockAlreadyPinned()).toBe(false);
  });
});
