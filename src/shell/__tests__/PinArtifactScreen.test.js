import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import PinArtifactScreen from "../PinArtifactScreen.svelte";

afterEach(cleanupAll);

// Fixed dates, injected into every mount, and local-time timestamps (no
// zone suffix) so the day each reduces to on the provenance line is the
// same in every timezone — provenance.test.js's convention.
const TODAY = "2026-05-20";
const YESTERDAY = "2026-05-19";

const pin = (over = {}) => ({
  id: "pin-1",
  lineage_id: "L1",
  source_page_id: "page-1",
  object_type: "note",
  title: "the second reader",
  content: "what the trail is for",
  created_at: "2026-05-20T09:00:00",
  updated_at: "2026-05-20T09:00:00",
  ...over,
});

const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });

const board = (over = {}) =>
  pin({
    object_type: "board",
    title: "the shape of it",
    // BARE-NODE JSON, which is what `refresh_pin_caches` actually writes.
    content: JSON.stringify({ type: "blockquote", content: [para("not time, scope")] }),
    ...over,
  });

const mount = (props) =>
  render(PinArtifactScreen, { todayStr: TODAY, yesterdayStr: YESTERDAY, trailName: "the book", ...props });

const rowLabels = (target) =>
  [...target.querySelectorAll(".shell-row-label")].map((n) => n.textContent.trim());

describe("PinArtifactScreen — the head", () => {
  it("says `pin` in the bar and holds the name in a field under it", () => {
    // Twice reconsidered, and the history is the point. The same line was
    // once on screen TWICE — the bar's title and a Title under it, both
    // `pinRowLabel`. That became the KIND in the bar, which on a phone read
    // as a third word for the same thing above a screen already showing the
    // writing. It is now just `pin`: the bar says which screen you are on,
    // which is the one thing a bar is for.
    //
    // pin-artifact-view.js's header records what that costs — for a chart
    // or a board the kind was a word of warning before the scroll — and
    // where it would belong if that turns out to matter.
    const { target } = mount({ pin: pin() });
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("pin");
    expect(target.querySelector(".shell-navbar-subtitle")).toBeNull();
    const title = target.querySelector('input[aria-label="pin title"]');
    expect(title.value).toBe("the second reader");
    expect(title.getAttribute("placeholder")).toBe("name this pin");
    expect(target.querySelector(".shell-title")).toBeNull();
  });

  it("says `pin` for a board too, rather than the kind", () => {
    // This asserted the opposite until the decision changed — a board's bar
    // reading `outline`. Kept and pointed the other way rather than
    // deleted: what it guards now is that the bar does NOT vary with the
    // kind, and a board is the kind most likely to tempt it back.
    const { target } = mount({ pin: board() });
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("pin");
  });

  it("sets the title in Title's size", () => {
    // TitleField reads --title-field-size off its wrapper; this screen
    // hands it Title's --text-xl. Asserted on the source: jsdom resolves
    // no scoped <style>.
    const { readFileSync } = require("node:fs");
    const src = readFileSync("src/shell/PinArtifactScreen.svelte", "utf8");
    expect(src).toMatch(/\.pin-artifact-title\s*\{[^}]*--title-field-size: var\(--text-xl\)/);
  });

  it("renders the provenance as a line, not a row, and no chip", () => {
    // The chip said the trail; the line's first words say the trail. One
    // fact, said once, as text.
    const { target } = mount({ pin: pin() });
    const line = target.querySelector(".shell-provenance");
    expect(line.tagName).toBe("P");
    expect(line.textContent.trim()).toBe("from the book · kept today");
    expect(target.querySelector(".shell-chip")).toBeNull();
  });

  it("dates the line off the props it was given, not the machine's clock", () => {
    const { target } = mount({
      pin: pin({ created_at: "2026-05-19T09:00:00" }),
      todayStr: TODAY,
      yesterdayStr: YESTERDAY,
    });
    expect(target.querySelector(".shell-provenance").textContent.trim()).toBe(
      "from the book · kept yesterday · edited today",
    );
  });
});

describe("PinArtifactScreen — the writing, edited where it is read", () => {
  it("puts a note's text in a field, newlines intact", () => {
    const { target } = mount({ pin: pin({ content: "one\ntwo" }) });
    const body = target.querySelector('textarea[aria-label="pin text"]');
    expect(body.value).toBe("one\ntwo");
    expect(target.querySelector(".ProseMirror")).toBeNull();
  });

  it("mounts a live editor over a board pin", () => {
    // THE DEFECT the second pass named: "pins are not editable". A board,
    // a table or a list is a doc, and a doc is edited in ProseMirror or
    // not at all. The bare node is wrapped and migrated on the way in
    // (pin-artifact-view.js), which is what makes the mount possible.
    const { target } = mount({ pin: board() });
    flushSync();
    const pm = target.querySelector(".pin-artifact-body .ProseMirror");
    expect(pm).not.toBeNull();
    expect(pm.getAttribute("contenteditable")).toBe("true");
    expect(pm.textContent).toContain("not time, scope");
    expect(target.querySelector("textarea")).toBeNull();
  });

  it("sets the writing on the canvas, in no card", () => {
    // The card boxed the writing one step off the canvas; on a phone a
    // raised box inside a screen inside a frame read as a quote. The
    // writing sits where the page's own prose sits.
    const { target } = mount({ pin: board() });
    flushSync();
    expect(target.querySelector(".shell-card")).toBeNull();
    expect(target.querySelector(".pin-artifact-body .prose")).not.toBeNull();
  });

  it("says so, rather than showing schema, when the cache will not parse", () => {
    const { target } = mount({ pin: pin({ content: '{"type": "table", "conten' }) });
    expect(target.textContent).toContain("nothing readable kept here");
    expect(target.textContent).not.toContain('"type"');
    // The title still edits: it is pin metadata, not the cache.
    expect(target.querySelector('input[aria-label="pin title"]')).not.toBeNull();
  });

  it("remounts the editor when the same pin comes back saved", () => {
    // A save stamps updated_at; the host patches the row; the screen must
    // not setContent over a live instance (the caret, and a stale prop's
    // text, would go with it). Keyed, so it is a fresh mount.
    const { target, instance } = mount({ pin: board() });
    flushSync();
    const first = target.querySelector(".ProseMirror");
    // Svelte 5: props are updated by re-rendering with the same target via
    // the instance's $set-less path — the helper exposes none, so the
    // claim is held on the key expression in the source instead.
    const { readFileSync } = require("node:fs");
    const src = readFileSync("src/shell/PinArtifactScreen.svelte", "utf8");
    expect(src).toMatch(/\{#key editorKey\}/);
    expect(src).toMatch(/editorKey = \$derived\([^)]*updated_at/);
    expect(first).not.toBeNull();
    expect(instance).toBeTruthy();
  });
});

describe("PinArtifactScreen — what goes up", () => {
  it("reports a committed title with the body untouched", () => {
    const onDraft = vi.fn();
    const { target } = mount({ pin: pin(), onDraft });
    const title = target.querySelector('input[aria-label="pin title"]');
    title.value = "what the trail is for";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    title.dispatchEvent(new FocusEvent("blur"));
    expect(onDraft).toHaveBeenCalledTimes(1);
    expect(onDraft).toHaveBeenCalledWith({
      title: "what the trail is for",
      content: "what the trail is for".replace("what the trail is for", "what the trail is for"),
      contentDirty: false,
    });
  });

  it("reports a note's text as typed, and marks the body dirty", () => {
    const onDraft = vi.fn();
    const { target } = mount({ pin: pin({ content: "one\ntwo" }), onDraft });
    const body = target.querySelector('textarea[aria-label="pin text"]');
    body.value = "one\ntwo\nthree";
    body.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onDraft).toHaveBeenLastCalledWith({
      title: "the second reader",
      content: "one\ntwo\nthree",
      contentDirty: true,
    });
  });

  it("reports the whole doc on an editor change, and marks the body dirty", () => {
    const onDraft = vi.fn();
    let editor = null;
    mount({ pin: board(), onDraft, onEditor: (e) => { editor = e; } });
    flushSync();
    // Type through the instance the screen hands up (PinEditor's
    // onEditor, passed through), which is the only way into a
    // contenteditable jsdom cannot focus.
    expect(editor).toBeTruthy();
    const { view } = editor;
    view.dispatch(view.state.tr.insertText("still ", 2));
    expect(onDraft).toHaveBeenCalledTimes(1);
    const draft = onDraft.mock.calls[0][0];
    expect(draft.contentDirty).toBe(true);
    expect(draft.title).toBe("the shape of it");
    expect(draft.content.type).toBe("doc");
    expect(JSON.stringify(draft.content)).toContain("still not time, scope");
  });

  it("does not report a blur that changed nothing about the title's text as dirty", () => {
    // The host compares the title to the pin and the body by the flag;
    // a bare blur reports contentDirty false so a no-op open+close writes
    // nothing — the desktop modal's `dirty` gate, which exists because a
    // no-op round trip through the serializer once overwrote pins.
    const onDraft = vi.fn();
    const { target } = mount({ pin: board(), onDraft });
    flushSync();
    target.querySelector('input[aria-label="pin title"]').dispatchEvent(new FocusEvent("blur"));
    expect(onDraft.mock.calls[0][0].contentDirty).toBe(false);
  });
});

describe("PinArtifactScreen — the rows", () => {
  it("offers the way back as a push, and the two actions without chevrons", () => {
    // With a callback: without one Row renders every row inert (a div, no
    // chevron), which is right for a host that cannot act and wrong here.
    const { target } = mount({ pin: pin(), onRow: vi.fn() });
    expect(rowLabels(target)).toEqual(["open the page it came from", "carry forward", "unpin"]);
    const rows = [...target.querySelectorAll(".shell-row")];
    expect(rows.map((r) => r.dataset.kind)).toEqual(["push", "action", "action"]);
    expect(rows[0].querySelector(".shell-row-chevron")).not.toBeNull();
    expect(rows[1].querySelector(".shell-row-chevron")).toBeNull();
    expect(rows[2].dataset.destructive).toBeUndefined();
  });

  it("routes every row through its one callback", () => {
    const onRow = vi.fn();
    const { target } = mount({ pin: pin(), onRow });
    for (const row of target.querySelectorAll(".shell-row")) row.click();
    expect(onRow.mock.calls.map((c) => c[0])).toEqual(["source", "carry", "unpin"]);
  });

  it("offers an orphaned pin its cache and only the unpin", () => {
    const { target } = mount({ pin: pin({ status: "orphaned", content: "one" }) });
    expect(target.querySelector("textarea").value).toBe("one");
    expect(target.querySelector(".shell-provenance").textContent.trim()).toMatch(/^source removed/);
    expect(rowLabels(target)).toEqual(["unpin"]);
  });

  it("shows the pin's trail on a trail row, and routes its tap", () => {
    const onRow = vi.fn();
    const { target } = mount({ pin: pin(), onRow, trailValue: "the book" });
    const row = [...target.querySelectorAll(".shell-row")].find(
      (r) => r.querySelector(".shell-row-label").textContent.trim() === "trail",
    );
    expect(row, "no trail row").toBeTruthy();
    expect(row.querySelector(".shell-row-value").textContent.trim()).toBe("the book");
    expect(row.dataset.kind).toBe("choice");
    row.click();
    expect(onRow).toHaveBeenCalledWith("trail");
  });

  it("hands back on the bar's own control", () => {
    const onBack = vi.fn();
    const { target } = mount({ pin: pin(), onBack });
    target.querySelector(".shell-navbar-back").click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("PinArtifactScreen — no pin", () => {
  it("says the pin did not open rather than going blank", () => {
    const { target } = mount({ pin: null });
    expect(target.textContent).toContain("this pin did not open");
    expect(target.querySelector(".shell-row")).toBeNull();
    expect(target.querySelector('input[aria-label="pin title"]')).toBeNull();
  });

  it("marks its scroller with no region", () => {
    // A swipe up at the bottom of a pushed screen must not leave for
    // memory — PinsScreen's call, for PinsScreen's reason.
    const { target } = mount({ pin: pin() });
    expect(target.querySelector(".shell-screen-content").dataset.shellRegion).toBeUndefined();
  });
});
