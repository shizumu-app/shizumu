// Markdown → TipTap doc parser for the v0.3 export format.
//
// Used by `round-trip.test.js` to verify serialize→parse→serialize is byte-
// equal. Wired into the editor's paste handler in v0.4 (see
// src/lib/markdown-clipboard.js).
//
// Scope: only the markdown shapes that `markdown.js` emits. This is not a
// general markdown parser. If `markdown.js` doesn't produce some construct,
// this parser doesn't need to handle it.

export function parsePage(md) {
  const { frontmatter, body } = splitFrontmatter(md);
  const doc = parseBody(body);
  return { frontmatter, doc };
}

// ──────────────────────────────────────────────────────────────────────────
// Frontmatter
// ──────────────────────────────────────────────────────────────────────────

export function splitFrontmatter(md) {
  if (!md.startsWith("---\n")) return { frontmatter: {}, body: md };
  const closeIdx = md.indexOf("\n---\n", 4);
  if (closeIdx < 0) return { frontmatter: {}, body: md };
  const fmText = md.slice(4, closeIdx);
  const body = md.slice(closeIdx + 5).replace(/^\n+/, "");
  return { frontmatter: parseFrontmatter(fmText), body };
}

// YAML subset parser — matches exactly what markdown.js emits:
//   scalar lines:   key: value
//   nested maps:    key:\n  k: v\n  k: v
//   lists:          key:\n  - item\n  - item
//   list-of-maps:   key:\n  - k: v\n    k: v\n  - k: v
//   literal block:  key: |\n  line\n  line
export function parseFrontmatter(text) {
  const lines = text.split("\n");
  const root = {};
  parseMap(lines, 0, 0, root);
  return root;
}

function parseMap(lines, start, indent, out) {
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line === "" || line.trimStart().startsWith("#")) { i++; continue; }
    const curIndent = leadingSpaces(line);
    if (curIndent < indent) return i;
    if (curIndent > indent) { i++; continue; } // safety; shouldn't happen at well-formed input
    const m = line.match(/^(\s*)([^:\s][^:]*):(.*)$/);
    if (!m) { i++; continue; }
    const key = m[2].trim();
    const rest = m[3];

    if (rest.trim() === "|") {
      // Literal block scalar.
      const childIndent = indent + 2;
      const buf = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (l === "") { buf.push(""); i++; continue; }
        const ci = leadingSpaces(l);
        if (ci < childIndent && l.trim() !== "") break;
        buf.push(l.slice(childIndent));
        i++;
      }
      // Strip trailing blank lines (literal-block clip behaviour).
      while (buf.length > 0 && buf[buf.length - 1] === "") buf.pop();
      out[key] = buf.join("\n");
      continue;
    }

    if (rest.trim() === "") {
      // Nested map or list at next indent level.
      const childIndent = indent + 2;
      // Look ahead to decide: list (starts with `- `) or map.
      let j = i + 1;
      while (j < lines.length && lines[j] === "") j++;
      if (j < lines.length && /^\s*-\s/.test(lines[j]) && leadingSpaces(lines[j]) === childIndent) {
        const result = [];
        i = parseList(lines, i + 1, childIndent, result);
        out[key] = result;
      } else {
        const child = {};
        i = parseMap(lines, i + 1, childIndent, child);
        out[key] = child;
      }
      continue;
    }

    if (rest.trim() === "[]") { out[key] = []; i++; continue; }

    out[key] = parseScalar(rest.trim());
    i++;
  }
  return i;
}

function parseList(lines, start, indent, out) {
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line === "") { i++; continue; }
    const curIndent = leadingSpaces(line);
    if (curIndent < indent) return i;
    if (curIndent > indent) { i++; continue; }
    if (!line.slice(curIndent).startsWith("- ")) return i;

    // Item starts at `- `. The remainder of the line is either a scalar or
    // the first key of a map. If it's a map, subsequent keys appear at
    // curIndent + 2 columns.
    const itemPrefix = " ".repeat(curIndent) + "- ";
    const afterDash = line.slice(itemPrefix.length);
    const mapKeyMatch = afterDash.match(/^([^:\s][^:]*):(.*)$/);
    if (!mapKeyMatch) {
      out.push(parseScalar(afterDash.trim()));
      i++;
      continue;
    }
    // Treat the rest of this line + subsequent indented lines as one item map.
    const itemKeyIndent = curIndent + 2;
    const itemLines = [" ".repeat(itemKeyIndent) + afterDash];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (l === "") { itemLines.push(l); i++; continue; }
      const ci = leadingSpaces(l);
      if (ci < itemKeyIndent) break;
      itemLines.push(l);
      i++;
    }
    const itemMap = {};
    parseMap(itemLines, 0, itemKeyIndent, itemMap);
    out.push(itemMap);
  }
  return i;
}

function parseScalar(raw) {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return raw;
}

function leadingSpaces(s) {
  let n = 0;
  while (n < s.length && s[n] === " ") n++;
  return n;
}

// ──────────────────────────────────────────────────────────────────────────
// Body parser
// ──────────────────────────────────────────────────────────────────────────

const DAY_MARKER_RE = /^## (\d{4}-\d{2}-\d{2})(?:\s—\s(.+))?$/;
const PIN_ANCHOR_RE = /^<!-- shizumu:pin:([^\s>]+) -->$/;
const CHART_SOURCE_RE = /^<!-- shizumu:chart-source:(.*) -->$/;
const BOLD_LINE_RE = /^\*\*((?:[^*]|\*(?!\*))+?)\*\*$/;

export function parseBody(text) {
  const lines = text.replace(/\n+$/, "").split("\n");
  const blocks = [];
  let pending = { pinId: null, blockTitle: null, chartSource: null };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines.
    if (line === "") { i++; continue; }

    // Block-level decorations that attach to the NEXT block.
    const pinM = line.match(PIN_ANCHOR_RE);
    if (pinM) { pending.pinId = pinM[1]; i++; continue; }
    const chartM = line.match(CHART_SOURCE_RE);
    if (chartM) {
      try {
        const json = chartM[1].replace(/--\\u003e/g, "-->");
        pending.chartSource = JSON.parse(json);
      } catch {
        pending.chartSource = null;
      }
      i++;
      continue;
    }
    // Bold-only line (blockTitle) followed by a content line.
    const titleM = line.match(BOLD_LINE_RE);
    if (titleM && i + 1 < lines.length && lines[i + 1] !== "") {
      pending.blockTitle = titleM[1];
      i++;
      continue;
    }

    // Chart fence — must come BEFORE the generic code fence check so that
    // ```mermaid is routed to the chart parser. Requires a pending chart-
    // source comment; otherwise it would parse as a plain code block.
    if (line === "```mermaid" && pending.chartSource) {
      const j = findFenceClose(lines, i + 1);
      const node = makeChart(pending.chartSource);
      attachPending(node, pending);
      pending = { pinId: null, blockTitle: null, chartSource: null };
      blocks.push(node);
      i = j + 1;
      continue;
    }

    // Code block.
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const j = findFenceClose(lines, i + 1);
      const text = lines.slice(i + 1, j).join("\n") + "\n";
      const node = {
        type: "codeBlock",
        attrs: { language: language || null },
        content: text ? [{ type: "text", text }] : [],
      };
      attachPending(node, pending);
      pending = { pinId: null, blockTitle: null, chartSource: null };
      blocks.push(node);
      i = j + 1;
      continue;
    }

    // dayMarker (must check before heading).
    const dm = line.match(DAY_MARKER_RE);
    if (dm) {
      blocks.push({
        type: "dayMarker",
        attrs: { date: dm[1], whatMatters: unescapeMarkdown(dm[2] || "") },
      });
      pending = { pinId: null, blockTitle: null, chartSource: null };
      i++;
      continue;
    }

    // Recipe block — three H3s in fixed order. We detect on `### Given`
    // and consume until the matching `### Result` block has been read.
    if (line === "### Given") {
      const [node, next] = parseRecipe(lines, i);
      attachPending(node, pending);
      pending = { pinId: null, blockTitle: null, chartSource: null };
      blocks.push(node);
      i = next;
      continue;
    }

    // qaBlock — sequence of `**Q:** ...` / `**A:** ...` paragraph pairs.
    if (/^\*\*Q:\*\* /.test(line)) {
      const [node, next] = parseQA(lines, i);
      attachPending(node, pending);
      pending = { pinId: null, blockTitle: null, chartSource: null };
      blocks.push(node);
      i = next;
      continue;
    }

    // Heading.
    const hM = line.match(/^(#{1,6}) (.+)$/);
    if (hM) {
      const level = Math.min(hM[1].length, 3);
      const node = {
        type: "heading",
        attrs: { level },
        content: parseInline(hM[2]),
      };
      attachPending(node, pending);
      pending = { pinId: null, blockTitle: null, chartSource: null };
      blocks.push(node);
      i++;
      continue;
    }

    // Horizontal rule.
    if (line === "---") {
      blocks.push({ type: "horizontalRule" });
      pending = { pinId: null, blockTitle: null, chartSource: null };
      i++;
      continue;
    }

    // Blockquote.
    if (line.startsWith("> ") || line === ">") {
      const [node, next] = parseBlockquote(lines, i);
      attachPending(node, pending);
      pending = { pinId: null, blockTitle: null, chartSource: null };
      blocks.push(node);
      i = next;
      continue;
    }

    // List.
    if (isListLine(line)) {
      const [node, next] = parseList_(lines, i);
      attachPending(node, pending);
      pending = { pinId: null, blockTitle: null, chartSource: null };
      blocks.push(node);
      i = next;
      continue;
    }

    // Table.
    if (line.startsWith("| ") && i + 1 < lines.length && /^\|\s*[:\-]/.test(lines[i + 1])) {
      const [node, next] = parseTable(lines, i);
      attachPending(node, pending);
      pending = { pinId: null, blockTitle: null, chartSource: null };
      blocks.push(node);
      i = next;
      continue;
    }

    // Paragraph (default). Collect contiguous non-blank, non-special lines.
    const start = i;
    const buf = [line];
    i++;
    while (i < lines.length && lines[i] !== "" && !isBlockStart(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    const node = {
      type: "paragraph",
      content: parseInline(buf.join("\n")),
    };
    attachPending(node, pending);
    pending = { pinId: null, blockTitle: null, chartSource: null };
    blocks.push(node);
  }

  return { type: "doc", content: blocks };
}

function attachPending(node, pending) {
  if (!node.attrs) node.attrs = {};
  if (pending.pinId) node.attrs.pinId = pending.pinId;
  if (pending.blockTitle) node.attrs.blockTitle = pending.blockTitle;
}

function isBlockStart(line) {
  return (
    line.startsWith("# ") ||
    line.startsWith("## ") ||
    line.startsWith("### ") ||
    line.startsWith("> ") ||
    line === ">" ||
    line.startsWith("```") ||
    isListLine(line) ||
    line === "---" ||
    PIN_ANCHOR_RE.test(line) ||
    CHART_SOURCE_RE.test(line) ||
    (line.startsWith("| ") || line === "|")
  );
}

function isListLine(line) {
  return /^(?:- \[[ xX]\] |- |\* |\d+\. )/.test(line);
}

function findFenceClose(lines, start) {
  for (let i = start; i < lines.length; i++) {
    if (lines[i] === "```") return i;
  }
  return lines.length;
}

// ──────────────────────────────────────────────────────────────────────────
// Specific block parsers
// ──────────────────────────────────────────────────────────────────────────

function parseBlockquote(lines, start) {
  const buf = [];
  let i = start;
  while (i < lines.length) {
    const l = lines[i];
    if (l === ">") { buf.push(""); i++; continue; }
    if (l.startsWith("> ")) { buf.push(l.slice(2)); i++; continue; }
    break;
  }
  const innerDoc = parseBody(buf.join("\n"));
  return [{ type: "blockquote", content: innerDoc.content }, i];
}

function parseList_(lines, start) {
  const items = [];
  let i = start;
  while (i < lines.length && isListLine(lines[i])) {
    const line = lines[i];
    let marker, checked = false, prefixLen;
    if (line.startsWith("- [ ] ")) { marker = "task"; prefixLen = 6; }
    else if (line.startsWith("- [x] ") || line.startsWith("- [X] ")) { marker = "task"; checked = true; prefixLen = 6; }
    else if (line.startsWith("- ")) { marker = "bullet"; prefixLen = 2; }
    else if (line.startsWith("* ")) { marker = "bullet"; prefixLen = 2; }
    else {
      const m = line.match(/^(\d+)\. /);
      if (!m) break;
      marker = "ordered";
      prefixLen = m[0].length;
    }
    const indent = " ".repeat(prefixLen);
    const buf = [line.slice(prefixLen)];
    i++;
    // Collect continuation lines indented by prefixLen.
    while (i < lines.length && lines[i].startsWith(indent) && !isListLine(lines[i])) {
      buf.push(lines[i].slice(prefixLen));
      i++;
    }
    const innerDoc = parseBody(buf.join("\n"));
    const itemAttrs = { marker };
    if (marker === "task") itemAttrs.checked = checked;
    items.push({
      type: "listItem",
      attrs: itemAttrs,
      content: innerDoc.content.length > 0 ? innerDoc.content : [{ type: "paragraph" }],
    });
  }
  return [{ type: "list", content: items }, i];
}

function parseTable(lines, start) {
  let i = start;
  const headerCells = splitTableRow(lines[i]);
  i += 2; // skip separator
  const rows = [];
  rows.push({
    type: "tableRow",
    content: headerCells.map((text) => ({
      type: "tableHeader",
      content: [{ type: "paragraph", content: parseInline(text) }],
    })),
  });
  while (i < lines.length && lines[i].startsWith("| ")) {
    const cells = splitTableRow(lines[i]);
    rows.push({
      type: "tableRow",
      content: cells.map((text) => ({
        type: "tableCell",
        content: [{ type: "paragraph", content: parseInline(text) }],
      })),
    });
    i++;
  }
  return [{ type: "table", content: rows }, i];
}

function splitTableRow(line) {
  // Trim leading `| ` and trailing ` |`, then split on ` | ` (unescaped).
  let inner = line.replace(/^\|\s/, "").replace(/\s\|$/, "");
  const cells = [];
  let buf = "";
  for (let k = 0; k < inner.length; k++) {
    if (inner[k] === "\\" && inner[k + 1] === "|") { buf += "|"; k++; continue; }
    if (inner[k] === "|" && inner[k + 1] === " ") { cells.push(buf.trim()); buf = ""; k += 1; continue; }
    buf += inner[k];
  }
  cells.push(buf.trim());
  return cells;
}

function makeChart(chartSource) {
  const kind = chartSource?.kind || "flowchart";
  const source = chartSource?.source || null;
  return { type: "chart", attrs: { kind, source } };
}

function parseRecipe(lines, start) {
  let i = start;
  const slots = [null, null, null];
  for (let slot = 0; slot < 3; slot++) {
    const headerExpected = ["### Given", "### Steps", "### Result"][slot];
    if (lines[i] !== headerExpected) break;
    i++;
    while (i < lines.length && lines[i] === "") i++;
    const nextHeader = slot < 2 ? ["### Steps", "### Result"][slot] : null;
    const buf = [];
    while (i < lines.length && lines[i] !== nextHeader) {
      buf.push(lines[i]);
      i++;
    }
    while (buf.length > 0 && buf[buf.length - 1] === "") buf.pop();
    const innerDoc = parseBody(buf.join("\n"));
    slots[slot] = innerDoc.content[0] || { type: "paragraph" };
  }
  // Skip trailing blank.
  while (i < lines.length && lines[i] === "") i++;
  return [
    {
      type: "recipeBlock",
      content: slots.map((s) => s || { type: "paragraph" }),
    },
    i,
  ];
}

function parseQA(lines, start) {
  const pairs = [];
  let i = start;
  while (i < lines.length && /^\*\*Q:\*\* /.test(lines[i])) {
    const qText = lines[i].slice("**Q:** ".length);
    i++;
    while (i < lines.length && lines[i] === "") i++;
    let aText = "";
    if (i < lines.length && /^\*\*A:\*\* /.test(lines[i])) {
      aText = lines[i].slice("**A:** ".length);
      i++;
    }
    pairs.push({
      type: "qaPair",
      content: [
        { type: "paragraph", content: parseInline(qText) },
        { type: "paragraph", content: parseInline(aText) },
      ],
    });
    while (i < lines.length && lines[i] === "") i++;
  }
  return [{ type: "qaBlock", content: pairs }, i];
}

// ──────────────────────────────────────────────────────────────────────────
// Inline parser
// ──────────────────────────────────────────────────────────────────────────

export function parseInline(text) {
  const out = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf.length > 0) {
      out.push({ type: "text", text: unescapeMarkdown(buf) });
      buf = "";
    }
  };
  while (i < text.length) {
    const ch = text[i];

    // Escaped char.
    if (ch === "\\" && i + 1 < text.length) {
      buf += text[i + 1];
      i += 2;
      continue;
    }

    // Hard break: two trailing spaces + newline.
    if (ch === " " && text[i + 1] === " " && text[i + 2] === "\n") {
      flush();
      out.push({ type: "hardBreak" });
      i += 3;
      continue;
    }
    if (ch === "\n") {
      // Bare newlines inside a paragraph become spaces (markdown soft-wrap).
      buf += " ";
      i++;
      continue;
    }

    // Inline code: `code`. Greedy until next backtick.
    if (ch === "`") {
      const close = text.indexOf("`", i + 1);
      if (close > i) {
        flush();
        out.push({ type: "text", text: text.slice(i + 1, close), marks: [{ type: "code" }] });
        i = close + 1;
        continue;
      }
    }

    // Bold: **text**.
    if (ch === "*" && text[i + 1] === "*") {
      const close = findClose(text, i + 2, "**");
      if (close > i) {
        flush();
        const inner = parseInline(text.slice(i + 2, close));
        for (const n of inner) {
          n.marks = [...(n.marks || []), { type: "bold" }];
          out.push(n);
        }
        i = close + 2;
        continue;
      }
    }

    // Italic: *text*.
    if (ch === "*" && text[i + 1] !== "*") {
      const close = findClose(text, i + 1, "*");
      if (close > i) {
        flush();
        const inner = parseInline(text.slice(i + 1, close));
        for (const n of inner) {
          n.marks = [...(n.marks || []), { type: "italic" }];
          out.push(n);
        }
        i = close + 1;
        continue;
      }
    }

    // Strike: ~~text~~.
    if (ch === "~" && text[i + 1] === "~") {
      const close = findClose(text, i + 2, "~~");
      if (close > i) {
        flush();
        const inner = parseInline(text.slice(i + 2, close));
        for (const n of inner) {
          n.marks = [...(n.marks || []), { type: "strike" }];
          out.push(n);
        }
        i = close + 2;
        continue;
      }
    }

    // Underline (we emit <u>...</u>).
    if (text.slice(i, i + 3) === "<u>") {
      const close = text.indexOf("</u>", i + 3);
      if (close > i) {
        flush();
        const inner = parseInline(text.slice(i + 3, close));
        for (const n of inner) {
          n.marks = [...(n.marks || []), { type: "underline" }];
          out.push(n);
        }
        i = close + 4;
        continue;
      }
    }

    // Image: ![alt](url).
    if (ch === "!" && text[i + 1] === "[") {
      const labelClose = text.indexOf("]", i + 2);
      if (labelClose > i && text[labelClose + 1] === "(") {
        const urlClose = text.indexOf(")", labelClose + 2);
        if (urlClose > labelClose) {
          flush();
          const alt = unescapeMarkdown(text.slice(i + 2, labelClose));
          const url = text.slice(labelClose + 2, urlClose);
          const filename = (url.match(/[^/\\]+$/) || ["image"])[0];
          out.push({
            type: "localImage",
            attrs: {
              alt,
              localPath: decodeURI(filename),
              src: url,
              display: "block",
            },
          });
          i = urlClose + 1;
          continue;
        }
      }
    }

    // pageRef / pinRef: [[label]]. We can't distinguish without context, so
    // default to pageRef with labelSnapshot. The importer (with DB context)
    // can re-resolve. For round-trip stability, the original node's type
    // matters — but serialize re-emits [[label]] for both, so the round-
    // trip is byte-equal regardless of which we pick on parse.
    if (ch === "[" && text[i + 1] === "[") {
      const close = text.indexOf("]]", i + 2);
      if (close > i) {
        flush();
        const label = text.slice(i + 2, close);
        out.push({
          type: "pageRef",
          attrs: { targetId: null, labelSnapshot: label },
        });
        i = close + 2;
        continue;
      }
    }

    // Link: [text](url).
    if (ch === "[") {
      const labelClose = text.indexOf("]", i + 1);
      if (labelClose > i && text[labelClose + 1] === "(") {
        const urlClose = text.indexOf(")", labelClose + 2);
        if (urlClose > labelClose) {
          flush();
          const label = text.slice(i + 1, labelClose);
          const url = text.slice(labelClose + 2, urlClose);
          const inner = parseInline(label);
          for (const n of inner) {
            n.marks = [...(n.marks || []), { type: "link", attrs: { href: url } }];
            out.push(n);
          }
          i = urlClose + 1;
          continue;
        }
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

function findClose(text, start, delim) {
  let i = start;
  while (i < text.length) {
    if (text[i] === "\\") { i += 2; continue; }
    if (text.slice(i, i + delim.length) === delim) return i;
    i++;
  }
  return -1;
}

function unescapeMarkdown(s) {
  return s.replace(/\\([\\`*_{}\[\]<>])/g, "$1");
}
