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
