import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import {
  BLOCK_ID_TYPES,
  carriesBlockId,
  newBlockId,
  cyrb53,
  derivedBlockId,
  walkBlocks,
  assignBlockIds,
  dedupeBlockIds,
  fillDerivedBlockIds,
  stripBlockIdsFromJSON,
} from "../block-id.js";
import { PINNABLE_TYPES } from "../extensions/pin-id.js";
import { READONLY_EXTENSIONS } from "../render/shared-extensions.js";
import { migrateListSchema } from "../extensions/migrate-list-schema.js";

const para = (t, attrs) => ({ type: "paragraph", ...(attrs ? { attrs } : {}), content: [{ type: "text", text: t }] });
const doc = (...nodes) => ({ type: "doc", content: nodes });

describe("newBlockId", () => {
  it("is 12 base-36 characters", () => {
    for (let i = 0; i < 50; i++) expect(newBlockId()).toMatch(/^[0-9a-z]{12}$/);
  });

  it("differs call to call", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newBlockId()));
    expect(ids.size).toBe(500);
  });

  it("draws from the bytes it is given and skips the biased top ones", () => {
    // 252..255 would make 0..3 likelier than the rest; they are thrown away.
    let call = 0;
    const fill = (buf) => {
      call += 1;
      buf.fill(call === 1 ? 255 : 37); // first batch all rejected, then 37 % 36 = 1
      return buf;
    };
    expect(newBlockId(fill)).toBe("111111111111");
    expect(call).toBe(2);
  });
});

describe("cyrb53 / derivedBlockId", () => {
  // Fixed vectors: a port of the derivation (Rust export, a script) must
  // reproduce these exactly, or a page's ids change between the editor and
  // the export.
  it("hashes to fixed vectors", () => {
    expect(cyrb53("")).toBe(3338908027751811);
    expect(cyrb53("a")).toBe(7929297801672961);
    expect(derivedBlockId("p1", [0])).toBe("d1hoy06xtv0a");
    expect(derivedBlockId("p1", [2, 1, 0])).toBe("d" + cyrb53("p1:2.1.0").toString(36));
    expect(derivedBlockId("p1", [0], 1)).toBe("d" + cyrb53("p1:0#1").toString(36));
  });

  it("is the same every time and differs by page and by path", () => {
    expect(derivedBlockId("p1", [3])).toBe(derivedBlockId("p1", [3]));
    expect(derivedBlockId("p1", [3])).not.toBe(derivedBlockId("p2", [3]));
    expect(derivedBlockId("p1", [3])).not.toBe(derivedBlockId("p1", [3, 0]));
    expect(derivedBlockId("p1", [1, 2])).not.toBe(derivedBlockId("p1", [12]));
    expect(derivedBlockId("p1", [3])).toMatch(/^d[0-9a-z]{1,11}$/);
  });

  it("hashes UTF-16 code units, so a non-ASCII page id is stable", () => {
    expect(derivedBlockId("é😀", [0])).toBe("d" + cyrb53("é😀:0").toString(36));
  });
});

describe("BLOCK_ID_TYPES", () => {
  it("is the pinnable list, shared rather than copied", () => {
    expect(BLOCK_ID_TYPES).toBe(PINNABLE_TYPES);
    expect(carriesBlockId("paragraph")).toBe(true);
    expect(carriesBlockId("decisionBlock")).toBe(true);
    // A text node is not a block; a list item lives inside a list that has one.
    expect(carriesBlockId("text")).toBe(false);
    expect(carriesBlockId("listItem")).toBe(false);
  });
});

describe("walkBlocks", () => {
  const json = doc(
    para("a"),
    { type: "blockquote", content: [para("b"), para("c")] },
  );

  it("gives the same paths to JSON and to the ProseMirror doc it parses into", () => {
    const schema = getSchema(READONLY_EXTENSIONS);
    const pm = schema.nodeFromJSON(json);
    const fromJson = [];
    const fromPm = [];
    walkBlocks(json, (_n, path, _pos, type) => fromJson.push(`${type}@${path.join(".")}`));
    walkBlocks(pm, (_n, path, _pos, type) => { if (type !== "text") fromPm.push(`${type}@${path.join(".")}`); });
    expect(fromPm).toEqual(fromJson.filter((s) => !s.startsWith("text@")));
    expect(fromPm).toEqual(["paragraph@0", "blockquote@1", "paragraph@1.0", "paragraph@1.1"]);
  });

  it("hands ProseMirror nodes their position", () => {
    const schema = getSchema(READONLY_EXTENSIONS);
    const pm = schema.nodeFromJSON(json);
    const seen = [];
    walkBlocks(pm, (node, _path, pos) => seen.push([pos, node.type.name]));
    for (const [pos, type] of seen) expect(pm.nodeAt(pos).type.name).toBe(type);
  });
});

describe("assignBlockIds", () => {
  it("gives every block without an id its derived id, nested blocks too", () => {
    const fixes = assignBlockIds(doc(para("a"), { type: "blockquote", content: [para("b")] }), "pg");
    expect(fixes).toEqual([
      [null, derivedBlockId("pg", [0])],
      [null, derivedBlockId("pg", [1])],
      [null, derivedBlockId("pg", [1, 0])],
    ]);
  });

  it("leaves a block that has an id alone", () => {
    const fixes = assignBlockIds(doc(para("a", { blockId: "keep" }), para("b")), "pg");
    expect(fixes).toEqual([[null, derivedBlockId("pg", [1])]]);
  });

  it("is nothing to do on a doc whose blocks all have ids", () => {
    // Nothing missing and nothing shared: an empty list is the "already
    // done" answer, which is what keeps a second load from changing anything.
    expect(assignBlockIds(doc(para("a", { blockId: "x" }), para("b", { blockId: "y" })), "pg")).toEqual([]);
  });

  it("gives a stored duplicate a derived id, and the first keeps the shared one", () => {
    const fixes = assignBlockIds(doc(para("a", { blockId: "same" }), para("b", { blockId: "same" })), "pg");
    expect(fixes).toEqual([[null, derivedBlockId("pg", [1])]]);
  });

  it("salts a derived id that is already taken", () => {
    const taken = derivedBlockId("pg", [1]);
    const fixes = assignBlockIds(doc(para("a", { blockId: taken }), para("b")), "pg");
    expect(fixes).toEqual([[null, derivedBlockId("pg", [1], 1)]]);
  });

  it("returns positions on a ProseMirror doc", () => {
    const schema = getSchema(READONLY_EXTENSIONS);
    const pm = schema.nodeFromJSON(doc(para("a"), para("b")));
    expect(assignBlockIds(pm, "pg")).toEqual([[0, derivedBlockId("pg", [0])], [3, derivedBlockId("pg", [1])]]);
  });
});

describe("dedupeBlockIds", () => {
  let n = 0;
  const makeId = () => `new${++n}`;

  it("gives a block without an id a new one", () => {
    n = 0;
    expect(dedupeBlockIds(doc(para("a", { blockId: "x" }), para("b")), { makeId })).toEqual([[null, "new1"]]);
  });

  it("keeps the first of a shared id in document order, when nothing says otherwise", () => {
    n = 0;
    const d = doc(para("a", { blockId: "x" }), para("b"), para("c", { blockId: "x" }));
    expect(dedupeBlockIds(d, { makeId })).toEqual([[null, "new1"], [null, "new2"]]);
  });

  it("lets the block that already had the id keep it, even when the copy is above it", () => {
    n = 0;
    const schema = getSchema(READONLY_EXTENSIONS);
    // The copy sits at 0, the original at 3.
    const pm = schema.nodeFromJSON(doc(para("a", { blockId: "x" }), para("a", { blockId: "x" })));
    expect(dedupeBlockIds(pm, { makeId, prefer: () => 3 })).toEqual([[0, "new1"]]);
  });

  it("hands the id to the block with the words when the preferred one is now empty", () => {
    // Enter at the start of a paragraph: an empty block where the original
    // was, the original's text below it, both carrying the id.
    n = 0;
    const schema = getSchema(READONLY_EXTENSIONS);
    const pm = schema.nodeFromJSON(doc({ type: "paragraph", attrs: { blockId: "x" } }, para("the words", { blockId: "x" })));
    expect(dedupeBlockIds(pm, { makeId, prefer: () => 0 })).toEqual([[0, "new1"]]);
  });

  it("keeps the preferred block when both are empty", () => {
    n = 0;
    const schema = getSchema(READONLY_EXTENSIONS);
    const pm = schema.nodeFromJSON(doc({ type: "paragraph", attrs: { blockId: "x" } }, { type: "paragraph", attrs: { blockId: "x" } }));
    expect(dedupeBlockIds(pm, { makeId, prefer: () => 2 })).toEqual([[0, "new1"]]);
  });

  it("falls back to document order when the preferred position holds no such block", () => {
    n = 0;
    const schema = getSchema(READONLY_EXTENSIONS);
    const pm = schema.nodeFromJSON(doc(para("a", { blockId: "x" }), para("a", { blockId: "x" })));
    expect(dedupeBlockIds(pm, { makeId, prefer: () => 99 })).toEqual([[3, "new1"]]);
  });

  it("never hands out an id the doc already uses", () => {
    let i = 0;
    const ids = ["x", "x", "fresh"];
    const fixes = dedupeBlockIds(doc(para("a", { blockId: "x" }), para("b")), { makeId: () => ids[i++] });
    expect(fixes).toEqual([[null, "fresh"]]);
  });
});

describe("fillDerivedBlockIds", () => {
  it("writes the derived ids into a copy, leaving the input alone", () => {
    const input = doc(para("a"), { type: "blockquote", content: [para("b")] });
    const before = JSON.stringify(input);
    const out = fillDerivedBlockIds(input, "pg");
    expect(JSON.stringify(input)).toBe(before);
    expect(out.content[0].attrs.blockId).toBe(derivedBlockId("pg", [0]));
    expect(out.content[1].attrs.blockId).toBe(derivedBlockId("pg", [1]));
    expect(out.content[1].content[0].attrs.blockId).toBe(derivedBlockId("pg", [1, 0]));
  });

  it("agrees with the ids assignBlockIds plans for the same doc", () => {
    const input = doc(para("a"), para("b", { blockId: "kept" }), { type: "blockquote", content: [para("c")] });
    const planned = assignBlockIds(input, "pg").map(([, id]) => id);
    const filled = [];
    walkBlocks(fillDerivedBlockIds(input, "pg"), (_n, _p, _pos, type, id) => { if (carriesBlockId(type)) filled.push(id); });
    expect(filled.filter((id) => id !== "kept")).toEqual(planned);
  });

  it("works on a stored 0.7 page once the editor's list migration has run", () => {
    // 0.7 stored lists as bulletList/listItem. The editor migrates before it
    // parses, so the paths it derives from are the migrated doc's.
    const v07 = doc(
      para("intro"),
      { type: "bulletList", content: [
        { type: "listItem", content: [para("one")] },
        { type: "listItem", content: [para("two")] },
      ] },
    );
    const a = fillDerivedBlockIds(migrateListSchema(v07), "page-07");
    const b = fillDerivedBlockIds(migrateListSchema(v07), "page-07");
    expect(a).toEqual(b);
    const ids = [];
    walkBlocks(a, (_n, _p, _pos, type, id) => { if (carriesBlockId(type)) ids.push(id); });
    expect(ids.length).toBeGreaterThan(2);
    expect(ids.every((id) => typeof id === "string" && id.startsWith("d"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("stripBlockIdsFromJSON", () => {
  it("removes every blockId, nested too, and keeps everything else", () => {
    const input = { type: "list", attrs: { blockId: "a", pinId: "P", blockTitle: "t" }, content: [
      { type: "listItem", attrs: { marker: "bullet" }, content: [para("x", { blockId: "b" })] },
    ] };
    const out = stripBlockIdsFromJSON(input);
    expect(out.attrs).toEqual({ pinId: "P", blockTitle: "t" });
    expect(out.content[0].content[0].attrs).toEqual({});
    expect(input.attrs.blockId).toBe("a");
  });

  it("handles arrays and non-objects", () => {
    expect(stripBlockIdsFromJSON([para("a", { blockId: "x" })])[0].attrs).toEqual({});
    expect(stripBlockIdsFromJSON(null)).toBe(null);
    expect(stripBlockIdsFromJSON("s")).toBe("s");
  });
});
