// block-convert.js — pure conversion of one board block's node JSON into
// another board shape, keeping its text. Backs the "convert to…" action in
// the block-actions sheet (TipTapEditor.svelte's runBlockConvert). Operates
// entirely on `node.toJSON()` output; the caller turns the result back into
// real nodes with `schema.nodeFromJSON` and applies it in one transaction
// (see TipTapEditor.svelte's tiptap: commit — replaceWith + setSelection +
// one dispatch; qa-block.js's unwrapSoleQABlock documents why `lift` /
// `toggleX` don't work on these structured shapes).

/** Board types this module can convert FROM. Everything else (chart,
 * table, attachment, dayMarker, plain paragraphs/headings, …) is refused —
 * `convertBlockNode` returns null and `convertTargetsFor` returns []. */
export const CONVERTIBLE_TYPES = ["list", "blockquote", "qaBlock", "recipeBlock", "decisionBlock", "codeBlock"];

/** Shapes this module can convert TO. "bullet"/"ordered"/"task" are the
 * three `list` marker variants (not distinct node types); the rest are
 * distinct node types. */
export const CONVERT_TARGETS = ["bullet", "ordered", "task", "blockquote", "qaBlock", "codeBlock", "paragraphs"];

const LIST_MARKER_TARGETS = new Set(["bullet", "ordered", "task"]);

// Node types collectPlainText/flattenToParagraphs recurse INTO rather than
// treating as an opaque textblock. Anything else with array `content` gets
// ONE more check (see `hasBlockShapedChild` below) before it's folded into a
// paragraph as inline content: this is what lets an incidental nested
// heading (schema-legal inside a StarterKit blockquote, even though nothing
// in the UI creates one today) survive a conversion instead of vanishing,
// while still refusing a node — a table, chiefly — whose children are
// themselves block-shaped rather than inline.
const RECURSE_TYPES = new Set([
  "list", "listItem", "blockquote", "qaBlock", "qaPair", "recipeBlock", "decisionBlock",
]);

// A node the walk doesn't structurally recognize (heading, table, …) is
// only safe to fold into a paragraph's inline content when ITS children are
// genuinely inline (text, hardBreak, pinRef, pageRef, attachment,
// localImage, …) — none of those ever carry a nested `content` array of
// their own. A child that DOES carry one (tableRow inside table, tableCell
// inside tableRow, …) is a block-shaped structure masquerading as "just
// content". `table` is schema-legal nested inside a StarterKit blockquote
// ("block+"), a recipeBlock's structural (do) slot, or a decisionBlock's
// structural (considered) slot (both typed "block") — a real editor
// reproduces it with `insertTable` inside any of those. Before this check
// existed, the default branch wrapped it anyway, producing
// `paragraph(tableRow(tableCell(...)))`: `schema.nodeFromJSON` does not
// throw (it calls `type.create`, not `createChecked`), `tr.replaceWith`
// does not throw either, and the invalid node landed silently in the live
// doc — caught only by `doc.check()` after the fact, i.e. never, since
// nothing calls that on the hot path. Refusing here (both flattenToParagraphs
// and its codeBlock-target sibling collectPlainText, which used to just
// drop the table's text silently instead) beats guessing.
function hasBlockShapedChild(contentArr) {
  return (contentArr || []).some((c) => c && Array.isArray(c.content) && c.content.length > 0);
}

// Runs `fn` over each child, short-circuiting to `null` the moment any
// child itself refuses (`fn` returns `null`) — the propagation mechanism
// behind "refuse rather than guess": a table three levels down inside a
// list/blockquote/qaBlock nesting has to sink the WHOLE conversion, not
// just vanish from one branch of it. A plain `flatMap` can't short-circuit,
// hence the manual loop.
function flattenChildren(children, fn) {
  const out = [];
  for (const child of children || []) {
    const result = fn(child);
    if (result === null) return null;
    out.push(...result);
  }
  return out;
}

const RECIPE_LABELS = ["given: ", "do: ", "result: "];
const DECISION_LABELS = ["considered: ", "chose: ", "because: "];

// ── block-level atoms: carry the ones a text form loses nothing on ──
// A block-level atom has no `content` array at all, so the flatten walk has
// no text to lift out of it. Two different situations hide behind that one
// shape, and refusing on the shape alone conflated them:
//
//   - `horizontalRule` (what `/divider` inserts) carries NO data. It is a
//     separator and nothing else, so `---` is a COMPLETE rendering of it,
//     not a lossy summary — and it is already exactly how
//     `export/markdown.js` (`case "horizontalRule": body = "---"`)
//     serialises one, so carrying it here agrees with the one text
//     serialisation the app already ships. Refusing it instead made a
//     blockquote holding a divider offer no convert targets at all, which
//     is a far commoner block than one holding a chart.
//   - `chart` (a whole diagram spec), `dayMarker` and `dateSeparator` (both
//     app-stamped decorators carrying a date — dayMarker also the day's
//     focus, and CLAUDE.md has it excluded from word count, i.e. it is not
//     the user's writing) each carry data no paragraph can hold. Any text
//     invented for them drops something, and a lossy carry reads to the
//     user as a clean convert. Note that `dateSeparator` has no markdown
//     case at all — export drops it silently — so there is no shipped text
//     form to borrow, and inventing `---` for it would throw the date away.
//
// The line, stated once: carry an atom only when a text form of it loses
// nothing; refuse every atom that would lose something. A refusal the user
// can see (no rows offered) beats a silent partial delete.
const ATOM_TEXT = new Map([["horizontalRule", "---"]]);

function clone(json) {
  return JSON.parse(JSON.stringify(json));
}

function emptyParagraph() {
  return { type: "paragraph" };
}

// A flattened paragraph is rebuilt from scratch (type + content), which used
// to drop every attr — including `pinId`, silently orphaning a pin on a
// paragraph inside a converted blockquote. The `listItem` marker path
// deliberately preserves it; so does this one now. The pin's cached content
// still matches this paragraph's text, so the pointer stays honest. Only
// `pinId` carries over: `blockTitle` belongs to the BOARD being converted
// (convertBlockNode re-attaches it to the new board) and every other attr
// describes a shape this paragraph no longer has.
function keepPinId(sourceJson, rebuilt) {
  const pinId = sourceJson?.attrs?.pinId;
  return pinId ? { ...rebuilt, attrs: { ...(rebuilt.attrs || {}), pinId } } : rebuilt;
}

// The node-mode argument may arrive as a live ProseMirror `Node` rather than
// the `node.toJSON()` this module walks — that is the shape the caller has in
// hand (`doc.nodeAt(...)`), so it is the shape it will pass. A live Node
// passes `typeof === "object"`, but its `type` is a NodeType object (not a
// string) and its `content` a Fragment (not an array), so an un-normalised
// one fell through every branch below and produced `[]` — a sheet showing no
// convert rows at all, with nothing logged. Normalise here so a Node and its
// `toJSON()` are guaranteed the same answer.
function asNodeJson(source) {
  if (!source || typeof source !== "object") return null;
  if (typeof source.type === "string") return source;
  return typeof source.toJSON === "function" ? source.toJSON() : null;
}

/**
 * Which CONVERT_TARGETS a block can offer right now.
 *
 * `source` is EITHER a type name string (facts-only mode: the caller has a
 * DOM element and its `data-board`, nothing more) or the node itself —
 * `node.toJSON()` or the live ProseMirror `Node`, which `asNodeJson`
 * normalises to the same thing. `sourceAttrs` is the plain facts object used in
 * the first mode — today the only fact that matters is `marker` (a list's
 * current marker, read off one of its listItems since `list` itself carries
 * no marker attr; default "bullet" when omitted, matching the schema
 * default); it is ignored when a node is supplied, since the node knows.
 * Refuses anything not in CONVERTIBLE_TYPES, and never offers the shape the
 * block already is.
 *
 * Given a node, it also looks AHEAD into nested content and drops every
 * target `convertBlockNode` would refuse, so the sheet never shows a row
 * that silently no-ops when tapped. Without that lookahead a
 * table-bearing or atom-bearing board still offered rows that do nothing.
 * The flatten walk is run once: `flattenToParagraphs` and `collectPlainText`
 * refuse on identical inputs (same `hasBlockShapedChild` guard, same
 * block-level-atom default), so one is a faithful proxy for both. The
 * bullet/ordered/task marker path never flattens — `setListMarkerDeep`
 * rewrites attrs in place and preserves nested content — so those three
 * targets stay on offer regardless.
 */
export function convertTargetsFor(source, sourceAttrs = {}) {
  const sourceNodeJson = asNodeJson(source);
  const sourceTypeName = sourceNodeJson ? sourceNodeJson.type : source;
  if (!CONVERTIBLE_TYPES.includes(sourceTypeName)) return [];

  let flattenRefused = false;
  let flattenEmpty = false;
  if (sourceNodeJson) {
    const flattened = flattenToParagraphs(sourceNodeJson);
    flattenRefused = flattened === null;
    flattenEmpty = !flattenRefused && flattened.length === 0;
  }

  const marker = sourceNodeJson ? firstItemMarker(sourceNodeJson) : sourceAttrs?.marker;
  const currentMarker = sourceTypeName === "list" ? (marker || "bullet") : null;
  return CONVERT_TARGETS.filter((target) => {
    if (sourceTypeName === "list" && LIST_MARKER_TARGETS.has(target)) return target !== currentMarker;
    // Every remaining target routes through the flatten walk.
    if (flattenRefused) return false;
    // "paragraphs" is the one target whose empty result would be a delete
    // rather than an empty board — convertBlockNode refuses it, so don't
    // offer it either.
    if (flattenEmpty && target === "paragraphs") return false;
    if (sourceTypeName === "blockquote" && target === "blockquote") return false;
    if (sourceTypeName === "qaBlock" && target === "qaBlock") return false;
    if (sourceTypeName === "codeBlock" && target === "codeBlock") return false;
    return true;
  });
}

// ── list(bullet) ↔ list(ordered) ↔ list(task), preserving nesting ──
// Sets `marker` on EVERY listItem in the board, including nested lists —
// unified-list.js's own `setMarker` command only ever touches the cursor's
// single item, which is correct for interactive typing but wrong here: a
// board-level conversion means the WHOLE list changes shape at once.
// `checked` is kept only when converting INTO task (so task→task, were it
// ever reachable, would be a no-op); every other target drops it, since
// bullet/ordered markers never render a checkbox.
function setListMarkerDeep(nodeJson, target) {
  if (nodeJson.type === "list") {
    return { ...nodeJson, content: (nodeJson.content || []).map((li) => setListMarkerDeep(li, target)) };
  }
  if (nodeJson.type === "listItem") {
    const attrs = {
      ...nodeJson.attrs,
      marker: target,
      checked: target === "task" ? !!nodeJson.attrs?.checked : false,
    };
    const content = (nodeJson.content || []).map((child) =>
      child.type === "list" ? setListMarkerDeep(child, target) : child,
    );
    return { ...nodeJson, attrs, content };
  }
  return nodeJson;
}

function firstItemMarker(listJson) {
  return listJson.content?.[0]?.attrs?.marker || null;
}

// Prefix the FIRST text node of a paragraph with a plain-text label (the
// "Q:"/"A:"/slot labels are CSS-only today — see qa-block.js/recipe-block.js
// — so a label surviving a conversion into a shape that has no such CSS has
// to be baked into the text itself). Skipped on an empty paragraph — an
// empty slot/pair shouldn't sprout a lone label with nothing to attach it
// to.
function prefixParagraph(paragraphJson, label) {
  const content = paragraphJson.content;
  if (!label || !content || content.length === 0) return paragraphJson;
  // The label is always its OWN unmarked text node, never merged into the
  // first run. Merging (`{ ...first, text: label + first.text }`) made the
  // label inherit that run's marks, so a bold or linked answer rendered a
  // bold or linked "A: " — the label is structural text this module
  // synthesises, not the user's writing, and it carries no formatting.
  // Adjacent text nodes with identical marks are merged by ProseMirror on
  // `nodeFromJSON`, so an unmarked first run costs nothing here.
  return { ...paragraphJson, content: [{ type: "text", text: label }, ...content] };
}

// A fixed-slot board (recipeBlock/decisionBlock): flatten each slot in
// order, labeling the first paragraph THAT SLOT produces (the structural
// slot's own list items flatten to plain paragraphs first, per the v1
// matrix, and then the label lands on the first of those). Propagates a
// `null` from any slot straight up — a table sitting directly IN the
// structural slot (schema-legal: both slots are typed "block", a single
// arbitrary block, not restricted to a list) refuses the whole conversion
// the same as one nested deeper would.
function flattenSlotBlock(nodeJson, labels) {
  const children = nodeJson.content || [];
  const out = [];
  for (let i = 0; i < children.length; i++) {
    const flattened = flattenToParagraphs(children[i]);
    if (flattened === null) return null;
    if (flattened.length === 0) continue;
    const [first, ...rest] = flattened;
    out.push(prefixParagraph(first, labels[i]), ...rest);
  }
  return out;
}

// Text extraction for the codeBlock TARGET path only (collectPlainText and
// flattenCodeBlockToParagraphs) — the other targets keep paragraph content,
// hardBreak nodes included, completely intact (see flattenToParagraphs'
// paragraph case). Code has no equivalent of a soft line break, so a
// hardBreak here becomes a real newline instead of silently vanishing and
// welding the text on either side of it together.
function plainText(paragraphJson) {
  return (paragraphJson.content || [])
    .map((n) => (n.type === "text" ? n.text : n.type === "hardBreak" ? "\n" : ""))
    .join("");
}

function codeBlockText(nodeJson) {
  return (nodeJson.content || [])
    .map((n) => (n.type === "text" ? n.text : n.type === "hardBreak" ? "\n" : ""))
    .join("");
}

// codeBlock's content is `text*` — a saved doc stores its multi-line body
// as literal "\n" characters inside that text, so converting OUT of code
// means splitting on "\n" to recover one paragraph per line.
function flattenCodeBlockToParagraphs(nodeJson) {
  return codeBlockText(nodeJson)
    .split("\n")
    .map((line) => (line.length ? { type: "paragraph", content: [{ type: "text", text: line }] } : emptyParagraph()));
}

/**
 * Walk any convertible (or convertible-nested) node and return its content
 * as a flat array of paragraph node JSON, in document order — or `null` when
 * the walk hit a node it cannot represent as paragraph content (see
 * `hasBlockShapedChild`'s comment): a `null` at any depth propagates all the
 * way up (`flattenSlotBlock`/`flattenChildren`), so `convertBlockNode`
 * refuses the ENTIRE conversion rather than silently dropping just the
 * unrepresentable piece. This is the shared "lossy but text-preserving"
 * path every non-list-marker target (blockquote / qaBlock / paragraphs)
 * builds from; codeBlock uses the label-free sibling `collectPlainText`
 * instead (see its comment).
 */
function flattenToParagraphs(nodeJson) {
  if (!nodeJson) return [];
  switch (nodeJson.type) {
    case "paragraph":
      return [keepPinId(nodeJson, nodeJson.content ? { type: "paragraph", content: nodeJson.content } : emptyParagraph())];
    case "qaPair": {
      const [q, a] = nodeJson.content || [];
      return [prefixParagraph(q || emptyParagraph(), "Q: "), prefixParagraph(a || emptyParagraph(), "A: ")];
    }
    case "recipeBlock":
      return flattenSlotBlock(nodeJson, RECIPE_LABELS);
    case "decisionBlock":
      return flattenSlotBlock(nodeJson, DECISION_LABELS);
    case "codeBlock":
      return flattenCodeBlockToParagraphs(nodeJson);
    default: {
      if (RECURSE_TYPES.has(nodeJson.type)) return flattenChildren(nodeJson.content, flattenToParagraphs);
      // A block-level atom with a lossless text form (see ATOM_TEXT) is
      // carried as that text rather than refused. Checked before the
      // content-array branch so it cannot depend on whether the atom's JSON
      // happens to carry an empty `content: []`.
      const atomText = ATOM_TEXT.get(nodeJson.type);
      if (atomText !== undefined) return [{ type: "paragraph", content: [{ type: "text", text: atomText }] }];
      if (Array.isArray(nodeJson.content)) {
        // A table (tableRow children) or anything else block-shaped can't
        // be folded into a paragraph — refuse rather than guess.
        if (hasBlockShapedChild(nodeJson.content)) return null;
        // Any other textblock (e.g. a heading, schema-legal inside a
        // blockquote though nothing in the UI creates one) — its content
        // is genuinely inline-only, so treat it as one paragraph rather
        // than dropping it.
        return [keepPinId(nodeJson, { type: "paragraph", content: nodeJson.content })];
      }
      // A block-level atom NOT in ATOM_TEXT (chart, dayMarker,
      // dateSeparator) has no content array and no text form that keeps
      // what it holds, so folding it away would be a silent delete. Same
      // rule as hasBlockShapedChild above — refuse rather than guess.
      return null;
    }
  }
}

// codeBlock's target rule ("any convertible → codeBlock: concatenate
// textblocks with \n, marks stripped") is explicitly label-free, unlike the
// list/blockquote/qaBlock targets above — code is not a place for a "Q: "
// or "given: " label to show up inside. Mirrors flattenToParagraphs' walk
// (same `null`-propagates-refusal contract) but collects plain strings
// instead of paragraph nodes.
function collectPlainText(nodeJson) {
  if (!nodeJson) return [];
  switch (nodeJson.type) {
    case "paragraph":
      return [plainText(nodeJson)];
    case "qaPair":
      return flattenChildren(nodeJson.content, collectPlainText);
    case "recipeBlock":
    case "decisionBlock":
      return flattenChildren(nodeJson.content, collectPlainText);
    case "codeBlock":
      return [codeBlockText(nodeJson)];
    default: {
      if (RECURSE_TYPES.has(nodeJson.type)) return flattenChildren(nodeJson.content, collectPlainText);
      // Same line as flattenToParagraphs' default, drawn identically — the
      // two walks MUST refuse on exactly the same inputs, because
      // convertTargetsFor runs only the first one and treats it as a proxy
      // for both.
      const atomText = ATOM_TEXT.get(nodeJson.type);
      if (atomText !== undefined) return [atomText];
      if (Array.isArray(nodeJson.content)) {
        if (hasBlockShapedChild(nodeJson.content)) return null;
        return [plainText(nodeJson)];
      }
      // A block-level atom not in ATOM_TEXT (chart, dayMarker,
      // dateSeparator) has no content array and no text form that keeps what
      // it holds, so folding it away would be a silent delete.
      return null;
    }
  }
}

function buildList(paragraphs, target, blockTitle) {
  const items = (paragraphs.length ? paragraphs : [emptyParagraph()]).map((p) => ({
    type: "listItem",
    attrs: { marker: target, checked: false, blockTitle: null, pinId: null },
    content: [p],
  }));
  return { type: "list", attrs: { blockTitle, pinId: null }, content: items };
}

function buildBlockquote(paragraphs, blockTitle) {
  return { type: "blockquote", attrs: { blockTitle, pinId: null }, content: paragraphs.length ? paragraphs : [emptyParagraph()] };
}

// Pair textblocks 2-by-2 into qaPairs; an odd count synthesizes a trailing
// empty A rather than dropping the last Q on the floor.
function buildQaBlock(paragraphs, blockTitle) {
  const pairs = [];
  for (let i = 0; i < paragraphs.length; i += 2) {
    pairs.push({ type: "qaPair", content: [paragraphs[i], paragraphs[i + 1] || emptyParagraph()] });
  }
  if (pairs.length === 0) pairs.push({ type: "qaPair", content: [emptyParagraph(), emptyParagraph()] });
  return { type: "qaBlock", attrs: { blockTitle, pinId: null }, content: pairs };
}

function buildCodeBlock(sourceNodeJson, blockTitle) {
  const lines = collectPlainText(sourceNodeJson);
  if (lines === null) return null; // refused — see collectPlainText's comment
  const text = lines.join("\n");
  return {
    type: "codeBlock",
    attrs: { language: null, blockTitle, pinId: null },
    content: text.length ? [{ type: "text", text }] : [],
  };
}

/**
 * Convert one block's node JSON (`node.toJSON()`) to `target`. Returns:
 *   - a single node JSON object for every target except "paragraphs"
 *   - an array of paragraph node JSON for target "paragraphs"
 *   - null when the source type is refused, target isn't offered for this
 *     source (including "already this shape"), or inputs are malformed
 *
 * `blockTitle` survives onto the converted node (every board type has the
 * attr, per block-title.js's global registration); `pinId` does not — the
 * pin pointed at the OLD shape, and the converted node is a new shape it
 * never described. `schema` is accepted for API symmetry with the caller
 * (which needs it for `schema.nodeFromJSON`) but this function itself stays
 * schema-free — it only ever produces JSON shapes the app's own schema
 * already defines.
 *
 * Two more refusal cases beyond "wrong type" / "already this shape"
 * (F1/F2 from the round-1 review — see hasBlockShapedChild's and this
 * function's comments for the reasoning, not just the outcome):
 *   - the source contains a node the flattener cannot represent as
 *     paragraph/text content — either block-SHAPED (a table nested inside a
 *     blockquote or a recipeBlock/decisionBlock structural slot) or a
 *     block-level ATOM with no content array and no lossless text form
 *     (chart, dayMarker, dateSeparator; C2 of the final review, which found
 *     the atom half unimplemented and a nested chart silently dropped on all
 *     six targets — an atom that DOES have a lossless text form, today only
 *     `horizontalRule`, is carried instead: see ATOM_TEXT).
 *     `flattenToParagraphs`/
 *     `collectPlainText` return `null`, which this function turns into an
 *     overall `null` for EVERY target, not just the one that tripped over
 *     it, since the same unrepresentable node sits under all of them.
 *   - the "paragraphs" target specifically would otherwise produce an empty
 *     array (an empty board flattens to zero paragraphs) — unlike
 *     buildList/buildBlockquote/buildQaBlock, which
 *     all fall back to one empty paragraph, `paragraphs`' result goes
 *     straight into the caller's `tr.replaceWith`, and replacing a range
 *     with an empty array deletes it outright. A convert must never be a
 *     delete: `convertTargetsFor` deliberately does NOT try to predict this
 *     ahead of time (it would need the whole node tree, not just type +
 *     attrs facts) — refusing here, so the caller's `if (!converted) return`
 *     no-ops, is the cheap version of the same guarantee.
 */
export function convertBlockNode(sourceNodeJson, target, schema) { // eslint-disable-line no-unused-vars
  if (!sourceNodeJson || typeof sourceNodeJson !== "object") return null;
  const sourceType = sourceNodeJson.type;
  if (!CONVERTIBLE_TYPES.includes(sourceType) || !CONVERT_TARGETS.includes(target)) return null;

  const currentMarker = sourceType === "list" ? firstItemMarker(sourceNodeJson) : null;
  if (!convertTargetsFor(sourceType, { marker: currentMarker }).includes(target)) return null;

  const src = clone(sourceNodeJson);
  const blockTitle = src.attrs?.blockTitle ?? null;

  if (sourceType === "list" && LIST_MARKER_TARGETS.has(target)) {
    const converted = setListMarkerDeep(src, target);
    return { ...converted, attrs: { ...(converted.attrs || {}), blockTitle, pinId: null } };
  }
  if (LIST_MARKER_TARGETS.has(target)) {
    const paragraphs = flattenToParagraphs(src);
    return paragraphs === null ? null : buildList(paragraphs, target, blockTitle);
  }
  if (target === "blockquote") {
    const paragraphs = flattenToParagraphs(src);
    return paragraphs === null ? null : buildBlockquote(paragraphs, blockTitle);
  }
  if (target === "qaBlock") {
    const paragraphs = flattenToParagraphs(src);
    return paragraphs === null ? null : buildQaBlock(paragraphs, blockTitle);
  }
  if (target === "codeBlock") return buildCodeBlock(src, blockTitle);
  if (target === "paragraphs") {
    const paragraphs = flattenToParagraphs(src);
    // null (F1, unrepresentable content) or [] (F2, nothing but atoms) both
    // refuse — see the doc comment above for why [] can't just pass through.
    return paragraphs === null || paragraphs.length === 0 ? null : paragraphs;
  }
  return null;
}
