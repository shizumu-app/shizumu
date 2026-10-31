import { describe, it, expect } from "vitest";
import { dayRows, daySheetNote, pageRows, pageSheetRows, DAY_ROW_LIMIT, DAY_SHEET_NOTE } from "../page-picker.js";

const TODAY = "2026-08-30";
const YESTERDAY = "2026-08-29";
const refs = { todayDateStr: TODAY, yesterdayDateStr: YESTERDAY };

function summary(over = {}) {
  return { id: "s1", date: TODAY, page_number: 1, ...over };
}

describe("dayRows", () => {
  it("offers today first even on a morning with nothing written", () => {
    // The one day the writer can still write on, and the shell's whole
    // answer to a phone left open across midnight. A picker built only
    // from days that already have writing is a one-way trip into the past.
    const rows = dayRows({ summaries: [], ...refs });
    expect(rows.map((r) => r.date)).toEqual([TODAY]);
    expect(rows[0].label).toBe("today");
  });

  it("labels each day the way the header does", () => {
    const rows = dayRows({
      summaries: [
        summary({ id: "a", date: YESTERDAY }),
        summary({ id: "b", date: "2026-08-24" }),
      ],
      ...refs,
    });
    expect(rows.map((r) => r.label)).toEqual(["today", "yesterday", "24 aug"]);
  });

  it("collapses a day's pages into one row carrying its FIRST page", () => {
    // One row per day, not one per page: the dots and the pages sheet ask
    // the second question, and a flat list of every page ever written is
    // memory. The first page is where the day starts.
    const rows = dayRows({
      summaries: [
        summary({ id: "third", date: YESTERDAY, page_number: 3 }),
        summary({ id: "first", date: YESTERDAY, page_number: 1 }),
        summary({ id: "second", date: YESTERDAY, page_number: 2 }),
      ],
      ...refs,
    });
    expect(rows).toHaveLength(2);
    expect(rows[1].page.id).toBe("first");
  });

  it("orders days newest first", () => {
    const rows = dayRows({
      summaries: [
        summary({ date: "2026-08-01" }),
        summary({ date: "2026-08-24" }),
        summary({ date: "2026-08-12" }),
      ],
      ...refs,
    });
    expect(rows.map((r) => r.date)).toEqual([TODAY, "2026-08-24", "2026-08-12", "2026-08-01"]);
  });

  it("marks the day being shown, and never leaves it out of its own list", () => {
    // getThread filters out a page with nothing on it yet, so the day the
    // writer is looking at can be missing from the fetch — the sheet would
    // then omit the very page it was opened from.
    const rows = dayRows({ summaries: [], currentDate: "2026-08-24", ...refs });
    expect(rows.map((r) => r.date)).toEqual([TODAY, "2026-08-24"]);
    expect(rows[1].showing).toBe(true);
    expect(rows[1].value).toBe("showing");
    expect(rows[0].showing).toBe(false);
  });

  it("drops a date after today", () => {
    // A device whose clock ran ahead syncs back a page dated tomorrow.
    // Not an empty-result-for-its-own-sake: rendering it would claim the
    // writer wrote on a day that has not happened, and opening it would
    // land on a page page-writable.js calls read-only anyway.
    const rows = dayRows({ summaries: [summary({ date: "2099-01-01" })], ...refs });
    expect(rows.map((r) => r.date)).toEqual([TODAY]);
  });

  it("caps the list, because the sheet is a shortcut and memory is the archive", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      summary({ id: `s${i}`, date: `2026-07-${String(i + 1).padStart(2, "0")}` }),
    );
    expect(dayRows({ summaries: many, ...refs })).toHaveLength(DAY_ROW_LIMIT);
  });

  it("survives rows with no date rather than rendering one", () => {
    // A summary with no date cannot be labelled or opened; skipping it is
    // the only thing left, and the row that would otherwise appear is a
    // blank one the writer could tap.
    const rows = dayRows({ summaries: [summary({ date: null }), {}], ...refs });
    expect(rows.map((r) => r.date)).toEqual([TODAY]);
  });
});

describe("daySheetNote", () => {
  it("says where other days go when today is the only row", () => {
    // Found on a fresh phone: `today ▾` opened a half-sheet holding one
    // row and a blank, which reads as broken. The grid stays refused
    // (page-picker.js's header); the sentence is what the sheet owes
    // instead.
    expect(daySheetNote(dayRows({ summaries: [], ...refs }))).toBe(DAY_SHEET_NOTE);
  });

  it("says what happens, in the voice the canon asks for", () => {
    // Lowercase, present tense, a full stop, and the retired word absent
    // (CLAUDE.md, brand voice). "no other days" would name a lack; this
    // names the rule a day appears by.
    expect(DAY_SHEET_NOTE).toBe(DAY_SHEET_NOTE.toLowerCase());
    expect(DAY_SHEET_NOTE.endsWith(".")).toBe(true);
    expect(DAY_SHEET_NOTE).not.toMatch(/!|\bno\b|\bsink|\bsunk/);
  });

  it("says nothing once any other day has writing", () => {
    // Not "nothing happens": the row above already shows a day that got
    // there by being written on, which is the whole sentence's content,
    // and a note under a list of days would explain what the list makes
    // plain — the settings screen's note shape only ever has one thing
    // to say, and so does this.
    expect(
      daySheetNote(dayRows({ summaries: [summary({ date: YESTERDAY })], ...refs })),
    ).toBeNull();
  });

  it("says nothing on a past day either, even with nothing else written", () => {
    // The day being shown is synthesised into the rows whether or not
    // the thread returned it, so a writer looking at a past page already
    // sees two days — the note would sit under a list that disproves it.
    expect(
      daySheetNote(dayRows({ summaries: [], currentDate: "2026-08-24", ...refs })),
    ).toBeNull();
  });
});

describe("pageRows", () => {
  it("numbers pages by ordinal, not by the page_number column", () => {
    // page-ordinal.js's scar: the column is minted per device and
    // renumbered on merge, so the same page is "1" on the phone and "4" on
    // the desktop. Position in the backend's order is the only label that
    // agrees everywhere.
    const rows = pageRows({
      summaries: [
        summary({ id: "a", page_number: 4 }),
        summary({ id: "b", page_number: 7 }),
      ],
    });
    expect(rows.map((r) => r.label)).toEqual(["page 1", "page 2"]);
  });

  // ── WHAT TELLS TWO PAGES APART ──────────────────────────────────────
  //
  // THE REPORT, from a phone: the pages sheet "rows are not clean and
  // informative, we see only page 1 2 the count". The value slot was always
  // meant to carry the page's own "what matters now" — this module's header
  // calls it the only thing distinguishing four pages of one day — and a
  // writer who never names a focus line got four identical rows.
  //
  // So the words fall back to the writing. Still the writer's own words,
  // which is the property that made the focus line the right answer; a
  // timestamp or a word count would be something the sheet composed.

  const docOf = (...lines) => JSON.stringify({
    type: "doc",
    content: lines.map((text) => ({
      type: "paragraph",
      content: text ? [{ type: "text", text }] : [],
    })),
  });

  it("falls back to the page's first words when there is no focus line", () => {
    const rows = pageRows({
      summaries: [summary({ id: "a", content_json: docOf("the gannets at bempton") })],
    });
    expect(rows[0].value).toBe("the gannets at bempton");
  });

  it("prefers the focus line, which is the writer naming the page", () => {
    // Not a tie-break for its own sake: one is what the page IS about and
    // the other is merely what it opens with.
    const rows = pageRows({
      summaries: [summary({
        id: "a",
        what_matters_now: "the chapter on seabirds",
        content_json: docOf("the gannets at bempton"),
      })],
    });
    expect(rows[0].value).toBe("the chapter on seabirds");
  });

  it("cuts a long first line to the same width as a long focus line", () => {
    const long = "a sentence that runs on well past the width of a phone row";
    const rows = pageRows({ summaries: [summary({ id: "a", content_json: docOf(long) })] });
    expect(rows[0].value.endsWith("…")).toBe(true);
    expect(rows[0].value.length).toBeLessThanOrEqual(33);
  });

  it("keeps a pinned block's words, which search deliberately drops", () => {
    // flattenDocText skips nodes carrying a pinId because it builds SEARCH
    // snippets and the pin's own copy would match twice. On a page row that
    // is backwards: the block a writer thought worth keeping is the most
    // recognisable thing on the page, and a page whose only content is a
    // pin would otherwise read as empty.
    const pinned = JSON.stringify({
      type: "doc",
      content: [{
        type: "paragraph",
        attrs: { pinId: "p-1" },
        content: [{ type: "text", text: "what the whole page was for" }],
      }],
    });
    const rows = pageRows({ summaries: [summary({ id: "a", content_json: pinned })] });
    expect(rows[0].value).toBe("what the whole page was for");
  });

  it("says nothing about a page with nothing on it", () => {
    // NOT an empty assertion for its own sake. Two empty pages are genuinely
    // identical and a sheet that invented a difference would be lying; and
    // the word "empty" names an absence, which the brand voice refuses
    // ("say what the page does, never what it lacks").
    expect(pageRows({ summaries: [summary({ id: "a" })] })[0].value).toBe("");
    expect(pageRows({ summaries: [summary({ id: "a", content_json: docOf("") })] })[0].value).toBe("");
    expect(pageRows({ summaries: [summary({ id: "a", content_json: "not json" })] })[0].value).toBe("");
  });

  it("still says `showing` for the page already open, over either of them", () => {
    const rows = pageRows({
      summaries: [summary({ id: "a", what_matters_now: "named", content_json: docOf("written") })],
      currentPageId: "a",
    });
    expect(rows[0].value).toBe("showing");
  });

  it("carries the whole row so the caller can address it by id", () => {
    // page-address.js's scar: (date, page_number) is a pointer that
    // resolves to a different page on each device.
    const rows = pageRows({ summaries: [summary({ id: "u-1" })] });
    expect(rows[0].page.id).toBe("u-1");
  });

  it("marks the page being shown", () => {
    const rows = pageRows({
      summaries: [summary({ id: "a" }), summary({ id: "b" })],
      currentPageId: "b",
    });
    expect(rows.map((r) => r.showing)).toEqual([false, true]);
    expect(rows[1].value).toBe("showing");
  });

  it("shows the page's own focus line beside it", () => {
    const rows = pageRows({
      summaries: [summary({ what_matters_now: "  finish\n chapter 4 " })],
    });
    expect(rows[0].value).toBe("finish chapter 4");
  });

  it("cuts a focus line that would push the label off the row", () => {
    const long = "a".repeat(80);
    const rows = pageRows({ summaries: [summary({ what_matters_now: long })] });
    expect(rows[0].value.endsWith("…")).toBe(true);
    expect(rows[0].value.length).toBeLessThan(40);
  });

  it("drops a row with no id — there is nothing to open", () => {
    // Not "nothing happens": an id-less row could be labelled but never
    // addressed, so tapping it would do nothing and look broken.
    expect(pageRows({ summaries: [{ page_number: 1 }] })).toEqual([]);
  });
});

describe("pageSheetRows — the list, and the one thing that can remove from it", () => {
  // A PAGE COULD NOT BE REMOVED ON THE PHONE AT ALL. The backend has had
  // delete_focus all along and the desktop wires it through FocusRail; the
  // shell's pages sheet only ever opened pages. The vocabulary was there too
  // — the block sheet established the destructive kind, the trail sheet
  // established a list with an action row under it — so this is the two
  // being put together rather than anything new.

  const page = (over = {}) => ({ id: "p1", date: "2026-08-30", page_number: 1, ...over });

  it("is the page list with nothing added when no page is open", () => {
    // Nothing to delete without a page being shown: the row acts on the page
    // the writer is looking at, and a sheet opened from nowhere has none.
    const rows = pageSheetRows({ summaries: [page()], currentPageId: null });
    expect(rows.map((r) => r.kind)).toEqual(["page"]);
  });

  it("offers to delete the page that is showing, by name", () => {
    // NAMED, not "delete this page". The label is the whole safeguard: this
    // acts at one tap on writing that cannot come back, so the row says which
    // page it will take. It is also the shortest honest label, which is what
    // the voice asks for.
    const rows = pageSheetRows({
      summaries: [page({ id: "a" }), page({ id: "b", page_number: 2 })],
      currentPageId: "b",
    });
    const last = rows[rows.length - 1];
    expect(last.kind).toBe("delete");
    expect(last.label).toBe("delete page 2");
    expect(last.destructive).toBe(true);
    expect(last.pageId).toBe("b");
  });

  it("asks before it deletes: armed, the row says a second tap takes the page", () => {
    // Vercel's interface guidelines, 2026-10-31: a destructive act needs a
    // confirmation or an undo, never one tap. The desktop rail already asks
    // twice (FocusRail confirmDeleteId); the phone deleted on the first tap.
    // Confirm, not undo: an undo would leave the page alive in the database
    // for seconds while sync runs, and a page that comes back is a merge.
    const rows = pageSheetRows({
      summaries: [page({ id: "a" }), page({ id: "b", page_number: 2 })],
      currentPageId: "b",
      armedDeleteId: "b",
    });
    const last = rows[rows.length - 1];
    expect(last.kind).toBe("delete");
    expect(last.armed).toBe(true);
    expect(last.label).toBe("tap again to delete page 2");
  });

  it("is not armed for a page other than the one showing", () => {
    // A confirm armed on one page must not carry to the next: the sheet
    // reopened on another page starts unarmed.
    const rows = pageSheetRows({
      summaries: [page({ id: "a" }), page({ id: "b", page_number: 2 })],
      currentPageId: "b",
      armedDeleteId: "a",
    });
    const last = rows[rows.length - 1];
    expect(last.armed).toBe(false);
    expect(last.label).toBe("delete page 2");
  });

  it("puts it last, where a thumb does not land by accident", () => {
    // pin-artifact-view.js's rule for `unpin`, which this follows: the row
    // that removes something is not the row a thumb reaches first.
    const rows = pageSheetRows({
      summaries: [page({ id: "a" }), page({ id: "b", page_number: 2 })],
      currentPageId: "a",
    });
    expect(rows.findIndex((r) => r.kind === "delete")).toBe(rows.length - 1);
    expect(rows.filter((r) => r.kind === "delete")).toHaveLength(1);
  });

  it("offers it for the only page of a day, which clears rather than empties", () => {
    // Not a special case to suppress. Deleting the last page lands on a fresh
    // today (the caller's fallback), so the writer gets an empty page rather
    // than a day with nothing in it — the same place `+` would have put them.
    const rows = pageSheetRows({ summaries: [page({ id: "a" })], currentPageId: "a" });
    expect(rows[rows.length - 1].kind).toBe("delete");
  });

  it("names the ordinal the sheet shows, not the page_number column", () => {
    // page-ordinal.js's scar, and it matters most here: a row that said
    // "delete page 7" over a list labelled 1..3 would be naming a page the
    // writer cannot see.
    const rows = pageSheetRows({
      summaries: [page({ id: "a", page_number: 4 }), page({ id: "b", page_number: 7 })],
      currentPageId: "b",
    });
    expect(rows[rows.length - 1].label).toBe("delete page 2");
  });
});

// A living document is one page, so its `today ▾` has no other day to open:
// its days are the day markers inside it. The phone had no way to list them
// (the desktop has mod+K), so a book's week could only be found by scrolling
// (sync journey J5.4, 2026-10-24).
import { markerRows } from "../page-picker.js";

describe("markerRows", () => {
  const markers = [
    { date: "2026-10-01", whatMatters: "the harbour at dawn" },
    { date: "2026-10-22", whatMatters: "" },
    { date: "2026-10-24", whatMatters: "chapter four" },
  ];

  it("lists the book's days newest first, each with its focus", () => {
    const rows = markerRows({ markers, todayDateStr: "2026-10-24", yesterdayDateStr: "2026-10-23" });
    expect(rows.map((r) => r.date)).toEqual(["2026-10-24", "2026-10-22", "2026-10-01"]);
    expect(rows[0]).toMatchObject({ label: "today", value: "chapter four" });
    expect(rows[2].value).toBe("the harbour at dawn");
  });

  // A day marker with no focus is still a day written on; it gets no value
  // rather than a placeholder that reads as content.
  it("keeps a day with no focus, with no value beside it", () => {
    const rows = markerRows({ markers, todayDateStr: "2026-10-24", yesterdayDateStr: "2026-10-23" });
    expect(rows[1].value).toBe("");
  });

  // Two markers for one day can arrive from two devices before a merge
  // settles; the list shows the day once.
  it("lists a day once", () => {
    const rows = markerRows({ markers: [...markers, { date: "2026-10-01", whatMatters: "again" }], todayDateStr: "2026-10-24", yesterdayDateStr: "2026-10-23" });
    expect(rows.filter((r) => r.date === "2026-10-01")).toHaveLength(1);
  });
});
