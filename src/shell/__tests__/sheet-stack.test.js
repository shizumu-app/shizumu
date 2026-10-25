import { describe, it, expect } from "vitest";
import { nextSheet } from "../sheet-stack.js";

describe("nextSheet", () => {
  it("opening a sheet while another shows replaces it", () => {
    expect(nextSheet({ current: "a", opening: "b" })).toEqual({
      show: "b",
      dismissed: "a",
    });
  });

  it("opening a sheet while nothing shows just shows it", () => {
    expect(nextSheet({ current: null, opening: "b" })).toEqual({
      show: "b",
      dismissed: null,
    });
  });

  it("opening null while a sheet shows dismisses it", () => {
    expect(nextSheet({ current: "a", opening: null })).toEqual({
      show: null,
      dismissed: "a",
    });
  });

  it("re-opening the sheet already showing is inert, not a reload", () => {
    // The naive rule is "dismiss the current sheet, then show the one
    // opening" — always. That reads correctly for every case above, but
    // applied here it would dismiss "a" and then show "a" again, which is
    // indistinguishable from a fresh mount to whatever consumes this
    // result. The trail picker and the pin note sheet both hold a field;
    // a host that tears down and rebuilds the sheet on this transition
    // would lose whatever the user had typed into it, even though nothing
    // about which sheet is showing actually changed. So this case must
    // report no dismissal at all, not "dismissed then reshown".
    expect(nextSheet({ current: "a", opening: "a" })).toEqual({
      show: "a",
      dismissed: null,
    });
  });

  it("opening null while nothing shows is inert", () => {
    // Not a "why the empty result is right" case in the tricky sense above
    // (there's no teardown to avoid — there was nothing mounted), but it's
    // still a neutral result that needs stating: dismissing an already-
    // absent sheet must not report a phantom dismissal, or a caller
    // driving an animation off `dismissed` would fire one for a sheet that
    // was never shown.
    expect(nextSheet({ current: null, opening: null })).toEqual({
      show: null,
      dismissed: null,
    });
  });
});
