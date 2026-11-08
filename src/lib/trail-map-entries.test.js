import { describe, it, expect } from "vitest";
import { trailMapDay, pagePreviewLine } from "./trail-map-entries.js";

const lineages = [
  { id: "s", name: "shizumu", parent_id: null },
  { id: "v", name: "v0.8", parent_id: "s" },
  { id: "b", name: "the book", parent_id: null },
];
const doc = (...paras) => JSON.stringify({
  type: "doc",
  content: paras.map((p) => (typeof p === "string" ? { type: "paragraph", content: [{ type: "text", text: p }] } : p)),
});

describe("pagePreviewLine", () => {
  it("uses preview_lines[0] when the summary has one", () => {
    expect(pagePreviewLine({ preview_lines: ["first", "second"], content_json: doc("other") })).toBe("first");
  });

  it("falls back to the first line of the doc (editor pages keep no lines rows)", () => {
    expect(pagePreviewLine({ preview_lines: [], content_json: doc("the blocks have been usable", "more") }))
      .toBe("the blocks have been usable");
  });

  it("skips day markers and pinned blocks", () => {
    const json = doc(
      { type: "dayMarker", attrs: { date: "2026-01-15" } },
      { type: "paragraph", attrs: { pinId: "x" }, content: [{ type: "text", text: "a pinned line" }] },
      "the prose",
    );
    expect(pagePreviewLine({ content_json: json })).toBe("the prose");
  });

  it("reads through nested blocks to the first line of text", () => {
    const json = JSON.stringify({ type: "doc", content: [
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "an item" }] }] }] },
    ] });
    expect(pagePreviewLine({ content_json: json })).toBe("an item");
  });

  it("a line that only repeats the title is no preview", () => {
    // The entry already shows the title; repeating it under itself adds
    // a line and says nothing.
    expect(pagePreviewLine({ what_matters_now: "same", content_json: doc("same") })).toBe("");
  });

  it("clips a long line to one", () => {
    const long = "word ".repeat(80);
    const out = pagePreviewLine({ content_json: doc(long) });
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("trailMapDay", () => {
  const date = "2026-01-15";
  const p1 = { id: "p1", date, lineage_id: "v", what_matters_now: "what's left before tag", content_json: doc("the blocks have been usable") };
  const p2 = { id: "p2", date, lineage_id: "b", what_matters_now: "", content_json: doc("attention is not a resource") };
  const pin = { id: "k1", lineage_id: "v", source_page_id: "p1", source_page_date: date, title: "the chip is not content", content: "x" };

  it("puts each pin under the page it was kept from, instead of a count", () => {
    const { entries, loosePins } = trailMapDay({ pages: [p1, p2], pins: [pin], lineages, lineageId: null, date });
    const e1 = entries.find((e) => e.page.id === "p1");
    expect(e1.pins.map((x) => x.title)).toEqual(["the chip is not content"]);
    expect(entries.find((e) => e.page.id === "p2").pins).toEqual([]);
    expect(loosePins).toEqual([]);
  });

  it("each entry carries the trail path, title and preview", () => {
    const { entries } = trailMapDay({ pages: [p1, p2], pins: [], lineages, lineageId: null, date });
    expect(entries.find((e) => e.page.id === "p1")).toMatchObject({
      crumb: "shizumu › v0.8", title: "what's left before tag", untitled: false, preview: "the blocks have been usable",
    });
    expect(entries.find((e) => e.page.id === "p2")).toMatchObject({ crumb: "the book", title: "untitled", untitled: true });
  });

  it("the trail in view needs no label on its own pages; a child keeps its leaf", () => {
    const own = { ...p1, id: "p3", lineage_id: "s" };
    const { entries } = trailMapDay({ pages: [p1, own], pins: [], lineages, lineageId: "s", date });
    expect(entries.find((e) => e.page.id === "p3").crumb).toBeNull();
    expect(entries.find((e) => e.page.id === "p1").crumb).toBe("v0.8");
  });

  it("untrailed pages say so", () => {
    const loose = { id: "p4", date, lineage_id: null, what_matters_now: "a thought" };
    expect(trailMapDay({ pages: [loose], pins: [], lineages, lineageId: null, date }).entries[0].crumb).toBe("untrailed");
  });

  it("a pin whose page is not on the map still shows on its day", () => {
    const orphan = { ...pin, id: "k2", source_page_id: "gone" };
    const { loosePins } = trailMapDay({ pages: [p1], pins: [orphan], lineages, lineageId: null, date });
    expect(loosePins.map((x) => x.pin.id)).toEqual(["k2"]);
    expect(loosePins[0].crumb).toBe("shizumu › v0.8");
  });
});
