import { describe, it, expect } from "vitest";
import { createMockInvoke } from "../api.js";
import { SEED_VERSION, seedDemo, daysBefore } from "./fixture.js";

const NOW = new Date("2026-09-01T10:00:00.000Z");

async function seeded() {
  const invoke = createMockInvoke();
  await seedDemo(invoke, NOW);
  return invoke;
}

describe("daysBefore", () => {
  it("counts back in whole days and crosses a month boundary", () => {
    expect(daysBefore(NOW, 0)).toBe("2026-09-01");
    expect(daysBefore(NOW, 3)).toBe("2026-08-29");
    expect(daysBefore(NOW, 30)).toBe("2026-08-02");
  });
});

describe("seedDemo", () => {
  it("leaves today's page empty and untrailed", async () => {
    const invoke = await seeded();
    const { page } = await invoke("get_or_create_today", {});
    expect(page.lineage_id ?? null).toBeNull();
    expect(page.content_json ?? null).toBeNull();
  });

  it("skips onboarding", async () => {
    expect(await (await seeded())("check_onboarding_complete")).toBe(true);
  });

  it("seeds three discrete trails", async () => {
    const lineages = await (await seeded())("get_lineages");
    expect(lineages.map((l) => l.mode)).toEqual(["discrete", "discrete", "discrete"]);
    expect(lineages.map((l) => l.name).sort()).toEqual(["book", "job search", "letters"]);
  });

  it("puts carry-forward pins on the book trail", async () => {
    const invoke = await seeded();
    const book = (await invoke("get_lineages")).find((l) => l.name === "book");
    const pins = await invoke("get_carry_forward_pins", { lineageId: book.id });
    expect(pins.length).toBeGreaterThanOrEqual(3);
  });

  it("dates the seeded past relative to now, never in the future", async () => {
    const invoke = await seeded();
    const book = (await invoke("get_lineages")).find((l) => l.name === "book");
    const pages = await invoke("get_trail_pages", { lineageId: book.id });
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) expect(p.page.date <= daysBefore(NOW, 0)).toBe(true);
  });

  it("writes prose that search can find", async () => {
    const hits = await (await seeded())("search_pages", { query: "harbour" });
    expect(hits.length).toBeGreaterThan(0);
  });

  it("puts carry-forward pins on the job search trail too", async () => {
    // Not redundant with the book assertion above: pin x trail is the demo's
    // whole argument, and a visitor who picks the other task-shaped trail has
    // to see it work there as well.
    const invoke = await seeded();
    const jobs = (await invoke("get_lineages")).find((l) => l.name === "job search");
    const pins = await invoke("get_carry_forward_pins", { lineageId: jobs.id });
    expect(pins.length).toBeGreaterThanOrEqual(2);
  });

  describe("the seeded pages are real documents, not walls of paragraphs", () => {
    /** Every node type appearing anywhere in any seeded page's content_json. */
    async function seededNodeTypes() {
      const invoke = await seeded();
      const types = new Set();
      for (const lineage of await invoke("get_lineages")) {
        for (const { page } of await invoke("get_trail_pages", { lineageId: lineage.id })) {
          (function walk(n) {
            if (!n || typeof n !== "object") return;
            if (typeof n.type === "string") types.add(n.type);
            if (Array.isArray(n.content)) n.content.forEach(walk);
          })(JSON.parse(page.content_json));
        }
      }
      return types;
    }

    it("uses headings, quotes, rules and lists, not only paragraphs", async () => {
      const types = await seededNodeTypes();
      for (const t of ["heading", "blockquote", "horizontalRule", "list", "listItem"]) {
        expect([...types]).toContain(t);
      }
    });

    it("writes tasks in the unified list schema, not the legacy one", async () => {
      // taskList/taskItem still load, but only through migrate-list-schema.js.
      // Seeding them would mean shipping a fixture that needs migrating on
      // every boot, so the demo must be written in the schema the app saves.
      const types = await seededNodeTypes();
      expect([...types]).not.toContain("taskList");
      expect([...types]).not.toContain("taskItem");
    });

    it("seeds tasks that are actually ticked, and some that are not", async () => {
      const invoke = await seeded();
      const markers = [];
      for (const lineage of await invoke("get_lineages")) {
        for (const { page } of await invoke("get_trail_pages", { lineageId: lineage.id })) {
          (function walk(n) {
            if (!n || typeof n !== "object") return;
            if (n.type === "listItem" && n.attrs?.marker === "task") markers.push(!!n.attrs.checked);
            if (Array.isArray(n.content)) n.content.forEach(walk);
          })(JSON.parse(page.content_json));
        }
      }
      // A checklist where nothing is done reads as a fresh template rather than
      // work someone has been living in, which is the opposite of the point.
      expect(markers).toContain(true);
      expect(markers).toContain(false);
    });

    it("keeps text inside blocks findable by search", async () => {
      // docText walks the whole tree, so moving a line into a quote or a task
      // must not cost it its place in memory. This is the assertion that fails
      // if a future block type stores its text somewhere the walker misses.
      const hits = await (await seeded())("search_pages", { query: "teaching load" });
      expect(hits.length).toBeGreaterThan(0);
    });
  });
});
