import { describe, it, expect } from "vitest";
import { pageReadonly, readonlyNote } from "../page-writable.js";

// Both reference dates are injected everywhere below, for page-model.js's
// reason: a gate that reads the clock internally produces a suite whose
// colour changes overnight.
const TODAY = "2026-08-30";
const YESTERDAY = "2026-08-29";

describe("pageReadonly", () => {
  it("lets the writer type into today's page", () => {
    expect(pageReadonly({ page: { date: TODAY }, todayDateStr: TODAY })).toBe(false);
  });

  it("refuses a page from another day — the arm the shell did not have", () => {
    // The whole reason this module exists. Until the date sheet, the shell
    // could not hold a page from another day, so `is_open === false` was
    // the only term and nothing could tell. CLAUDE.md: "past pages are
    // read-only… write today on PAGE".
    expect(pageReadonly({ page: { date: YESTERDAY }, todayDateStr: TODAY })).toBe(true);
    expect(pageReadonly({ page: { date: "1999-01-02" }, todayDateStr: TODAY })).toBe(true);
  });

  it("does not trust is_open to mean 'a past page'", () => {
    // An old row with is_open = 1 is the ordinary state of old data: the
    // only write of `is_open = 0` in the tree is migration 003's one-off
    // backfill, and nothing flips it at a day boundary. A shell that asked
    // only that question would call this page writable, which is exactly
    // what it did.
    const old = { date: "1999-01-02", is_open: true };
    expect(pageReadonly({ page: old, todayDateStr: TODAY })).toBe(true);
  });

  it("refuses a closed page even on today", () => {
    expect(
      pageReadonly({ page: { date: TODAY, is_open: false }, todayDateStr: TODAY }),
    ).toBe(true);
  });

  it("keeps a continuous trail's living document open on any day", () => {
    // The trail exception (CLAUDE.md): one canonical document the writer
    // keeps adding to, whose `date` is the day it was started. Judged by
    // date alone it would freeze on day two — mode outranks date, exactly
    // as on the desktop (Page.svelte:175).
    expect(
      pageReadonly({
        page: { date: "2026-01-05" },
        trailMode: "continuous",
        todayDateStr: TODAY,
      }),
    ).toBe(false);
  });

  it("still refuses a CLOSED continuous canonical", () => {
    // Order matters between the two arms: `is_open` is asked first, so
    // continuity does not reopen a page something else closed.
    expect(
      pageReadonly({
        page: { date: "2026-01-05", is_open: false },
        trailMode: "continuous",
        todayDateStr: TODAY,
      }),
    ).toBe(true);
  });

  it("answers 'writable' before a page has loaded, rather than flickering", () => {
    // Not an empty-result assertion dressed as a rule: `false` here is
    // what stops the whole of the page's chrome rendering dead for the one
    // frame between mount and the load landing, on the most common path in
    // the app. There is no page to refuse.
    expect(pageReadonly({ page: null, todayDateStr: TODAY })).toBe(false);
    expect(pageReadonly()).toBe(false);
  });

  it("answers 'writable' for a row whose date cannot be read", () => {
    // The date arm can only close on a date it can read. A canvas that
    // silently refuses writing is the worse of the two failures — the
    // writer cannot tell it from a broken app — and `is_open` still guards.
    expect(pageReadonly({ page: { id: "p1" }, todayDateStr: TODAY })).toBe(false);
    expect(pageReadonly({ page: { date: "" }, todayDateStr: TODAY })).toBe(false);
    expect(pageReadonly({ page: { date: 20260830 }, todayDateStr: TODAY })).toBe(false);
  });
});

describe("pageReadonly — the page the backend handed out as today", () => {
  // TWO CLOCKS DECIDED ONE FACT. The backend dates the page it makes in
  // `get_or_create_today` with chrono's clock; the date arm above judged
  // that page with the WebView's. Measured on an SM-A065F in
  // Africa/Casablanca, whose tz data is stale: the WebView said the 8th
  // (UTC+0) while Rust said the 9th (UTC+1), so for an hour every night the
  // page Rust had just made as today's was "an earlier day" here and the
  // canvas refused every keystroke. ShellApp's clockDay asks the backend
  // first, but falls back to the WebView whenever that call cannot answer,
  // and any frame judged before it lands is judged by the WebView too. The
  // page's identity carries the fact with no clock at all.
  const BACKEND_TODAY = "2026-10-09";
  const WEBVIEW_TODAY = "2026-10-08";
  const handedOut = { id: "today-row", date: BACKEND_TODAY, is_open: true };

  it("lets the writer type on it when the WebView's clock is behind the backend's", () => {
    expect(
      pageReadonly({ page: handedOut, todayDateStr: WEBVIEW_TODAY, todayPageId: "today-row" }),
    ).toBe(false);
    expect(
      readonlyNote({ page: handedOut, todayDateStr: WEBVIEW_TODAY, todayPageId: "today-row" }),
    ).toBeNull();
  });

  it("does not reopen any other page", () => {
    // Identity, not date: another row is judged by the date arm as before,
    // so a past page opened from the date sheet stays read-only.
    const other = { id: "other-row", date: "2026-10-07" };
    expect(
      pageReadonly({ page: other, todayDateStr: WEBVIEW_TODAY, todayPageId: "today-row" }),
    ).toBe(true);
  });

  it("lets the day move on under it — midnight still turns it into yesterday", () => {
    // The identity holds only until the clock passes the page's own date.
    // `>`, not `!==`: a clock that is BEHIND the page's date is the
    // disagreement this exists for, while one that is past it is a real
    // midnight, which midnight.js's sheet is built on.
    expect(
      pageReadonly({ page: handedOut, todayDateStr: "2026-10-10", todayPageId: "today-row" }),
    ).toBe(true);
  });

  it("still refuses it once it is closed", () => {
    expect(
      pageReadonly({
        page: { ...handedOut, is_open: false },
        todayDateStr: BACKEND_TODAY,
        todayPageId: "today-row",
      }),
    ).toBe(true);
  });
});

describe("readonlyNote", () => {
  // The defect: `pageReadonly` answering true was the whole of it, and
  // nothing on screen said why. On an SM-A065F the entire visible text of a
  // page refusing every keystroke was
  //
  //     9 oct · find · pins · + · page · memory · settings
  //
  // which a writer cannot tell from a broken app. page-writable.js's own
  // header had already called that the worse of the two failures.

  it("says nothing at all about a page that takes writing", () => {
    // NOT an empty-result assertion of the kind CLAUDE.md warns about: null
    // here is what keeps the ordinary page — every page, nearly always —
    // free of a line of chrome explaining that it works.
    expect(readonlyNote({ page: { date: TODAY }, todayDateStr: TODAY })).toBeNull();
  });

  it("names the day when the page is from an earlier one", () => {
    expect(readonlyNote({ page: { date: YESTERDAY }, todayDateStr: TODAY }))
      .toBe("this is an earlier day. write on today's page.");
  });

  it("says a closed page is done, whatever day it is from", () => {
    expect(readonlyNote({ page: { date: TODAY, is_open: false }, todayDateStr: TODAY }))
      .toBe("this page is done. write on today's page.");
  });

  it("prefers done over earlier when the page is both", () => {
    // A closed page from last week is both, and "done" is what the writer
    // did to it while the date is only when. It is also the arm
    // `pageReadonly` checks first, so the two agree by construction.
    expect(readonlyNote({ page: { date: YESTERDAY, is_open: false }, todayDateStr: TODAY }))
      .toBe("this page is done. write on today's page.");
  });

  it("stays quiet on a continuous trail, which is writable on any day", () => {
    // The trail exception: its one canonical doc is freeform-editable
    // whatever day it was started, so there is nothing to explain.
    expect(readonlyNote({
      page: { date: YESTERDAY },
      trailMode: "continuous",
      todayDateStr: TODAY,
    })).toBeNull();
  });

  it("agrees with pageReadonly on every shape", () => {
    // The property that matters more than any single sentence: a canvas
    // that is quiet while the note says it is writable, or the reverse, is
    // the one way this can go wrong. Reading both off one module makes it
    // unrepresentable, and this is the assertion that holds that.
    const shapes = [
      { page: null },
      { page: { date: TODAY } },
      { page: { date: YESTERDAY } },
      { page: { date: TODAY, is_open: false } },
      { page: { date: YESTERDAY }, trailMode: "continuous" },
      { page: { id: "p1" } },
      { page: { date: "" } },
    ];
    for (const shape of shapes) {
      const args = { ...shape, todayDateStr: TODAY };
      expect(readonlyNote(args) !== null).toBe(pageReadonly(args));
    }
  });
});
