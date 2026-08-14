import { describe, it, expect } from "vitest";
import { barVisible } from "../bar-visibility.js";

describe("barVisible", () => {
  it("visible in the default state", () => {
    expect(barVisible({ hideBarNav: false, keyboardOpen: false })).toBe(true);
  });
  it("hidden while a sheet requests it", () => {
    expect(barVisible({ hideBarNav: true, keyboardOpen: false })).toBe(false);
  });
  it("hidden under the keyboard, back the moment it closes — no latch", () => {
    expect(barVisible({ hideBarNav: false, keyboardOpen: true })).toBe(false);
    expect(barVisible({ hideBarNav: false, keyboardOpen: false })).toBe(true);
  });
});
