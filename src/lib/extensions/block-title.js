import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, NodeSelection } from "@tiptap/pm/state";
import { nodeKind, nodeFamily } from "../pin-display.js";
import { createBlockShell } from "./block-shell.js";
import { bindTitleSlot } from "./title-slot.js";

// Boards that semantically benefit from a small title metadata header.
// Paragraphs and headings are left out — they already serve as their own
// label for surrounding content.
const BOARD_TYPES = [
  "list",
  "blockquote",
  "qaBlock",
  "recipeBlock",
  "decisionBlock",
  "table",
  "chart",
  "codeBlock",
];

// NodeView wraps these board types with a title slot inside the bordered
// chrome. `table` is intentionally excluded — its DOM contract (thead/tbody)
// fights NodeView wrapping; tables fall back to the CSS pseudo-element render.
// `codeBlock` is excluded — it has its own NodeView (CodeBlockShizumu) that
// renders the title slot itself alongside the language input + copy button.
const NODEVIEW_TYPES = [
  "list",
  "blockquote",
  "qaBlock",
  "recipeBlock",
  "decisionBlock",
];

// Types that get the title-navigation keyboard contract (ArrowUp at start
// of first item → focus title slot, ArrowDown into the board → focus
// title slot, Backspace at start of empty first item → focus title slot).
// Includes NODEVIEW_TYPES plus any block type that has its own NodeView
// with a `.board-title-slot` direct child exposing `__enterEdit()`.
// codeBlock (CodeBlockShizumu) qualifies, and so does table (ShellTableView,
// Plan 1c) — table stays OUT of NODEVIEW_TYPES (its DOM contract still
// fights createBoardNodeView's wrapping), but it wires its own real
// `.board-title-slot` input by hand and needs the same ArrowUp/ArrowDown/
// Backspace entry points as every other board. `chart` satisfies the same
// rule (its NodeView renders a real title slot exposing `__enterEdit()`);
// without it, ArrowDown from the paragraph above reached a table's title but
// not a chart's. Chart is an ATOM, so the board-resolution loop below can
// never match it from inside — only the ArrowDown-from-above branch applies.
//
// Membership here is NOT membership in the Enter/Backspace body-editing
// branches further down: those were written for NodeView boards whose
// `$from.depth - 1` is a body item, and `table` is explicitly excluded from
// both (see their comments — Enter used to delete a filled table cell).
const TITLE_NAV_TYPES = [...NODEVIEW_TYPES, "codeBlock", "table", "chart"];

const NODEVIEW_PLUGIN_KEY = new PluginKey("blockTitleNodeView");

export const BlockTitle = Extension.create({
  name: "blockTitle",

  addStorage() {
    // Slash commands set this to the inserted board's doc position so the
    // freshly-mounted NodeView can immediately enter edit mode on its title
    // slot. Cleared by the NodeView once consumed.
    return { pendingFocusPos: null };
  },

  addGlobalAttributes() {
    return [
      {
        types: BOARD_TYPES,
        attributes: {
          blockTitle: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => {
              const v = el.getAttribute("data-block-title");
              return v && v.trim() ? v : null;
            },
            renderHTML: (attrs) => {
              const t = (attrs.blockTitle || "").trim();
              return t ? { "data-block-title": t } : {};
            },
          },
        },
      },
    ];
  },

  addKeyboardShortcuts() {
    const ESCAPABLE = new Set(BOARD_TYPES);
    return {
      Escape: ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;

        let blockDepth = -1;
        for (let d = $from.depth; d > 0; d--) {
          if (ESCAPABLE.has($from.node(d).type.name)) {
            blockDepth = d;
            break;
          }
        }
        if (blockDepth < 0) return false;

        // Nested inside a listItem: create a new sibling item in the parent list.
        if (blockDepth > 1 && $from.node(blockDepth - 1)?.type.name === "listItem") {
          const itemPos = $from.before(blockDepth - 1);
          const item = $from.node(blockDepth - 1);
          const afterItem = itemPos + item.nodeSize;
          const marker = item.attrs?.marker || "bullet";
          const newItem = state.schema.nodes.listItem.create(
            { marker },
            state.schema.nodes.paragraph.create(),
          );
          let tr = state.tr.insert(afterItem, newItem);
          tr = tr.setSelection(TextSelection.near(tr.doc.resolve(afterItem + 2), 1));
          editor.view.dispatch(tr);
          return true;
        }

        // Top-level block: exit to paragraph after.
        const blockPos = $from.before(blockDepth);
        const blockNode = $from.node(blockDepth);
        const afterBlock = blockPos + blockNode.nodeSize;
        let tr = state.tr;
        let cursorPos;
        if (afterBlock >= state.doc.content.size) {
          tr = tr.insert(afterBlock, state.schema.nodes.paragraph.create());
          cursorPos = afterBlock + 1;
        } else {
          const next = state.doc.nodeAt(afterBlock);
          if (next?.isTextblock) {
            cursorPos = afterBlock + 1;
          } else {
            tr = tr.insert(afterBlock, state.schema.nodes.paragraph.create());
            cursorPos = afterBlock + 1;
          }
        }
        tr = tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPos), 1));
        editor.view.dispatch(tr);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const ext = this;
    const nodeViews = {};
    for (const typeName of NODEVIEW_TYPES) {
      nodeViews[typeName] = (node, view, getPos) => createBoardNodeView(node, view, getPos, ext);
    }
    return [
      new Plugin({
        key: NODEVIEW_PLUGIN_KEY,
        props: {
          nodeViews,
          // Edge keyboard handlers for wrapped boards:
          //   - ArrowUp at start of first item → focus title slot if filled
          //   - ArrowDown at end of last item  → exit board to next sibling
          //   - Enter at end of empty last item → exit board cleanly (no trailing empty item)
          //   - Backspace at start of first item, empty content →
          //       title empty: remove the entire board
          //       title filled: focus title slot at end
          // All handlers are narrow: each returns false if its precondition
          // doesn't hold so PM default behavior wins everywhere else.
          handleKeyDown(view, event) {
            if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
            const sel = view.state.selection;
            if (!sel.empty) return false;
            const $from = sel.$from;
            if (!$from.parent.isTextblock) return false;

            // ArrowDown at end of a top-level textblock that sits immediately
            // before a NodeView-wrapped board → focus the board's title slot
            // instead of stepping into the first item. The user reaches the
            // title without an extra ArrowUp.
            if (event.key === "ArrowDown"
                && $from.parentOffset === $from.parent.content.size
                && $from.depth === 1) {
              const afterPos = $from.after(1);
              const nextNode = view.state.doc.nodeAt(afterPos);
              if (nextNode && TITLE_NAV_TYPES.includes(nextNode.type.name)) {
                const wrapper = view.nodeDOM(afterPos);
                if (wrapper instanceof HTMLElement) {
                  const slot = wrapper.querySelector(":scope > .board-title-slot");
                  if (slot && typeof slot.__enterEdit === "function") {
                    event.preventDefault();
                    slot.__enterEdit();
                    return true;
                  }
                }
              }
            }

            // Find the nearest navigable-board ancestor and its depth.
            // We start at $from.depth (not depth-1) so codeBlock — whose
            // content IS the textblock itself, no intermediate paragraph
            // wrapper — matches at d=$from.depth.
            let boardDepth = -1;
            let board = null;
            for (let d = $from.depth; d >= 1; d--) {
              if (TITLE_NAV_TYPES.includes($from.node(d).type.name)) {
                boardDepth = d;
                board = $from.node(d);
                break;
              }
            }
            if (boardDepth < 0 || !board) return false;
            const boardPos = $from.before(boardDepth);

            // Helper: is the cursor at the absolute start of this board's first textblock?
            const atBoardStart = $from.parentOffset === 0
              && $from.pos === $from.start(boardDepth) + ($from.depth - boardDepth);
            // Helper: is the cursor at the very end of this board's last textblock?
            const atBoardEnd = $from.parentOffset === $from.parent.content.size
              && $from.pos === $from.end(boardDepth) - ($from.depth - boardDepth);

            // --- ArrowUp at start of first item → title slot if filled ---
            // For codeBlock — whose content is one textblock with embedded
            // newlines — "first item" really means "first visual line of
            // the code." Detect that by scanning text before the cursor
            // for a `\n`; if there is none, we're on the first line.
            // Without this, ArrowUp from the end of a single-line code
            // block (cursor at parentOffset > 0) misses the handler and
            // PM's default fires, jumping past the title to the paragraph
            // above.
            const atTitleEntry = (() => {
              if (atBoardStart) return true;
              if (board.type.name !== "codeBlock") return false;
              const textBefore = $from.parent.textBetween(0, $from.parentOffset);
              return !textBefore.includes("\n");
            })();
            if (event.key === "ArrowUp" && atTitleEntry) {
              const wrapper = view.nodeDOM(boardPos);
              if (!(wrapper instanceof HTMLElement)) return false;
              const slot = wrapper.querySelector(":scope > .board-title-slot");
              if (!slot || typeof slot.__enterEdit !== "function") return false;
              event.preventDefault();
              // Pin PM's selection to a NodeSelection on the board BEFORE
              // moving focus to the title input. If we leave PM's selection
              // inside the body's textblock, PM's selection observer notices
              // the foreign focus and re-syncs DOM selection back into the
              // body — the user sees the title focus for a frame then
              // ArrowUp's default fires and exits the block. The
              // NodeSelection moves PM's selection out of the textblock so
              // the input's focus sticks.
              //
              // We focus the title slot regardless of whether the title is
              // filled. Empty title + ArrowUp used to fall through to PM
              // default and exit the block, which surprised users since
              // they meant "go up to the title, even if empty".
              try {
                const tr = view.state.tr.setSelection(
                  NodeSelection.create(view.state.doc, boardPos),
                );
                view.dispatch(tr);
              } catch {}
              slot.__enterEdit();
              return true;
            }

            // --- ArrowDown at end of last item → next sibling, or append paragraph ---
            if (event.key === "ArrowDown" && atBoardEnd) {
              const afterBoard = boardPos + board.nodeSize;
              const doc = view.state.doc;
              if (afterBoard >= doc.content.size) {
                // No next sibling — append a paragraph and land cursor in it.
                const para = view.state.schema.nodes.paragraph.create();
                let tr = view.state.tr.insert(afterBoard, para);
                const $pos = tr.doc.resolve(afterBoard + 1);
                tr = tr.setSelection(TextSelection.near($pos, 1));
                event.preventDefault();
                view.dispatch(tr);
                view.focus();
                return true;
              }
              const $pos = doc.resolve(afterBoard + 1);
              const tr = view.state.tr.setSelection(TextSelection.near($pos, 1));
              event.preventDefault();
              view.dispatch(tr);
              view.focus();
              return true;
            }

            // --- Enter at end of empty last item → exit board (never drop) ---
            // Lists and q&a own their Enter behavior. Blockquote still needs
            // this generic exit logic. The board is always preserved; only
            // explicit user action (selection + Delete) removes a board.
            //
            // `table` is in TITLE_NAV_TYPES for the title-ENTRY half of the
            // contract only. This branch was written for NodeView boards
            // whose `$from.depth - 1` is a body item; inside a table that
            // depth is the tableCell, so the delete below would wipe a filled
            // cell (the Fitter re-materialises an empty one, so nothing
            // complained). Tables keep PM's own splitBlock. See
            // board-detection.test.js "Enter inside a table never deletes a cell".
            if (
              event.key === "Enter" &&
              atBoardEnd &&
              $from.parent.content.size === 0 &&
              board.type.name !== "list" &&
              board.type.name !== "qaBlock" &&
              board.type.name !== "table"
            ) {
              // Replace the trailing empty textblock with a fresh paragraph
              // immediately after the board. Board persists regardless of
              // whether it has a title or other content.
              const itemDepth = $from.depth - 1;
              let removeFrom, removeTo;
              if (itemDepth > boardDepth) {
                removeFrom = $from.before(itemDepth);
                removeTo = $from.after(itemDepth);
              } else {
                removeFrom = $from.before($from.depth);
                removeTo = $from.after($from.depth);
              }
              const para = view.state.schema.nodes.paragraph.create();
              let tr = view.state.tr.delete(removeFrom, removeTo);
              const insertAt = boardPos + board.nodeSize - (removeTo - removeFrom);
              tr = tr.insert(insertAt, para);
              const cursorTarget = insertAt + 1;
              tr = tr.setSelection(TextSelection.near(tr.doc.resolve(cursorTarget), 1));
              event.preventDefault();
              view.dispatch(tr);
              view.focus();
              return true;
            }

            // --- Backspace at start of an empty body paragraph that's NOT the first item ---
            // Empty thing + Backspace = removed, cursor to end of previous line.
            // Only fires when the paragraph is mid-body (not at board start), is empty,
            // and cursor is at offset 0.
            //
            // SKIP for lists: deleting only the paragraph leaves an invalid
            // listItem (schema requires "paragraph (...)") and PM re-inserts
            // an empty paragraph, so visually nothing changes. The list's own
            // keymap in unified-list.js deletes the WHOLE listItem, which is
            // what the user expects.
            if (event.key === "Backspace"
                && !atBoardStart
                && $from.parentOffset === 0
                && $from.parent.content.size === 0
                && $from.parent.isTextblock
                && board.type.name !== "list"
                && board.type.name !== "qaBlock"
                // Same reason as the Enter branch above: this deletes a body
                // textblock resolved through a NodeView board's depths. It is
                // not destructive for a table today (it removes only the empty
                // paragraph), but it is one schema change from being so, and a
                // table's cells are not this branch's "body".
                && board.type.name !== "table") {
              const removeFrom = $from.before($from.depth);
              const removeTo = $from.after($from.depth);
              let tr = view.state.tr.delete(removeFrom, removeTo);
              const targetPos = removeFrom - 1;
              if (targetPos < 0) return false;
              try {
                const $target = tr.doc.resolve(targetPos);
                tr = tr.setSelection(TextSelection.near($target, -1));
              } catch {
                return false;
              }
              event.preventDefault();
              view.dispatch(tr);
              view.focus();
              return true;
            }

            // --- Backspace at start of first item, empty content ---
            // For blockquote and qaBlock: navigate to the title slot so the
            // user can edit the title without leaving the board.
            // For list: skip — the list's own keymap (unified-list.js)
            // handles empty-item Backspace by merging upward into whatever
            // is above the list, matching standard editor behavior.
            if (
              event.key === "Backspace" &&
              atBoardStart &&
              $from.parent.content.size === 0 &&
              board.type.name !== "list"
            ) {
              let textblockCount = 0;
              board.descendants((n) => { if (n.isTextblock) textblockCount++; });
              if (textblockCount > 1) return false;

              const wrapper = view.nodeDOM(boardPos);
              if (!(wrapper instanceof HTMLElement)) return false;
              const slot = wrapper.querySelector(":scope > .board-title-slot");
              if (!slot || typeof slot.__enterEdit !== "function") return false;
              event.preventDefault();
              slot.__enterEdit();
              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});

export function isBoardType(typeName) {
  return BOARD_TYPES.includes(typeName);
}

export const BLOCK_TITLE_BOARD_TYPES = BOARD_TYPES;

// --------------------------------------------------------------------------
// NodeView factory
// --------------------------------------------------------------------------

function createBoardContentDOM(typeName) {
  let el;
  if (typeName === "list") {
    // Unified list — renders as <ul data-list>; per-item glyph (bullet,
    // checkbox, ordered numeral, plain) comes from the ListItem NodeView
    // and CSS data-marker rules.
    el = document.createElement("ul");
    el.dataset.list = "";
  } else if (typeName === "blockquote") {
    el = document.createElement("blockquote");
  } else if (typeName === "qaBlock") {
    el = document.createElement("div");
    el.dataset.type = "qa-block";
    el.classList.add("qa-block");
  } else if (typeName === "recipeBlock") {
    el = document.createElement("div");
    el.dataset.type = "recipe-block";
    el.classList.add("recipe-block");
  } else if (typeName === "decisionBlock") {
    el = document.createElement("div");
    el.dataset.type = "decision-block";
    el.classList.add("decision-block");
  } else {
    el = document.createElement("div");
  }
  el.classList.add("board-content");
  return el;
}

function createBoardNodeView(node, view, getPos, ext) {
  // Decision B from the redesign brainstorm — title slot only on outermost
  // boards. A nested list / qaBlock / blockquote sits inside a list item and
  // shouldn't carry its own title; the outer board's title already names the
  // group, and an inner title would just add visual noise.
  const isTopLevel = (() => {
    if (typeof getPos !== "function") return true;
    const pos = getPos();
    if (typeof pos !== "number") return true;
    try {
      const $pos = view.state.doc.resolve(pos);
      return $pos.depth === 0; // parent is doc
    } catch {
      return true;
    }
  })();

  if (!isTopLevel) {
    // Nested board — skip the block-shell chrome entirely. The outer
    // listItem's grid already provides visual indentation; applying the
    // board border + padding + background to a nested list makes it look
    // like a separate panel rather than a continuation of the outline.
    const nestedDom = document.createElement("div");
    // NOTE: duplicates block-shell.js createContentDOM; collapses when the nested branch moves to the shell.
    const contentDOM = createBoardContentDOM(node.type.name);
    nestedDom.append(contentDOM);
    return {
      dom: nestedDom,
      contentDOM,
      update: (newNode) => newNode.type === node.type,
    };
  }

  const shell = createBlockShell({ node, view, getPos, ext });
  const wrap = shell.dom;
  const titleSlot = shell.titleSlot;
  const contentDOM = shell.contentDOM;
  const chip = shell.chip;

  let currentNode = node;

  const titleApi = bindTitleSlot({
    titleSlot,
    view,
    getPos,
    ext,
    resolveContentPos: (n, pos) => {
      let tp = -1;
      n.descendants((d, dp) => {
        if (tp >= 0) return false;
        if (d.isTextblock) { tp = pos + 1 + dp + 1; return false; }
        return true;
      });
      return tp;
    },
    onTitleRender: (t) => shell.setTitle(t),
  });

  // Initial render of the title text.
  titleApi.refresh(node);

  // If the slash command set storage.pendingFocusPos to this node's pos,
  // enter edit mode on the next frame so the user types title → items.
  // Defer slightly so the NodeView is fully mounted before we try to focus.
  requestAnimationFrame(titleApi.consumePendingFocus);

  return {
    dom: wrap,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type !== currentNode.type) return false;
      currentNode = updatedNode;
      titleApi.refresh(updatedNode);
      // Intentionally NOT calling consumePendingFocus() here. The initial
      // mount above (rAF + one-frame retry) covers the slash-creates-new-
      // board race. Re-firing on every update() re-consumed stale arms:
      // armPendingTitleFocus iterates only top-level children, so a slash
      // inside an existing board arms the OUTER board's pos. update()
      // then yanked the cursor to the outer board's title slot on the
      // next unrelated transaction (nest, type, sink, etc.).
      // Refresh the chip in case the list marker changed (bullet → tasks etc.).
      const k = nodeKind(updatedNode);
      const f = nodeFamily(updatedNode);
      chip.dataset.family = f || "none";
      chip.textContent = k || "";
      chip.style.display = k ? "" : "none";
      return true;
    },
    stopEvent(event) {
      return titleSlot.contains(event.target);
    },
    ignoreMutation(mutation) {
      if (titleSlot.contains(mutation.target)) return true;
      // Coordinator branch-review fix (item 2): TipTapEditor.svelte's touch
      // title-reveal stamps a `.block-active-touch` class directly onto
      // this NodeView's own root `wrap` element (not titleSlot) to reveal +
      // re-enable its title on touch. Without this, ProseMirror's
      // domObserver treats that class mutation as a foreign DOM change it
      // can't reconcile against the model and rebuilds the NodeView from
      // scratch — destroying the class immediately after it's applied,
      // silently, off any of the JS paths that manage hoveredBlock/
      // handleVisible (confirmed via a MutationObserver trace: the old
      // `wrap` — WITH the class — gets removed and a class-less replacement
      // added in the same microtask flush).
      if (mutation.type === "attributes" && mutation.attributeName === "class" && mutation.target === wrap) {
        return true;
      }
      return false;
    },
    destroy() {
      titleApi.destroy();
    },
  };
}
