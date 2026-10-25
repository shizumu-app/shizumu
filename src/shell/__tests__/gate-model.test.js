import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gateStep, gateAdvance, ONBOARDING_SLIDES } from "../gate-model.js";

describe("gateStep", () => {
  it("gives lock one action and calls it the last step", () => {
    expect(gateStep({ kind: "lock" })).toEqual({ slide: null, action: "unlock", last: true });
  });

  it("labels every onboarding slide but the last one `next`", () => {
    for (let i = 0; i < ONBOARDING_SLIDES.length - 1; i++) {
      expect(gateStep({ kind: "onboarding", index: i }).action).toBe("gate-next");
    }
  });

  it("labels the last onboarding slide `begin`", () => {
    expect(gateStep({ kind: "onboarding", index: ONBOARDING_SLIDES.length - 1 }).action).toBe(
      "gate-begin",
    );
  });

  it("hands back the slide at the index", () => {
    expect(gateStep({ kind: "onboarding", index: 1 }).slide).toBe(ONBOARDING_SLIDES[1]);
  });

  it("clamps an index outside the deck rather than resolving to nothing", () => {
    // Not "nothing happens": the assertion is that a bad index still
    // produces a REAL slide. Unclamped, `ONBOARDING_SLIDES[9]` is undefined
    // and the gate renders a title, no words and one button — which reads
    // as a load that failed, on the first screen a new user ever sees.
    expect(gateStep({ kind: "onboarding", index: 99 }).slide).toBe(
      ONBOARDING_SLIDES[ONBOARDING_SLIDES.length - 1],
    );
    expect(gateStep({ kind: "onboarding", index: -3 }).slide).toBe(ONBOARDING_SLIDES[0]);
  });

  it("offers no action for a kind it does not know", () => {
    // The empty answer is right here because the alternative is a band with
    // a button in it that does nothing: `toolbarFor` reads a null
    // `gateAction` as "not a gate" and ShellGate then reserves no slot at
    // all, which is the honest rendering of a surface with no action.
    expect(gateStep({ kind: "midnight" }).action).toBeNull();
  });
});

describe("gateAdvance", () => {
  it("walks the deck one slide at a time", () => {
    expect(gateAdvance({ kind: "onboarding", index: 0 })).toEqual({ done: false, index: 1 });
  });

  it("finishes exactly where the label says `begin`", () => {
    // THE POINT OF THE MODULE. These two questions are one off-by-one
    // apart, and answered separately they ship either a last slide labelled
    // `next` that completes anyway, or one labelled `begin` with another
    // slide behind it. Asserted as an agreement across both functions,
    // because neither can see the divergence alone.
    for (let i = 0; i < ONBOARDING_SLIDES.length; i++) {
      const { action } = gateStep({ kind: "onboarding", index: i });
      const { done } = gateAdvance({ kind: "onboarding", index: i });
      expect(done, `slide ${i}`).toBe(action === "gate-begin");
    }
  });

  it("does not walk an unknown gate's index upward forever", () => {
    // A kind with no step to show has no next step either. Falling through
    // to `index + 1` would raise the index on every press, on a surface
    // whose one control is that press.
    expect(gateAdvance({ kind: "midnight", index: 0 })).toEqual({ done: true, index: 0 });
  });
});

describe("the gate copy", () => {
  const RETIRED = /\b(sink|sinks|sinking|sunk)\b/i;

  it("carries none of the retired word", () => {
    // CLAUDE.md's "Retired word — sink (2026-08-27)": it must not appear in
    // any user-facing string. The desktop's six slides still do carry it
    // (SinksSlide, BrandSlide, PinSlide) and retiring it there is its own
    // spec — all six have VR snapshot coverage a wording change would
    // break. This deck is new copy, so it starts clean and this guard is
    // what keeps the next slide from reintroducing it.
    for (const slide of ONBOARDING_SLIDES) {
      expect(RETIRED.test(slide.title), slide.id).toBe(false);
      expect(RETIRED.test(slide.body), slide.id).toBe(false);
    }
  });

  it("carries none of the canon's forbidden words", () => {
    const FORBIDDEN = [
      "productivity",
      "optimize",
      "habit",
      "streak",
      "mindful",
      "journey",
      "growth",
      "!",
      "your thinking is in the pins",
    ];
    for (const slide of ONBOARDING_SLIDES) {
      const text = `${slide.title} ${slide.body}`.toLowerCase();
      for (const word of FORBIDDEN) {
        expect(text.includes(word), `${slide.id}: ${word}`).toBe(false);
      }
    }
  });

  it("is lowercase throughout", () => {
    // The canon's first voice rule. A capital in a slide body is how a
    // sentence copied from the website arrives.
    for (const slide of ONBOARDING_SLIDES) {
      expect(slide.title, slide.id).toBe(slide.title.toLowerCase());
      expect(slide.body, slide.id).toBe(slide.body.toLowerCase());
    }
  });

  it("threads all three active verbs across the deck", () => {
    const deck = ONBOARDING_SLIDES.map((s) => `${s.title} ${s.body}`).join(" ");
    for (const verb of ["write", "pin", "trail"]) {
      expect(deck.includes(verb), verb).toBe(true);
    }
  });

  it("copies nothing from the desktop slides", () => {
    // The trap this task was warned about, guarded rather than promised.
    // The desktop deck is frozen (its VR baselines are blocked on a
    // re-record permission), so the failure mode is not editing it — it is
    // lifting a sentence OUT of it, which would import the retired word
    // along with the wording. Compared by whole body, which is the unit a
    // copy-paste moves.
    const desktop = [
      "BrandSlide",
      "WriteSlide",
      "PinSlide",
      "TrailSlide",
      "SinksSlide",
      "BeginSlide",
    ]
      .map((n) => readFileSync(`src/components/onboarding/slides/${n}.svelte`, "utf8"))
      .join("\n");
    for (const slide of ONBOARDING_SLIDES) {
      expect(desktop.includes(slide.body), slide.id).toBe(false);
    }
  });

  it("finds the desktop deck it is comparing against", () => {
    // The comparison above is an absence check, and an absence check
    // against an empty string passes whatever it says — shell-rules.test.js
    // opens with the same guard for the same reason. If the desktop deck is
    // ever renamed or moved, this goes red rather than the check above
    // going quietly vacuous.
    expect(readFileSync("src/components/onboarding/slides/SinksSlide.svelte", "utf8").length)
      .toBeGreaterThan(0);
  });
});
