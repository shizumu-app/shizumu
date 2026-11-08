// TipTap doc → markdown serializer for the v0.3 trail-folder export.
//
// Three public entry points:
//   serializePage({ page, lineage, lineagePath, pins })  -> string  (per-page .md)
//   serializeTrail({ lineage, parent })                  -> string  (_trail.md)
//   serializeReadme({ summary })                         -> string  (top-level README.md)
//
// The serializer is pure: no DOM, no Tauri, no DB. The Rust side enumerates
// rows, shapes the input, and calls these functions over IPC. The parse
// counterpart lives in `parse.js` and is exercised by `round-trip.test.js`.
//
// Format contract: see docs/superpowers/specs/2026-05-19-trail-folder-export-design.md.
// In short: YAML frontmatter carries page/trail/pin metadata; body markdown is
// renderable in any tool.
//
// FORMAT 2 (0.8.2): a block that means more than its words gets one HTML
// comment line right before it, which every markdown renderer hides:
//
//   <!-- shizumu block id=<blockId> kind=<kind> state=<state> at=<date> pin=<pinId> -->
//
// "Means more" is: it carries a pin, a stored state (a decision), or a
// non-prose kind (decision, qa, recipe, table, chart, code). Keys are left
// out when empty. Plain paragraphs, headings, lists and quotes without a pin
// get no line, so a raw export still reads as prose. `at` is the date the
// state last changed (blockStateAt), kept so a round trip does not lose it.
// A qa block with an unanswered question says `state=open`; that state is
// computed from the words, never stored, so parse.js does not read it back.
// Format 1 wrote a pin as `<!-- shizumu:pin:<id> -->` on a line of its own;
// parse.js still reads that.
//
// Ids: a page saved before 0.8.2 has none stored. The serializer gives every
// block the id the editor shows for it (the editor's load migrations, then
// fillDerivedBlockIds), so the id in the file is the id on screen.
// docs/superpowers/specs/2026-11-01-block-ids-and-meaning-design.md,
// "Export carries meaning".

import { assembleMermaid } from "../extensions/chart.js";
import { migrateListSchema } from "../extensions/migrate-list-schema.js";
import { migrateRecipeSchema } from "../extensions/migrate-recipe-schema.js";
import { migrateQASchema } from "../extensions/migrate-qa-schema.js";
import { fillDerivedBlockIds } from "../block-id.js";
import { carriesState, stateOf, isOpenQuestion } from "../block-state.js";

// The `shizumu:` key names the export LAYOUT (trail folders, _trail.md,
// README), which is unchanged; `format:` names the page file's body format.
const FORMAT_VERSION = 1;
export const PAGE_FORMAT = 2;

// ──────────────────────────────────────────────────────────────────────────
// Public entry points
// ──────────────────────────────────────────────────────────────────────────

/**
 * One page as a markdown file.
 *
 * `blockLines`:
 * - `true` (a page file): every block line, ids and pins included.
 * - `"clipboard"` (the editor's markdown clipboard): a line only on a block
 *   that carries a state, and only its kind, state and date. A copied
 *   selection is not a page: another app should get the writing, and a
 *   paste is a new block, so it gets no id and binds no pin. The state is
 *   meaning, though, and without it a cut superseded decision came back
 *   standing.
 * - `false`: no lines, no ids (a pin's own content in frontmatter).
 */
export function serializePage({ page, lineage = null, lineagePath = null, pins = [], blockLines = true }) {
  const doc = pageDocAsLoaded(parseContentJson(page.content_json), blockLines === true ? page.id : null);
  const knownPinIds = new Set(pins.map((p) => p.id));
  const body = docToMarkdown(doc, { knownPinIds, blockLines });

  const fm = {
    shizumu: FORMAT_VERSION,
    format: PAGE_FORMAT,
    page_id: page.id,
    lineage_id: lineage?.id || null,
    lineage_path: lineagePath || null,
    date: page.date,
    page_number: page.page_number,
    focus: page.what_matters_now || null,
    created_at: page.created_at,
    updated_at: page.updated_at,
    pins: pins.length > 0 ? pins.map((p) => serializePinEntry(p)) : null,
  };

  return yamlFrontmatter(fm) + body + (body.endsWith("\n") ? "" : "\n");
}

export function serializeTrail({ lineage, parent = null }) {
  const fm = {
    shizumu: FORMAT_VERSION,
    kind: "trail",
    lineage_id: lineage.id,
    parent_id: parent?.id || null,
    mode: lineage.mode || "discrete",
    name: lineage.name,
    created_at: lineage.created_at,
  };
  return yamlFrontmatter(fm) + `# ${escapeMarkdown(lineage.name)}\n`;
}

export function serializeReadme({ summary }) {
  const fm = {
    shizumu: FORMAT_VERSION,
    kind: "export",
    exported_at: summary.exported_at,
    page_count: summary.page_count,
    trail_count: summary.trail_count,
    image_count: summary.image_count,
    shizumu_version: summary.shizumu_version,
  };
  const headline = `shizumu export — ${summary.page_count} pages across ${summary.trail_count} trails — ${summary.exported_at?.slice(0, 10) || ""}`;
  return yamlFrontmatter(fm) + `# ${headline}\n`;
}

// ──────────────────────────────────────────────────────────────────────────
// Pin frontmatter entry
// ──────────────────────────────────────────────────────────────────────────

function serializePinEntry(pin) {
  const scope = pin.lineage_id ? "trail" : "global";
  const entry = {
    id: pin.id,
    object_type: pin.object_type || "notes",
    title: pin.title || null,
    auto_insert: !!pin.auto_insert,
    scope,
    position: pin.position ?? 0,
  };
  // Pin content can diverge from the source-page block (cross-page edits,
  // orphaned pins). Carry the pin's own content as a literal block scalar
  // so the importer treats the pin as authoritative.
  const content = pinContentToMarkdown(pin.content);
  if (content) entry.content = { __yaml_literal__: content };
  return entry;
}

function pinContentToMarkdown(raw) {
  if (!raw) return "";
  // Pins are stored as a JSON-stringified TipTap doc OR a bare node OR
  // plain text. Accept all three; never let raw JSON leak into the file.
  if (typeof raw === "object") return docToMarkdown(raw, { knownPinIds: new Set(), blockLines: false }).trimEnd();
  if (typeof raw !== "string") return "";
  const t = raw.trim();
  if (t.length >= 2 && (t[0] === "{" || t[0] === "[")) {
    try {
      const parsed = JSON.parse(t);
      return docToMarkdown(parsed, { knownPinIds: new Set(), blockLines: false }).trimEnd();
    } catch {
      // fall through — treat as plain text
    }
  }
  return raw.trimEnd();
}

// ──────────────────────────────────────────────────────────────────────────
// Doc walker
// ──────────────────────────────────────────────────────────────────────────

function parseContentJson(content_json) {
  if (!content_json) return { type: "doc", content: [] };
  if (typeof content_json === "object") return content_json;
  try {
    const parsed = JSON.parse(content_json);
    if (parsed && parsed.type === "doc") return parsed;
    if (parsed && typeof parsed.type === "string") return { type: "doc", content: [parsed] };
    return { type: "doc", content: [] };
  } catch {
    return { type: "doc", content: [] };
  }
}

/**
 * The doc as the editor holds it after a load: its load migrations, then
 * the derived id for any block saved without one. Without a page id the ids
 * are left alone (a clipboard selection is not a page).
 */
export function pageDocAsLoaded(doc, pageId) {
  const migrated = migrateQASchema(migrateRecipeSchema(migrateListSchema(doc)));
  return pageId ? fillDerivedBlockIds(migrated, pageId) : migrated;
}

function docToMarkdown(doc, ctx) {
  if (!doc) return "";
  const nodes = doc.type === "doc" ? doc.content || [] : [doc];
  const out = [];
  for (const n of nodes) {
    const md = serializeBlock(n, ctx);
    if (md != null && md !== "") out.push(md);
  }
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ──────────────────────────────────────────────────────────────────────────
// Block-level serializers
// ──────────────────────────────────────────────────────────────────────────

function serializeBlock(node, ctx) {
  if (!node || !node.type) return "";

  // Anchor + block-title preamble (applies to anything with these attrs).
  const preamble = blockPreamble(node, ctx);

  let body = "";
  switch (node.type) {
    case "paragraph":     body = renderParagraph(node, ctx); break;
    case "heading":       body = renderHeading(node, ctx); break;
    case "blockquote":    body = renderBlockquote(node, ctx); break;
    case "list":          body = renderList(node, ctx); break;
    case "table":         body = renderTable(node, ctx); break;
    case "codeBlock":     body = renderCodeBlock(node, ctx); break;
    case "chart":         body = renderChart(node, ctx); break;
    case "recipeBlock":   body = renderRecipe(node, ctx); break;
    case "decisionBlock": body = renderDecision(node, ctx); break;
    case "qaBlock":       body = renderQABlock(node, ctx); break;
    case "qaPair":        body = renderQAPair(node, ctx); break;
    case "dayMarker":     body = renderDayMarker(node, ctx); break;
    case "horizontalRule": body = "---"; break;
    default:
      // Unknown block: drop silently. Spec is explicit that pinId mark and
      // unrecognized decoration are stripped — we extend this to any future
      // node type the serializer doesn't know.
      body = "";
  }
  return preamble + body;
}

function blockPreamble(node, ctx) {
  const parts = [];
  if (ctx.blockLines && !ctx.inCell) {
    const line = ctx.blockLines === "clipboard" ? clipboardBlockLine(node) : blockLine(node, ctx.knownPinIds);
    if (line) parts.push(line);
  }
  const title = node.attrs?.blockTitle;
  if (title && String(title).trim()) {
    parts.push(`**${escapeMarkdown(String(title).trim())}**`);
  }
  return parts.length === 0 ? "" : parts.join("\n") + "\n";
}

/** The kind a block line names, for the types that are not prose. */
export const BLOCK_LINE_KINDS = Object.freeze({
  decisionBlock: "decision",
  qaBlock: "qa",
  recipeBlock: "recipe",
  table: "table",
  chart: "chart",
  codeBlock: "code",
  // An attachment is an inline node in today's schema, so it never stands
  // as a block of its own; the entry is here so a block-level one would
  // be named the day it exists.
  attachment: "attachment",
});

// A value goes into the line only when it cannot break the line: no space,
// no `-->`. Ids are base-36 and pin ids are uuids, so this only ever drops
// a value something else wrote by hand.
const SAFE_VALUE = /^[A-Za-z0-9_.:-]+$/;

/**
 * The `<!-- shizumu block … -->` line for a block, or null when the block is
 * plain prose with no pin. Pure; exported for tests.
 * @param {any} node  a JSON block
 * @param {Set<string>} [knownPinIds]  pins this page is the source of; any
 *   other pinId on a block is a stale mark and is not written
 * @returns {string|null}
 */
export function blockLine(node, knownPinIds = new Set()) {
  if (!node || !node.type) return null;
  const type = node.type;
  const kind = BLOCK_LINE_KINDS[type] || null;
  const pinId = node.attrs?.pinId;
  const pin = pinId && knownPinIds.has(pinId) ? pinId : null;
  let state = null;
  let at = null;
  if (carriesState(type)) {
    state = stateOf(type, node.attrs?.blockState);
    at = node.attrs?.blockStateAt || null;
  } else if (type === "qaBlock" && (node.content || []).some((pair) => isOpenQuestion(pair))) {
    state = "open";
  }
  if (!kind && !pin && !state) return null;
  const keys = [
    ["id", node.attrs?.blockId],
    ["kind", kind],
    ["state", state],
    ["at", at],
    ["pin", pin],
  ];
  const parts = keys
    .filter(([, v]) => typeof v === "string" && SAFE_VALUE.test(v))
    .map(([k, v]) => `${k}=${v}`);
  return `<!-- shizumu block${parts.length ? " " + parts.join(" ") : ""} -->`;
}

/**
 * The clipboard's block line: kind, state and date, on a block that carries
 * a state, and nothing else (see serializePage's `blockLines`). Pure.
 * @param {any} node
 * @returns {string|null}
 */
export function clipboardBlockLine(node) {
  if (!node || !carriesState(node.type)) return null;
  const line = blockLine({ ...node, attrs: { ...(node.attrs || {}), blockId: null, pinId: null } });
  return line;
}

function renderParagraph(node, ctx) {
  return renderInline(node.content || [], ctx);
}

function renderHeading(node, ctx) {
  const level = Math.min(Math.max(node.attrs?.level || 1, 1), 6);
  return "#".repeat(level) + " " + renderInline(node.content || [], ctx);
}

function renderBlockquote(node, ctx) {
  const inner = (node.content || [])
    .map((child) => serializeBlock(child, ctx))
    .join("\n\n")
    .trimEnd();
  return inner.split("\n").map((line) => (line.length ? "> " + line : ">")).join("\n");
}

function renderList(node, ctx) {
  // Lists in the unified schema can hold mixed markers. Each listItem
  // emits its own marker; markdown renderers will group adjacent same-
  // marker items into one visual list and treat marker switches as
  // adjacent lists (acceptable).
  let orderedCounter = 1;
  const lines = [];
  for (const item of node.content || []) {
    if (!item || item.type !== "listItem") continue;
    const marker = item.attrs?.marker || "bullet";
    let prefix;
    switch (marker) {
      case "task":
        prefix = item.attrs?.checked ? "- [x] " : "- [ ] ";
        break;
      case "ordered":
        prefix = `${orderedCounter++}. `;
        break;
      case "plain":
        // No markdown primitive for "list item without a bullet." Round-trip
        // back to bullet is the lossy edge case. Documented in spec.
        prefix = "- ";
        break;
      case "bullet":
      default:
        prefix = "- ";
    }
    // Reset ordered counter on marker switch so 1. doesn't keep climbing
    // after an interleaved bullet.
    if (marker !== "ordered") orderedCounter = 1;
    lines.push(renderListItem(item, prefix, ctx));
  }
  return lines.join("\n");
}

function renderListItem(item, prefix, ctx) {
  const inner = (item.content || [])
    .map((child) => serializeBlock(child, ctx))
    .join("\n\n")
    .trimEnd();
  if (!inner) return prefix.trimEnd();
  // Indent continuation lines by the prefix width so nested content stays
  // inside the item per CommonMark.
  const indent = " ".repeat(prefix.length);
  const lines = inner.split("\n");
  return prefix + lines[0] + (lines.length > 1 ? "\n" + lines.slice(1).map((l) => indent + l).join("\n") : "");
}

function renderTable(node, ctx) {
  const rows = (node.content || []).filter((r) => r?.type === "tableRow");
  if (rows.length === 0) return "";
  const matrix = rows.map((row) =>
    (row.content || []).map((cell) => {
      const isHeader = cell?.type === "tableHeader";
      // No block lines inside a cell: a table row is one line of text.
      const text = (cell?.content || []).map((c) => serializeBlock(c, { ...ctx, inCell: true })).join(" ").trim();
      return { text, isHeader };
    }),
  );
  if (matrix.length === 0 || matrix[0].length === 0) return "";

  // GFM requires a header row + separator. If the first row has no header
  // cells, synthesize a blank header so the table still renders.
  const hasHeader = matrix[0].every((c) => c.isHeader);
  const header = hasHeader ? matrix[0] : Array(matrix[0].length).fill({ text: "", isHeader: true });
  const dataRows = hasHeader ? matrix.slice(1) : matrix;

  const out = [];
  out.push("| " + header.map((c) => escapeCell(c.text)).join(" | ") + " |");
  out.push("| " + header.map(() => "---").join(" | ") + " |");
  for (const row of dataRows) {
    out.push("| " + row.map((c) => escapeCell(c.text)).join(" | ") + " |");
  }
  return out.join("\n");
}

function escapeCell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderCodeBlock(node, _ctx) {
  const lang = (node.attrs?.language || "").trim();
  const text = (node.content || []).map((c) => c.text || "").join("");
  return "```" + lang + "\n" + text + (text.endsWith("\n") ? "" : "\n") + "```";
}

function renderChart(node, _ctx) {
  const kind = node.attrs?.kind || "flowchart";
  const source = node.attrs?.source || null;
  const mermaid = assembleMermaid({ kind, source }) || `${kind}\n  (empty)`;
  // Source comment lets the parser round-trip the structured `source` object
  // without re-parsing mermaid syntax. JSON is escaped so `-->` cannot
  // close the comment early.
  const sourceJson = JSON.stringify({ kind, source })
    .replace(/-->/g, "--\\u003e");
  return `<!-- shizumu:chart-source:${sourceJson} -->\n\`\`\`mermaid\n${mermaid}\n\`\`\``;
}

function renderRecipe(node, ctx) {
  const children = node.content || [];
  const out = [];
  out.push("### Given");
  if (children[0]) {
    out.push(serializeBlock(children[0], ctx));
  }
  out.push("");
  out.push("### Steps");
  if (children[1]) {
    out.push(serializeBlock(children[1], ctx));
  }
  out.push("");
  out.push("### Result");
  if (children[2]) {
    out.push(serializeBlock(children[2], ctx));
  }
  return out.filter((l) => l !== undefined).join("\n").trimEnd();
}

function renderDecision(node, ctx) {
  const children = node.content || [];
  const out = [];
  out.push("### Considered");
  if (children[0]) {
    out.push(serializeBlock(children[0], ctx));
  }
  out.push("");
  out.push("### Chose");
  if (children[1]) {
    out.push(serializeBlock(children[1], ctx));
  }
  out.push("");
  out.push("### Because");
  if (children[2]) {
    out.push(serializeBlock(children[2], ctx));
  }
  return out.filter((l) => l !== undefined).join("\n").trimEnd();
}

function renderQABlock(node, ctx) {
  return (node.content || [])
    .map((pair) => serializeBlock(pair, ctx))
    .filter(Boolean)
    .join("\n\n");
}

function renderQAPair(node, ctx) {
  const q = node.content?.[0];
  const a = node.content?.[1];
  const qText = q ? renderInline(q.content || [], ctx) : "";
  const aText = a ? renderInline(a.content || [], ctx) : "";
  return `**Q:** ${qText}\n\n**A:** ${aText}`;
}

function renderDayMarker(node, _ctx) {
  const date = node.attrs?.date || "";
  const focus = (node.attrs?.whatMatters || "").trim();
  if (!date && !focus) return "";
  return `## ${date}${focus ? " — " + escapeMarkdown(focus) : ""}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Inline serializer
// ──────────────────────────────────────────────────────────────────────────

function renderInline(nodes, ctx) {
  let out = "";
  for (const n of nodes) {
    out += renderInlineNode(n, ctx);
  }
  return out;
}

function renderInlineNode(node, _ctx) {
  if (!node) return "";
  switch (node.type) {
    case "text": {
      let s = escapeMarkdown(node.text || "");
      const marks = node.marks || [];
      for (const mark of marks) {
        s = wrapMark(s, mark);
      }
      return s;
    }
    case "hardBreak":
      return "  \n";
    case "pageRef":
      return `[[${node.attrs?.labelSnapshot || node.attrs?.targetId || "?"}]]`;
    case "pinRef":
      return `[[${node.attrs?.labelSnapshot || node.attrs?.pinId || "?"}]]`;
    case "localImage":
      return renderLocalImage(node);
    case "attachment":
      // Images have bytes we copy into the export's images/ folder, so
      // they can be linked. A file attachment's bytes aren't exported,
      // so linking one would produce a dead path — drop it instead.
      if (node.attrs?.kind !== "image") return "";
      return `![${escapeMarkdown(node.attrs?.filename || "")}](../images/${encodeURI(attachmentImageExportName(node.attrs))})`;
    default:
      // Unknown inline: drop. Keeps the output stable when extensions are added.
      return "";
  }
}

function wrapMark(s, mark) {
  if (!mark || !mark.type) return s;
  switch (mark.type) {
    case "bold":      return `**${s}**`;
    case "italic":    return `*${s}*`;
    case "strike":    return `~~${s}~~`;
    case "code":      return `\`${s}\``;
    case "underline": return `<u>${s}</u>`;
    case "link": {
      const href = mark.attrs?.href || "";
      return `[${s}](${href})`;
    }
    default: return s;
  }
}

/**
 * Filename an attachment-backed image gets inside the export's flat
 * `images/` folder. Shared with run.js's copy step so the markdown link and
 * the copied file always agree.
 *
 * Prefixed with the hash because the folder is flat and two different
 * blobs are very often both called "screenshot.png".
 */
export function attachmentImageExportName(attrs) {
  const hash = String(attrs?.blob_hash || "").slice(0, 8) || "blob";
  const safe = String(attrs?.filename || "image")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/-+$/, "");
  return `${hash}-${safe || "image"}`;
}

function renderLocalImage(node) {
  const localPath = node.attrs?.localPath || node.attrs?.src || "";
  const alt = node.attrs?.alt || "";
  // Filename is the basename of localPath; the Rust copy step writes assets
  // into the export's flat `images/` folder by filename, so the relative
  // path here is `../images/<filename>` from a per-trail page, and the
  // README at root references `./images/<filename>`. We emit the
  // generic-relative form `images/<filename>` and the export root README is
  // the only file that needs a different prefix — handled by the caller.
  const match = String(localPath).match(/[^/\\]+$/);
  const filename = match ? match[0] : "image";
  return `![${escapeMarkdown(alt)}](../images/${encodeURI(filename)})`;
}

// ──────────────────────────────────────────────────────────────────────────
// Markdown escaping
// ──────────────────────────────────────────────────────────────────────────

// Escape only the characters that would otherwise be interpreted as
// markdown syntax in the surrounding context. We do NOT escape inside
// code blocks (renderCodeBlock emits raw) or inside chart blocks.
function escapeMarkdown(s) {
  return String(s).replace(/([\\`*_{}\[\]<>])/g, "\\$1");
}

// ──────────────────────────────────────────────────────────────────────────
// YAML frontmatter
// ──────────────────────────────────────────────────────────────────────────
//
// Small purpose-built YAML emitter — does only what we need: scalar strings
// (single-line or literal block), numbers, booleans, nulls, lists of
// scalars, and one level of map nesting (the `pins:` list of objects).
//
// We do not pull in js-yaml because (a) one new dep for one usage is
// disproportionate, (b) the output shape is fixed and small, and (c) the
// importer (when shipped) parses with a tolerant subset of YAML — we can
// match its exact expectations here.

function yamlFrontmatter(obj) {
  const body = yamlEmitMap(obj, 0);
  return "---\n" + body + "---\n\n";
}

function yamlEmitMap(obj, indent) {
  const pad = " ".repeat(indent);
  let out = "";
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    out += pad + key + ":" + yamlEmitValue(value, indent) + "\n";
  }
  return out;
}

function yamlEmitValue(value, indent) {
  if (value === null || value === undefined) return " null";
  if (typeof value === "boolean") return " " + (value ? "true" : "false");
  if (typeof value === "number") return " " + String(value);
  if (typeof value === "string") return " " + yamlScalarString(value);
  if (Array.isArray(value)) return value.length === 0 ? " []" : "\n" + yamlEmitList(value, indent);
  if (typeof value === "object") {
    if (value.__yaml_literal__ != null) {
      return yamlLiteralBlock(value.__yaml_literal__, indent + 2);
    }
    return "\n" + yamlEmitMap(value, indent + 2);
  }
  return " " + yamlScalarString(String(value));
}

function yamlEmitList(arr, indent) {
  const pad = " ".repeat(indent);
  return arr
    .map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        // List of maps: first key on the `- ` line, rest indented.
        const entries = Object.entries(item).filter(([, v]) => v !== null && v !== undefined);
        if (entries.length === 0) return pad + "- {}";
        let s = "";
        for (let i = 0; i < entries.length; i++) {
          const [k, v] = entries[i];
          const prefix = i === 0 ? pad + "- " : pad + "  ";
          s += prefix + k + ":" + yamlEmitValue(v, indent + 2) + "\n";
        }
        return s.trimEnd();
      }
      return pad + "- " + yamlScalarString(String(item));
    })
    .join("\n");
}

function yamlScalarString(s) {
  // Use single-line plain scalar when safe; quote otherwise. Newlines are
  // not allowed in plain scalars — caller must use literal block (`|`).
  if (s.includes("\n")) {
    // Should not reach here for plain scalars; the literal-block path
    // handles multiline. Fall back to a double-quoted string with the
    // newlines escaped, so we never silently truncate.
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
  }
  if (s === "" ||
      /^[\s]/.test(s) ||
      /[\s]$/.test(s) ||
      /[:#&*!|>'"%@`,\[\]{}?-]/.test(s.charAt(0)) ||
      /:\s/.test(s) ||
      s === "true" || s === "false" || s === "null" || s === "yes" || s === "no" ||
      /^-?\d+(\.\d+)?$/.test(s)) {
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
  return s;
}

function yamlLiteralBlock(text, indent) {
  const pad = " ".repeat(indent);
  const lines = String(text).split("\n");
  return " |\n" + lines.map((line) => (line.length ? pad + line : pad.trimEnd())).join("\n");
}
