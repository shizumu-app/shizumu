import { Extension } from "@tiptap/core";
import { Suggestion } from "@tiptap/suggestion";
import { PluginKey, TextSelection } from "@tiptap/pm/state";
import { attachmentAddBytes } from "./api.js";

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
const SlashCommandsPluginKey = new PluginKey("slashCommands");

// If a block tool ends up as the first doc node, there's no way to place
// a cursor above it. This guard inserts a blank paragraph before it.
function ensureLeadingParagraph(editor) {
  const first = editor.state.doc.firstChild;
  if (!first) return;
  const textBearing = new Set(["paragraph", "heading"]);
  if (!textBearing.has(first.type.name)) {
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
// explicitly placed at the new block's first textblock — the same
// generic "first textblock inside the inserted node" walk /table doesn't
// need (insertTable already lands correctly) but /recipe and /q&a do.
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

// Boards that get a BlockTitle NodeView and an optional title slot. After the
// list-marker redesign there's only one list container, so the set drops
// from five entries to three.
const NODEVIEW_BOARD_TYPES = new Set([
  "list", "blockquote", "qaBlock",
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
  { title: "table", description: "3×3 table", section: "shizumu blocks",
    command: ({ editor, range }) => {
    // Plain insertTable. PM's replaceSelectionWith walks up to find a valid
    // parent — schemas that don't accept a table (listItem) auto-escape;
    // schemas that do (qaBlock, blockquote) nest. No explicit escape needed.
    editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
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
    if (!picked) return; // user cancelled: silent.
    if (picked.error) { if (toast) toast(`couldn't read image: ${picked.error.message || picked.error}`); return; }
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
      if (!picked) return; // user cancelled: silent.
      if (picked.error) { if (toast) toast(`couldn't read file: ${picked.error.message || picked.error}`); return; }
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

function filterItems(query) {
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

// Place the menu below the caret by default; flip above or clamp to the
// viewport so the full list is always reachable even near window edges.
// On mobile, the visualViewport API reports the actual visible area
// (excluding the soft keyboard) — using it as the height bound makes
// the menu flip above the caret when the keyboard would otherwise
// cover it.
function positionMenu(menuEl, rect) {
  if (!menuEl || !rect) return;
  menuEl.style.visibility = "hidden";
  menuEl.style.top = "0px";
  menuEl.style.left = "0px";
  menuEl.style.display = "block";
  const menuH = menuEl.offsetHeight;
  const menuW = menuEl.offsetWidth;
  const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const vw = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
  let top = rect.bottom + 4;
  if (top + menuH > vh - 8) {
    const flipped = rect.top - menuH - 4;
    top = flipped >= 8 ? flipped : Math.max(8, vh - menuH - 8);
  }
  let left = rect.left;
  if (left + menuW > vw - 8) left = Math.max(8, vw - menuW - 8);
  menuEl.style.top = `${top}px`;
  menuEl.style.left = `${left}px`;
  menuEl.style.visibility = "visible";
}

export const SlashCommands = Extension.create({
  name: "slashCommands",
  // Higher priority than the unified list extension so the Suggestion
  // plugin's keydown (Enter to pick a command) fires before the list keymap
  // (Enter to split an item). Without this, picking from the slash menu
  // inside a nested list silently splits the item instead of inserting.
  priority: 1000,

  addOptions() {
    return {
      suggestion: {
        char: "/",
        pluginKey: SlashCommandsPluginKey,
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
      },
    };
  },

  addProseMirrorPlugins() {
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

        render: () => {
          let menuEl = null;
          let currentItems = [];
          let selectedIndex = 0;
          let selectCallback = null;

          return {
            onStart: (props) => {
              menuEl = createMenu();
              currentItems = orderBySection(props.items);
              selectedIndex = 0;

              selectCallback = (index) => {
                const item = currentItems[index];
                if (item) props.command(item);
              };

              renderItems(menuEl, currentItems, selectedIndex, selectCallback);

              if (props.clientRect) {
                positionMenu(menuEl, props.clientRect());
              } else {
                menuEl.style.display = "block";
              }
            },

            onUpdate: (props) => {
              currentItems = orderBySection(props.items);
              selectedIndex = 0;

              selectCallback = (index) => {
                const item = currentItems[index];
                if (item) props.command(item);
              };

              renderItems(menuEl, currentItems, selectedIndex, selectCallback);

              if (props.clientRect) {
                positionMenu(menuEl, props.clientRect());
              }
            },

            onKeyDown: ({ event }) => {
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
