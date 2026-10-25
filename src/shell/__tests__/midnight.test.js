import { describe, it, expect } from "vitest";
import { midnightDue } from "../midnight.js";

// A page that was today's when it came on screen, and a clock that has since
// rolled over. Every case below is one field away from this.
const CROSSED = {
  pageDate: "2026-08-31",
  openedOn: "2026-08-31",
  today: "2026-09-01",
  answered: null,
  space: "page",
};

describe("midnightDue", () => {
  it("is due when the day moved under a page that was today's", () => {
    expect(midnightDue(CROSSED)).toBe(true);
  });

  it("is not due while the page is still today's", () => {
    // The overwhelmingly common state, and the reason this reads as
    // "nothing happens": the sheet is non-dismissable, so a false positive
    // here is a wall in front of the writing surface with no way past it
    // that does not also change which page the writer is on.
    expect(midnightDue({ ...CROSSED, today: "2026-08-31" })).toBe(false);
  });

  it("is not due on a past page the writer opened on purpose", () => {
    // THE DEFECT THIS MODULE WAS REWRITTEN FOR. The first version asked
    // only "is the page older than today", which is also true of a page
    // reached from the date sheet or from the reading view's `continue` —
    // legal acts the shell is built around. Choosing to read last Tuesday
    // summoned a non-dismissable sheet asking whether to start a new day.
    //
    // Reproduced by dropping the `pageDate !== openedOn` guard: ShellApp's
    // own "keeps the sheet usable when the history read fails" goes red,
    // because its fixture is a page from 1999 and midnight takes the date
    // sheet's place the moment it opens.
    expect(midnightDue({ ...CROSSED, pageDate: "1999-01-02" })).toBe(false);
  });

  it("is not due on a page dated in the future", () => {
    // A device whose clock ran ahead writes a page dated tomorrow and syncs
    // it back; page-picker.js drops the same case from the day rows. Such a
    // page cannot have been today's when it was opened, so the same guard
    // covers it.
    expect(midnightDue({ ...CROSSED, pageDate: "2026-09-02" })).toBe(false);
  });

  it("is not due when the clock is corrected backward", () => {
    // `today > openedOn`, not `today !== openedOn`. An NTP step or a
    // westward timezone change moves the device's day BACKWARD, and
    // announcing "a new day" on the way into yesterday is the one direction
    // the sheet can be wrong in without anything on screen contradicting it.
    expect(midnightDue({ ...CROSSED, openedOn: "2026-09-02", pageDate: "2026-09-02" })).toBe(
      false,
    );
  });

  it("asks again the next night, not again the same night", () => {
    // "stay on yesterday" leaves the page exactly where it was, so the
    // condition that opened the sheet is still true — without the stamp the
    // sheet reopens on the next poll and the writer cannot get past it.
    expect(midnightDue({ ...CROSSED, answered: "2026-09-01" })).toBe(false);
    expect(midnightDue({ ...CROSSED, answered: "2026-08-31" })).toBe(true);
  });

  it("is not due before the first page has loaded", () => {
    // The shell paints before its page load resolves. Asking a writer to
    // choose between two pages neither of which exists yet is the version
    // of this bug that greets every cold launch.
    expect(midnightDue({ ...CROSSED, pageDate: null })).toBe(false);
    expect(midnightDue({ ...CROSSED, openedOn: null })).toBe(false);
    expect(midnightDue({ ...CROSSED, pageDate: undefined })).toBe(false);
  });

  it("is not due away from the writing surface", () => {
    // Memory and settings are read surfaces: "start fresh" means nothing on
    // a timeline, and a non-dismissable sheet over a list is a wall in
    // front of the one part of the app that never needed today's date. The
    // crossing is not lost — the next test is the proof that coming back
    // re-asks.
    expect(midnightDue({ ...CROSSED, space: "memory" })).toBe(false);
    expect(midnightDue({ ...CROSSED, space: "settings" })).toBe(false);
  });

  it("asks on the way back to the page", () => {
    expect(midnightDue({ ...CROSSED, space: "page" })).toBe(true);
  });

  it("compares dates as strings across month and year boundaries", () => {
    // Nothing here parses a date, and these are the cases that would catch
    // a parse creeping in: page-model.js:36 records that a bare YYYY-MM-DD
    // parses at UTC midnight, which puts the instant an hour on the wrong
    // side of the boundary in some zones. Lexicographic order on
    // YYYY-MM-DD is date order, so no Date is needed at all.
    expect(midnightDue({ ...CROSSED, today: "2026-09-01" })).toBe(true);
    expect(
      midnightDue({ ...CROSSED, pageDate: "2026-12-31", openedOn: "2026-12-31", today: "2027-01-01" }),
    ).toBe(true);
  });
});
