// Y.Doc lifecycle helpers for continuous-trail pages.
//
// Continuous trails store their prose as a Yjs CRDT — `pages.yjs_state`
// (backend column from migration 019) is the source of truth, and the
// TipTap doc JSON we still persist in `pages.content_json` is a derived
// snapshot used for FTS and legacy readers.
//
// The TipTap editor binds to a Y.Doc via @tiptap/extension-collaboration
// (a thin wrapper around y-prosemirror). The Y.Doc holds an XmlFragment
// keyed on `XML_FRAGMENT_KEY` below — this is the same key the
// Collaboration extension's `fragment` config option points at. Keep
// them in lockstep or the editor and the persisted state will drift.
//
// The Rust side (src-tauri/src/sync/yjs.rs) decodes / re-encodes these
// bytes using the yrs crate. yjs (this side) and yrs (Rust) share the
// same wire format (v2 update encoding) so they round-trip cleanly.

import * as Y from "yjs";
import { prosemirrorJSONToYXmlFragment } from "y-prosemirror";

// XmlFragment key shared with the @tiptap/extension-collaboration
// `fragment` option. Don't rename without changing both call sites at
// once — a key mismatch produces a silently empty editor.
export const XML_FRAGMENT_KEY = "prosemirror";

/// Build a fresh Y.Doc with the XmlFragment slot the collaboration
/// extension expects. Used when a continuous-trail page has no prior
/// yjs_state yet (the page is brand new or the backfill hasn't run).
export function createDoc() {
  const doc = new Y.Doc();
  // Eagerly materialise the fragment so the editor's binding has a
  // node to attach to on first render. Without this, the editor mounts
  // empty and only gets content after the first edit.
  doc.get(XML_FRAGMENT_KEY, Y.XmlFragment);
  return doc;
}

/// Hydrate a Y.Doc from persisted v2-update bytes. Used on page open
/// when `pages.yjs_state` is non-null. Returns a fresh Doc if the
/// bytes are empty / null so callers don't have to branch.
///
/// @param {Uint8Array | number[] | null | undefined} bytes
export function hydrateDoc(bytes) {
  const doc = createDoc();
  if (!bytes || (bytes.length ?? 0) === 0) return doc;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  Y.applyUpdateV2(doc, u8);
  return doc;
}

/// Encode a Y.Doc's full state as v2 update bytes. This is what the
/// save command sends to the backend. v2 (not v1) because the Rust
/// side uses `Update::decode_v2` — wire formats must match.
///
/// Returns a `Uint8Array` ready to pass through Tauri's invoke. Tauri
/// will JSON-encode the byte array as a number array on the wire,
/// then the Rust side gets it back as `Vec<u8>`.
///
/// @param {Y.Doc} doc
/// @returns {Uint8Array}
export function encodeState(doc) {
  return Y.encodeStateAsUpdateV2(doc);
}

/// Apply a remote v2 update to an existing Y.Doc. Used by the (future)
/// SSE-driven live-update pipeline to fold a peer's edits in without
/// going through the full save / open cycle. The CRDT property means
/// applying out of order produces the same final state.
///
/// @param {Y.Doc} doc
/// @param {Uint8Array | number[]} updateBytes
export function applyUpdate(doc, updateBytes) {
  const u8 = updateBytes instanceof Uint8Array ? updateBytes : new Uint8Array(updateBytes);
  Y.applyUpdateV2(doc, u8);
}

/// Convert a Tauri-returned BLOB (number[] or Uint8Array or null) into
/// the shape `hydrateDoc` expects. Tauri's JSON encoder turns a Rust
/// `Vec<u8>` into a JS `number[]`; this helper papers over that detail
/// at the boundary.
///
/// @param {unknown} value
/// @returns {Uint8Array | null}
export function bytesFromTauri(value) {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value);
  return null;
}

/// One-shot lazy backfill: build a Y.Doc with its XmlFragment populated
/// from a TipTap JSON snapshot. Used on a continuous-trail page's first
/// open under `enable_yjs` when `yjs_state` was still NULL — the
/// existing content_json is the only source of truth, so we derive the
/// Y.Doc from it rather than mounting the editor empty.
///
/// Returns null when `json` is empty / null / not an object (caller
/// falls back to a fresh empty Y.Doc).
///
/// @param {import('@tiptap/pm/model').Schema} schema
/// @param {object | string | null} json
/// @returns {Y.Doc | null}
export function docFromTipTapJson(schema, json) {
  if (!json) return null;
  const parsed = typeof json === "string" ? safeParse(json) : json;
  if (!parsed || typeof parsed !== "object" || parsed.type !== "doc") return null;
  const doc = createDoc();
  const fragment = doc.get(XML_FRAGMENT_KEY, Y.XmlFragment);
  // y-prosemirror's helper walks the prosemirror JSON via the supplied
  // schema and inserts equivalent Y.Xml nodes into the fragment.
  // Idempotent on an empty fragment; we only call it on a fresh doc.
  prosemirrorJSONToYXmlFragment(schema, parsed, fragment);
  return doc;
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
