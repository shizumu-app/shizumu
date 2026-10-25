import { describe, it, expect } from "vitest";
import {
  SCENES, THEMES, VR_SCENE_IDS,
  getScene, isMarketingScene, sceneSlides, sceneViewportHeight,
} from "./scenes.js";

const BASELINED = [
  "dead-image-ref", "memory-list", "onboarding", "page-blank",
  "page-board-content", "page-chart-content", "page-content",
  "page-decision-content", "page-empty-chart", "page-empty-table",
  "page-file-content", "page-image-content", "page-qa-content",
  "page-recipe-content", "page-short-board", "page-table-content",
  "pin-view", "shell-gallery", "shell-gallery-sheet", "shell-onboarding",
  "shell-page", "shell-trail-page", "trail-continuous",
];

const MARKETING = [
  "mk-blocks", "mk-decision", "mk-evidence", "mk-evidence-subject",
  "mk-memory", "mk-mention", "mk-tasks", "mk-tools", "mk-trail",
  "mk-shell-memory", "mk-shell-tools", "mk-shell-trail",
];

describe("vr scenes", () => {
  it("defines the initial catalog", () => {
    expect(Object.keys(SCENES).sort()).toEqual([...BASELINED, ...MARKETING].sort());
  });

  it("each scene has a space and fixture", () => {
    for (const s of Object.values(SCENES)) {
      // "shell-gallery" is the shell's own route (App.svelte's lazily
      // imported catalogue), not a desktop space. main's list predates it;
      // the shell's scenes were already using it before this merge.
      expect(["page", "memory", "shell-gallery"]).toContain(s.space);
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

  it("forces a tall viewport for the two gallery scenes and nothing else", () => {
    // The height override used to key on `surface === "shell"`, which meant
    // the first shell SCREEN scene would silently inherit a catalogue-tall
    // phone — a header fold and a tab-bar position no device produces.
    // Keyed on the scene, what this holds is that exactly these two carry
    // one, named rather than shape-asserted, so a screen scene that gained
    // the field is reported here as a mistake rather than photographed at
    // a height it never has.
    //
    // The number is the gallery's and moves when the catalogue does. It
    // was 1200 over a measured ~839px column; the visual pass's Task 10
    // set 2400 over an ESTIMATED ~2130px (the arithmetic is in that
    // commit and marked ◆ in the plan) — confirm on the first re-shoot,
    // and when it comes down, it comes down here too.
    const forced = Object.entries(SCENES)
      .filter(([, s]) => sceneViewportHeight(s) !== null)
      .map(([id, s]) => [id, sceneViewportHeight(s)]);
    expect(forced).toEqual([
      ["shell-gallery", 2400],
      ["shell-gallery-sheet", 2400],
    ]);
  });

  it("walks a deck only for the two scenes that are one", () => {
    // Named rather than shape-asserted, for the reason the viewport test
    // above names its two: `sceneSlides` renames a scene's baselines from
    // `<id>-<theme>.png` to `<id>-s1-<theme>.png`, so a scene that gained
    // the field by accident would orphan every PNG it already has and be
    // reported as three missing baselines rather than as a mistake.
    const decks = Object.entries(SCENES)
      .filter(([, s]) => sceneSlides(s) !== null)
      .map(([id, s]) => [id, sceneSlides(s)]);
    expect(decks).toEqual([
      ["onboarding", 6],
      ["shell-onboarding", 4],
    ]);
  });

  it("refuses a slide count that is not a deck", () => {
    // Not "nothing happens": null is what sends visual.spec.js down the
    // single-capture branch, so each of these is a value that would
    // otherwise put a scene into the walking branch with nothing to walk —
    // and a 1-slide walk silently renames that scene's baselines.
    expect(sceneSlides(getScene("shell-page"))).toBeNull();
    expect(sceneSlides({})).toBeNull();
    expect(sceneSlides(null)).toBeNull();
    expect(sceneSlides({ slides: 1 })).toBeNull();
    expect(sceneSlides({ slides: 0 })).toBeNull();
    expect(sceneSlides({ slides: "4" })).toBeNull();
    expect(sceneSlides({ slides: 4.5 })).toBeNull();
  });

  // The shell's gate needs BOTH halves, and dropping either photographs the
  // other tree without failing: `onboarding` is what keeps App.svelte's
  // chain from reaching the boot fork, and the shell flag is what makes the
  // branch it stops at render the shell's gate rather than the desktop's
  // six slides.
  it("declares the shell onboarding gate as a shell scene that onboards", async () => {
    const gate = getScene("shell-onboarding");
    expect(gate.surface).toBe("shell");
    expect(gate.onboarding).toBe(true);
    expect(sceneViewportHeight(gate)).toBeNull();

    // The flag itself, not just the field: `withShellFlag` writes the exact
    // string shell-boot.js compares against, and a boolean would still boot
    // the shell while seeding something no install can contain.
    const calls = [];
    await gate.fixture(async (cmd, args) => {
      calls.push([cmd, args]);
      return null;
    });
    expect(calls[0]).toEqual(["set_setting", { key: "try_new_shell", value: "true" }]);
  });

  it("gives a scene without the field the project's own viewport", () => {
    // Not "nothing happens" bait: null is the signal visual.spec.js reads to
    // SKIP setViewportSize entirely, so a screen scene is photographed at
    // the device size the project declares. A 0 or a negative would be a
    // typo, and honouring it would produce an unreadable capture.
    expect(sceneViewportHeight(getScene("shell-page"))).toBeNull();
    expect(sceneViewportHeight({})).toBeNull();
    expect(sceneViewportHeight(null)).toBeNull();
    expect(sceneViewportHeight({ viewportHeight: 0 })).toBeNull();
    expect(sceneViewportHeight({ viewportHeight: "1200" })).toBeNull();
  });
});
