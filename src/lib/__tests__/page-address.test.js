import { describe, it, expect } from "vitest";
import { pageAddress } from "../page-address.js";

describe("pageAddress", () => {
  it("addresses by id whenever the row has one", () => {
    // The whole point: the id is the same on every device, the number is not.
    expect(pageAddress({ id: "u-1", date: "2026-08-22", page_number: 4 }))
      .toEqual(["2026-08-22", 4, "u-1"]);
  });

  it("still carries date and number, so the legacy lookup stays usable", () => {
    // Not redundant: get_page falls back to (date, page_number) when the id
    // is null, and rows from older callers may not carry one.
    expect(pageAddress({ date: "2026-08-22", page_number: 4 }))
      .toEqual(["2026-08-22", 4, null]);
  });

  it("treats a blank or non-string id as absent rather than passing it on", () => {
    // A "" id would resolve to no row at all and silently open nothing,
    // which is worse than falling back to the number.
    expect(pageAddress({ id: "", date: "d", page_number: 1 })[2]).toBe(null);
    expect(pageAddress({ id: "   ", date: "d", page_number: 1 })[2]).toBe(null);
    expect(pageAddress({ id: 7, date: "d", page_number: 1 })[2]).toBe(null);
  });

  it("rejects a non-integer page_number instead of forwarding it", () => {
    // page_number reaches SQL as an i64 bind; "4" or 4.5 is a caller bug,
    // and nulling it makes get_page say so rather than quietly miss.
    expect(pageAddress({ date: "d", page_number: "4" })[1]).toBe(null);
    expect(pageAddress({ date: "d", page_number: 4.5 })[1]).toBe(null);
  });

  it("survives the shapes callers actually pass on a bad day", () => {
    // Guards the spread at the call sites: getPage(...pageAddress(x)) must
    // never throw, even when x arrived as null from a failed lookup.
    expect(pageAddress(null)).toEqual([null, null, null]);
    expect(pageAddress(undefined)).toEqual([null, null, null]);
    expect(pageAddress("nope")).toEqual([null, null, null]);
  });
  it("refuses a page-with-lines instead of addressing nothing", () => {
    // THE BUG THIS WAS WRITTEN FOR, found on a device. get_adjacent_page and
    // get_page both answer {page, lines, session_markers}; the row wanted
    // here is the page inside it. Passing the wrapper used to return three
    // nulls, which get_page answers with "date required when page_id is
    // null" — and in the shell's page delete that arrived AFTER the delete
    // had committed, so the writer was left on the page that was gone.
    const wrapper = {
      page: { id: "u1", date: "2026-10-08", page_number: 2 },
      lines: [],
      session_markers: [],
    };
    expect(() => pageAddress(wrapper)).toThrow(/page-with-lines/);
    // And the right call still works, which is what the message asks for.
    expect(pageAddress(wrapper.page)).toEqual(["2026-10-08", 2, "u1"]);
  });

  it("does not refuse a real page row that happens to carry a page field", () => {
    // Narrow on purpose: the refusal keys on a MISSING id, because a row with
    // an id is addressable whatever else hangs off it, and a preview row that
    // carried both would otherwise stop working.
    expect(pageAddress({ id: "u2", date: "d", page_number: 1, page: {} }))
      .toEqual(["d", 1, "u2"]);
  });
});
