// Whitelist-based HTML sanitizer for pasted rich content (web/Notion/Docs).
// Strips inline styles, classes, and unknown elements — keeps structural
// tags ProseMirror's parseDOM rules can consume cleanly. Note: block-copy
// paste (⎘ handle / Ctrl+Shift+C) never reaches this sanitizer — it's
// reconstructed directly from the embedded data-shizumu-block JSON payload
// (see parseBlockFromHtml in block-clipboard.js) before this fallback path
// runs in TipTapEditor.svelte's handlePaste.
//
// Extracted from TipTapEditor.svelte so it's testable without mounting the
// editor — it's pure DOM-string-in, DOM-string-out, no editor dependency.
const ALLOWED_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "s", "u", "code", "a", "br",
  "ul", "ol", "li", "blockquote", "hr", "pre", "img", "span", "div",
  "table", "thead", "tbody", "tr", "th", "td",
]);

// Keep data-type / data-checked so taskList → taskList and qaBlock → qaBlock
// round-trip when rich HTML from an external source (web/Notion/Docs)
// happens to carry them.
const ALLOWED_ATTRS = {
  a: ["href", "title"],
  img: ["src", "alt"],
  ul: ["data-type", "data-list"],
  ol: ["data-type", "data-list"],
  li: ["data-type", "data-marker", "data-checked"],
  div: ["data-type"],
  th: ["colspan", "rowspan", "colwidth"],
  td: ["colspan", "rowspan", "colwidth"],
};

// Tags that give ProseMirror's schema-driven parser a block/textblock
// context to resolve into. In sanitizePastedHtml below: when sanitized
// top-level content has none of these (e.g. copying a plain-text selection
// serializes to a bare `<span style="...">text</span>`, with no
// surrounding block), parseSlice has nothing to match at the top level and
// falls back to embedding the raw source string as opaque text instead of
// unwrapping it — visible as literal "<span>...</span>" in the pasted
// result. Wrapping bare inline content in a single <p> before insertContent
// gives the parser that context.
const BLOCK_LEVEL_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "blockquote", "hr", "pre", "table", "div",
]);

function walk(node) {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        // Unwrap: replace node with its children
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        continue;
      }
      // Strip all attributes except allowed
      const keep = ALLOWED_ATTRS[tag] || [];
      for (const attr of Array.from(child.attributes)) {
        if (!keep.includes(attr.name)) child.removeAttribute(attr.name);
      }
      walk(child);
    } else if (child.nodeType === Node.COMMENT_NODE) {
      node.removeChild(child);
    }
  }
}

export function sanitizePastedHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    walk(doc.body);
    const hasBlockChild = Array.from(doc.body.children).some(
      (el) => BLOCK_LEVEL_TAGS.has(el.tagName.toLowerCase())
    );
    if (!hasBlockChild && doc.body.childNodes.length > 0) {
      const wrapper = doc.createElement("p");
      while (doc.body.firstChild) wrapper.appendChild(doc.body.firstChild);
      doc.body.appendChild(wrapper);
    }
    return doc.body.innerHTML.trim() || null;
  } catch {
    return null;
  }
}
