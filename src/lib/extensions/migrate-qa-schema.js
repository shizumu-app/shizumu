// Wrap legacy qaBlock children (a flat pair of paragraphs) into a
// qaPair node so the new schema `qaBlock content: qaPair+` parses.
//
// Legacy shape:
//   { type: "qaBlock", content: [{ type: "paragraph" }, { type: "paragraph" }] }
//
// New shape:
//   { type: "qaBlock", content: [{ type: "qaPair", content: [p, p] }] }
//
// Edge cases handled:
//   - qaBlock with > 2 paragraphs (rare; schema was `block+`): wrap each
//     consecutive pair; a trailing odd paragraph rides on the previous
//     pair (kept as the A of the last pair). We never drop content.
//   - qaBlock with one qaPair already: pass through.
//   - qaBlock with mixed children (qaPair + paragraph): wrap loose
//     paragraphs into qaPairs greedily, never lose content.
//
// Same idempotent walker pattern as migrateListSchema / migrateRecipeSchema.
export function migrateQASchema(doc) {
  if (!doc || typeof doc !== "object") return doc;
  return walk(doc);
}

function walk(node) {
  if (!node || typeof node !== "object") return node;
  let next = node;
  if (Array.isArray(next.content)) {
    let changed = false;
    const mapped = next.content.map((child) => {
      const w = walk(child);
      if (w !== child) changed = true;
      return w;
    });
    if (changed) {
      next = { ...next, content: mapped };
    }
  }
  if (next.type === "qaBlock" && Array.isArray(next.content)) {
    const wrapped = wrapPairs(next.content);
    if (wrapped !== next.content) {
      next = { ...next, content: wrapped };
    }
  }
  if (next.type === "qaPair" && Array.isArray(next.content) && next.content.length === 2) {
    const stripped = stripPairPrefixes(next.content);
    if (stripped !== next.content) {
      next = { ...next, content: stripped };
    }
  }
  return next;
}

// Strip legacy literal "Q: " / "A: " prefix from the first/second paragraph
// of a qaPair. The "Q:" / "A:" label now lives in CSS ::before so the
// content paragraphs hold only the user's text. Idempotent: paragraphs
// that don't start with the prefix are left untouched.
function stripPairPrefixes(children) {
  const [q, a] = children;
  const newQ = stripPrefix(q, "Q: ");
  const newA = stripPrefix(a, "A: ");
  if (newQ === q && newA === a) return children;
  return [newQ, newA];
}

function stripPrefix(para, prefix) {
  if (!para || para.type !== "paragraph" || !Array.isArray(para.content) || para.content.length === 0) {
    return para;
  }
  const first = para.content[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") return para;
  if (!first.text.startsWith(prefix)) return para;
  const trimmed = first.text.slice(prefix.length);
  if (trimmed.length === 0) {
    // Drop the leading text node entirely; if it was the only inline,
    // leave the paragraph empty (no content array).
    const rest = para.content.slice(1);
    if (rest.length === 0) {
      const { content, ...withoutContent } = para;
      return withoutContent;
    }
    return { ...para, content: rest };
  }
  const newFirst = { ...first, text: trimmed };
  return { ...para, content: [newFirst, ...para.content.slice(1)] };
}

function wrapPairs(children) {
  // Already in the new shape: every child is a qaPair. Still run prefix
  // strip on the children so legacy literal prefixes don't slip through.
  if (children.every((c) => c && c.type === "qaPair")) {
    let anyChanged = false;
    const updated = children.map((p) => {
      const stripped = stripPairPrefixes(p.content || []);
      if (stripped !== p.content) {
        anyChanged = true;
        return { ...p, content: stripped };
      }
      return p;
    });
    return anyChanged ? updated : children;
  }

  const out = [];
  let bufP = null;
  const flushBuf = () => {
    if (!bufP) return;
    const pair = makePair(bufP, emptyParagraph());
    out.push(pair);
    bufP = null;
  };
  for (const child of children) {
    if (!child) continue;
    if (child.type === "qaPair") {
      flushBuf();
      const stripped = stripPairPrefixes(child.content || []);
      out.push(stripped !== child.content ? { ...child, content: stripped } : child);
      continue;
    }
    if (child.type === "paragraph") {
      if (!bufP) {
        bufP = child;
      } else {
        out.push(makePair(bufP, child));
        bufP = null;
      }
      continue;
    }
    flushBuf();
    out.push(child);
  }
  flushBuf();
  return out;
}

function makePair(q, a) {
  const stripped = stripPairPrefixes([q, a]);
  return { type: "qaPair", content: stripped };
}

function emptyParagraph() {
  return { type: "paragraph" };
}
