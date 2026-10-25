import { describe, it, expect } from "vitest";
import { readingHeader, readingRows } from "../reading-view.js";
import { pageReadonly } from "../page-writable.js";

// Fixed dates, injected. page-model.js's own header says why: a labeller
// that reads the clock produces a suite whose colour changes overnight.
const TODAY = "2026-05-20";
const YESTERDAY = "2026-05-19";
const LONG_AGO = "1999-01-02";

const page = (over = {}) => ({ id: "p1", date: TODAY, page_number: 1, ...over });

describe("readingHeader", () => {
  it("titles the screen with the day, not the focus line", () => {
    // The writer arrived from a list of days; the day is what identifies
    // the page they tapped. The focus line is rendered in the content.
    const header = readingHeader({
      page: page({ date: YESTERDAY, what_matters_now: "the second reader" }),
      todayDateStr: TODAY,
      yesterdayDateStr: YESTERDAY,
    });
    expect(header.title).toBe("yesterday");
  });

  it("keeps the bar to one line — the trail is a chip now, not a subtitle", () => {
    // The trail used to be the bar's second line. It is a `Chip` under the
    // title beside the provenance line (the desktop's anatomy: the chrome
    // names the screen, the subject wears its trail). An empty subtitle is
    // what NavBar renders as one line; a bar that still named the trail
    // would say it twice, once in chrome and once on the chip.
    expect(readingHeader({ page: page(), todayDateStr: TODAY }).subtitle).toBe("");
  });

  it("says what it is doing before the page lands, rather than guessing a day", () => {
    // "today" here would be a bar that names a day and then names another
    // one a tick later, describing a page that was never open.
    expect(readingHeader({ page: null, todayDateStr: TODAY }).title).toBe("reading");
  });

  it("uses both reference dates it was given, not one and the clock", () => {
    // memory-model.js's `yesterdayOf` records the defect: dayLabel defaults
    // its two reference dates INDEPENDENTLY, so a caller passing only
    // `todayDateStr` gets a `yesterdayDateStr` off the real clock and the
    // day before its own today reads as a month-day label. Both are passed
    // here, and the assertion is that the day before this fixture's today
    // is called "yesterday" — which it cannot be if the second date came
    // from the machine.
    expect(
      readingHeader({
        page: page({ date: YESTERDAY }),
        todayDateStr: TODAY,
        yesterdayDateStr: YESTERDAY,
      }).title,
    ).toBe("yesterday");
  });
});

describe("readingRows", () => {
  it("offers continue on a page the canvas will accept", () => {
    expect(readingRows({ page: page({ date: TODAY }), todayDateStr: TODAY })).toEqual([
      { id: "continue", label: "continue" },
    ]);
  });

  it("offers a past page the day it can be written on instead, and says why first", () => {
    // Not `continue`: it would land the writer on a canvas that refuses
    // every keystroke, on a pushed screen with no tab bar behind it and
    // nothing on screen saying why. The note says why here, and the
    // action row goes where writing is possible. `note: true` is what the
    // screen renders through `Note` rather than `Row` — the sentence is a
    // caption over the offer, not a control that does nothing.
    expect(readingRows({ page: page({ date: LONG_AGO }), todayDateStr: TODAY })).toEqual([
      { id: "done", label: "this page is done. today is on the page.", note: true },
      { id: "today", label: "write today" },
    ]);
  });

  it("offers continue on the page the backend handed out as today, whatever the WebView's clock says", () => {
    // page-writable.js's identity arm, asked rather than re-derived: on a
    // phone whose tz data is stale the WebView's day is behind the
    // backend's, and the reading view would otherwise send the writer to
    // "write today" from the page that IS today.
    const ahead = page({ id: "today-row", date: "2026-10-09" });
    expect(readingRows({ page: ahead, todayDateStr: "2026-10-08", todayPageId: "today-row" })).toEqual([
      { id: "continue", label: "continue" },
    ]);
  });

  it("offers continue on a continuous trail's page whatever day it started", () => {
    // CLAUDE.md's trail-exception clause: the canonical doc is
    // freeform-editable at any position, and its `date` is whatever day it
    // was begun. A reading view that froze it would freeze the one surface
    // the exception exists to keep open. `pageReadonly` already answers
    // this — the assertion is that this module asks it rather than
    // re-deriving a date rule of its own.
    const rows = readingRows({
      page: page({ date: LONG_AGO }),
      trailMode: "continuous",
      todayDateStr: TODAY,
    });
    expect(rows).toEqual([{ id: "continue", label: "continue" }]);
    expect(pageReadonly({ page: page({ date: LONG_AGO }), trailMode: "continuous" })).toBe(false);
  });

  it("offers a closed page the same words a past one gets", () => {
    // `is_open === false` is the other arm of pageReadonly, and it does not
    // move with the clock — a page closed today is still done.
    expect(
      readingRows({ page: page({ date: TODAY, is_open: false }), todayDateStr: TODAY }).map(
        (r) => r.id,
      ),
    ).toEqual(["done", "today"]);
  });

  it("offers nothing at all before the page has loaded", () => {
    // NOT "nothing happens" for its own sake: with no page there is
    // nothing to continue and nothing true to say about it, and the screen
    // renders its "reading the page" state instead of a row list. A row
    // here would be a control acting on a page that is not there.
    expect(readingRows({ page: null, todayDateStr: TODAY })).toEqual([]);
  });

  it("marks exactly one entry as a note, and it is not the one that acts", () => {
    const rows = readingRows({ page: page({ date: LONG_AGO }), todayDateStr: TODAY });
    expect(rows.filter((r) => r.note).map((r) => r.id)).toEqual(["done"]);
    expect(rows.find((r) => r.id === "today").note).toBeUndefined();
  });
});
