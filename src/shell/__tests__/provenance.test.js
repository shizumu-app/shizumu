import { describe, it, expect } from "vitest";
import {
  localDayOf,
  shellDay,
  shellDate,
  pinProvenance,
  readingProvenance,
} from "../provenance.js";
import { formatLocalDate } from "../../lib/utils.js";

// Fixed dates, injected. page-model.js's own header says why: a labeller
// that reads the clock produces a suite whose colour changes overnight.
// 2026-05-20 is a Wednesday, which the weekday cases below lean on.
const TODAY = "2026-05-20";
const YESTERDAY = "2026-05-19";
const REFS = { todayDateStr: TODAY, yesterdayDateStr: YESTERDAY };

describe("shellDay — the five answers", () => {
  it("says today and yesterday by string comparison", () => {
    expect(shellDay(TODAY, REFS)).toBe("today");
    expect(shellDay(YESTERDAY, REFS)).toBe("yesterday");
  });

  it("names the weekday for the five days before yesterday", () => {
    // Close enough that the weekday places the day better than the date
    // does — the desktop's `formatRelativeDate` draws the same window.
    expect(shellDay("2026-05-18", REFS)).toBe("monday");
    expect(shellDay("2026-05-17", REFS)).toBe("sunday");
    expect(shellDay("2026-05-16", REFS)).toBe("saturday");
    expect(shellDay("2026-05-15", REFS)).toBe("friday");
    expect(shellDay("2026-05-14", REFS)).toBe("thursday");
  });

  it("stops the window at six days, because seven back is today's own weekday", () => {
    // "wednesday" on a Wednesday would read as today. The day is named
    // instead, through dayLabel's own `d mon`.
    expect(shellDay("2026-05-13", REFS)).toBe("13 may");
  });

  it("says d mon in this year and d mon yyyy in any other", () => {
    expect(shellDay("2026-01-03", REFS)).toBe("3 jan");
    expect(shellDay("1999-01-02", REFS)).toBe("2 jan 1999");
  });

  it("looks backwards only — a day after today is not next week's weekday", () => {
    // A device with its clock set forward, or a peer's row synced from an
    // hour ahead at midnight: "friday" for a day that has not happened
    // would be a claim about the future. `d mon` is at least true.
    expect(shellDay("2026-05-22", REFS)).toBe("22 may");
  });

  it("says nothing for a string that is not a day", () => {
    // `""` rather than the input echoed back or a thrown error: the
    // callers drop the segment, so a bad column costs a word, not the
    // screen. Not "nothing happens" for its own sake — `kept undefined`
    // is what the alternative prints.
    expect(shellDay("", REFS)).toBe("");
    expect(shellDay("not a day", REFS)).toBe("");
    expect(shellDay(null, REFS)).toBe("");
  });
});

describe("shellDay — the two boundaries", () => {
  it("steps the weekday window across a DST boundary one day at a time", () => {
    // Europe/Paris springs forward on Sunday 2026-03-29, a 23-hour day.
    // Subtracting n × 86 400 000 ms from Tuesday the 31st's local
    // midnight lands at 23:00 the evening BEFORE each intended day, so
    // the whole window slides back by one: the 29th is skipped and the
    // 24th — seven back, today's own weekday — is let in. The window is
    // walked with `yesterdayOf`, which is noon-anchored, so it holds.
    //
    // The two days asserted are the ones the slide changes. A day INSIDE
    // both windows (the 28th) reads right with the bug too, because the
    // weekday is read off the day itself, not off the step that found it
    // — the first draft of this test asked about the 28th and stayed
    // green on the broken code.
    //
    // Green in every timezone, and only BITES in one that has a DST
    // boundary (proved red under TZ=Europe/Paris with the subtraction
    // put back): a run under UTC cannot see this defect, and this comment
    // is here so a green run in UTC is not read as the proof.
    const refs = { todayDateStr: "2026-03-31", yesterdayDateStr: "2026-03-30" };
    expect(shellDay("2026-03-29", refs)).toBe("sunday");
    expect(shellDay("2026-03-25", refs)).toBe("wednesday");
    expect(shellDay("2026-03-24", refs)).toBe("24 mar");
  });

  it("names a weekday across a year boundary rather than dating it", () => {
    // Three days back from 2027-01-02 is 2026-12-30 — a different year,
    // but three days ago, and "wednesday" is what a reader on the 2nd
    // wants. The year rule applies only once the window is exhausted.
    const refs = { todayDateStr: "2027-01-02", yesterdayDateStr: "2027-01-01" };
    expect(shellDay("2026-12-30", refs)).toBe("wednesday");
    expect(shellDay("2027-01-01", refs)).toBe("yesterday");
  });

  it("puts the year on a day from another year, read off the string", () => {
    const refs = { todayDateStr: "2027-01-02", yesterdayDateStr: "2027-01-01" };
    expect(shellDay("2026-12-20", refs)).toBe("20 dec 2026");
    expect(shellDay("2027-01-01", refs)).not.toContain("2027");
  });
});

describe("localDayOf and shellDate — a timestamp is not a day", () => {
  it("reduces an ISO timestamp to the writer's LOCAL day", () => {
    // `created_at` is chrono::Utc::now().to_rfc3339() — a UTC instant.
    // 23:30Z is already tomorrow east of Greenwich and still today west
    // of it, and the honest day is the one the writer's clock showed.
    // Asserted against `formatLocalDate` of the same instant, which is
    // the helper `getLocalDateStr` is built on; slicing the string's
    // first ten characters gives the UTC day instead, and goes red under
    // any TZ with an offset (proved under TZ=Pacific/Auckland).
    const iso = "2026-05-20T23:30:00.000Z";
    expect(localDayOf(iso)).toBe(formatLocalDate(new Date(iso)));
    const local = "2026-05-20T23:30:00";
    expect(localDayOf(local)).toBe("2026-05-20");
  });

  it("passes a bare local day through untouched", () => {
    // A page's `date` is already local (chrono::Local in commands.rs).
    // `new Date("2026-05-20")` would parse it as UTC midnight and shift it
    // to the 19th west of Greenwich.
    expect(localDayOf("2026-05-20")).toBe("2026-05-20");
  });

  it("says nothing for a missing or unparseable timestamp", () => {
    expect(localDayOf(null)).toBe("");
    expect(localDayOf(undefined)).toBe("");
    expect(localDayOf("")).toBe("");
    expect(localDayOf("yesterday-ish")).toBe("");
    expect(shellDate("yesterday-ish", REFS)).toBe("");
  });

  it("labels the reduced day with shellDay's words", () => {
    expect(shellDate("2026-05-20T09:00:00", REFS)).toBe("today");
    expect(shellDate("2026-05-19T09:00:00", REFS)).toBe("yesterday");
    expect(shellDate("2026-05-18T09:00:00", REFS)).toBe("monday");
    expect(shellDate("1999-01-02T09:00:00", REFS)).toBe("2 jan 1999");
  });
});

// Local-time timestamps (no zone suffix) throughout the two describes
// below, so the day each one reduces to is the same in every timezone
// the suite runs in.
const pin = (over = {}) => ({
  id: "pin-1",
  lineage_id: "L1",
  source_page_id: "page-1",
  object_type: "note",
  title: "the second reader",
  content: "what the trail is for",
  status: "active",
  diverged: false,
  created_at: "2026-05-20T09:00:00",
  updated_at: "2026-05-20T09:00:00",
  ...over,
});

describe("pinProvenance", () => {
  it("says the trail and the day it was kept", () => {
    expect(pinProvenance(pin(), { trailName: "the book", ...REFS })).toBe(
      "from the book · kept today",
    );
  });

  it("adds the edited day only when it is a different day from kept", () => {
    // `kept today · edited today` is one fact said twice, and it is the
    // common shape — most pins are never edited and carry updated_at
    // equal to created_at. A different day is a second fact.
    expect(
      pinProvenance(pin({ created_at: "2026-05-19T09:00:00", updated_at: "2026-05-20T11:00:00" }), {
        trailName: "the book",
        ...REFS,
      }),
    ).toBe("from the book · kept yesterday · edited today");
    // Same day, different hour: still one day.
    expect(
      pinProvenance(pin({ created_at: "2026-05-20T09:00:00", updated_at: "2026-05-20T17:00:00" }), {
        trailName: "the book",
        ...REFS,
      }),
    ).toBe("from the book · kept today");
  });

  it("says the pin is not on a trail rather than saying nothing", () => {
    // STILL NAMES THE TRAIL, which is what this test was protecting: a line
    // that skipped it would read as a lookup that failed. What changed is
    // the word. It was `untrailed`, the desktop's (SharedObjectsPanel's
    // `sourcePageLabel`), kept for parity — and `untrailed` is a schema
    // word on a surface whose voice is the fewest plain words. The two
    // trees now disagree on this one string, deliberately.
    expect(pinProvenance(pin(), REFS)).toBe("from not on a trail · kept today");
    expect(pinProvenance(pin(), { trailName: "   ", ...REFS }))
      .toBe("from not on a trail · kept today");
  });

  it("says an orphan's source is gone, when it was cached, and when it was kept", () => {
    // CLAUDE.md's pin pointer clause: the cache survives the page. The
    // cached-on date is the one the desktop shows and the shell dropped
    // for want of a formatter; `kept` follows because it is the one date
    // the removal did not change.
    expect(
      pinProvenance(
        pin({ status: "orphaned", created_at: "2026-01-03T09:00:00", updated_at: "2026-05-20T09:00:00" }),
        { trailName: "the book", ...REFS },
      ),
    ).toBe("source removed · cached on today · kept 3 jan");
  });

  it("says the source changed elsewhere, after the facts", () => {
    expect(pinProvenance(pin({ diverged: true }), { trailName: "the book", ...REFS })).toBe(
      "from the book · kept today · changed elsewhere",
    );
  });

  it("does not tell an orphan its removed source also changed", () => {
    // pin-artifact-view.js's own call, kept: "source removed" and
    // "changed elsewhere" are two claims about one page and only one can
    // be true; printing both says the app does not know which.
    expect(
      pinProvenance(pin({ status: "orphaned", diverged: true }), { trailName: "the book", ...REFS }),
    ).toBe("source removed · cached on today · kept today");
  });

  it("drops a segment whose date will not read rather than printing the verb alone", () => {
    // `kept ` with nothing after it is a sentence that stops mid-word. A
    // pin from before the timestamp columns were reliable costs a segment,
    // not the line.
    expect(pinProvenance(pin({ created_at: null, updated_at: null }), { trailName: "the book", ...REFS })).toBe(
      "from the book",
    );
  });

  it("says nothing for no pin", () => {
    // The screen's "did not open" state covers this; an empty string is
    // the absence of a line ABOUT a pin, not a silent failure.
    expect(pinProvenance(null, REFS)).toBe("");
  });
});

const page = (over = {}) => ({
  id: "p1",
  date: YESTERDAY,
  page_number: 1,
  created_at: "2026-05-19T09:00:00",
  updated_at: "2026-05-19T09:00:00",
  ...over,
});

describe("readingProvenance", () => {
  it("says the trail and the day the page was written", () => {
    expect(readingProvenance(page(), { trailName: "the book", ...REFS })).toBe(
      "the book · written yesterday",
    );
  });

  it("adds the edited day when it differs from the page's own day", () => {
    expect(
      readingProvenance(page({ updated_at: "2026-05-20T11:00:00" }), { trailName: "the book", ...REFS }),
    ).toBe("the book · written yesterday · edited today");
  });

  it("dates written by the page's date, not its created_at", () => {
    // The day the page is FOR is what memory listed it under and what the
    // bar above calls it. A continuous trail's canonical doc is the case
    // that separates the two: its `date` is the day it was begun and its
    // `updated_at` moves every day it is written on.
    expect(
      readingProvenance(
        page({ date: "1999-01-02", created_at: "2026-05-20T09:00:00", updated_at: "2026-05-20T09:00:00" }),
        { trailName: "the book", ...REFS },
      ),
    ).toBe("the book · written 2 jan 1999 · edited today");
  });

  it("says not on a trail when there is no trail", () => {
    // The same word change as the pin line above; this surface shares the
    // formatter, so it shares the wording.
    expect(readingProvenance(page(), REFS)).toBe("not on a trail · written yesterday");
  });

  it("says nothing for no page", () => {
    expect(readingProvenance(null, REFS)).toBe("");
  });
});
