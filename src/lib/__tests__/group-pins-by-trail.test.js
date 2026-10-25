// Pins, in one group per trail. See groupPinsByTrail for the request and the
// reasoning; these are the cases that decide it.
//
// THE SAME DECISION EXISTS TWICE RIGHT NOW, and that is a merge away from
// being fixed rather than an oversight: `src/shell/memory-model.js` on
// shell/mobile carries `memoryPinGroups`, written the same day against the
// same report, because the two trees are hundreds of commits apart and the
// phone needed it in the tree it ships from. When shell/mobile next takes
// main, that copy collapses onto this one — the shell's own header says so.
import { describe, it, expect } from "vitest";
import {
  groupPinsByTrail,
  UNKNOWN_TRAIL_LABEL,
  UNTRAILED_PINS_LABEL,
} from "../memory-filters.js";

const LINEAGES = [
  { id: "L1", name: "the book", parent_id: null },
  { id: "L2", name: "a job search", parent_id: null },
];
const pin = (id, lineage_id) => ({ id, lineage_id });
const shape = (groups) => groups.map((g) => [g.label, g.pins.map((p) => p.id)]);

describe("groupPinsByTrail", () => {
  it("puts each trail's pins under the trail's own name", () => {
    expect(
      shape(groupPinsByTrail({
        pins: [pin("a", "L1"), pin("b", "L2"), pin("c", "L1")],
        lineages: LINEAGES,
      })),
    ).toEqual([
      ["the book", ["a", "c"]],
      ["a job search", ["b"]],
    ]);
  });

  it("keeps the trail list's order, not the order the pins arrived in", () => {
    // get_pins returns them by when each was made. Grouping by first
    // sighting would move the headings under a reader every time a pin was
    // added to the older trail.
    expect(
      shape(groupPinsByTrail({ pins: [pin("b", "L2"), pin("a", "L1")], lineages: LINEAGES })),
    ).toEqual([
      ["the book", ["a"]],
      ["a job search", ["b"]],
    ]);
  });

  it("gathers the pins on no trail at the end, under their own heading", () => {
    expect(
      shape(groupPinsByTrail({ pins: [pin("loose", null), pin("a", "L1")], lineages: LINEAGES })),
    ).toEqual([
      ["the book", ["a"]],
      [UNTRAILED_PINS_LABEL, ["loose"]],
    ]);
  });

  it("shows a pin whose trail is no longer listed rather than dropping it", () => {
    // A pin can outlive the lineage row this screen knows about — a trail
    // deleted on another device, a list that has not re-read. Dropping it
    // would be the list quietly losing the writer's own writing.
    expect(
      shape(groupPinsByTrail({ pins: [pin("a", "GONE"), pin("b", "ALSO-GONE")], lineages: LINEAGES })),
    ).toEqual([[UNKNOWN_TRAIL_LABEL, ["a", "b"]]]);
  });

  it("leaves a trail with no pins out, rather than heading an empty list", () => {
    expect(shape(groupPinsByTrail({ pins: [pin("a", "L1")], lineages: LINEAGES }))).toEqual([
      ["the book", ["a"]],
    ]);
  });

  it("does not group once a single trail is scoped", () => {
    // NOT "nothing happens": one heading over a list that is already one
    // trail's pins repeats the control that scoped them. The single
    // unlabelled group is what both surfaces rendered before this existed.
    const pins = [pin("a", "L1"), pin("c", "L1")];
    expect(groupPinsByTrail({ pins, lineages: LINEAGES, scope: new Set(["L1"]) })).toEqual([
      { id: "scoped", label: "", pins },
    ]);
  });

  it("identifies a group by the trail, not by its name", () => {
    // Nothing stops a writer calling two projects the same thing, and a
    // caller keying its markup on the heading would throw
    // `each_key_duplicate` and stop re-rendering the screen — which is
    // what the phone's pages mode did, keyed on groupByDate's heading.
    const groups = groupPinsByTrail({
      pins: [pin("a", "L1"), pin("b", "L3")],
      lineages: [...LINEAGES, { id: "L3", name: "the book", parent_id: null }],
    });
    expect(groups.map((g) => g.label)).toEqual(["the book", "the book"]);
    expect(groups.map((g) => g.id)).toEqual(["L1", "L3"]);
  });

  it("answers with nothing for no pins, so the caller keeps its empty state", () => {
    // The screens tell "no pins yet" from "nothing matches" themselves, and
    // an empty group would put a heading above whichever they chose.
    expect(groupPinsByTrail({ pins: [], lineages: LINEAGES })).toEqual([]);
  });
});
