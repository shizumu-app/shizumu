import { describe, it, expect } from "vitest";
import { SCENES, sceneSurface, getScene } from "../scenes.js";

describe("sceneSurface", () => {
  it("defaults every pre-shell scene to the desktop tree", () => {
    // The nine scenes that predate the shell carry no surface field on
    // purpose — the default is what keeps them from being re-shot at
    // iPhone size when the ios-webkit project lands.
    for (const [id, scene] of Object.entries(SCENES)) {
      // shell- scenes, and the mk-shell- marketing shots of the phone layout
      if (id.startsWith("shell-") || id.startsWith("mk-shell-")) continue;
      expect(sceneSurface(scene)).toBe("desktop");
    }
  });

  it("marks the shell scenes as shell", () => {
    expect(sceneSurface(getScene("shell-gallery"))).toBe("shell");
    expect(sceneSurface(getScene("shell-gallery-sheet"))).toBe("shell");
  });

  it("treats an unknown surface value as desktop", () => {
    // Fail safe: a typo must not silently exclude a desktop scene from the
    // desktop projects, which would be a regression nobody sees — the
    // scene simply stops being shot.
    expect(sceneSurface({ surface: "shel" })).toBe("desktop");
    expect(sceneSurface({})).toBe("desktop");
    expect(sceneSurface(null)).toBe("desktop");
  });
});
