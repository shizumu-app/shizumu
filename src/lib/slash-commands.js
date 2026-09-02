import { placeMenu } from "./editor/menu-placement.js";
import { getViewportHeight } from "./keyboard-state.js";
import { isOutsideTap } from "./editor/outside-tap.js";
import { silentSuggestionRender } from "./editor/silent-suggestion-render.js";
import { Extension } from "@tiptap/core";
import { Suggestion, exitSuggestion } from "@tiptap/suggestion";
import { PluginKey, TextSelection } from "@tiptap/pm/state";
import { attachmentAddBytes } from "./api.js";
import { isImagePick, imageRejectionMessage } from "./editor/image-file-guard.js";
import { needsFreshLine, needsLeadingParagraph } from "./editor/slash-insert-target.js";
import { clampTableSize, gridCellsFor, moveHover, DEFAULT_HOVER, GRID_SIZE } from "./editor/table-size-picker.js";

// Pick a file with the WebView's native picker and read its bytes here. Works
// on every platform — including Android/iOS, where the picker returns a
// content:// URI the Rust fs layer can't read; reading the bytes in the
// WebView sidesteps that entirely. Resolves to {bytes, name, mime}, null on
// cancel, or {error} on a read failure.
function pickFileBytes(accept) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    let settled = false;
    const cleanup = () => { if (input.parentNode) input.parentNode.removeChild(input); };
    input.addEventListener("change", async () => {
      settled = true;
      const file = input.files && input.files[0];
      if (!file) { cleanup(); resolve(null); return; }
      try {
        const buf = await file.arrayBuffer();
        resolve({ bytes: new Uint8Array(buf), name: file.name || "untitled", mime: file.type || "" });
      } catch (err) {
        resolve({ error: err });
      } finally {
        cleanup();
      }
    }, { once: true });
    // If focus returns without a change firing, the user dismissed the picker.
    window.addEventListener("focus", function onFocus() {
      window.removeEventListener("focus", onFocus);
      setTimeout(() => { if (!settled) { cleanup(); resolve(null); } }, 600);
    }, { once: true });
    input.click();
  });
}

// Unique key — without this, Suggestion's default PluginKey("suggestion")
// collides with the @-trigger subtrail extension and ProseMirror only
// registers the last plugin, silently disabling /-commands.
//
// Exported because the plugin's state (active / range / query) is the only
// producer of a live `/` session, and a host that draws its own suggestion
// UI instead of this file's floating menu (see `floatingMenu` below) reads
// it through this key. A second `new PluginKey("slashCommands")` would not
// match — ProseMirror suffixes duplicate key names — so the key itself has
// to travel.
export const SlashCommandsPluginKey = new PluginKey("slashCommands");

// A block as the document's first node is a trap: ArrowUp from inside it
// goes to the block's own title, no gap cursor appears, and typing goes
// nowhere. This guard parks a blank paragraph above it.
//
// It used to fire for every board, which is why making the first block on
// a blank page left an empty line above it — the reported "it gets
// inserted one line below the current one". A board whose title slot can
// escape upward creates that paragraph on demand instead (title-slot.js's
// moveCursorBeforeBlock), so only the types with no way out still get one
// parked. needsLeadingParagraph owns that split.
function ensureLeadingParagraph(editor) {
  const first = editor.state.doc.firstChild;
  if (!first) return;
  if (needsLeadingParagraph(first.type.name)) {
    editor.commands.insertContentAt(0, { type: "paragraph" });
  }
}

// D-5 (QA sweep): /recipe and /q&a used to insert via
// editor.chain().insertContent(nodeJson).run() and then walk
// doc.descendants looking for the just-inserted node with
// `pos < cursorFrom`, assuming TipTap's post-insertContent selection lands
// AFTER the new block. In practice, when the "/" was typed into an
// (now-emptied-by-deleteRange) top-level paragraph, inserting a block-level
// node there makes ProseMirror escape the paragraph upward — and the
// selection doesn't reliably re-land inside the escaped block, so the walk
// found nothing (recipePos/qaPos stayed -1), leaving the cursor in the
// stray paragraph above the new block.
//
// Fix: build the insertion as one explicit transaction. If the leading
// paragraph the "/" was typed in is now empty, replace that whole paragraph
// with the new block (no stray paragraph survives) instead of inserting
// inside it; otherwise fall back to inserting the block as a sibling via
// the default insertContent path (unaffected — matches /table's existing
// behavior, which also doesn't hit this branch). Either way, the cursor is
// explicitly placed at the new block's first textblock — the generic
// "first textblock inside the inserted node" walk that /recipe and /q&a
// need. /table skips only THIS walk (insertTable lands the cursor in the
// first cell on its own); it still calls armPendingTitleFocus like every
// other board command, and "table" is in NODEVIEW_BOARD_TYPES below so that
// call is not a no-op — see the comment there.
// Find the first textblock inside `node` (mounted at doc position
// `nodePos`) and return the doc position just inside it — the slot the
// cursor should land in (given/Q for recipe/qa respectively). -1 if the
// node has no textblock descendant.
function firstTextblockContentPos(node, nodePos) {
  let contentPos = -1;
  node.descendants((n, p) => {
    if (contentPos >= 0) return false;
    if (n.isTextblock) { contentPos = nodePos + 1 + p + 1; return false; }
    return true;
  });
  return contentPos;
}

function insertBoardReplacingEmptyLeadingParagraph(editor, range, nodeJson) {
  editor.chain().focus().deleteRange(range).run();
  const { state, view } = editor;
  const $from = state.selection.$from;
  const atTopLevelEmptyParagraph =
    $from.depth === 1 &&
    $from.parent.type.name === "paragraph" &&
    $from.parent.content.size === 0;

  if (!atTopLevelEmptyParagraph) {
    // Slash was typed alongside other content (not the paragraph's sole
    // content) or nested inside another block — fall back to the generic
    // path, which lets schema-driven auto-escape do its thing as before.
    editor.chain().focus().insertContent(nodeJson).run();
    // Coordinator branch-review fix (item 6): place the cursor inside the
    // freshly-inserted node's first textblock here too, same as the
    // empty-leading-paragraph path below — insertContent's default
    // post-insert selection isn't reliable once schema-driven auto-escape
    // has moved the node around (the same root cause D-5 was about).
    // Walk back from the cursor to find the just-inserted node (mirrors
    // the pre-fix lookup this path used to have, minus the broken
    // `pos < cursorFrom` cursor-placement it never actually did after
    // insertContent's own selection is already past the insert point).
    const cursorFrom = editor.state.selection.from;
    let nodePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === nodeJson.type && pos < cursorFrom && pos > nodePos) {
        nodePos = pos;
      }
    });
    if (nodePos >= 0) {
      const insertedNode = editor.state.doc.nodeAt(nodePos);
      const contentPos = insertedNode ? firstTextblockContentPos(insertedNode, nodePos) : -1;
      if (contentPos >= 0) {
        editor.chain().setTextSelection(contentPos).focus().run();
      }
    }
    return;
  }

  const paraStart = $from.before(1);
  const paraEnd = $from.after(1);
  const node = state.schema.nodeFromJSON(nodeJson);
  let tr = state.tr.replaceWith(paraStart, paraEnd, node);

  const inserted = tr.doc.nodeAt(paraStart);
  const contentPos = inserted ? firstTextblockContentPos(inserted, paraStart) : -1;
  if (contentPos >= 0) {
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(contentPos), 1));
  }
  view.dispatch(tr);
  editor.commands.focus();
}

// Board types whose NodeView honors BlockTitle.storage.pendingFocusPos —
// not only the createBoardNodeView types (block-title.js's NODEVIEW_TYPES),
// but also table (ShellTableView, table-shell-view.js), which wires its own
// title slot in by hand and calls consumePendingFocus() itself. After the
// list-marker redesign there's only one list container, so the set drops
// from five entries to three. recipeBlock (Plan 1c, task-1-brief.md step
// A3) was missing here even though it's a createBoardNodeView type —
// /recipe's armPendingTitleFocus call below was a silent no-op without it.
// table (fix round 1) had the identical bug: armPendingTitleFocus below was
// already being called by /table, but the set never included "table", so
// it was a no-op even though ShellTableView has always been ready to honor
// it once it landed.
const NODEVIEW_BOARD_TYPES = new Set([
  "list", "blockquote", "qaBlock", "recipeBlock", "decisionBlock", "table",
]);

// After a board-creating slash command runs, hand the inserted node's doc
// position to the BlockTitle extension's storage. The freshly-mounted
// NodeView reads it and enters edit mode on its title slot, so the user
// types title → Enter → cursor lands inside the first item without ever
// seeing a popup.
function armPendingTitleFocus(editor) {
  if (!editor) return;
  const selFrom = editor.state.selection.from;
  let pos = -1;
  let nodeName = null;
  editor.state.doc.forEach((node, offset) => {
    if (pos >= 0) return;
    if (selFrom >= offset && selFrom <= offset + node.nodeSize) {
      pos = offset;
      nodeName = node.type.name;
    }
  });
  if (pos < 0 || !NODEVIEW_BOARD_TYPES.has(nodeName)) return;
  if (!editor.storage?.blockTitle) return;
  editor.storage.blockTitle.pendingFocusPos = pos;
}

export const commandItems = [
  { title: "heading 1", description: "page title", section: "structure", shortcut: "#",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run() },
  { title: "heading 2", description: "section heading", section: "structure", shortcut: "##",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run() },
  { title: "heading 3", description: "sub-section", section: "structure", shortcut: "###",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run() },
  // Marker commands — every conversion goes through setMarker. Outside a list
  // the command wraps; inside a list it flips the marker on the current item.
  // /text on the sole item of a list unwraps the frame (decision A).
  { title: "task", description: "checkbox", section: "lists", shortcut: "[ ]",
    command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).setMarker("task").run();
    ensureLeadingParagraph(editor);
    armPendingTitleFocus(editor);
  }},
  { title: "bullet", description: "unordered", section: "lists", shortcut: "-",
    command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).setMarker("bullet").run();
    ensureLeadingParagraph(editor);
    armPendingTitleFocus(editor);
  }},
  { title: "numbered", description: "ordered", section: "lists", shortcut: "1.",
    command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).setMarker("ordered").run();
    ensureLeadingParagraph(editor);
    armPendingTitleFocus(editor);
  }},
  { title: "text", description: "remove marker", section: "structure",
    command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).setMarker("plain").run();
  }},
  // strikethrough — the brand's explicit alternative to delete. The /
  // command toggles the strike mark across the current selection (or
  // does nothing on an empty cursor; selecting text after typing
  // /strikethrough is acceptable). The bubble menu and Mod-Shift-X
  // chord cover the in-flow gesture.
  { title: "strikethrough", description: "cross out, don't delete", section: "inline & code", shortcut: "~~",
    command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).toggleStrike().run();
  }},
  // code — inline monospace span. Toggles the existing TipTap `code`
  // mark on the current selection.
  { title: "code", description: "inline monospace", section: "inline & code", shortcut: "`",
    command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).toggleCode().run();
  }},
  // codeblock — fenced monospace block (StarterKit's CodeBlock node).
  // setCodeBlock walks up; schemas that don't accept it (listItem)
  // auto-escape, matching the divider's behavior.
  { title: "code block", description: "fenced snippet", section: "inline & code", shortcut: "```",
    command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).setCodeBlock().run();
    ensureLeadingParagraph(editor);
  }},
  // Selecting this row doesn't insert directly — the Suggestion renderer
  // (below) swaps the menu's item list for a row×col size grid instead
  // (renderTableSizeGrid) and calls this command with the chosen size once
  // the grid commits. `size` defaults to the old hardcoded 3×3 so every
  // existing/other caller of this command (tests included) keeps working
  // unchanged. clampTableSize is the floor: withHeaderRow:true makes
  // rows:1 a header-only table with no body row, so rows never drops
  // below 2 even if something calls this command directly with a bad size.
  { title: "table", description: "rows × cols", section: "shizumu blocks",
    command: ({ editor, range }, size = { rows: 3, cols: 3 }) => {
    const { rows, cols } = clampTableSize(size);
    // Plain insertTable. PM's replaceSelectionWith walks up to find a valid
    // parent — schemas that don't accept a table (listItem) auto-escape;
    // schemas that do (qaBlock, blockquote) nest. No explicit escape needed.
    editor.chain().focus().deleteRange(range).insertTable({ rows, cols, withHeaderRow: true }).run();
    ensureLeadingParagraph(editor);
    armPendingTitleFocus(editor);
  } },
  { title: "outline", description: "structure your thinking", section: "shizumu blocks",
    command: ({ editor, range }) => {
    // toggleBlockquote wraps the current paragraph in a blockquote. Inside
    // a list item, the blockquote nests as a child block. At top level, it's
    // a top-level block. Both correct.
    editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    ensureLeadingParagraph(editor);
    armPendingTitleFocus(editor);
  } },
  // /recipe — typeset structure for procedural thinking.
  // Three slots: given paragraph · do (middle block — list by default) ·
  // result paragraph. Labels and placeholders rendered via CSS in
  // prose.css. Tab/Shift-Tab walks slots; Enter on an empty slot
  // advances to the next; Enter on empty result exits.
  { title: "recipe", description: "given · do · result", section: "shizumu blocks",
    command: ({ editor, range }) => {
    insertBoardReplacingEmptyLeadingParagraph(editor, range, {
      type: "recipeBlock",
      content: [
        { type: "paragraph" },
        {
          type: "list",
          content: [
            {
              type: "listItem",
              attrs: { marker: "ordered" },
              content: [{ type: "paragraph" }],
            },
          ],
        },
        { type: "paragraph" },
      ],
    });
    ensureLeadingParagraph(editor);
    armPendingTitleFocus(editor);
  }},
  // /decision — typeset structure for a decision: what was weighed, what
  // was chosen, and why. Sibling of /recipe (see decision-block.js); the
  // structural slot (a list by default) sits FIRST here (considered),
  // unlike recipe's middle "do" slot.
  { title: "decision", description: "considered · chose · because", section: "shizumu blocks",
    command: ({ editor, range }) => {
    insertBoardReplacingEmptyLeadingParagraph(editor, range, {
      type: "decisionBlock",
      content: [
        {
          type: "list",
          content: [
            {
              type: "listItem",
              attrs: { marker: "bullet" },
              content: [{ type: "paragraph" }],
            },
          ],
        },
        { type: "paragraph" },
        { type: "paragraph" },
      ],
    });
    ensureLeadingParagraph(editor);
    armPendingTitleFocus(editor);
  }},
  // /chart — visual diagram builder. Opens the ChartBuilder modal in
  // "create" mode via the chart extension's openChartBuilder command.
  // The slash range is consumed first so the modal opens on a clean
  // cursor position; insertChart (called on save) inserts at the
  // current selection.
  { title: "chart", description: "visual diagram", section: "shizumu blocks",
    command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).run();
    editor.commands.openChartBuilder({ mode: "create" });
  }},
  { title: "q&a", description: "question and answer", section: "shizumu blocks",
    command: ({ editor, range }) => {
    // Build a qaBlock with a single empty qaPair. The "Q:" / "A:" prefixes
    // render via CSS (prose.css) so they stay typed in warm-accent and the
    // content paragraphs themselves stay clean — Backspace at start of an
    // empty Q can then remove the pair without first deleting the prefix.
    insertBoardReplacingEmptyLeadingParagraph(editor, range, {
      type: "qaBlock",
      content: [
        {
          type: "qaPair",
          content: [
            { type: "paragraph" },
            { type: "paragraph" },
          ],
        },
      ],
    });
    ensureLeadingParagraph(editor);
    armPendingTitleFocus(editor);
  }},
  { title: "blockquote", description: "quoted text", section: "inline & code", shortcut: ">",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setBlockquote().run() },
  { title: "divider", description: "horizontal line", section: "inline & code", shortcut: "---",
    command: ({ editor, range }) => {
    // setHorizontalRule walks up; schemas that don't accept hr (listItem)
    // auto-escape, schemas that do (qaBlock, blockquote) nest.
    editor.chain().focus().deleteRange(range).setHorizontalRule().run();
  }},
  // One image command. There used to be a second, `/inline image`, which
  // inserted the same node with display: "inline" and collapsed: true — and
  // a collapsed image is a chip that flows in the sentence regardless of its
  // display mode (global.css: [data-collapsed="true"] { display: inline }).
  // So the two commands produced two things that render identically the
  // moment either is collapsed, and the only way to tell them apart was to
  // expand them. Collapsing an image IS the inline form; it doesn't need its
  // own command.
  { title: "image", description: "insert local image", section: "shizumu blocks",
    command: async ({ editor, range }) => {
    // Capture insertion position BEFORE awaiting. deleteRange runs
    // synchronously; the await suspends and the editor's selection
    // state may shift in the meantime.
    editor.chain().focus().deleteRange(range).run();
    const insertPos = editor.state.selection.from;
    const toast = editor.options?.element?.__shizumuShowToast;
    const picked = await pickFileBytes("image/*");
    // Every abandon below gives the opened line back — see
    // discardOpenedLine. Silent on cancel is right; a blank line is not
    // silent.
    if (!picked) { discardOpenedLine(editor, range); return; }
    if (picked.error) {
      discardOpenedLine(editor, range);
      if (toast) toast(`couldn't read image: ${picked.error.message || picked.error}`);
      return;
    }
    // `accept="image/*"` is a picker HINT, not a gate — every desktop file
    // dialog offers an "all files" escape hatch. Without this check a PDF
    // got stored with kind "image" and inserted as an image node, which
    // renders as a broken picture the user can neither explain nor undo
    // from inside the app. Refuse before the blob is written, and say what
    // WOULD work rather than only that this didn't. See
    // editor/image-file-guard.js for the two-signal rule.
    if (!isImagePick(picked)) {
      discardOpenedLine(editor, range);
      if (toast) toast(imageRejectionMessage(picked));
      return;
    }
    try {
      // Same blob store, same attachments row, same per-item sync decision
      // as /file — an image is an attachment that happens to render itself.
      // Local-first: sync=false until the user authorizes it on the image.
      const att = await attachmentAddBytes(picked.bytes, picked.name, picked.mime, false);
      // insertContentAt(insertPos, ...) — schemas that don't accept the node
      // (listItem) auto-escape; schemas that do nest naturally.
      editor.chain().focus()
        .insertContentAt(insertPos, {
          type: "attachment",
          attrs: {
            kind: "image",
            blob_hash: att.blob_hash,
            filename: att.filename,
            mime_type: att.mime_type,
            size_bytes: att.size_bytes,
            sync: att.sync,
            created_at: att.created_at,
            display: "block",
          },
        })
        .run();
    } catch (err) {
      if (toast) toast(`couldn't insert image: ${err.message || err}`);
    }
  }},
  // /file — attach an arbitrary file via the system file picker. Stored
  // in the content-addressed blob store (see attachment_add command),
  // inserted as an `attachment` node (see extensions/attachment.js).
  // Sync defaults to true; the AttachmentBlock node view exposes a
  // local-only toggle on the chip.
  { title: "file", description: "attach a file", section: "shizumu blocks",
    command: async ({ editor, range }) => {
      // Capture insertion position BEFORE awaiting. deleteRange runs
      // synchronously; the await suspends and the editor's selection
      // state may shift in the meantime.
      editor.chain().focus().deleteRange(range).run();
      const insertPos = editor.state.selection.from;
      const toast = editor.options?.element?.__shizumuShowToast;
      const picked = await pickFileBytes();
      // Same as /image: give the opened line back rather than leaving a
      // blank one where a file was asked for.
      if (!picked) { discardOpenedLine(editor, range); return; }
      if (picked.error) {
        discardOpenedLine(editor, range);
        if (toast) toast(`couldn't read file: ${picked.error.message || picked.error}`);
        return;
      }
      try {
        // Local-first: attach without syncing. The user authorizes sync
        // later from the attachment's hover action if they want it to roam.
        const att = await attachmentAddBytes(picked.bytes, picked.name, picked.mime, false);
        editor.chain().focus()
          .insertContentAt(insertPos, {
            type: "attachment",
            attrs: {
              kind: "file",
              blob_hash: att.blob_hash,
              filename: att.filename,
              mime_type: att.mime_type,
              size_bytes: att.size_bytes,
              sync: att.sync,
              created_at: att.created_at,
            },
          })
          .run();
      } catch (err) {
        if (toast) toast(`couldn't attach file: ${err.message || err}`);
      }
    }
  },
];

// Exported because a host that draws its own suggestion UI has to filter
// by the same rule this menu does. The mobile shell's chip strip carried a
// hand-copy of the one line below for a phase, which is a second answer to
// "does this command match what was typed" waiting to drift.
export function filterItems(query) {
  return commandItems.filter((item) =>
    item.title.toLowerCase().includes(query.toLowerCase())
  );
}

// The menu RENDERS items grouped by section, but selectedIndex, the keyboard
// nav, and the click handler all index into `currentItems`. So `currentItems`
// MUST be in the same order the rows are displayed — otherwise the highlighted
// (or clicked) row and the executed command diverge. (Concretely: "table" was
// displayed at grouped index 12, but the ungrouped array's slot 12 held
// "recipe", so picking "table" inserted the recipe block.) Group here so the
// rendered order and the index space are identical. renderItems re-groups the
// already-grouped list idempotently, so display index == currentItems index.
function orderBySection(items) {
  const sections = [];
  const byName = new Map();
  for (const item of items) {
    const name = item.section || "";
    if (!byName.has(name)) {
      byName.set(name, []);
      sections.push(name);
    }
    byName.get(name).push(item);
  }
  return sections.flatMap((name) => byName.get(name));
}

// Plain DOM floating menu — no framework dependency. Cosmetic styling
// (surface bg, card-border hairline, elevation, radius-md, row hover/
// selected states) lives in global.css under `.slash-command-menu` and
// friends, so this menu carries the same floating-chrome look as the
// app's other popups (CommandPalette's .palette). Only positioning
// (fixed/z-index/top/left/display), which positionMenu() computes
// per-render from the caret's coordinates, stays inline here.
export function createMenu() {
  const el = document.createElement("div");
  el.className = "slash-command-menu";
  el.style.cssText = `
    position: fixed;
    z-index: 200;
    display: none;
  `;
  document.body.appendChild(el);
  return el;
}

export function renderItems(el, items, selectedIndex, onSelect) {
  el.innerHTML = "";
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "slash-command-menu-empty";
    empty.textContent = "no matches";
    el.appendChild(empty);
    return;
  }

  // Group by section in insertion order so we don't shuffle the
  // user-facing list when filtering. Items without a section land in a
  // trailing unlabeled bucket.
  const sections = [];
  const byName = new Map();
  for (const item of items) {
    const name = item.section || "";
    if (!byName.has(name)) {
      byName.set(name, []);
      sections.push(name);
    }
    byName.get(name).push(item);
  }

  let absoluteIndex = 0;
  for (const name of sections) {
    if (name) {
      const header = document.createElement("div");
      header.className = "slash-section-header";
      header.textContent = name;
      el.appendChild(header);
    }
    for (const item of byName.get(name)) {
      const i = absoluteIndex++;
      const btn = renderRow(item, i, selectedIndex, onSelect, el);
      el.appendChild(btn);
    }
  }

  const selBtn = el.querySelectorAll("button")[selectedIndex];
  if (selBtn && typeof selBtn.scrollIntoView === "function") {
    selBtn.scrollIntoView({ block: "nearest" });
  }
}

function renderRow(item, i, selectedIndex, onSelect, container) {
  const btn = document.createElement("button");
  btn.className = "slash-command-row";
  if (i === selectedIndex) btn.classList.add("selected");
  btn.onmouseenter = () => {
    container.querySelectorAll("button").forEach((b, j) => {
      b.classList.toggle("selected", j === i);
    });
  };
  // Swallow mousedown, the same guard every editor toolbar in
  // TipTapEditor.svelte carries. Without it a tap moves focus out of the
  // editor: the IME closes, the visible viewport grows back, --kb-inset and
  // --app-height change, and the shell reflows before the click resolves.
  //
  // That comment says the block-handles column "was the only editor toolbar
  // IN THIS FILE missing it" -- true, and this menu is in another file, so
  // the sweep never reached it. The menu itself is position:fixed on
  // document.body and so does not move under the finger, which is why this
  // reads as a keyboard flicker on every slash insert rather than a dead
  // button.
  btn.onmousedown = (e) => e.preventDefault();
  btn.onclick = () => onSelect(i);

  const body = document.createElement("span");
  body.className = "slash-command-row-body";

  const title = document.createElement("span");
  title.className = "slash-command-title";
  title.textContent = item.title;

  const desc = document.createElement("span");
  desc.className = "slash-command-desc";
  desc.textContent = item.description;

  body.appendChild(title);
  body.appendChild(desc);
  btn.appendChild(body);

  if (item.shortcut) {
    const chip = document.createElement("span");
    chip.className = "slash-shortcut";
    chip.textContent = item.shortcut;
    btn.appendChild(chip);
  }

  return btn;
}

// /table's size grid (Task 3) — rendered INSIDE the same menuEl the item
// list normally occupies, replacing it (see the "table" selectCallback
// branch in the Suggestion renderer below). Reusing the menu node this way
// gets its outside-tap dismissal and floating-chrome CSS for free instead
// of standing up a second popover — see the task brief for why a Svelte
// Popover doesn't fit here (menuEl is a raw DOM node with no Svelte
// anchor).
//
// All SIZE decisions (which cell means what, clamping, arrow-key movement)
// live in editor/table-size-picker.js; this function only builds/paints
// DOM. Hover preview uses `pointerenter`, which real touch taps never
// fire — so on a coarse pointer there's no hover step at all, and `onclick`
// (fired on tap) commits directly. That's requirement 3 in the brief
// ("on touch, tapping a cell commits directly") falling out of the normal
// pointer-event model rather than needing a `pointer: coarse` branch here.
//
// Returns a small controller so the Suggestion renderer's onKeyDown (the
// only place keydown events reach — see the addKeyboardShortcuts comment
// on SlashCommands below) can drive the grid from the keyboard: arrow keys
// move the hover cell, Enter commits whatever is currently highlighted.
//
// Accessibility (fix round 1): grid/row/gridcell roles on the cell tree
// (see the comment at gridOuter below for why "row" lands on the flat CSS
// grid container rather than six per-row wrapper divs); each cell's own
// aria-label states the clamped size IT would commit ("3 by 2"), so a
// screen reader announces coordinates without relying on the visual
// rectangle; the caption is aria-live="polite" so the "cols × rows"
// reading is announced as the highlight moves (it already reads off
// gridCellsFor's clamped size, so the snapped-to-2 case announces the
// snapped value, never the raw hovered row).
export function renderTableSizeGrid(menuEl, { onCommit, onBack, initialHover } = {}) {
  menuEl.innerHTML = "";

  let hover = initialHover || DEFAULT_HOVER;

  const wrap = document.createElement("div");
  wrap.className = "slash-table-grid";

  const back = document.createElement("button");
  back.type = "button";
  back.className = "slash-table-grid-back";
  back.textContent = "‹ table";
  back.onclick = () => onBack?.();
  wrap.appendChild(back);

  // ARIA: this is a flat CSS grid — 36 button children of one container,
  // no per-visual-row wrapper element. A conforming grid/row/gridcell tree
  // still needs a "row" layer between "grid" and "gridcell"; rather than
  // splitting into six wrapper divs the visual layout doesn't otherwise
  // need, `gridOuter` carries role="grid" and `cellsEl` (the flat CSS grid
  // container) stands in as the one row underneath it.
  const gridOuter = document.createElement("div");
  gridOuter.className = "slash-table-grid-cells-outer";
  gridOuter.setAttribute("role", "grid");
  gridOuter.setAttribute("aria-label", "table size");

  const cellsEl = document.createElement("div");
  cellsEl.className = "slash-table-grid-cells";
  cellsEl.setAttribute("role", "row");
  const cells = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "slash-table-grid-cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute("role", "gridcell");
      // Static per-cell label — the size THIS cell would commit, clamped
      // the same way gridCellsFor clamps the live hover (so the grid's
      // top row reads "by 2", never the un-clamped "by 1").
      const ownSize = gridCellsFor({ row, col });
      cell.setAttribute("aria-label", `${ownSize.cols} by ${ownSize.rows}`);
      cell.onpointerenter = () => setHover({ row, col });
      cell.onclick = () => commit({ row, col });
      cellsEl.appendChild(cell);
      cells.push(cell);
    }
  }
  gridOuter.appendChild(cellsEl);
  wrap.appendChild(gridOuter);

  const caption = document.createElement("div");
  caption.className = "slash-table-grid-caption";
  caption.setAttribute("aria-live", "polite");
  wrap.appendChild(caption);

  menuEl.appendChild(wrap);

  function paint() {
    const size = gridCellsFor(hover);
    for (const cell of cells) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      cell.classList.toggle("in-range", row < size.rows && col < size.cols);
    }
    caption.textContent = `${size.cols} × ${size.rows}`;
  }

  function setHover(next) {
    hover = next;
    paint();
  }

  function commit(cellHover) {
    hover = cellHover;
    onCommit?.(gridCellsFor(hover));
  }

  paint();

  return {
    moveHover: (key) => setHover(moveHover(hover, key)),
    commit: () => commit(hover),
  };
}

// Place the menu below the caret by default; flip above or clamp to the
// viewport so the full list is always reachable even near window edges.
// On mobile, the visible viewport (excluding the soft keyboard) is used
// as the height bound — making the menu flip above the caret when the
// keyboard would otherwise cover it.
function positionMenu(menuEl, rect) {
  if (!menuEl || !rect) return;
  menuEl.style.visibility = "hidden";
  menuEl.style.top = "0px";
  menuEl.style.left = "0px";
  menuEl.style.maxHeight = "";
  menuEl.style.display = "block";

  const cs = getComputedStyle(document.documentElement);
  const px = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const { top, left, maxHeight } = placeMenu({
    caretRect: rect,
    menuH: menuEl.offsetHeight,
    menuW: menuEl.offsetWidth,
    // getViewportHeight() reads --app-height, kept current by
    // keyboard-state.js (the app's single viewport-state owner).
    vh: getViewportHeight(),
    vw: window.innerWidth,
    // Read the insets through the same --safe-* variables the rest of the
    // app uses, so the VR harness's ?inset=notch override reaches here too.
    safeTop: px(cs.getPropertyValue("--safe-top")),
    safeBottom: px(cs.getPropertyValue("--safe-bottom")),
  });

  menuEl.style.top = `${top}px`;
  menuEl.style.left = `${left}px`;
  // A menu taller than the space it has must scroll. Without this it simply
  // ran off the bottom of the screen and its last section was unreachable.
  menuEl.style.maxHeight = `${maxHeight}px`;
  menuEl.style.overflowY = "auto";
  menuEl.style.visibility = "visible";
}

/**
 * Consume the typed "/query" and put the cursor where the chosen command
 * should act, then hand every command a collapsed range so its own
 * `deleteRange(range)` becomes a no-op.
 *
 * This is where "create a new block, on a new line" happens. A block
 * command run on a line that already has writing on it used to CONSUME
 * that writing — `/outline` wrapped the sentence the user had just
 * written, `/task` turned it into a checklist item — because every
 * command converts whatever textblock the cursor is in. The user asked
 * for a new block, not for their paragraph to become one.
 *
 * So a block command run on a written line gets a fresh empty paragraph
 * below it to land in, and the original line is left exactly as typed.
 * On an empty line nothing changes: converting the blank line you are
 * standing on is right, and inserting below would strand an empty
 * paragraph above every block you make. Conversions (`/heading 1`,
 * `/text`, the mark toggles) always act in place — see
 * editor/slash-insert-target.js for that split and why.
 *
 * Scoped to top-level textblocks ($from.depth === 1). Inside a list item
 * or a board, the schema's own auto-escape already decides where a block
 * can go, and second-guessing it here would fight rules this doesn't own.
 *
 * @returns {{from: number, to: number}} a collapsed range at the cursor.
 */
// Exported for the same reason as filterItems above: the shell reimplemented
// this as `insertionPoint` because it was private, and a hand-copy of where a
// block lands is exactly the kind of duplicate that goes wrong quietly. See
// this function's own header for why the rule is not obvious.
export function prepareInsertionPoint(editor, range, title) {
  editor.chain().focus().deleteRange(range).run();
  const { state } = editor;
  const { $from } = state.selection;
  const lineHasOtherText = $from.parent.isTextblock && $from.parent.content.size > 0;
  // Did WE open this line? The async commands need to know, because they
  // open it before suspending and a cancelled pick would otherwise leave
  // it behind — see `openedLine` in the return, and discardOpenedLine.
  let openedLine = false;
  if ($from.depth === 1 && needsFreshLine(title, lineHasOtherText)) {
    try {
      const after = $from.after(1);
      let tr = state.tr.insert(after, state.schema.nodes.paragraph.create());
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1), 1));
      editor.view.dispatch(tr);
      editor.commands.focus();
      openedLine = true;
    } catch {
      // Leave the cursor where it is rather than abandoning the command:
      // acting in place is the old behaviour, not a broken one.
    }
  }
  const pos = editor.state.selection.from;
  return { from: pos, to: pos, openedLine };
}

/**
 * Undo the fresh line prepareInsertionPoint opened, when the command that
 * asked for it produced nothing.
 *
 * `/image` and `/file` open the line BEFORE awaiting a picker, because the
 * insertion point has to be captured before the dialog can move the
 * selection. Cancel the dialog — or pick a PDF for `/image`, which is
 * refused on purpose — and that paragraph stayed behind: the writer asked
 * for a picture, got no picture, and got a blank line instead.
 *
 * Only removes a line this call opened (`openedLine`), and only while it is
 * still empty. Typing on an already-empty line the writer owned, or into
 * the fresh one before cancelling, both leave it alone — deleting a line
 * with something on it would be a worse bug than the one being fixed.
 */
export function discardOpenedLine(editor, range) {
  if (!range?.openedLine || !editor || editor.isDestroyed) return false;
  try {
    const { $from } = editor.state.selection;
    if ($from.depth !== 1) return false;
    if (!$from.parent.isTextblock || $from.parent.content.size !== 0) return false;
    const from = $from.before(1);
    editor.view.dispatch(editor.state.tr.delete(from, from + $from.parent.nodeSize));
    return true;
  } catch {
    return false;
  }
}

export const SlashCommands = Extension.create({
  name: "slashCommands",
  // Higher priority than the unified list extension so the Suggestion
  // plugin's keydown (Enter to pick a command) fires before the list keymap
  // (Enter to split an item). Without this, picking from the slash menu
  // inside a nested list silently splits the item instead of inserting.
  priority: 1000,

  addStorage() {
    // Task 3: true while the menu has swapped its item list for /table's
    // row×col grid. addKeyboardShortcuts' Escape binding below reads this
    // — see the comment there for why Escape can't just be handled inside
    // the Suggestion renderer's own onKeyDown like every other key.
    return { tableGridActive: false, exitTableGrid: null };
  },

  addKeyboardShortcuts() {
    // @tiptap/suggestion's own handleKeyDown calls dispatchExit
    // UNCONDITIONALLY on Escape (after calling the renderer's onKeyDown,
    // ignoring its return value) — closing the WHOLE menu. There is no way
    // to stop that from inside the Suggestion renderer below, so the grid
    // can't "return to the item list" on Escape the way it handles every
    // other key. TipTap's ExtensionManager builds each extension's keymap
    // plugin (from addKeyboardShortcuts, here) BEFORE its
    // addProseMirrorPlugins() output, so this binding's handleKeyDown
    // always runs first: while the grid is open we swallow Escape here and
    // Suggestion's own handler never sees it. Any other time (grid not
    // open) this returns false and Suggestion's default Escape handling —
    // closing the menu — runs exactly as it did before this task.
    return {
      Escape: () => {
        if (this.storage.tableGridActive && this.storage.exitTableGrid) {
          this.storage.exitTableGrid();
          return true;
        }
        return false;
      },
    };
  },

  addOptions() {
    return {
      // Draw the floating menu, or leave the plugin bare.
      //
      // The suggestion plugin and the menu it feeds are separable: the
      // plugin tracks active/range/query off transactions, `render` below
      // turns that into DOM. A host with its own suggestion surface (the
      // mobile shell's chip strip, spec §3: "no floating slash/mention
      // menu") passes false and keeps the state machine — see
      // editor/silent-suggestion-render.js for why that is safe and what
      // the substituted handlers must not do.
      //
      // Not the same as leaving this extension out of the editor. Removing
      // it removes the state too, and the host is left reading a plugin
      // that no longer exists.
      floatingMenu: true,
      suggestion: {
        char: "/",
        pluginKey: SlashCommandsPluginKey,
        command: ({ editor, range, props }) => {
          // The range is consumed once here, not by each command, so the
          // cursor can be moved to a fresh line in between. Every command
          // then receives a collapsed range and its own deleteRange is a
          // harmless no-op. See prepareInsertionPoint.
          props.command({ editor, range: prepareInsertionPoint(editor, range, props.title) });
        },
      },
    };
  },

  addProseMirrorPlugins() {
    const ext = this;
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        // Order matters — pluginKey must win over anything in the spread.
        // In some production-bundle paths (Vite + chunk-split + tree-shaking)
        // `this.options.suggestion.pluginKey` was being lost between extension
        // configure and addProseMirrorPlugins, causing both this and
        // SubtrailCommand to fall back to Suggestion's internal default key
        // (`suggestion$`) and collide. Hardcoding here is belt-and-suspenders.
        pluginKey: SlashCommandsPluginKey,

        items: ({ query }) => filterItems(query),

        // Everything above this line is the same plugin either way — the
        // key, the trigger char, the item source, and the active/range/
        // query state a host reads back. Only the renderer is optional.
        // `=== false` and not merely falsy: turning a menu off is a
        // positive claim a caller makes, never something a forgotten or
        // undefined option should do on its way through configure().
        render: ext.options.floatingMenu === false ? silentSuggestionRender : () => {
          let menuEl = null;
          let currentItems = [];
          let selectedIndex = 0;
          let selectCallback = null;
          let lastProps = null;
          // Task 3: /table's row×col grid. "items" is the normal command
          // list; "grid" is the size picker swapped in for it. gridCtrl is
          // renderTableSizeGrid's returned controller (only live while
          // mode is "grid"); pendingTableItem is the "table" commandItems
          // entry the grid was opened for, kept so onCommit can run its
          // real command with the chosen size once picked.
          let mode = "items";
          let gridCtrl = null;
          let pendingTableItem = null;
          // Outside-tap dismissal: a phone has no Escape key, so without
          // this the menu — a plain DOM node createMenu() appends straight
          // to document.body, outside the editor's own DOM subtree — was
          // unclosable there once opened. pointerdown + capture:true
          // mirrors @tiptap/suggestion's own (unused here — this renderer
          // positions the menu itself rather than through its `mount`
          // helper, so its built-in dismissOnOutsideClick never fires)
          // outside-dismiss wiring: capture so the check runs before any
          // stopPropagation() further down the tree could hide the tap
          // from it. exitSuggestion (the package's own exported helper)
          // is the same transaction its Escape path already dispatches
          // internally, so both routes converge on the identical
          // onExit/cleanup below — no second close path to keep in sync.
          let outsidePointerDown = null;

          function attachOutsideDismiss(editor) {
            outsidePointerDown = (event) => {
              // A tap ON the menu (a row, its scrollbar, whitespace inside
              // it) must not close it — only lets the row's own click
              // fire normally. Deliberately no preventDefault/
              // stopPropagation here either way: the tap that DOES close
              // the menu must still reach whatever it landed on (a caret
              // move, another block's handle, an unrelated button) —
              // closing must never also swallow that.
              if (isOutsideTap(event, menuEl)) {
                exitSuggestion(editor.view, SlashCommandsPluginKey);
              }
            };
            document.addEventListener("pointerdown", outsidePointerDown, true);
          }
          function detachOutsideDismiss() {
            if (outsidePointerDown) {
              document.removeEventListener("pointerdown", outsidePointerDown, true);
              outsidePointerDown = null;
            }
          }

          // Switch the menu back to its normal item list — the Escape
          // path (via ext.storage.exitTableGrid) and the grid's own "‹
          // table" back affordance both land here.
          function showItemsMode(props) {
            mode = "items";
            gridCtrl = null;
            pendingTableItem = null;
            ext.storage.tableGridActive = false;
            renderItems(menuEl, currentItems, selectedIndex, selectCallback);
            if (props?.clientRect) positionMenu(menuEl, props.clientRect());
          }

          // Swap the menu into /table's size grid instead of inserting
          // immediately. Committing runs `item.command` — the real /table
          // insert body — with the chosen size; the doc change that
          // follows ends the suggestion session normally (onExit below),
          // same as picking any other row. onCommit/onBack close over
          // `lastProps` (read at call time, not the `props` in scope when
          // the grid opened) so a query update that fires while the grid
          // is open — unlikely, but onUpdate keeps `lastProps` current
          // regardless — can't leave the eventual commit using a stale
          // range.
          function showGridMode(item, props) {
            mode = "grid";
            pendingTableItem = item;
            ext.storage.tableGridActive = true;
            gridCtrl = renderTableSizeGrid(menuEl, {
              onCommit: (size) => {
                const table = pendingTableItem;
                mode = "items";
                gridCtrl = null;
                pendingTableItem = null;
                ext.storage.tableGridActive = false;
                lastProps.command({
                  title: table.title,
                  command: ({ editor, range }) => table.command({ editor, range }, size),
                });
              },
              onBack: () => showItemsMode(lastProps),
            });
            if (props?.clientRect) positionMenu(menuEl, props.clientRect());
          }

          function makeSelectCallback(props) {
            return (index) => {
              const item = currentItems[index];
              if (!item) return;
              if (item.title === "table") {
                showGridMode(item, props);
                return;
              }
              props.command(item);
            };
          }

          // Read by SlashCommands' addKeyboardShortcuts Escape binding —
          // see the comment there for why Escape needs a second path.
          ext.storage.exitTableGrid = () => {
            if (mode === "grid") showItemsMode(lastProps);
          };

          return {
            onStart: (props) => {
              menuEl = createMenu();
              currentItems = orderBySection(props.items);
              selectedIndex = 0;
              mode = "items";
              gridCtrl = null;
              pendingTableItem = null;
              lastProps = props;

              selectCallback = makeSelectCallback(props);

              renderItems(menuEl, currentItems, selectedIndex, selectCallback);

              if (props.clientRect) {
                positionMenu(menuEl, props.clientRect());
              } else {
                menuEl.style.display = "block";
              }

              attachOutsideDismiss(props.editor);
            },

            onUpdate: (props) => {
              lastProps = props;
              // A query change while the grid is open would otherwise stomp
              // it with a freshly-filtered item list (there isn't a normal
              // path to get here — typing more after picking "table" isn't
              // the flow this task adds — but staying in grid mode and
              // just repositioning is the safe response either way).
              if (mode === "grid") {
                if (props.clientRect) positionMenu(menuEl, props.clientRect());
                return;
              }

              currentItems = orderBySection(props.items);
              selectedIndex = 0;

              selectCallback = makeSelectCallback(props);

              renderItems(menuEl, currentItems, selectedIndex, selectCallback);

              if (props.clientRect) {
                positionMenu(menuEl, props.clientRect());
              }
            },

            onKeyDown: ({ event }) => {
              if (mode === "grid") {
                if (
                  event.key === "ArrowUp" ||
                  event.key === "ArrowDown" ||
                  event.key === "ArrowLeft" ||
                  event.key === "ArrowRight"
                ) {
                  event.preventDefault();
                  gridCtrl?.moveHover(event.key);
                  return true;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  gridCtrl?.commit();
                  return true;
                }
                // Escape is intercepted earlier, at the keymap level (see
                // SlashCommands' addKeyboardShortcuts) — Suggestion's own
                // Escape handling unconditionally closes the whole menu,
                // which isn't reachable/preventable from here. Every other
                // key is swallowed rather than falling through to the
                // item-list bindings below (there's no item list to move a
                // selection through while the grid is open).
                return true;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                selectedIndex = (selectedIndex + 1) % currentItems.length;
                renderItems(menuEl, currentItems, selectedIndex, selectCallback);
                return true;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                selectedIndex = (selectedIndex - 1 + currentItems.length) % currentItems.length;
                renderItems(menuEl, currentItems, selectedIndex, selectCallback);
                return true;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (selectCallback && currentItems[selectedIndex]) {
                  selectCallback(selectedIndex);
                }
                return true;
              }
              if (event.key === "Escape") {
                return true; // Let suggestion plugin handle cleanup
              }
              return false;
            },

            onExit: () => {
              detachOutsideDismiss();
              mode = "items";
              gridCtrl = null;
              pendingTableItem = null;
              ext.storage.tableGridActive = false;
              // `exitTableGrid` is deliberately NOT nulled here. It is
              // assigned in render()'s body, and @tiptap/suggestion calls
              // render() exactly once per editor at plugin construction —
              // outside the returned Plugin — so nulling it on the first menu
              // close disarmed the grid's Escape binding for the rest of the
              // editor's life. `tableGridActive` (reset above, set by
              // showGridMode) is what actually gates that binding; the
              // callback is a stable closure and is safe to leave in place.
              // See slash-table-grid-escape.test.js's second-session case.
              if (menuEl) {
                menuEl.remove();
                menuEl = null;
              }
            },
          };
        },
      }),
    ];
  },
});
