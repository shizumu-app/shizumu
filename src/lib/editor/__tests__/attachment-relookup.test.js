import { describe, it, expect } from "vitest";
import { looksAgainAfterPull } from "../attachment-relookup.js";

describe("looksAgainAfterPull", () => {
  const base = { isImage: true, hash: "h", drawn: false, failedHash: null };
  it("a missing image looks again: a pull is when its bytes can arrive", () => {
    expect(looksAgainAfterPull(base)).toBe(true);
  });
  it("a drawn image does not: a content-addressed path cannot change", () => {
    expect(looksAgainAfterPull({ ...base, drawn: true })).toBe(false);
  });
  it("an image whose file failed to load does not: retrying is the flicker loop", () => {
    expect(looksAgainAfterPull({ ...base, failedHash: "h" })).toBe(false);
  });
  it("a file attachment does not: it resolves nothing to draw", () => {
    expect(looksAgainAfterPull({ ...base, isImage: false })).toBe(false);
  });
  it("a node with no hash does not: there is nothing to ask about", () => {
    expect(looksAgainAfterPull({ ...base, hash: null })).toBe(false);
  });
});
