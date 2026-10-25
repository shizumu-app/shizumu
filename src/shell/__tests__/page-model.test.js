import { describe, it, expect } from "vitest";
import { pageHeaderModel } from "../page-model.js";
import { getLocalDateStr, getYesterdayStr } from "../../lib/utils.js";

describe("pageHeaderModel", () => {
  it("says today for today's date", () => {
    const m = pageHeaderModel({
      page: { date: "2026-08-25", page_number: 1 },
      todayDateStr: "2026-08-25",
    });
    expect(m.dateLabel).toBe("today");
  });

  it("names a distant date rather than saying today", () => {
    // The header said "today" on every date for a whole phase, because a
    // static default stood in for real data. A label that is right by
    // coincidence is the failure this test exists to stop.
    const m = pageHeaderModel({
      page: { date: "2026-08-11", page_number: 1 },
      todayDateStr: "2026-08-25", yesterdayDateStr: "2026-08-24",
    });
    expect(m.dateLabel).not.toBe("today");
    expect(m.dateLabel).toContain("11");
  });

  it("says yesterday for yesterday", () => {
    // An earlier draft of this test used 2026-08-24 against a today of
    // 2026-08-25 and asserted the label contained "24" — but that date IS
    // yesterday, so a faithful labeller returns "yesterday" and the test
    // could only pass by DELETING the yesterday branch. It would also have
    // flipped colour overnight, since the real clock decides what yesterday
    // is. This is the branch that needed a guard; the old test forbade it.
    const m = pageHeaderModel({
      page: { date: "2026-08-24", page_number: 1 },
      todayDateStr: "2026-08-25", yesterdayDateStr: "2026-08-24",
    });
    expect(m.dateLabel).toBe("yesterday");
  });

  it("carries the trail name through, and null when untrailed", () => {
    expect(pageHeaderModel({
      page: { date: "2026-08-25", page_number: 1 }, todayDateStr: "2026-08-25",
      lineageName: "the book",
    }).trailName).toBe("the book");

    // Untrailed is the default state of a page, not an error: most pages
    // never join a trail, and the header must render without one.
    expect(pageHeaderModel({
      page: { date: "2026-08-25", page_number: 1 }, todayDateStr: "2026-08-25",
    }).trailName).toBeNull();
  });

  it("reports the page's own ordinal and the day's count", () => {
    const m = pageHeaderModel({
      page: { date: "2026-08-25", page_number: 3 },
      todayDateStr: "2026-08-25", pageCount: 4, pageOrdinal: 3,
    });
    expect(m.pageNumber).toBe(3);
    expect(m.pageCount).toBe(4);
  });

  it("is the position in the day, not page_number, when the two differ", () => {
    // THE BUG THIS WAS WRITTEN FOR, measured on an A16. page_number is minted
    // MAX+1 per device and never reused, so one deleted page leaves a day of
    // twenty-one numbered 1..19, 21, 22. The header draws a dot per page and
    // lights `n === pageNumber`, so a page_number of 22 in a row of twenty-one
    // dots lit nothing at all -- and one of 21 lit the dot belonging to the
    // twenty-first page, which is a different page.
    //
    // The name of the test above was already "the page's own ordinal" while
    // it passed a page_number. The name was right.
    const m = pageHeaderModel({
      page: { date: "2026-10-08", page_number: 22 },
      todayDateStr: "2026-10-08", pageCount: 21, pageOrdinal: 20,
    });
    expect(m.pageNumber).toBe(20);
    expect(m.pageNumber).toBeLessThanOrEqual(m.pageCount);
  });

  it("falls back to the first dot while the day's pages are still loading", () => {
    // Not "nothing is lit": a header with dots and none filled reads as a
    // broken indicator rather than as a pending one, and the load resolves
    // in a frame or two onto the common answer anyway.
    const m = pageHeaderModel({
      page: { date: "2026-10-08", page_number: 7 },
      todayDateStr: "2026-10-08", pageCount: 3, pageOrdinal: null,
    });
    expect(m.pageNumber).toBe(1);
  });

  it("floors a zero page count to one", () => {
    // Two ways to reach the floor and only one was cased: a non-number
    // (an unresolved load) and a real 0. A count of 0 reaches here while
    // the day's pages are still being counted, and "page 1 of 0" is a
    // placeholder leaking into the header -- the same class of defect as
    // a static "today" standing in for a date.
    const m = pageHeaderModel({
      page: { date: "2026-08-25", page_number: 1 },
      todayDateStr: "2026-08-25", yesterdayDateStr: "2026-08-24",
      pageCount: 0,
    });
    expect(m.pageCount).toBe(1);
  });

  it("survives a missing page", () => {
    // ShellApp renders before its load resolves. Returning a usable shape
    // rather than throwing is what keeps the first frame from being a
    // crash; the header simply has nothing to say yet.
    const m = pageHeaderModel({ page: null, todayDateStr: "2026-08-25" });
    expect(m.dateLabel).toBe("today");
    expect(m.pageCount).toBe(1);
    expect(m.pageNumber).toBe(1);
  });

  it("defaults both reference dates from the shared local-time helpers", () => {
    // The two reference dates are injectable so the cases above are
    // deterministic — but the caller in ShellApp passes neither, so the
    // defaults are the code path that actually ships. Asserted against the
    // same helpers rather than against literal dates, so this test states
    // "the default is getLocalDateStr()" and cannot flip colour at midnight
    // the way a hardcoded 2026-08-25 would.
    expect(pageHeaderModel({ page: { date: getLocalDateStr(), page_number: 1 } }).dateLabel)
      .toBe("today");
    expect(pageHeaderModel({ page: { date: getYesterdayStr(), page_number: 1 } }).dateLabel)
      .toBe("yesterday");
  });
});
