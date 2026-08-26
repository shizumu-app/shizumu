// Pin display helpers shared between SharedObjectsPanel, PinRow, and TrailMap.
// All three need to answer the same three questions about a pin row:
//   - what kind of block is this? (chip label)
//   - what plain text should the snippet show?
//   - what title should we render? (with a defensive guard against legacy
//     pins whose title got stored as raw JSON)

const BOARD_TYPES = new Set(["artifact", "board", "table", "file"]);

function isBoardPin(pin) {
  return BOARD_TYPES.has(pin?.object_type);
}

export function isFilePin(pin) {
  // Content first, object_type only as a fallback. Every pin-creation path
  // in TipTapEditor stamps object_type "file" for ANY attachment — image
  // ones included (`pinCategory = isAttachment ? "file" : ...`) — so the
  // stamp cannot tell a document from a picture. Trusting it made a pinned
  // image render as a 📎 file row with a filename and a byte count instead
  // of the picture. The pinned JSON knows which it is; ask that.
  const parsed = parseContent(pin);
  if (parsed && typeof parsed === "object") {
    // A pinned file is an attachment with no real text alongside it (the
    // file IS the content). This catches both a bare attachment node and
    // the inline case where it sits alone inside a paragraph, without
    // misclassifying a text board that happens to embed a file.
    const { node, hasText } = scanAttachment(parsed);
    if (node && !hasText) return true;
    // Parseable content that holds no lone file attachment is not a file
    // pin, whatever the stamp claims — an image lands here.
    return false;
  }
  // Unparseable / absent content: the stamp is all there is to go on.
  return pin?.object_type === "file";
}

/**
 * isImagePin — the picture half of the same split isFilePin draws.
 *
 * An image is an attachment too (same blob store, same table), but it is
 * not a *file pin*: a file pin renders as a 📎 chip that hands the blob to
 * the OS, whereas a pinned image should show the picture. Same rule as
 * files otherwise — the image IS the content, so an image sitting beside
 * real text is a note that happens to embed one, not an image pin.
 */
export function isImagePin(pin) {
  const parsed = parseContent(pin);
  if (!parsed || typeof parsed !== "object") return false;
  const { node, hasText } = scanImage(parsed);
  return !!node && !hasText;
}

// Walk a parsed doc/node looking for an attachment. Files are schema-inline
// now, so a pinned file is usually an attachment nested inside a paragraph
// (not a bare top-level node) — scan the tree rather than only content[0].
// Also reports whether the doc carries any real text, so callers can tell a
// pinned file (attachment + no text) from a board that merely contains one.
// An image is an attachment too (same blob store, same table), but it is
// not a *file pin*: a file pin renders as a 📎 chip that hands the blob to
// the OS, whereas a pinned image should show the picture — the same way a
// pinned localImage always did. Only non-image attachments count here.
function isFileAttachment(n) {
  return n?.type === "attachment" && n.attrs?.kind !== "image";
}

function isImageAttachment(n) {
  if (!n) return false;
  // Two node types have carried images over this schema's life: the
  // current `attachment` with kind "image", and the older standalone
  // `localImage`. Pins are frozen snapshots, so a pin captured before the
  // attachment migration still holds a localImage node — recognise both or
  // the old ones silently fall back to a text chip.
  if (n.type === "localImage") return true;
  return n.type === "attachment" && n.attrs?.kind === "image";
}

// Same walk as scanAttachment, looking for an image instead of a file.
// Kept as its own function rather than a predicate parameter so each
// caller reads as the question it is asking.
function scanImage(doc) {
  let node = null;
  let hasText = false;
  const visit = (n) => {
    if (!n) return;
    if (isImageAttachment(n)) { if (!node) node = n; return; }
    if (typeof n.text === "string" && n.text.trim()) hasText = true;
    if (Array.isArray(n.content)) n.content.forEach(visit);
  };
  visit(doc);
  return { node, hasText };
}

function scanAttachment(doc) {
  let node = null;
  let hasText = false;
  const visit = (n) => {
    if (!n) return;
    if (isFileAttachment(n)) { if (!node) node = n; return; }
    if (typeof n.text === "string" && n.text.trim()) hasText = true;
    if (Array.isArray(n.content)) n.content.forEach(visit);
  };
  visit(doc);
  return { node, hasText };
}

// Parse the attachment node out of a file pin's content. Returns null on
// any failure so callers can fall back to a generic render rather than
// hiding the row entirely.
export function attachmentMetaOf(pinContent) {
  try {
    const doc = typeof pinContent === "string" ? JSON.parse(pinContent) : pinContent;
    const { node } = scanAttachment(doc);
    if (!node) return null;
    return {
      blob_hash: node.attrs?.blob_hash || null,
      filename: node.attrs?.filename || "untitled",
      mime_type: node.attrs?.mime_type || null,
      size_bytes: node.attrs?.size_bytes || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Parse the image node out of an image pin's content, so the row can
 * resolve its blob and show the picture. Mirrors attachmentMetaOf; returns
 * null on any failure so callers fall back to a generic render rather than
 * hiding the row.
 */
export function imageMetaOf(pinContent) {
  try {
    const doc = typeof pinContent === "string" ? JSON.parse(pinContent) : pinContent;
    const { node } = scanImage(doc);
    if (!node) return null;
    return {
      blob_hash: node.attrs?.blob_hash || node.attrs?.src || null,
      filename: node.attrs?.filename || "image",
      mime_type: node.attrs?.mime_type || null,
      size_bytes: node.attrs?.size_bytes || 0,
    };
  } catch {
    return null;
  }
}

function looksLikeJSON(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 2) return false;
  const c = t[0];
  return c === "{" || c === "[";
}

function parseContent(pin) {
  if (!pin) return null;
  if (typeof pin.content !== "string") return pin.content || null;
  try { return JSON.parse(pin.content); } catch { return null; }
}

// Plain text walker. Handles three content shapes pins can be stored in:
//   - doc wrapper:  { type: "doc", content: [...] }
//   - bare node:    { type: "list" | "blockquote" | ..., content: [...] }
//   - plain string: a note's raw text
// Returns "" rather than the raw JSON string when extraction fails — the
// caller never wants JSON in the UI.
export function pinPlainText(pin) {
  if (!pin) return "";
  const parsed = parseContent(pin);
  if (parsed && typeof parsed === "object") {
    let out = "";
    const visit = (n) => {
      if (!n) return;
      if (typeof n.text === "string") { out += n.text; return; }
      if (Array.isArray(n.content)) {
        for (let i = 0; i < n.content.length; i++) {
          visit(n.content[i]);
          if (i < n.content.length - 1) out += " ";
        }
      }
    };
    visit(parsed);
    return out.trim();
  }
  if (typeof pin.content === "string" && !looksLikeJSON(pin.content)) {
    return pin.content;
  }
  return "";
}

/**
 * Everything about a pin a search box should be able to match.
 *
 * Deliberately WIDER than pinPlainText: that one feeds the row's snippet
 * line, where a block title would just duplicate the title above it, while
 * this one feeds matching, where the title is often the only word the user
 * remembers. Same widening the FTS indexer got on the Rust side (see
 * `search.rs`), for the same reason — a title is a node ATTRIBUTE
 * (`attrs.blockTitle`), not a text node, so a text-only walk cannot see it.
 *
 * Also includes the pin's own row title and any attachment filename, and
 * — unlike the copy this replaced in Memory.svelte — never falls back to
 * the raw JSON string, which made schema keys like "paragraph" matchable.
 *
 * @param {any} pin
 * @returns {string} the haystack to match against; "" when there is nothing.
 */
export function pinSearchText(pin) {
  if (!pin) return "";
  const parts = [];
  const rowTitle = typeof pin.title === "string" ? pin.title.trim() : "";
  if (rowTitle && !looksLikeJSON(rowTitle)) parts.push(rowTitle);

  const parsed = parseContent(pin);
  if (parsed && typeof parsed === "object") {
    const visit = (n) => {
      if (!n) return;
      if (typeof n.text === "string") parts.push(n.text);
      const attrs = n.attrs;
      if (attrs && typeof attrs === "object") {
        for (const key of ["blockTitle", "filename", "alt"]) {
          const v = attrs[key];
          if (typeof v === "string" && v.trim()) parts.push(v.trim());
        }
      }
      if (Array.isArray(n.content)) n.content.forEach(visit);
    };
    visit(parsed);
  } else if (typeof pin.content === "string" && !looksLikeJSON(pin.content)) {
    parts.push(pin.content);
  }
  return parts.join(" ").trim();
}

/**
 * Which modal a pin should open in: the rich artifact editor, or the
 * plain-text note editor.
 *
 * This lived twice, as a hardcoded object_type list in each surface, and
 * the two had drifted — SharedObjectsPanel counted "file" as a board,
 * Memory did not. So the same pin opened the artifact modal from the panel
 * and the NOTE modal from memory, and the note modal renders `pin.content`
 * straight into a <textarea>. For any pin whose content is a doc, that is
 * a wall of raw JSON where the content should be. A pinned image showed
 * its own attachment attrs as text.
 *
 * The rule is the content's SHAPE, not the object_type stamp. A doc needs
 * a doc renderer; only content that really is a plain string belongs in a
 * textarea. That also fixes a note stored as a serialized doc, which
 * TipTapEditor produces on one of its two creation paths.
 *
 * @param {any} pin
 * @returns {"artifact"|"note"}
 */
export function pinModalKind(pin) {
  if (!pin) return "note";
  if (isBoardPin(pin)) return "artifact";
  const parsed = parseContent(pin);
  return parsed && typeof parsed === "object" ? "artifact" : "note";
}

// One-word kind tag for the chip column.
//   notes              -> text
//   list / taskList    -> tasks
//   list / orderedList -> numbered
//   list (other)       -> list
//   blockquote         -> outline
//   qaBlock            -> q&a
//   table              -> table
//   recipeBlock        -> recipe
//   decisionBlock      -> decision
//   codeBlock          -> code
//   chart              -> flowchart | mindmap | timeline (by kind attr)
//   multi-node board   -> board
export function pinKind(pin) {
  if (isImagePin(pin)) return "image";
  if (isFilePin(pin)) return "file";
  if (!isBoardPin(pin)) return "text";
  const parsed = parseContent(pin);
  if (!parsed || typeof parsed !== "object") return "board";
  const nodes = parsed.type === "doc" ? (parsed.content || []) : [parsed];
  if (nodes.length === 0) return "board";
  if (nodes.length > 1) return "board";
  const n = nodes[0];
  if (!n) return "board";
  if (isImageAttachment(n)) return "image";
  if (isFileAttachment(n)) return "file";
  if (n.type === "table") return "table";
  if (n.type === "qaBlock") return "q&a";
  if (n.type === "blockquote") return "outline";
  if (n.type === "recipeBlock" || n.type === "algorithmBlock") return "recipe";
  if (n.type === "decisionBlock") return "decision";
  if (n.type === "codeBlock") return "code";
  if (n.type === "chart") {
    const kind = n.attrs?.kind;
    if (kind === "flowchart" || kind === "mindmap" || kind === "timeline") return kind;
    return "chart";
  }
  if (n.type === "taskList") return "tasks";
  if (n.type === "orderedList") return "numbered";
  if (n.type === "bulletList") return "list";
  if (n.type === "list") {
    const marker = n.content?.[0]?.attrs?.marker;
    if (marker === "task") return "tasks";
    if (marker === "ordered") return "numbered";
    return "list";
  }
  return "board";
}

// Family taxonomy — groups the 13+ kinds returned by pinKind into 6 buckets
// for the panel's type filter and the per-row chip color. `null` means
// "no specific family" (multi-node board fallback shows in 'all' only).
const KIND_FAMILY_MAP = {
  text: "text",
  tasks: "lists",
  numbered: "lists",
  list: "lists",
  outline: "structure",
  "q&a": "structure",
  recipe: "structure",
  decision: "structure",
  table: "structure",
  chart: "charts",
  flowchart: "charts",
  mindmap: "charts",
  timeline: "charts",
  code: "code",
  file: "files",
  // Images ride in the "files" bucket rather than spawning a seventh
  // family: the panel's type filter offers six fixed controls, and an
  // image is an attachment — it belongs with the other ones.
  image: "files",
};

export function kindToFamily(kind) {
  if (kind == null) return null;
  return KIND_FAMILY_MAP[kind] ?? null;
}

export function pinFamily(pin) {
  return kindToFamily(pinKind(pin));
}

// nodeKind — companion to pinKind that consumes a live ProseMirror Node
// directly. Used by the per-block type chip in the editor and by any
// future code that needs to label a node's kind without serializing it
// to a pin first.
export function nodeKind(node) {
  if (!node || !node.type) return null;
  const t = node.type.name;
  // Same split as isFileAttachment, against a live ProseMirror node.
  // Deliberately null for an image: the in-editor block-type chip labels
  // block KINDS, and an image needs no label to say what it is. This is
  // the editor chip, not the pin row — the pin panel does distinguish
  // images (pinKind returns "image"), because a row has no picture in it
  // to speak for itself until the row renders one.
  if (t === "attachment") return node.attrs?.kind === "image" ? null : "file";
  if (t === "table") return "table";
  if (t === "qaBlock") return "q&a";
  if (t === "blockquote") return "outline";
  if (t === "recipeBlock" || t === "algorithmBlock") return "recipe";
  if (t === "decisionBlock") return "decision";
  if (t === "codeBlock") return "code";
  if (t === "chart") {
    const kind = node.attrs?.kind;
    if (kind === "flowchart" || kind === "mindmap" || kind === "timeline") return kind;
    return "chart";
  }
  if (t === "list") {
    const marker = node.content?.firstChild?.attrs?.marker;
    if (marker === "task") return "tasks";
    if (marker === "ordered") return "numbered";
    return "list";
  }
  return null;
}

export function nodeFamily(node) {
  return kindToFamily(nodeKind(node));
}

// Defensive title. Strips JSON-shaped legacy titles; falls back to the
// first line of plain text. Returns null when nothing readable exists
// (callers render an "untitled" affordance).
export function pinDisplayTitle(pin, { maxLen = 60 } = {}) {
  const raw = (pin?.title || "").trim();
  if (raw && !looksLikeJSON(raw)) {
    return raw.length > maxLen ? raw.slice(0, maxLen) + "…" : raw;
  }
  const plain = pinPlainText(pin);
  if (plain) {
    const firstLine = plain.split("\n")[0].trim();
    if (firstLine) return firstLine.length > maxLen ? firstLine.slice(0, maxLen) + "…" : firstLine;
  }
  return null;
}

// One-line elided snippet for the row's second line. Same first-line rule
// as the title fallback, but always derived from content (never the title)
// so the snippet doesn't duplicate the title text.
export function pinSnippet(pin, { maxLen = 80 } = {}) {
  const plain = pinPlainText(pin);
  if (!plain) return "";
  const firstLine = plain.split("\n")[0].trim();
  if (!firstLine) return "";
  return firstLine.length > maxLen ? firstLine.slice(0, maxLen) + "…" : firstLine;
}
