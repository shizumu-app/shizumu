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
});
