// Unit tests for the Y.Doc lifecycle helpers. Covers the round-trip
// invariants the editor binding depends on.

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  XML_FRAGMENT_KEY,
  createDoc,
  hydrateDoc,
  encodeState,
  applyUpdate,
  bytesFromTauri,
  docFromTipTapJson,
} from "./page-doc.js";

describe("createDoc", () => {
  it("materialises the prosemirror fragment slot", () => {
    const doc = createDoc();
    const frag = doc.get(XML_FRAGMENT_KEY, Y.XmlFragment);
    expect(frag).toBeInstanceOf(Y.XmlFragment);
  });
});

describe("encodeState + hydrateDoc round-trip", () => {
  it("preserves XmlFragment content across encode + decode", () => {
    const doc = createDoc();
    const frag = doc.get(XML_FRAGMENT_KEY, Y.XmlFragment);
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("hello yjs")]);
    frag.insert(0, [paragraph]);

    const bytes = encodeState(doc);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const hydrated = hydrateDoc(bytes);
    const restored = hydrated.get(XML_FRAGMENT_KEY, Y.XmlFragment);
    expect(restored.length).toBe(1);
    const para = restored.get(0);
    expect(para.nodeName).toBe("paragraph");
    const text = para.get(0);
    expect(text.toString()).toBe("hello yjs");
  });

  it("hydrateDoc with null bytes returns a fresh doc", () => {
    const doc = hydrateDoc(null);
    const frag = doc.get(XML_FRAGMENT_KEY, Y.XmlFragment);
    expect(frag.length).toBe(0);
  });

  it("hydrateDoc with empty bytes returns a fresh doc", () => {
    const doc = hydrateDoc(new Uint8Array());
    const frag = doc.get(XML_FRAGMENT_KEY, Y.XmlFragment);
    expect(frag.length).toBe(0);
  });
});

describe("applyUpdate", () => {
  it("folds a peer's update into an existing doc — CRDT convergence", () => {
    // Origin doc with shared text.
    const origin = createDoc();
    const f = origin.get(XML_FRAGMENT_KEY, Y.XmlFragment);
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [new Y.XmlText("hi")]);
    f.insert(0, [p]);
    const baseBytes = encodeState(origin);

    // Two divergent forks.
    const docA = hydrateDoc(baseBytes);
    const pA = docA.get(XML_FRAGMENT_KEY, Y.XmlFragment).get(0);
    const textA = pA.get(0);
    textA.insert(textA.length, " from A");
    const updateA = encodeState(docA);

    const docB = hydrateDoc(baseBytes);
    const pB = docB.get(XML_FRAGMENT_KEY, Y.XmlFragment).get(0);
    const textB = pB.get(0);
    textB.insert(0, "[from B] ");
    const updateB = encodeState(docB);

    // Apply each other's update both ways; final state must agree.
    applyUpdate(docA, updateB);
    applyUpdate(docB, updateA);
    const finalA = docA.get(XML_FRAGMENT_KEY, Y.XmlFragment).get(0).get(0).toString();
    const finalB = docB.get(XML_FRAGMENT_KEY, Y.XmlFragment).get(0).get(0).toString();
    expect(finalA).toBe(finalB);
    expect(finalA).toContain("from A");
    expect(finalA).toContain("from B");
  });
});

describe("docFromTipTapJson (lazy backfill helper)", () => {
  // Use plain StarterKit for the test schema — every shizumu node
  // extension also goes through the same prosemirror schema mechanism,
  // so the round-trip property holds for any subset.
  const schema = getSchema([StarterKit.configure({ codeBlock: false })]);

  it("returns null for empty / non-doc input", () => {
    expect(docFromTipTapJson(schema, null)).toBeNull();
    expect(docFromTipTapJson(schema, "")).toBeNull();
    expect(docFromTipTapJson(schema, { type: "paragraph" })).toBeNull();
  });

  it("populates the XmlFragment from a TipTap JSON doc", () => {
    const json = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
        { type: "paragraph", content: [{ type: "text", text: "world" }] },
      ],
    };
    const doc = docFromTipTapJson(schema, json);
    expect(doc).not.toBeNull();
    const frag = doc.get(XML_FRAGMENT_KEY, Y.XmlFragment);
    expect(frag.length).toBe(2);
    expect(frag.get(0).nodeName).toBe("paragraph");
    expect(frag.get(1).nodeName).toBe("paragraph");
  });

  it("accepts a JSON string and parses it", () => {
    const jsonStr = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "stringified" }] }],
    });
    const doc = docFromTipTapJson(schema, jsonStr);
    expect(doc).not.toBeNull();
    const frag = doc.get(XML_FRAGMENT_KEY, Y.XmlFragment);
    expect(frag.length).toBe(1);
  });

  it("returns null on malformed JSON string rather than throwing", () => {
    const doc = docFromTipTapJson(schema, "{not json");
    expect(doc).toBeNull();
  });

  it("encoded state round-trips back to the same paragraph count", () => {
    const json = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph", content: [{ type: "text", text: "b" }] },
        { type: "paragraph", content: [{ type: "text", text: "c" }] },
      ],
    };
    const doc = docFromTipTapJson(schema, json);
    const bytes = encodeState(doc);
    const rehydrated = hydrateDoc(bytes);
    const frag = rehydrated.get(XML_FRAGMENT_KEY, Y.XmlFragment);
    expect(frag.length).toBe(3);
  });
});

describe("bytesFromTauri", () => {
  it("passes Uint8Array through unchanged", () => {
    const u = new Uint8Array([1, 2, 3]);
    expect(bytesFromTauri(u)).toBe(u);
  });

  it("converts a number[] (Tauri's JSON shape for Vec<u8>) into a Uint8Array", () => {
    const out = bytesFromTauri([42, 43, 44]);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([42, 43, 44]);
  });

  it("null and undefined both map to null (caller branches on it)", () => {
    expect(bytesFromTauri(null)).toBeNull();
    expect(bytesFromTauri(undefined)).toBeNull();
  });
});
