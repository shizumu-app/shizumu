import { describe, it, expect } from "vitest";
import { createMockInvoke } from "./api.js";

async function withTrail() {
  const invoke = createMockInvoke();
  const lin = await invoke("create_lineage", { name: "book", mode: "discrete" });
  const { page } = await invoke("get_or_create_today", {});
  return { invoke, lineageId: lin.id, pageId: page.id };
}

describe("mock: carry-forward pins", () => {
  it("returns only pins marked auto_insert, for the asked-for trail", async () => {
    const { invoke, lineageId, pageId } = await withTrail();
    const carried = await invoke("create_pin", {
      lineageId, sourcePageId: pageId, objectType: "note", content: "carried", title: null,
    });
    await invoke("create_pin", {
      lineageId, sourcePageId: pageId, objectType: "note", content: "not carried", title: null,
    });
    await invoke("update_pin_auto_insert", { id: carried.id, autoInsert: true });

    // A second trail with its own auto_insert pin — this only distinguishes
    // "filtered by lineage_id" from "there was only ever one trail to find"
    // if get_carry_forward_pins is actually asked to exclude it.
    const otherLin = await invoke("create_lineage", { name: "other", mode: "discrete" });
    const otherPin = await invoke("create_pin", {
      lineageId: otherLin.id, sourcePageId: pageId, objectType: "note", content: "other trail", title: null,
    });
    await invoke("update_pin_auto_insert", { id: otherPin.id, autoInsert: true });

    const pins = await invoke("get_carry_forward_pins", { lineageId });
    expect(pins.map((p) => p.content)).toEqual(["carried"]);
  });

  it("creates pins with auto_insert off, matching migration 012's default", async () => {
    const { invoke, lineageId, pageId } = await withTrail();
    const pin = await invoke("create_pin", {
      lineageId, sourcePageId: pageId, objectType: "note", content: "x", title: null,
    });
    expect(pin.auto_insert).toBe(0);
    // Empty because nothing has been marked to carry, not because the query
    // is broken: a pin only carries forward once someone asks it to.
    expect(await invoke("get_carry_forward_pins", { lineageId })).toEqual([]);
  });

  it("excludes orphaned pins", async () => {
    const { invoke, lineageId, pageId } = await withTrail();
    const pin = await invoke("create_pin", {
      lineageId, sourcePageId: pageId, objectType: "note", content: "gone", title: null,
    });
    await invoke("update_pin_auto_insert", { id: pin.id, autoInsert: true });
    await invoke("update_pin_status", { id: pin.id, status: "orphaned" });

    // A second auto_insert pin that is NOT orphaned, so the assertion below
    // distinguishes "the orphaned one was excluded" from "everything was
    // excluded" — a filter that always returned [] would have passed this
    // test before this pin existed.
    const stillHere = await invoke("create_pin", {
      lineageId, sourcePageId: pageId, objectType: "note", content: "still here", title: null,
    });
    await invoke("update_pin_auto_insert", { id: stillHere.id, autoInsert: true });

    const pins = await invoke("get_carry_forward_pins", { lineageId });
    expect(pins.map((p) => p.content)).toEqual(["still here"]);
  });

  it("orders by object_type, then position, then created_at", async () => {
    const { invoke, lineageId, pageId } = await withTrail();
    // Insertion order deliberately scrambles what a naive "just created_at"
    // sort would produce: "board" is inserted second but must sort first
    // because object_type is the primary key. Position and created_at are
    // both assigned in insertion order by this mock's store (there's no
    // command that sets one independently of the other), so the two
    // same-object_type pins below exercise position/created_at together as
    // the tiebreak rather than in isolation.
    const noteFirst = await invoke("create_pin", {
      lineageId, sourcePageId: pageId, objectType: "note", content: "note-first-inserted", title: null,
    });
    const board = await invoke("create_pin", {
      lineageId, sourcePageId: pageId, objectType: "board", content: "board-second-inserted", title: null,
    });
    const noteSecond = await invoke("create_pin", {
      lineageId, sourcePageId: pageId, objectType: "note", content: "note-third-inserted", title: null,
    });
    for (const p of [noteFirst, board, noteSecond]) {
      await invoke("update_pin_auto_insert", { id: p.id, autoInsert: true });
    }

    const pins = await invoke("get_carry_forward_pins", { lineageId });
    expect(pins.map((p) => p.content)).toEqual([
      "board-second-inserted",
      "note-first-inserted",
      "note-third-inserted",
    ]);
  });
});

describe("mock: trail pages", () => {
  it("returns a trail's pages, PageWithLines-shaped, in date order", async () => {
    const invoke = createMockInvoke();
    const lin = await invoke("create_lineage", { name: "book", mode: "discrete" });
    for (const date of ["2026-08-20", "2026-08-18", "2026-08-22"]) {
      const { page } = await invoke("create_new_page", { date });
      await invoke("set_focus_lineage", { pageId: page.id, lineageId: lin.id });
    }
    const pages = await invoke("get_trail_pages", { lineageId: lin.id });
    // { page, lines, session_markers } — matches PageWithLines
    // (src-tauri/src/models.rs:150), not a flat page row.
    expect(pages.map((p) => p.page.date)).toEqual(["2026-08-18", "2026-08-20", "2026-08-22"]);
    expect(pages.every((p) => Array.isArray(p.lines) && Array.isArray(p.session_markers))).toBe(true);
  });
});

describe("mock: search", () => {
  it("finds a page by text stored in content_json", async () => {
    const invoke = createMockInvoke();
    const { page } = await invoke("get_or_create_today", {});
    await invoke("save_page_content", {
      pageId: page.id,
      contentJson: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "the harbour at dusk" }] }],
      }),
    });
    const hits = await invoke("search_pages", { query: "harbour" });
    expect(hits.map((h) => h.id)).toEqual([page.id]);
  });

  it("finds a page by a block title, which lives in attrs not a text node", async () => {
    const invoke = createMockInvoke();
    const { page } = await invoke("get_or_create_today", {});
    await invoke("save_page_content", {
      pageId: page.id,
      contentJson: JSON.stringify({
        type: "doc",
        content: [{ type: "block", attrs: { blockTitle: "lighthouse survey" }, content: [] }],
      }),
    });
    const hits = await invoke("search_pages", { query: "lighthouse" });
    expect(hits.map((h) => h.id)).toEqual([page.id]);
  });
});

describe("mock: demo export and import", () => {
  it("round-trips a store through plain JSON", async () => {
    const a = createMockInvoke();
    const lin = await a("create_lineage", { name: "book", mode: "discrete" });
    const { page } = await a("get_or_create_today", {});
    await a("set_focus_lineage", { pageId: page.id, lineageId: lin.id });
    await a("save_page_content", { pageId: page.id, contentJson: '{"type":"doc","content":[]}' });
    await a("mark_onboarding_complete", {});

    // Create a pin to verify pins array survives
    const pin = await a("create_pin", {
      lineageId: lin.id,
      sourcePageId: page.id,
      objectType: "note",
      content: "test pin content",
      title: "test pin",
    });

    // Set a non-default setting to verify settings object survives
    await a("set_setting", { key: "demo_setting", value: "demo_value" });

    // Create a block to verify blocks Map survives
    const block = await a("create_block", { pageId: page.id, blockType: "checklist", name: "test block" });

    const dumped = JSON.parse(JSON.stringify(await a("__demo_export")));

    const b = createMockInvoke();
    await b("__demo_import", { data: dumped });

    // Verify onboarding state
    expect(await b("check_onboarding_complete")).toBe(true);

    // Verify pages and lineages survived
    expect((await b("get_trail_pages", { lineageId: lin.id })).map((p) => p.page.id)).toEqual([page.id]);

    // Verify pins survived the round-trip
    const pinsAfter = await b("get_pins", { lineageId: lin.id });
    expect(pinsAfter.map((p) => p.content)).toEqual(["test pin content"]);

    // Verify settings survived the round-trip
    const settingAfter = await b("get_setting", { key: "demo_setting" });
    expect(settingAfter).toBe("demo_value");

    // Verify blocks survived the round-trip
    const blocksAfter = await b("get_blocks_for_page", { pageId: page.id });
    expect(blocksAfter.map((b) => b.block.name)).toEqual(["test block"]);
  });
});

// The six commands the phone shell reaches that the mock used to answer with
// a bare null. Each mirrors its Rust command in src-tauri/src/commands.rs, so
// the browser demo behaves like the installed app rather than pretending.
describe("mock: what the phone shell reaches", () => {
  const doc = (text) => JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

  it("load_page_content_for_modal returns the page's content_json string", async () => {
    const invoke = createMockInvoke();
    const { page } = await invoke("get_or_create_today", {});
    // Rust maps a NULL column to "" (unwrap_or_default), not to null.
    expect(await invoke("load_page_content_for_modal", { pageId: page.id })).toBe("");
    await invoke("save_page_content", { pageId: page.id, contentJson: doc("the harbour") });
    expect(await invoke("load_page_content_for_modal", { pageId: page.id })).toBe(doc("the harbour"));
  });

  it("load_page_content_for_modal rejects for a page that does not exist", async () => {
    const invoke = createMockInvoke();
    await expect(invoke("load_page_content_for_modal", { pageId: "nope" })).rejects.toBeTruthy();
  });

  it("save_page_content_with_pin_refresh writes content a following load reads back", async () => {
    const invoke = createMockInvoke();
    const { page } = await invoke("get_or_create_today", {});
    await invoke("save_page_content_with_pin_refresh", {
      pageId: page.id, contentJson: doc("written from the pin modal"), yjsState: null,
    });
    expect(await invoke("load_page_content_for_modal", { pageId: page.id }))
      .toBe(doc("written from the pin modal"));
  });

  it("save_page_content_with_pin_refresh refreshes the pin cache from its node", async () => {
    // The refresh is the half of the name the shell relies on: an edit to a
    // pinned block, saved through this command, is what the pins panel
    // shows next. Mirrors refresh_pin_caches.
    const { invoke, lineageId, pageId } = await withTrail();
    const pin = await invoke("create_pin", {
      lineageId, sourcePageId: pageId, objectType: "block", content: "old", title: null,
    });
    const node = {
      type: "block", attrs: { pinId: pin.id, blockTitle: "  new title  " },
      content: [{ type: "paragraph", content: [{ type: "text", text: "new" }] }],
    };
    await invoke("save_page_content_with_pin_refresh", {
      pageId, contentJson: JSON.stringify({ type: "doc", content: [node] }), yjsState: null,
    });
    const [after] = await invoke("get_pins", { lineageId });
    expect(after.content).toBe(JSON.stringify(node));
    expect(after.title).toBe("new title");
    expect(after.status).toBe("open");
  });

  it("save_page_content_with_pin_refresh orphans an open pin whose node left its page", async () => {
    const { invoke, lineageId, pageId } = await withTrail();
    const pin = await invoke("create_pin", {
      lineageId, sourcePageId: pageId, objectType: "note", content: "kept", title: null,
    });
    await invoke("save_page_content_with_pin_refresh", {
      pageId, contentJson: doc("the pinned line is gone"), yjsState: null,
    });
    const [after] = await invoke("get_pins", { lineageId });
    expect(after.id).toBe(pin.id);
    expect(after.status).toBe("orphaned");
    // Sunk, not shredded: the cache stays as it was.
    expect(after.content).toBe("kept");
  });

  it("delete_lineage re-parents a middle trail's children to its parent", async () => {
    const invoke = createMockInvoke();
    const root = await invoke("create_lineage", { name: "root" });
    const mid = await invoke("create_lineage", { name: "mid", parentId: root.id });
    const leaf = await invoke("create_lineage", { name: "leaf", parentId: mid.id });
    await invoke("delete_lineage", { lineageId: mid.id, targetLineageId: null });
    const rows = await invoke("get_lineages", {});
    expect(rows.map((l) => l.id).sort()).toEqual([root.id, leaf.id].sort());
    expect(rows.find((l) => l.id === leaf.id).parent_id).toBe(root.id);
  });

  it("delete_lineage re-parents a root's children to null", async () => {
    const invoke = createMockInvoke();
    const root = await invoke("create_lineage", { name: "root" });
    const child = await invoke("create_lineage", { name: "child", parentId: root.id });
    await invoke("delete_lineage", { lineageId: root.id, targetLineageId: null });
    const rows = await invoke("get_lineages", {});
    expect(rows.map((l) => [l.id, l.parent_id])).toEqual([[child.id, null]]);
  });

  it("delete_lineage unlinks its pages and moves its pins to its parent", async () => {
    const invoke = createMockInvoke();
    const root = await invoke("create_lineage", { name: "root" });
    const mid = await invoke("create_lineage", { name: "mid", parentId: root.id });
    const { page } = await invoke("create_new_page", { date: "2026-10-20" });
    await invoke("set_focus_lineage", { pageId: page.id, lineageId: mid.id });
    const pin = await invoke("create_pin", {
      lineageId: mid.id, sourcePageId: page.id, objectType: "note", content: "kept", title: null,
    });
    await invoke("delete_lineage", { lineageId: mid.id, targetLineageId: null });
    // Untrailed now, so the page owns no trail's page list.
    expect(await invoke("get_trail_pages", { lineageId: mid.id })).toEqual([]);
    const { page: reread } = await invoke("get_page", { date: "2026-10-20", pageNumber: 1 });
    expect(reread.lineage_id).toBeNull();
    // delete_lineage_inner, no target: pins inherit the deleted trail's parent.
    expect((await invoke("get_pins", { lineageId: root.id })).map((p) => p.id)).toEqual([pin.id]);
  });

  it("delete_lineage moves a root's pins to null, and pages and pins to a target when given", async () => {
    const invoke = createMockInvoke();
    const a = await invoke("create_lineage", { name: "a" });
    const b = await invoke("create_lineage", { name: "b" });
    const target = await invoke("create_lineage", { name: "target" });
    const { page } = await invoke("create_new_page", { date: "2026-10-21" });
    await invoke("set_focus_lineage", { pageId: page.id, lineageId: b.id });
    const pa = await invoke("create_pin", {
      lineageId: a.id, sourcePageId: page.id, objectType: "note", content: "a", title: null,
    });
    const pb = await invoke("create_pin", {
      lineageId: b.id, sourcePageId: page.id, objectType: "note", content: "b", title: null,
    });
    await invoke("delete_lineage", { lineageId: a.id, targetLineageId: null });
    expect((await invoke("get_pins", { lineageId: null })).map((p) => p.id)).toEqual([pa.id]);
    await invoke("delete_lineage", { lineageId: b.id, targetLineageId: target.id });
    expect((await invoke("get_pins", { lineageId: target.id })).map((p) => p.id)).toEqual([pb.id]);
    expect((await invoke("get_trail_pages", { lineageId: target.id })).map((r) => r.page.id))
      .toEqual([page.id]);
  });

  it("update_pin_scope moves a pin to another trail", async () => {
    const { invoke, lineageId, pageId } = await withTrail();
    const other = await invoke("create_lineage", { name: "other" });
    const pin = await invoke("create_pin", {
      lineageId, sourcePageId: pageId, objectType: "note", content: "moving", title: null,
    });
    await invoke("update_pin_scope", { id: pin.id, lineageId: other.id });
    expect((await invoke("get_pins", { lineageId: other.id })).map((p) => p.id)).toEqual([pin.id]);
    // Gone from the old trail, not listed twice. The real get_pins walks
    // ancestors; these trails are siblings, so the old one lists nothing.
    expect(await invoke("get_pins", { lineageId })).toEqual([]);
    await invoke("update_pin_scope", { id: pin.id, lineageId: null });
    expect((await invoke("get_pins", { lineageId: null })).map((p) => p.id)).toEqual([pin.id]);
  });

  it("get_canonical_trail_page returns a continuous trail's one page, the same one every time", async () => {
    const invoke = createMockInvoke();
    const lin = await invoke("create_lineage", { name: "the book", mode: "continuous" });
    // Rust does not create the canonical page; a trail with no page yet has
    // no document, and the shell renders that row as having none. The page
    // arrives when one is assigned (set_focus_lineage).
    expect(await invoke("get_canonical_trail_page", { lineageId: lin.id })).toBeNull();
    const { page } = await invoke("create_new_page", { date: "2026-10-22" });
    await invoke("set_focus_lineage", { pageId: page.id, lineageId: lin.id });
    const first = await invoke("get_canonical_trail_page", { lineageId: lin.id });
    const second = await invoke("get_canonical_trail_page", { lineageId: lin.id });
    expect(first.page.id).toBe(page.id);
    expect(second.page.id).toBe(first.page.id);
    // PageWithLines, like get_page.
    expect(Array.isArray(first.lines) && Array.isArray(first.session_markers)).toBe(true);
  });

  it("get_canonical_trail_page returns null for a discrete trail", async () => {
    // A discrete trail has pages but no canonical one: Rust answers None for
    // any mode other than continuous, page or no page.
    const { invoke, lineageId, pageId } = await withTrail();
    await invoke("set_focus_lineage", { pageId, lineageId });
    expect(await invoke("get_canonical_trail_page", { lineageId })).toBeNull();
  });

  it("save_trail_content writes the canonical page, and a reload returns it", async () => {
    const invoke = createMockInvoke();
    const lin = await invoke("create_lineage", { name: "the book", mode: "continuous" });
    const { page } = await invoke("create_new_page", { date: "2026-10-22" });
    await invoke("set_focus_lineage", { pageId: page.id, lineageId: lin.id });
    await invoke("save_trail_content", {
      lineageId: lin.id, pageId: page.id, contentJson: doc("chapter one"),
    });
    const reloaded = await invoke("get_canonical_trail_page", { lineageId: lin.id });
    expect(reloaded.page.content_json).toBe(doc("chapter one"));
  });
});
