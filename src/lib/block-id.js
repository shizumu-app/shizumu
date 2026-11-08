// A LASTING ID ON EVERY BLOCK (0.8.2).
//
// Every block of a pinnable type carries `attrs.blockId`, a short string that
// stays with the block across edits, saves, reloads, sync and export. It is
// the base everything after v1 points at: a decision linking the question it
// closes, a board card that is the live block, an embedding per block.
// docs/superpowers/specs/2026-11-01-block-ids-and-meaning-design.md.
//
// Two kinds of id, and why there are two.
//
//   NEW ids  — `newBlockId()`, 12 base-36 characters from
//   crypto.getRandomValues. A block made in the editor (a split, a paste, a
//   slash insert) gets one from the BlockId extension's appendTransaction.
//
//   DERIVED ids — `derivedBlockId(pageId, path)`, "d" + base-36 of cyrb53 over
//   `pageId + ":" + path.join(".")`. A page saved before 0.8.2 has no ids, and
//   giving it new random ones on open would either save the page just because
//   it was opened (the d0604141 failure: a load that writes) or show different
//   ids on every open of a read-only past page. A derived id is the same on
//   every load, on every device, and in export code that never runs an editor;
//   the next real save persists it, after which it is an ordinary id.
//
// THE PATH is the block's child-index path from the doc: the third top-level
// block is [2]; the first paragraph inside the second item of that list is
// [2, 1, 0]. It is computed on the doc AS THE EDITOR HOLDS IT, so code reading
// content_json outside the editor runs the editor's own load-time migrations
// first (EditorCore: migrateListSchema, migrateRecipeSchema, migrateQASchema)
// and then calls `fillDerivedBlockIds`.
//
// cyrb53 hashes UTF-16 code units (`charCodeAt`), so a port to another
// language must hash the same units, not UTF-8 bytes. The test file pins
// vectors for that.
//
// CLAUDE.md: decisions live in pure modules. Nothing here touches an editor.

import { PINNABLE_TYPES } from "./extensions/pin-id.js";

/** The node types that carry a blockId — the same list as pinId. */
export const BLOCK_ID_TYPES = PINNABLE_TYPES;

const BLOCK_ID_SET = new Set(BLOCK_ID_TYPES);

/** @param {string} typeName */
export function carriesBlockId(typeName) {
  return BLOCK_ID_SET.has(typeName);
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const NEW_ID_LENGTH = 12;

/**
 * A fresh id: 12 base-36 characters, uniformly drawn (bytes of 252 and up
 * are rejected so no character is likelier than another).
 * @param {(buf: Uint8Array) => Uint8Array} [fill]  defaults to crypto.getRandomValues
 * @returns {string}
 */
export function newBlockId(fill = (buf) => globalThis.crypto.getRandomValues(buf)) {
  let out = "";
  while (out.length < NEW_ID_LENGTH) {
    const bytes = fill(new Uint8Array(NEW_ID_LENGTH * 2));
    for (let i = 0; i < bytes.length && out.length < NEW_ID_LENGTH; i++) {
      if (bytes[i] < 252) out += ALPHABET[bytes[i] % 36];
    }
  }
  return out;
}

/**
 * cyrb53 (bryc, public domain): a 53-bit hash, exact in a JS number.
 * @param {string} str  @param {number} [seed]  @returns {number}
 */
export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * The id a block saved without one has on this page at this path.
 * @param {string} pageId  @param {number[]} path  @param {number} [salt]
 *   0 normally; 1, 2… only when the plain id is already taken in the doc
 * @returns {string}
 */
export function derivedBlockId(pageId, path, salt = 0) {
  const key = `${pageId}:${path.join(".")}` + (salt ? `#${salt}` : "");
  return "d" + cyrb53(key).toString(36);
}

// ── Walking a doc ──────────────────────────────────────────────────────────
//
// One walk serves both shapes, a live ProseMirror node and plain JSON, so a
// path means the same thing to the editor and to export code. It visits
// every node, in document order, with its path; ProseMirror nodes also get
// their position. A textblock's children are inline and never carry an id,
// so the ProseMirror walk does not enter them (a 50k-word doc is walked on
// every edit; its words are not).

function isPmNode(node) {
  return node && typeof node === "object" && typeof node.forEach === "function" && node.type && typeof node.type === "object";
}

/**
 * @param {any} doc  a ProseMirror doc node or a JSON doc
 * @param {(node: any, path: number[], pos: number|null, typeName: string, id: any) => void} visit
 */
export function walkBlocks(doc, visit) {
  if (!doc || typeof doc !== "object") return;
  if (isPmNode(doc)) {
    const walkPm = (parent, contentStart, prefix) => {
      if (parent.isTextblock || parent.isLeaf) return;
      parent.forEach((child, offset, index) => {
        const pos = contentStart + offset;
        const path = [...prefix, index];
        visit(child, path, pos, child.type.name, child.attrs?.blockId ?? null);
        walkPm(child, pos + 1, path);
      });
    };
    walkPm(doc, 0, []);
    return;
  }
  const walkJson = (parent, prefix) => {
    if (!Array.isArray(parent.content)) return;
    parent.content.forEach((child, index) => {
      if (!child || typeof child !== "object") return;
      const path = [...prefix, index];
      visit(child, path, null, child.type, child.attrs?.blockId ?? null);
      walkJson(child, path);
    });
  };
  walkJson(doc, []);
}

function isEmptyNode(node) {
  if (!node) return true;
  if (typeof node.content?.size === "number") return node.content.size === 0;
  return !(Array.isArray(node.content) && node.content.length > 0);
}

/**
 * The fixes that leave every id-carrying block with an id of its own: a
 * block with none gets one, and of several blocks sharing an id one keeps it
 * and the rest get new ones.
 *
 * Who keeps a shared id: `prefer(id)` may name the position of the block
 * that already had it (the editor maps the old position through the edit,
 * so pasting a copy ABOVE the original does not take the original's id);
 * otherwise the first in document order keeps it.
 *
 * One exception to the preferred block: when it is now EMPTY and another
 * block holding the id is not, the one with the words keeps it. That is
 * Enter at the start of a paragraph — ProseMirror splits it into an empty
 * block (at the original's position) and the paragraph's text below it,
 * both carrying the attrs. The id belongs with the text the writer wrote,
 * not with the blank line that pushed it down.
 *
 * @param {any} doc
 * @param {object} opts
 * @param {(path: number[], salt: number) => string} opts.makeId
 * @param {(id: string) => (number|null)} [opts.prefer]
 * @returns {Array<{pos: number|null, path: number[], id: string}>}
 */
export function planBlockIds(doc, { makeId, prefer = () => null }) {
  const blocks = [];
  const counts = new Map();
  walkBlocks(doc, (node, path, pos, typeName, id) => {
    if (!carriesBlockId(typeName)) return;
    const has = typeof id === "string" && id.length > 0;
    blocks.push({ path, pos, id: has ? id : null, empty: isEmptyNode(node) });
    if (has) counts.set(id, (counts.get(id) || 0) + 1);
  });

  const taken = new Set(counts.keys());
  const keeper = new Map();
  for (const [id, n] of counts) {
    if (n < 2) continue;
    const pos = prefer(id);
    let preferred = pos == null ? null : blocks.find((b) => b.id === id && b.pos === pos);
    if (preferred?.empty) preferred = blocks.find((b) => b.id === id && !b.empty) ?? preferred;
    keeper.set(id, preferred ?? blocks.find((b) => b.id === id));
  }

  const fixes = [];
  for (const b of blocks) {
    if (b.id !== null && (!keeper.has(b.id) || keeper.get(b.id) === b)) continue;
    let salt = 0;
    let id = makeId(b.path, salt);
    while (taken.has(id)) id = makeId(b.path, ++salt);
    taken.add(id);
    fixes.push({ pos: b.pos, path: b.path, id });
  }
  return fixes;
}

/**
 * The load-time fixes: derived ids for blocks saved without one (and for a
 * stored duplicate), the same on every load of the same page.
 * @param {any} doc  @param {string} pageId
 * @returns {Array<[number|null, string]>}  [pos, id] pairs (pos is null for JSON)
 */
export function assignBlockIds(doc, pageId) {
  return planBlockIds(doc, { makeId: (path, salt) => derivedBlockId(pageId, path, salt) })
    .map((f) => [f.pos, f.id]);
}

/**
 * The edit-time fixes: new ids for blocks that arrived without one (a split's
 * second half, a pasted or carried-forward block) and for a duplicate.
 * @param {any} doc
 * @param {{makeId?: () => string, prefer?: (id: string) => (number|null)}} [opts]
 * @returns {Array<[number|null, string]>}
 */
export function dedupeBlockIds(doc, { makeId = () => newBlockId(), prefer } = {}) {
  return planBlockIds(doc, { makeId: () => makeId(), prefer }).map((f) => [f.pos, f.id]);
}

/**
 * `json` with every id-carrying block given an id: the derived id where a
 * block has none, exactly as the editor gives it on load. For code that reads
 * content_json without an editor (export). Run the editor's load migrations
 * first (see the header). The input is not mutated.
 * @param {any} json  a JSON doc  @param {string} pageId  @returns {any}
 */
export function fillDerivedBlockIds(json, pageId) {
  if (!json || typeof json !== "object") return json;
  const fixes = planBlockIds(json, { makeId: (path, salt) => derivedBlockId(pageId, path, salt) });
  if (fixes.length === 0) return json;
  const byPath = new Map(fixes.map((f) => [f.path.join("."), f.id]));
  const rebuild = (node, prefix) => {
    if (!Array.isArray(node.content)) return node;
    let changed = false;
    const content = node.content.map((child, index) => {
      if (!child || typeof child !== "object") return child;
      const path = [...prefix, index];
      let next = rebuild(child, path);
      const id = byPath.get(path.join("."));
      if (id) next = { ...next, attrs: { ...(next.attrs || {}), blockId: id } };
      if (next !== child) changed = true;
      return next;
    });
    return changed ? { ...node, content } : node;
  };
  return rebuild(json, []);
}

/**
 * `json` without any blockId: content that enters a page as a NEW block (a
 * carried-forward pin, a pasted block copy, a cloned page) must not bring the
 * id of the block it was copied from. The editor gives it a new one when it
 * lands. Accepts a node, a doc or an array. The input is not mutated.
 * @param {any} json  @returns {any}
 */
export function stripBlockIdsFromJSON(json) {
  if (!json || typeof json !== "object") return json;
  if (Array.isArray(json)) return json.map(stripBlockIdsFromJSON);
  const out = { ...json };
  if (out.attrs && "blockId" in out.attrs) {
    const { blockId, ...rest } = out.attrs; // eslint-disable-line no-unused-vars
    out.attrs = rest;
  }
  if (Array.isArray(out.content)) out.content = out.content.map(stripBlockIdsFromJSON);
  return out;
}
