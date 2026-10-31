import { describe, it, expect, afterEach, vi } from "vitest";
import { fade, prefersReducedMotion } from "../motion.js";

// jsdom has no matchMedia: each test sets the one its host would have.
const media = (reduce) => {
  window.matchMedia = vi.fn((q) => ({
    matches: reduce && q === "(prefers-reduced-motion: reduce)",
    media: q, addEventListener() {}, removeEventListener() {},
  }));
};

afterEach(() => { delete window.matchMedia; });

describe("motion — the app's fade, which keeps still when asked to", () => {
  // The CSS motion tokens zero under prefers-reduced-motion, but Svelte's
  // transitions take a number, not a token: nineteen fades played in full
  // for a writer who had asked for none (Vercel's guidelines, 2026-10-31).
  it("plays the given duration normally", () => {
    media(false);
    expect(fade(document.createElement("div"), { duration: 180 }).duration).toBe(180);
  });

  it("takes no time when the system asks for less motion", () => {
    media(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(fade(document.createElement("div"), { duration: 180 }).duration).toBe(0);
  });

  it("reads as no preference where matchMedia is missing", () => {
    // jsdom-like hosts and old webviews: motion stays as designed.
    delete window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });
});
