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
// renderable in any tool; block-level pin anchors are `<!-- shizumu:pin:<id> -->`
// HTML comments immediately preceding the anchored block.

import { assembleMermaid } from "../extensions/chart.js";

const FORMAT_VERSION = 1;

// ──────────────────────────────────────────────────────────────────────────
// Public entry points
// ──────────────────────────────────────────────────────────────────────────

export function serializePage({ page, lineage = null, lineagePath = null, pins = [] }) {
  const doc = parseContentJson(page.content_json);
  const knownPinIds = new Set(pins.map((p) => p.id));
  const body = docToMarkdown(doc, { knownPinIds });

  const fm = {
    shizumu: FORMAT_VERSION,
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
  if (typeof raw === "object") return docToMarkdown(raw, { knownPinIds: new Set() }).trimEnd();
  if (typeof raw !== "string") return "";
  const t = raw.trim();
  if (t.length >= 2 && (t[0] === "{" || t[0] === "[")) {
    try {
      const parsed = JSON.parse(t);
      return docToMarkdown(parsed, { knownPinIds: new Set() }).trimEnd();
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
  const pinId = node.attrs?.pinId;
  if (pinId && ctx.knownPinIds.has(pinId)) {
    parts.push(`<!-- shizumu:pin:${pinId} -->`);
  }
  const title = node.attrs?.blockTitle;
  if (title && String(title).trim()) {
    parts.push(`**${escapeMarkdown(String(title).trim())}**`);
  }
  return parts.length === 0 ? "" : parts.join("\n") + "\n";
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
      const text = (cell?.content || []).map((c) => serializeBlock(c, ctx)).join(" ").trim();
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
