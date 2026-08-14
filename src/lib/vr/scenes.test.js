import { describe, it, expect } from "vitest";
import { SCENES, THEMES, getScene } from "./scenes.js";

describe("vr scenes", () => {
  it("defines the initial catalog", () => {
    expect(Object.keys(SCENES).sort()).toEqual(
      ["dead-image-ref", "memory-list", "onboarding", "page-blank", "page-board-content", "page-content", "pin-view", "trail-continuous"].sort()
    );
  });

  it("each scene has a space and fixture", () => {
    for (const s of Object.values(SCENES)) {
      expect(["page", "memory"]).toContain(s.space);
      expect(typeof s.fixture).toBe("function");
      expect(typeof s.onboarding).toBe("boolean");
    }
  });

  it("THEMES is the three tones", () => {
    expect(THEMES).toEqual(["cream", "white", "dark"]);
  });

  it("getScene throws on unknown id", () => {
    expect(() => getScene("nope")).toThrow();
  });
});
