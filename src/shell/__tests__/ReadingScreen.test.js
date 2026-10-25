import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import ReadingScreen from "../ReadingScreen.svelte";
import { clearRenderCache } from "../../lib/render/doc-renderer.js";

afterEach(() => {
  cleanupAll();
  // ProseHTML memoizes by cacheKey across tests in one process, and two
  // fixtures here deliberately share a page id to prove the key moves with
  // `updated_at`. Without this the second file to run would read the
  // first's HTML back and pass on a cache hit.
  clearRenderCache();
});

const TODAY = "2026-05-20";
const YESTERDAY = "2026-05-19";
const LONG_AGO = "1999-01-02";

const doc = (text) =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

// Local-time timestamps (no zone suffix), so the day `updated_at` reduces
// to on the provenance line is the same in every timezone the suite runs
// in — provenance.test.js's convention.
const page = (over = {}) => ({
  id: "p1",
  date: TODAY,
  page_number: 1,
  created_at: "2026-05-20T09:00:00",
  updated_at: "2026-05-20T09:00:00",
  content_json: doc("kept going"),
  ...over,
});

function mountReading(props = {}) {
  return render(ReadingScreen, {
    todayStr: TODAY,
    yesterdayStr: YESTERDAY,
    ...props,
  });
}

const rowLabels = (target) =>
  [...target.querySelectorAll(".shell-row-label")].map((n) => n.textContent.trim());

const tapRow = (target, label) => {
  const row = [...target.querySelectorAll(".shell-row")].find(
    (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
  );
  expect(row, `no "${label}" row`).toBeTruthy();
  row.click();
  flushSync();
};

describe("ReadingScreen — the writing", () => {
  it("renders the page's doc as prose", () => {
    const { target } = mountReading({ page: page() });
    expect(target.querySelector(".prose").textContent).toContain("kept going");
  });

  it("renders a list through the container that owns the shell's list rules", () => {
    // The same phone finding as PinArtifactScreen's: static HTML in
    // `.prose` gets the browser's own bullet beside the schema's marker,
    // because every list rule is under `.ProseMirror`. Both screens go
    // through StaticProse, and this holds this one to it — the rules
    // themselves are asserted once, in PinArtifactScreen.test.js.
    const content_json = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "list",
          content: [
            {
              type: "listItem",
              attrs: { marker: "task", checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "read it" }] }],
            },
          ],
        },
      ],
    });
    const { target } = mountReading({ page: page({ content_json }) });
    const prose = target.querySelector(".prose");
    expect(prose.classList.contains("shell-static-prose")).toBe(true);
    const items = prose.querySelectorAll('ul[data-list] > li[data-marker="task"]');
    expect(items.length).toBe(1);
    expect(items[0].querySelectorAll('input[type="checkbox"]').length).toBe(1);
  });

  it("holds no editor and nothing to type into", () => {
    // The strongest form of "past pages are read-only" is a surface with no
    // cursor, rather than one with a cursor and a gate that says no. This
    // is also the assertion behind the choice not to mount a second
    // EditorCore beside the page root's live one — Stack keeps the top two
    // entries alive, so a reading view that mounted one would double the
    // editors on the device with the least room for them.
    const { target } = mountReading({ page: page() });
    expect(target.querySelector(".ProseMirror")).toBeNull();
    expect(target.querySelector("[contenteditable]")).toBeNull();
  });

  it("puts the writer's focus line above the writing, as the screen's title", () => {
    // ThreadPageView's `.pv-matters`, in the shell's `Title` — an h1 in
    // Lora, so the writer's own sentence about the day is the heading a
    // reader lands on first.
    const { target } = mountReading({ page: page({ what_matters_now: "the second reader" }) });
    const title = target.querySelector(".shell-title");
    expect(title.tagName).toBe("H1");
    expect(title.textContent.trim()).toBe("the second reader");
  });

  it("shows no title on a page that has no focus line", () => {
    // NOT "untitled": memory's LIST needs a label on every row so rows can
    // be told apart, and this screen is one page — a placeholder above the
    // writing would put a word there the writer did not write.
    const { target } = mountReading({ page: page({ what_matters_now: "  " }) });
    expect(target.querySelector(".shell-title")).toBeNull();
  });

  it("names the day in the bar, and nothing under it", () => {
    // The trail left the bar's second line for the chip (below): the
    // chrome names the screen, the subject wears its trail.
    const { target } = mountReading({
      page: page({ date: YESTERDAY }),
      trailName: "the book",
    });
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("yesterday");
    expect(target.querySelector(".shell-navbar-subtitle")).toBeNull();
  });

  it("says the trail once, on the provenance line, and wears no chip", () => {
    // The chip and the line's first word both said the trail — one fact
    // twice, one of them dressed as a control. The line keeps it.
    //
    // The word for a page on no trail is `not on a trail`, which the
    // desktop does NOT say: it says `untrailed`, its own schema word. The
    // two trees disagree here on purpose. A phone shows this line to a
    // writer who has never met the vocabulary, and `untrailed` asks them
    // to learn a word to read a status; the long form just reads.
    // provenance.js's `trailWord` carries the same note.
    const trailed = mountReading({ page: page(), trailName: "the book" });
    expect(trailed.target.querySelector(".shell-chip")).toBeNull();
    expect(trailed.target.querySelector(".shell-provenance").textContent.trim()).toMatch(/^the book/);
    trailed.cleanup();
    const untrailed = mountReading({ page: page(), trailName: null });
    expect(untrailed.target.querySelector(".shell-provenance").textContent.trim()).toMatch(
      /^not on a trail/,
    );
  });

  it("says when the page was written and edited, under the title", () => {
    // provenance.js's line, rendered through `Provenance` — mono, a
    // caption to the title rather than a row. The words are held in
    // provenance.test.js; this holds that the screen puts them on.
    const { target } = mountReading({
      page: page({ date: YESTERDAY, updated_at: "2026-05-20T11:00:00" }),
      trailName: "the book",
    });
    const line = target.querySelector(".shell-provenance");
    expect(line.tagName).toBe("P");
    expect(line.textContent.trim()).toBe("the book · written yesterday · edited today");
  });

  it("sets the writing on the canvas, in no card", () => {
    // The card boxed the writing one step off the canvas; on a phone that
    // read as a quotation rather than as the page (the screen's header).
    // The prose sits in the screen's own inset column instead.
    const { target } = mountReading({ page: page() });
    expect(target.querySelector(".shell-card")).toBeNull();
    expect(target.querySelector(".reading-body .prose").textContent).toContain("kept going");
  });

  it("re-renders when the same page comes back edited", () => {
    // ProseHTML memoizes on the cacheKey this screen builds, and the key
    // carries `updated_at` for exactly this: a page re-read after an edit
    // must not come back from the cache as the version before it.
    const { target, cleanup } = mountReading({ page: page() });
    expect(target.querySelector(".prose").textContent).toContain("kept going");
    cleanup();

    const second = mountReading({
      page: page({ content_json: doc("and then stopped"), updated_at: "2026-05-20T10:00:00" }),
    });
    expect(second.target.querySelector(".prose").textContent).toContain("and then stopped");
  });
});

const noteText = (target) => target.querySelector(".shell-note")?.textContent.trim() ?? null;

describe("ReadingScreen — where it goes from here", () => {
  it("offers continue on a page the canvas will accept, and runs it", () => {
    const onRow = vi.fn();
    const { target } = mountReading({ page: page({ date: TODAY }), onRow });
    expect(rowLabels(target)).toEqual(["continue"]);
    // No note on a page that can be written on: the sentence explains an
    // offer that is not being made here.
    expect(noteText(target)).toBeNull();

    tapRow(target, "continue");
    expect(onRow).toHaveBeenCalledWith("continue");
  });

  it("offers a past page the day it can write on, and says why above it", () => {
    const onRow = vi.fn();
    const { target } = mountReading({ page: page({ date: LONG_AGO }), onRow });
    expect(noteText(target)).toBe("this page is done. today is on the page.");
    expect(rowLabels(target)).toEqual(["write today"]);

    tapRow(target, "write today");
    expect(onRow).toHaveBeenCalledWith("today");
  });

  it("renders the sentence as a note, not a row", () => {
    // It was an inert `Row` once — a 44px control that did nothing, in
    // the column where the taps are. A `Note` is a <p>: no handler, no
    // tab stop, nothing for a thumb to land on and be refused by. The
    // assertion is on the ELEMENT: no row carries that label, and the
    // element that does is a paragraph.
    const onRow = vi.fn();
    const { target } = mountReading({ page: page({ date: LONG_AGO }), onRow });
    expect(rowLabels(target)).not.toContain("this page is done. today is on the page.");
    const note = target.querySelector(".shell-note");
    expect(note.tagName).toBe("P");
    note.click();
    flushSync();
    expect(onRow).not.toHaveBeenCalled();
  });

  it("puts the note over the group, not inside it", () => {
    // Inside the group's body, RowGroup rules every child after the first,
    // and a line drawn between the sentence and the row it explains would
    // be the wrong line (SettingsSectionScreen found the same). Over the
    // group, because it is the reason and the row is the offer.
    const { target } = mountReading({ page: page({ date: LONG_AGO }) });
    const note = target.querySelector(".shell-note");
    const group = target.querySelector(".shell-row-group");
    expect(group.contains(note)).toBe(false);
    expect(note.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws both offers as actions with no chevron", () => {
    // `continue` and `write today` each leave for the page root and open
    // no screen of their own — row-kind.js's `action`, which draws no
    // chevron because there is nothing for one to point at. A chevron
    // here was the wart the visual pass removed.
    const past = mountReading({ page: page({ date: LONG_AGO }) });
    const today = mountReading({ page: page({ date: TODAY }) });
    for (const { target } of [past, today]) {
      const row = target.querySelector(".shell-row");
      expect(row.dataset.kind).toBe("action");
      expect(row.querySelector(".shell-row-chevron")).toBeNull();
    }
  });

  it("does not freeze a continuous trail's page, whatever day it started", () => {
    // CLAUDE.md's trail-exception clause. The date here is 1999 and the row
    // is still `continue`, because mode outranks date — the mode has to
    // reach this screen for that to hold, which is what this drives.
    const { target } = mountReading({
      page: page({ date: LONG_AGO }),
      trailMode: "continuous",
      trailName: "the book",
    });
    expect(rowLabels(target)).toEqual(["continue"]);
    expect(noteText(target)).toBeNull();
  });

  it("freezes the same page when the mode did not arrive", () => {
    // The mirror of the test above, and the reason ShellApp publishes the
    // page and the mode in one turn: a null mode reads as "not continuous",
    // so a screen handed the page first and the mode a round trip later
    // renders exactly this for a frame.
    const { target } = mountReading({ page: page({ date: LONG_AGO }), trailMode: null });
    expect(noteText(target)).toBe("this page is done. today is on the page.");
    expect(rowLabels(target)).toEqual(["write today"]);
  });
});

describe("ReadingScreen — the two states with no page", () => {
  it("says it is reading before it says the page did not open", () => {
    const { target } = mountReading({ page: null, loading: true });
    expect(target.querySelector(".empty-title").textContent.trim()).toBe("reading the page");
  });

  it("says the page did not open when the read is over and there is none", () => {
    // A blank screen here reads as the app losing a page it had just listed.
    const { target } = mountReading({ page: null, loading: false });
    expect(target.querySelector(".empty-title").textContent.trim()).toBe(
      "this page did not open",
    );
  });
});

describe("ReadingScreen — the region it does not claim", () => {
  it("marks its scroller with no region", () => {
    // PinsScreen's call and its reason: a swipe up at the bottom of a
    // pushed list must not leave for memory, because memory is the screen
    // one back. `Screen` defaults to no region, so this asserts the prop
    // was not passed rather than that a branch chose null — which is the
    // only thing that can be asserted about an omission, and it goes red
    // the day someone adds `region="canvas"` here by copying PageScreen.
    const { target } = mountReading({ page: page() });
    expect(target.querySelector("[data-shell-region]")).toBeNull();
  });
});
