import { describe, it, expect } from "vitest";
import { SCENES, THEMES, VR_SCENE_IDS, getScene, isMarketingScene } from "./scenes.js";

const BASELINED = [
  "dead-image-ref", "memory-list", "onboarding", "page-blank",
  "page-board-content", "page-chart-content", "page-content",
  "page-decision-content", "page-empty-chart", "page-empty-table",
  "page-file-content", "page-image-content", "page-qa-content",
  "page-recipe-content", "page-short-board", "page-table-content",
  "pin-view", "trail-continuous",
];

const MARKETING = [
  "mk-blocks", "mk-decision", "mk-evidence", "mk-evidence-subject",
  "mk-memory", "mk-mention", "mk-tasks", "mk-tools",
];

describe("vr scenes", () => {
  it("defines the initial catalog", () => {
    expect(Object.keys(SCENES).sort()).toEqual([...BASELINED, ...MARKETING].sort());
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

  // Not an "expect nothing happens" assertion: the point is that
  // VR_SCENE_IDS is EXACTLY the baselined set. A marketing scene leaking
  // into it generates baselines on three Playwright projects and turns the
  // next copy edit into a screenshot diff to re-approve — which is why the
  // previous marketing scenes were reverted instead of kept.
  it("VR_SCENE_IDS is the baselined catalog, marketing excluded", () => {
    expect([...VR_SCENE_IDS].sort()).toEqual([...BASELINED].sort());
    for (const id of MARKETING) {
      expect(VR_SCENE_IDS).not.toContain(id);
      expect(isMarketingScene(SCENES[id])).toBe(true);
    }
    for (const id of BASELINED) {
      expect(isMarketingScene(SCENES[id])).toBe(false);
    }
  });

  // Marketing scenes are still reachable by the capture harness, and still
  // real scenes — a broken one would fail at photo time, not here.
  it("marketing scenes are resolvable and shaped like any other scene", () => {
    for (const id of MARKETING) {
      const s = getScene(id);
      expect(["page", "memory"]).toContain(s.space);
      expect(typeof s.fixture).toBe("function");
    }
  });

  // The `blobs` seam (seed.js) is what makes an attachment image render at
  // all under the mock — and it must stay OFF everywhere else. page-image
  // -content and dead-image-ref exist to photograph the "image not on this
  // device" fallback; a blobs loader leaking onto either would silently
  // replace those baselines' whole subject with a bitmap.
  it("only marketing scenes declare a blobs loader", () => {
    for (const id of BASELINED) {
      expect(SCENES[id].blobs).toBeUndefined();
    }
    expect(typeof SCENES["mk-evidence"].blobs).toBe("function");
  });
});
