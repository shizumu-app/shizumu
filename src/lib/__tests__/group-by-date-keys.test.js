// groupByDate's output is used as a KEY, so it must not repeat itself.
//
// MEASURED ON A PHONE, as a thrown `each_key_duplicate` that stopped the
// memory screen re-rendering entirely — the symptom reported was that the
// filters sheet's `clear filters` row would not withdraw after being
// tapped, because by then nothing on that screen was updating at all.
//
// The sequence: `clear filters` resets the sort to `date` and re-reads, so
// for the turn between the reset and the answer the screen holds a list
// ordered by `updated_at` while believing it is ordered by date. This
// function was RUN-LENGTH — it opened a new group only when the label
// CHANGED — so an interleaved list emitted the same heading twice, and
// both surfaces keyed their markup on that heading.
//
// Two fixes, deliberately: the callers key on an id now (a label is not an
// identity), and this answers one group per label whatever order it is
// handed. Either alone would have stopped the crash; together they also
// stop the SECOND bug, which is quieter — the same day appearing as two
// headings with the writer's pages split between them.
import { describe, it, expect } from "vitest";
import { groupByDate } from "../memory-filters.js";

const TODAY = new Date().toISOString().slice(0, 10);

describe("groupByDate — one group per day, whatever order it is handed", () => {
  it("keeps a day together when its pages are not adjacent in the list", () => {
    const groups = groupByDate([
      { id: "a", date: TODAY },
      { id: "b", date: "2026-09-16" },
      { id: "c", date: TODAY },
    ]);
    expect(groups.length).toBe(2);
    expect(groups.map((g) => g.pages.map((p) => p.id))).toEqual([["a", "c"], ["b"]]);
  });

  it("never repeats a label, which is what the callers key on", () => {
    const groups = groupByDate([
      { id: "a", date: TODAY },
      { id: "b", date: "2026-09-16" },
      { id: "c", date: TODAY },
      { id: "d", date: "2026-09-16" },
    ]);
    expect(new Set(groups.map((g) => g.label)).size).toBe(groups.length);
  });

  it("keeps the order the days first appear in", () => {
    // Not re-sorted: the list arrives ordered by whatever the writer asked
    // for, and a function that re-sorted it would override the sort control
    // rather than group under it.
    const groups = groupByDate([
      { id: "b", date: "2026-09-16" },
      { id: "a", date: TODAY },
    ]);
    expect(groups.map((g) => g.pages[0].id)).toEqual(["b", "a"]);
  });

  it("answers nothing for an empty list", () => {
    // The screens tell "nothing written" from "nothing matches" themselves;
    // one empty group would put a date heading over whichever they chose.
    expect(groupByDate([])).toEqual([]);
  });
});
