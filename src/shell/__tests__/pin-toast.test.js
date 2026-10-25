import { describe, it, expect } from "vitest";
import { pinToastMessage, carryForwardMessage, PIN_TOAST_MS } from "../pin-toast.js";

describe("pinToastMessage", () => {
  it("says what the pin joined, in the spec's own words", () => {
    // Spec §3 (:225-227) quotes this string exactly, and so do the
    // gallery's catalogue entry and Toast's own header. Twelve pins on
    // the trail, eleven of which were already there.
    expect(pinToastMessage({ trailName: "book", pinCount: 12 })).toBe(
      "joins 11 pins on the book trail",
    );
  });

  it("counts the OTHERS, not the total", () => {
    // The whole reason this is a module. `pinCount` is the trail's total
    // AFTER the write, so the pin just made is inside it — rendering it
    // straight through would overcount by one on every pin forever, and
    // nothing on the phone would ever contradict it.
    expect(pinToastMessage({ trailName: "book", pinCount: 3 })).toBe(
      "joins 2 pins on the book trail",
    );
  });

  it("says pin, not pins, when there is exactly one", () => {
    // The desktop's find bar shipped "0 of 3" for this class of
    // inattention. A count of two means one other pin.
    expect(pinToastMessage({ trailName: "book", pinCount: 2 })).toBe(
      "joins 1 pin on the book trail",
    );
  });

  it("has its own line for the first pin, which joins nothing", () => {
    // "joins 0 pins on the book trail" is the sentence this branch
    // exists to never render.
    expect(pinToastMessage({ trailName: "book", pinCount: 1 })).toBe(
      "the first pin on the book trail",
    );
  });

  it("says nothing at all for a page with no trail", () => {
    // NOT an oversight and NOT a dropped press. An untrailed page joins
    // no trail, and the only number available for it — get_pins(null),
    // every untrailed pin in the app for all time — is a heap rather than
    // a trail, with no name to put in the sentence. The confirmation on
    // that path is the pin control going dead, which Task 1 built and
    // which needs no trail (see pin-toast.js's header, and
    // ShellApp.test.js's "says nothing on an untrailed page").
    expect(pinToastMessage({ trailName: null, pinCount: 4 })).toBe("");
    expect(pinToastMessage({ trailName: "", pinCount: 4 })).toBe("");
    expect(pinToastMessage({ trailName: "   ", pinCount: 4 })).toBe("");
  });

  it("says nothing when the count cannot see the pin that was just written", () => {
    // A count below 1 is a fetch that failed, raced, or answered for the
    // wrong trail — the pin JUST landed, so the trail holds at least it.
    // Silence rather than a guess: a wrong number here is a claim about
    // the writer's own trail that they have no way to check.
    expect(pinToastMessage({ trailName: "book", pinCount: 0 })).toBe("");
    expect(pinToastMessage({ trailName: "book", pinCount: -1 })).toBe("");
    expect(pinToastMessage({ trailName: "book", pinCount: NaN })).toBe("");
    expect(pinToastMessage({ trailName: "book", pinCount: undefined })).toBe("");
    expect(pinToastMessage()).toBe("");
  });

  it("does not say trail twice when the trail is named for one", () => {
    expect(pinToastMessage({ trailName: "book trail", pinCount: 3 })).toBe(
      "joins 2 pins on the book trail",
    );
    // Only as the last WORD — a trail called "trailhead" keeps its suffix.
    expect(pinToastMessage({ trailName: "trailhead", pinCount: 2 })).toBe(
      "joins 1 pin on the trailhead trail",
    );
  });

  it("does not say the twice when the trail is named with one", () => {
    // "the book" is the trail name in this repo's own ShellApp fixtures,
    // so "on the the book trail" is not a hypothetical — it is what the
    // first end-to-end run of this toast rendered.
    expect(pinToastMessage({ trailName: "the book", pinCount: 3 })).toBe(
      "joins 2 pins on the book trail",
    );
    // Only as the first WORD — "theory" is not an article.
    expect(pinToastMessage({ trailName: "theory", pinCount: 2 })).toBe(
      "joins 1 pin on the theory trail",
    );
  });

  it("carries both fixes at once", () => {
    expect(pinToastMessage({ trailName: "the book trail", pinCount: 1 })).toBe(
      "the first pin on the book trail",
    );
  });

  it("renders a trail name as one line", () => {
    // Trail names are free text. A newline inside one would break the
    // toast's single line and, in a `role="status"` region, be read out
    // as a pause in the middle of the count.
    expect(pinToastMessage({ trailName: " reading\nlist ", pinCount: 2 })).toBe(
      "joins 1 pin on the reading list trail",
    );
  });

  it("carries no retired word and no exclamation, on any branch", () => {
    // CLAUDE.md's brand canon, asserted rather than trusted, because this
    // is the phase's one user-facing string and a later edit to the copy
    // has no other guard. `sink` and its forms must not appear in a
    // user-facing string; nor may an exclamation mark.
    const every = [
      pinToastMessage({ trailName: "book", pinCount: 1 }),
      pinToastMessage({ trailName: "book", pinCount: 2 }),
      pinToastMessage({ trailName: "book", pinCount: 12 }),
    ];
    for (const line of every) {
      expect(line).not.toMatch(/\b(sink|sinks|sinking|sunk)\b/i);
      expect(line).not.toContain("!");
      expect(line).toBe(line.toLowerCase());
      // Threads pin and trail, the two verbs this string is about.
      expect(line).toMatch(/\bpins?\b/);
      expect(line).toMatch(/\btrail\b/);
    }
  });

  it("leaves before the pin it describes goes stale", () => {
    // Toast has no timer of its own — the caller owns the lifetime, and
    // this is the number it uses. Asserted so a later edit to it is a
    // deliberate change rather than a silent one.
    expect(PIN_TOAST_MS).toBe(4000);
  });
});

describe("carryForwardMessage", () => {
  it("says the pins the writer kept on the trail are on the page", () => {
    // CLAUDE.md's context clause, near enough verbatim: "the pins you
    // already kept there, already on the page". The mechanic it explains
    // fires once, on first assignment, so this is the only sentence the
    // writer ever gets for it.
    expect(carryForwardMessage({ trailName: "book" })).toBe(
      "the pins you kept on the book trail, on the page",
    );
  });

  it("carries no count, and that is the opposite call from the pin toast", () => {
    // "joins 11 pins" points at a list the writer cannot see, so the
    // number is the message. This one points at the screen they are
    // looking at — the pins are in the document under their caret — and a
    // count here would be a claim this module cannot measure: a pin fans
    // out to more than one node, and appendNodesToDoc drops a node whose
    // shape the doc already holds.
    expect(carryForwardMessage({ trailName: "book" })).not.toMatch(/\d/);
  });

  it("does not decorate a trail name that already carries the words", () => {
    // The same regression pinToastMessage was fixed for, on the same
    // helper: real fixture names, not invented ones.
    expect(carryForwardMessage({ trailName: "the book" })).toContain("on the book trail,");
    expect(carryForwardMessage({ trailName: "book trail" })).toContain("on the book trail,");
    expect(carryForwardMessage({ trailName: "the book trail" })).toContain("on the book trail,");
  });

  it("says nothing when the trail's name did not load", () => {
    // Not silence for its own sake: a breadcrumb that cannot name where it
    // points is not a breadcrumb, and the pins on the page would then be
    // explained by a sentence with a hole in it. The lineage read has its
    // own try/catch in ShellApp and can leave the name null.
    expect(carryForwardMessage({ trailName: null })).toBe("");
    expect(carryForwardMessage({ trailName: "   " })).toBe("");
    expect(carryForwardMessage()).toBe("");
  });

  it("keeps the brand canon: lowercase, no retired word, no exclamation", () => {
    const line = carryForwardMessage({ trailName: "job search" });
    expect(line).toBe(line.toLowerCase());
    expect(line).not.toMatch(/\b(sink|sinks|sinking|sunk)\b/i);
    expect(line).not.toContain("!");
    expect(line).toMatch(/\bpins\b/);
    expect(line).toMatch(/\btrail\b/);
  });
});
