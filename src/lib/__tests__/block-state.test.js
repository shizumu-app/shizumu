import { describe, it, expect } from "vitest";
import {
  allowedStates, defaultState, carriesState, stateOf, nextState, isoDate,
  toggledAttrs, mayToggleState, stateChipLabel, isOpenQuestion,
} from "../block-state.js";

describe("allowed states", () => {
  it("a decision is standing or superseded, standing by default", () => {
    expect(allowedStates("decisionBlock")).toEqual(["standing", "superseded"]);
    expect(defaultState("decisionBlock")).toBe("standing");
    expect(carriesState("decisionBlock")).toBe(true);
  });

  it("other types carry no stored state", () => {
    // A q&a's `open` is computed from its words, never stored, so qaBlock
    // and qaPair are deliberately absent here.
    for (const t of ["paragraph", "qaBlock", "qaPair", "recipeBlock", "list"]) {
      expect(allowedStates(t)).toBe(null);
      expect(defaultState(t)).toBe(null);
      expect(carriesState(t)).toBe(false);
    }
  });
});

describe("stateOf", () => {
  it("reads a known state as itself", () => {
    expect(stateOf("decisionBlock", "superseded")).toBe("superseded");
  });
  it("reads a decision with no state (written before 0.8.2) as standing", () => {
    expect(stateOf("decisionBlock", undefined)).toBe("standing");
    expect(stateOf("decisionBlock", null)).toBe("standing");
  });
  it("reads a state it does not know as the default, not as garbage", () => {
    expect(stateOf("decisionBlock", "revisited")).toBe("standing");
  });
  it("has no state for a type that carries none", () => {
    expect(stateOf("paragraph", "standing")).toBe(null);
  });
});

describe("the toggle", () => {
  const now = new Date(2026, 10, 2, 23, 30);

  it("standing becomes superseded and back", () => {
    expect(nextState("decisionBlock", "standing")).toBe("superseded");
    expect(nextState("decisionBlock", "superseded")).toBe("standing");
    expect(nextState("decisionBlock", undefined)).toBe("superseded");
  });

  it("writes the next state and the local date, and keeps every other attr", () => {
    const attrs = { blockId: "abc123def456", pinId: "pin-1", blockTitle: "the move", blockState: "standing", blockStateAt: null };
    expect(toggledAttrs("decisionBlock", attrs, now)).toEqual({
      blockId: "abc123def456", pinId: "pin-1", blockTitle: "the move", blockState: "superseded", blockStateAt: "2026-11-02",
    });
  });

  it("uses the writer's calendar day, not UTC's", () => {
    // 23:30 local on the 2nd is the 2nd, wherever UTC has got to.
    expect(isoDate(now)).toBe("2026-11-02");
    expect(isoDate(new Date(2026, 0, 5, 0, 5))).toBe("2026-01-05");
  });

  it("has nothing to write for a type with no state", () => {
    expect(toggledAttrs("paragraph", {}, now)).toBe(null);
  });
});

describe("mayToggleState", () => {
  it("toggles on an editable page", () => {
    expect(mayToggleState({ typeName: "decisionBlock", editable: true })).toBe(true);
  });
  it("never on a read-only page: a past page shows the chip but stays as it was", () => {
    expect(mayToggleState({ typeName: "decisionBlock", editable: false })).toBe(false);
  });
  it("never for a type with no state", () => {
    expect(mayToggleState({ typeName: "qaPair", editable: true })).toBe(false);
  });
});

describe("stateChipLabel", () => {
  it("names the state and what pressing does", () => {
    expect(stateChipLabel("standing", "superseded", true)).toBe("decision standing. mark superseded");
  });
  it("names only the state where pressing does nothing", () => {
    expect(stateChipLabel("superseded", "standing", false)).toBe("decision superseded");
  });
});

describe("isOpenQuestion", () => {
  const p = (t) => ({ type: "paragraph", ...(t ? { content: [{ type: "text", text: t }] } : {}) });
  const pair = (q, a) => ({ type: "qaPair", content: [p(q), p(a)] });

  it("a question with no answer is open", () => {
    expect(isOpenQuestion(pair("do we keep the old ids?", ""))).toBe(true);
  });
  it("an answered question is not", () => {
    expect(isOpenQuestion(pair("do we keep the old ids?", "yes, derived"))).toBe(false);
  });
  it("an answer of only spaces is still empty", () => {
    expect(isOpenQuestion(pair("why?", "   "))).toBe(true);
  });
  it("a blank pair is not an open question", () => {
    // Not "nothing happens" by accident: a fresh q&a block and the pair Enter
    // just made are both blank, and an `open` chip there marks a question
    // nobody asked yet.
    expect(isOpenQuestion(pair("", ""))).toBe(false);
  });
  it("only a qaPair can be open", () => {
    expect(isOpenQuestion({ type: "qaBlock", content: [pair("q", "")] })).toBe(false);
    expect(isOpenQuestion(null)).toBe(false);
  });
  it("reads a ProseMirror-shaped node as well as JSON", () => {
    const kids = [{ textContent: "q?" }, { textContent: "" }];
    const node = { type: { name: "qaPair" }, childCount: 2, child: (i) => kids[i] };
    expect(isOpenQuestion(node)).toBe(true);
  });
});
