import { describe, it, expect } from "vitest";
import {
  ALL,
  filterPins,
  pinFilterOptions,
  pinFilterValue,
  pinScope,
} from "../pin-filter.js";

const pin = (id, lineageId, over = {}) => ({ id, lineage_id: lineageId, ...over });

describe("pinScope", () => {
  it("calls the screen's own trail 'here'", () => {
    expect(pinScope(pin("a", "L1"), "L1")).toBe("here");
  });

  it("calls an ancestor's pin 'inherited'", () => {
    // get_pins walks parent_id UPWARD, so a nested trail's list carries
    // its ancestors' pins alongside its own. Telling the two apart is the
    // whole reason this axis is the one the segment filters on.
    expect(pinScope(pin("a", "PARENT"), "L1")).toBe("inherited");
  });

  it("calls a pin with no trail 'global', including on an untrailed page", () => {
    // NOT "here". An untrailed page reads get_pins(null), which returns
    // every pin ever taken off an untrailed page, app-wide — pin-toast.js
    // calls that "a heap, not a trail". Calling those rows "this trail"
    // would name a trail the writer does not have.
    expect(pinScope(pin("a", null), "L1")).toBe("global");
    expect(pinScope(pin("a", null), null)).toBe("global");
  });
});

describe("pinFilterOptions", () => {
  it("offers all, then the scopes present, in the desktop's section order", () => {
    const options = pinFilterOptions(
      [pin("a", "L1"), pin("b", "PARENT"), pin("c", null)],
      "L1",
    );
    expect(options).toEqual([
      { value: "all", label: "all" },
      { value: "here", label: "this trail" },
      { value: "inherited", label: "inherited" },
      { value: "global", label: "global" },
    ]);
  });

  it("offers only the scopes that have rows", () => {
    expect(pinFilterOptions([pin("a", "L1"), pin("b", "PARENT")], "L1").map((o) => o.value))
      .toEqual(["all", "here", "inherited"]);
  });

  it("offers nothing when every pin has the same scope", () => {
    // NOT a vacuous empty. The alternative is a live control reading
    // `all | this trail` whose two segments select the identical rows —
    // an affordance onto nothing, which is the same defect as a dead row
    // in a sheet. A root trail's pins screen is this case, and so is every
    // untrailed page's, so it is the common shape rather than an edge one.
    expect(pinFilterOptions([pin("a", "L1"), pin("b", "L1")], "L1")).toEqual([]);
    expect(pinFilterOptions([pin("a", null), pin("b", null)], null)).toEqual([]);
  });

  it("offers nothing for an empty or absent list", () => {
    // The screen renders an empty state rather than rows in both cases;
    // a segment over no rows would be a control above a sentence.
    expect(pinFilterOptions([], "L1")).toEqual([]);
    expect(pinFilterOptions(undefined, "L1")).toEqual([]);
  });
});

describe("filterPins", () => {
  const rows = [pin("a", "L1"), pin("b", "PARENT"), pin("c", "L1"), pin("d", null)];

  it("passes everything through at rest", () => {
    // The toast's count is `getPins(lineageId).length`, unfiltered and
    // status-blind, and pin-toast.js's header commits it to pointing at
    // THIS list. `all` filtering anything — an orphan, a closed row, a
    // global pin — would put the number and the list it names out of step.
    expect(filterPins(rows, "L1", ALL)).toBe(rows);
    expect(filterPins(rows, "L1", "")).toBe(rows);
  });

  it("keeps only the chosen scope", () => {
    expect(filterPins(rows, "L1", "here").map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterPins(rows, "L1", "inherited").map((r) => r.id)).toEqual(["b"]);
    expect(filterPins(rows, "L1", "global").map((r) => r.id)).toEqual(["d"]);
  });

  it("filters nothing away that its own options offered", () => {
    // The property the screen leans on to have only two empty states: an
    // offered option always names a scope some row carries, so no choice
    // the writer can make produces an empty list.
    for (const option of pinFilterOptions(rows, "L1")) {
      expect(filterPins(rows, "L1", option.value).length).toBeGreaterThan(0);
    }
  });
});

describe("pinFilterValue", () => {
  it("keeps a selection the control still offers", () => {
    const options = pinFilterOptions([pin("a", "L1"), pin("b", "PARENT")], "L1");
    expect(pinFilterValue(options, "inherited")).toBe("inherited");
  });

  it("falls back to all when the chosen scope has left the list", () => {
    // Unpinning the last inherited row takes the option away while it is
    // selected. Without this the screen would render an empty list under a
    // segment with nothing lit — the control and the list describing
    // different things.
    const options = pinFilterOptions([pin("a", "L1"), pin("b", "L1")], "L1");
    expect(pinFilterValue(options, "inherited")).toBe(ALL);
  });
});
